import { ROLE_LABELS } from '@homecrm/shared';
import { Buildings, MapPin, Phone, Plus, ThumbsUp, User } from '@phosphor-icons/react';
import { Link, useParams } from 'react-router';
import { AccessBadge } from '../../access/AccessBadge.tsx';
import { useScope } from '../../access/ScopeContext.tsx';
import { CopyButton } from '../../ui/CopyButton.tsx';
import { formatRub, formatShortDate, toTelHref } from '../../ui/format.ts';
import { Page, Section } from '../../ui/Page.tsx';
import { Row, RowList } from '../../ui/Row.tsx';
import { useToast } from '../../ui/Toast.tsx';
import { AccessActions } from '../AccessActions.tsx';
import { useAddRequest } from '../add-request.tsx';
import { NotFoundScreen, ScopeEmpty } from '../components.tsx';
import { ME, PEOPLE, TODAY } from '../data/index.ts';
import type { ContactRecord } from '../model.ts';
import { useAllRecords, useRecord, useRecords } from '../store.tsx';

function contactIcon(contact: ContactRecord) {
  return contact.contactKind === 'organization' ? (
    <Buildings size={22} aria-hidden />
  ) : (
    <User size={22} aria-hidden />
  );
}

function initials(name: string): string {
  return name.slice(0, 1).toUpperCase();
}

/** «Люди»: участники дома и контакты — организации, мастера, личные (PRD, раздел 14). */
export function PeopleScreen() {
  const contacts = useRecords('contact');
  const { scope } = useScope();
  const requestAdd = useAddRequest();
  const shared = contacts.filter((contact) => contact.visibility !== 'personal');
  const personal = contacts.filter((contact) => contact.visibility === 'personal');
  // Участники дома — часть общего пространства: в режиме «Личное» их нет.
  const showMembers = scope !== 'personal';

  return (
    <Page title="Люди">
      {showMembers ? (
        <Section title="Участники дома" aside={<span className="muted">{PEOPLE.length}</span>}>
          <RowList label="Участники дома">
            {PEOPLE.map((person) => (
              <Row
                key={person.id}
                icon={<span className="avatar">{initials(person.name)}</span>}
                title={person.id === ME ? `${person.fullName} (вы)` : person.fullName}
                meta={
                  person.role === 'child'
                    ? `${ROLE_LABELS[person.role]} · видит записи «Вся семья»`
                    : ROLE_LABELS[person.role]
                }
              />
            ))}
          </RowList>
        </Section>
      ) : null}

      {shared.length > 0 ? (
        <Section
          title="Организации и мастера"
          aside={<span className="muted">{shared.length}</span>}
        >
          <RowList label="Организации и мастера">
            {shared.map((contact) => (
              <Row
                key={contact.id}
                to={`/people/${contact.id}`}
                icon={contactIcon(contact)}
                title={contact.name}
                meta={contact.role}
                badge={contact.visibility}
              />
            ))}
          </RowList>
        </Section>
      ) : null}

      {personal.length > 0 ? (
        <Section title="Личные контакты" aside={<span className="muted">{personal.length}</span>}>
          <RowList label="Личные контакты">
            {personal.map((contact) => (
              <Row
                key={contact.id}
                to={`/people/${contact.id}`}
                icon={contactIcon(contact)}
                title={contact.name}
                meta={contact.role}
                badge={contact.visibility}
              />
            ))}
          </RowList>
        </Section>
      ) : null}

      {contacts.length === 0 ? (
        <ScopeEmpty title="Контактов пока нет" addKind="contact" addLabel="Добавить контакт">
          Сантехник, УК, аварийная служба: добавьте нужные телефоны, и они будут под рукой.
        </ScopeEmpty>
      ) : (
        <button
          type="button"
          className="btn btn--secondary btn--block list-action"
          onClick={() => requestAdd('contact')}
        >
          <Plus size={20} weight="bold" aria-hidden />
          Добавить контакт
        </button>
      )}
    </Page>
  );
}

/** Карточка контакта: телефоны с копированием, быстрые действия, история, доступ (CONT-1…5). */
export function ContactScreen() {
  const { contactId } = useParams();
  const contact = useRecord('contact', contactId);
  const properties = useAllRecords('property');
  const toast = useToast();
  if (contact === undefined) return <NotFoundScreen what="Контакт не найден" />;

  const linked = properties.filter((property) => contact.propertyIds.includes(property.id));
  const firstPhone = contact.phones[0];

  return (
    <Page title={contact.name} eyebrow={contact.role} back={{ to: '/people', label: 'Люди' }}>
      <p className="property-meta">
        <AccessBadge visibility={contact.visibility} showLabel />
      </p>

      <div className="btn-row btn-row--first">
        {firstPhone ? (
          <a className="btn btn--primary" href={toTelHref(firstPhone.number)}>
            <Phone size={20} weight="fill" aria-hidden />
            Позвонить
          </a>
        ) : null}
        {contact.address ? (
          <button
            type="button"
            className="btn btn--secondary"
            onClick={() =>
              toast.show({
                message: 'В прототипе карта не открывается',
                detail: contact.address ?? '',
              })
            }
          >
            <MapPin size={20} aria-hidden />
            На карте
          </button>
        ) : null}
      </div>

      <Section title="Телефоны">
        <dl className="facts">
          {contact.phones.map((phone) => (
            <div className="facts__item" key={phone.number}>
              <dt>{phone.label}</dt>
              <dd>
                <a href={toTelHref(phone.number)} className="mono">
                  {phone.number}
                </a>
                <CopyButton value={phone.number} what="телефон" />
              </dd>
            </div>
          ))}
        </dl>
      </Section>

      {contact.address || contact.hours || contact.note ? (
        <Section title="О контакте">
          <dl className="facts">
            {contact.address ? (
              <div className="facts__item">
                <dt>Адрес</dt>
                <dd>{contact.address}</dd>
              </div>
            ) : null}
            {contact.hours ? (
              <div className="facts__item">
                <dt>Часы работы</dt>
                <dd>{contact.hours}</dd>
              </div>
            ) : null}
            {contact.note ? (
              <div className="facts__item">
                <dt>Заметка</dt>
                <dd>{contact.note}</dd>
              </div>
            ) : null}
          </dl>
        </Section>
      ) : null}

      {linked.length > 0 ? (
        <Section title="Связан с объектами">
          <RowList>
            {linked.map((property) => (
              <Row
                key={property.id}
                to={`/home/${property.id}`}
                icon={<Buildings size={22} aria-hidden />}
                title={property.title}
                meta={property.address}
                badge={property.visibility}
              />
            ))}
          </RowList>
        </Section>
      ) : null}

      {contact.interactions.length > 0 ? (
        <Section title="История">
          <RowList>
            {contact.interactions.map((item) => (
              <Row
                key={item.id}
                icon={<ThumbsUp size={22} aria-hidden />}
                title={item.text}
                meta={[
                  formatShortDate(item.date, TODAY),
                  item.amount !== undefined ? formatRub(item.amount) : undefined,
                  item.again ? 'звать снова' : undefined,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              />
            ))}
          </RowList>
        </Section>
      ) : null}

      <AccessActions id={contact.id} visibility={contact.visibility} what="контакт" />
      <p className="prototype-note">
        <Link to="/more/spaces">Как устроены личное и общее</Link>
      </p>
    </Page>
  );
}
