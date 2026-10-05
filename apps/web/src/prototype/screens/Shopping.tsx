import { Plus } from '@phosphor-icons/react';
import { AccessBadge } from '../../access/AccessBadge.tsx';
import { useScope } from '../../access/ScopeContext.tsx';
import { CheckToggle } from '../../ui/CheckToggle.tsx';
import { Page, Section } from '../../ui/Page.tsx';
import { useToast } from '../../ui/Toast.tsx';
import { useAddRequest } from '../add-request.tsx';
import { ScopeEmpty } from '../components.tsx';
import type { ShoppingRecord } from '../model.ts';
import { usePrototype, useRecords } from '../store.tsx';

/** «Покупки»: общий список «Вся семья» и личный список по желанию (SHOP-1…3). */
export function ShoppingScreen() {
  const items = useRecords('shopping');
  const { scope } = useScope();
  const { dispatch } = usePrototype();
  const requestAdd = useAddRequest();
  const toast = useToast();

  const shared = items.filter((item) => item.visibility !== 'personal');
  const personal = items.filter((item) => item.visibility === 'personal');

  function toggle(item: ShoppingRecord) {
    const bought = !item.bought;
    dispatch({ type: 'setBought', id: item.id, bought });
    toast.show({
      message: bought ? 'Куплено' : 'Вернули в список',
      detail: item.title,
      action: {
        label: 'Отменить',
        onClick: () => dispatch({ type: 'setBought', id: item.id, bought: !bought }),
      },
    });
  }

  function list(entries: readonly ShoppingRecord[]) {
    const open = entries.filter((item) => !item.bought);
    const bought = entries.filter((item) => item.bought);
    return (
      <ul className="task-list">
        {[...open, ...bought].map((item) => (
          <li key={item.id} className={item.bought ? 'task-row task-row--done' : 'task-row'}>
            <CheckToggle checked={item.bought} label={item.title} onChange={() => toggle(item)} />
            <span className="task-row__body task-row__body--static">
              <span className="row__title">{item.title}</span>
              {item.bought ? <span className="row__meta">Куплено</span> : null}
            </span>
            <AccessBadge visibility={item.visibility} />
          </li>
        ))}
      </ul>
    );
  }

  return (
    <Page title="Покупки" back={{ to: '/more', label: 'Ещё' }}>
      {items.length === 0 ? (
        <ScopeEmpty title="В списке пусто" addKind="shopping" addLabel="Добавить покупку">
          Общий список видит вся семья, и дети тоже могут в него писать. Личный список — только вы.
        </ScopeEmpty>
      ) : (
        <>
          {scope !== 'personal' ? (
            <Section title="Общий список" aside={<span className="muted">{shared.length}</span>}>
              {shared.length > 0 ? list(shared) : <p className="muted">Общий список пуст.</p>}
            </Section>
          ) : null}
          {scope !== 'shared' ? (
            <Section title="Мой список" aside={<span className="muted">{personal.length}</span>}>
              {personal.length > 0 ? (
                list(personal)
              ) : (
                <p className="muted">
                  Личный список пуст. Позиции с отметкой «Только я» видите только вы.
                </p>
              )}
            </Section>
          ) : null}
          <button
            type="button"
            className="btn btn--secondary btn--block list-action"
            onClick={() => requestAdd('shopping')}
          >
            <Plus size={20} weight="bold" aria-hidden />
            Добавить покупку
          </button>
        </>
      )}
    </Page>
  );
}
