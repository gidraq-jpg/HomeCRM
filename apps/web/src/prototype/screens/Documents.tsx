import {
  FileText,
  IdentificationCard,
  Plus,
  ShareNetwork,
  ShieldCheck,
} from '@phosphor-icons/react';
import { type ReactNode, useState } from 'react';
import { Link, useParams } from 'react-router';
import { AccessBadge } from '../../access/AccessBadge.tsx';
import { useScope } from '../../access/ScopeContext.tsx';
import { matchesScope, SCOPE_LABELS } from '../../access/scope.ts';
import { ChipGroup } from '../../ui/ChipGroup.tsx';
import { CopyButton } from '../../ui/CopyButton.tsx';
import { countWord, daysBetween, formatRelativeDays, formatShortDate } from '../../ui/format.ts';
import { Page } from '../../ui/Page.tsx';
import { Row, RowList, Status, type StatusTone } from '../../ui/Row.tsx';
import { useToast } from '../../ui/Toast.tsx';
import { AccessActions } from '../AccessActions.tsx';
import { useAddRequest } from '../add-request.tsx';
import { NotFoundScreen, ScopeEmpty } from '../components.tsx';
import { TODAY } from '../data/index.ts';
import type { DocGroup, DocumentRecord } from '../model.ts';
import { usePrototype, useRecord, useRecords } from '../store.tsx';

const GROUP_ICONS: Readonly<Record<DocGroup, ReactNode>> = {
  identity: <IdentificationCard size={22} aria-hidden />,
  policy: <ShieldCheck size={22} aria-hidden />,
  property: <FileText size={22} aria-hidden />,
  other: <FileText size={22} aria-hidden />,
};

interface Expiry {
  tone: StatusTone;
  text: string;
  /** Дней до окончания; `null` — бессрочно. */
  days: number | null;
}

/** Срок действия словами и цветом, но не только цветом: текст и значок идут вместе. */
export function expiryOf(doc: DocumentRecord): Expiry {
  if (doc.expires === null) return { tone: 'neutral', text: 'Бессрочно', days: null };
  const days = daysBetween(TODAY, doc.expires);
  const date = formatShortDate(doc.expires, TODAY);
  if (days < 0) {
    return { tone: 'danger', text: `Просрочен ${formatRelativeDays(days)} · ${date}`, days };
  }
  if (days <= 90) {
    return { tone: 'warning', text: `Истекает ${formatRelativeDays(days)} · ${date}`, days };
  }
  return { tone: 'ok', text: `Действует до ${date}`, days };
}

type GroupFilter = 'all' | DocGroup;
type DeadlineFilter = 'any' | 'soon' | 'expired';

const GROUP_OPTIONS: readonly { value: GroupFilter; label: string }[] = [
  { value: 'all', label: 'Все' },
  { value: 'identity', label: 'Удостоверения' },
  { value: 'policy', label: 'Полисы' },
  { value: 'property', label: 'Недвижимость' },
  { value: 'other', label: 'Прочие' },
];

function sortKey(doc: DocumentRecord): number {
  // Сначала просроченные и ближайшие, бессрочные — в конце.
  return doc.expires === null ? Number.MAX_SAFE_INTEGER : daysBetween(TODAY, doc.expires);
}

