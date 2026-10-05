import { NavLink } from 'react-router';

export interface LinkTab {
  to: string;
  label: string;
  /** Для первой вкладки: она не должна гореть на дочерних адресах. */
  end?: boolean;
}

/** Вкладки внутри раздела: обычные ссылки, текущая отмечена `aria-current="page"`. */
export function LinkTabs({ label, items }: { label: string; items: readonly LinkTab[] }) {
  return (
    <nav className="tabs" aria-label={label}>
      <ul className="tabs__list">
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
