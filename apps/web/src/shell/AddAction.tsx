import { Plus } from '@phosphor-icons/react';
import { createContext, useContext, useEffect, useRef } from 'react';
import { useLocation } from 'react-router';
import { useVoiceAdd } from '../ai/VoiceAdd.tsx';
import { sectionAdd } from './section-add.ts';
import { isStudio } from './studio.ts';

export const AddActionContext = createContext<(() => void) | null>(null);

/**
 * Одно действие добавления. В Studio тёмные шапки не создают записей (D46, UI-3): действие
 * стоит в ленте дел и в начале списка раздела — `list` показывает его подписанной кнопкой.
 */
export function AddAction({
  className = 'studio-add',
  list = false,
}: {
  className?: string;
  list?: boolean;
}) {
  const add = useContext(AddActionContext);
  const voice = useVoiceAdd();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const long = useRef(false);
  const clear = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  const { pathname } = useLocation();
  const target = sectionAdd(pathname);
  if (list && (!isStudio() || target.kind !== 'route')) return null;
  return add ? (
    <button
      type="button"
      className={list ? 'btn btn--secondary btn--block list-add' : className}
      aria-label={
        list
          ? `${target.label}${voice?.enabled ? '. Удерживайте, чтобы сказать ИИ' : ''}`
          : voice?.enabled
            ? 'Добавить. Удерживайте, чтобы сказать ИИ'
            : isStudio()
              ? target.label
              : 'Добавить'
      }
      style={{ touchAction: 'none' }}
      onPointerDown={(event) => {
        if (event.button !== 0 || !event.isPrimary || !voice?.enabled) return;
        long.current = false;
        timer.current = setTimeout(() => {
          long.current = true;
          voice.start(true);
        }, 400);
      }}
      onPointerUp={clear}
      onPointerCancel={() => {
        clear();
        long.current = true;
      }}
      onContextMenu={(event) => {
        if (voice?.enabled) event.preventDefault();
      }}
      onClick={(event) => {
        clear();
        if (long.current && event.detail !== 0) {
          long.current = false;
          return;
        }
        add();
      }}
    >
      <Plus size={list ? 20 : 22} aria-hidden />
      {list ? <span aria-hidden>{target.label}</span> : null}
    </button>
  ) : null;
}
