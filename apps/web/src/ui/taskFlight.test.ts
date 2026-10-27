import { describe, expect, it } from 'vitest';
import { flightFrames, selectFlightTarget } from './taskFlight.ts';

describe('дуга строки к цели', () => {
  it('начинается в строке, заканчивается в центре цели и поднимается над прямой', () => {
    const frames = flightFrames({ x: 50, y: 300 }, { x: 250, y: 100 });
    expect(frames[0]).toMatchObject({ transform: 'translate(0px, 0px) scale(1)', offset: 0 });
    expect(frames.at(-1)).toMatchObject({
      transform: 'translate(200px, -200px) scale(0.15000000000000002)',
      offset: 1,
    });
    expect(frames[8]?.transform).toContain('translate(100px, -160px)');
    expect(frames.every((frame) => frame.opacity === 1)).toBe(true);
  });
});

describe.each(['wide', 'phone'] as const)('цели улёта: %s', (layout) => {
  const targets = [
    { kind: 'done-count', visible: true },
    { kind: 'active-tab', visible: true },
    { kind: 'today', layout: 'phone', visible: true },
    { kind: 'today', layout: 'wide', visible: true },
    { kind: 'more', layout: 'phone', visible: true },
    { kind: 'more', layout: 'wide', visible: true },
  ] as const;
  it('выполненное летит в счётчик, затем в активную вкладку, затем в Сегодня своего меню', () => {
    expect(selectFlightTarget('done', layout, targets)).toBe(targets[0]);
    expect(selectFlightTarget('done', layout, targets.slice(1))).toBe(targets[1]);
    expect(selectFlightTarget('done', layout, targets.slice(2))).toBe(
      targets[layout === 'phone' ? 2 : 3],
    );
  });
  it('корзина летит в Ещё своего меню, включая desktop без нижнего меню', () => {
    expect(selectFlightTarget('trash', layout, targets)).toBe(targets[layout === 'phone' ? 4 : 5]);
  });
  it('не выбирает невидимые цели и меню другой раскладки', () => {
    expect(
      selectFlightTarget(
        'trash',
        layout,
        targets.filter((target) => !('layout' in target) || target.layout !== layout),
      ),
    ).toBeUndefined();
    expect(
      selectFlightTarget(
        'done',
        layout,
        targets.map((target) => ({ ...target, visible: false })),
      ),
    ).toBeUndefined();
  });
});
