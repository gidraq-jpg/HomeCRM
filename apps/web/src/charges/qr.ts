import { parsePaymentQr, type QrReceipt } from '@homecrm/shared';

type Detector = { detect: (source: ImageBitmap) => Promise<{ rawValue: string }[]> };
export async function readReceiptQr(file: File): Promise<QrReceipt | null> {
  const image = await createImageBitmap(file);
  try {
    const Native = (
      globalThis as typeof globalThis & {
        BarcodeDetector?: new (options: { formats: string[] }) => Detector;
      }
    ).BarcodeDetector;
    if (Native) {
      try {
        const codes = await new Native({ formats: ['qr_code'] }).detect(image);
        for (const code of codes) {
          // Для старых кодировок нужен binaryData резервного декодера.
          if (code.rawValue.startsWith('ST00012|')) {
            const result = parsePaymentQr(code.rawValue);
            if (result) return result;
          }
        }
      } catch {
        /* Недоступный системный декодер заменяется локальным jsQR. */
      }
    }
    const scale = Math.min(1, 2400 / Math.max(image.width, image.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.width * scale));
    canvas.height = Math.max(1, Math.round(image.height * scale));
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) return null;
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
    const { default: jsQR } = await import('jsqr');
    const code = jsQR(pixels.data, pixels.width, pixels.height, {
      inversionAttempts: 'attemptBoth',
    });
    return code ? parsePaymentQr(new Uint8Array(code.binaryData)) : null;
  } finally {
    image.close();
  }
}
