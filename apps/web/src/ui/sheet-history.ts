// Листы занимают свой шаг истории, не меняя адрес карточки под ними.
interface Entry {
  id: string;
  close: () => void;
  generation: number;
}
const sheets: Entry[] = [];
const owners = new WeakMap<object, Entry>();
let next = 0;
export function registerSheet(close: () => void, owner: object) {
  let entry = owners.get(owner);
  if (!entry || !sheets.includes(entry)) {
    entry = { id: `sheet-${++next}`, close, generation: 0 };
    owners.set(owner, entry);
    sheets.push(entry);
    history.pushState({ ...history.state, motionSheet: entry.id }, '');
  }
  entry.close = close;
  const current = entry;
  const generation = ++current.generation;
  return () => {
    // StrictMode повторяет effect: повторная регистрация отменяет отложенную уборку.
    queueMicrotask(() => {
      if (current.generation !== generation) return;
      const index = sheets.indexOf(current);
      if (index >= 0) sheets.splice(index, 1);
      owners.delete(owner);
      if (history.state?.motionSheet === current.id) history.back();
    });
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
