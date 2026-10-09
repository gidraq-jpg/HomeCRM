import { Link } from 'react-router';
import { Notice } from '../auth/components.tsx';
import { formatDay } from '../auth/dates.ts';
import { useHousehold } from '../household/HouseholdContext.tsx';
import { todayIn } from '../objects/dates.ts';
import { Section } from '../ui/Page.tsx';
import { Status } from '../ui/Row.tsx';
import type { DocumentCard } from './api.ts';
import { DocumentError } from './components.tsx';
import { dateLabel, expiryInfo, versionCount } from './labels.ts';
import { useVersions } from './queries.ts';

/**
 * История версий (DOC-5): каждое продление создаёт новую карточку, прежняя остаётся со статусом
 * «недействителен». Показывается, когда у документа больше одной видимой версии.
 */
export function DocumentVersions({ card }: { card: DocumentCard }) {
  const { me } = useHousehold();
  const query = useVersions(card.id);
  const today = todayIn(me.timeZone);

  if (query.isError) {
    return (
      <Section title="Версии">
        <DocumentError error={query.error} action="load" />
        <button className="text-button" type="button" onClick={() => void query.refetch()}>
          Повторить загрузку версий
        </button>
      </Section>
    );
  }
  const versions = [...(query.data ?? [])].sort(
    (a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id),
  );
  if (query.isPending || versions.length < 2) return null;

  return (
    <Section title="Версии" aside={<span className="muted">{versionCount(versions.length)}</span>}>
      <ul className="version-list" aria-label="Версии документа">
        {versions.map((version) => {
          const current = version.id === card.id;
          const valid = version.status === 'valid';
          const info = expiryInfo(version.data, valid, today);
          const period = version.data.indefinite
            ? 'бессрочно'
            : [
                version.data.issuedOn ? `выдан ${dateLabel(version.data.issuedOn)}` : null,
                version.data.expiresOn ? `до ${dateLabel(version.data.expiresOn)}` : null,
              ]
                .filter((part) => part !== null)
                .join(', ') || 'даты не указаны';
          return (
            <li key={version.id} className="version">
              <div className="version__head">
                <Status tone={valid ? 'ok' : 'neutral'}>
                  {valid ? 'Действителен' : 'Недействителен'}
                </Status>
                {current ? <strong>Эта версия</strong> : null}
              </div>
              <p className="version__meta">
                {period} · создана {formatDay(version.createdAt, me.timeZone)}
                {valid ? ` · ${info.label}` : ''}
              </p>
              {current ? null : (
                <Link
                  className="text-button"
                  to={`/documents/${version.id}`}
                  aria-label={`Открыть версию от ${formatDay(version.createdAt, me.timeZone)}`}
                >
                  Открыть версию
                </Link>
              )}
            </li>
          );
        })}
      </ul>
    </Section>
  );
}

/** Подсказка в карточке недействительной версии: где искать действующую. */
export function InvalidNotice({ card }: { card: DocumentCard }) {
  const query = useVersions(card.id, card.status === 'invalid');
  const valid = (query.data ?? []).find((version) => version.status === 'valid');
  return (
    <Notice>
      <strong>Недействителен.</strong> Документ продлили, эта версия осталась в истории: её
      реквизиты не меняются.{' '}
      {valid ? (
        <Link className="text-button" to={`/documents/${valid.id}`}>
          Открыть действующую версию
        </Link>
      ) : null}
    </Notice>
  );
}
