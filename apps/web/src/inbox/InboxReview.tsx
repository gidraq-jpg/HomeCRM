import {
  DOCUMENT_LABELS,
  DocumentData,
  DocumentDraft,
  type DocumentType,
  DraftSchemas,
  INBOX_KINDS,
  type InboxDraft,
  type ShoppingDraft,
  TaskFields,
} from '@homecrm/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { useParams } from 'react-router';
import { z } from 'zod';
import { VisibilityPicker } from '../access/VisibilityPicker.tsx';
import { VISIBILITY_LABELS, type Visibility } from '../access/visibility.ts';
import { useAiStatus } from '../ai/AiCapture.tsx';
import { CompactDraft } from '../ai/CompactDraft.tsx';
import { needsReview } from '../ai/compact.ts';
import { useAiConsent } from '../ai/consent.tsx';
import { apiRequest } from '../auth/api.ts';
import { Notice, useAction } from '../auth/components.tsx';
import {
  defaultDocumentVisibility,
  documentVisibilityOptions,
  parseOwnerKey,
} from '../documents/access.ts';
import { createDocument } from '../documents/api.ts';
import { DocumentForm } from '../documents/DocumentForm.tsx';
import { EMPTY_DOCUMENT, type DocumentDraft as FormDocument } from '../documents/form.ts';
import { OwnerSelect, ownerFacts, useOwnerChoices } from '../documents/owners.tsx';
import { fileUrl } from '../files/api.ts';
import { useHousehold } from '../household/HouseholdContext.tsx';
import { creatableVisibilities, viewerOf } from '../notes/abilities.ts';
import { createNote } from '../notes/api.ts';
import { EMPTY_DRAFT, NoteForm } from '../notes/NoteForm.tsx';
import { EMPTY_DRAFT as EMPTY_OBJECT, ObjectForm } from '../objects/ObjectForm.tsx';
import { Link, useNavigate } from '../shell/motion.tsx';
import { createShopping } from '../shopping/api.ts';
import { ShoppingEditor } from '../shopping/ShoppingScreen.tsx';
import { mutateTask } from '../tasks/api.ts';
import { createBody } from '../tasks/NewTaskScreen.tsx';
import { RecordPicker, useTaskMembers } from '../tasks/options.tsx';
import { TaskForm } from '../tasks/TaskForm.tsx';
import { type DateOnly, formatFullDate, formatRub } from '../ui/format.ts';
import { Sheet } from '../ui/Sheet.tsx';
import { StudioPage } from '../ui/StudioPage.tsx';
import {
  type InboxItem,
  inboxAction,
  inboxOperationKey,
  KIND_LABELS,
  STATUS_LABELS,
  useInbox,
} from './api.ts';
import { InboxUtilities } from './InboxUtilities.tsx';
import { parseCapturedInbox } from './parse.ts';
import { pdfMessages } from './pdf-messages.ts';

