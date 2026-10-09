import { CalendarBlank, CaretLeft, CaretRight, Gauge, Plus, Receipt } from '@phosphor-icons/react';
import { Link, useSearchParams } from 'react-router';
import { ApiError } from '../auth/api.ts';
import { Notice } from '../auth/components.tsx';
import { useHousehold } from '../household/HouseholdContext.tsx';
import { todayIn } from '../objects/dates.ts';
import { EmptyState } from '../ui/EmptyState.tsx';
import { countWord, formatRub } from '../ui/format.ts';
import { Page, Section } from '../ui/Page.tsx';
import { Status } from '../ui/Row.tsx';
import type { MonthObject, MonthOverview } from './api.ts';
import { isMonth, monthName, monthOf, STATUS_LABELS, STATUS_TONES, shiftMonth } from './months.ts';
import { useMonth } from './queries.ts';

const BACK = { to: '/home', label: 'Дом' } as const;

function Money({ chargedCents, paidCents, remainingCents }: MonthOverview['totals']) {
  return (
    <dl className="facts">
      <div className="facts__item">
        <dt>Начислено</dt>
        <dd>{formatRub(chargedCents)}</dd>
      </div>
      <div className="facts__item">
        <dt>Оплачено</dt>
        <dd>{formatRub(paidCents)}</dd>
      </div>
      <div className="facts__item">
        <dt>К оплате</dt>
        <dd>
          <strong>{formatRub(remainingCents)}</strong>
          {remainingCents > 0 ? <Status tone="warning">Есть долг</Status> : null}
        </dd>
      </div>
    </dl>
  );
}

