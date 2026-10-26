import { useLayoutEffect, useRef } from 'react';
import { motionTime, reducedMotion } from './motion.ts';

/** Доступное число обновляется сразу, прежняя цифра остаётся только рисунком. */
export function RollingNumber({ value }: { value: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  const previous = useRef(value);
  useLayoutEffect(() => {
    const node = ref.current;
    const old = previous.current;
    previous.current = value;
    if (!node || old === value || reducedMotion()) return;
    const copy = document.createElement('span');
    copy.textContent = String(old);
    copy.className = 'rolling-number__old';
    copy.setAttribute('aria-hidden', 'true');
    node.append(copy);
    const options = {
      duration: motionTime('base'),
      easing: getComputedStyle(document.documentElement).getPropertyValue('--ease-out'),
    };
    const direction = value > old ? 1 : -1;
    const outgoing = copy.animate(
      [
        { transform: 'translateY(0)', opacity: 1 },
        { transform: `translateY(${-direction * 100}%)`, opacity: 0 },
      ],
      options,
    );
    const incoming = node.firstElementChild?.animate(
      [
        { transform: `translateY(${direction * 100}%)`, opacity: 0 },
        { transform: 'translateY(0)', opacity: 1 },
      ],
      options,
    );
    void outgoing.finished.then(
      () => copy.remove(),
      () => copy.remove(),
    );
    return () => {
      outgoing.cancel();
      incoming?.cancel();
      copy.remove();
    };
  }, [value]);
  return (
    <span className="rolling-number" ref={ref}>
      <span>{value}</span>
    </span>
  );
}
