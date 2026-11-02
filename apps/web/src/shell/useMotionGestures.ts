import { useEffect } from 'react';
import { useNavigate } from './motion.tsx';
import { isStudio } from './studio.ts';

/** Жест начинается только у края либо на шапке длинной формы, не мешая лентам. */
export function useMotionGestures() {
  const navigate = useNavigate();
  useEffect(() => {
    let start: { x: number; y: number; form: HTMLElement | null } | undefined;
    const down = (event: TouchEvent) => {
      if (!isStudio() || event.touches.length !== 1 || document.querySelector('[data-sheet]'))
        return;
      const point = event.touches[0];
      if (!point || !(event.target instanceof Element)) return;
      const form = event.target.closest<HTMLElement>('.ui7-fullscreen-form .ui7-form-heading');
      if (point.clientX > 24 && !form) return;
      if (event.target.closest('input,textarea,select,button,a')) return;
      start = { x: point.clientX, y: point.clientY, form };
    };
    const end = (event: TouchEvent) => {
      if (!start) return;
      const point = event.changedTouches[0];
      const previous = start;
      start = undefined;
      if (!point) return;
      const dx = point.clientX - previous.x;
      const dy = point.clientY - previous.y;
      if (previous.form && dy > 70 && dy > Math.abs(dx)) {
        previous.form.querySelector<HTMLElement>('.back-link')?.click();
      } else if (
        !previous.form &&
        dx > 70 &&
        dx > Math.abs(dy) * 1.5 &&
        (history.state?.idx ?? 0) > 0
      )
        void navigate(-1);
    };
    const cancel = () => {
      start = undefined;
    };
    document.addEventListener('touchstart', down, { passive: true });
    document.addEventListener('touchend', end, { passive: true });
    document.addEventListener('touchcancel', cancel);
    return () => {
      document.removeEventListener('touchstart', down);
      document.removeEventListener('touchend', end);
      document.removeEventListener('touchcancel', cancel);
    };
  }, [navigate]);
}
