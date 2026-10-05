import {
  CalendarCheck,
  CaretRight,
  Check,
  Clock,
  DotsThree,
  Plus,
  WarningCircle,
} from '@phosphor-icons/react';
import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { AccessBadge, AccessCaption } from '../../access/AccessBadge.tsx';
import { useScope } from '../../access/ScopeContext.tsx';
import { matchesScope } from '../../access/scope.ts';
import { CheckToggle } from '../../ui/CheckToggle.tsx';
import { ChipGroup } from '../../ui/ChipGroup.tsx';
import {
  addDays,
  countWord,
  type DateOnly,
  formatLongDate,
  formatShortDate,
  weekdayName,
} from '../../ui/format.ts';
import { LinkTabs } from '../../ui/LinkTabs.tsx';
import { Page, Section } from '../../ui/Page.tsx';
import { Row, RowList } from '../../ui/Row.tsx';
import { Sheet } from '../../ui/Sheet.tsx';
import { useToast } from '../../ui/Toast.tsx';
import { useAddRequest } from '../add-request.tsx';
import { ScopeEmpty } from '../components.tsx';
import { ME, personName, TODAY } from '../data/index.ts';
import type { TaskRecord } from '../model.ts';
import { buildRadar, openWindows, windowTitle } from '../radar.ts';
import { useAllRecords, usePrototype, useRecords } from '../store.tsx';

const TASK_TABS = [
  { to: '/today', label: 'Сегодня', end: true },
  { to: '/today/plan', label: 'План' },
  { to: '/today/all', label: 'Все дела' },
] as const;

function TaskTabs() {
  return <LinkTabs label="Дела" items={TASK_TABS} />;
}

function dateLabel(date: DateOnly): string {
  if (date === TODAY) return 'Сегодня';
  if (date === addDays(TODAY, 1)) return 'Завтра';
  return formatShortDate(date, TODAY);
}

function useTaskMeta() {
  const properties = useAllRecords('property');
  return (task: TaskRecord, withDate = false): string => {
    const parts: string[] = [];
    if (withDate) parts.push(task.when === null ? 'Без даты' : dateLabel(task.when));
    if (task.time) parts.push(task.time);
    const property = properties.find((item) => item.id === task.propertyId);
    if (property) parts.push(property.title);
    if (task.assignee !== ME) parts.push(`Исполнитель: ${personName(task.assignee)}`);
    if (task.status === 'waiting' && task.waiting) parts.push(task.waiting);
    return parts.join(' · ');
  };
}

/** Отметить дело выполненным или вернуть; выполнение можно отменить 7 секунд (TASK-7). */
function useToggleTask() {
  const { dispatch } = usePrototype();
  const toast = useToast();
  return (task: TaskRecord) => {
    const done = task.status !== 'done';
    dispatch({ type: 'setDone', id: task.id, done });
    toast.show({
      message: done ? 'Дело выполнено' : 'Дело возвращено в список',
      detail: task.title,
      action: {
        label: 'Отменить',
        onClick: () => dispatch({ type: 'setDone', id: task.id, done: !done }),
      },
    });
  };
}

interface TaskRowProps {
  task: TaskRecord;
  onOpen: (id: string) => void;
  withDate?: boolean;
}

function TaskRow({ task, onOpen, withDate = false }: TaskRowProps) {
  const toggle = useToggleTask();
  const meta = useTaskMeta();
  const done = task.status === 'done';
  const text = meta(task, withDate);
  return (
    <li className={done ? 'task-row task-row--done' : 'task-row'}>
      <CheckToggle checked={done} label={task.title} onChange={() => toggle(task)} />
      <button type="button" className="task-row__body" onClick={() => onOpen(task.id)}>
        <span className="row__title">{task.title}</span>
        {text ? <span className="row__meta">{text}</span> : null}
      </button>
      <AccessBadge visibility={task.visibility} />
    </li>
  );
}

function TaskList({
  tasks,
  onOpen,
  withDate,
}: Omit<TaskRowProps, 'task'> & { tasks: readonly TaskRecord[] }) {
  return (
    <ul className="task-list">
      {tasks.map((task) => (
        <TaskRow key={task.id} task={task} onOpen={onOpen} withDate={withDate} />
      ))}
    </ul>
  );
}

