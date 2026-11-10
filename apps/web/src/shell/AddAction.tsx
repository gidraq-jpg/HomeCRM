import { Plus } from '@phosphor-icons/react';
import { createContext, useContext, useEffect, useRef } from 'react';
import { useLocation } from 'react-router';
import { useVoiceAdd } from '../ai/VoiceAdd.tsx';
import { sectionAdd } from './section-add.ts';
import { isStudio } from './studio.ts';

export const AddActionContext = createContext<(() => void) | null>(null);

/**
 * Одна плавающая «+» справа внизу над нижним меню на всех экранах (PRD, UI-12, D48). Подпись —
 * по разделу («Добавить объект»); ни тёмные шапки, ни списки, ни вкладки своих кнопок не имеют.
 */
export function AddAction({ className = 'fab' }: { className?: string }) {
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
  return add ? (
    <button
      type="button"
      className={className}
      aria-label={
        isStudio()
          ? `${target.label}${voice?.enabled ? '. Удерживайте, чтобы сказать ИИ' : ''}`
          : voice?.enabled
            ? 'Добавить. Удерживайте, чтобы сказать ИИ'
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
      <Plus size={26} aria-hidden />
    </button>
  ) : null;
}
