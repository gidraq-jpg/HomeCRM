// Синтетические учебные макеты; ни одного настоящего человека или номера документа.
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';

const directory = join(import.meta.dirname, 'samples/identity');
await mkdir(directory, { recursive: true });
const titles = [
  'ПАСПОРТ РОССИЙСКОЙ ФЕДЕРАЦИИ',
  'СВИДЕТЕЛЬСТВО О РОЖДЕНИИ',
  'СНИЛС · ИНН',
  'ВОДИТЕЛЬСКОЕ УДОСТОВЕРЕНИЕ',
  'ПОЛИС ОМС · ДМС',
];
const cases = [];
for (const [index, title] of titles.entries()) {
  const image = `${index + 1}.jpg`;
  await sharp(
    Buffer.from(
      `<svg width="1200" height="650"><rect width="1200" height="650" fill="#f5e8da"/><text x="35" y="95" font-size="40">${title}</text><text x="35" y="220" font-size="32">Примеров Учебный Вымышленнович</text><text x="35" y="300" font-size="30">Номер: ТЕСТ-00000${index + 1}</text><text x="35" y="380" font-size="30">Дата: 01.01.2001</text><text x="35" y="580" font-size="24">СИНТЕТИЧЕСКИЙ ОБРАЗЕЦ · ДАННЫЕ ВЫМЫШЛЕННЫЕ</text></svg>`,
    ),
  )
    .jpeg()
    .toFile(join(directory, image));
  cases.push({ image });
}
await writeFile(join(directory, 'cases.json'), `${JSON.stringify(cases, null, 2)}\n`);
