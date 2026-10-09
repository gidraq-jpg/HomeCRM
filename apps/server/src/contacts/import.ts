import multipart from '@fastify/multipart';
import { contacts, eq, isNull, sql, type Transaction } from '@homecrm/db';
import { canCreate, OrganizationData, PersonData } from '@homecrm/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Account } from '../auth/account.ts';
import type { AuthModule } from '../auth/routes.ts';
import { beginOperation, fingerprint, finishOperation } from '../idempotency.ts';
import {
  columnsOf,
  dataRoutes,
  deny,
  Failure,
  parse,
  placementFrom,
  placementOf,
  requireWrite,
  version,
} from '../objects/support.ts';
import { getContact } from './routes.ts';
import { MAX_VCARD_BYTES, mergePerson, normalizePhone, parseVCard, VCardFile } from './vcard.ts';

const Placement = z.strictObject({
  spaceId: z.uuid(),
  audience: z.enum(['household', 'adults']).optional(),
});
const Choice = z.discriminatedUnion('action', [
  z.strictObject({ index: z.number().int().min(0).max(499), action: z.literal('create') }),
  z.strictObject({
    index: z.number().int().min(0).max(499),
    action: z.literal('merge'),
    contactId: z.uuid(),
    updatedAt: z.iso.datetime(),
  }),
]);
const Input = VCardFile.extend({
  mode: z.enum(['preview', 'apply']).default('preview'),
  placement: Placement.optional(),
  previewHash: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .optional(),
  idempotencyKey: z.uuid().optional(),
  choices: z.array(Choice).max(500).optional(),
});
const phonesOf = (data: PersonData) =>
  data.phones.flatMap((p) => {
    const n = normalizePhone(p.number);
    return n ? [n] : [];
  });
