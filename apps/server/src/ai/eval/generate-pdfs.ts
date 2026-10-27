// Только вымышленные образцы. Запуск: node apps/server/src/ai/eval/generate-pdfs.ts
import { mkdir, writeFile } from 'node:fs/promises';
import { encryptedPdf, identityLines, makePdf, receiptLines } from './pdf-fixtures.ts';

const directory = new URL('./samples/pdf/', import.meta.url);
await mkdir(directory, { recursive: true });
const samples = {
  'receipt-text': await makePdf([{ lines: receiptLines }]),
  'receipt-scan': await makePdf([{ lines: receiptLines, scan: true }]),
  contract: await makePdf(
    Array.from({ length: 8 }, (_, i) => ({
      lines: [
        'Учебный договор обслуживания — вымышленные данные',
        `Страница ${i + 1} из 8. Объект: Дача.`,
        'Дата выдачи: 2026-10-01. Действует до: 2027-10-01.',
      ],
    })),
  ),
  encrypted: encryptedPdf(),
  broken: Buffer.from('%PDF-1.7\nfictional broken PDF\n%%EOF'),
  identity: await makePdf([{ lines: identityLines }]),
  'identity-scan': await makePdf([{ lines: identityLines, scan: true }]),
  mixed: await makePdf([{ lines: receiptLines }, { lines: receiptLines, scan: true }]),
};
for (const [name, bytes] of Object.entries(samples))
  await writeFile(new URL(`${name}.pdf`, directory), bytes);
