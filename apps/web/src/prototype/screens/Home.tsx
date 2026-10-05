import {
  AddressBook,
  Buildings,
  CalendarDots,
  CaretRight,
  Clock,
  Cube,
  FileText,
  Gauge,
  Note,
  Receipt,
  Wrench,
} from '@phosphor-icons/react';
import { useMemo } from 'react';
import { Link, Outlet, useOutletContext, useParams } from 'react-router';
import { AccessBadge } from '../../access/AccessBadge.tsx';
import { useScope } from '../../access/ScopeContext.tsx';
import { CopyButton } from '../../ui/CopyButton.tsx';
import {
  countWord,
  type DateOnly,
  daysBetween,
  formatDecimal,
  formatRub,
  formatShortDate,
} from '../../ui/format.ts';
import { LinkTabs } from '../../ui/LinkTabs.tsx';
import { Page, Section } from '../../ui/Page.tsx';
import { Row, RowList, Status } from '../../ui/Row.tsx';
import { AccessActions } from '../AccessActions.tsx';
import { NotFoundScreen, ScopeEmpty } from '../components.tsx';
import { ACCOUNTS, CHARGES, FEED, METERS, PEOPLE, TODAY } from '../data/index.ts';
import { PROPERTY_STATUS_LABELS } from '../labels.ts';
import type { PropertyRecord } from '../model.ts';
import { buildRadar, openWindows } from '../radar.ts';
import { useAllRecords, usePrototype, useRecord, useRecords } from '../store.tsx';

const NBSP = String.fromCodePoint(0xa0);

function statusTone(status: PropertyRecord['status']): 'ok' | 'neutral' {
  return status === 'live' ? 'ok' : 'neutral';
}

function windowMeta(propertyId: string, windows: ReturnType<typeof openWindows>) {
  return windows.find((window) => window.propertyId === propertyId && !window.transmitted);
}

/** Сколько ещё платить по видимым объектам. */
function totals(propertyIds: ReadonlySet<string>) {
  const charges = CHARGES.filter((charge) => propertyIds.has(charge.propertyId));
  const charged = charges.reduce((sum, charge) => sum + charge.amount, 0);
  const paid = charges
    .filter((charge) => charge.paid)
    .reduce((sum, charge) => sum + charge.amount, 0);
  return { charged, paid, due: charged - paid };
}

export function HomeScreen() {
  const properties = useRecords('property');
  const { state, records } = usePrototype();
  const windows = useMemo(
    () => openWindows(records, state.readings, TODAY),
    [records, state.readings],
  );
  const due = totals(new Set(properties.map((property) => property.id))).due;

  return (
    <Page
      title="Дом"
      {...(properties.length > 0
        ? { eyebrow: countWord(properties.length, ['объект', 'объекта', 'объектов']) }
        : {})}
    >
      {properties.length === 0 ? (
        <ScopeEmpty title="Объектов пока нет" addKind="property" addLabel="Добавить объект">
          Квартиры и дачи обычно ведёт вся семья, поэтому они лежат в «Общем». Начните с готового
          шаблона «Квартира в многоквартирном доме»: лицевые счета, счётчики и сроки создадутся
          сами.
        </ScopeEmpty>
      ) : (
        <>
          <Link className="card card--link month-link" to="/home/month">
            <span className="row__icon">
              <Receipt size={22} aria-hidden />
            </span>
            <span className="row__body">
              <span className="row__title">Коммуналка за месяц</span>
              <span className="row__meta">Октябрь · к оплате {formatRub(due)}</span>
            </span>
            <CaretRight className="row__chevron" size={20} aria-hidden />
          </Link>

          <div className="card-list">
            {properties.map((property) => {
              const window = windowMeta(property.id, windows);
              return (
                <Link
                  key={property.id}
                  to={`/home/${property.id}`}
                  className="card card--link property-card"
                >
                  <span className="property-card__head">
                    <span className="row__icon">
                      <Buildings size={22} aria-hidden />
                    </span>
                    <span className="row__body">
                      <span className="row__title">{property.title}</span>
                      <span className="row__meta">{property.address}</span>
                    </span>
                    <AccessBadge visibility={property.visibility} />
                  </span>
                  <span className="property-card__status">
                    <Status tone={statusTone(property.status)}>
                      {PROPERTY_STATUS_LABELS[property.status]}
                    </Status>
                    {window ? (
                      <Status tone="warning">Показания до {formatShortDate(window.until)}</Status>
                    ) : null}
                  </span>
                </Link>
              );
            })}
          </div>
        </>
      )}
    </Page>
  );
}

interface PropertyContext {
  property: PropertyRecord;
}

function usePropertyContext(): PropertyContext {
  return useOutletContext<PropertyContext>();
}

