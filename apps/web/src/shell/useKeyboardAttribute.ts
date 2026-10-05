import { useEffect } from 'react';

/** Во сколько раз должна уменьшиться высота окна, чтобы считать, что открыта клавиатура. */
const KEYBOARD_RATIO = 0.75;

/**
 * На телефоне экранная клавиатура сжимает окно (`interactive-widget=resizes-content`).
 * Пока она открыта, нижнее меню и «+» прячутся: иначе они занимают место над клавиатурой.
 * Решение принимается по высоте окна, а не по фокусу в поле: после «назад» клавиатура
 * закрывается, а фокус остаётся, и меню должно вернуться. Меню появляется и исчезает
 * при изменении окна, а не при касании, поэтому не перехватывает нажатия на кнопки внизу.
 * Ставит `data-keyboard="open"` на `<html>`; на компьютере (мышь) ничего не делает.
 */
export function useKeyboardAttribute(): void {
  useEffect(() => {
    if (!window.matchMedia('(pointer: coarse)').matches) return;
    const root = document.documentElement;
    const viewport = window.visualViewport;
    const target: EventTarget = viewport ?? window;
    const height = () => viewport?.height ?? window.innerHeight;

    let tallest = height();
    const update = () => {
      tallest = Math.max(tallest, height());
      if (height() < tallest * KEYBOARD_RATIO) root.dataset.keyboard = 'open';
      else delete root.dataset.keyboard;
    };
    // При повороте экрана «самая высокая» высота — другая.
    const orientation = window.matchMedia('(orientation: portrait)');
    const onOrientation = () => {
      tallest = height();
      update();
    };

    target.addEventListener('resize', update);
    orientation.addEventListener('change', onOrientation);
    return () => {
      target.removeEventListener('resize', update);
      orientation.removeEventListener('change', onOrientation);
      delete root.dataset.keyboard;
    };
  }, []);
}
