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

/** Захват только явного горизонтального жеста вне системных краёв. */
export function rowSwipeDirection(
  start: SwipePoint,
  end: SwipePoint,
  viewport: number,
): -1 | 0 | 1 {
  const dx = end.x - start.x;
  if (
    start.x < 24 ||
    start.x > viewport - 24 ||
    Math.abs(dx) < 12 ||
    Math.abs(dx) < Math.abs(end.y - start.y) * 1.7
  )
    return 0;
  return dx < 0 ? -1 : 1;
}

export function rowSwipeResult(
  distance: number,
  width: number,
  elapsed: number,
  travel = distance,
): 'close' | 'reveal' | 'action' {
  const length = Math.abs(distance);
  if (
    length > width * 0.5 ||
    (Math.abs(travel) > 56 && Math.abs(travel) / Math.max(1, elapsed) > 0.6)
  )
    return 'action';
  return length > 56 ? 'reveal' : 'close';
}
