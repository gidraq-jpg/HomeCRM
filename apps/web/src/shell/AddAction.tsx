import { Plus } from '@phosphor-icons/react';
import { createContext, useContext } from 'react';
import { useLocation } from 'react-router';
import { sectionAdd } from './section-add.ts';
import { isStudio } from './studio.ts';

export const AddActionContext = createContext<(() => void) | null>(null);

/** Одно действие добавления в заголовках вместо плавающей кнопки. */
export function AddAction() {
  const add = useContext(AddActionContext);
  const { pathname } = useLocation();
  return add ? (
    <button
      type="button"
      className="studio-add"
      aria-label={isStudio() ? sectionAdd(pathname).label : 'Добавить'}
      onClick={add}
    >
      <Plus size={22} aria-hidden />
    </button>
  ) : null;
}