/** Карточка объекта: вкладки «Обзор», «Коммуналка», «Счётчики», «Документы», «Люди», «Лента». */
export function PropertyScreen() {
  const { propertyId } = useParams();
  const property = useRecord('property', propertyId);
  if (property === undefined) return <NotFoundScreen what="Объект не найден" />;

  const base = `/home/${property.id}`;
  return (
    <Page
      title={property.title}
      eyebrow={property.address}
      back={{ to: '/home', label: 'Дом' }}
      tabs={
        <LinkTabs
          label="Разделы объекта"
          items={[
            { to: base, label: 'Обзор', end: true },
            { to: `${base}/utilities`, label: 'Коммуналка' },
            { to: `${base}/meters`, label: 'Счётчики' },
            { to: `${base}/documents`, label: 'Документы' },
            { to: `${base}/people`, label: 'Люди' },
            { to: `${base}/feed`, label: 'Лента' },
          ]}
        />
      }
    >
      <p className="property-meta">
        <Status tone={statusTone(property.status)}>
          {PROPERTY_STATUS_LABELS[property.status]}
        </Status>
        <AccessBadge visibility={property.visibility} showLabel />
      </p>
      <Outlet context={{ property } satisfies PropertyContext} />
    </Page>
  );
}

export function PropertyOverview() {
  const { property } = usePropertyContext();
  const { state, records } = usePrototype();
  const { scope } = useScope();
  const radar = useMemo(
    () =>
      buildRadar(records, state.readings, TODAY).filter((item) => item.propertyId === property.id),
    [records, state.readings, property.id],
  );
  const owner = PEOPLE.find((person) => person.id === property.responsible);
  const hasMeters = METERS.some((meter) => meter.propertyId === property.id);

  return (
    <>
      <Section title="Ближайшее">
        {radar.length > 0 ? (
          <RowList>
            {radar.map((item) => (
              <Row
                key={item.id}
                to={item.to}
                icon={<CalendarDots size={22} aria-hidden />}
                title={item.title}
                meta={item.detail}
                badge={item.visibility}
              />
            ))}
          </RowList>
        ) : (
          <p className="muted">Ближайших сроков нет.</p>
        )}
        {hasMeters ? (
          <Link
            className="btn btn--primary btn--block overview__action"
            to={`/home/${property.id}/readings`}
          >
            <Gauge size={22} aria-hidden />
            Внести показания
          </Link>
        ) : null}
      </Section>

      <Section title="Об объекте">
        <dl className="facts">
          <div className="facts__item">
            <dt>Тип</dt>
            <dd>{property.propertyType}</dd>
          </div>
          <div className="facts__item">
            <dt>Адрес</dt>
            <dd>{property.address}</dd>
          </div>
          {property.area !== undefined ? (
            <div className="facts__item">
              <dt>Площадь</dt>
              <dd>
                {formatDecimal(property.area, 1)}
                {NBSP}м²
              </dd>
            </div>
          ) : null}
          <div className="facts__item">
            <dt>Собственники</dt>
            <dd>{property.owners}</dd>
          </div>
          <div className="facts__item">
            <dt>Ответственный</dt>
            <dd>{owner?.fullName ?? '—'}</dd>
          </div>
        </dl>
      </Section>

      <AccessActions id={property.id} visibility={property.visibility} what="объект" />
      {scope === 'personal' ? (
        <p className="prototype-note">
          Объект лежит в общем пространстве, поэтому в режиме «Личное» его нет в списке дома.
        </p>
      ) : null}
    </>
  );
}

function chargeStatus(paid: boolean, due: DateOnly) {
  if (paid) return <Status tone="ok">Оплачено</Status>;
  const days = daysBetween(TODAY, due);
  if (days < 0) return <Status tone="danger">Просрочено</Status>;
  return <Status tone="warning">К оплате до {formatShortDate(due)}</Status>;
}

export function PropertyUtilities() {
  const { property } = usePropertyContext();
  const accounts = ACCOUNTS.filter((account) => account.propertyId === property.id);
  const charges = CHARGES.filter((charge) => charge.propertyId === property.id);

  return (
    <>
      <Section title="Лицевые счета" aside={<span className="muted">{accounts.length}</span>}>
        <div className="card-list">
          {accounts.map((account) => (
            <article className="card" key={account.id}>
              <h3 className="card__title">{account.title}</h3>
              <p className="card__meta">{account.supplier}</p>
              <div className="card__line">
                <span className="mono">№ {account.number}</span>
                <CopyButton value={account.number} what="номер лицевого счёта" />
              </div>
              <dl className="facts facts--compact">
                <div className="facts__item">
                  <dt>Показания</dt>
                  <dd>
                    {account.method}
                    {account.window
                      ? `, ${account.window.from}–${account.window.to}${NBSP}числа`
                      : ''}
                  </dd>
                </div>
                <div className="facts__item">
                  <dt>Оплата</dt>
                  <dd>{account.payment}</dd>
                </div>
                <div className="facts__item">
                  <dt>Платит</dt>
                  <dd>{account.payer}</dd>
                </div>
              </dl>
            </article>
          ))}
        </div>
      </Section>

      <Section title="Начисления за октябрь">
        <RowList>
          {charges.map((charge) => (
            <Row
              key={charge.id}
              icon={<Receipt size={22} aria-hidden />}
              title={charge.title}
              meta={chargeStatus(charge.paid, charge.due)}
              aside={<span className="amount">{formatRub(charge.amount)}</span>}
            />
          ))}
        </RowList>
      </Section>
    </>
  );
}

