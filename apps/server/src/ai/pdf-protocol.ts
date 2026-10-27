import { z } from 'zod';

export const PDF_MAX_BYTES = 25 * 1024 * 1024;
export const PDF_MAX_PAGES = 5;
export const PDF_MAX_TEXT = 20000;
export const PDF_TIMEOUT_MS = 20000;
export const PdfErrorCode = z.enum(['AI_PDF_ENCRYPTED', 'AI_PDF_BROKEN', 'AI_PDF_TIMEOUT']);
export const PdfResult = z.strictObject({
  pages: z.number().int().positive(),
  processedPages: z.number().int().min(1).max(PDF_MAX_PAGES),
  text: z.string().max(PDF_MAX_TEXT),
  images: z.array(z.string().max(8 * 1024 * 1024)).max(PDF_MAX_PAGES),
  textTruncated: z.boolean(),
});
export const PdfReply = z.discriminatedUnion('ok', [
  z.strictObject({ ok: z.literal(true), result: PdfResult }),
  z.strictObject({ ok: z.literal(false), code: PdfErrorCode }),
]);
