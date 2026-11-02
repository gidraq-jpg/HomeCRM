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
import { consumeSheetBack, registerSheet } from '../ui/sheet-history.ts';
import {
  type CardOrigin,
  cardOrigins,
  currentCardOrigin,
  requestPosition,
  saveCurrentPosition,
} from './navigation-position.ts';

const feeds = new Set(['/today', '/today/plan', '/today/all', '/more/shopping']);
const sections = new Set(['/today', '/home', '/documents', '/people', '/more']);

/** Вкладки меняют контекст, карточки и формы добавляют уровень. */
export function motionDirection(from: string, to: string): 'forward' | 'back' | null {
  if (from === to || (feeds.has(from) && feeds.has(to))) return null;
  if (sections.has(from) && sections.has(to)) {
    if (from === '/today' || from === '/more') return 'forward';
    return to === '/today' ? 'back' : null;
  }
  const form = (path: string) => /\/(new|edit|invite)$/.test(path);
  if (form(to)) return 'forward';
  if (form(from)) return 'back';
  const depth = (path: string) => path.split('/').filter(Boolean).length;
  if (from === '/today' || from === '/more') return 'forward';
  if (to === '/today' || to === '/more') return 'back';
  if (depth(to) < depth(from)) return 'back';
  if (depth(to) > depth(from)) return 'forward';
  return null;
}

const routedSheet = (path: string) => /^\/more\/inbox\/[0-9a-f-]{36}(?:\/edit\/[^/]+)?$/.test(path);

let current: ViewTransition | undefined;
let epoch = 0;
let historyUpdate: (() => void) | undefined;

/** Возврат по истории не должен быть затёрт ещё не снявшим снимок переходом. */
export function cancelMotionNavigation() {
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
  delete document.documentElement.dataset.motionForm;
  delete document.documentElement.dataset.motionDirection;
  delete document.documentElement.dataset.motionFeed;
}
export function navigateWithMotion(from: string, to: string, navigate: () => void) {
  const direction = routedSheet(from) || routedSheet(to) ? null : motionDirection(from, to);
  changeScreenWithMotion(
    direction,
    navigate,
    undefined,
    /\/(new|edit|invite)$/.test(from) || /\/(new|edit|invite)$/.test(to),
  );
}

export function changeScreenWithMotion(
  direction: 'forward' | 'back' | null,
  update: () => void | Promise<void>,
  card?: CardOrigin,
  form = false,
  preservePosition = false,
) {
  if (current) {
    const pending = current;
    if (direction === 'back' && document.documentElement.dataset.motionDirection === 'forward') {
      void pending.ready?.then(
        async () => {
          const animations = document.getAnimations().filter((animation) => {
            const effect = animation.effect as KeyframeEffect | null;
            return (
              effect?.pseudoElement?.includes('view-transition') &&
              animation.playState === 'running'
            );
          });
          for (const animation of animations) {
            animation.reverse();
            animation.updatePlaybackRate(-motionTime('screen') / motionTime('close'));
          }
          await Promise.allSettled(animations.map((animation) => animation.finished));
          flushSync(update);
        },
        () => {
          flushSync(update);
        },
      );
    } else {
      void pending.finished.then(() =>
        changeScreenWithMotion(direction, update, card, form, preservePosition),
      );
    }
    return;
  }
  if (!preservePosition) saveCurrentPosition();
  if (
    document.documentElement.dataset.design !== 'studio' ||
    !document.startViewTransition ||
    !direction
  ) {
    cancelMotionNavigation();
    update();
    return;
  }
  const activeEpoch = ++epoch;
  document.documentElement.dataset.motionDirection = direction;
  const root = document.documentElement;
  const from = typeof window === 'undefined' ? '' : window.location?.hash?.slice(1).split('?')[0];
  if (form && root.dataset.motionForms !== 'side') root.dataset.motionForm = direction;
  const chooseSection = () => {
    const to = typeof window === 'undefined' ? '' : window.location?.hash?.slice(1).split('?')[0];
    const section = (path: string | undefined) =>
      !!path && ['/home', '/documents', '/people', '/more/inbox', '/more/settings'].includes(path);
    if (
      !form &&
      root.dataset.motionSections === 'sheet' &&
      ((from === '/today' && section(to)) || (to === '/today' && section(from)))
    )
      root.dataset.motionForm = direction;
  };
  const transition = document.startViewTransition(() => {
    if (activeEpoch !== epoch) return;
    try {
      const result = flushSync(update);
      if (result) return result.then(chooseSection);
      chooseSection();
    } catch (error) {
      reportError(error);
      throw error;
    }
  });
  current = transition;
  // Отмена или несостоявшийся снимок меняют только рисунок; ошибка обновления сообщается выше.
  void transition.ready?.catch(() => {});
  const clear = () => {
    if (current !== transition) return;
    current = undefined;
    delete document.documentElement.dataset.motionForm;
    delete document.documentElement.dataset.motionDirection;
    delete document.documentElement.dataset.motionFeed;
    delete document.documentElement.dataset.motionTab;
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
    else changeScreenWithMotion(nextForm ? 'forward' : 'back', update, undefined, true);
  }, []);
  const reset = useCallback((next: T) => {
    form.current = predicate.current(next);
    mode.current = next;
    setValue(next);
  }, []);
  const formOpen = predicate.current(value);
  useEffect(() => {
    if (!formOpen) return;
    return registerSheet(() => set(previousMode.current));
  }, [formOpen, set]);
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
  if (
    routedSheet(window.location?.hash?.slice(1).split('?')[0] ?? '') ||
    !document.startViewTransition ||
    document.documentElement.dataset.design !== 'studio'
  ) {
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
    /\/(new|edit|invite)$/.test(
      typeof window === 'undefined' ? '' : (window.location?.hash?.slice(1).split('?')[0] ?? ''),
    ) || !!document.querySelector?.('.ui7-fullscreen-form'),
  );
}

