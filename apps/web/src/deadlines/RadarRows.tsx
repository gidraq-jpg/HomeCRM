import { CalendarBlank, DotsThreeVertical, Drop, FileText, Receipt } from '@phosphor-icons/react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { useHousehold } from '../household/HouseholdContext.tsx';
import { PROPERTY_STATUS_LABELS } from '../property/property.ts';
import { useTaskMembers } from '../tasks/options.tsx';
import { TakeFromRadar } from '../tasks/TakeFromRadar.tsx';
import { formatRub } from '../ui/format.ts';
import { RowContent, RowList } from '../ui/Row.tsx';
import { Sheet } from '../ui/Sheet.tsx';
import { KIND_LABELS } from './labels.ts';
import { OccurrenceActions } from './OccurrenceActions.tsx';
import type { RadarRow } from './radar.ts';
import { UtilityActions } from './UtilityActions.tsx';
import './radar-rows.css';

function RadarContent({ row }: { row: RadarRow }) {
  const { me, householdId } = useHousehold();
  const item = row.item;
  const other = row.assigneeId !== me.id;
  const house = item?.spaceKind === 'household' ? item.spaceId : householdId;
  const members = useTaskMembers(house, other);
  const assignee = other
    ? members.data?.find((person) => person.accountId === row.assigneeId)?.displayName
    : undefined;
  return (
    <RowContent
      icon={
        item?.sourceKind === 'readings' || item?.sourceKind === 'verification' ? (
          <Drop size={22} aria-hidden />
        ) : item?.sourceKind === 'payment' ? (
          <Receipt size={22} aria-hidden />
        ) : item?.sourceKind === 'document' ? (
          <FileText size={22} aria-hidden />
        ) : (
          <CalendarBlank size={22} aria-hidden />
        )
      }
      iconTone={
        row.group === 'overdue'
          ? 'warning'
          : item?.sourceKind === 'readings' || item?.sourceKind === 'verification'
            ? 'water'
            : 'accent'
      }
      title={row.title ?? 'Запись не найдена'}
      meta={[
        `${item?.sourceKind === 'record' && item.rule ? KIND_LABELS[item.rule.kind] : row.what}, ${row.when} · ${row.relative}`,
        row.utility?.source,
        row.utility?.status ? PROPERTY_STATUS_LABELS[row.utility.status] : null,
        row.utility?.remainingCents == null
          ? null
          : `осталось ${formatRub(row.utility.remainingCents)}`,
        assignee ? `→ ${assignee}` : null,
        item?.actionState?.status === 'dismissed'
          ? `Не актуально: ${item.actionState.reason}`
          : item?.actionState?.status === 'snoozed'
            ? 'Отложено до указанной даты'
            : null,
      ]
        .filter(Boolean)
        .join(' · ')}
      badge={row.visibility}
    />
  );
}

/** Одна компактная строка для «Сегодня» и радара; все дополнительные действия — в листе. */
export function RadarRows({ rows, label }: { rows: readonly RadarRow[]; label: string }) {
  const [menu, setMenu] = useState<RadarRow | null>(null);
  useEffect(() => {
    if (menu && !rows.some((row) => row.id === menu.id)) setMenu(null);
  }, [menu, rows]);
  const hidden =
    menu?.item?.actionState?.status === 'dismissed' ||
    (menu?.item?.actionState?.status === 'snoozed' &&
      new Date(menu.item.actionState.snoozedUntil ?? 0) > new Date());
  return (
    <>
      <RowList label={label}>
        {rows.map((row) => {
          const to = row.item?.taskId ? `/today/tasks/${row.item.taskId}` : row.to;
          return (
            <li
              key={row.id}
              className={
                row.group === 'overdue'
                  ? 'compact-radar-row compact-radar-row--overdue'
                  : 'compact-radar-row'
              }
            >
              {to ? (
                <Link className="row compact-radar-row__record" to={to}>
                  <RadarContent row={row} />
                </Link>
              ) : (
                <div className="row compact-radar-row__record">
                  <RadarContent row={row} />
                </div>
              )}
              <button
                className="icon-button"
                type="button"
                aria-label={`Ещё действия: ${row.title ?? 'срок'}`}
                aria-haspopup="dialog"
                aria-expanded={menu?.id === row.id}
                onClick={() => setMenu(row)}
              >
                <DotsThreeVertical size={22} aria-hidden />
              </button>
            </li>
          );
        })}
      </RowList>
      {menu ? (
        <Sheet
          open
          title={`Действия: ${menu.title ?? 'срок'}`}
          description={`${menu.what} · ${menu.when} · ${menu.relative}`}
          onOpenChange={(open) => {
            if (!open) setMenu(null);
          }}
        >
          {!hidden && menu.utility ? (
            <UtilityActions utility={menu.utility} withOpen={false} compact />
          ) : null}
          {!hidden &&
          menu.item?.primaryAction?.kind === 'renew_document' &&
          menu.item.documentId ? (
            <Link
              className="btn btn--secondary"
              to={`/documents/${menu.item.documentId}?action=renew`}
              onClick={() => setMenu(null)}
            >
              Продлить
            </Link>
          ) : null}
          {!hidden && menu.item?.taskId ? (
            <Link
              className="text-button"
              to={`/today/tasks/${menu.item.taskId}`}
              onClick={() => setMenu(null)}
            >
              Открыть дело
            </Link>
          ) : !hidden && menu.item?.canWrite && menu.item.sourceKind !== 'birthday' ? (
            <TakeFromRadar occurrenceId={menu.id} assigneeId={menu.assigneeId} label="В работу" />
          ) : null}
          <OccurrenceActions row={menu} menuOnly onSaved={() => setMenu(null)} />
          {menu.utility ? (
            <Link
              className="text-button"
              to={`/home/${menu.utility.objectId}`}
              onClick={() => setMenu(null)}
            >
              Открыть объект
            </Link>
          ) : null}
          {menu.to ? (
            <Link className="text-button" to={menu.to} onClick={() => setMenu(null)}>
              {menu.utility?.openLabel ?? 'Открыть запись'}
            </Link>
          ) : null}
        </Sheet>
      ) : null}
    </>
  );
}
