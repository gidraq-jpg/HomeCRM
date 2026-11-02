// Листы занимают свой шаг истории, не меняя адрес карточки под ними.
const sheets: { id: string; close: () => void }[] = [];
let next = 0;
export function registerSheet(close: () => void) {
  const entry = { id: `sheet-${++next}`, close };
  sheets.push(entry);
  history.pushState({ ...history.state, motionSheet: entry.id }, '');
  return () => {
    const index = sheets.indexOf(entry);
    if (index >= 0) sheets.splice(index, 1);
    if (history.state?.motionSheet === entry.id) history.back();
  };
}
export function consumeSheetBack(event: PopStateEvent) {
  const top = sheets.at(-1);
  if (!top || event.state?.motionSheet === top.id) return false;
  sheets.pop();
  event.stopImmediatePropagation();
  top.close();
  return true;
}
