import { CalendarDate } from '@homecrm/shared';
import { useSearchParams } from 'react-router';
import { useHousehold } from '../household/HouseholdContext.tsx';
import { todayIn } from '../objects/dates.ts';
import { Sheet } from '../ui/Sheet.tsx';
import { Quickline } from './Quickline.tsx';
import { useToday } from './queries.ts';

export function QuickAddSheet({
  open,
  onOpenChange,
  house,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  house?: string | null;
}) {
  const { me, householdId } = useHousehold();
  const [params] = useSearchParams();
  const fromUrl = params.get('householdId');
  const selected =
    house === undefined
      ? me.roles.some((role) => role.householdId === fromUrl)
        ? fromUrl
        : householdId
      : house;
  const query = useToday(selected);
  const timeZone = query.data?.timeZone ?? (selected === householdId ? me.timeZone : null);
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title="Новое дело"
      description="Одной строкой — дату, время, @кого и #где поймём сами"
    >
      {timeZone ? (
        <Quickline
          key={selected}
          householdId={selected}
          timeZone={timeZone}
          today={CalendarDate.parse(todayIn(timeZone))}
          onCreated={() => onOpenChange(false)}
        />
      ) : (
        <p className="muted">
          {query.error
            ? 'Не удалось загрузить часовой пояс дома. Закройте лист и повторите.'
            : 'Загружаем часовой пояс дома…'}
        </p>
      )}
    </Sheet>
  );
}
