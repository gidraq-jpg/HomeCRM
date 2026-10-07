import { useOutletContext } from 'react-router';
import { useHousehold } from '../household/HouseholdContext.tsx';
import { useMembers } from '../household/queries.ts';
import type { ObjectAbilities } from './abilities.ts';
import type { ObjectCard } from './api.ts';

/** Что вкладки карточки получают от экрана объекта: свежая карточка и права на неё. */
export interface ObjectContext {
  card: ObjectCard;
  abilities: ObjectAbilities;
}

export function useObjectContext(): ObjectContext {
  return useOutletContext<ObjectContext>();
}

/** Имя участника по идентификатору: «Вы», имя из состава дома или нейтральное «участник дома». */
export function usePersonName(): (accountId: string | null | undefined) => string {
  const { me } = useHousehold();
  const members = useMembers();
  return (accountId) => {
    if (accountId === null || accountId === undefined) return 'не назначен';
    if (accountId === me.id) return 'Вы';
    const member = members.data?.find((item) => item.accountId === accountId);
    if (member === undefined) return 'участник дома';
    return member.formerMember ? `${member.displayName} (бывший участник)` : member.displayName;
  };
}
