import type { LocalReason } from './errors.ts';

// Подготовка файла к отправке (OBJ-4, ADR-0010): тип и предел проверяются до отправки, а фото
// на телефоне уменьшается до 2560 px по длинной стороне. Сервер всё равно проверяет содержимое.

/** Предел сервера: 25 МиБ включительно. */
export const MAX_FILE_BYTES = 25 * 1024 * 1024;
export const MAX_SIDE = 2560;
const JPEG_QUALITY = 0.85;

const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']);
const IMAGE_EXTENSION = /\.(jpe?g|png|webp|heic|heif)$/i;
const PDF_EXTENSION = /\.pdf$/i;

export type FileKind = 'image' | 'pdf';

/** Что это за файл по типу и расширению; `null` — формат не подходит. Содержимое проверит сервер. */
export function classify(file: Pick<File, 'name' | 'type'>): FileKind | null {
  const type = file.type.toLowerCase();
  if (type === 'application/pdf') return 'pdf';
  if (IMAGE_TYPES.has(type)) return 'image';
  // Телефоны и Windows нередко не называют тип HEIC: тогда смотрим на расширение.
  if (type === '' || type === 'application/octet-stream') {
    if (PDF_EXTENSION.test(file.name)) return 'pdf';
    if (IMAGE_EXTENSION.test(file.name)) return 'image';
  }
  return null;
}

/** Что не так с файлом ещё до отправки; `null` — всё в порядке. */
export function localProblem(file: Pick<File, 'name' | 'type' | 'size'>): LocalReason | null {
  if (classify(file) === null) return 'type';
  if (file.size === 0) return 'empty';
  if (file.size > MAX_FILE_BYTES) return 'size';
  return null;
}

/** Размер после уменьшения: длинная сторона не больше `limit`, пропорции сохраняются. */
export function fitSize(
  width: number,
  height: number,
  limit: number = MAX_SIDE,
): { width: number; height: number } {
  const longest = Math.max(width, height);
  if (longest <= limit) return { width, height };
  const scale = limit / longest;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

/** Имя с новым расширением: `снимок.webp` → `снимок.jpg`. */
export function withExtension(name: string, extension: string): string {
  const dot = name.lastIndexOf('.');
  const base = dot > 0 ? name.slice(0, dot) : name;
  return `${base}.${extension}`;
}

/**
 * Уменьшает фото больше `MAX_SIDE`; остальное отдаёт как есть. Если браузер не умеет читать
 * формат (например, HEIC в Chrome), отправляется оригинал: сервер сам перекодирует его.
 */
export async function prepareForUpload(file: File): Promise<File> {
  if (classify(file) !== 'image' || typeof createImageBitmap !== 'function') return file;
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return file;
  }
  try {
    const target = fitSize(bitmap.width, bitmap.height);
    if (target.width === bitmap.width && target.height === bitmap.height) return file;
    const canvas = document.createElement('canvas');
    canvas.width = target.width;
    canvas.height = target.height;
    const context = canvas.getContext('2d');
    if (context === null) return file;
    context.imageSmoothingQuality = 'high';
    context.drawImage(bitmap, 0, 0, target.width, target.height);
    const png = file.type === 'image/png';
    const blob = await new Promise<Blob | null>((done) =>
      canvas.toBlob(done, png ? 'image/png' : 'image/jpeg', png ? undefined : JPEG_QUALITY),
    );
    canvas.width = 0;
    canvas.height = 0;
    if (blob === null || blob.size === 0) return file;
    const name = png ? file.name : withExtension(file.name, 'jpg');
    return new File([blob], name, { type: blob.type, lastModified: file.lastModified });
  } finally {
    bitmap.close();
  }
}
