import { Plus } from '@phosphor-icons/react';
import { createContext, useContext } from 'react';

export const AddActionContext = createContext<(() => void) | null>(null);

/** Одно действие добавления в заголовках вместо плавающей кнопки. */
export function AddAction() {
  const add = useContext(AddActionContext);
  return add ? (
    <button type="button" className="studio-add" aria-label="Добавить" onClick={add}>
      <Plus size={22} aria-hidden />
    </button>
  ) : null;
}
