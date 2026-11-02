import {
  CheckSquare,
  FileText,
  ListChecks,
  Note,
  ShoppingCart,
  SquaresFour,
} from '@phosphor-icons/react';
import type { ReactNode } from 'react';
import { draftSummary } from './compact.ts';
import './ai.css';

export function CompactDraft({
  assignee,
  kind,
  title,
  fields,
  place,
  review,
  selected,
  onSelect,
  onEdit,
  children,
}: {
  assignee?: string;
  kind: string;
  title: string;
  fields: unknown;
  place: string;
  review: boolean;
  selected: boolean;
  onSelect: (value: boolean) => void;
  onEdit: () => void;
  children?: ReactNode;
}) {
  const Icon =
    kind === 'task'
      ? ListChecks
      : kind === 'shopping'
        ? ShoppingCart
        : kind === 'note'
          ? Note
          : kind === 'meter'
            ? CheckSquare
            : kind === 'object'
              ? SquaresFour
              : FileText;
  return (
    <div className="compact-draft">
      <label className="compact-draft__select">
        <input
          type="checkbox"
          checked={selected}
          onChange={(event) => onSelect(event.target.checked)}
        />
        <span className="compact-draft__check" aria-hidden />
        <span className="visually-hidden">Сохранить: {title}</span>
      </label>
      <Icon size={22} aria-hidden />
      <div className="compact-draft__text">
        <strong>{title}</strong>
        <p>
          {[draftSummary(kind, fields, place, assignee), place]
            .filter((value, index, all) => all.indexOf(value) === index)
            .join(' · ')}
        </p>
        {review ? <p className="compact-draft__review">Проверьте поля</p> : null}
        {children}
      </div>
      <button type="button" className="btn btn--secondary" onClick={onEdit}>
        Изменить
      </button>
    </div>
  );
}
