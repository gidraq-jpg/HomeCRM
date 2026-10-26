import { CheckCircle, Trash } from '@phosphor-icons/react';
import { useLayoutEffect, useRef } from 'react';
import { flushSync } from 'react-dom';
import { useLocation, useNavigate } from 'react-router';
import { AddAction } from '../shell/AddAction.tsx';
import { cancelMotionNavigation, changeScreenWithMotion, Link } from '../shell/motion.tsx';
import { LinkTabs } from '../ui/LinkTabs.tsx';
import { motionTime, reducedMotion } from '../ui/motion.ts';
import { rowSwipeDirection, type SwipePoint, swipeDirection } from './swipe.ts';
import '../styles/studio2-lists.css';

/** Одна строка вкладок и доступный «+» на всех лентах Studio 2. */
export function TaskTabs({ houseQuery = '' }: { houseQuery?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const { pathname } = useLocation();
  const navigate = useNavigate();
  useLayoutEffect(() => {
    const main = document.getElementById('main');
    if (!main) return;
    main.dataset.taskFeed = '';
    let start: (SwipePoint & { pointerId: number; horizontal: boolean }) | null = null;
    let offset = 0;
    let returnAnimation: Animation | undefined;
    const content = () => main.querySelector<HTMLElement>('.task-feed-content');
    const links = () => [
      ...(ref.current?.querySelectorAll<HTMLAnchorElement>('.tabs__link') ?? []),
    ];
    const change = (next: HTMLAnchorElement, direction: number, swiped = false) => {
      const root = document.documentElement;
      if (reducedMotion()) {
        cancelMotionNavigation();
        flushSync(() => {
          void navigate(next.hash.slice(1));
        });
        content()?.animate([{ opacity: 0 }, { opacity: 1 }], {
          duration: motionTime('fast'),
          easing: getComputedStyle(root).getPropertyValue('--ease-out'),
        });
        offset = 0;
        return;
      }
      root.dataset.motionFeed = swiped ? 'swipe' : 'tab';
      root.style.setProperty('--feed-start', `${offset}px`);
      root.style.setProperty('--feed-sign', String(direction));
      const node = content();
      if (node) node.style.transform = '';
      changeScreenWithMotion(direction > 0 ? 'forward' : 'back', () => {
        void navigate(next.hash.slice(1));
      });
      offset = 0;
    };
    let swallowClick = false;
    const blocked = () =>
      !!document.querySelector('[role="dialog"], [role="alertdialog"], dialog[open]') ||
      !!window.getSelection()?.toString();
    const cancel = () => {
      start = null;
      const node = content();
      if (node && offset) {
        node.style.transform = '';
        returnAnimation?.cancel();
        returnAnimation = node.animate(
          reducedMotion()
            ? [{ opacity: 0.85 }, { opacity: 1 }]
            : [{ transform: `translateX(${offset}px)` }, { transform: 'translateX(0)' }],
          {
            duration: motionTime(reducedMotion() ? 'fast' : 'base'),
            easing: getComputedStyle(document.documentElement).getPropertyValue('--ease-out'),
          },
        );
      }
      offset = 0;
    };
    const down = (event: PointerEvent) => {
      swallowClick = false;
      cancel();
      if (event.pointerType !== 'touch' || !event.isPrimary || blocked()) return;
      if (!(event.target instanceof Element)) return;
      const snapshot =
        event.target === document.documentElement && !!document.documentElement.dataset.motionFeed;
      if (!main.contains(event.target) && !snapshot) return;
      if (snapshot) {
        const box = main.getBoundingClientRect();
        if (event.clientY < box.top || event.clientY > box.bottom) return;
        const excluded = [
          ...main.querySelectorAll(
            'input, textarea, select, button, .today-tabs, .studio-filters, .swipe-task',
          ),
        ].some((node) => {
          const bounds = node.getBoundingClientRect();
          return (
            event.clientX >= bounds.left &&
            event.clientX <= bounds.right &&
            event.clientY >= bounds.top &&
            event.clientY <= bounds.bottom
          );
        });
        // Chromium во время снимка адресует следующий жест корню документа.
        // Прерываем только рисунок, сохраняя уже выбранную вкладку.
        cancelMotionNavigation();
        if (excluded) return;
      }
      if (
        event.target.closest(
          'input, textarea, select, button, [contenteditable], [draggable="true"], .swipe-task, .today-tabs, .tabs, .studio-filters',
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
        horizontal: false,
      };
    };
    const move = (event: PointerEvent) => {
      if (!start || start.pointerId !== event.pointerId) return;
      const end = { x: event.clientX, y: event.clientY, time: event.timeStamp };
      if (
        !start.horizontal &&
        Math.abs(end.y - start.y) > 12 &&
        !rowSwipeDirection(start, end, window.innerWidth)
      ) {
        cancel();
        return;
      }
      if (!start.horizontal && !rowSwipeDirection(start, end, window.innerWidth)) return;
      start.horizontal = true;
      main.setPointerCapture(event.pointerId);
      returnAnimation?.cancel();
      const items = links();
      const index = items.findIndex((link) => link.getAttribute('aria-current') === 'page');
      offset = event.clientX - start.x;
      if (!items[index + (offset < 0 ? 1 : -1)]) offset *= 0.3;
      const node = content();
      if (node && !reducedMotion()) node.style.transform = `translateX(${offset}px)`;
    };
    const up = (event: PointerEvent) => {
      const origin = start;
      start = null;
      if (
        !origin ||
        origin.pointerId !== event.pointerId ||
        blocked() ||
        (event.target instanceof Element && event.target.closest('[data-row-gesture]'))
      ) {
        cancel();
        return;
      }
      const direction = swipeDirection(
        origin,
        { x: event.clientX, y: event.clientY, time: event.timeStamp },
        window.innerWidth,
      );
      const items = links();
      const index = items.findIndex((link) => link.getAttribute('aria-current') === 'page');
      const next = items[index + direction];
      if (direction && index >= 0 && next) {
        // Жест на ссылке не должен дополнительно открыть её после смены вкладки.
        swallowClick = true;
        main.dataset.taskSwipeTarget = next.getAttribute('href') ?? '';
        change(next, direction, true);
      } else {
        swallowClick = !!origin?.horizontal;
        cancel();
      }
    };
    const click = (event: MouseEvent) => {
      if (swallowClick && event.isTrusted) {
        swallowClick = false;
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      const target =
        event.target instanceof Element
          ? event.target.closest<HTMLAnchorElement>('.tabs__link')
          : null;
      if (
        !target ||
        !ref.current?.contains(target) ||
        event.button ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey ||
        event.altKey
      )
        return;
      const items = links();
      const index = items.findIndex((link) => link.getAttribute('aria-current') === 'page');
      const direction = Math.sign(items.indexOf(target) - index);
      if (!direction) return;
      event.preventDefault();
      event.stopPropagation();
      change(target, direction);
    };
    document.addEventListener('pointerdown', down);
    document.addEventListener('pointerup', up);
    document.addEventListener('pointermove', move);
    document.addEventListener('pointercancel', cancel);
    main.addEventListener('dragstart', cancel);
    main.addEventListener('click', click, true);
    return () => {
      delete main.dataset.taskFeed;
      document.removeEventListener('pointerdown', down);
      document.removeEventListener('pointerup', up);
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointercancel', cancel);
      main.removeEventListener('dragstart', cancel);
      main.removeEventListener('click', click, true);
      returnAnimation?.cancel();
      const node = content();
      if (node) node.style.transform = '';
    };
  }, [navigate]);
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
      <Link
        className="icon-button"
        to="/more/trash"
        aria-label="Корзина"
        data-motion-target="trash"
      >
        <Trash size={22} aria-hidden />
      </Link>
      <Link
        className="icon-button"
        to={`/today/all${houseQuery ? `${houseQuery}&` : '?'}status=done`}
        aria-label="Выполнено"
        data-motion-target="done"
      >
        <CheckCircle size={22} aria-hidden />
      </Link>
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
