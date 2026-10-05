import type { ReactNode } from 'react';
import type { Scope } from '../access/scope.ts';

interface EmptyStateProps {
  icon?: ReactNode;
  title: string;
  children?: ReactNode;
  /** Первое действие: пустые разделы предлагают, с чего начать (TPL-4). */
  actions?: ReactNode;
}

export function EmptyState({ icon, title, children, actions }: EmptyStateProps) {
  return (
    <section className="empty-state" aria-label={title}>
      {icon ? <div className="empty-state__icon">{icon}</div> : null}
      <h2 className="empty-state__title">{title}</h2>
      {children ? <div className="empty-state__text">{children}</div> : null}
      {actions ? <div className="empty-state__actions">{actions}</div> : null}
    </section>
  );
}

/** Объяснение разницы личного и общего для пустого раздела — PRD, раздел 7.4. */
export const EMPTY_SCOPE_EXPLANATION: Readonly<Record<Scope, string>> = {
  all: 'Здесь пока ничего нет.',
  shared:
    'Здесь только общие записи дома: их видят вся семья или взрослые. Личные записи в этот режим не попадают.',
  personal: 'Здесь только ваши записи. Их не видит никто, кроме вас.',
};
