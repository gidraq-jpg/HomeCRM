import { useLayoutEffect, useRef } from 'react';
import { NavLink, useLocation } from 'react-router';

export interface LinkTab {
  to: string;
  label: string;
  /** Для первой вкладки: она не должна гореть на дочерних адресах. */
  end?: boolean;
}

/** Вкладки внутри раздела: обычные ссылки, текущая отмечена `aria-current="page"`. */
export function LinkTabs({ label, items }: { label: string; items: readonly LinkTab[] }) {
  const ref = useRef<HTMLUListElement>(null);
  const { pathname } = useLocation();
  // biome-ignore lint/correctness/useExhaustiveDependencies: маршрут задаёт положение индикатора
  useLayoutEffect(() => {
    const list = ref.current;
    if (!list) return;
    const measure = () => {
      const active = list.querySelector<HTMLElement>('[aria-current="page"]');
      // Вкладки в одну строку со сдвигом вбок: выбранная всегда в видимой зоне, край следующей виден.
      const strip = list.parentElement;
      if (active && strip && strip.scrollWidth > strip.clientWidth) {
        const left = active.offsetLeft;
        const right = left + active.offsetWidth;
        const edge = 32;
        if (left - edge < strip.scrollLeft) strip.scrollLeft = Math.max(0, left - edge);
        else if (right + edge > strip.scrollLeft + strip.clientWidth)
          strip.scrollLeft = right + edge - strip.clientWidth;
      }
      const indicator = list.querySelector<HTMLElement>('.tab-indicator');
      if (!active || !indicator) return;
      const link = active.getBoundingClientRect();
      const bounds = list.getBoundingClientRect();
      indicator.style.width = `${link.width}px`;
      indicator.style.height = `${link.height}px`;
      indicator.style.transform = `translate(${link.left - bounds.left - list.clientLeft}px, ${link.top - bounds.top - list.clientTop}px)`;
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(list);
    return () => observer.disconnect();
  }, [pathname]);
  return (
    <nav className="tabs" aria-label={label}>
      <ul className="tabs__list" ref={ref}>
        <li className="tab-indicator" aria-hidden="true" />
        {items.map((item) => (
          <li key={item.to}>
            <NavLink to={item.to} end={item.end ?? false} className="tabs__link">
              {item.label}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}
