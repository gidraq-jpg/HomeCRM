// Листы занимают свой шаг истории, не меняя адрес карточки под ними.
interface Entry {
  id: string;
  close: () => void;
  generation: number;
}
const sheets: Entry[] = [];
const owners = new WeakMap<object, Entry>();
let next = 0;
let closedHistoryKey: string | undefined;
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
      if (history.state?.motionSheet === current.id) {
        closedHistoryKey = history.state.key;
        history.back();
      }
    });
  };
}
export function consumeSheetBack(event: PopStateEvent) {
  if (closedHistoryKey && event.state?.key === closedHistoryKey) {
    closedHistoryKey = undefined;
    event.stopImmediatePropagation();
    return true;
  }
  const top = sheets.at(-1);
  if (!top || event.state?.motionSheet === top.id) return false;
  sheets.pop();
  event.stopImmediatePropagation();
  top.close();
  return true;
}

/** Переход из листа заменяет его шаг истории; уборка не должна увести со страницы назначения. */
export function prepareSheetNavigation() {
  const marker = history.state?.motionSheet;
  if (!marker) return false;
  const index = sheets.findIndex((entry) => entry.id === marker);
  if (index >= 0) {
    const entry = sheets[index];
    if (entry) entry.generation++;
    sheets.splice(index, 1);
  }
  return true;
}
