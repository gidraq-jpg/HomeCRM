import { ChatCircleText, MapPin, Phone } from '@phosphor-icons/react';
import { CopyButton } from '../ui/CopyButton.tsx';
import { EXTERNAL_LINK } from '../ui/link.ts';
import { Status } from '../ui/Row.tsx';
import { mapHref, type PhoneLine, phoneLines, primaryMessage, primaryPhone } from './labels.ts';
import type { ContactActions } from './schema.ts';

// Общие части карточек людей и организаций: быстрые действия (CONT-5) и список телефонов.
// Ссылки `tel:`, `mailto:` и мессенджеров готовит сервер (поле `actions` ответа).

interface PhoneData {
  number: string;
  label: string;
  emergency: boolean;
}

interface QuickActionsProps {
  phones: readonly PhoneData[];
  actions: ContactActions;
}

/** «Позвонить», «Написать», «На карте»: крупные кнопки, только те, для которых есть данные. */
export function QuickActions({ phones, actions }: QuickActionsProps) {
  const call = primaryPhone(phoneLines(phones, actions));
  const write = primaryMessage(actions);
  const map = actions.mapAddress;
  if (call === null && write === null && map === null) return null;
  return (
    <nav className="quick-actions" aria-label="Быстрые действия">
      {call?.href ? (
        <a
          className="btn btn--primary"
          href={call.href}
          aria-label={call.label === '' ? 'Позвонить' : `Позвонить: ${call.label}`}
        >
          <Phone size={22} aria-hidden />
          Позвонить
        </a>
      ) : null}
      {write ? (
        <a
          className="btn btn--secondary"
          href={write.href}
          {...(write.href.startsWith('mailto:') ? {} : EXTERNAL_LINK)}
        >
          <ChatCircleText size={22} aria-hidden />
          Написать
        </a>
      ) : null}
      {map === null ? null : (
        <a className="btn btn--secondary" href={mapHref(map)} {...EXTERNAL_LINK}>
          <MapPin size={22} aria-hidden />
          На карте
        </a>
      )}
    </nav>
  );
}

/** Телефоны карточки: номер, подпись, «Аварийный», «Позвонить» и копирование. */
export function PhoneRows({
  phones,
  actions,
}: {
  phones: readonly PhoneData[];
  actions: ContactActions;
}) {
  if (phones.length === 0) {
    return <p className="muted">Телефонов пока нет.</p>;
  }
  // У телефона нет собственного идентификатора: порядок в списке и номер различают строки.
  const rows = phoneLines(phones, actions).map((line, position) => ({
    line,
    key: `${position}-${line.number}`,
  }));
  return (
    <ul className="phone-list" aria-label="Телефоны">
      {rows.map(({ line, key }) => (
        <PhoneRow key={key} line={line} />
      ))}
    </ul>
  );
}

function PhoneRow({ line }: { line: PhoneLine }) {
  return (
    <li className="phone-item">
      <div className="phone-item__main">
        <span className="phone-item__number mono">{line.number}</span>
        {line.label === '' ? null : <span className="phone-item__label">{line.label}</span>}
        {line.emergency ? <Status tone="danger">Аварийный</Status> : null}
      </div>
      <div className="phone-item__actions">
        {line.href === null ? null : (
          <a
            className="btn btn--secondary"
            href={line.href}
            aria-label={`Позвонить: ${line.label === '' ? line.number : line.label}`}
          >
            <Phone size={20} aria-hidden />
            Позвонить
          </a>
        )}
        <CopyButton value={line.number} what="номер телефона" />
      </div>
    </li>
  );
}
