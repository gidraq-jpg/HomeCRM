import { CaretRight, CheckCircle, Info, Warning, WarningOctagon } from '@phosphor-icons/react';
import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { AccessBadge } from '../access/AccessBadge.tsx';
import type { Visibility } from '../access/visibility.ts';

export function RowList({ children, label }: { children: ReactNode; label?: string }) {
  return (
    <ul className="row-list" aria-label={label}>
      {children}
    </ul>
  );
}

interface RowContentProps {
  icon?: ReactNode;
  /** Цвет значка слева: для срочного. */
  iconTone?: 'warning';
  title: ReactNode;
  meta?: ReactNode;
  badge?: Visibility;
  chevron?: boolean;
  aside?: ReactNode;
}

/** Содержимое строки списка: значок раздела, название, пояснение, значок доступа, стрелка. */
export function RowContent({
  icon,
  iconTone,
  title,
  meta,
  badge,
  chevron = false,
  aside,
}: RowContentProps) {
  return (
    <>
      {icon ? (
        <span className={iconTone ? `row__icon row__icon--${iconTone}` : 'row__icon'}>{icon}</span>
      ) : null}
      <span className="row__body">
        <span className="row__title">{title}</span>
        {meta ? <span className="row__meta">{meta}</span> : null}
      </span>
      {aside}
      {badge ? <AccessBadge visibility={badge} /> : null}
      {chevron ? <CaretRight className="row__chevron" size={20} aria-hidden /> : null}
    </>
  );
}

interface RowProps extends RowContentProps {
  to?: string;
  onClick?: () => void;
}

/** Строка списка: ссылка, кнопка или просто текст — по тому, что передано. */
export function Row({ to, onClick, chevron, ...content }: RowProps) {
  if (to !== undefined) {
    return (
      <li>
        <Link className="row" to={to}>
          <RowContent {...content} chevron={chevron ?? true} />
        </Link>
      </li>
    );
  }
  if (onClick !== undefined) {
    return (
      <li>
        <button type="button" className="row" onClick={onClick}>
          <RowContent {...content} chevron={chevron ?? true} />
        </button>
      </li>
    );
  }
  return (
    <li>
      <div className="row">
        <RowContent {...content} chevron={chevron ?? false} />
      </div>
    </li>
  );
}

export type StatusTone = 'ok' | 'warning' | 'danger' | 'neutral';

const STATUS_ICONS = {
  ok: CheckCircle,
  warning: Warning,
  danger: WarningOctagon,
  neutral: Info,
} as const;

/** Статус всегда с текстом и значком: цвет один его не передаёт (WCAG 1.4.1). */
export function Status({ tone, children }: { tone: StatusTone; children: ReactNode }) {
  const Icon = STATUS_ICONS[tone];
  return (
    <span className={`status status--${tone}`}>
      <Icon size={16} weight="fill" aria-hidden />
      {children}
    </span>
  );
}