interface TaskSheetProps {
  task: TaskRecord | undefined;
  onClose: () => void;
}

function TaskSheet({ task, onClose }: TaskSheetProps) {
  const { dispatch } = usePrototype();
  const toggle = useToggleTask();
  const meta = useTaskMeta();
  const toast = useToast();
  return (
    <Sheet
      open={task !== undefined}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={task?.title ?? 'Дело'}
      description="Отметьте результат или сделайте дело главным на сегодня."
    >
      {task ? (
        <>
          <p className="muted">{meta(task, true)}</p>
          <div className="sheet__block">
            <AccessCaption visibility={task.visibility} />
          </div>
          <button
            type="button"
            className="btn btn--primary btn--block"
            onClick={() => {
              toggle(task);
              onClose();
            }}
          >
            {task.status === 'done' ? 'Вернуть в дела' : 'Отметить выполненным'}
          </button>
          {task.status !== 'done' ? (
            <button
              type="button"
              className="btn btn--secondary btn--block sheet__next"
              onClick={() => {
                dispatch({ type: 'setMain', id: task.id });
                toast.show({ message: 'Главное дело выбрано', detail: task.title });
                onClose();
              }}
            >
              Сделать главным на сегодня
            </button>
          ) : null}
        </>
      ) : null}
    </Sheet>
  );
}

function useTaskSheet(tasks: readonly TaskRecord[]) {
  const [taskId, setTaskId] = useState<string | null>(null);
  const task = tasks.find((item) => item.id === taskId);
  return {
    open: setTaskId,
    sheet: <TaskSheet task={task} onClose={() => setTaskId(null)} />,
  };
}

function ChooseMainSheet({
  open,
  onClose,
  candidates,
}: {
  open: boolean;
  onClose: () => void;
  candidates: readonly TaskRecord[];
}) {
  const { state, dispatch } = usePrototype();
  const toast = useToast();
  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      title="Главное на сегодня"
      description="Одно дело, которому вы хотите уделить внимание."
    >
      {candidates.length > 0 ? (
        <RowList>
          {candidates.map((task) => (
            <Row
              key={task.id}
              title={task.title}
              badge={task.visibility}
              chevron={state.mainTaskId !== task.id}
              aside={
                state.mainTaskId === task.id ? <Check size={22} aria-label="Выбрано" /> : undefined
              }
              onClick={() => {
                dispatch({ type: 'setMain', id: task.id });
                toast.show({ message: 'Главное дело выбрано', detail: task.title });
                onClose();
              }}
            />
          ))}
        </RowList>
      ) : (
        <p className="muted">
          Открытых дел на сегодня нет. Добавьте дело — и выберите его главным.
        </p>
      )}
    </Sheet>
  );
}