function ObjectMonth({ object }: { object: MonthObject }) {
  return (
    <li className="card month-object" aria-label={`Объект: ${object.title}`}>
      <h3 className="card__title">
        <Link to={`/home/${object.id}`}>{object.title}</Link>
      </h3>
      <Money
        chargedCents={object.chargedCents}
        paidCents={object.paidCents}
        remainingCents={object.remainingCents}
      />
      {object.accounts.length === 0 ? (
        <div className="month-object__empty">
          <p className="muted">Лицевых счетов нет: начислять и вводить показания пока не к чему.</p>
          <Link className="btn btn--secondary" to={`/home/${object.id}/accounts`}>
            <Plus size={20} aria-hidden />
            Добавить лицевой счёт
          </Link>
        </div>
      ) : (
        <ul className="month-accounts" aria-label={`Лицевые счета: ${object.title}`}>
          {object.accounts.map((account) => (
            <li key={account.id} className="month-account">
              <div className="month-account__head">
                <span className="month-account__title">{account.title}</span>
                <Status tone={STATUS_TONES[account.status]}>{STATUS_LABELS[account.status]}</Status>
              </div>
              <div className="month-account__links">
                <Link
                  className="btn btn--secondary"
                  to={`/home/${object.id}/readings`}
                  aria-label={`Показания: ${account.title}`}
                >
                  <Gauge size={20} aria-hidden />
                  Показания
                </Link>
                <Link
                  className="btn btn--secondary"
                  to={`/home/${object.id}/accounts/${account.id}/charges`}
                  aria-label={`Начисления: ${account.title}`}
                >
                  <Receipt size={20} aria-hidden />
                  Начисления
                </Link>
              </div>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

/**
 * «Коммуналка за месяц» (UTIL-11): по каждому объекту и по всем вместе — начислено, оплачено,
 * к оплате; статус показаний по лицевым счетам с переходом к «Показаниям» и «Начислениям».
 * Месяц лежит в адресе (`?month=2026-10`): это не секрет, и ссылку можно сохранить.
 */
export function MonthScreen() {
  const { me } = useHousehold();
  const [params, setParams] = useSearchParams();
  const current = monthOf(todayIn(me.timeZone));
  const requested = params.get('month');
  const month = isMonth(requested) ? requested : current;
  const query = useMonth(month);

  function go(next: string) {
    setParams(next === current ? {} : { month: next }, { replace: true });
  }

  const label = monthName(month);
  const switcher = (
    <nav className="month-switch" aria-label="Расчётный месяц">
      <button
        type="button"
        className="icon-button icon-button--soft"
        aria-label="Предыдущий месяц"
        onClick={() => go(shiftMonth(month, -1))}
      >
        <CaretLeft size={22} aria-hidden />
      </button>
      <p className="month-switch__label" aria-live="polite">
        {label}
      </p>
      <button
        type="button"
        className="icon-button icon-button--soft"
        aria-label="Следующий месяц"
        onClick={() => go(shiftMonth(month, 1))}
      >
        <CaretRight size={22} aria-hidden />
      </button>
    </nav>
  );
  const toCurrent =
    month === current ? null : (
      <button type="button" className="text-button" onClick={() => go(current)}>
        <CalendarBlank size={20} aria-hidden />К текущему месяцу
      </button>
    );

  if (query.isPending) {
    return (
      <Page title="Коммуналка за месяц" back={BACK}>
        {switcher}
        <Notice>Загружаем месяц…</Notice>
      </Page>
    );
  }
  if (query.isError) {
    return (
      <Page title="Коммуналка за месяц" back={BACK}>
        {switcher}
        <Notice error>
          {query.error instanceof ApiError && query.error.status === 400
            ? 'Такого месяца нет. Выберите месяц стрелками.'
            : 'Не удалось загрузить месяц. Проверьте подключение и повторите.'}
        </Notice>
        <button className="text-button" type="button" onClick={() => void query.refetch()}>
          Повторить загрузку месяца
        </button>
        {toCurrent}
      </Page>
    );
  }

  const { objects, totals } = query.data;
  const nothing = totals.chargedCents === 0 && totals.paidCents === 0;
  const first = objects.find((object) => object.accounts.length > 0);
  const firstAccount = first?.accounts[0];

  return (
    <Page title="Коммуналка за месяц" back={BACK}>
      {switcher}
      {toCurrent}

      {objects.length === 0 ? (
        <EmptyState icon={<Receipt size={24} aria-hidden />} title="Объектов пока нет">
          <p>
            Коммуналка считается по лицевым счетам недвижимости. Добавьте квартиру или дом, затем
            лицевой счёт — и здесь появятся начисления и оплаты.
          </p>
          <div className="empty-state__actions">
            <Link className="btn btn--primary btn--block" to="/home/new">
              <Plus size={20} weight="bold" aria-hidden />
              Добавить объект
            </Link>
          </div>
        </EmptyState>
      ) : (
        <>
          {nothing ? (
            <EmptyState
              icon={<Receipt size={24} aria-hidden />}
              title={`За ${label.toLocaleLowerCase('ru')} начислений нет`}
              actions={
                first && firstAccount ? (
                  <Link
                    className="btn btn--primary btn--block"
                    to={`/home/${first.id}/accounts/${firstAccount.id}/charges`}
                  >
                    <Plus size={20} weight="bold" aria-hidden />
                    Добавить начисление
                  </Link>
                ) : null
              }
            >
              <p>
                Начисление — это квитанция за расчётный месяц. Добавьте его в лицевом счёте, и оно
                попадёт сюда вместе с оплатами.
              </p>
            </EmptyState>
          ) : null}

          <Section title="Всего">
            <div className="card">
              <Money {...totals} />
            </div>
          </Section>

          <Section
            title="Объекты"
            aside={
              <span className="muted">
                {countWord(objects.length, ['объект', 'объекта', 'объектов'])}
              </span>
            }
          >
            <ul className="card-list" aria-label="Объекты за месяц">
              {objects.map((object) => (
                <ObjectMonth key={object.id} object={object} />
              ))}
            </ul>
            <p className="muted month-note">
              Оплата относится к тому месяцу, за который выставлено начисление, а не к дате платежа.
              Переплата по одному начислению не гасит другое.
            </p>
          </Section>
        </>
      )}
    </Page>
  );
}