/** Захват раньше HashRouter: единственный повтор события происходит внутри снимка. */
let replayingHistory = false;
export function systemHistoryMotion(
  event: PopStateEvent,
  previousKey: string,
  previousIndex = 0,
  previousPath = '',
) {
  if (consumeSheetBack(event)) return;
  if (replayingHistory) return;
  // Закрытие листа возвращает тот же адрес и ключ, экран под ним не двигается.
  if (event.state?.key === previousKey && event.state?.idx === previousIndex) return;
  if (historyUpdate) {
    queueMicrotask(cancelMotionNavigation);
    return;
  }
  if (routedSheet(previousPath) || routedSheet(location.hash.slice(1).split('?')[0] ?? '')) {
    cancelMotionNavigation();
    return;
  }
  // Chromium сообщает, когда система уже нарисовала predictive back.
  if (Reflect.get(event, 'hasUAVisualTransition')) return;
  // Прямой фрагмент адреса не является шагом управляемой истории: роутер принимает его сразу.
  if (typeof event.state?.idx !== 'number') {
    cancelMotionNavigation();
    return;
  }
  if (!document.startViewTransition || document.documentElement.dataset.design !== 'studio') return;
  event.stopImmediatePropagation();
  const direction = event.state?.idx > previousIndex ? 'forward' : 'back';
  const origin = cardOrigins.get(direction === 'back' ? previousKey : event.state?.key);
  if (origin && direction === 'back') requestPosition(origin.parentKey);
  changeScreenWithMotion(
    direction,
    () => {
      replayingHistory = true;
      try {
        window.dispatchEvent(new PopStateEvent('popstate', { state: event.state }));
        flushSync(() => {});
      } finally {
        replayingHistory = false;
      }
    },
    origin,
    /\/(new|edit|invite)$/.test(previousPath) ||
      /\/(new|edit|invite)$/.test(location.hash.slice(1).split('?')[0] ?? ''),
    true,
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
        void navigate(to, {
          ...options,
          replace: options?.replace ?? !!window.history.state?.motionSheet,
        });
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
          routedSheet(from.pathname) ||
          routedSheet(to.pathname) ||
          event.currentTarget.closest('.tabs, .bottom-nav, .side-nav')
        ) {
          cancelMotionNavigation();
          return;
        }
        event.preventDefault();
        const returning = currentCardOrigin();
        const row = event.currentTarget.closest<HTMLElement>(
          '.row, .task-row, .plan-row, .notes-pinned__card, [data-motion-origin]',
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
              replace: props.replace ?? !!window.history.state?.motionSheet,
              state: props.state,
              relative: props.relative,
              preventScrollReset: props.preventScrollReset,
            });
            if (direction === 'forward' && card) cardOrigins.set(window.history.state.key, card);
          },
          card,
          /\/(new|edit|invite)$/.test(to.pathname) || /\/(new|edit|invite)$/.test(from.pathname),
        );
      }}
    />
  );
}

/** Нижние вкладки: без движения либо короткое затухание по выбору владельца. */
export function changeTabScreen(update: () => void) {
  const root = document.documentElement;
  if (root.dataset.motionTabs !== 'fade') {
    cancelMotionNavigation();
    update();
    return;
  }
  root.dataset.motionTab = 'fade';
  changeScreenWithMotion('forward', update);
}
