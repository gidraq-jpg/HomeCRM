import { ExtractInput } from '@homecrm/shared';
import { expect, it } from 'vitest';
import { normalizeResponse, normalizeTask, requestContext, taskDates } from './drafts.ts';
import { context } from './eval/cases.ts';
import { common } from './prompts/common.ts';
import { note } from './prompts/note.ts';
import { shopping } from './prompts/shopping.ts';
import { task as taskPrompt } from './prompts/task.ts';
import type { ExtractRequest } from './providers.ts';

const input: ExtractRequest = { kind: 'task', text: 'Вымышленная фраза', context };
const f = <T>(value: T) => ({ value, confident: value !== null });
const task = {
  title: f('Проверить насос'),
  whenText: f('завтра к 18'),
  assigneeId: f(null),
  objectId: f(null),
};
it.each([
  ['завтра к 18', '2026-10-25', '18:00'],
  ['сегодня в 9:30', '2026-10-24', '09:30'],
  ['в пятницу', '2026-10-30', null],
  ['31 февраля', null, null],
  ['как-нибудь', null, null],
  ['в 25:00', null, null],
  ['к 18', null, '18:00'],
])('AI-2: whenText %s разбирается в поясе дома', (text, date, time) => {
  expect(taskDates(f(text), input)).toEqual({ date: f(date), time: f(time) });
});
it('AI-2: ненадёжный срок остаётся неуверенным; переход DST', () => {
  expect(taskDates({ value: 'завтра', confident: false }, input).date).toEqual({
    value: '2026-10-25',
    confident: false,
  });
  expect(
    taskDates(f('послезавтра'), {
      ...input,
      context: { ...context, timeZone: 'Europe/Berlin', now: new Date('2026-03-28T12:00:00Z') },
    }).date.value,
  ).toBe('2026-03-30');
});
it('AI-2: чужие id отбрасываются, известные сохраняются', () => {
  const foreign = '99999999-9999-4999-8999-999999999999';
  expect(
    normalizeTask({ ...task, assigneeId: f(foreign), objectId: f(foreign) }, input),
  ).toMatchObject({ assigneeId: f(null), objectId: f(null) });
  expect(
    normalizeTask(
      { ...task, assigneeId: f(context.members[0].id), objectId: f(context.objects[0].id) },
      input,
    ),
  ).toMatchObject({ assigneeId: f(context.members[0].id), objectId: f(context.objects[0].id) });
});
it('AI-2: смешанный ответ, количество строкой; не больше 10', () => {
  const items = [
    { ...task, kind: 'task' },
    { kind: 'shopping', title: f('Лампочки'), quantity: f('3 шт') },
    { kind: 'note', title: f('Ключ'), body: f('У соседки') },
  ];
  const result = normalizeResponse({ items }, { ...input, kind: 'auto' });
  expect(result).toMatchObject([
    { kind: 'task', date: f('2026-10-25') },
    { kind: 'shopping', quantity: f('3 шт') },
    { kind: 'note' },
  ]);
  expect(() =>
    normalizeResponse({ items: Array(11).fill(items[0]) }, { ...input, kind: 'auto' }),
  ).toThrow();
  expect(() =>
    normalizeResponse({ items: [{ ...items[1], quantity: f(3) }] }, { ...input, kind: 'auto' }),
  ).toThrow();
});
it('AI-2: ответ с вычисленной моделью датой или лишними полями отклоняется', () => {
  expect(() => normalizeResponse({ ...task, date: f('2026-10-25') }, input)).toThrow();
  expect(() => normalizeResponse({ items: [] }, { ...input, kind: 'auto' })).toThrow();
});
it('AI-3: API требует явную отметку согласия', () => {
  const body = { spaceId: context.objects[0].id, text: 'Фраза', kind: 'auto' };
  expect(ExtractInput.safeParse(body).success).toBe(false);
  expect(ExtractInput.safeParse({ ...body, consent: false }).success).toBe(false);
  expect(ExtractInput.safeParse({ ...body, consent: true }).success).toBe(true);
});
it('AI-8: инструкции остаются короткими', () => {
  expect(common.length).toBeLessThan(150);
  for (const prompt of [taskPrompt, shopping, note]) {
    expect(prompt.length).toBeLessThanOrEqual(600);
    expect(prompt.split('\n').length).toBeLessThanOrEqual(4);
  }
});
it('AI-2: контекст — только местная дата/день и списки в одну строку, до 50 объектов', () => {
  const objects = Array.from({ length: 51 }, (_, index) => ({
    id: `object-${index}`,
    title: 'Учебный\nобъект',
  }));
  const sent = requestContext({ ...input, context: { ...context, objects } });
  expect(Object.keys(sent)).toEqual(['today', 'members', 'objects']);
  expect(sent.today).toBe('2026-10-24 суббота');
  expect(sent.members).toBe(context.members.map((m) => `${m.id}: ${m.name}`).join('\n'));
  expect(sent.objects.split('\n')).toHaveLength(50);
  expect(sent.objects).not.toContain('object-50');
  expect(sent.objects.split('\n')[0]).toBe('object-0: Учебный объект');
});
