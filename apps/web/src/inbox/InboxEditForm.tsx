import { DocumentDraft, DraftSchemas, TaskFields } from '@homecrm/shared';
import { useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { VisibilityPicker } from '../access/VisibilityPicker.tsx';
import { apiRequest } from '../auth/api.ts';
import { Notice } from '../auth/components.tsx';
import { parseOwnerKey } from '../documents/access.ts';
import { createDocument } from '../documents/api.ts';
import { DocumentForm } from '../documents/DocumentForm.tsx';
import { EMPTY_DOCUMENT, type DocumentDraft as FormDocument } from '../documents/form.ts';
import { OwnerSelect } from '../documents/owners.tsx';
import { useHousehold } from '../household/HouseholdContext.tsx';
import { createNote } from '../notes/api.ts';
import { EMPTY_DRAFT, NoteForm } from '../notes/NoteForm.tsx';
import { EMPTY_DRAFT as EMPTY_OBJECT, ObjectForm } from '../objects/ObjectForm.tsx';
import { ShoppingEditor } from '../shopping/ShoppingScreen.tsx';
import { mutateTask } from '../tasks/api.ts';
import { createBody } from '../tasks/NewTaskScreen.tsx';
import { TaskForm } from '../tasks/TaskForm.tsx';
import { useNavigate } from '../ui/navigation.tsx';
import { type InboxItem, inboxOperationKey } from './api.ts';
import { InboxUtilities } from './InboxUtilities.tsx';
import type { InboxReviewState } from './useInboxReview.ts';

/** Форма записи выбранного вида, заполненная из черновика входящего. */
export function InboxEditForm({ row, review }: { row: InboxItem; review: InboxReviewState }) {
  const { me } = useHousehold();
  const navigate = useNavigate();
  const client = useQueryClient();
  const { action, draft, kind, owners, owner, save, finish } = review;
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
  return kind === 'task' ? (
    <TaskForm
      initial={{
        ...TaskFields.parse({ title: 'Новое дело' }),
        title: task?.success ? task.data.title.value : row.status === 'identity' ? '' : row.text,
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
      owner={<OwnerSelect choices={owners} value={owner} onChange={review.setOwner} />}
      onTypeChange={review.setDocumentType}
      onCancel={() => navigate(`/more/inbox/${row.id}`)}
      onSubmit={(value) => {
        void save(async () => ({
          type: 'document',
          id: (
            await createDocument({
              title: value.title,
              data: value.data,
              owner: parseOwnerKey(owner),
              placement: review.docPlacement,
            })
          ).id,
        }));
      }}
    >
      <VisibilityPicker
        value={review.docVisibility}
        options={review.docOptions}
        onChange={review.setDocumentVisibility}
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
  );
}
