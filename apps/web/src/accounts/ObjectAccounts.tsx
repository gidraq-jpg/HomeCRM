import { ArrowSquareOut, CreditCard, PencilSimple, Plus, Trash } from '@phosphor-icons/react';
import { type ReactNode, useState } from 'react';
import { Link } from 'react-router';
import { Notice, useAction } from '../auth/components.tsx';
import { useHousehold } from '../household/HouseholdContext.tsx';
import { noteAbilities, viewerOf } from '../notes/abilities.ts';
import { ObjectError } from '../objects/components.tsx';
import { useObjectContext } from '../objects/context.ts';
import { CopyButton } from '../ui/CopyButton.tsx';
import { EmptyState } from '../ui/EmptyState.tsx';
import { countWord } from '../ui/format.ts';
import { EXTERNAL_LINK } from '../ui/link.ts';
import { useToast } from '../ui/Toast.tsx';
import { AccountForm, type AccountValues } from './AccountForm.tsx';
import {
  type AccountCard,
  createAccount,
  patchAccount,
  restoreAccount,
  trashAccount,
} from './api.ts';
import { supplierChange } from './form.ts';
import {
  describePayDay,
  describeTransmission,
  describeWindow,
  PAYER_LABELS,
  servicesText,
} from './labels.ts';
import { useAccounts, useRefreshAccounts } from './queries.ts';

export const ACCOUNT_TYPE = 'utility_account';

/** Сколько лицевых счетов по-русски: «1 лицевой счёт», «2 лицевых счёта», «5 лицевых счетов». */
export const accountCount = (count: number) =>
  countWord(count, ['лицевой счёт', 'лицевых счёта', 'лицевых счетов']);

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="facts__item">
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

