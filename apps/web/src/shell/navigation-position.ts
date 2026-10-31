export interface CardOrigin {
  parentKey: string;
  parentPath: string;
  href: string;
  rect: DOMRect;
}

// Только память текущего входа: адреса и позиции не сохраняются на устройстве.
export const positions = new Map<string, number>();
export const cardOrigins = new Map<string, CardOrigin>();
export let requestedPosition: string | undefined;

export function requestPosition(key: string | undefined) {
  requestedPosition = key;
}

export function saveCurrentPosition() {
  if (typeof window !== 'undefined' && window.history?.state?.key)
    positions.set(window.history.state.key, window.scrollY);
}

export function originTitle(origin: CardOrigin) {
  const link = originLink(origin);
  return link?.querySelector<HTMLElement>('.row__title') ?? link;
}

export function currentCardOrigin() {
  return typeof window === 'undefined' ? undefined : cardOrigins.get(window.history?.state?.key);
}

export function originLink(origin: CardOrigin) {
  return [...document.querySelectorAll<HTMLAnchorElement>('.main a[href]')].find(
    (link) => link.getAttribute('href') === origin.href,
  );
}

export function clearNavigationPositions() {
  positions.clear();
  cardOrigins.clear();
  requestedPosition = undefined;
}
