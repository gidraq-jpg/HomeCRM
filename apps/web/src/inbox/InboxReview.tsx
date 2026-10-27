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
import { VisibilityPicker } from '../access/VisibilityPicker.tsx';
import { VISIBILITY_LABELS, type Visibility } from '../access/visibility.ts';
import { useAiStatus } from '../ai/AiCapture.tsx';
import { useAiConsent } from '../ai/consent.tsx';
import { ApiError, apiRequest } from '../auth/api.ts';
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
import { createObject } from '../objects/api.ts';
import { EMPTY_DRAFT as EMPTY_OBJECT, ObjectForm } from '../objects/ObjectForm.tsx';
import { Link, useNavigate } from '../shell/motion.tsx';
import { createShopping } from '../shopping/api.ts';
import { ShoppingEditor } from '../shopping/ShoppingScreen.tsx';
import { mutateTask } from '../tasks/api.ts';
import { createBody } from '../tasks/NewTaskScreen.tsx';
import { TaskForm } from '../tasks/TaskForm.tsx';
import { type DateOnly, formatFullDate, formatRub } from '../ui/format.ts';
import { StudioPage } from '../ui/StudioPage.tsx';
import {
  type InboxItem,
  inboxAction,
  inboxOperationKey,
  KIND_LABELS,
  Ok,
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
export function InboxReview() {
  const { inboxId, editKind } = useParams();
  const query = useInbox(false, true);
  const row = query.data?.find((r) => r.id === inboxId);
  if (!row)
    return (
      <StudioPage title="Входящее" back={BACK}>
        <Notice>{query.isPending ? 'Загружаем…' : 'Элемент недоступен или уже разобран.'}</Notice>
      </StudioPage>
    );
  return <InboxItemReview key={`${row.id}:${editKind ?? ''}`} row={row} editKind={editKind} />;
}
function InboxItemReview({ row, editKind }: { row: InboxItem; editKind: string | undefined }) {
  const { me } = useHousehold();
  const navigate = useNavigate();
  const client = useQueryClient();
  const action = useAction();
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
  const draft = row.draft;
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
  const newObject = useRef<string | null>(null);
  type Target = NonNullable<typeof created.current>;
  const extra = useRef(new Map<number, Target[]>());
  async function finish(target: NonNullable<typeof created.current>) {
    created.current = target;
    const targets: Target[] = [target, ...(extra.current.get(-1) ?? [])];
    for (const [index, entry] of (draft?.additional ?? []).entries()) {
      let saved = extra.current.get(index);
      if (!saved) {
        saved = await createEntry(entry, index + 1);
        extra.current.set(index, saved);
      }
      targets.push(...saved);
    }
    await inboxAction(row.id, 'resolve', { targets });
    await client.invalidateQueries({ queryKey: ['inbox', me.id] });
    navigate('/more/inbox', { replace: true });
  }
  async function save(factory: () => Promise<NonNullable<typeof created.current>>) {
    await action.run(async () => finish(created.current ?? (await factory())));
  }
  async function suggested() {
    if (!draft) return;
    await save(async () => {
      const [first, ...rest] = await createEntry(draft, 0);
      if (!first) throw new ApiError(400, 'INVALID_INPUT');
      extra.current.set(-1, rest);
      return first;
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
          visibility: 'personal',
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
          placement: { spaceId: me.personalSpaceId ?? '' },
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
              { spaceId: me.personalSpaceId ?? '' },
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
            placement: docPlacement,
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
      {draft?.additional.length ? (
        <div>
          <h2>Также сохранится</h2>
          {draft.additional.map((entry, index) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: порядок зафиксирован ответом разбора, строки не переставляются.
            <div key={`${entry.classification.kind}-${index}`}>
              <h3>{KIND_LABELS[entry.classification.kind]}</h3>
              {fieldsOf(entry.fields).map((field) => (
                <p key={field.key}>
                  {field.label}: {field.value}
                  {field.confident ? '' : ' — проверьте'}
                </p>
              ))}
            </div>
          ))}
          {row.files.length ? <p>Файлы перейдут к записи с вложениями.</p> : null}
        </div>
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
          {created.current
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
              <h2>{KIND_LABELS[draft.classification.kind]}</h2>
              <dl className="inbox-fields">
                {fieldsOf(draft.fields).map((field) => (
                  <div key={field.key}>
                    <dt>
                      {field.label}
                      {field.confident ? '' : ' — проверьте'}
                    </dt>
                    <dd>{field.value}</dd>
                  </div>
                ))}
              </dl>
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
                  !!created.current ||
                  (['document', 'medical'].includes(kind) && !owners.ready)
                }
                onClick={() => void suggested()}
              >
                Сохранить как предложено
              </button>
            ) : null}
            <Link className="btn btn--secondary" to={`/more/inbox/${row.id}/edit/${kind}`}>
              {row.status === 'identity' ? 'Заполнить вручную' : 'Изменить'}
            </Link>
            <button
              className="btn btn--secondary"
              type="button"
              disabled={action.pending || !!created.current}
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
              const object = newObject.current
                ? { id: newObject.current }
                : await createObject(
                    {
                      title: value.title,
                      objectType: value.objectType,
                      ...(value.typeData ? { typeData: value.typeData } : {}),
                    },
                    { spaceId: me.personalSpaceId ?? '' },
                  );
              newObject.current = object.id;
              await apiRequest('POST', `inbox/${row.id}/object`, Ok, { id: object.id });
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
      {!editKind && (kind === 'meter' || kind === 'receipt') ? (
        <InboxUtilities row={row} kind={kind} onCreated={finish} />
      ) : null}
    </StudioPage>
  );
}
