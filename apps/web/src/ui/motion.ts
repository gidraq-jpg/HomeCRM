/** CSS-токены остаются единственным источником времени, включая JS-анимации. */
export function durationMilliseconds(value: string): number {
  const product = /^calc\(\s*(\d*\.?\d+(?:ms|s))\s*\*\s*(\d+)\s*\)$/.exec(value.trim());
  if (product) return durationMilliseconds(product[1] ?? '') * Number(product[2]);
  const match = /^(\d*\.?\d+)(ms|s)$/.exec(value.trim());
  return match ? Number(match[1]) * (match[2] === 's' ? 1000 : 1) : 0;
}

export function motionTime(name: 'fast' | 'base' | 'screen' | 'sheet' | 'fly' | 'close'): number {
  return durationMilliseconds(
    getComputedStyle(document.documentElement).getPropertyValue(`--motion-${name}`),
  );
}
export function reducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}