async function organization(
  tx: Transaction,
  account: Account,
  name: string,
  place: Awaited<ReturnType<typeof placementFrom>>,
) {
  if (!name) return null;
  const rows = await tx.select().from(contacts).where(eq(contacts.title, name));
  const prior = rows.find(
    (c) =>
      c.kind === 'organization' &&
      !c.deletedAt &&
      c.spaceId === place.spaceId &&
      c.audience === (place.kind === 'household' ? place.audience : null),
  );
  if (prior) return prior.id;
  const [row] = await tx
    .insert(contacts)
    .values({
      ...columnsOf(place),
      authorId: account.id,
      title: name,
      kind: 'organization',
      data: OrganizationData.parse({}),
    })
    .returning();
  if (!row) deny();
  return row.id;
}
export async function contactImportRoutes(app: FastifyInstance, module: AuthModule) {
  await app.register(multipart, {
    limits: { fileSize: MAX_VCARD_BYTES, files: 1, fields: 0, parts: 1 },
    throwFileSizeLimit: true,
  });
  const route = dataRoutes(app, module);
  route('POST', '/api/contacts/import', 200, async (tx, account, request) => {
    let input: unknown = request.body;
    if (request.isMultipart()) {
      const query = parse(
        z
          .strictObject({
            spaceId: z.uuid().optional(),
            audience: z.enum(['household', 'adults']).optional(),
          })
          .refine((v) => !v.audience || v.spaceId),
        request.query,
      );
      let file: { fileName: string; content: string } | undefined;
      for await (const part of request.parts()) {
        if (part.type !== 'file') throw new Failure(400, 'INVALID_INPUT');
        const bytes = await part.toBuffer();
        try {
          file = {
            fileName: part.filename,
            content: new TextDecoder('utf-8', { fatal: true }).decode(bytes),
          };
        } catch {
          throw new Failure(400, 'INVALID_VCARD');
        }
      }
      input = {
        ...file,
        ...(query.spaceId
          ? { placement: { spaceId: query.spaceId, audience: query.audience } }
          : {}),
      };
    }
    const body = parse(Input, input);
    const cards = parseVCard(body.content);
    const place = await placementFrom(
      tx,
      account,
      body.placement?.spaceId,
      body.placement?.audience,
      'household',
    );
    if (!canCreate(account.viewer, { type: 'contact', placement: place, authorId: account.id }))
      deny();
    const previewHash = fingerprint({ cards, place });
    const visible = (await tx.select().from(contacts).where(isNull(contacts.deletedAt))).filter(
      (r) => r.kind === 'person',
    );
    const candidates = visible.map((r) => ({
      row: r,
      phones: new Set(phonesOf(PersonData.parse(r.data))),
    }));
    if (body.mode === 'preview')
      return {
        previewHash,
        placement: columnsOf(place),
        items: cards.map((card, index) => ({
          index,
          ...card,
          matches: candidates
            .filter((c) => phonesOf(card.data).some((n) => c.phones.has(n)))
            .map(({ row }) => ({
              id: row.id,
              title: row.title,
              updatedAt: row.updatedAt,
              canMerge: (() => {
                try {
                  requireWrite(account, row, 'contact');
                  return true;
                } catch (e) {
                  if (e instanceof Failure) return false;
                  throw e;
                }
              })(),
            })),
        })),
      };
    if (
      !body.idempotencyKey ||
      body.previewHash !== previewHash ||
      !body.choices ||
      body.choices.length !== cards.length ||
      new Set(body.choices.map((c) => c.index)).size !== cards.length ||
      body.choices.some((c) => c.index >= cards.length)
    )
      throw new Failure(400, 'INVALID_IMPORT_SELECTION');
    const choices = [...body.choices].sort((a, b) => a.index - b.index);
    const hash = fingerprint({ previewHash, choices });
    const prior = await beginOperation(tx, account.id, body.idempotencyKey, 'contact_import', hash);
    if (prior) {
      for (const id of prior) await getContact(tx, account, id);
      return { contactIds: prior, replayed: true };
    }
    const locked = new Map<string, typeof contacts.$inferSelect>();
    for (const id of [
      ...new Set(choices.flatMap((c) => (c.action === 'merge' ? [c.contactId] : []))),
    ].sort())
      locked.set(id, await getContact(tx, account, id, true));
    for (const choice of choices)
      if (choice.action === 'merge') {
        const target = locked.get(choice.contactId);
        if (!target) throw new Failure(409, 'IMPORT_TARGET_CHANGED');
        version(choice.updatedAt, target.updatedAt);
      }
    await tx.execute(sql`SELECT set_config('app.contact_import','on',true)`);
    const resultIds: string[] = [];
    for (const choice of choices) {
      const card = cards[choice.index];
      if (!card) throw new Failure(400, 'INVALID_IMPORT_SELECTION');
      if (choice.action === 'merge') {
        const target = locked.get(choice.contactId);
        if (!target || target.deletedAt || target.kind !== 'person')
          throw new Failure(409, 'IMPORT_TARGET_CHANGED');
        requireWrite(account, target, 'contact');
        const data = PersonData.parse(target.data);
        if (!phonesOf(data).some((n) => phonesOf(card.data).includes(n)))
          throw new Failure(409, 'IMPORT_TARGET_CHANGED');
        const organizationId =
          target.organizationId ??
          (await organization(tx, account, card.organization, placementOf(target)));
        const [changed] = await tx
          .update(contacts)
          .set({ data: mergePerson(data, card.data), organizationId })
          .where(eq(contacts.id, target.id))
          .returning();
        if (!changed) deny();
        locked.set(target.id, changed);
        resultIds.push(target.id);
      } else {
        const organizationId = await organization(tx, account, card.organization, place);
        const [row] = await tx
          .insert(contacts)
          .values({
            ...columnsOf(place),
            authorId: account.id,
            title: card.title,
            kind: 'person',
            data: card.data,
            organizationId,
          })
          .returning();
        if (!row) deny();
        resultIds.push(row.id);
      }
    }
    await finishOperation(tx, account.id, body.idempotencyKey, 'contact_import', hash, resultIds);
    return { contactIds: resultIds, replayed: false };
  });
}
