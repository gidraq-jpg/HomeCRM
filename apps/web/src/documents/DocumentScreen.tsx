import {
  ArrowCounterClockwise,
  ArrowsClockwise,
  PencilSimple,
  ShareNetwork,
  Trash,
} from '@phosphor-icons/react';
import { useId, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { AccessBadge } from '../access/AccessBadge.tsx';
import { Notice, useAction } from '../auth/components.tsx';
import { formatDay, formatMoment } from '../auth/dates.ts';
import { FilesSection } from '../files/FilesSection.tsx';
import { useHousehold } from '../household/HouseholdContext.tsx';
import { useMembers } from '../household/queries.ts';
import { noteAbilities, viewerOf, visibilityOf } from '../notes/abilities.ts';
import { assigneeChoices } from '../objects/abilities.ts';
import { usePersonName } from '../objects/context.ts';
import { todayIn } from '../objects/dates.ts';
import { Page } from '../ui/Page.tsx';
import { Status } from '../ui/Row.tsx';
import { useToast } from '../ui/Toast.tsx';
import {
  changeAssignee,
  type DocumentCard,
  patchDocument,
  renewDocument,
  restoreDocument,
  shareDocument,
  trashDocument,
} from './api.ts';
import { DocumentError } from './components.tsx';
import { DocumentForm, type DocumentValues } from './DocumentForm.tsx';
import { DocumentVersions, InvalidNotice } from './DocumentVersions.tsx';
import { ExpiryNote } from './ExpiryNote.tsx';
import { draftFrom, renewalDraft } from './form.ts';
import { DOCUMENT_LABELS, dateLabel, expiryInfo, expirySource, seriesAndNumber } from './labels.ts';
import { useDocument, useRefreshDocuments } from './queries.ts';
import { SecretNumber } from './SecretNumber.tsx';
import { WarningsEditor } from './WarningsEditor.tsx';

const BACK = { to: '/documents', label: 'Документы' } as const;
/** Название вкладки одинаковое для всех документов: название и тип в историю браузера не попадают. */
const TAB_TITLE = 'Документ';
const DOCUMENT_TYPE = 'document';

/** Карточка документа (DOC-2, DOC-5, DOC-6): реквизиты, страницы-файлы, версии, «Продлить». */
export function DocumentScreen() {
  const { documentId } = useParams();
  const query = useDocument(documentId);

  if (query.isPending) {
    return (
      <Page title="Документ" back={BACK} documentTitle={TAB_TITLE}>
        <Notice>Загружаем документ…</Notice>
      </Page>
    );
  }
  if (query.isError) {
    return (
      <Page title="Документ" back={BACK} documentTitle={TAB_TITLE}>
        <DocumentError error={query.error} action="load" />
        <button className="text-button" type="button" onClick={() => void query.refetch()}>
          Повторить загрузку документа
        </button>
      </Page>
    );
  }
  // Ключ: при переходе на другую версию секреты и формы начинаются с чистого листа.
  return <DocumentView key={query.data.id} card={query.data} />;
}

function OwnerFact({ card }: { card: DocumentCard }) {
  const nameOf = usePersonName();
  const { owner } = card;
  if (owner === null) return <>Не указан</>;
  if (owner.kind === 'member') return <>{nameOf(owner.id)}</>;
  if (owner.kind === 'object')
    return <Link to={`/home/${owner.id}`}>{card.objectTitle ?? 'Объект: открыть'}</Link>;
  return (
    <Link to={`/people/contacts/${owner.id}`}>{card.ownerContactTitle ?? 'Контакт: открыть'}</Link>
  );
}

function DocumentView({ card }: { card: DocumentCard }) {
  const { me, householdId } = useHousehold();
  const navigate = useNavigate();
  const toast = useToast();
  const refresh = useRefreshDocuments();
  const members = useMembers();
  const nameOf = usePersonName();
  const quick = useAction();
  const save = useAction();
  const [mode, setMode] = useState<'view' | 'edit' | 'renew'>('view');
  const [assignee, setAssignee] = useState<string | null>(null);
  const assigneeId = useId();

  const viewer = viewerOf(me);
  const abilities = noteAbilities(viewer, card, householdId, DOCUMENT_TYPE);
  const visibility = visibilityOf(card);
  const valid = card.status === 'valid';
  const trashed = card.deletedAt !== null;
  const today = todayIn(me.timeZone);
  const info = expiryInfo(card.data, valid, today, card.expiryRule);
  const source = expirySource(card.data, card.expiryRule);
  const canChange = abilities.edit && valid && !trashed;
  const candidates = assigneeChoices(viewer, card, members.data ?? []);
  const secret = seriesAndNumber(card.data);

  function trash() {
    void quick.run(async () => {
      await trashDocument(card.id);
      await refresh();
      navigate('/documents');
      toast.show(
        abilities.restore
          ? {
              message: 'Документ в корзине',
              detail: 'Хранится 30 дней',
              action: {
                label: 'Отменить',
                onClick: () => {
                  restoreDocument(card.id)
                    .then(() => refresh())
                    .then(() => toast.show({ message: 'Документ возвращён' }))
                    .catch(() =>
                      toast.show({
                        message: 'Не удалось вернуть документ',
                        detail: 'Откройте «Корзину» в разделе «Ещё» и восстановите его там.',
                      }),
                    );
                },
              },
            }
          : {
              message: 'Документ в корзине',
              detail: 'Вернуть его сможет автор-взрослый или администратор. Хранится 30 дней.',
              durationMs: 10_000,
            },
      );
    });
  }

  function restore() {
    void quick.run(async () => {
      await restoreDocument(card.id);
      await refresh();
      toast.show({ message: 'Документ возвращён', detail: 'Вместе со страницами и версиями.' });
    });
  }

  function share() {
    if (householdId === null) return;
    void quick.run(async () => {
      await shareDocument(card.id, householdId);
      await refresh();
      toast.show({ message: 'Документ виден взрослым', detail: 'Кто видит: Взрослые' });
    });
  }

  function saveEdited(values: DocumentValues) {
    void save.run(async () => {
      await patchDocument(card.id, {
        title: values.title,
        data: values.data,
        expectedUpdatedAt: card.updatedAt,
      });
      if (assignee !== null && assignee !== card.assigneeId) {
        await changeAssignee(card.id, assignee);
      }
      await refresh();
      setMode('view');
      toast.show({ message: 'Документ сохранён' });
    });
  }

  function renew(values: DocumentValues) {
    void save.run(async () => {
      const created = await renewDocument(card.id, {
        title: values.title,
        data: values.data,
        expectedUpdatedAt: card.updatedAt,
      });
      await refresh();
      setMode('view');
      toast.show({
        message: 'Создана новая версия',
        detail: 'Прежняя версия недействительна и осталась в истории.',
      });
      navigate(`/documents/${created.id}`);
    });
  }

  function reload() {
    save.setError(null);
    setMode('view');
    void refresh();
  }

  const eyebrow = `${DOCUMENT_LABELS[card.data.type]} · изменён ${formatMoment(card.updatedAt, me.timeZone)}`;
  const heading = {
    title: card.title,
    documentTitle: TAB_TITLE,
    eyebrow: trashed ? `${eyebrow} · в корзине` : eyebrow,
    back: BACK,
    status: <Status tone={info.tone}>{info.label}</Status>,
  };

  if (mode !== 'view') {
    const renewing = mode === 'renew';
    return (
      <Page {...heading}>
        <DocumentForm
          draft={renewing ? renewalDraft(card.title, card.data) : draftFrom(card.title, card.data)}
          mode={mode}
          submitLabel={renewing ? 'Создать новую версию' : 'Сохранить'}
          pendingLabel={renewing ? 'Создаём…' : 'Сохраняем…'}
          action={renewing ? 'renew' : 'save'}
          state={save}
          onSubmit={renewing ? renew : saveEdited}
          onCancel={() => {
            save.setError(null);
            setMode('view');
          }}
          onReload={reload}
        >
          {!renewing && candidates.length > 1 ? (
            <div className="field">
              <label className="field__label" htmlFor={assigneeId}>
                Ответственный за продление
              </label>
              <select
                id={assigneeId}
                className="select"
                value={assignee ?? card.assigneeId ?? ''}
                onChange={(event) => setAssignee(event.target.value)}
              >
                {card.assigneeId === null ? <option value="">Не назначен</option> : null}
                {candidates.map((candidate) => (
                  <option key={candidate.id} value={candidate.id}>
                    {candidate.name}
                  </option>
                ))}
              </select>
            </div>
          ) : null}
        </DocumentForm>
      </Page>
    );
  }

  return (
    <Page {...heading}>
      <p className="property-meta">
        <AccessBadge visibility={visibility} showLabel />
      </p>

      {trashed ? (
        <Notice>
          <strong>Документ в корзине.</strong>{' '}
          {abilities.restore
            ? 'Его можно вернуть вместе со страницами и версиями: менять документ в корзине нельзя.'
            : 'Вернуть его сможет автор-взрослый или администратор. Менять документ в корзине нельзя.'}
        </Notice>
      ) : null}
      {valid ? null : <InvalidNotice card={card} />}
      {valid ? <ExpiryNote card={card} source={source} /> : null}

      <dl className="facts">
        <div className="facts__item">
          <dt>Тип</dt>
          <dd>{DOCUMENT_LABELS[card.data.type]}</dd>
        </div>
        <div className="facts__item">
          <dt>Владелец</dt>
          <dd>
            <OwnerFact card={card} />
          </dd>
        </div>
        <div className="facts__item">
          <dt>Серия и номер</dt>
          <dd>
            <SecretNumber value={secret} />
          </dd>
        </div>
        <div className="facts__item">
          <dt>Кем выдан</dt>
          <dd>{card.data.issuedBy === '' ? '—' : card.data.issuedBy}</dd>
        </div>
        <div className="facts__item">
          <dt>Дата выдачи</dt>
          <dd>{dateLabel(card.data.issuedOn)}</dd>
        </div>
        <div className="facts__item">
          <dt>Срок действия</dt>
          <dd>
            {source.kind === 'indefinite'
              ? 'Бессрочно'
              : source.kind === 'explicit'
                ? `до ${dateLabel(source.until)}`
                : source.kind === 'age'
                  ? `до ${dateLabel(source.until)} (вычислен по возрасту)`
                  : source.kind === 'pending'
                    ? 'Вычислится по дате рождения'
                    : 'Не указан'}
          </dd>
        </div>
        {source.kind === 'indefinite' ? null : (
          <div className="facts__item">
            <dt>Предупреждения</dt>
            <dd>
              <WarningsEditor card={card} canChange={canChange} />
            </dd>
          </div>
        )}{' '}
        <div className="facts__item">
          <dt>Ответственный за продление</dt>
          <dd>{nameOf(card.assigneeId ?? card.authorId)}</dd>
        </div>
        <div className="facts__item">
          <dt>Теги</dt>
          <dd>{card.data.tags.length === 0 ? '—' : card.data.tags.join(', ')}</dd>
        </div>
        <div className="facts__item">
          <dt>Создан</dt>
          <dd>{formatDay(card.createdAt, me.timeZone)}</dd>
        </div>
      </dl>

      {card.data.note === '' ? null : (
        <section className="section" aria-labelledby={`note-${card.id}`}>
          <div className="section__head">
            <h2 className="section__title" id={`note-${card.id}`}>
              Заметка
            </h2>
          </div>
          <p className="document-note">{card.data.note}</p>
        </section>
      )}

      <FilesSection
        parent={{ kind: 'document', id: card.id }}
        card={card}
        canAdd={canChange}
        refresh={refresh}
        fullScreenViewer
      />

      <DocumentVersions card={card} />

      <DocumentError error={quick.error} action={trashed ? 'restore' : 'trash'} />
      {!trashed ? (
        <div className="btn-row">
          {canChange ? (
            <>
              <button type="button" className="btn btn--primary" onClick={() => setMode('renew')}>
                <ArrowsClockwise size={20} aria-hidden />
                Продлить
              </button>
              <button type="button" className="btn btn--secondary" onClick={() => setMode('edit')}>
                <PencilSimple size={20} aria-hidden />
                Править
              </button>
            </>
          ) : valid ? (
            <p className="muted">Этот документ могут править только взрослые участники дома.</p>
          ) : null}
          {abilities.trash ? (
            <button
              type="button"
              className="btn btn--secondary"
              disabled={quick.disabled}
              onClick={trash}
            >
              <Trash size={20} aria-hidden />В корзину
            </button>
          ) : null}
        </div>
      ) : abilities.restore ? (
        <div className="btn-row">
          <button
            type="button"
            className="btn btn--primary"
            disabled={quick.disabled}
            onClick={restore}
          >
            <ArrowCounterClockwise size={20} aria-hidden />
            Восстановить
          </button>
        </div>
      ) : null}

      {!trashed && valid && abilities.share && householdId !== null ? (
        <section className="section" aria-labelledby={`share-${card.id}`}>
          <div className="section__head">
            <h2 className="section__title" id={`share-${card.id}`}>
              Кто видит
            </h2>
          </div>
          <p className="muted">
            Сейчас документ видите только вы. Супруги и другие взрослые дома смогут его открыть,
            если поделиться.
          </p>
          <button
            type="button"
            className="btn btn--primary btn--block"
            disabled={quick.disabled}
            onClick={share}
          >
            <ShareNetwork size={20} aria-hidden />
            Поделиться со взрослыми
          </button>
        </section>
      ) : null}
    </Page>
  );
}
