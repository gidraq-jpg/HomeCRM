import { INBOX_KINDS } from '@homecrm/shared';
import { useQueryClient } from '@tanstack/react-query';
import { VISIBILITY_LABELS } from '../access/visibility.ts';
import { useHousehold } from '../household/HouseholdContext.tsx';
import type { useTaskMembers } from '../tasks/options.tsx';
import { Link, useNavigate } from '../ui/navigation.tsx';
import { type InboxItem, inboxAction, KIND_LABELS } from './api.ts';
import { InboxDraftEntry } from './InboxDraftEntry.tsx';
import { InboxIdentity } from './InboxIdentity.tsx';
import type { InboxReviewState } from './useInboxReview.ts';

/** Разбор без выбранного вида: текст или удостоверение, черновики и действия с входящим. */
export function InboxReviewOverview({
  row,
  review,
  members,
}: {
  row: InboxItem;
  review: InboxReviewState;
  members: ReturnType<typeof useTaskMembers>['data'];
}) {
  const { me } = useHousehold();
  const navigate = useNavigate();
  const client = useQueryClient();
  const { action, draft, entries, selected, savedIndices, kind } = review;
  return (
    <>
      {row.status !== 'identity' ? (
        <p className="inbox-text">{row.text}</p>
      ) : (
        <InboxIdentity
          row={row}
          refresh={() => client.invalidateQueries({ queryKey: ['inbox', me.id] })}
        />
      )}
      {draft ? (
        <>
          <fieldset disabled={action.pending} className="ai-drafts">
            {entries.map((entry, index) => (
              <InboxDraftEntry
                key={index === 0 ? 'main' : String(index)}
                row={row}
                review={review}
                entry={entry}
                index={index}
                members={members}
              />
            ))}
          </fieldset>
          {['document', 'medical'].includes(kind) ? (
            <p>
              Новый документ: {VISIBILITY_LABELS[review.docVisibility]}. Файлы будут доступны тем же
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
              review.unreviewed ||
              (!selected.length && savedIndices.length !== entries.length) ||
              !!review.created.current ||
              (['document', 'medical'].includes(kind) && !review.owners.ready)
            }
            onClick={() => void review.suggested()}
          >
            {savedIndices.length === entries.length
              ? 'Завершить перенос файлов'
              : `Сохранить все (${selected.length})`}
          </button>
        ) : null}
        {!draft && row.status !== 'identity' ? (
          <Link className="btn btn--secondary" to={`/more/inbox/${row.id}/edit/${kind}`}>
            Изменить
          </Link>
        ) : null}
        <button
          className="btn btn--secondary"
          type="button"
          disabled={action.pending || review.locked || !!review.created.current}
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
          disabled={review.locked || action.pending}
          id="inbox-type"
          className="select"
          value=""
          onChange={(event) => {
            if (event.target.value) navigate(`/more/inbox/${row.id}/edit/${event.target.value}`);
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
  );
}
