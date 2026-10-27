import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { PDFDocument } from 'pdf-lib';
import sharp from 'sharp';
import { expect, it } from 'vitest';
import { identityLines, makePdf } from './eval/pdf-fixtures.ts';
import { readPdf } from './pdf.ts';
import { PDF_MAX_BYTES, PDF_MAX_TEXT } from './pdf-protocol.ts';

const sample = (name: string) =>
  readFile(new URL(`./eval/samples/pdf/${name}.pdf`, import.meta.url));
it('AI-9: текстовый слой, скан JPEG и смешанные страницы', async () => {
  const text = await readPdf(await sample('receipt-text'));
  expect(text.text).toContain('1234,56');
  expect(text.images).toHaveLength(0);
  const scan = await readPdf(await sample('receipt-scan'));
  expect(scan.text).toBe('');
  expect(scan.images).toHaveLength(1);
  const meta = await sharp(scan.images[0]).metadata();
  expect(meta.format).toBe('jpeg');
  expect(Math.max(meta.width ?? 0, meta.height ?? 0)).toBeLessThanOrEqual(2000);
  expect(Math.max(meta.width ?? 0, meta.height ?? 0)).toBeGreaterThanOrEqual(1750);
  const mixed = await readPdf(await sample('mixed'));
  expect(mixed).toMatchObject({ pages: 2, processedPages: 2 });
  expect(mixed.text).toContain('Лицевой счёт');
  expect(mixed.images).toHaveLength(1);
});
it('AI-9: только первые пять страниц и 20 000 символов', async () => {
  const long = await readPdf(await sample('contract'));
  expect(long).toMatchObject({ pages: 8, processedPages: 5 });
  expect(long.text).toMatch(/Страница\s+5\s+из\s+8/u);
  expect(long.text).not.toMatch(/Страница\s+6\s+из\s+8/u);
  const many = await makePdf(
    Array.from({ length: 5 }, () => ({ lines: Array(8).fill('а'.repeat(900)), fontSize: 1 })),
  );
  const clipped = await readPdf(many);
  expect(clipped.text.length).toBe(PDF_MAX_TEXT);
  expect(clipped.textTruncated).toBe(true);
  expect(clipped.images.length).toBeGreaterThan(0);
});
it('AI-9: короткий текст считается сканом; длинная сторона ограничена', async () => {
  const result = await readPdf(await makePdf([{ lines: ['123'] }]));
  expect(result.images).toHaveLength(1);
});
it('AI-9: пароль, повреждение, размер и тайм-аут; следующий разбор работает', async () => {
  for (const [name, code] of [
    ['encrypted', 'AI_PDF_ENCRYPTED'],
    ['broken', 'AI_PDF_BROKEN'],
  ] as const)
    await expect(readPdf(await sample(name))).rejects.toMatchObject({ code });
  await expect(readPdf(Buffer.alloc(PDF_MAX_BYTES + 1))).rejects.toMatchObject({
    code: 'FILE_TOO_LARGE',
  });
  await expect(readPdf(await sample('receipt-text'), 1)).rejects.toMatchObject({
    code: 'AI_PDF_TIMEOUT',
  });
  expect((await readPdf(await sample('receipt-text'))).pages).toBe(1);
});
it('AI-9: JavaScript, ссылки и внешние шрифты не выполняются и не запрашиваются', async () => {
  let requests = 0;
  const server = createServer((_request, response) => {
    requests++;
    response.end('unexpected');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/untrusted`;
    const doc = await PDFDocument.load(await sample('receipt-text'));
    doc.addJavaScript('untrusted', `fetch('${url}'); app.launchURL('${url}');`);
    const { PDFName, PDFString } = await import('pdf-lib');
    const annotation = doc.context.register(
      doc.context.obj({
        Type: 'Annot',
        Subtype: 'Link',
        Rect: [0, 0, 800, 600],
        A: { S: 'URI', URI: PDFString.of(url) },
      }),
    );
    doc.getPage(0).node.set(PDFName.of('Annots'), doc.context.obj([annotation]));
    expect((await readPdf(Buffer.from(await doc.save()))).text).toContain('1234,56');
    expect(requests).toBe(0);
  } finally {
    server.close();
  }
});
it('AI-4: личность на пятой странице остаётся в проверяемом тексте', async () => {
  const result = await readPdf(
    await makePdf([
      ...Array.from({ length: 4 }, () => ({
        lines: ['Учебный договор обслуживания — вымышленные данные'],
      })),
      { lines: identityLines },
    ]),
  );
  expect(result.text).toContain('ПАСПОРТ');
});
