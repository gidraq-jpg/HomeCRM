import { describe, expect, it } from 'vitest';
import { motionDirection } from './motion.tsx';

describe('направление перехода', () => {
  it('карточка и форма добавляют уровень, возврат снимает его', () => {
    expect(motionDirection('/today', '/today/tasks/id')).toBe('forward');
    expect(motionDirection('/home/id', '/home/id/edit')).toBe('forward');
    expect(motionDirection('/today/tasks/id', '/today')).toBe('back');
  });
  it('вкладки и фильтры не двигают экран', () => {
    expect(motionDirection('/today', '/today/all')).toBe(null);
    expect(motionDirection('/today/plan', '/more/shopping')).toBe(null);
    expect(motionDirection('/home', '/documents')).toBe(null);
    expect(motionDirection('/home/id', '/home/id')).toBe(null);
  });
});
