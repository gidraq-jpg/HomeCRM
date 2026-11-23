import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useParams } from 'react-router';
import { useAiStatus } from '../ai/AiCapture.tsx';
import { useAiConsent } from '../ai/consent.tsx';
import { ApiError } from '../auth/api.ts';
import { Notice } from '../auth/components.tsx';
import { fileUrl } from '../files/api.ts';
import { useHousehold } from '../household/HouseholdContext.tsx';
import { useTaskMembers } from '../tasks/options.tsx';
import { useNavigate } from '../ui/navigation.tsx';
import { Sheet } from '../ui/Sheet.tsx';
import { StudioPage } from '../ui/StudioPage.tsx';
import { type InboxItem, KIND_LABELS, STATUS_LABELS, useInbox } from './api.ts';
import { InboxEditForm } from './InboxEditForm.tsx';
import { InboxReviewOverview } from './InboxReviewOverview.tsx';
import { InboxScreen } from './InboxScreen.tsx';
import { parseCapturedInbox } from './parse.ts';
import { pdfMessages } from './pdf-messages.ts';
import { useInboxReview } from './useInboxReview.ts';

const BACK = { to: '/more/inbox', label: 'Входящие' };

export function InboxReview() {
  const navigate = useNavigate();
  return (
    <>
      <InboxScreen />
      <Sheet
        open
        historyEntry={false}
        title="Черновик"
        description="Проверьте запись перед сохранением."
        onOpenChange={(open) => {
          if (!open) {
            if ((history.state?.idx ?? 0) > 0) void navigate(-1);
            else void navigate('/more/inbox', { replace: true });
          }
        }}
      >
        <InboxReviewContent />
      </Sheet>
    </>
  );
}
function InboxReviewContent() {
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
  const client = useQueryClient();
  const members = useTaskMembers(row.houseId);
  const status = useAiStatus(row.houseId);
  const consent = useAiConsent(row.houseId, status.data?.provider);
  const review = useInboxReview(row, editKind, attachSource);
  const { action, created, draft, kind, locked } = review;
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
                  try {
                    await parseCapturedInbox(row.id, `v4:${status.data?.provider}`);
                  } catch (error) {
                    if (!(error instanceof ApiError && error.code === 'AI_PRIVATE_DOCUMENT'))
                      throw error;
                  } finally {
                    await client.invalidateQueries({ queryKey: ['inbox', me.id] });
                  }
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
            void review.save(async () => created.current as NonNullable<typeof created.current>)
          }
        >
          Повторить перенос файлов
        </button>
      ) : null}
      {!editKind ? (
        <InboxReviewOverview row={row} review={review} members={members.data} />
      ) : (
        <InboxEditForm row={row} review={review} />
      )}
    </StudioPage>
  );
}
