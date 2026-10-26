import { useHousehold } from '../household/HouseholdContext.tsx';
import { useNavigate } from '../shell/motion.tsx';
import { OperationNotice, useTaskOperation } from './operation.tsx';
export function TakeFromRadar({
  occurrenceId,
  assigneeId,
  label = 'Взять в работу',
}: {
  occurrenceId: string;
  assigneeId: string;
  label?: string;
}) {
  const { me, role } = useHousehold();
  const navigate = useNavigate();
  const operation = useTaskOperation((card) => navigate(`/today/tasks/${card.id}`));
  if (role === 'child' && assigneeId !== me.id) return null;
  return (
    <>
      <button
        className="btn btn--secondary"
        type="button"
        disabled={operation.pending}
        onClick={() => void operation.run({ path: 'tasks/from-radar', body: { occurrenceId } })}
      >
        {label}
      </button>
      <OperationNotice operation={operation} />
    </>
  );
}
