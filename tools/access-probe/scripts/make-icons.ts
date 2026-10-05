// Рисует значки заглушки — светлый дом на зелёном фоне — без сторонних библиотек.
// PNG собирается вручную: строки пикселей, сжатие zlib, контрольные суммы CRC32.
// Запуск: pnpm --filter @homecrm/access-probe icons
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { crc32, deflateSync } from 'node:zlib';

const BACKGROUND = { r: 0x2f, g: 0x6b, b: 0x4f };
const HOUSE = { r: 0xff, g: 0xfd, b: 0xf7 };
const SAMPLES = 4; // сглаживание краёв: 4 × 4 точки на пиксель

/** Точка (0..1) внутри дома: крыша-треугольник и стены, дверь вырезана. Всё внутри безопасной зоны маски. */
function insideHouse(x: number, y: number): boolean {
  const roof = y >= 0.24 && y <= 0.5 && Math.abs(x - 0.5) <= ((y - 0.24) / 0.26) * 0.3;
  const walls = x >= 0.29 && x <= 0.71 && y >= 0.48 && y <= 0.77;
  const door = x >= 0.45 && x <= 0.55 && y >= 0.6 && y <= 0.77;
  return (roof || walls) && !door;
}

const mix = (from: number, to: number, t: number): number => Math.round(from + (to - from) * t);

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, checksum]);
}

function png(size: number): Buffer {
  const stride = size * 4 + 1;
  const raw = Buffer.alloc(stride * size);
  for (let py = 0; py < size; py += 1) {
    raw[py * stride] = 0; // фильтр строки: без фильтра
    for (let px = 0; px < size; px += 1) {
      let hits = 0;
      for (let sy = 0; sy < SAMPLES; sy += 1) {
        for (let sx = 0; sx < SAMPLES; sx += 1) {
          const x = (px + (sx + 0.5) / SAMPLES) / size;
          const y = (py + (sy + 0.5) / SAMPLES) / size;
          if (insideHouse(x, y)) hits += 1;
        }
      }
      const t = hits / (SAMPLES * SAMPLES);
      const offset = py * stride + 1 + px * 4;
      raw[offset] = mix(BACKGROUND.r, HOUSE.r, t);
      raw[offset + 1] = mix(BACKGROUND.g, HOUSE.g, t);
      raw[offset + 2] = mix(BACKGROUND.b, HOUSE.b, t);
      raw[offset + 3] = 255;
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // бит на канал
  header[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const publicDir = join(import.meta.dirname, '..', 'public');
for (const size of [192, 512]) {
  writeFileSync(join(publicDir, `icon-${size}.png`), png(size));
}
console.log('Значки 192 и 512 px записаны в public/.');
