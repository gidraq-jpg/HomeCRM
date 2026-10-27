import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import fontkit from '@pdf-lib/fontkit';
import { PDFDocument } from 'pdf-lib';
import sharp from 'sharp';

export const receiptLines = [
  'СИНТЕТИЧЕСКАЯ КВИТАНЦИЯ ЖКХ — ДАННЫЕ ВЫМЫШЛЕННЫЕ',
  'Учебный поставщик',
  'Лицевой счёт: 9900000010',
  'Период: 2026-09',
  'Итого к оплате: 1234,56 руб.',
  'Оплатить до: 2026-10-25',
];
export const identityLines = [
  'ПАСПОРТ — УЧЕБНЫЙ МАКЕТ, НЕДЕЙСТВИТЕЛЕН',
  'Вымышленный Персонаж Учебнович',
  'Номер: 0000 000000',
];
export async function makePdf(pages: { lines: string[]; scan?: boolean; fontSize?: number }[]) {
  const doc = await PDFDocument.create({ updateMetadata: false });
  doc.registerFontkit(fontkit);
  const font = await doc.embedFont(
    await readFile(
      new URL(
        '../../../../web/node_modules/@fontsource/onest/files/onest-cyrillic-400-normal.woff',
        import.meta.url,
      ),
    ),
    { subset: true },
  );
  const latin = await doc.embedFont(
    await readFile(
      new URL(
        '../../../../web/node_modules/@fontsource/onest/files/onest-latin-400-normal.woff',
        import.meta.url,
      ),
    ),
    { subset: true },
  );
  for (const entry of pages) {
    const page = doc.addPage([840, 600]);
    if (entry.scan) {
      const svg = `<svg width="1680" height="1200"><rect width="100%" height="100%" fill="white"/>${entry.lines.map((line, i) => `<text x="60" y="${100 + i * 130}" font-size="34">${line.replaceAll('&', '&amp;').replaceAll('<', '&lt;')}</text>`).join('')}</svg>`;
      const image = await doc.embedJpg(
        await sharp(Buffer.from(svg)).jpeg({ quality: 95 }).toBuffer(),
      );
      page.drawImage(image, { x: 0, y: 0, width: 840, height: 600 });
    } else {
      entry.lines.forEach((line, i) => {
        let x = 30;
        const size = entry.fontSize ?? 17;
        for (const run of line.match(/[\u0400-\u04ff]+|[^\u0400-\u04ff]+/gu) ?? []) {
          const current = /^[\u0400-\u04ff]/u.test(run) ? font : latin;
          page.drawText(run, { x, y: 550 - i * 55, size, font: current });
          x += current.widthOfTextAtSize(run, size);
        }
      });
    }
  }
  return Buffer.from(await doc.save({ useObjectStreams: false }));
}

/** Настоящее шифрование Standard R2; пароль учебного пустого PDF — test. */
export function encryptedPdf() {
  const pad = Buffer.from(
    '28bf4e5e4e758a4164004e56fffa01082e2e00b6d0683e802f0ca9fe6453697a',
    'hex',
  );
  const md5 = (bytes: Buffer) => createHash('md5').update(bytes).digest();
  const rc4 = (key: Buffer, bytes: Buffer) => {
    const state = Array.from({ length: 256 }, (_, i) => i);
    let j = 0;
    for (let i = 0; i < 256; i++) {
      j = (j + (state[i] ?? 0) + (key[i % key.length] ?? 0)) % 256;
      [state[i], state[j]] = [state[j] ?? 0, state[i] ?? 0];
    }
    let i = 0;
    j = 0;
    return Buffer.from(
      bytes.map((value) => {
        i = (i + 1) % 256;
        j = (j + (state[i] ?? 0)) % 256;
        [state[i], state[j]] = [state[j] ?? 0, state[i] ?? 0];
        return value ^ (state[((state[i] ?? 0) + (state[j] ?? 0)) % 256] ?? 0);
      }),
    );
  };
  const password = Buffer.concat([Buffer.from('test'), pad]).subarray(0, 32);
  const owner = rc4(md5(password).subarray(0, 5), password);
  const id = md5(Buffer.from('HomeCRM fictional encrypted PDF'));
  const permissions = Buffer.alloc(4);
  permissions.writeInt32LE(-4);
  const user = rc4(md5(Buffer.concat([password, owner, permissions, id])).subarray(0, 5), pad);
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 800] /Resources << >> >>',
    `<< /Filter /Standard /V 1 /R 2 /O <${owner.toString('hex')}> /U <${user.toString('hex')}> /P -4 >>`,
  ];
  let text = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((object, i) => {
    offsets.push(Buffer.byteLength(text));
    text += `${i + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = Buffer.byteLength(text);
  text += `xref\n0 5\n0000000000 65535 f \n${offsets
    .slice(1)
    .map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`)
    .join(
      '',
    )}trailer\n<< /Size 5 /Root 1 0 R /Encrypt 4 0 R /ID [<${id.toString('hex')}> <${id.toString('hex')}>] >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(text);
}
