import { useCallback, useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import {
  type LinkProps,
  type NavigateFunction,
  type NavigateOptions,
  Link as RouterLink,
  resolvePath,
  type To,
  useLocation,
  useResolvedPath,
  useNavigate as useRouterNavigate,
} from 'react-router';

import { motionTime } from '../ui/motion.ts';
import {
  type CardOrigin,
  cardOrigins,
  currentCardOrigin,
  originLink,
  originTitle,
  requestPosition,
  saveCurrentPosition,
} from './navigation-position.ts';

const feeds = new Set(['/today', '/today/plan', '/today/all', '/more/shopping']);
const sections = new Set(['/today', '/home', '/documents', '/people', '/more']);

/** Вкладки меняют контекст, карточки и формы добавляют уровень. */
export function motionDirection(from: string, to: string): 'forward' | 'back' | null {
  if (from === to || (sections.has(from) && sections.has(to)) || (feeds.has(from) && feeds.has(to)))
    return null;
  const form = (path: string) => /\/(new|edit|invite)$/.test(path);
  if (form(to)) return 'forward';
  if (form(from)) return 'back';
  const depth = (path: string) => path.split('/').filter(Boolean).length;
  if (depth(to) < depth(from)) return 'back';
  if (depth(to) > depth(from)) return 'forward';
  return null;
}

let current: ViewTransition | undefined;
let epoch = 0;
let historyUpdate: (() => void) | undefined;
let dockCleanup: (() => void) | undefined;
let cardTitleCleanup: (() => void) | undefined;

/** Панель остаётся живой: D30 не снимает её вместе с экраном раздела. */
export function changeDockScreen(button: DOMRect, update: () => void) {
  saveCurrentPosition();
  cancelMotionNavigation();
  const main = document.querySelector<HTMLElement>('.main');
  if (!main?.animate) return update();
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const rect = main.getBoundingClientRect();
  const old = main.cloneNode(true) as HTMLElement;
  old.removeAttribute('id');
  for (const child of old.querySelectorAll('[id]')) child.removeAttribute('id');
  old.inert = true;
  old.setAttribute('aria-hidden', 'true');
  old.dataset.dockGhost = '';
  Object.assign(old.style, {
    position: 'fixed',
    left: `${rect.left}px`,
    top: `${rect.top}px`,
    width: `${rect.width}px`,
    height: `${rect.height}px`,
    margin: '0',
    pointerEvents: 'none',
    overflow: 'hidden',
    zIndex: '1',
    viewTransitionName: 'none',
  });
  main.after(old);
  flushSync(update);
  const next = main.getBoundingClientRect();
  const ease = getComputedStyle(document.documentElement).getPropertyValue('--ease-out').trim();
  const originalStyle = main.getAttribute('style');
  Object.assign(main.style, {
    position: 'relative',
    zIndex: '2',
    background: 'var(--paper)',
    borderRadius: '32px',
    overflow: 'clip',
    boxShadow: '0 12px 40px rgb(0 0 0 / 24%)',
  });
  const growth = `translate(${button.left - next.left}px, ${button.top - next.top}px) scale(${button.width / next.width}, ${button.height / next.height})`;
  const children = [...main.children].filter(
    (child): child is HTMLElement => child instanceof HTMLElement,
  );
  const animations = [
    old.animate([{ opacity: 1 }, { opacity: 0 }], {
      duration: reduce ? 120 : 200,
      fill: 'forwards',
    }),
    ...(reduce
      ? [
          main.animate([{ opacity: 0 }, { opacity: 1 }], {
            duration: motionTime('fast'),
            easing: ease,
          }),
        ]
      : children.map((child) =>
          child.animate([{ opacity: 0 }, { opacity: 1 }], {
            duration: motionTime('fast'),
            delay: motionTime('screen') - motionTime('fast'),
            easing: ease,
            fill: 'backwards',
          }),
        )),
  ];
  if (!reduce)
    animations.push(
      main.animate(
        [
          { transform: growth, transformOrigin: '0 0' },
          { transform: 'translate(0px, 0px) scale(1, 1)', transformOrigin: '0 0' },
        ],
        { duration: motionTime('screen'), easing: ease },
      ),
    );
  const cleanup = () => {
    for (const animation of animations) animation.cancel();
    old.remove();
    if (originalStyle === null) main.removeAttribute('style');
    else main.setAttribute('style', originalStyle);
    if (dockCleanup === cleanup) dockCleanup = undefined;
  };
  dockCleanup = cleanup;
  void animations.at(-1)?.finished.then(cleanup, cleanup);
}
/** Возврат по истории не должен быть затёрт ещё не снявшим снимок переходом. */
export function cancelMotionNavigation() {
  cardTitleCleanup?.();
  dockCleanup?.();
  // HashRouter уже обработал наш popstate; завершаем снимок нового экрана.
  if (historyUpdate) {
    const finish = historyUpdate;
    historyUpdate = undefined;
    flushSync(() => {});
    finish();
    return;
  }
  epoch++;
  current?.skipTransition();
  current = undefined;
  delete document.documentElement.dataset.motionCard;
  delete document.documentElement.dataset.motionDirection;
  delete document.documentElement.dataset.motionHeader;
  delete document.documentElement.dataset.motionFeed;
}
export function navigateWithMotion(from: string, to: string, navigate: () => void) {
  const direction = motionDirection(from, to);
  changeScreenWithMotion(direction, navigate);
}

export function changeScreenWithMotion(
  direction: 'forward' | 'back' | null,
  update: () => void | Promise<void>,
  card?: CardOrigin,
) {
  saveCurrentPosition();
  cardTitleCleanup?.();
  dockCleanup?.();
  if (
    document.documentElement.dataset.design !== 'studio' ||
    !document.startViewTransition ||
    !direction
  ) {
    cancelMotionNavigation();
    update();
    return;
  }
  current?.skipTransition();
  const activeEpoch = ++epoch;
  const titles: { node: HTMLElement; name: string }[] = [];
  const nameTitle = (node: HTMLElement | null | undefined) => {
    if (!node) return;
    titles.push({ node, name: node.style.viewTransitionName });
    node.style.viewTransitionName = 'card-title';
  };
  const clearTitles = () => {
    for (const { node, name } of titles) node.style.viewTransitionName = name;
    if (cardTitleCleanup === clearTitles) cardTitleCleanup = undefined;
  };
  if (card) {
    nameTitle(direction === 'forward' ? originTitle(card) : document.querySelector('.main h1'));
    cardTitleCleanup = clearTitles;
  }
  document.documentElement.dataset.motionDirection = direction;
  const oldRect = card ? document.querySelector('.main')?.getBoundingClientRect() : undefined;
  const header = document.querySelector?.('.topbar');
  const before = header ? `${(header as HTMLElement).offsetHeight}:${header.innerHTML}` : '';
  const transition = document.startViewTransition(() => {
    if (activeEpoch !== epoch) return;
    try {
      const result = flushSync(update);
      const compareHeader = () => {
        if (card) {
          nameTitle(direction === 'back' ? originTitle(card) : document.querySelector('.main h1'));
          const screen =
            direction === 'back'
              ? oldRect
              : document.querySelector('.main')?.getBoundingClientRect();
          const source =
            direction === 'back' ? originLink(card)?.getBoundingClientRect() : card.rect;
          if (screen?.width && screen.height && source?.width && source.height) {
            document.documentElement.dataset.motionCard = direction ?? undefined;
            document.documentElement.style.setProperty(
              '--card-transform',
              `translate(${source.left - screen.left}px, ${source.top - screen.top}px) scale(${source.width / screen.width}, ${source.height / screen.height})`,
            );
          }
        }
        const after = header ? `${(header as HTMLElement).offsetHeight}:${header.innerHTML}` : '';
        if (before !== after) document.documentElement.dataset.motionHeader = 'changed';
      };
      if (result) return result.then(compareHeader);
      compareHeader();
    } catch (error) {
      reportError(error);
      throw error;
    }
  });
  current = transition;
  // Отмена или несостоявшийся снимок меняют только рисунок; ошибка обновления сообщается выше.
  void transition.ready?.catch(() => {});
  const clear = () => {
    if (cardTitleCleanup === clearTitles) clearTitles();
    if (current !== transition) return;
    current = undefined;
    delete document.documentElement.dataset.motionCard;
    delete document.documentElement.dataset.motionDirection;
    delete document.documentElement.dataset.motionHeader;
    delete document.documentElement.dataset.motionFeed;
  };
  void transition.finished.then(clear, clear);
}

/** Полноэкранная правка может быть режимом карточки, сохраняя её адрес и черновик. */
export function useScreenMode<T>(initial: T | (() => T), isForm: (mode: T) => boolean) {
  const [value, setValue] = useState(initial);
  const form = useRef(isForm(value));
  const mode = useRef(value);
  const previousMode = useRef(value);
  const predicate = useRef(isForm);
  predicate.current = isForm;
  const set = useCallback((next: T, alongside?: () => void) => {
    const nextForm = predicate.current(next);
    const previous = form.current;
    const update = () => {
      if (nextForm && !previous) previousMode.current = mode.current;
      form.current = nextForm;
      mode.current = next;
      setValue(next);
      alongside?.();
    };
    if (previous === nextForm) update();
    else changeScreenWithMotion(nextForm ? 'forward' : 'back', update);
  }, []);
  const reset = useCallback((next: T) => {
    form.current = predicate.current(next);
    mode.current = next;
    setValue(next);
  }, []);
  useEffect(() => {
    if (!predicate.current(value)) return;
    // Локальная форма сохраняет адрес карточки: её «Назад» закрывает режим.
    const back = (event: MouseEvent) => {
      if (
        event.defaultPrevented ||
        event.button ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey ||
        !(event.target instanceof Element) ||
        !event.target.closest('.ui7-fullscreen-form .ui7-form-heading .back-link')
      )
        return;
      event.preventDefault();
      event.stopPropagation();
      set(previousMode.current);
    };
    document.addEventListener('click', back, true);
    return () => document.removeEventListener('click', back, true);
  }, [set, value]);
  return [value, set, reset] as const;
}

/** Снимок делается до history.go, новый — после popstate HashRouter. */
export function navigateHistoryWithMotion(delta: number, navigate: NavigateFunction) {
  if (window.history.state?.idx === 0 && delta < 0) return navigate(delta);
  if (!document.startViewTransition || document.documentElement.dataset.design !== 'studio') {
    cancelMotionNavigation();
    return navigate(delta);
  }
  // Повторное нажатие во время history.go не запускает второй обход истории.
  if (historyUpdate) return;
  changeScreenWithMotion(
    delta < 0 ? 'back' : 'forward',
    () =>
      new Promise<void>((resolve) => {
        historyUpdate = resolve;
        void navigate(delta);
      }),
    delta === -1 ? currentCardOrigin() : undefined,
  );
}

/** HashRouter остаётся декларативным; системная история работает мгновенно. */
export function useNavigate(): NavigateFunction {
  const navigate = useRouterNavigate();
  const { pathname } = useLocation();
  return useCallback(
    (to: To | number, options?: NavigateOptions) => {
      if (typeof to === 'number') {
        return navigateHistoryWithMotion(to, navigate);
      }
      navigateWithMotion(pathname, resolvePath(to, pathname).pathname, () => {
        void navigate(to, options);
      });
    },
    [navigate, pathname],
  );
}

export function Link({ onClick, target, reloadDocument, ...props }: LinkProps) {
  const navigate = useRouterNavigate();
  const from = useLocation();
  const to = useResolvedPath(props.to, { relative: props.relative });
  return (
    <RouterLink
      {...props}
      target={target}
      reloadDocument={reloadDocument}
      onClick={(event) => {
        onClick?.(event);
        if (
          event.defaultPrevented ||
          event.button !== 0 ||
          event.metaKey ||
          event.ctrlKey ||
          event.altKey ||
          event.shiftKey ||
          (target && target !== '_self') ||
          reloadDocument
        )
          return;
        const direction = event.currentTarget.classList.contains('back-link')
          ? 'back'
          : motionDirection(from.pathname, to.pathname);
        if (
          document.documentElement.dataset.design !== 'studio' ||
          !direction ||
          event.currentTarget.closest('.tabs, .bottom-nav, .side-nav')
        ) {
          cancelMotionNavigation();
          return;
        }
        event.preventDefault();
        const returning = currentCardOrigin();
        const row = event.currentTarget.closest<HTMLElement>(
          '.row, .task-row, .plan-row, .notes-pinned__card',
        );
        const card: CardOrigin | undefined =
          direction === 'forward' && row && !/\/(new|edit|invite)$/.test(to.pathname)
            ? {
                parentKey: from.key,
                parentPath: from.pathname,
                href: event.currentTarget.getAttribute('href') ?? '',
                rect: row.getBoundingClientRect(),
              }
            : direction === 'back' && returning?.parentPath === to.pathname
              ? returning
              : undefined;
        changeScreenWithMotion(
          direction,
          () => {
            if (direction === 'back' && card) requestPosition(card.parentKey);
            void navigate(props.to, {
              replace: props.replace,
              state: props.state,
              relative: props.relative,
              preventScrollReset: props.preventScrollReset,
            });
            if (direction === 'forward' && card) cardOrigins.set(window.history.state.key, card);
          },
          card,
        );
      }}
    />
  );
}
