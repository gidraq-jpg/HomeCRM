import {
  DocumentData,
  DocumentDraft,
  DraftSchemas,
  type InboxDraft,
  TaskFields,
} from '@homecrm/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import type { Visibility } from '../access/visibility.ts';
import { needsReview } from '../ai/compact.ts';
import { useAction } from '../auth/components.tsx';
import { defaultDocumentVisibility, documentVisibilityOptions } from '../documents/access.ts';
import { createDocument } from '../documents/api.ts';
import { EMPTY_DOCUMENT } from '../documents/form.ts';
import { ownerFacts, useOwnerChoices } from '../documents/owners.tsx';
import { useHousehold } from '../household/HouseholdContext.tsx';
import { creatableVisibilities, viewerOf } from '../notes/abilities.ts';
import { createNote } from '../notes/api.ts';
import { createShopping } from '../shopping/api.ts';
import { mutateTask } from '../tasks/api.ts';
import { createBody } from '../tasks/NewTaskScreen.tsx';
import { useNavigate } from '../ui/navigation.tsx';
import { type InboxItem, inboxAction, inboxOperationKey } from './api.ts';
import { attachmentMessage, withFieldChange } from './review-fields.ts';

/** Запись, созданная из входящего: её получает сервер при разборе. */
export type ReviewTarget = {
  type:
    | 'task'
    | 'note'
    | 'document'
    | 'object'
    | 'shopping_item'
    | 'meter_reading'
    | 'utility_charge';
  id: string;
};

/**
 * Состояние разбора одного входящего: черновики, выбор и правка, места записей, владелец и
 * доступ документа, создание записей и завершение разбора.
 */
