import { type ReactNode, useRef } from 'react';
import { useListMotion } from './useListMotion.ts';

/** Стабильная граница списка, в том числе при исчезновении последней группы. */
export function MotionList({
  children,
  version,
  className,
  label,
}: {
  children: ReactNode;
  version: string;
  className?: string;
  label?: string;
}) {
  const ref = useRef<HTMLUListElement>(null);
  useListMotion(ref, version);
  return (
    <ul ref={ref} className={className} aria-label={label}>
      {children}
    </ul>
  );
}
