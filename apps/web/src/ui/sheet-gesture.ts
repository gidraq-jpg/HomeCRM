export function dismissSheet(distance: number, height: number, elapsed: number): boolean {
  return (
    distance > 0 &&
    (distance > height * 0.3 || (distance > 12 && distance / Math.max(1, elapsed) > 0.6))
  );
}
