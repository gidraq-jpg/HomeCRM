import { Buffer } from 'node:buffer';
import { crc32, deflateSync } from 'node:zlib';
import type { Page } from '@playwright/test';
import { expect } from './support.ts';

// Тестовые файлы вымышленные и создаются в самом тесте: ни одного настоящего фото или документа.

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function chunk(type: string, data: Buffer): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 'ascii');
  const tail = Buffer.alloc(4);
  tail.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, tail]);
}

/** Настоящий PNG из полос двух цветов: сжимается мелко даже при размере в тысячи пикселей. */
export function makePng(width: number, height: number): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // 8 бит на канал
  header[9] = 2; // RGB
  const row = Buffer.alloc(1 + width * 3);
  const rows: Buffer[] = [];
  for (let y = 0; y < height; y += 1) {
    const copy = Buffer.from(row);
    const stripe = Math.floor(y / 40) % 2 === 0;
    for (let x = 0; x < width; x += 1) {
      copy[1 + x * 3] = stripe ? 52 : 233;
      copy[2 + x * 3] = stripe ? 93 : 238;
      copy[3 + x * 3] = stripe ? 72 : 231;
    }
    rows.push(copy);
  }
  return Buffer.concat([
    SIGNATURE,
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(Buffer.concat(rows))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** Минимальный PDF по содержимому: сервер определяет тип по началу файла. */
export const PDF = Buffer.from('%PDF-1.7\nfictional family receipt\n%%EOF');

/** PDF ровно заданного размера: хвост заполняется пробелами после %%EOF. */
export function pdfOfSize(bytes: number): Buffer {
  const data = Buffer.alloc(bytes, 0x20);
  PDF.copy(data);
  return data;
}

export const PNG_MIME = 'image/png';
export const PDF_MIME = 'application/pdf';

export function filePicker(page: Page) {
  return page.locator('input[type="file"]');
}

export const fileRows = (page: Page) =>
  page.getByRole('list', { name: 'Файлы записи' }).getByRole('listitem');

/** Размер изображения, которое отдаёт сервер по адресу файла: проверка уменьшения на клиенте. */
export async function servedImageSize(page: Page, url: string) {
  return page.evaluate(async (address) => {
    const response = await fetch(address, { credentials: 'same-origin' });
    const bitmap = await createImageBitmap(await response.blob());
    const size = { width: bitmap.width, height: bitmap.height };
    bitmap.close();
    return size;
  }, url);
}

export async function expectImageLoaded(page: Page, selector: string) {
  await expect
    .poll(() =>
      page
        .locator(selector)
        .first()
        .evaluate((image) => (image as HTMLImageElement).naturalWidth),
    )
    .toBeGreaterThan(0);
}
