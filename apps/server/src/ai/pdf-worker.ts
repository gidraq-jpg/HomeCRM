import { createCanvas } from '@napi-rs/canvas';
import { z } from 'zod';
import { PDF_MAX_BYTES, PDF_MAX_PAGES, PDF_MAX_TEXT, PdfReply } from './pdf-protocol.ts';

// Только байты через IPC: ссылки, вложения, JavaScript и XFA из PDF не открываются.
// PDF.js использует fetch только для дополнительных ресурсов; запрещаем его и в fake-worker.
globalThis.fetch = async () => {
  throw new Error('PDF network access disabled');
};
process.once('message', async (message) => {
  try {
    const input = z
      .string()
      .max(Math.ceil(PDF_MAX_BYTES / 3) * 4)
      .parse(message);
    const { getDocument, AnnotationMode } = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const task = getDocument({
      data: new Uint8Array(Buffer.from(input, 'base64')),
      isEvalSupported: false,
      disableFontFace: true,
      useSystemFonts: false,
      useWorkerFetch: false,
      useWasm: false,
      isOffscreenCanvasSupported: false,
      isImageDecoderSupported: false,
      enableXfa: false,
      stopAtErrors: true,
      maxImageSize: 40000000,
      canvasMaxAreaInBytes: 16000000,
      verbosity: 0,
    });
    const pdf = await task.promise;
    const result = {
      pages: pdf.numPages,
      processedPages: Math.min(pdf.numPages, PDF_MAX_PAGES),
      text: '',
      images: [] as string[],
      textTruncated: false,
    };
    try {
      for (let number = 1; number <= result.processedPages; number++) {
        const page = await pdf.getPage(number);
        const content = await page.getTextContent();
        const text = content.items
          .map((item) => ('str' in item ? item.str : ''))
          .join(' ')
          .replace(/\s+/gu, ' ')
          .trim();
        let raster = (text.match(/[\p{L}\p{N}]/gu)?.length ?? 0) < 30;
        if (!raster) {
          const remaining = PDF_MAX_TEXT - result.text.length;
          const section = `\n[Страница ${number}]\n${text}`;
          result.text += section.slice(0, remaining);
          result.textTruncated ||= section.length > remaining;
          // Барьер личности должен видеть и страницы после исчерпания текстового предела.
          raster = section.length > remaining;
        }
        if (raster) {
          const original = page.getViewport({ scale: 1 });
          const scale = Math.min(150 / 72, 2000 / Math.max(original.width, original.height));
          const viewport = page.getViewport({ scale });
          if (!(viewport.width > 0 && viewport.height > 0)) throw new Error('Invalid page');
          const canvas = createCanvas(
            Math.min(2000, Math.ceil(viewport.width)),
            Math.min(2000, Math.ceil(viewport.height)),
          );
          await page.render({
            canvas: canvas as unknown as Parameters<typeof page.render>[0]['canvas'],
            viewport,
            annotationMode: AnnotationMode.DISABLE,
          }).promise;
          result.images.push(canvas.toBuffer('image/jpeg', 85).toString('base64'));
        }
        page.cleanup();
      }
    } finally {
      await task.destroy();
    }
    process.send?.(PdfReply.parse({ ok: true, result }));
  } catch (error) {
    const code =
      error instanceof Error && error.name === 'PasswordException'
        ? 'AI_PDF_ENCRYPTED'
        : 'AI_PDF_BROKEN';
    process.send?.({ ok: false, code });
  }
});
