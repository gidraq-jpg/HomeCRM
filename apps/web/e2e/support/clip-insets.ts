/** Разрешает отступы CSS-маски в пиксели относительно самого снимка, включая calc(% + px). */
export function clipInsets(
  clip: string,
  box: { width: number; height: number } = { width: 0, height: 0 },
): [number, number, number, number] {
  if (!clip.startsWith('inset(')) throw new Error(`Not an inset clip: ${clip}`);
  const tokens =
    clip
      .slice(6)
      .split(/\s+round\b/)[0]
      ?.match(/calc\([^)]*\)|-?[\d.]+(?:px|%)/g) ?? [];
  const [top = '0px', right = top, bottom = top, left = right] = tokens;
  return [top, right, bottom, left].map((value, index) => {
    const axis = index % 2 ? box.width : box.height;
    return [...value.matchAll(/([+-]?)\s*(\d*\.?\d+)(px|%)/g)].reduce(
      (sum, term) =>
        sum + (term[1] === '-' ? -1 : 1) * Number(term[2]) * (term[3] === '%' ? axis / 100 : 1),
      0,
    );
  }) as [number, number, number, number];
}
