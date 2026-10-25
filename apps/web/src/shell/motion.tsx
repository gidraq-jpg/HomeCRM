import { useCallback } from 'react';
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
  const depth = (path: string) => path.split('/').filter(Boolean).length;
  if (depth(to) < depth(from)) return 'back';
  if (depth(to) > depth(from)) return 'forward';
  return null;
}

let current: ViewTransition | undefined;
export function navigateWithMotion(from: string, to: string, navigate: () => void) {
  const direction = motionDirection(from, to);
  if (!document.startViewTransition || !direction) {
    current?.skipTransition();
    navigate();
    return;
  }
  current?.skipTransition();
  document.documentElement.dataset.motionDirection = direction;
  const transition = document.startViewTransition(() => flushSync(navigate));
  current = transition;
  void transition.finished
    .catch(() => {})
    .finally(() => {
      if (current !== transition) return;
      current = undefined;
      delete document.documentElement.dataset.motionDirection;
    });
}

/** HashRouter остаётся декларативным; системная история работает мгновенно. */
export function useNavigate(): NavigateFunction {
  const navigate = useRouterNavigate();
  const { pathname } = useLocation();
  return useCallback(
    (to: To | number, options?: NavigateOptions) => {
      if (typeof to === 'number') {
        current?.skipTransition();
        return navigate(to);
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
          reloadDocument ||
          event.currentTarget.closest('.tabs, .bottom-nav, .side-nav')
        )
          return;
        const direction = motionDirection(from.pathname, to.pathname);
        if (!direction || !document.startViewTransition) return;
        event.preventDefault();
        navigateWithMotion(from.pathname, to.pathname, () => {
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
