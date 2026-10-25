// Восемь синтетических квитанций; QR создаёт уже используемый клиентом qrcode.
import { mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import sharp from 'sharp';

const require = createRequire(new URL('../../../../web/package.json', import.meta.url));
const QRCode = require('qrcode') as {
  toBuffer: (
    text: string,
    options: { width: number; margin: number; errorCorrectionLevel: string },
  ) => Promise<Buffer>;
};
const directory = join(import.meta.dirname, 'samples/receipts');
await mkdir(directory, { recursive: true });
const amounts = [123456, 900001, 99, 1709, 70109, 889175, 1234, 650010];
const cases = [];
for (const [index, totalCents] of amounts.entries()) {
  const number = `99000000${String(index + 10).padStart(2, '0')}`;
  const supplier = `Учебный поставщик ${index + 1}`;
  const period = index % 2 ? '2026-08' : '2026-09';
  const dueOn = index % 2 ? '2026-09-25' : '2026-10-25';
  const money = `${Math.trunc(totalCents / 100).toLocaleString('ru-RU')},${String(totalCents % 100).padStart(2, '0')}`;
  const qr =
    index < 4
      ? `ST00012|Name=${supplier}|${index === 3 ? 'PersonalAcc=00000000000000000000|PersAcc' : 'PersonalAcc'}=${number}|Sum=${totalCents}|PaymPeriod=${period.slice(5)}${period.slice(0, 4)}|Purpose=Коммунальные услуги за ${period.slice(5)}.${period.slice(0, 4)}`
      : null;
  const svg = `<svg width="1400" height="900"><rect width="1400" height="900" fill="white"/><text x="40" y="70" font-size="30">СИНТЕТИЧЕСКАЯ КВИТАНЦИЯ · ВЫМЫШЛЕННЫЕ ДАННЫЕ</text><text x="40" y="160" font-size="40">${supplier}</text><text x="40" y="250" font-size="34">Лицевой счёт: ${number}</text><text x="40" y="340" font-size="34">Период: ${period.slice(5)}.${period.slice(0, 4)}</text><text x="40" y="430" font-size="34">Оплатить до: ${dueOn.slice(8)}.${dueOn.slice(5, 7)}.${dueOn.slice(0, 4)}</text><text x="40" y="550" font-size="46">Итого к оплате: ${money} руб.</text><text x="40" y="650" font-size="26">Показанная сумма и все реквизиты вымышлены.</text></svg>`;
  const image = `${index + 1}.jpg`;
  const receipt = sharp(Buffer.from(svg));
  if (qr)
    receipt.composite([
      {
        input: await QRCode.toBuffer(qr, { width: 390, margin: 4, errorCorrectionLevel: 'M' }),
        left: 990,
        top: 200,
      },
    ]);
  await receipt.jpeg({ quality: 95 }).toFile(join(directory, image));
  cases.push({
    image,
    qr,
    account: {
      id: `${String(index + 1).repeat(8)}-1111-4111-8111-${String(index + 1).repeat(12)}`,
      number,
      title: supplier,
    },
    expected: { supplier, period, totalCents, dueOn },
  });
}
await writeFile(join(directory, 'cases.json'), `${JSON.stringify(cases, null, 2)}\n`);
