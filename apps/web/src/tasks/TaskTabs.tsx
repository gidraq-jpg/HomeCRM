import { useEffect, useLayoutEffect, useRef } from 'react';
import { useLocation } from 'react-router';
import { AddAction } from '../shell/AddAction.tsx';
import { LinkTabs } from '../ui/LinkTabs.tsx';
import { type SwipePoint, swipeDirection } from './swipe.ts';
import '../styles/studio2-lists.css';

/** Одна строка вкладок и доступный «+» на всех лентах Studio 2. */
export function TaskTabs({ houseQuery = '' }: { houseQuery?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const { pathname } = useLocation();
  useEffect(() => {
    const main = document.getElementById('main');
    if (!main) return;
    main.dataset.taskFeed = '';
    let start: (SwipePoint & { pointerId: number }) | null = null;
    let swallowClick = false;
    const blocked = () =>
      !!document.querySelector('[role="dialog"], [role="alertdialog"], dialog[open]') ||
      !!window.getSelection()?.toString();
    const cancel = () => {
      start = null;
    };
    const down = (event: PointerEvent) => {
      swallowClick = false;
      cancel();
      if (event.pointerType !== 'touch' || !event.isPrimary || blocked()) return;
      if (!(event.target instanceof Element)) return;
      if (
        event.target.closest(
          'input, textarea, select, button, [contenteditable], [draggable="true"], .today-tabs, .tabs, .studio-filters',
        )
      )
        return;
      for (
        let element: Element | null = event.target;
        element && element !== main;
        element = element.parentElement
      ) {
        if (['auto', 'scroll'].includes(getComputedStyle(element).overflowX)) return;
      }
      start = {
        x: event.clientX,
        y: event.clientY,
        time: event.timeStamp,
        pointerId: event.pointerId,
      };
    };
    const up = (event: PointerEvent) => {
      const origin = start;
      cancel();
      if (!origin || origin.pointerId !== event.pointerId || blocked()) return;
      const direction = swipeDirection(
        origin,
        { x: event.clientX, y: event.clientY, time: event.timeStamp },
        window.innerWidth,
      );
      const links = [...(ref.current?.querySelectorAll<HTMLAnchorElement>('.tabs__link') ?? [])];
      const index = links.findIndex((link) => link.getAttribute('aria-current') === 'page');
      const next = links[index + direction];
      if (direction && index >= 0 && next) {
        // Жест на ссылке не должен дополнительно открыть её после смены вкладки.
        swallowClick = true;
        main.dataset.taskSwipeTarget = next.getAttribute('href') ?? '';
        next.click();
      }
    };
    const click = (event: MouseEvent) => {
      if (!swallowClick || !event.isTrusted) return;
      swallowClick = false;
      event.preventDefault();
      event.stopPropagation();
    };
    main.addEventListener('pointerdown', down);
    main.addEventListener('pointerup', up);
    main.addEventListener('pointercancel', cancel);
    main.addEventListener('dragstart', cancel);
    main.addEventListener('click', click, true);
    return () => {
      delete main.dataset.taskFeed;
      main.removeEventListener('pointerdown', down);
      main.removeEventListener('pointerup', up);
      main.removeEventListener('pointercancel', cancel);
      main.removeEventListener('dragstart', cancel);
      main.removeEventListener('click', click, true);
    };
  }, []);
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
      const main = document.getElementById('main');
      if (main?.dataset.taskSwipeTarget === active.getAttribute('href')) {
        active.focus({ preventScroll: true });
        delete main.dataset.taskSwipeTarget;
      }
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
      <span className="visually-hidden" role="status" aria-live="polite">
        {pathname === '/today'
          ? 'Сегодня'
          : pathname === '/today/plan'
            ? 'План'
            : pathname === '/today/all'
              ? 'Все дела'
              : 'Покупки'}
      </span>
    </div>
  );
}
