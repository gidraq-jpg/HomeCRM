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
) {
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
  document.documentElement.dataset.motionDirection = direction;
  const header = document.querySelector?.('.topbar');
  const before = header ? `${(header as HTMLElement).offsetHeight}:${header.innerHTML}` : '';
  const transition = document.startViewTransition(() => {
    if (activeEpoch !== epoch) return;
    try {
      const result = flushSync(update);
      const compareHeader = () => {
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
    if (current !== transition) return;
    current = undefined;
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
          event.currentTarget.closest('.tabs, .bottom-nav, .side-nav') ||
          !document.startViewTransition
        ) {
          cancelMotionNavigation();
          return;
        }
        event.preventDefault();
        changeScreenWithMotion(direction, () => {
          void navigate(props.to, {
            replace: props.replace,
            state: props.state,
            relative: props.relative,
            preventScrollReset: props.preventScrollReset,
          });
        });
      }}
    />
  );
}
