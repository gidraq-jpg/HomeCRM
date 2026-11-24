import type { InboxDraft } from '@homecrm/shared';
import { VisibilityPicker } from '../access/VisibilityPicker.tsx';
import { CompactDraft } from '../ai/CompactDraft.tsx';
import { needsReview } from '../ai/compact.ts';
import { Notice } from '../auth/components.tsx';
import { useHousehold } from '../household/HouseholdContext.tsx';
import { creatableVisibilities, viewerOf } from '../notes/abilities.ts';
import { RecordPicker, type useTaskMembers } from '../tasks/options.tsx';
import { Sheet } from '../ui/Sheet.tsx';
import { type InboxItem, KIND_LABELS } from './api.ts';
import { InboxUtilities } from './InboxUtilities.tsx';
import {
  editableFields,
  fieldsOf,
  inputTypeOf,
  placeLabel,
  recordTypeOf,
} from './review-fields.ts';
import type { InboxReviewState } from './useInboxReview.ts';

type Members = ReturnType<typeof useTaskMembers>['data'];
type Entry = Pick<InboxDraft, 'classification' | 'fields'>;

/** Один черновик разбора: краткий вид с выбором и лист правки его полей. */
export function InboxDraftEntry({
  row,
  review,
  entry,
  index,
  members,
}: {
  row: InboxItem;
  review: InboxReviewState;
  entry: Entry;
  index: number;
  members: Members;
}) {
  const { me } = useHousehold();
  const { places, savedIndices, excluded, confirmed, editing, setEditing, setExcluded } = review;
  const fields = fieldsOf(entry.fields);
  return (
    <section className="ai-draft">
      <fieldset disabled={savedIndices.includes(index)} className="ai-drafts">
        <CompactDraft
          assignee={
            entry.classification.kind === 'task'
              ? (members?.find(
                  (m) => m.accountId === fields.find((f) => f.key === 'assigneeId')?.value,
                )?.displayName ?? me.displayName)
              : undefined
          }
          kind={entry.classification.kind}
          title={
            fields.find((f) => f.key === 'title' || f.key.endsWith(':title'))?.value ??
            KIND_LABELS[entry.classification.kind]
          }
          fields={entry.fields}
          place={placeLabel(places[index])}
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
          {index === 0 && (review.kind === 'meter' || review.kind === 'receipt') ? (
            review.entries.some(
              (entry, related) =>
                related > 0 &&
                (excluded.includes(related) ||
                  (needsReview(entry) && !confirmed.includes(related))),
            ) ? (
              <Notice>
                Сначала проверьте и отметьте сопутствующие черновики. Исходный файл переносится
                вместе со всей группой.
              </Notice>
            ) : (
              <InboxUtilities
                row={{ ...row, draft: review.draft }}
                kind={review.kind}
                onCreated={review.finish}
              />
            )
          ) : (
            <DraftFieldsEditor
              row={row}
              review={review}
              entry={entry}
              index={index}
              members={members}
            />
          )}
        </Sheet>
      ) : null}
    </section>
  );
}

/** Правка полей черновика, места новой записи и подтверждение проверки. */
function DraftFieldsEditor({
  row,
  review,
  entry,
  index,
  members,
}: {
  row: InboxItem;
  review: InboxReviewState;
  entry: Entry;
  index: number;
  members: Members;
}) {
  const { me } = useHousehold();
  const { changeField } = review;
  return (
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
              onChange={(event) => changeField(index, field.key, event.target.value)}
            >
              <option value="">Я ({me.displayName})</option>
              {(members ?? [])
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
              type={inputTypeOf(field.key)}
              value={field.value}
              onChange={(event) => changeField(index, field.key, event.target.value)}
            />
          )}
        </div>
      ))}
      <VisibilityPicker
        value={review.places[index] ?? 'personal'}
        options={creatableVisibilities(
          viewerOf(me),
          row.houseId,
          recordTypeOf(entry.classification.kind),
        )}
        onChange={(value) => review.setPlaces((current) => ({ ...current, [index]: value }))}
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
          review.setConfirmed((current) => [...current, index]);
          review.setEditing(null);
        }}
      >
        Готово
      </button>
    </>
  );
}