export function TodayScreen() {
  const { state, records } = usePrototype();
  const { scope } = useScope();
  const requestAdd = useAddRequest();
  const tasks = useRecords('task');
  const [showDone, setShowDone] = useState(false);
  const [choosing, setChoosing] = useState(false);
  const meta = useTaskMeta();
  const { open, sheet } = useTaskSheet(tasks);

  const radar = useMemo(
    () => buildRadar(records, state.readings, TODAY),
    [records, state.readings],
  );
  const urgent = radar.filter(
    (item) =>
      (item.group === 'overdue' || item.group === 'now') &&
      item.kind !== 'window' &&
      matchesScope(item.visibility, scope),
  );
  const windows = useMemo(
    () =>
      openWindows(records, state.readings, TODAY).filter(
        (window) => !window.transmitted && matchesScope(window.visibility, scope),
      ),
    [records, state.readings, scope],
  );

  const openTasks = tasks.filter((task) => task.status === 'open');
  const main = openTasks.find((task) => task.id === state.mainTaskId);
  const todays = openTasks.filter(
    (task) => task.id !== main?.id && task.when !== null && task.when <= TODAY,
  );
  const done = tasks.filter((task) => task.status === 'done' && task.when === TODAY);
  const nothing = !main && urgent.length === 0 && windows.length === 0 && todays.length === 0;

  return (
    <Page
      title="Сегодня"
      eyebrow={`${weekdayName(TODAY)}, ${formatLongDate(TODAY)}`}
      tabs={<TaskTabs />}
    >
      <Section title="Главное на сегодня" eyebrow>
        {main ? (
          <div className="focus">
            <h3 className="focus__title">{main.title}</h3>
            {meta(main) ? <p className="focus__meta">{meta(main)}</p> : null}
            <p className="focus__access">
              <AccessBadge visibility={main.visibility} showLabel />
            </p>
            <div className="focus__actions">
              <button type="button" className="btn btn--primary" onClick={() => open(main.id)}>
                Открыть дело
              </button>
              <button
                type="button"
                className="icon-button icon-button--soft"
                aria-label="Выбрать другое главное дело"
                onClick={() => setChoosing(true)}
              >
                <DotsThree size={26} weight="bold" aria-hidden />
              </button>
            </div>
          </div>
        ) : (
          <div className="focus">
            <h3 className="focus__title">Что сегодня важнее всего?</h3>
            <p className="focus__meta">Выберите одно дело для фокуса</p>
            <div className="focus__actions">
              <button type="button" className="btn btn--primary" onClick={() => setChoosing(true)}>
                Выбрать главное
              </button>
            </div>
          </div>
        )}
      </Section>

      {urgent.length > 0 ? (
        <Section title="Срочное" aside={<span className="muted">{urgent.length}</span>}>
          <RowList>
            {urgent.map((item) => (
              <Row
                key={item.id}
                to={item.to}
                icon={<WarningCircle size={22} weight="fill" aria-hidden />}
                iconTone="warning"
                title={item.title}
                meta={[item.group === 'overdue' ? 'Просрочено' : 'Сегодня', item.place, item.detail]
                  .filter(Boolean)
                  .join(' · ')}
                badge={item.visibility}
              />
            ))}
          </RowList>
        </Section>
      ) : null}

      {windows.length > 0 ? (
        <Section title="Открыто окно показаний">
          <div className="card-list">
            {windows.map((window) => (
              <article className="card window-card" key={window.propertyId}>
                <div className="window-card__head">
                  <h3 className="card__title">Показания: {windowTitle(window).toLowerCase()}</h3>
                  <AccessBadge visibility={window.visibility} />
                </div>
                <p className="card__meta">
                  {window.propertyTitle}
                  {window.status === 'rent' ? ' · сдаётся' : ''}
                  {window.status === 'live' ? ' · живём' : ''}
                </p>
                <p className="window-card__deadline">
                  <Clock size={18} aria-hidden />
                  Передать до {formatShortDate(window.until)} ·{' '}
                  {countWord(window.meterCount, ['счётчик', 'счётчика', 'счётчиков'])}
                </p>
                {window.status === 'rent' ? (
                  <p className="card__meta">Обычно показания передаёт арендатор.</p>
                ) : null}
                <Link
                  className="btn btn--primary btn--block window-card__action"
                  to={`/home/${window.propertyId}/readings`}
                  aria-label={`Внести показания: ${window.propertyTitle}`}
                >
                  Внести показания
                </Link>
              </article>
            ))}
          </div>
        </Section>
      ) : null}

      {todays.length > 0 ? (
        <Section title="Ещё на сегодня">
          <TaskList tasks={todays} onOpen={open} />
        </Section>
      ) : null}

      {nothing ? (
        <ScopeEmpty title="На сегодня ничего нет" addKind="task" addLabel="Добавить дело">
          Сегодня свободно. Добавьте дело — или отдохните.
        </ScopeEmpty>
      ) : null}

      {done.length > 0 ? (
        <section className="section">
          <button
            type="button"
            className="done-toggle"
            aria-expanded={showDone}
            onClick={() => setShowDone((value) => !value)}
          >
            {showDone ? 'Скрыть выполненное' : `Выполнено · ${done.length}`}
            <CaretRight size={18} className={showDone ? 'turned' : undefined} aria-hidden />
          </button>
          {showDone ? <TaskList tasks={done} onOpen={open} /> : null}
        </section>
      ) : null}

      {!nothing ? (
        <button
          type="button"
          className="btn btn--secondary btn--block"
          onClick={() => requestAdd('task')}
        >
          <Plus size={20} weight="bold" aria-hidden />
          Добавить дело
        </button>
      ) : null}

      {sheet}
      <ChooseMainSheet
        open={choosing}
        onClose={() => setChoosing(false)}
        candidates={openTasks.filter((task) => task.when === TODAY)}
      />
    </Page>
  );
}