/** Список документов с фильтрами по типу, человеку и сроку (DOC-7); «пространство» — в шапке. */
export function DocumentsScreen() {
  const documents = useRecords('document');
  const requestAdd = useAddRequest();
  const [group, setGroup] = useState<GroupFilter>('all');
  const [owner, setOwner] = useState('');
  const [deadline, setDeadline] = useState<DeadlineFilter>('any');

  const owners = [...new Set(documents.map((doc) => doc.owner))].sort((a, b) =>
    a.localeCompare(b, 'ru'),
  );
  const shown = documents
    .filter((doc) => group === 'all' || doc.group === group)
    .filter((doc) => owner === '' || doc.owner === owner)
    .filter((doc) => {
      const { days } = expiryOf(doc);
      if (deadline === 'soon') return days !== null && days >= 0 && days <= 90;
      if (deadline === 'expired') return days !== null && days < 0;
      return true;
    })
    .sort((a, b) => sortKey(a) - sortKey(b));
  const filtered = group !== 'all' || owner !== '' || deadline !== 'any';

  return (
    <Page
      title="Документы"
      {...(documents.length > 0
        ? { eyebrow: countWord(documents.length, ['документ', 'документа', 'документов']) }
        : {})}
    >
      {documents.length === 0 ? (
        <ScopeEmpty title="Документов пока нет" addKind="document" addLabel="Добавить документ">
          Паспорт, полис, договор: добавьте первый документ, и приложение предупредит, когда
          подойдёт срок.
        </ScopeEmpty>
      ) : (
        <>
          <div className="filters">
            <ChipGroup
              legend="Тип документа"
              value={group}
              options={GROUP_OPTIONS}
              onChange={setGroup}
            />
            <div className="filters__selects">
              <label className="field">
                <span className="field__label">Чей документ</span>
                <select
                  className="select"
                  value={owner}
                  onChange={(event) => setOwner(event.target.value)}
                >
                  <option value="">Все</option>
                  {owners.map((name) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span className="field__label">Срок</span>
                <select
                  className="select"
                  value={deadline}
                  onChange={(event) => setDeadline(event.target.value as DeadlineFilter)}
                >
                  <option value="any">Любой</option>
                  <option value="soon">Истекает в 90 дней</option>
                  <option value="expired">Просрочен</option>
                </select>
              </label>
            </div>
          </div>

          {shown.length > 0 ? (
            <RowList label="Документы">
              {shown.map((doc) => {
                const expiry = expiryOf(doc);
                return (
                  <Row
                    key={doc.id}
                    to={`/documents/${doc.id}`}
                    icon={GROUP_ICONS[doc.group]}
                    title={doc.title}
                    meta={
                      <>
                        {doc.owner}
                        <span className="row__status">
                          <Status tone={expiry.tone}>{expiry.text}</Status>
                        </span>
                      </>
                    }
                    badge={doc.visibility}
                  />
                );
              })}
            </RowList>
          ) : (
            <div className="empty-inline">
              <p className="muted">
                {filtered ? 'По этим фильтрам документов нет.' : 'Документов нет.'}
              </p>
              {filtered ? (
                <button
                  type="button"
                  className="btn btn--secondary"
                  onClick={() => {
                    setGroup('all');
                    setOwner('');
                    setDeadline('any');
                  }}
                >
                  Сбросить фильтры
                </button>
              ) : null}
            </div>
          )}
          <button
            type="button"
            className="btn btn--secondary btn--block list-action"
            onClick={() => requestAdd('document')}
          >
            <Plus size={20} weight="bold" aria-hidden />
            Добавить документ
          </button>
        </>
      )}
    </Page>
  );
}

function formatDate(date: string | undefined): string {
  return date ? formatShortDate(date as `${number}-${number}-${number}`, TODAY) : '—';
}

/** Карточка документа: поля, срок, копирование номера, доступ с подписью (DOC-2, DOC-6, SPACE-6). */
export function DocumentScreen() {
  const { documentId } = useParams();
  const doc = useRecord('document', documentId);
  const { dispatch } = usePrototype();
  const { scope, setScope } = useScope();
  const properties = useRecords('property');
  const toast = useToast();
  if (doc === undefined) return <NotFoundScreen what="Документ не найден" />;

  const expiry = expiryOf(doc);
  const property = properties.find((item) => item.id === doc.propertyId);

  return (
    <Page title={doc.title} eyebrow={doc.docType} back={{ to: '/documents', label: 'Документы' }}>
      <p className="property-meta">
        <Status tone={expiry.tone}>{expiry.text}</Status>
        <AccessBadge visibility={doc.visibility} showLabel />
      </p>

      {doc.visibility === 'personal' ? (
        <section className="card share-card" aria-label="Поделиться документом">
          <p>Документ личный: его видите только вы. Супругу он часто нужен — поделитесь им.</p>
          <button
            type="button"
            className="btn btn--primary btn--block"
            onClick={() => {
              dispatch({ type: 'setVisibility', id: doc.id, visibility: 'adults' });
              const hidden = !matchesScope('adults', scope);
              toast.show({
                message: 'Документ доступен взрослым',
                ...(hidden
                  ? {
                      detail: `Режим «${SCOPE_LABELS[scope]}» скрывает его в списках.`,
                      action: { label: 'Показать всё', onClick: () => setScope('all') },
                      durationMs: 10_000,
                    }
                  : {}),
              });
            }}
          >
            <ShareNetwork size={20} aria-hidden />
            Поделиться со взрослыми
          </button>
        </section>
      ) : null}

      <dl className="facts">
        <div className="facts__item">
          <dt>Чей</dt>
          <dd>{doc.owner}</dd>
        </div>
        {doc.number ? (
          <div className="facts__item">
            <dt>Номер</dt>
            <dd>
              <span className="mono">{doc.number}</span>
              <CopyButton value={doc.number} what="номер документа" />
            </dd>
          </div>
        ) : null}
        {doc.issuedBy ? (
          <div className="facts__item">
            <dt>Кем выдан</dt>
            <dd>{doc.issuedBy}</dd>
          </div>
        ) : null}
        <div className="facts__item">
          <dt>Дата выдачи</dt>
          <dd>{formatDate(doc.issued)}</dd>
        </div>
        <div className="facts__item">
          <dt>Срок действия</dt>
          <dd>
            {doc.expires === null ? 'Бессрочно' : `до ${formatShortDate(doc.expires, TODAY)}`}
          </dd>
        </div>
        <div className="facts__item">
          <dt>Сканы</dt>
          <dd>{doc.files} стр.</dd>
        </div>
        {property ? (
          <div className="facts__item">
            <dt>Связан с</dt>
            <dd>
              <Link to={`/home/${property.id}`}>{property.title}</Link>
            </dd>
          </div>
        ) : null}
      </dl>

      <div className="btn-row">
        <button
          type="button"
          className="btn btn--secondary"
          onClick={() =>
            toast.show({
              message: 'Продление создаёт новую версию',
              detail:
                'Старая останется в истории со статусом «недействителен». В прототипе не работает.',
            })
          }
        >
          Продлить
        </button>
      </div>

      <AccessActions id={doc.id} visibility={doc.visibility} what="документ" />
    </Page>
  );
}