export function PropertyMeters() {
  const { property } = usePropertyContext();
  const meters = METERS.filter((meter) => meter.propertyId === property.id);
  return (
    <Section title="Счётчики" aside={<span className="muted">{meters.length}</span>}>
      <RowList>
        {meters.map((meter) => (
          <Row
            key={meter.id}
            icon={<Cube size={22} aria-hidden />}
            title={`${meter.resource} · ${meter.place}`}
            meta={`№ ${meter.serial} · последнее ${formatDecimal(meter.previous, meter.digits)}${NBSP}${meter.unit} от ${formatShortDate(meter.previousDate, TODAY)} · поверка до ${formatShortDate(meter.nextVerification, TODAY)}`}
          />
        ))}
      </RowList>
      <Link
        className="btn btn--primary btn--block overview__action"
        to={`/home/${property.id}/readings`}
      >
        <Gauge size={22} aria-hidden />
        Внести показания
      </Link>
    </Section>
  );
}

export function PropertyDocuments() {
  const { property } = usePropertyContext();
  const documents = useRecords('document').filter((doc) => doc.propertyId === property.id);
  return (
    <Section title="Документы объекта">
      {documents.length > 0 ? (
        <RowList>
          {documents.map((doc) => (
            <Row
              key={doc.id}
              to={`/documents/${doc.id}`}
              icon={<FileText size={22} aria-hidden />}
              title={doc.title}
              meta={
                doc.expires === null
                  ? 'Бессрочно'
                  : `Действует до ${formatShortDate(doc.expires, TODAY)}`
              }
              badge={doc.visibility}
            />
          ))}
        </RowList>
      ) : (
        <ScopeEmpty
          title="Документов у объекта нет"
          addKind="document"
          addLabel="Добавить документ"
        >
          Договор, выписку ЕГРН и полис удобно хранить рядом с объектом: они наследуют его доступ.
        </ScopeEmpty>
      )}
    </Section>
  );
}

export function PropertyPeople() {
  const { property } = usePropertyContext();
  const contacts = useRecords('contact').filter((contact) =>
    contact.propertyIds.includes(property.id),
  );
  return (
    <Section title="Люди и организации">
      {contacts.length > 0 ? (
        <RowList>
          {contacts.map((contact) => (
            <Row
              key={contact.id}
              to={`/people/${contact.id}`}
              icon={
                contact.contactKind === 'organization' ? (
                  <Buildings size={22} aria-hidden />
                ) : (
                  <Wrench size={22} aria-hidden />
                )
              }
              title={contact.name}
              meta={contact.role}
              badge={contact.visibility}
            />
          ))}
        </RowList>
      ) : (
        <ScopeEmpty title="Контактов у объекта нет" addKind="contact" addLabel="Добавить контакт">
          УК, аварийная служба и мастера, связанные с объектом, будут собраны здесь.
        </ScopeEmpty>
      )}
      <Link className="text-button" to="/people">
        <AddressBook size={20} aria-hidden />
        Все люди и организации
      </Link>
    </Section>
  );
}

export function PropertyFeed() {
  const { property } = usePropertyContext();
  const notes = useRecords('note').filter((note) => note.propertyId === property.id);
  const contacts = useAllRecords('contact');

  const items = [
    ...FEED.filter((event) => event.propertyId === property.id).map((event) => ({
      id: event.id,
      date: event.date,
      icon: <Clock size={22} aria-hidden />,
      title: event.title,
      meta: [
        event.details,
        event.amount !== undefined ? formatRub(event.amount) : undefined,
        event.contactId
          ? contacts.find((contact) => contact.id === event.contactId)?.name
          : undefined,
      ]
        .filter(Boolean)
        .join(' · '),
      to: event.contactId ? `/people/${event.contactId}` : undefined,
      badge: undefined,
    })),
    // Личная заметка к общему объекту видна только её автору (правило 7.3.2).
    ...notes.map((note) => ({
      id: note.id,
      date: note.created,
      icon: <Note size={22} aria-hidden />,
      title: `Заметка: ${note.title}`,
      meta: note.text,
      to: `/more/notes/${note.id}`,
      badge: note.visibility,
    })),
  ].sort((a, b) => b.date.localeCompare(a.date));

  return (
    <Section title="Лента">
      <RowList>
        {items.map((item) => (
          <Row
            key={item.id}
            {...(item.to ? { to: item.to } : {})}
            icon={item.icon}
            title={item.title}
            meta={
              <>
                {formatShortDate(item.date, TODAY)}
                {item.meta ? ` · ${item.meta}` : ''}
              </>
            }
            {...(item.badge ? { badge: item.badge } : {})}
          />
        ))}
      </RowList>
      <p className="prototype-note">
        Личные заметки к объекту видит только их автор: в ленте других участников их нет.
      </p>
    </Section>
  );
}