export function useInboxReview(
  row: InboxItem,
  editKind: string | undefined,
  attachSource: boolean,
) {
  const { me } = useHousehold();
  const navigate = useNavigate();
  const client = useQueryClient();
  const action = useAction();
  const created = useRef<ReviewTarget | null>(null);
  const [draft, setDraft] = useState(row.draft);
  const [places, setPlaces] = useState<Record<number, Visibility>>({});
  const [savedIndices, setSavedIndices] = useState<number[]>([]);
  const [locked, setLocked] = useState(false);
  const [editing, setEditing] = useState<number | null>(null);
  const [excluded, setExcluded] = useState<number[]>([]);
  const [confirmed, setConfirmed] = useState<number[]>([]);
  const entries = draft ? [draft, ...draft.additional] : [];
  const selected = entries
    .map((entry, index) => ({ entry, index }))
    .filter(({ index }) => !excluded.includes(index) && !savedIndices.includes(index));
  const unreviewed = selected.some(
    ({ entry, index }) =>
      needsReview({ classification: entry.classification, fields: entry.fields }) &&
      !confirmed.includes(index),
  );
  function changeField(index: number, key: string, value: string) {
    if (!draft) return;
    const entry = entries[index];
    if (!entry) return;
    const next = withFieldChange(entry, key, value);
    if (!next) return;
    setDraft(
      index === 0
        ? { ...draft, fields: next.fields, classification: next.classification }
        : { ...draft, additional: draft.additional.map((e, i) => (i + 1 === index ? next : e)) },
    );
  }
  const kind =
    editKind ?? (row.status === 'identity' ? 'document' : (draft?.classification.kind ?? 'note'));
  const [chosenOwner, setOwner] = useState<string | null>(null);
  const owners = useOwnerChoices();
  const ownerDraft = DocumentDraft.safeParse(draft?.fields);
  const ownerId = ownerDraft.success
    ? (ownerDraft.data.ownerId.value ??
      draft?.classification.objectId.value ??
      draft?.classification.personId.value)
    : null;
  const owner =
    chosenOwner ??
    (ownerId && owners.objects.some((o) => o.id === ownerId)
      ? `object:${ownerId}`
      : ownerId && owners.members.some((m) => m.id === ownerId)
        ? `member:${ownerId}`
        : `member:${me.id}`);
  const [documentType, setDocumentType] = useState(
    ownerDraft.success ? ownerDraft.data.type.value : EMPTY_DOCUMENT.type,
  );
  const [chosenVisibility, setDocumentVisibility] = useState<Visibility | null>(null);
  const docOptions = documentVisibilityOptions(
    creatableVisibilities(viewerOf(me), row.houseId, 'document'),
    ownerFacts(owners, owner),
    documentType,
  );
  const docVisibility =
    chosenVisibility && docOptions.includes(chosenVisibility)
      ? chosenVisibility
      : defaultDocumentVisibility('personal', ownerFacts(owners, owner), docOptions);
  const docPlacement =
    docVisibility === 'personal' || !row.houseId
      ? { spaceId: me.personalSpaceId ?? '' }
      : { spaceId: row.houseId, audience: docVisibility };
  const extra = useRef(new Map<number, ReviewTarget[]>());
  async function finish(target: ReviewTarget) {
    created.current = target;
    const targets: ReviewTarget[] = [target, ...(extra.current.get(-1) ?? [])];
    for (const [index, entry] of (draft?.additional ?? []).entries()) {
      if (excluded.includes(index + 1)) continue;
      let saved = extra.current.get(index);
      if (!saved) {
        saved = await createEntry(entry, index + 1);
        extra.current.set(index, saved);
      }
      targets.push(...saved);
    }
    const result = await inboxAction(row.id, 'resolve', { targets, attachSource });
    await client.invalidateQueries({ queryKey: ['inbox', me.id] });
    navigate('/more/inbox', {
      replace: true,
      state: { attachmentMessage: attachmentMessage(row.files.length, result.attachedTo) },
    });
  }
  async function save(factory: () => Promise<ReviewTarget>) {
    await action.run(async () => finish(created.current ?? (await factory())));
  }
  async function suggested() {
    if (!draft) return;
    if (unreviewed || (!selected.length && savedIndices.length !== entries.length)) return;
    await action.run(async () => {
      for (const { entry, index } of selected) {
        let saved = extra.current.get(index - 1);
        if (!saved) {
          saved = await createEntry(entry, index);
          extra.current.set(index - 1, saved);
          setLocked(true);
          setSavedIndices((current) => [...current, index]);
        }
      }
      if (extra.current.size < entries.length) {
        setExcluded([]);
        return;
      }
      const allTargets = [...extra.current.values()].flat();
      const result = await inboxAction(row.id, 'resolve', { targets: allTargets, attachSource });
      await client.invalidateQueries({ queryKey: ['inbox', me.id] });
      navigate('/more/inbox', {
        state: { attachmentMessage: attachmentMessage(row.files.length, result.attachedTo) },
      });
    });
  }

  async function createEntry(
    entry: Pick<InboxDraft, 'classification' | 'fields'>,
    entryIndex: number,
  ): Promise<ReviewTarget[]> {
    const { fields, classification } = entry;
    const kind = classification.kind;
    if (kind === 'task') {
      const f = DraftSchemas.task.parse(fields);
      const body = createBody(
        {
          ...TaskFields.parse({
            title: f.title.value,
            planOn: f.date.value,
            planTime: f.time.value,
          }),
          assigneeId: f.assigneeId.value ?? me.id,
          objectId: classification.objectId.value ?? f.objectId.value ?? '',
          householdId: row.houseId ?? '',
          visibility: places[entryIndex] ?? 'personal',
          repeatScope: 'this',
        },
        me.personalSpaceId,
      );
      return [
        {
          type: 'task',
          id: (
            await mutateTask('tasks', {
              ...body,
              idempotencyKey: await inboxOperationKey(row.id, 'task', entryIndex),
            })
          ).id,
        },
      ];
    }
    if (kind === 'shopping') {
      const targets: ReviewTarget[] = [];
      for (const [index, f] of DraftSchemas.shopping.parse(fields).entries()) {
        const result = await createShopping({
          title: f.title.value,
          quantity: f.quantity.value,
          placement:
            places[entryIndex] && places[entryIndex] !== 'personal' && row.houseId
              ? { spaceId: row.houseId, audience: places[entryIndex] }
              : { spaceId: me.personalSpaceId ?? '' },
          idempotencyKey: await inboxOperationKey(row.id, 'shopping', entryIndex * 1000 + index),
        });
        targets.push({ type: 'shopping_item', id: result.id });
      }
      return targets;
    }
    if (kind === 'note') {
      const f = DraftSchemas.note.parse(fields);
      return [
        {
          type: 'note',
          id: (
            await createNote(
              {
                title: f.title.value,
                body: f.body.value,
                pinned: false,
                checklist: [],
                idempotencyKey: await inboxOperationKey(row.id, 'note', entryIndex),
              },
              places[entryIndex] && places[entryIndex] !== 'personal' && row.houseId
                ? { spaceId: row.houseId, audience: places[entryIndex] }
                : { spaceId: me.personalSpaceId ?? '' },
            )
          ).id,
        },
      ];
    }
    const f = DocumentDraft.parse(fields);
    const id =
      f.ownerId.value ?? classification.objectId.value ?? classification.personId.value ?? me.id;
    const ownerKind = owners.objects.some((o) => o.id === id) ? 'object' : 'member';
    return [
      {
        type: 'document',
        id: (
          await createDocument({
            title: f.title.value,
            data: DocumentData.parse({
              type: f.type.value,
              issuedOn: f.issuedOn.value,
              expiresOn: f.expiresOn.value,
              note: f.fields.map((field) => `${field.name}: ${field.value.value}`).join('\n'),
            }),
            owner: { kind: ownerKind, id },
            placement:
              places[entryIndex] && places[entryIndex] !== 'personal' && row.houseId
                ? { spaceId: row.houseId, audience: places[entryIndex] }
                : docPlacement,
          })
        ).id,
      },
    ];
  }
  return {
    action,
    created,
    draft,
    entries,
    selected,
    unreviewed,
    places,
    setPlaces,
    savedIndices,
    locked,
    editing,
    setEditing,
    excluded,
    setExcluded,
    confirmed,
    setConfirmed,
    changeField,
    kind,
    owners,
    owner,
    setOwner,
    setDocumentType,
    docOptions,
    docVisibility,
    setDocumentVisibility,
    docPlacement,
    finish,
    save,
    suggested,
  };
}

export type InboxReviewState = ReturnType<typeof useInboxReview>;
