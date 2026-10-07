import { fileTypeFromBuffer } from 'file-type';
import decode from 'heic-decode';
import sharp, { type Sharp } from 'sharp';
import { Failure } from '../objects/support.ts';

export const MAX_FILE_BYTES = 25 * 1024 * 1024;
const MAX_PIXELS = 40_000_000;
export function safeFilename(input: string): string {
  const cleaned = input
    // biome-ignore lint/suspicious/noControlCharactersInRegex: удаляем управляющие символы из имени.
    .replace(/[\\/:*?"<>|\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g, '_')
    .trim()
    .replace(/^[.]+|[. ]+$/g, '');
  return [...cleaned].slice(0, 180).join('') || 'файл';
}
export async function prepareFile(input: Buffer) {
  if (input.length === 0 || input.length > MAX_FILE_BYTES) throw new Failure(413, 'FILE_TOO_LARGE');
  try {
    const type = await fileTypeFromBuffer(input);
    if (type?.mime === 'application/pdf')
      return { data: input, mimeType: type.mime, preview: undefined };
    if (
      !type ||
      ![
        'image/jpeg',
        'image/png',
        'image/webp',
        'image/heic',
        'image/heif',
        'image/heic-sequence',
        'image/heif-sequence',
      ].includes(type.mime)
    )
      throw new Error('type');
    let image: Sharp;
    if (type.mime.startsWith('image/hei')) {
      // @types/heic-decode не описывает размеры до decode и dispose; они есть в публичном API.
      const images = (await decode.all({ buffer: input })) as unknown as Array<{
        width: number;
        height: number;
        decode(): Promise<{ width: number; height: number; data: Uint8ClampedArray }>;
      }> & { dispose(): void };
      try {
        const first = images[0];
        if (
          !first ||
          first.width < 1 ||
          first.height < 1 ||
          first.width * first.height > MAX_PIXELS
        )
          throw new Error('dimensions');
        const pixels = await first.decode();
        image = sharp(Buffer.from(pixels.data), {
          raw: { width: pixels.width, height: pixels.height, channels: 4 },
          limitInputPixels: MAX_PIXELS,
        });
      } finally {
        images.dispose();
      }
    } else image = sharp(input, { limitInputPixels: MAX_PIXELS, failOn: 'error' }).autoOrient();
    // Сохраняем цветовой профиль; EXIF, GPS, XMP и произвольные хвосты удаляются.
    const format = type.mime === 'image/png' ? 'png' : type.mime === 'image/webp' ? 'webp' : 'jpeg';
    const data = await image.keepIccProfile().toFormat(format).toBuffer();
    if (data.length > MAX_FILE_BYTES) throw new Failure(413, 'FILE_TOO_LARGE');
    const preview = await sharp(data)
      .keepIccProfile()
      .resize({ width: 480, height: 480, fit: 'inside', withoutEnlargement: true })
      .webp()
      .toBuffer();
    return { data, mimeType: `image/${format}`, preview };
  } catch (error) {
    if (error instanceof Failure) throw error;
    throw new Failure(415, 'UNSUPPORTED_FILE');
  }
}