function AccountItem({ account, readOnly }: { account: AccountCard; readOnly: boolean }) {
  const { me, householdId } = useHousehold();
  const toast = useToast();
  const refresh = useRefreshAccounts();
  const quick = useAction();
  const save = useAction();
  const [editing, setEditing] = useState(false);
  const abilities = noteAbilities(viewerOf(me), account, householdId, ACCOUNT_TYPE);
  const { data } = account;

  function submit(values: AccountValues) {
    void save.run(async () => {
      const supplier = supplierChange(account.supplier?.id ?? null, values.supplierId);
      const same =
        values.title === account.title &&
        JSON.stringify(values.data) === JSON.stringify(account.data);
      if (same && !('supplierId' in supplier)) {
        setEditing(false);
        return;
      }
      await patchAccount(account.id, {
        title: values.title,
        data: values.data,
        ...supplier,
        expectedUpdatedAt: account.updatedAt,
      });
      await refresh();
      setEditing(false);
      toast.show({ message: 'Лицевой счёт сохранён' });
    });
  }

  function trash() {
    void quick.run(async () => {
      await trashAccount(account.id);
      await refresh();
      toast.show(
        abilities.restore
          ? {
              message: 'Лицевой счёт в корзине',
              detail: 'Хранится 30 дней',
              action: {
                label: 'Отменить',
                onClick: () => {
                  restoreAccount(account.id)
                    .then(() => refresh())
                    .then(() => toast.show({ message: 'Лицевой счёт возвращён' }))
                    .catch(() =>
                      toast.show({
                        message: 'Не удалось вернуть лицевой счёт',
                        detail: 'Откройте «Корзину» в разделе «Ещё» и восстановите его там.',
                      }),
                    );
                },
              },
            }
          : {
              message: 'Лицевой счёт в корзине',
              detail: 'Вернуть его сможет автор-взрослый или администратор. Хранится 30 дней.',
              durationMs: 10_000,
            },
      );
    });
  }

  if (editing) {
    return (
      <li className="card account-card">
        <h3 className="card__title">Правка: {account.title}</h3>
        <AccountForm
          card={account}
          submitLabel="Сохранить"
          pendingLabel="Сохраняем…"
          state={save}
          onSubmit={submit}
          onCancel={() => {
            save.setError(null);
            setEditing(false);
          }}
        />
      </li>
    );
  }

  return (
    <li className="card account-card">
      <h3 className="card__title">{account.title}</h3>
      <dl className="facts facts--fields">
        <Fact label="Услуги">{servicesText(data.services)}</Fact>
        {data.number === '' ? null : (
          <Fact label="Номер">
            <span className="mono">{data.number}</span>
            <CopyButton value={data.number} what="номер лицевого счёта" />
          </Fact>
        )}
        <Fact label="Поставщик">
          {account.supplier === null ? (
            'не указан или скрыт'
          ) : (
            <Link to={`/more/organizations/${account.supplier.id}`}>
              {account.supplier.title}
              {account.supplier.deletedAt === null ? '' : ' (в корзине)'}
            </Link>
          )}
        </Fact>
        <Fact label="Передача показаний">
          {data.transmission?.method === 'provider' ? (
            <a href={data.transmission.url} {...EXTERNAL_LINK}>
              {describeTransmission(data.transmission)}
              <ArrowSquareOut size={16} aria-hidden />
            </a>
          ) : (
            describeTransmission(data.transmission)
          )}
        </Fact>
        <Fact label="Окно показаний">{describeWindow(data.readingRule)}</Fact>
        <Fact label="Оплата">{describePayDay(data.paymentRule)}</Fact>
        <Fact label="Кто платит">{PAYER_LABELS[data.payer]}</Fact>
        {data.cabinetUrl === null ? null : (
          <Fact label="Личный кабинет">
            <a href={data.cabinetUrl} {...EXTERNAL_LINK}>
              Открыть
              <ArrowSquareOut size={16} aria-hidden />
            </a>
          </Fact>
        )}
        {data.note === '' ? null : <Fact label="Заметка">{data.note}</Fact>}
      </dl>
      <ObjectError error={quick.error} action="account" />
      {readOnly ? null : (
        <div className="btn-row">
          {abilities.edit ? (
            <button type="button" className="btn btn--secondary" onClick={() => setEditing(true)}>
              <PencilSimple size={20} aria-hidden />
              Править
            </button>
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
      )}
    </li>
  );
}

/**
 * Вкладка «Счета» карточки недвижимости (UTIL-2): лицевые счета со всеми полями, создание, правка и
 * корзина с отменой 7 секунд. Счёт лежит в месте объекта и видим только тем, кто видит объект.
 */
export function ObjectAccounts() {
  const { card, abilities } = useObjectContext();
  const toast = useToast();
  const refresh = useRefreshAccounts();
  const query = useAccounts(card.id);
  const create = useAction();
  const [adding, setAdding] = useState(false);
  const trashed = card.deletedAt !== null;
  const canAdd = abilities.edit && !trashed;

  if (card.objectType !== 'property') {
    return <Notice>Лицевые счета есть только у недвижимости.</Notice>;
  }

  function submit(values: AccountValues) {
    void create.run(async () => {
      await createAccount(card.id, {
        title: values.title,
        data: values.data,
        ...(values.supplierId === '' ? {} : { supplierId: values.supplierId }),
      });
      await refresh();
      setAdding(false);
      toast.show({ message: 'Лицевой счёт сохранён' });
    });
  }

  const accounts = query.data ?? [];

  return (
    <section className="section" aria-labelledby={`accounts-${card.id}`}>
      <div className="section__head">
        <h2 className="section__title" id={`accounts-${card.id}`}>
          Лицевые счета
        </h2>
        {accounts.length > 0 ? (
          <span className="muted">{accountCount(accounts.length)}</span>
        ) : null}
      </div>

      {trashed ? (
        <Notice>
          Объект в корзине: лицевые счета можно только смотреть. Они вернутся вместе с ним.
        </Notice>
      ) : null}
      {query.isPending ? <Notice>Загружаем лицевые счета…</Notice> : null}
      {query.isError ? (
        <>
          <ObjectError error={query.error} action="account" />
          <button className="text-button" type="button" onClick={() => void query.refetch()}>
            Повторить загрузку лицевых счетов
          </button>
        </>
      ) : null}

      {adding ? (
        <div className="card account-card">
          <h3 className="card__title">Новый лицевой счёт</h3>
          <AccountForm
            submitLabel="Сохранить"
            pendingLabel="Сохраняем…"
            state={create}
            onSubmit={submit}
            onCancel={() => {
              create.setError(null);
              setAdding(false);
            }}
          />
        </div>
      ) : null}

      {query.data && accounts.length === 0 && !adding ? (
        <EmptyState
          icon={<CreditCard size={24} aria-hidden />}
          title="Лицевых счетов пока нет"
          actions={
            canAdd ? (
              <button
                type="button"
                className="btn btn--primary btn--block"
                onClick={() => setAdding(true)}
              >
                <Plus size={20} weight="bold" aria-hidden />
                Добавить лицевой счёт
              </button>
            ) : null
          }
        >
          <p>
            Лицевой счёт — это договор с поставщиком услуги: электроэнергия, вода, отопление.
            Поставщик и номер необязательны, их можно добавить позже. Счета видят те же люди, что и
            объект.
          </p>
        </EmptyState>
      ) : null}

      {accounts.length > 0 ? (
        <ul className="card-list" aria-label="Лицевые счета">
          {accounts.map((account) => (
            <AccountItem key={account.id} account={account} readOnly={trashed || adding} />
          ))}
        </ul>
      ) : null}

      {canAdd && !adding && accounts.length > 0 ? (
        <button
          type="button"
          className="btn btn--primary btn--block list-action"
          onClick={() => setAdding(true)}
        >
          <Plus size={20} weight="bold" aria-hidden />
          Добавить лицевой счёт
        </button>
      ) : null}
    </section>
  );
}
