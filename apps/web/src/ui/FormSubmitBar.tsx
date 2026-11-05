import { type ReactNode, useLayoutEffect, useRef } from 'react';
import { motionEasing, motionSnapshot, motionTime } from './motion.ts';

/** Рисуем смену настоящего состояния; submit и подтверждение остаются у формы. */
export function FormSubmitBar({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const host = ref.current;
    if (!host) return;
    let stop = () => {};
    const capture = () =>
      [...host.querySelectorAll<HTMLButtonElement>('button:not([data-motion-ghost])')].map(
        (button) => {
          button.style.minWidth = `min(${button.offsetWidth}px, 100%)`;
          return { button, text: button.textContent, snapshot: motionSnapshot(button) };
        },
      );
    let previous = capture();
    const observer = new MutationObserver(() => {
      observer.disconnect();
      const next = capture();
      next.forEach(({ button, text }) => {
        const old = previous.find((item) => item.button === button);
        if (!old || old.text === text || !button.animate) return;
        stop();
        const ghost = old.snapshot;
        ghost.classList.add('submit-state-ghost');
        ghost.style.width = `${button.offsetWidth}px`;
        ghost.style.height = `${button.offsetHeight}px`;
        ghost.style.left = `${button.offsetLeft}px`;
        ghost.style.top = `${button.offsetTop}px`;
        host.append(ghost);
        const options = { duration: motionTime('fast'), easing: motionEasing() };
        const outgoing = ghost.animate([{ opacity: 1 }, { opacity: 0 }], options);
        const incoming = button.animate([{ opacity: 0 }, { opacity: 1 }], options);
        stop = () => {
          outgoing.cancel();
          incoming.cancel();
          ghost.remove();
        };
        void outgoing.finished.then(
          () => ghost.remove(),
          () => ghost.remove(),
        );
      });
      previous = next;
      observer.observe(host, { subtree: true, characterData: true, childList: true });
    });
    observer.observe(host, { subtree: true, characterData: true, childList: true });
    return () => {
      observer.disconnect();
      stop();
    };
  }, []);
  return (
    <div className="form-submit-bar" ref={ref}>
      {children}
    </div>
  );
}
