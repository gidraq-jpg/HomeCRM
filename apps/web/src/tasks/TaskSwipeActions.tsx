import { canRestore, canTrash } from '@homecrm/shared';
import { createContext, type ReactNode, useContext } from 'react';
import { useHousehold } from '../household/HouseholdContext.tsx';
import { factsOf, viewerOf } from '../notes/abilities.ts';
import { useToast } from '../ui/Toast.tsx';
import type { TaskCard } from './api.ts';
import { OperationNotice, useTaskOperation } from './operation.tsx';
import { useRefreshTasks } from './queries.ts';

const Actions = createContext<{ trash: (card: TaskCard) => void; pending: boolean } | null>(null);

/** Живёт над лентами: отмена и её ошибка доступны, даже если исчезла последняя строка. */
export function TaskSwipeActions({ children }: { children: ReactNode }) {
  const { me } = useHousehold();
  const viewer = viewerOf(me);
  const toast = useToast();
  const refresh = useRefreshTasks();
  const operation = useTaskOperation(async (card) => {
    if (!card.deletedAt) {
      // Отмена должна вернуть согласованную версию ленты до следующего жеста.
      await refresh();
      toast.show({ message: 'Дело восстановлено' });
      return;
    }
    const restore = card.canRestore ?? canRestore(viewer, factsOf(card, viewer, 'task'));
    toast.show({
      message: 'Дело в корзине',
      ...(restore
        ? {
            action: {
              label: 'Отменить',
              onClick: () => {
                void operation.run({ path: `tasks/${card.id}/restore`, body: {} });
              },
            },
          }
        : {}),
    });
  });
  return (
    <Actions.Provider
      value={{
        pending: operation.pending,
        trash: (card) => {
          if (!canTrash(viewer, factsOf(card, viewer, 'task'))) return;
          void operation.run({ path: `tasks/${card.id}/trash`, body: {} });
        },
      }}
    >
      <OperationNotice operation={operation} />
      {children}
    </Actions.Provider>
  );
}
export function useTaskSwipeActions() {
  return useContext(Actions);
}
