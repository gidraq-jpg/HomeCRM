import { useLayoutEffect, useRef } from 'react';
import { useLocation } from 'react-router';
import { AddAction } from '../shell/AddAction.tsx';
import { LinkTabs } from '../ui/LinkTabs.tsx';
import '../styles/studio2-lists.css';

/** Одна строка вкладок и доступный «+» на всех лентах Studio 2. */
export function TaskTabs({ houseQuery = '' }: { houseQuery?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const { pathname } = useLocation();
  useLayoutEffect(() => {
    const header = document.querySelector('.topbar');
    if (!header) return;
    const measure = () =>
      ref.current?.style.setProperty(
        '--task-header-height',
        `${header.getBoundingClientRect().height}px`,
      );
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(header);
    return () => observer.disconnect();
  }, []);
  // Прокручиваем только полосу, сохраняя вертикальную позицию страницы.
  // biome-ignore lint/correctness/useExhaustiveDependencies: прокрутка полосы после смены адреса
  useLayoutEffect(() => {
    const strip = ref.current?.querySelector<HTMLElement>('.tabs');
    if (!strip) return;
    const scrollActive = () => {
      const active = ref.current?.querySelector<HTMLElement>('[aria-current="page"]');
      if (!active) return;
      const target = active.getBoundingClientRect();
      const bounds = strip.getBoundingClientRect();
      if (target.left < bounds.left) strip.scrollLeft += target.left - bounds.left;
      else if (target.right > bounds.right) strip.scrollLeft += target.right - bounds.right;
    };
    scrollActive();
    const observer = new ResizeObserver(scrollActive);
    observer.observe(strip);
    const list = strip.querySelector('.tabs__list');
    if (list) observer.observe(list);
    return () => observer.disconnect();
  }, [pathname]);
  return (
    <div className="today-tabs" ref={ref}>
      <LinkTabs
        label="Ленты дел"
        items={[
          { to: `/today${houseQuery}`, label: 'Сегодня', end: true },
          { to: `/today/plan${houseQuery}`, label: 'План' },
          { to: `/today/all${houseQuery}`, label: 'Все дела' },
          { to: `/more/shopping${houseQuery}`, label: 'Покупки', end: true },
        ]}
      />
      <AddAction />
    </div>
  );
}
