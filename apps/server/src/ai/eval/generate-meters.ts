// Только вымышленные табло. Генератор не обращается к модели или данным приложения.
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';

const directory = join(import.meta.dirname, 'samples/meters');
await mkdir(directory, { recursive: true });
const displays = [
  ['cold_water', 5, 3, ['00123.456']],
  ['hot_water', 5, 3, ['00321.078']],
  ['cold_water', 5, 3, ['01234.567']],
  ['hot_water', 5, 3, ['00009.013']],
  ['electricity', 6, 0, ['012345']],
  ['electricity', 6, 1, ['032145.6']],
  ['electricity', 6, 2, ['012345.67', '023456.78']],
  ['electricity', 6, 1, ['001234.5', '002345.6', '003456.7']],
  ['gas', 5, 3, ['00210.309']],
  ['cold_water', 5, 3, ['09999.999']],
  ['electricity', 5, 2, ['01234.01', '02345.02', '03456.03']],
  ['cold_water', 5, 3, ['00000.120']],
] as const;
const cases = [];
for (const [index, [resource, integerDigits, fractionDigits, values]] of displays.entries()) {
  const height = 180 + values.length * 110;
  const rows = values
    .map((value, zone) => {
      const [integer, fraction] = value.split('.');
      return `<text x="25" y="${150 + zone * 110}" font-size="24">T${zone + 1}</text><text x="90" y="${150 + zone * 110}" font-size="62" font-family="monospace" fill="black">${integer}<tspan fill="#b60000">${fraction ? `,${fraction}` : ''}</tspan></text>`;
    })
    .join('');
  const svg = `<svg width="760" height="${height}"><rect width="760" height="${height}" fill="#ededeb"/><text x="25" y="42" font-size="22">Синтетическое табло · ${resource}</text><rect x="75" y="72" width="630" height="${values.length * 110}" rx="8" fill="white"/>${rows}${index === 2 || index === 9 ? '<ellipse cx="390" cy="115" rx="200" ry="40" fill="white" opacity="0.19"/>' : ''}<text x="25" y="${height - 20}" font-size="18">Учебный счётчик · вымышленные значения</text></svg>`;
  const image = `${index + 1}.jpg`;
  await sharp(Buffer.from(svg))
    .rotate(index === 3 ? -5 : index === 10 ? 7 : 0, { background: 'white' })
    .jpeg({ quality: 92 })
    .toFile(join(directory, image));
  cases.push({
    image,
    meter: {
      resource,
      integerDigits,
      fractionDigits,
      zones: values.map((_, i) => `T${i + 1}`),
      unit: resource === 'electricity' ? 'кВт·ч' : 'м³',
      previous: null,
    },
    expected: values.map((value) => {
      const [a, b] = value.split('.');
      return `${BigInt(a ?? '0')}${b ? `.${b}` : ''}`;
    }),
  });
}
await writeFile(join(directory, 'cases.json'), `${JSON.stringify(cases, null, 2)}\n`);
