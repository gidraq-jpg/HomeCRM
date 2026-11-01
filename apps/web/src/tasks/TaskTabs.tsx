import { useLayoutEffect, useRef } from 'react';
import { flushSync } from 'react-dom';
import { useLocation, useNavigate } from 'react-router';
import { AddAction } from '../shell/AddAction.tsx';
import { cancelMotionNavigation } from '../shell/motion.tsx';
import { LinkTabs } from '../ui/LinkTabs.tsx';
import { motionTime, reducedMotion } from '../ui/motion.ts';
import { rowSwipeDirection, type SwipePoint, swipeDirection } from './swipe.ts';
import '../styles/studio2-lists.css';

/**
 * Фокус после жеста пальцем: вкладка получает фокус для экранного диктора и клавиатуры,
 * но Chromium считает программный фокус «клавиатурным» и рисует кольцо. Атрибут
 * `data-touch-focus` гасит кольцо (tokens.css) до первой клавиши или ухода фокуса.
 */
export function focusAfterTouch(element: HTMLElement) {
  element.setAttribute('data-touch-focus', '');
  const clear = () => {
    element.removeAttribute('data-touch-focus');
    element.removeEventListener('blur', clear);
    document.removeEventListener('keydown', clear, true);
  };
  element.addEventListener('blur', clear);
  document.addEventListener('keydown', clear, true);
  element.focus({ preventScroll: true, focusVisible: false });
}

/** Одна строка вкладок и доступный «+» на всех лентах Studio 2. */
export function TaskTabs({ houseQuery = '' }: { houseQuery?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const navigation = useRef(navigate);
  navigation.current = navigate;
  useLayoutEffect(() => {
    const main = document.getElementById('main');
    if (!main) return;
    main.dataset.taskFeed = '';
    let start: (SwipePoint & { pointerId: number; horizontal: boolean }) | null = null;
    let offset = 0;
    let returnAnimation: Animation | undefined;
    const preview = (show: boolean) => {
      const carousel = main.querySelector<HTMLElement>('.feed-carousel');
      if (!carousel) return;
      const track = carousel.querySelector<HTMLElement>('.feed-carousel__track');
      if (track && show && !carousel.hasAttribute('data-feed-preview'))
        track.style.minHeight = `${track.getBoundingClientRect().height}px`;
      if (track && !show && carousel.hasAttribute('data-feed-preview')) {
        const rect = track.getBoundingClientRect();
        const tail = document.documentElement.scrollHeight - rect.bottom - window.scrollY;
        track.style.minHeight = `${Math.max(0, window.innerHeight - rect.top - tail)}px`;
      }
      carousel.toggleAttribute('data-feed-preview', show);
      carousel.dispatchEvent(new Event('feed-preview'));
    };
    const finish = (animation: Animation | undefined) => {
      if (!animation) return preview(false);
      void animation.finished.then(
        () => {
          if (returnAnimation === animation) preview(false);
        },
        () => {},
      );
    };
    const content = () => main.querySelector<HTMLElement>('.feed-carousel__track');
    const links = () => [
      ...(ref.current?.querySelectorAll<HTMLAnchorElement>('.tabs__link') ?? []),
    ];
    const change = (next: HTMLAnchorElement, direction: number, _swiped = false) => {
      const root = document.documentElement;
      const node = content();
      const width = node?.getBoundingClientRect().width ?? 0;
      const from = offset + direction * width;
      returnAnimation?.cancel();
      cancelMotionNavigation();
      preview(true);
      flushSync(() => {
        void navigation.current(next.hash.slice(1));
      });
      if (node) node.style.transform = '';
      if (!node?.animate) {
        offset = 0;
        preview(false);
        return;
      }
      if (reducedMotion()) {
        returnAnimation = node?.animate([{ opacity: 0 }, { opacity: 1 }], {
          duration: motionTime('fast'),
          easing: getComputedStyle(root).getPropertyValue('--ease-out'),
        });
        offset = 0;
        finish(returnAnimation);
        return;
      }
      returnAnimation = node?.animate(
        [{ transform: `translateX(${from}px)` }, { transform: 'translateX(0)' }],
        {
          duration: motionTime('screen'),
          easing: getComputedStyle(root).getPropertyValue('--ease-out'),
        },
      );
      finish(returnAnimation);
      offset = 0;
    };
    let swallowClick = false;
    const blocked = () =>
      !!document.querySelector('[role="dialog"], [role="alertdialog"], dialog[open]') ||
      !!window.getSelection()?.toString();
    const cancel = () => {
      start = null;
      const node = content();
      if (node?.animate && offset) {
        node.style.transform = '';
        returnAnimation?.cancel();
        returnAnimation = node.animate(
          reducedMotion()
            ? [{ opacity: 0.85 }, { opacity: 1 }]
            : [{ transform: `translateX(${offset}px)` }, { transform: 'translateX(0)' }],
          {
            duration: motionTime(reducedMotion() ? 'fast' : 'close'),
            easing: getComputedStyle(document.documentElement).getPropertyValue('--ease-out'),
          },
        );
        finish(returnAnimation);
      } else preview(false);
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
      const nextIndex = index + (offset < 0 ? 1 : -1);
      if (
        items[nextIndex] &&
        main.querySelector(`[data-feed-pane="${nextIndex}"]`)?.getAttribute('data-feed-ready') !==
          'true'
      ) {
        offset = 0;
        return;
      }
      if (!reducedMotion()) preview(true);
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
      const ready =
        main
          .querySelector(`[data-feed-pane="${index + direction}"]`)
          ?.getAttribute('data-feed-ready') === 'true';
      if (direction && index >= 0 && next && ready) {
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
      const direction = items.indexOf(target) - index;
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
        focusAfterTouch(active);
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