/** «План»: лента дней от сегодняшнего; дела без даты — отдельно (TASK-5). */
export function PlanScreen() {
  const tasks = useRecords('task');
  const { open, sheet } = useTaskSheet(tasks);
  const days = Array.from({ length: 7 }, (_, index) => addDays(TODAY, index));
  const undated = tasks.filter((task) => task.when === null && task.status !== 'done');
  const anything = tasks.some((task) => task.status !== 'done');

  return (
    <Page
      title="План"
      eyebrow={`${formatLongDate(TODAY)} — ${formatLongDate(days[6] ?? TODAY)}`}
      tabs={<TaskTabs />}
    >
      {anything ? (
        <>
          {days.map((day) => {
            const dayTasks = tasks.filter((task) => task.when === day && task.status !== 'done');
            return (
              <Section
                key={day}
                title={`${day === TODAY ? 'Сегодня' : weekdayName(day)}, ${formatShortDate(day)}`}
              >
                {dayTasks.length > 0 ? (
                  <TaskList tasks={dayTasks} onOpen={open} />
                ) : (
                  <p className="muted">Дел нет. Свободный день.</p>
                )}
              </Section>
            );
          })}
          <Section title="Без даты">
            {undated.length > 0 ? (
              <TaskList tasks={undated} onOpen={open} />
            ) : (
              <p className="muted">Дел без даты нет.</p>
            )}
          </Section>
        </>
      ) : (
        <ScopeEmpty title="В плане пусто" addKind="task" addLabel="Добавить дело">
          Добавьте первое дело — оно появится в плане.
        </ScopeEmpty>
      )}
      {sheet}
    </Page>
  );
}

type TaskFilter = 'all' | 'mine' | 'others' | 'nodate' | 'waiting';

const TASK_FILTERS: readonly { value: TaskFilter; label: string }[] = [
  { value: 'all', label: 'Все' },
  { value: 'mine', label: 'Мои' },
  { value: 'others', label: 'Назначил другим' },
  { value: 'nodate', label: 'Без даты' },
  { value: 'waiting', label: 'Жду' },
];

function matchesTaskFilter(task: TaskRecord, filter: TaskFilter): boolean {
  switch (filter) {
    case 'all':
      return true;
    case 'mine':
      return task.assignee === ME;
    case 'others':
      return task.assignee !== ME;
    case 'nodate':
      return task.when === null;
    case 'waiting':
      return task.status === 'waiting';
  }
}

/** «Все дела»: фильтры «моё», «назначил другим», «без даты», «жду» (TASK-6). */
export function AllTasksScreen() {
  const tasks = useRecords('task');
  const [filter, setFilter] = useState<TaskFilter>('all');
  const { open, sheet } = useTaskSheet(tasks);
  const openTasks = tasks.filter((task) => task.status !== 'done');
  const shown = openTasks
    .filter((task) => matchesTaskFilter(task, filter))
    .sort((a, b) => (a.when ?? '9999-12-31').localeCompare(b.when ?? '9999-12-31'));

  return (
    <Page title="Все дела" eyebrow="Дела дома и ваши личные" tabs={<TaskTabs />}>
      {openTasks.length === 0 ? (
        <ScopeEmpty title="Открытых дел нет" addKind="task" addLabel="Добавить дело" />
      ) : (
        <>
          <div className="filters">
            <ChipGroup
              legend="Какие дела показать"
              value={filter}
              options={TASK_FILTERS}
              onChange={setFilter}
            />
          </div>
          {shown.length > 0 ? (
            <TaskList tasks={shown} onOpen={open} withDate />
          ) : (
            <div className="empty-inline">
              <CalendarCheck size={22} aria-hidden />
              <p className="muted">
                По этому фильтру дел нет. {countWord(openTasks.length, ['дело', 'дела', 'дел'])}{' '}
                открыто всего.
              </p>
            </div>
          )}
        </>
      )}
      {sheet}
    </Page>
  );
}