const BACK = { to: '/more/inbox', label: 'Входящие' };
const labels: Record<string, string> = {
  title: 'Название',
  body: 'Текст',
  date: 'Дата',
  time: 'Время',
  quantity: 'Количество',
  type: 'Тип',
  issuedOn: 'Выдан',
  expiresOn: 'Действует до',
  ownerId: 'Владелец',
  objectId: 'Объект',
  assigneeId: 'Ответственный',
  accountId: 'Лицевой счёт',
  totalCents: 'Сумма',
  period: 'Период',
  dueOn: 'Оплатить до',
  supplier: 'Поставщик',
  personId: 'Человек',
  meterId: 'Счётчик',
};
function fieldsOf(
  fields: InboxDraft['fields'] | ShoppingDraft,
): { key: string; label: string; value: string; confident: boolean }[] {
  if (Array.isArray(fields))
    return fields.flatMap((entry, index) =>
      fieldsOf(entry).map((field) => ({ ...field, key: `${index}:${field.key}` })),
    );
  return Object.entries(fields).flatMap(([key, field]) => {
    if (field && typeof field === 'object' && 'value' in field)
      return [
        {
          key,
          label: labels[key] ?? key,
          value:
            key === 'totalCents' && typeof field.value === 'number'
              ? formatRub(field.value)
              : ['date', 'issuedOn', 'expiresOn', 'dueOn'].includes(key) &&
                  typeof field.value === 'string' &&
                  /^\d{4}-\d{2}-\d{2}$/.test(field.value)
                ? formatFullDate(field.value as DateOnly)
                : key === 'type' &&
                    typeof field.value === 'string' &&
                    field.value in DOCUMENT_LABELS
                  ? DOCUMENT_LABELS[field.value as DocumentType]
                  : String(field.value ?? 'Не указано'),
          confident: field.confident,
        },
      ];
    if (Array.isArray(field))
      return field.map((f, i) =>
        'name' in f
          ? {
              key: `${key}-${i}`,
              label: f.name,
              value: f.value.value,
              confident: f.value.confident,
            }
          : {
              key: `${key}-${i}`,
              label: `Зона ${i + 1}`,
              value: f.value ?? 'Не указано',
              confident: f.confident,
            },
      );
    return [];
  });
}
function editableFields(
  value: unknown,
  prefix = '',
): { key: string; label: string; value: string; confident: boolean }[] {
  if (!value || typeof value !== 'object') return [];
  return Object.entries(value).flatMap(([key, field]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    if (field && typeof field === 'object' && 'value' in field && 'confident' in field)
      return [
        {
          key: path,
          label: labels[key] ?? key,
          value: String(field.value ?? ''),
          confident: !!field.confident,
        },
      ];
    return editableFields(field, path);
  });
}
export function InboxReview() {
  const { inboxId, editKind } = useParams();
  const [attachment, setAttachment] = useState<{ id?: string; value: boolean }>({ value: true });
  const attachSource = attachment.id === inboxId ? attachment.value : true;
  const query = useInbox(false, true);
  const row = query.data?.find((r) => r.id === inboxId);
  if (!row)
    return (
      <StudioPage title="Входящее" back={BACK}>
        <Notice>{query.isPending ? 'Загружаем…' : 'Элемент недоступен или уже разобран.'}</Notice>
      </StudioPage>
    );
  return (
    <InboxItemReview
      key={`${row.id}:${editKind ?? ''}`}
      row={row}
      editKind={editKind}
      attachSource={attachSource}
      setAttachSource={(value) => setAttachment({ id: inboxId, value })}
    />
  );
}
function InboxItemReview({
  row,
  editKind,
  attachSource,
  setAttachSource,
}: {
  row: InboxItem;
  editKind: string | undefined;
  attachSource: boolean;
  setAttachSource: (value: boolean) => void;
}) {
  const { me } = useHousehold();
  const navigate = useNavigate();
  const client = useQueryClient();
  const action = useAction();
  const members = useTaskMembers(row.houseId);
  const status = useAiStatus(row.houseId);
  const consent = useAiConsent(row.houseId, status.data?.provider);
  const created = useRef<{
    type:
      | 'task'
      | 'note'
      | 'document'
      | 'object'
      | 'shopping_item'
      | 'meter_reading'
      | 'utility_charge';
    id: string;
  } | null>(null);
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
    const fields = structuredClone(entry.fields);
    let target: unknown = fields;
    const path = key.split('.');
    const leaf = path.pop();
    for (const part of path) target = (target as Record<string, unknown>)[part];
    if (!leaf || !target || typeof target !== 'object') return;
    const old = (target as Record<string, { value: unknown }>)[leaf];
    if (!old) return;
    (target as Record<string, unknown>)[leaf] = {
      ...old,
      value:
        typeof old.value === 'number'
          ? Number(value)
          : value || (['title', 'body'].includes(leaf) ? '' : null),
      confident: true,
    };
    const next = {
      ...entry,
      fields,
      classification:
        key === 'objectId'
          ? { ...entry.classification, objectId: { value: value || null, confident: true } }
          : entry.classification,
    } as typeof entry;
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
  type Target = NonNullable<typeof created.current>;
  const extra = useRef(new Map<number, Target[]>());
  async function finish(target: NonNullable<typeof created.current>) {
    created.current = target;
    const targets: Target[] = [target, ...(extra.current.get(-1) ?? [])];
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
    const attachedLabels: Record<string, string> = {
      task: 'к делу',
      note: 'к заметке',
      document: 'к документу',
      object: 'к объекту',
      meter_reading: 'к показанию',
      utility_charge: 'к начислению',
    };
    await client.invalidateQueries({ queryKey: ['inbox', me.id] });
    navigate('/more/inbox', {
      replace: true,
      state: {
        attachmentMessage: row.files.length
          ? result.attachedTo?.length
            ? `Исходный файл прикреплён ${result.attachedTo.map((type) => attachedLabels[type]).join(' и ')}.`
            : 'Исходный файл удалён.'
          : '',
      },
    });
  }
  async function save(factory: () => Promise<NonNullable<typeof created.current>>) {
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
      const attachedLabels: Record<string, string> = {
        task: 'к делу',
        note: 'к заметке',
        document: 'к документу',
        object: 'к объекту',
        meter_reading: 'к показанию',
        utility_charge: 'к начислению',
      };
      navigate('/more/inbox', {
        state: {
          attachmentMessage: row.files.length
            ? result.attachedTo?.length
              ? `Исходный файл прикреплён ${result.attachedTo.map((type) => attachedLabels[type]).join(' и ')}.`
              : 'Исходный файл удалён.'
            : '',
        },
      });
    });
  }

  async function createEntry(
    entry: Pick<InboxDraft, 'classification' | 'fields'>,
    entryIndex: number,
  ): Promise<Target[]> {
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
      const targets: Target[] = [];
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
  const doc = draft && DocumentDraft.safeParse(draft.fields);
  const documentInitial: FormDocument = doc?.success
    ? {
        ...EMPTY_DOCUMENT,
        title: doc.data.title.value,
        type: doc.data.type.value,
        issuedOn: doc.data.issuedOn.value ?? '',
        expiresOn: doc.data.expiresOn.value ?? '',
        note: doc.data.fields.map((f) => `${f.name}: ${f.value.value}`).join('\n'),
      }
    : EMPTY_DOCUMENT;
  const task = draft && DraftSchemas.task.safeParse(draft.fields);
  const note = draft && DraftSchemas.note.safeParse(draft.fields);
  return (
    <StudioPage
      form={!!editKind}
      title={
        editKind
          ? kind === 'new-object'
            ? 'Новый объект'
            : `Новая запись: ${KIND_LABELS[kind as keyof typeof KIND_LABELS] ?? kind}`
          : 'Входящее'
      }
      back={BACK}
    >
      <p>{STATUS_LABELS[row.status]}</p>
      {pdfMessages(row.errorCode).map((message) => (
        <Notice key={message}>{message}</Notice>
      ))}
      {status.data?.enabled && ['new', 'error'].includes(row.status) ? (
        <button
          type="button"
          className="btn btn--secondary"
          disabled={action.pending}
          onClick={() =>
            consent.ask(
              () =>
                void action.run(async () => {
                  await parseCapturedInbox(row.id, `v4:${status.data?.provider}`);
                  await client.invalidateQueries({ queryKey: ['inbox', me.id] });
                }),
            )
          }
        >
          Разобрать
        </button>
      ) : null}
      {consent.dialog}
      <p className="muted">Личное · видите только вы</p>
      {row.files.length &&
      kind === 'shopping' &&
      !(draft?.additional ?? []).some((entry) => entry.classification.kind !== 'shopping') ? (
        <Notice>Фото не сохранится</Notice>
      ) : null}
      {row.files.length ? (
        <label className="inbox-attach">
          <input
            type="checkbox"
            checked={attachSource}
            disabled={action.pending || locked || !!created.current}
            onChange={(event) => setAttachSource(event.target.checked)}
          />
          Прикрепить исходный файл
        </label>
      ) : null}
      {row.files.length ? (
        <p>
          {row.files.map((file, i) => (
            <a className="text-button" key={file.id} href={fileUrl(file.id)}>
              Страница {i + 1}{' '}
            </a>
          ))}
        </p>
      ) : null}
      {action.error ? (
        <Notice error>
          {created.current || locked
            ? 'Запись создана. Повторите перенос файлов — повторной записи не будет.'
            : 'Не удалось сохранить. Проверьте поля; исходное осталось во входящих.'}
        </Notice>
      ) : null}
      {created.current ? (
        <button
          className="btn btn--primary"
          type="button"
          onClick={() =>
            void save(async () => created.current as NonNullable<typeof created.current>)
          }
        >
          Повторить перенос файлов
        </button>
      ) : null}
      {!editKind ? (
        <>
          {row.status !== 'identity' ? (
            <p className="inbox-text">{row.text}</p>
          ) : (
            <p>
              Поля не извлекались. Откройте обычную форму и заполните вручную; страницы приложатся
              после сохранения.
            </p>
          )}
          {draft ? (
            <>
              <fieldset disabled={action.pending} className="ai-drafts">
                {entries.map((entry, index) => {
                  const fields = fieldsOf(entry.fields);
                  return (
                    <section className="ai-draft" key={index === 0 ? 'main' : String(index)}>
                      <fieldset disabled={savedIndices.includes(index)} className="ai-drafts">
                        <CompactDraft
                          assignee={
                            entry.classification.kind === 'task'
                              ? (members.data?.find(
                                  (m) =>
                                    m.accountId ===
                                    fields.find((f) => f.key === 'assigneeId')?.value,
                                )?.displayName ?? me.displayName)
                              : undefined
                          }
                          kind={entry.classification.kind}
                          title={
                            fields.find((f) => f.key === 'title' || f.key.endsWith(':title'))
                              ?.value ?? KIND_LABELS[entry.classification.kind]
                          }
                          fields={entry.fields}
                          place={
                            places[index] === 'household'
                              ? 'Семья'
                              : places[index] === 'adults'
                                ? 'Взрослые'
                                : 'Только я'
                          }
                          selected={!excluded.includes(index)}
                          onSelect={(value) =>
                            setExcluded((current) =>
                              value ? current.filter((i) => i !== index) : [...current, index],
                            )
                          }
                          review={
                            needsReview({
                              classification: entry.classification,
                              fields: entry.fields,
                            }) && !confirmed.includes(index)
                          }
                          onEdit={() => setEditing(index)}
                        />
                      </fieldset>
                      {savedIndices.includes(index) ? <p role="status">Уже сохранено</p> : null}
                      {editing === index ? (
                        <Sheet
                          open
                          title="Изменить черновик"
                          description="Проверьте поля перед сохранением."
                          onOpenChange={() => setEditing(null)}
                        >
                          {index === 0 && (kind === 'meter' || kind === 'receipt') ? (
                            <InboxUtilities
                              row={{ ...row, draft }}
                              kind={kind}
                              onCreated={finish}
                            />
                          ) : (
                            <>
                              {editableFields(entry.fields).map((field) => (
                                <div className="field" key={field.key}>
                                  <span>
                                    {field.label}
                                    {field.confident ? '' : ' — проверьте'}
                                  </span>
                                  {field.key === 'objectId' ? (
                                    <RecordPicker
                                      kind="object"
                                      label="Объект"
                                      value={field.value}
                                      onChange={(value) => changeField(index, field.key, value)}
                                    />
                                  ) : field.key === 'assigneeId' ? (
                                    <select
                                      aria-label={field.label}
                                      className="input"
                                      value={field.value}
                                      onChange={(event) =>
                                        changeField(index, field.key, event.target.value)
                                      }
                                    >
                                      <option value="">Я ({me.displayName})</option>
                                      {(members.data ?? [])
                                        .filter((m) => !m.formerMember)
                                        .map((m) => (
                                          <option key={m.accountId} value={m.accountId}>
                                            {m.displayName}
                                          </option>
                                        ))}
                                    </select>
                                  ) : (
                                    <input
                                      aria-label={field.label}
                                      className="input"
                                      type={
                                        ['date', 'issuedOn', 'expiresOn', 'dueOn'].includes(
                                          field.key,
                                        )
                                          ? 'date'
                                          : field.key === 'time'
                                            ? 'time'
                                            : 'text'
                                      }
                                      value={field.value}
                                      onChange={(event) =>
                                        changeField(index, field.key, event.target.value)
                                      }
                                    />
                                  )}
                                </div>
                              ))}
                              <VisibilityPicker
                                value={places[index] ?? 'personal'}
                                options={creatableVisibilities(
                                  viewerOf(me),
                                  row.houseId,
                                  entry.classification.kind === 'shopping'
                                    ? 'shopping_item'
                                    : entry.classification.kind === 'document' ||
                                        entry.classification.kind === 'medical'
                                      ? 'document'
                                      : entry.classification.kind === 'task'
                                        ? 'task'
                                        : 'note',
                                )}
                                onChange={(value) =>
                                  setPlaces((current) => ({ ...current, [index]: value }))
                                }
                              />
                              {editableFields(entry.classification).map((field) => (
                                <p key={field.key}>
                                  {field.label}: {field.value || 'Не указано'}
                                  {field.confident ? '' : ' — проверьте'}
                                </p>
                              ))}
                              <button
                                className="btn btn--primary"
                                type="button"
                                onClick={() => {
                                  setConfirmed((current) => [...current, index]);
                                  setEditing(null);
                                }}
                              >
                                Готово
                              </button>
                            </>
                          )}
                        </Sheet>
                      ) : null}
                    </section>
                  );
                })}
              </fieldset>
              {['document', 'medical'].includes(kind) ? (
                <p>
                  Новый документ: {VISIBILITY_LABELS[docVisibility]}. Файлы будут доступны тем же
                  людям.
                </p>
              ) : null}
            </>
          ) : null}
          {draft?.classification.newObject ? (
            <div>
              <h2>Новый объект</h2>
              <p>{draft.classification.newObject.title}</p>
              <Link className="btn btn--secondary" to={`/more/inbox/${row.id}/edit/new-object`}>
                Создать объект
              </Link>
            </div>
          ) : null}
          <div className="btn-row">
            {draft && !['meter', 'receipt'].includes(kind) ? (
              <button
                className="btn btn--primary"
                type="button"
                disabled={
                  action.pending ||
                  unreviewed ||
                  (!selected.length && savedIndices.length !== entries.length) ||
                  !!created.current ||
                  (['document', 'medical'].includes(kind) && !owners.ready)
                }
                onClick={() => void suggested()}
              >
                {savedIndices.length === entries.length
                  ? 'Завершить перенос файлов'
                  : `Сохранить все (${selected.length})`}
              </button>
            ) : null}
            {!draft ? (
              <Link className="btn btn--secondary" to={`/more/inbox/${row.id}/edit/${kind}`}>
                {row.status === 'identity' ? 'Заполнить вручную' : 'Изменить'}
              </Link>
            ) : null}
            <button
              className="btn btn--secondary"
              type="button"
              disabled={action.pending || locked || !!created.current}
              onClick={() =>
                void action.run(async () => {
                  await inboxAction(row.id, 'trash');
                  await client.invalidateQueries({ queryKey: ['inbox', me.id] });
                  navigate('/more/inbox');
                })
              }
            >
              Удалить
            </button>
          </div>
          <div className="field">
            <label className="field__label" htmlFor="inbox-type">
              Другой тип
            </label>
            <select
              disabled={locked || action.pending}
              id="inbox-type"
              className="select"
              value=""
              onChange={(event) => {
                if (event.target.value)
                  navigate(`/more/inbox/${row.id}/edit/${event.target.value}`);
              }}
            >
              <option value="">Выберите тип</option>
              {INBOX_KINDS.map((value) => (
                <option key={value} value={value}>
                  {KIND_LABELS[value]}
                </option>
              ))}
            </select>
          </div>
        </>
      ) : kind === 'task' ? (
        <TaskForm
          initial={{
            ...TaskFields.parse({ title: 'Новое дело' }),
            title: task?.success
              ? task.data.title.value
              : row.status === 'identity'
                ? ''
                : row.text,
            planOn: task?.success ? task.data.date.value : null,
            planTime: task?.success ? task.data.time.value : null,
            assigneeId: task?.success ? (task.data.assigneeId.value ?? me.id) : me.id,
            objectId: draft?.classification.objectId.value ?? '',
            householdId: row.houseId ?? '',
            visibility: 'personal',
            repeatScope: 'this',
          }}
          pending={action.pending}
          onCancel={() => navigate(`/more/inbox/${row.id}`)}
          onSubmit={(value) =>
            void save(async () => ({
              type: 'task',
              id: (
                await mutateTask('tasks', {
                  ...createBody(value, me.personalSpaceId),
                  idempotencyKey: await inboxOperationKey(row.id, 'task'),
                })
              ).id,
            }))
          }
        />
      ) : kind === 'note' ? (
        <NoteForm
          draft={{
            ...EMPTY_DRAFT,
            title: note?.success ? note.data.title.value : '',
            body: note?.success ? note.data.body.value : row.status === 'identity' ? '' : row.text,
          }}
          submitLabel="Сохранить"
          pendingLabel="Сохраняем…"
          action="create"
          state={action}
          onCancel={() => navigate(`/more/inbox/${row.id}`)}
          onSubmit={(value) =>
            void save(async () => ({
              type: 'note',
              id: (
                await createNote(
                  { ...value, idempotencyKey: await inboxOperationKey(row.id, 'note') },
                  { spaceId: me.personalSpaceId ?? '' },
                )
              ).id,
            }))
          }
        />
      ) : kind === 'document' || kind === 'medical' ? (
        <DocumentForm
          draft={documentInitial}
          mode="create"
          submitLabel="Сохранить"
          pendingLabel="Сохраняем…"
          action="create"
          state={action}
          owner={<OwnerSelect choices={owners} value={owner} onChange={setOwner} />}
          onTypeChange={setDocumentType}
          onCancel={() => navigate(`/more/inbox/${row.id}`)}
          onSubmit={(value) => {
            void save(async () => ({
              type: 'document',
              id: (
                await createDocument({
                  title: value.title,
                  data: value.data,
                  owner: parseOwnerKey(owner),
                  placement: docPlacement,
                })
              ).id,
            }));
          }}
        >
          <VisibilityPicker
            value={docVisibility}
            options={docOptions}
            onChange={setDocumentVisibility}
          />
        </DocumentForm>
      ) : kind === 'new-object' ? (
        <ObjectForm
          draft={{ ...EMPTY_OBJECT, ...draft?.classification.newObject }}
          mode="create"
          submitLabel="Создать объект"
          pendingLabel="Создаём…"
          state={action}
          action="create"
          onCancel={() => navigate(`/more/inbox/${row.id}`)}
          onSubmit={(value) =>
            void action.run(async () => {
              await apiRequest(
                'POST',
                `inbox/${row.id}/object`,
                z.object({ ok: z.literal(true), id: z.uuid() }),
                {
                  create: {
                    title: value.title,
                    objectType: value.objectType,
                    ...(value.typeData ? { typeData: value.typeData } : {}),
                  },
                },
              );
              await client.invalidateQueries({ queryKey: ['inbox', me.id] });
              navigate(`/more/inbox/${row.id}`);
            })
          }
        />
      ) : kind === 'shopping' ? (
        <ShoppingEditor
          house={null}
          notice={
            row.files.length
              ? draft?.additional.some((entry) => entry.classification.kind !== 'shopping')
                ? 'Файлы перейдут к записи с вложениями.'
                : 'Фото не сохранится'
              : undefined
          }
          initialTitle={
            DraftSchemas.shopping.safeParse(draft?.fields).success
              ? DraftSchemas.shopping.parse(draft?.fields)[0]?.title.value
              : row.text
          }
          initialQuantity={
            DraftSchemas.shopping.safeParse(draft?.fields).success
              ? (DraftSchemas.shopping.parse(draft?.fields)[0]?.quantity.value ?? '')
              : ''
          }
          onClose={() => navigate(`/more/inbox/${row.id}`)}
          onCreated={(id) => finish({ type: 'shopping_item', id })}
          onSaved={async () => {}}
        />
      ) : kind === 'meter' || kind === 'receipt' ? (
        <InboxUtilities row={row} kind={kind} onCreated={finish} />
      ) : (
        <Notice>Выберите тип записи.</Notice>
      )}
    </StudioPage>
  );
}
