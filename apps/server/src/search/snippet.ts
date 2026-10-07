/** ts_headline отмечает словоформы; для подстрок и номера находим фрагмент в исходном тексте. */
export function searchSnippet(content: string, headline: string, query: string): string {
  if (headline.includes('‹')) return headline;
  const lower = content.toLocaleLowerCase('ru');
  let start = lower.indexOf(query.toLocaleLowerCase('ru'));
  let length = query.length;
  if (start < 0 && /^[\d\s()+.-]+$/.test(query)) {
    const digits = query.replace(/\D/g, '');
    const match = [...content.matchAll(/\+?\d[\d\s().-]*\d/g)].find((m) =>
      m[0].replace(/\D/g, '').includes(digits),
    );
    if (match) {
      start = match.index;
      length = match[0].length;
    }
  }
  if (start < 0) return headline;
  const left = Math.max(0, start - 65),
    right = Math.min(content.length, start + length + 100);
  return `${left > 0 ? '…' : ''}${content.slice(left, start)}‹${content.slice(start, start + length)}›${content.slice(start + length, right)}${right < content.length ? '…' : ''}`;
}
