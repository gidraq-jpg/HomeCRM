import { CaretLeft, Plus, Receipt } from '@phosphor-icons/react';
import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { useAccounts } from '../accounts/queries.ts';
import { Notice, useAction } from '../auth/components.tsx';
import { useHousehold } from '../household/HouseholdContext.tsx';
import { useObjectContext } from '../objects/context.ts';
import { todayIn } from '../objects/dates.ts';
import { EmptyState } from '../ui/EmptyState.tsx';
import { countWord } from '../ui/format.ts';
import { useToast } from '../ui/Toast.tsx';
import { type ChargeInput, createCharge } from './api.ts';
import { ChargeForm } from './ChargeForm.tsx';
import { ChargeItem } from './ChargeItem.tsx';
import { ChargeError } from './components.tsx';
import { defaultPeriod } from './form.ts';
import { useCharges, useRefreshCharges } from './queries.ts';

const chargeCount = (count: number) => countWord(count, ['начисление', 'начисления', 'начислений']);

/**
 * Начисления лицевого счёта (UTIL-9, UTIL-10): список по месяцам, новое начисление с перерасчётом,
 * оплаты. Видят те же люди, что и объект; менять могут взрослые.
 */
export function ChargesScreen() {
  const { accountId = '' } = useParams();
  const { card, abilities } = useObjectContext();
  const { me } = useHousehold();
  const toast = useToast();
  const refresh = useRefreshCharges();
  const accounts = useAccounts(card.id);
  const query = useCharges(accountId);
  const create = useAction();
  const [adding, setAdding] = useState(false);

  const account = accounts.data?.find((item) => item.id === accountId);
  const trashed = card.deletedAt !== null;
  const canAdd = abilities.edit && !trashed;
  const today = todayIn(me.timeZone);
  const back = (
    <Link className="back-link" to={`/home/${card.id}/accounts`}>
      <CaretLeft size={20} aria-hidden />
      Лицевые счета
    </Link>
  );

  if (card.objectType !== 'property') {
    return <Notice>Начисления есть только у недвижимости.</Notice>;
  }
  if (accounts.isPending) return <Notice>Загружаем лицевой счёт…</Notice>;
  if (account === undefined) {
    return (
      <>
        {back}
        <Notice error>
          Лицевого счёта нет: его удалили, или он стал вам недоступен. Вернитесь к списку счетов.
        </Notice>
      </>
    );
  }

  function submit(input: ChargeInput) {
    void create.run(async () => {
      await createCharge(accountId, input);
      await refresh();
      setAdding(false);
      toast.show({ message: 'Начисление сохранено' });
    });
  }

  const charges = [...(query.data ?? [])].sort((a, b) => b.period.localeCompare(a.period));

  return (
    <section className="section" aria-labelledby={`charges-${accountId}`}>
      {back}
      <div className="section__head">
        <h2 className="section__title" id={`charges-${accountId}`}>
          Начисления: {account.title}
        </h2>
        {charges.length > 0 ? <span className="muted">{chargeCount(charges.length)}</span> : null}
      </div>

      {trashed ? (
        <Notice>
          Объект в корзине: начисления можно только смотреть. Они вернутся вместе с ним.
        </Notice>
      ) : null}
      {query.isPending ? <Notice>Загружаем начисления…</Notice> : null}
      {query.isError ? (
        <>
          <ChargeError error={query.error} action="load" />
          <button className="text-button" type="button" onClick={() => void query.refetch()}>
            Повторить загрузку начислений
          </button>
        </>
      ) : null}

      {adding ? (
        <div className="card">
          <h3 className="card__title">Новое начисление</h3>
          <ChargeForm
            card={card}
            account={account}
            period={defaultPeriod(today)}
            today={today}
            state={create}
            onSubmit={submit}
            onCancel={() => {
              create.setError(null);
              setAdding(false);
            }}
          />
        </div>
      ) : null}

      {query.data && charges.length === 0 && !adding ? (
        <EmptyState
          icon={<Receipt size={24} aria-hidden />}
          title="Начислений пока нет"
          actions={
            canAdd ? (
              <button
                type="button"
                className="btn btn--primary btn--block"
                onClick={() => setAdding(true)}
              >
                <Plus size={20} weight="bold" aria-hidden />
                Добавить начисление
              </button>
            ) : null
          }
        >
          <p>
            Начисление — это квитанция за месяц: итог, срок оплаты и, если нужно, строки по услугам
            и перерасчёт. К нему добавляются оплаты; ошибочную оплату можно отменить, удалить
            нельзя.
          </p>
        </EmptyState>
      ) : null}

      {charges.length > 0 ? (
        <ul className="card-list" aria-label="Начисления">
          {charges.map((charge) => (
            <ChargeItem key={charge.id} charge={charge} card={card} />
          ))}
        </ul>
      ) : null}

      {canAdd && !adding && charges.length > 0 ? (
        <button
          type="button"
          className="btn btn--primary btn--block list-action"
          onClick={() => setAdding(true)}
        >
          <Plus size={20} weight="bold" aria-hidden />
          Добавить начисление
        </button>
      ) : null}
    </section>
  );
}
