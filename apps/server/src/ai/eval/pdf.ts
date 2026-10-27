import { readFile } from 'node:fs/promises';
import { DocumentDraft, ReceiptPhotoDraft } from '@homecrm/shared';
import { parseInbox } from '../../inbox/parse.ts';
import { Failure } from '../../objects/support.ts';
import { readPdf } from '../pdf.ts';
import type { createProviders } from '../providers.ts';

export async function evaluatePdfs(providers: ReturnType<typeof createProviders>, fake: boolean) {
  const accountId = '11111111-1111-4111-8111-111111111111';
  const context = {
    objects: [],
    members: [],
    timeZone: 'Asia/Yekaterinburg',
    accounts: [{ id: accountId, number: '9900000010' }],
  };
  const byField: Record<string, { correct: number; total: number }> = {};
  const score = (field: string, ok: boolean) => {
    const count = byField[field] ?? { correct: 0, total: 0 };
    byField[field] = count;
    count.total++;
    if (ok) count.correct++;
  };
  let failed = 0;
  const started = Date.now();
  const samples = [
    'receipt-text',
    'receipt-scan',
    'mixed',
    'contract',
    'encrypted',
    'broken',
    'identity',
    'identity-scan',
  ];
  for (const name of samples) {
    try {
      const pdf = await readPdf(
        await readFile(new URL(`./samples/pdf/${name}.pdf`, import.meta.url)),
      );
      const draft = await parseInbox(
        providers.extractor,
        pdf.text ? `Текст из PDF:\n${pdf.text}` : '',
        pdf.images,
        context,
      );
      if (name.startsWith('identity')) {
        score('identity', draft === null);
      } else if (name === 'contract') {
        score('document.kind', draft?.classification.kind === 'document');
        const document = DocumentDraft.parse(draft?.fields);
        score('document.type', document.type.value === 'contract');
        score('document.issuedOn', document.issuedOn.value === (fake ? null : '2026-10-01'));
        score('document.expiresOn', document.expiresOn.value === (fake ? null : '2027-10-01'));
        score('pdf.pages', pdf.pages === 8 && pdf.processedPages === 5);
      } else {
        score('receipt.kind', draft?.classification.kind === 'receipt');
        const receipt = ReceiptPhotoDraft.parse(draft?.fields);
        for (const [field, value] of Object.entries({
          supplier: 'Учебный поставщик',
          accountId,
          period: '2026-09',
          totalCents: 123456,
          dueOn: '2026-10-25',
        })) {
          score(`receipt.${field}`, receipt[field as keyof typeof receipt].value === value);
        }
      }
    } catch (error) {
      if (
        (name === 'encrypted' && error instanceof Failure && error.code === 'AI_PDF_ENCRYPTED') ||
        (name === 'broken' && error instanceof Failure && error.code === 'AI_PDF_BROKEN')
      )
        score('pdf.errors', true);
      else failed++;
    }
  }
  const counts = Object.values(byField);
  const correct = counts.reduce((n, c) => n + c.correct, 0);
  const fields = counts.reduce((n, c) => n + c.total, 0);
  const receipt = Object.entries(byField)
    .filter(([key]) => key.startsWith('receipt.'))
    .map(([, value]) => value);
  const receiptAccuracy =
    receipt.reduce((n, c) => n + c.correct, 0) / (receipt.reduce((n, c) => n + c.total, 0) || 1);
  console.log(
    JSON.stringify({
      mode: fake ? 'contract' : 'quality',
      samples: samples.length,
      failed,
      correct,
      fields,
      byField,
      receiptAccuracy,
      durationMs: Date.now() - started,
    }),
  );
  if (
    failed ||
    receiptAccuracy < 0.85 ||
    byField['receipt.totalCents']?.correct !== 3 ||
    byField.identity?.correct !== 2 ||
    byField['pdf.errors']?.correct !== 2 ||
    !fields ||
    correct / fields < 0.85
  )
    process.exitCode = 1;
}
