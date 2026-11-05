import { SlidersHorizontal, X } from '@phosphor-icons/react';

export function FilterButton({ count, onClick }: { count: number; onClick: () => void }) {
  return (
    <button
      type="button"
      className="btn btn--secondary compact-filters__button"
      aria-haspopup="dialog"
      onClick={onClick}
    >
      <SlidersHorizontal size={20} aria-hidden />
      <span>Фильтры{count > 0 ? ` · ${count}` : ''}</span>
    </button>
  );
}

export function FilterTag({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <button
      type="button"
      className="compact-filters__tag"
      aria-label={`Снять фильтр: ${label}`}
      onClick={onRemove}
    >
      <span>{label}</span>
      <X size={16} aria-hidden />
    </button>
  );
}
