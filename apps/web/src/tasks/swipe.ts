export interface SwipePoint {
  x: number;
  y: number;
  time: number;
}

/** Обычный длинный или быстрый горизонтальный жест; края оставлены системе. */
export function swipeDirection(start: SwipePoint, end: SwipePoint, width: number): -1 | 0 | 1 {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const distance = Math.abs(dx);
  const elapsed = Math.max(1, end.time - start.time);
  if (width <= 48 || start.x < 24 || start.x > width - 24) return 0;
  if (distance < 48 || distance < Math.abs(dy) * 1.7) return 0;
  if (distance < width * 0.25 && !(elapsed <= 450 && distance / elapsed >= 0.5)) return 0;
  return dx < 0 ? 1 : -1;
}
