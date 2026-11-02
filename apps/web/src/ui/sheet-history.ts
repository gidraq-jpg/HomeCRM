// Листы занимают свой шаг истории, не меняя адрес карточки под ними.
interface ParentEntry {
  key: unknown;
  idx: unknown;
  sheet: unknown;
  href: string;
}
const currentHref = () => (typeof location === 'undefined' ? '' : location.href);
function matchesParent(parent: ParentEntry, state: PopStateEvent['state']) {
  return (
    state?.key === parent.key &&
    state?.idx === parent.idx &&
    state?.motionSheet === parent.sheet &&
    currentHref() === parent.href
  );
}
interface Entry {
  id: string;
  close: () => void;
  generation: number;
  parent: ParentEntry;
}
const sheets: Entry[] = [];
const owners = new WeakMap<object, Entry>();
let next = 0;
let closedParent: ParentEntry | undefined;
export function registerSheet(close: () => void, owner: object) {
  let entry = owners.get(owner);
  if (!entry || !sheets.includes(entry)) {
    entry = {
      id: `sheet-${++next}`,
      close,
      generation: 0,
      parent: {
        key: history.state?.key,
        idx: history.state?.idx,
        sheet: history.state?.motionSheet,
        href: currentHref(),
      },
    };
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
      if (history.state?.motionSheet === current.id && currentHref() === current.parent.href) {
        closedParent = current.parent;
        history.back();
      }
    });
  };
}
export function consumeSheetBack(event: PopStateEvent) {
  const pendingClose = closedParent;
  closedParent = undefined;
  if (pendingClose && matchesParent(pendingClose, event.state)) {
    event.stopImmediatePropagation();
    return true;
  }
  const top = sheets.at(-1);
  // Смена фрагмента адреса и переход к другой записи тоже вызывают popstate.
  // Закрываем лист только при возврате к его настоящему родителю.
  if (!top || !matchesParent(top.parent, event.state)) return false;
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
