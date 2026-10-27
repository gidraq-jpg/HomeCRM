import { motionTime, reducedMotion } from './motion.ts';

interface Point {
  x: number;
  y: number;
}

/** Квадратичная дуга; обратный путь использует те же точки. */
export function flightFrames(from: Point, to: Point, scale = 0.15) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const lift = Math.min(Math.abs(dx) + Math.abs(dy), 240) * 0.5;
  return Array.from({ length: 17 }, (_, index) => {
    const t = index / 16;
    return {
      transform: `translate(${dx * t}px, ${dy * t - 2 * (1 - t) * t * lift}px) scale(${1 - (1 - scale) * t})`,
      opacity: 1,
      offset: t,
    };
  });
}

interface FlightTarget {
  kind: 'done-count' | 'active-tab' | 'today' | 'more';
  layout?: 'wide' | 'phone';
  visible: boolean;
}

/** Порядок целей не зависит от DOM и проверяется одинаково для обеих раскладок. */
export function selectFlightTarget<T extends FlightTarget>(
  kind: 'done' | 'trash',
  layout: 'wide' | 'phone',
  targets: readonly T[],
): T | undefined {
  const order: FlightTarget['kind'][] =
    kind === 'done' ? ['done-count', 'active-tab', 'today'] : ['more'];
  for (const role of order) {
    const target = targets.find(
      (target) =>
        target.kind === role && target.visible && (!target.layout || target.layout === layout),
    );
    if (target) return target;
  }
  return undefined;
}

function visible(node: HTMLElement) {
  if (
    node.closest('[inert], [aria-hidden="true"]') ||
    getComputedStyle(node).visibility === 'hidden'
  )
    return false;
  const box = node.getBoundingClientRect();
  const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
  return (
    box.width > 0 &&
    box.height > 0 &&
    box.bottom > 0 &&
    box.top < innerHeight &&
    box.right > 0 &&
    box.left < innerWidth &&
    !!hit &&
    node.contains(hit)
  );
}

/** Копия не участвует ни в действиях, ни в доступном дереве, ни в раскладке списка. */
function picture(source: HTMLElement, box: DOMRect) {
  const copy = source.cloneNode(true) as HTMLElement;
  copy.inert = true;
  copy.setAttribute('aria-hidden', 'true');
  copy.removeAttribute('id');
  copy.querySelectorAll('[id]').forEach((node) => {
    node.removeAttribute('id');
  });
  copy.dataset.motionFlight = '';
  Object.assign(copy.style, {
    position: 'fixed',
    left: `${box.x}px`,
    top: `${box.y}px`,
    width: `${box.width}px`,
    height: `${box.height}px`,
    margin: '0',
    zIndex: '100',
    pointerEvents: 'none',
    transformOrigin: 'center',
    overflow: 'hidden',
    background: 'var(--surface)',
    borderRadius: 'var(--studio-group-radius)',
  });
  return copy;
}

/** Вызывать только после подтверждённой мутации; ошибка API не рисует успех. */
export function flyTask(id: string, kind: 'done' | 'trash') {
  if (reducedMotion() || document.documentElement.dataset.design !== 'studio') return;
  const row = [
    ...document.querySelectorAll<HTMLElement>('.swipe-task:not([data-motion-ghost])'),
  ].find((node) => node.dataset.motionKey === id && visible(node));
  const candidates: (FlightTarget & { node: HTMLElement })[] = [];
  const add = (selector: string, role: FlightTarget['kind'], layout?: FlightTarget['layout']) => {
    for (const node of document.querySelectorAll<HTMLElement>(selector))
      candidates.push({ node, kind: role, layout, visible: visible(node) });
  };
  add('.task-counts[data-motion-target="done"]', 'done-count');
  add('.today-tabs .tabs__link[aria-current="page"]', 'active-tab');
  for (const [navigation, layout] of [
    ['side-nav', 'wide'],
    ['bottom-nav', 'phone'],
  ] as const) {
    add(`.${navigation}__link[href="#/today"]`, 'today', layout);
    add(`.${navigation}__link[href="#/more"]`, 'more', layout);
  }
  const target = selectFlightTarget(
    kind,
    window.matchMedia('(min-width: 960px)').matches ? 'wide' : 'phone',
    candidates,
  )?.node;
  const source = row?.querySelector<HTMLElement>('.swipe-task__surface');
  if (!row || !source || !target) return;
  const box = source.getBoundingClientRect();
  const destination = target.getBoundingClientRect();
  const from = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  const to = {
    x: destination.x + destination.width / 2,
    y: destination.y + destination.height / 2,
  };
  const template = picture(source, box);
  const play = (reverse: boolean) => {
    if (reducedMotion()) return;
    const copy = template.cloneNode(true) as HTMLElement;
    document.body.append(copy);
    const scale = Math.min(
      0.15,
      (destination.width / box.width) * 0.8,
      (destination.height / box.height) * 0.8,
    );
    const frames = flightFrames(from, to, scale);
    const animation = copy.animate(
      reverse ? frames.reverse().map((frame, index) => ({ ...frame, offset: index / 16 })) : frames,
      {
        duration: motionTime('fly'),
        easing: getComputedStyle(document.documentElement).getPropertyValue('--ease-out'),
      },
    );
    const clear = () => copy.remove();
    void animation.finished.then(clear, clear);
    const pulse = target.animate(
      [{ transform: 'scale(1)' }, { transform: 'scale(1.08)' }, { transform: 'scale(1)' }],
      {
        duration: motionTime('fast'),
        delay: reverse ? 0 : motionTime('fly') - motionTime('fast'),
      },
    );
    const cancel = () => {
      animation.cancel();
      pulse.cancel();
      copy.remove();
    };
    window.addEventListener('popstate', cancel, { once: true });
    void animation.finished.then(
      () => window.removeEventListener('popstate', cancel),
      () => window.removeEventListener('popstate', cancel),
    );
  };
  play(false);
  // Обратная копия подтверждает успешную отмену независимо от коммита React.
  // Раскрытие настоящей строки остаётся у MotionList, данные не ждут рисунка.
  return () => play(true);
}
