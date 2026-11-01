import {
  and,
  contacts,
  eq,
  inboxItems,
  isNull,
  notes,
  objectFields,
  objects,
  recordLinks,
  shoppingItems,
  spaces,
  tasks,
} from '@homecrm/db';
import {
  ChatItem,
  canBeAssignee,
  canCreate,
  localDate,
  PersonData,
  ReadingInput,
} from '@homecrm/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { loadViewer } from '../auth/provision.ts';
import type { AuthModule } from '../auth/routes.ts';
import {
  columnsOf,
  dataRoutes,
  deny,
  Failure,
  placementFrom,
  readReference,
} from '../objects/support.ts';
import { createReading, getMeter } from '../utilities/meters.ts';

export async function chatInboxRoutes(app: FastifyInstance, module: AuthModule) {
  const route = dataRoutes(app, module);
  route('POST', '/api/inbox/chat/confirm', 200, async (tx, account, req) => {
    const body = z
      .strictObject({
        ids: z.array(z.uuid()).min(1).max(20),
        spaceId: z.uuid().optional(),
        audience: z.enum(['household', 'adults']).optional(),
        edits: z.record(z.uuid(), ChatItem).optional(),
      })
      .parse(req.body);
    const place = await placementFrom(tx, account, body.spaceId, body.audience);
    for (const id of [...new Set(body.ids)].sort()) {
      const [row] = await tx
        .select()
        .from(inboxItems)
        .where(
          and(eq(inboxItems.id, id), eq(inboxItems.source, 'chat'), isNull(inboxItems.deletedAt)),
        )
        .for('update');
      if (!row || row.authorId !== account.id) throw new Failure(404, 'NOT_FOUND');
      const draft = ChatItem.parse(body.edits?.[id] ?? row.chatDraft);
      const type =
        draft.kind === 'shopping'
          ? 'shopping_item'
          : draft.kind === 'meter'
            ? 'meter_reading'
            : draft.kind;
      if (
        !canCreate(account.viewer, {
          type,
          placement: place,
          authorId: account.id,
          assigneeId: place.kind === 'personal' ? account.id : (draft.assigneeId ?? account.id),
        })
      )
        deny();
      const base = {
        ...columnsOf(place),
        authorId: account.id,
        assigneeId: place.kind === 'personal' ? account.id : (draft.assigneeId ?? account.id),
        title: draft.title,
      };
      let targetId: string | undefined;
      if (base.assigneeId && !canBeAssignee(await loadViewer(tx, base.assigneeId), place)) deny();
      if (draft.kind === 'meter') {
        if (!draft.meterId) throw new Failure(400, 'METER_REQUIRED');
        const meter = await getMeter(tx, account, draft.meterId);
        // Дочернее показание наследует пространство счётчика; перенос требует выбора другого счётчика.
        if (meter.spaceId !== place.spaceId)
          throw new Failure(
            409,
            'METER_PLACEMENT',
            'Выберите пространство счётчика для показания.',
          );
        const [home] = row.houseId
          ? await tx.select().from(spaces).where(eq(spaces.id, row.houseId))
          : [];
        const result = await createReading(
          tx,
          account,
          meter,
          ReadingInput.parse({
            occurredOn: draft.date ?? localDate(new Date(), home?.timeZone ?? module.homeTimeZone),
            values: draft.values,
            comment: draft.body,
          }),
        );
        targetId = result.id;
      } else if (draft.kind === 'task') {
        const [created] = await tx
          .insert(tasks)
          .values({
            ...base,
            dueOn: draft.date,
            dueTime: draft.time,
            description: draft.body,
            householdId: row.houseId,
          })
          .returning();
        targetId = created?.id;
        if (targetId && draft.objectId) {
          await readReference(tx, account, { type: 'object', id: draft.objectId });
          await tx.insert(recordLinks).values({
            leftTable: 'tasks',
            leftId: targetId,
            rightTable: 'objects',
            rightId: draft.objectId,
            authorId: account.id,
            role: 'object',
          });
        }
      } else if (draft.kind === 'note') {
        const [created] = await tx
          .insert(notes)
          .values({ ...base, body: draft.body })
          .returning();
        targetId = created?.id;
      } else if (draft.kind === 'shopping') {
        const [created] = await tx
          .insert(shoppingItems)
          .values({
            ...base,
            quantity: draft.quantity,
            data: { note: draft.body, store: '', category: '' },
          })
          .returning();
        targetId = created?.id;
      } else if (draft.kind === 'object') {
        const [created] = await tx
          .insert(objects)
          .values({ ...base, objectType: draft.objectType })
          .returning();
        targetId = created?.id;
        if (targetId && draft.body)
          await tx
            .insert(objectFields)
            .values({ ...base, parentId: targetId, title: 'Заметка', value: draft.body });
      } else {
        const [created] = await tx
          .insert(contacts)
          .values({ ...base, kind: 'person', data: PersonData.parse({ note: draft.body }) })
          .returning();
        targetId = created?.id;
      }
      if (!targetId) throw new Failure(409, 'NOT_SAVED');
      await tx
        .update(inboxItems)
        .set({
          resolvedAt: new Date(),
          deletedAt: new Date(),
          chatDraft: null,
          text: '',
          target: { type, id: targetId },
        })
        .where(eq(inboxItems.id, id));
    }
    return { ok: true };
  });
}
