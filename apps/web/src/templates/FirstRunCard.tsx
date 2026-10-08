import { RocketLaunch } from '@phosphor-icons/react';
import { Link } from 'react-router';
import { useHousehold } from '../household/HouseholdContext.tsx';
import { EmptyState } from '../ui/EmptyState.tsx';
import { useOnboarding } from './queries.ts';

/**
 * Приглашение начать с мастера первого запуска (TPL-1, TPL-4): показывается администратору, пока в
 * доме нет ни одного объекта. Мастер не навязывается: карточку можно просто пройти мимо.
 */
export function FirstRunCard() {
  const { isAdmin } = useHousehold();
  const onboarding = useOnboarding();
  if (!isAdmin || onboarding.data?.needsFirstObject !== true) return null;
  return (
    <EmptyState
      icon={<RocketLaunch size={24} aria-hidden />}
      title="Начните с первого объекта"
      actions={
        <Link className="btn btn--primary btn--block" to="/start">
          Настроить дом
        </Link>
      }
    >
      <p>
        В доме пока нет объектов. Выберите шаблон квартиры или дома: счета, счётчики и сроки
        создадутся сразу, а лишнее можно снять. Каждый шаг можно пропустить.
      </p>
    </EmptyState>
  );
}
