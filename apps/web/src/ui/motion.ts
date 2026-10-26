/** CSS-токены остаются единственным источником времени, включая JS-анимации. */
export function motionTime(name: 'fast' | 'base' | 'screen' | 'sheet' | 'fly'): number {
  return (
    Number.parseFloat(
      getComputedStyle(document.documentElement).getPropertyValue(`--motion-${name}`),
    ) || 0
  );
}
export function reducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}
