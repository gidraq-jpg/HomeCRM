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

/** Доля ширины строки, после которой протяжка сразу выполняет действие. */
export const ROW_ACTION_SHARE = 0.65;

/** Палец за порогом действия: строка показывает, что отпускание выполнит действие. */
export function rowSwipeArmed(distance: number, width: number) {
  return width > 0 && Math.abs(distance) > width * ROW_ACTION_SHARE;
}

/**
 * Итог жеста строки. Действие выполняет только длинная протяжка: случайный
 * быстрый рывок лишь открывает кнопку, и её нужно нажать.
 */
export function rowSwipeResult(
  distance: number,
  width: number,
  elapsed: number,
  travel = distance,
): 'close' | 'reveal' | 'action' {
  const length = Math.abs(distance);
  if (rowSwipeArmed(distance, width)) return 'action';
  if (length > 56) return 'reveal';
  // Короткий быстрый рывок к кнопке открывает её; встречный закрывает.
  const toward = Math.sign(travel) === Math.sign(distance);
  return toward && Math.abs(travel) > 24 && Math.abs(travel) / Math.max(1, elapsed) > 0.6
    ? 'reveal'
    : 'close';
}
