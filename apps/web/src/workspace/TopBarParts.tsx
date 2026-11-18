import { useSearchParams } from 'react-router';
import { Avatar } from '../household/components.tsx';
import { useHousehold } from '../household/HouseholdContext.tsx';
import { useMyProfile } from '../household/queries.ts';
import { useToday } from '../tasks/queries.ts';
import { useTodayGreeting } from '../tasks/TodayHero.tsx';

/** Дата в шапке «Сегодня»: по дому из адреса, если участник в нём состоит. */
export function TodayDate() {
  const { me, householdId } = useHousehold();
  const [params] = useSearchParams();
  const requested = params.get('householdId');
  const house = me.roles.some((role) => role.householdId === requested) ? requested : householdId;
  const query = useToday(house);
  const { date } = useTodayGreeting(query.data, query.error, house);
  return <span className="topbar__date">{date}</span>;
}

/** Аватар участника в шапке «Сегодня». */
export function TodayAvatar() {
  const { me } = useHousehold();
  const profile = useMyProfile();
  return (
    <Avatar
      name={profile.data?.displayName || me.displayName}
      photoFileId={profile.data?.photoFileId}
    />
  );
}
