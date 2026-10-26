import { type ReactNode, useRef } from 'react';
import { useListMotion } from './useListMotion.ts';

export function MotionGroups({ children, version }: { children: ReactNode; version: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useListMotion(ref, version);
  return <div ref={ref}>{children}</div>;
}
