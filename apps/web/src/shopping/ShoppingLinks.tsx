import { canWriteLink } from '@homecrm/shared';
import { useState } from 'react';
import { Notice, useAction } from '../auth/components.tsx';
import { useHousehold } from '../household/HouseholdContext.tsx';
import { routeOf, useEnd } from '../links/ends.ts';
import { factsOf, viewerOf } from '../notes/abilities.ts';
import { createLink, type RecordLink, type RecordRef } from '../objects/api.ts';
import { useLinks, useRefreshObjects } from '../objects/queries.ts';
import { Link } from '../shell/motion.tsx';
import { RecordPicker } from '../tasks/options.tsx';
import { Section } from '../ui/Page.tsx';
import type { ShoppingCard } from './api.ts';

function ShoppingLink({ ref }: { ref: RecordRef }) {
  const { me } = useHousehold();
  const end = useEnd(ref, viewerOf(me));
  const path = routeOf(ref);
  return (
    <li>
      {path && end.title ? (
        <Link to={path}>{end.title}</Link>
      ) : (
        <span>{end.loading ? 'Загружаем…' : 'Связанная запись недоступна'}</span>
      )}
    </li>
  );
}
export function ShoppingLinks({ card }: { card: ShoppingCard }) {
  const { me } = useHousehold();
  const query = useLinks({ type: 'shopping_item', id: card.id });
  const refresh = useRefreshObjects();
  const state = useAction();
  const [object, setObject] = useState('');
  const [task, setTask] = useState('');
  const viewer = viewerOf(me);
  const facts = factsOf(card, viewer, 'shopping_item');
  return (
    <Section title="Связи">
      {query.isPending ? (
        <Notice>Загружаем связи…</Notice>
      ) : query.error ? (
        <Notice error>Связи сейчас недоступны. Повторите с сетью.</Notice>
      ) : null}
      <ul className="row-list">
        {(query.data ?? []).map((link: RecordLink) => (
          <ShoppingLink
            key={link.id}
            ref={
              link.left.id === card.id && link.left.type === 'shopping_item'
                ? link.right
                : link.left
            }
          />
        ))}
      </ul>
      {!card.deletedAt && canWriteLink(viewer, facts, facts) ? (
        <details className="shopping-bought">
          <summary>Связать с делом или объектом</summary>
          <RecordPicker
            kind="object"
            label="Связь с объектом"
            value={object}
            onChange={setObject}
          />
          <RecordPicker kind="task" label="Связь с делом" value={task} onChange={setTask} />
          <button
            type="button"
            className="btn btn--secondary"
            disabled={state.disabled || (!object && !task)}
            onClick={() =>
              void state.run(async () => {
                if (object)
                  await createLink(
                    { type: 'shopping_item', id: card.id },
                    { type: 'object', id: object },
                    '',
                  );
                if (task)
                  await createLink(
                    { type: 'shopping_item', id: card.id },
                    { type: 'task', id: task },
                    '',
                  );
                setObject('');
                setTask('');
                await refresh();
              })
            }
          >
            Связать
          </button>
          {state.error ? (
            <Notice error>Связь не сохранена. Запись или доступ могли измениться.</Notice>
          ) : null}
        </details>
      ) : null}
    </Section>
  );
}
