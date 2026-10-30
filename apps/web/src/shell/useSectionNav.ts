import { type MouseEvent, useLayoutEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { changeDockScreen, navigateWithMotion } from './motion.tsx';
import { isStudio } from './studio.ts';

/** Плашка движется только вслед за явным выбором раздела. */
export function useSectionNav() {
  const nav = useRef<HTMLElement>(null);
  const selected = useRef<string | null>(null);
  const location = useLocation();
  const navigate = useNavigate();
  useLayoutEffect(() => {
    const element = nav.current;
    if (!element || !isStudio()) return;
    const measure = (animate = false) => {
      const link = element.querySelector<HTMLElement>('[aria-current="page"]');
      const indicator = element.querySelector<HTMLElement>('.section-indicator');
      if (!indicator) return;
      indicator.hidden = !link;
      if (!link) return;
      indicator.dataset.moving = String(animate);
      indicator.style.width = `${link.offsetWidth}px`;
      indicator.style.height = `${link.offsetHeight}px`;
      indicator.style.transform = `translate(${link.offsetLeft}px, ${link.offsetTop}px)`;
    };
    measure(selected.current === location.pathname);
    selected.current = null;
    let size = `${element.offsetWidth}:${element.offsetHeight}`;
    const observer = new ResizeObserver(() => {
      const next = `${element.offsetWidth}:${element.offsetHeight}`;
      if (next === size) return;
      size = next;
      measure();
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [location]);
  const choose = (event: MouseEvent<HTMLAnchorElement>, to: string, active: boolean) => {
    if (
      !isStudio() ||
      event.button ||
      event.metaKey ||
      event.ctrlKey ||
      event.altKey ||
      event.shiftKey
    )
      return;
    event.preventDefault();
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (active) {
      if (location.pathname !== to)
        navigateWithMotion(location.pathname, to, () => {
          void navigate(to);
        });
      else if (window.scrollY > 0)
        window.scrollTo({ top: 0, behavior: reduce ? 'instant' : 'smooth' });
      return;
    }
    selected.current = to;
    const button = event.currentTarget.getBoundingClientRect();
    const icon = event.currentTarget.querySelector('.section-icon');
    if (!reduce && icon) {
      for (const animation of icon.getAnimations()) animation.cancel();
      icon.animate([{ transform: 'scale(1.1)' }, { transform: 'scale(1)' }], {
        duration: 320,
        easing: getComputedStyle(document.documentElement).getPropertyValue('--ease-out').trim(),
      });
    }
    changeDockScreen(button, () => {
      void navigate(to);
    });
  };
  return { nav, choose };
}
