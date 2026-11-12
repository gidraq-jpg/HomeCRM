import { shiftTaskDate } from '@homecrm/shared';
import { CaretLeft, CaretRight } from '@phosphor-icons/react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { plural } from '../ui/format.ts';
import { focusAfterTouch } from './TaskTabs.tsx';
export function PlanWeek({
  today,
  counts,
  jump,
  undated,
  openUndated,
  active,
}: {
  today: string;
  counts: Map<string, number>;
  jump: (date: string) => Promise<void>;
  undated: number;
  openUndated: () => void;
  active: boolean;
}) {
  const root = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    const header = document.querySelector('.topbar');
    const tabs = document.querySelector('.today-tabs');
    const measure = () => {
      if (root.current)
        root.current.style.top = `${(header?.getBoundingClientRect().height ?? 0) + (tabs?.getBoundingClientRect().height ?? 0)}px`;
      root.current?.parentElement?.style.setProperty(
        '--plan-top-inset',
        `${(header?.getBoundingClientRect().height ?? 0) + (tabs?.getBoundingClientRect().height ?? 0) + (root.current?.offsetHeight ?? 0)}px`,
      );
    };
    const observer = new ResizeObserver(measure);
    if (root.current) observer.observe(root.current);
    if (header) observer.observe(header);
    if (tabs) observer.observe(tabs);
    measure();
    return () => observer.disconnect();
  }, []);
  const [day, setDay] = useState(today);
  const [selectedDay, setSelectedDay] = useState(today);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!active) return;
    const track = () => {
      const top = document.querySelector('.plan-week')?.getBoundingClientRect().bottom ?? 200;
      const nodes = [...document.querySelectorAll<HTMLElement>('[data-plan-from]')];
      const node = nodes.find((el) => el.getBoundingClientRect().bottom > top);
      if (node?.dataset.planFrom) {
        const from = node.dataset.planFrom;
        const until = node.dataset.planUntil ?? from;
        setDay((current) => (current >= from && current <= until ? current : from));
      }
    };
    window.addEventListener('scroll', track, { passive: true });
    return () => window.removeEventListener('scroll', track);
  }, [active]);
  const selected = day || today;
  const weekday = new Date(`${selected}T12:00:00Z`).getUTCDay();
  const monday = shiftTaskDate(selected, -((weekday + 6) % 7));
  const selectedIndex = Array.from({ length: 7 }, (_, i) => shiftTaskDate(monday, i)).indexOf(
    selectedDay,
  );
  const choose = async (date: string) => {
    setSelectedDay(date);
    setBusy(true);
    try {
      await jump(date);
      setDay(date);
    } finally {
      setBusy(false);
    }
  };
  const minimum = shiftTaskDate(today, -365);
  return (
    <nav
      ref={root}
      className="plan-week"
      aria-label="Неделя плана"
      onPointerDown={(event) => {
        const button = event.target instanceof Element ? event.target.closest('button') : null;
        if (!button) return;
        // Стандартный перевод фокуса учитывает scroll-padding шапки и может сдвинуть страницу.
        event.preventDefault();
        if (event.pointerType === 'touch') focusAfterTouch(button);
        else button.focus({ preventScroll: true });
      }}
    >
      <div className="plan-week__heading">
        <button
          type="button"
          className="icon-button"
          aria-label="Предыдущая неделя"
          disabled={busy || monday <= minimum}
          onClick={() => setDay([shiftTaskDate(monday, -7), minimum].sort().at(-1) ?? minimum)}
        >
          <CaretLeft size={20} />
        </button>
        <span>
          {new Intl.DateTimeFormat('ru-RU', {
            month: 'long',
            year: 'numeric',
            timeZone: 'UTC',
          }).format(new Date(`${selected}T12:00:00Z`))}
        </span>
        <button
          type="button"
          className="icon-button"
          aria-label="Следующая неделя"
          disabled={busy}
          onClick={() => setDay(shiftTaskDate(monday, 7))}
        >
          <CaretRight size={20} />
        </button>
        {undated > 0 ? (
          <button type="button" className="text-button" onClick={openUndated}>
            Без даты · {undated}
          </button>
        ) : null}
      </div>
      <div className="plan-week__days">
        <span
          className="plan-week__selection"
          aria-hidden
          data-selected-date={selectedDay}
          style={{
            transform: `translateX(${Math.max(0, selectedIndex) * 100}%)`,
            opacity: selectedIndex < 0 ? 0 : 1,
          }}
        />
        {Array.from({ length: 7 }, (_, i) => {
          const date = shiftTaskDate(monday, i);
          const count = counts.get(date);
          const full = new Intl.DateTimeFormat('ru-RU', {
            dateStyle: 'full',
            timeZone: 'UTC',
          }).format(new Date(`${date}T12:00:00Z`));
          return (
            <button
              key={date}
              type="button"
              disabled={busy || date < minimum}
              aria-current={date === today ? 'date' : undefined}
              aria-pressed={date === selectedDay}
              data-has-tasks={count ? '' : undefined}
              aria-label={
                count === undefined
                  ? `${full}, дела не загружены`
                  : `${full}, ${count} ${plural(count, ['дело', 'дела', 'дел'])}`
              }
              onClick={() => void choose(date)}
            >
              <span>{['пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'вс'][i]}</span>
              <span>{Number(date.slice(-2))}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
