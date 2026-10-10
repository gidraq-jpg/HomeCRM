import { expect, it } from 'vitest';
import examples from './fixtures/quickline.json' with { type: 'json' };
import { parseQuickline } from './quickline.ts';

interface Example {
  input: string;
  title: string;
  planOn: string | null;
  planTime: string | null;
  assigneeId: string | null;
  objectId: string | null;
  now?: string;
  timeZone?: string;
}
const fixture: Example[] = examples;
const options = {
  now: new Date('2026-10-10T10:00:00Z'),
  timeZone: 'Asia/Yekaterinburg',
  members: [
    { id: 'boris', name: 'Борис' },
    { id: 'anna', name: 'Анна Иванова' },
  ],
  objects: [
    { id: 'lenina', name: 'Ленина' },
    { id: 'flat', name: 'Квартира' },
  ],
};
it('TASK-2: корпус содержит больше ста различных русских фраз', () => {
  expect(fixture.length).toBeGreaterThan(100);
  expect(new Set(fixture.map((f) => `${f.input}:${f.now}:${f.timeZone}`)).size).toBe(
    fixture.length,
  );
});
it.each(fixture)('$input ($now, $timeZone)', (example) => {
  const { input, now, timeZone, ...expected } = example;
  const result = parseQuickline(input, {
    ...options,
    now: new Date(now ?? options.now),
    timeZone: timeZone ?? options.timeZone,
  });
  expect(result).toMatchObject(expected);
  for (const fragment of result.fragments)
    expect(input.slice(fragment.start, fragment.end)).toBe(fragment.text);
  for (let i = 1; i < result.fragments.length; i++)
    expect(result.fragments[i]?.start).toBeGreaterThanOrEqual(result.fragments[i - 1]?.end ?? 0);
});
it('одинаковые имена неоднозначны; токены в адресах и внутри слов не исчезают', () => {
  expect(
    parseQuickline('Написать @Борис', {
      ...options,
      members: [
        { id: '1', name: 'Борис' },
        { id: '2', name: 'Борис' },
      ],
    }),
  ).toMatchObject({ title: 'Написать @Борис', assigneeId: null });
  expect(parseQuickline('mail@Борис #Ленина2', options).fragments).toEqual([]);
});
it('фрагмент можно вернуть в название по исходным позициям без повторного разбора', () => {
  const input = '📦 Купить завтра @Борис в 9';
  const result = parseQuickline(input, options);
  const remaining = result.fragments.filter((f) => f.kind !== 'date');
  let title = input;
  for (const f of [...remaining].reverse()) title = title.slice(0, f.start) + title.slice(f.end);
  expect(title.replace(/\s+/g, ' ').trim()).toBe('📦 Купить завтра');
});
