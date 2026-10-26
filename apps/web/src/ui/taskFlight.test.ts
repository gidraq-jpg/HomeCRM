import { describe, expect, it } from 'vitest';
import { flightFrames } from './taskFlight.ts';

describe('дуга строки к цели', () => {
  it('начинается в строке, заканчивается в центре цели и поднимается над прямой', () => {
    const frames = flightFrames({ x: 50, y: 300 }, { x: 250, y: 100 });
    expect(frames[0]).toMatchObject({ transform: 'translate(0px, 0px) scale(1)', offset: 0 });
    expect(frames.at(-1)).toMatchObject({
      transform: 'translate(200px, -200px) scale(0.15000000000000002)',
      offset: 1,
    });
    expect(frames[8]?.transform).toContain('translate(100px, -160px)');
  });
});
