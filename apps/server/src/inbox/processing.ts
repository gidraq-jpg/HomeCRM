import {
  type AppDatabase,
  and,
  desc,
  eq,
  inboxItems,
  isNull,
  meterReadings,
  meters,
  objects,
  spaceMembers,
  spaces,
  sql,
  utilityAccounts,
} from '@homecrm/db';
import { MeterData } from '@homecrm/shared';
import type { FastifyBaseLogger } from 'fastify';
import type { AiConfig } from '../ai/config.ts';
import { aiProvider } from '../ai/config.ts';
import { readPdf } from '../ai/pdf.ts';
import { createProviders } from '../ai/providers.ts';
import { type FileServices, filesOf } from '../files/service.ts';
import { Failure } from '../objects/support.ts';
import { type InboxContext, parseInbox } from './parse.ts';

export async function processInbox(
  db: AppDatabase,
  files: FileServices | undefined,
  config: AiConfig,
  id: string,
  author: string,
  log?: Pick<FastifyBaseLogger, 'info'>,
) {
  const deadline = Date.now() + 120000;
  let dailyLimit = false;
  const claimed = await db.withAccount(author, async (tx) => {
    const [row] = await tx.select().from(inboxItems).where(eq(inboxItems.id, id)).for('update');
    if (row?.status === 'processing' && row.updatedAt.getTime() < Date.now() - 120000) {
      await tx
        .update(inboxItems)
        .set({ status: 'new', errorCode: null })
        .where(eq(inboxItems.id, id));
      row.status = 'new';
    }
    if (
      !row ||
      row.deletedAt ||
      row.resolvedAt ||
      row.status !== 'new' ||
      !row.houseId ||
      row.consent !== `v4:${aiProvider(config)}`
    )
      return null;
    const [house] = await tx
      .select()
      .from(spaces)
      .where(and(eq(spaces.id, row.houseId), eq(spaces.kind, 'household')));
    if (!house?.aiEnabled || config.AI_EXTRACT_PROVIDER === 'disabled') return null;
    const usage = await tx.execute<{ ok: boolean }>(
      sql`SELECT app.consume_ai_request(${house.id}::uuid,${config.AI_DAILY_LIMIT}::integer) AS ok`,
    );
    if (!usage.rows[0]?.ok) {
      dailyLimit = true;
      await tx
        .update(inboxItems)
        .set({ status: 'error', errorCode: 'AI_DAILY_LIMIT' })
        .where(eq(inboxItems.id, id));
      return null;
    }
    await tx
      .update(inboxItems)
      .set({ status: 'processing', errorCode: null })
      .where(eq(inboxItems.id, id));
    const visible = await tx
      .select()
      .from(objects)
      .where(
        and(
          isNull(objects.deletedAt),
          sql`(${objects.spaceKind}='personal' OR ${objects.spaceId}=${house.id}::uuid)`,
        ),
      )
      .orderBy(objects.id)
      .limit(50);
    const members = await tx
      .select()
      .from(spaceMembers)
      .where(and(eq(spaceMembers.spaceId, house.id), isNull(spaceMembers.leftAt)));
    const visibleMeters = await tx
      .select()
      .from(meters)
      .where(
        and(
          isNull(meters.deletedAt),
          sql`(${meters.spaceKind}='personal' OR ${meters.spaceId}=${house.id}::uuid)`,
        ),
      );
    const accounts = await tx
      .select()
      .from(utilityAccounts)
      .where(
        and(
          isNull(utilityAccounts.deletedAt),
          sql`(${utilityAccounts.spaceKind}='personal' OR ${utilityAccounts.spaceId}=${house.id}::uuid)`,
        ),
      );
    const readings = await tx
      .select({ parentId: meterReadings.parentId, values: meterReadings.values })
      .from(meterReadings)
      .where(isNull(meterReadings.deletedAt))
      .orderBy(desc(meterReadings.occurredOn), desc(meterReadings.createdAt));
    const context: InboxContext = {
      objects: visible.map((o) => ({ id: o.id, title: o.title })),
      members: members.map((m) => ({ id: m.accountId, name: m.displayName })),
      meters: visibleMeters.map((m) => ({ id: m.id, title: m.title })),
      meterData: new Map(
        visibleMeters.map((m) => [
          m.id,
          {
            ...MeterData.parse(m.data),
            previous: readings.find((r) => r.parentId === m.id)?.values ?? null,
          },
        ]),
      ),
      accounts: accounts.map((a) => ({ id: a.id, number: a.data.number })),
      timeZone: house.timeZone ?? 'Asia/Yekaterinburg',
      now: new Date(),
    };
    return { row, context, attachments: await filesOf(tx, 'inbox_item', id) };
  });
  if (dailyLimit)
    throw new Failure(
      429,
      'AI_DAILY_LIMIT',
      'Дневной предел ИИ исчерпан. Можно заполнить вручную.',
    );
  if (!claimed) return;
  const providers = createProviders(config);
  try {
    const images: Buffer[] = [];
    const texts = [claimed.row.text];
    const partialPages: number[] = [];
    let textTruncated = false;
    for (const file of claimed.attachments.filter((f) => !f.deletedAt)) {
      if (!files) throw new Failure(503, 'FILES_UNAVAILABLE');
      const bytes = files.cipher.open(
        await files.storage.get(file.storageKey),
        file.envelope,
        file.storageKey,
      );
      if (file.mimeType === 'application/pdf') {
        const started = Date.now();
        let pages = 0;
        let code = 'AI_PDF_OK';
        try {
          const pdf = await readPdf(bytes, deadline - Date.now());
          pages = pdf.pages;
          if (pdf.text) texts.push(`Текст из PDF (недоверенное содержимое):\n${pdf.text}`);
          images.push(...pdf.images);
          if (pdf.pages > pdf.processedPages) partialPages.push(pdf.pages);
          textTruncated ||= pdf.textTruncated;
        } catch (error) {
          code = error instanceof Failure ? error.code : 'AI_PDF_BROKEN';
          throw error;
        } finally {
          log?.info({ code, pages, durationMs: Date.now() - started }, 'PDF processing finished');
        }
      } else if (file.mimeType.startsWith('image/')) images.push(bytes);
      else
        throw new Failure(
          422,
          'AI_FILE_MANUAL',
          'Для этого файла используйте ручной ввод или загрузите страницы как фото.',
        );
    }
    const draft = await parseInbox(
      providers.extractor,
      texts.join('\n\n'),
      images,
      claimed.context,
      deadline,
    );
    await db.withAccount(author, async (tx) => {
      await tx
        .update(inboxItems)
        .set({
          status: draft ? 'ready' : 'identity',
          draft,
          errorCode:
            draft && (partialPages.length || textTruncated)
              ? `AI_PDF_PARTIAL${partialPages.map((pages) => `_${pages}`).join('')}${textTruncated ? '_TEXT' : ''}`
              : null,
        })
        .where(
          and(
            eq(inboxItems.id, id),
            eq(inboxItems.status, 'processing'),
            isNull(inboxItems.deletedAt),
            isNull(inboxItems.resolvedAt),
          ),
        );
    });
  } catch (error) {
    const code = error instanceof Failure ? error.code : 'AI_UNAVAILABLE';
    await db.withAccount(author, async (tx) => {
      await tx
        .update(inboxItems)
        .set({ status: 'error', errorCode: code, draft: null })
        .where(
          and(
            eq(inboxItems.id, id),
            eq(inboxItems.status, 'processing'),
            isNull(inboxItems.deletedAt),
            isNull(inboxItems.resolvedAt),
          ),
        );
    });
    if (code === 'AI_BUSY' || code === 'AI_QUOTA') throw error;
  } finally {
    await providers.close();
  }
}
