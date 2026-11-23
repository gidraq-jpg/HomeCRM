import { describe, expect, it } from 'vitest';
import {
  fileCount,
  keepUntil,
  parentLinkLabel,
  parentPathOf,
  RETENTION_DAYS,
  recordCount,
} from './retention.ts';

// В числах неразрывный пробел; сравниваем с обычным.
const spaced = (text: string) => text.replace(/\s/g, ' ');

describe('корзина', () => {
  it('хранит удалённое 30 дней от даты удаления', () => {
    expect(RETENTION_DAYS).toBe(30);
    expect(keepUntil('2026-10-05T10:00:00.000Z').toISOString()).toBe('2026-11-04T10:00:00.000Z');
  });

  it('ведёт от файла к его записи; у фото профиля ссылки нет', () => {
    expect(parentPathOf({ parentType: 'note', parentId: 'n1' })).toBe('/more/notes/n1');
    expect(parentPathOf({ parentType: 'object', parentId: 'o1' })).toBe('/home/o1/files');
    expect(parentPathOf({ parentType: 'document', parentId: 'd1' })).toBe('/documents/d1');
    expect(parentPathOf({ parentType: 'task', parentId: 't1' })).toBe('/today/tasks/t1');
    expect(parentPathOf({ parentType: 'profile', parentId: 'p1' })).toBeNull();
    expect((['note', 'document', 'task', 'object'] as const).map(parentLinkLabel)).toEqual([
      'К заметке',
      'К документу',
      'К делу',
      'К объекту',
    ]);
  });

  it('склоняет число файлов и записей', () => {
    expect([fileCount(1), fileCount(3), fileCount(5)].map(spaced)).toEqual([
      '1 файл',
      '3 файла',
      '5 файлов',
    ]);
    expect([recordCount(1), recordCount(2), recordCount(11)].map(spaced)).toEqual([
      '1 запись',
      '2 записи',
      '11 записей',
    ]);
  });
});
