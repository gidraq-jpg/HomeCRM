import type { HouseMember } from '../../access/who-sees.ts';
import type { DateOnly } from '../../ui/format.ts';
import type { Person, PersonId } from '../model.ts';

// Вымышленная семья Орловых. Настоящие данные семьи в репозиторий не попадают (AGENTS.md).

/** «Сегодня» в прототипе всегда один и тот же: в это время открыто окно показаний. */
export const TODAY: DateOnly = '2026-10-22';

/** Прототип показан глазами взрослого участника дома — не администратора. */
export const ME: PersonId = 'anna';

export const PEOPLE: readonly Person[] = [
  { id: 'anna', name: 'Анна', fullName: 'Анна Орлова', role: 'adult', birthday: '1989-03-14' },
  { id: 'igor', name: 'Игорь', fullName: 'Игорь Орлов', role: 'admin', birthday: '1987-07-02' },
  { id: 'nika', name: 'Ника', fullName: 'Ника Орлова', role: 'child', birthday: '2011-10-28' },
];

export const HOUSE_MEMBERS: readonly HouseMember[] = PEOPLE.map(({ id, name, role }) => ({
  id,
  name,
  role,
}));

export function personName(id: PersonId): string {
  return PEOPLE.find((person) => person.id === id)?.name ?? id;
}
