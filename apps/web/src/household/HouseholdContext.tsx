import type { Role } from '@homecrm/shared';
import { createContext, type ReactNode, useContext, useMemo } from 'react';
import type { Me } from '../auth/api.ts';

interface HouseholdContextValue {
  me: Me;
  /** Дом вошедшего участника. В MVP он один (SPACE-2); `null` — участник вышел из дома. */
  householdId: string | null;
  role: Role | null;
  /** Кнопки администратора видит только администратор: взрослый и ребёнок — нет (PRD 6.2). */
  isAdmin: boolean;
  /** Перечитать «кто я»: после смены имени или ухода из дома. */
  reloadMe: () => Promise<void>;
  signOut: () => void;
}

const HouseholdContext = createContext<HouseholdContextValue | null>(null);

interface HouseholdProviderProps {
  me: Me;
  reloadMe: () => Promise<void>;
  signOut: () => void;
  children: ReactNode;
}

export function HouseholdProvider({ me, reloadMe, signOut, children }: HouseholdProviderProps) {
  const value = useMemo<HouseholdContextValue>(() => {
    const membership = me.roles[0] ?? null;
    return {
      me,
      householdId: membership?.householdId ?? null,
      role: membership?.role ?? null,
      isAdmin: membership?.role === 'admin',
      reloadMe,
      signOut,
    };
  }, [me, reloadMe, signOut]);
  return <HouseholdContext.Provider value={value}>{children}</HouseholdContext.Provider>;
}

export function useHousehold(): HouseholdContextValue {
  const value = useContext(HouseholdContext);
  if (value === null) throw new Error('useHousehold нужно вызывать внутри HouseholdProvider');
  return value;
}
