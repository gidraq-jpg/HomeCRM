/** CSS-токены остаются единственным источником времени, включая JS-анимации. */
export function durationMilliseconds(value: string): number {
  const product = /^calc\(\s*(\d*\.?\d+(?:ms|s))\s*\*\s*(\d+)\s*\)$/.exec(value.trim());
  if (product) return durationMilliseconds(product[1] ?? '') * Number(product[2]);
  const match = /^(\d*\.?\d+)(ms|s)$/.exec(value.trim());
  return match ? Number(match[1]) * (match[2] === 's' ? 1000 : 1) : 0;
}

export function motionTime(
  name: 'fast' | 'base' | 'screen' | 'sheet' | 'fly' | 'close' | 'feed',
): number {
  return durationMilliseconds(
    getComputedStyle(document.documentElement).getPropertyValue(`--motion-${name}`),
  );
}
export function reducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** Ограниченная очередь: длинный список не замедляет взаимодействие. */
export function motionStagger(index: number, base: number): number {
  return (Math.min(Math.max(0, index), 3) * base) / 5;
}

export function motionEasing(): string {
  return getComputedStyle(document.documentElement).getPropertyValue('--ease-out').trim();
}

/** Копии существуют только как рисунок, никогда как второй доступный интерфейс. */
export function motionGhost(source: HTMLElement): HTMLElement {
  const ghost = source.cloneNode(true) as HTMLElement;
  ghost.dataset.motionGhost = '';
  ghost.inert = true;
  ghost.setAttribute('aria-hidden', 'true');
  ghost.removeAttribute('id');
  ghost.querySelectorAll('[id]').forEach((node) => {
    node.removeAttribute('id');
  });
  return ghost;
}

/** Замораживаем текущий рисунок при прерывании, включая вложенные WAAPI-преобразования. */
export function motionSnapshot(source: HTMLElement): HTMLElement {
  const ghost = motionGhost(source);
  const originals = [source, ...source.querySelectorAll<HTMLElement>('*')];
  const copies = [ghost, ...ghost.querySelectorAll<HTMLElement>('*')];
  originals.forEach((node, index) => {
    const copy = copies[index];
    if (!copy || !('style' in copy)) return;
    const style = getComputedStyle(node);
    copy.style.transform = style.transform;
    copy.style.opacity = style.opacity;
  });
  return ghost;
}
