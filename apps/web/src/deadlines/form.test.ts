import { describe, expect, it } from 'vitest';
import { type Draft, draftFromRule, emptyDraft, ruleFromDraft } from './form.ts';

const TODAY = '2026-10-07';
const draft = (patch: Partial<Draft>): Draft => ({ ...emptyDraft(TODAY), ...patch });

function rule(value: Draft) {
  const result = ruleFromDraft(value);
  if (!result.ok) throw new Error(`Форма не принята: ${result.field} — ${result.message}`);
  return result.rule;
}

describe('форма срока: правило из черновика (DEAD-1)', () => {
  it('новый срок — дата сегодня с предупреждением за 7 дней', () => {
    expect(rule(emptyDraft(TODAY))).toMatchObject({
      kind: 'date',
      date: TODAY,
      time: '00:00',
      warnings: [7],
    });
  });

  it('окно: длительность считается по датам, время начала и конца обязательно', () => {
    const window = draft({
      kind: 'window',
      date: '2026-10-20',
      endDate: '2026-10-25',
      time: '09:00',
      endTime: '18:00',
    });
    expect(rule(window)).toMatchObject({ kind: 'window', durationDays: 5, endTime: '18:00' });
    expect(ruleFromDraft({ ...window, time: '' })).toMatchObject({ ok: false, field: 'time' });
    expect(ruleFromDraft({ ...window, endTime: '' })).toMatchObject({
      ok: false,
      field: 'endTime',
    });
    expect(ruleFromDraft({ ...window, endDate: '2026-10-19' })).toMatchObject({
      ok: false,
      field: 'endDate',
    });
    expect(ruleFromDraft({ ...window, endDate: '2026-10-20', endTime: '08:00' })).toMatchObject({
      ok: false,
      field: 'endDate',
    });
  });

  it('повтор: по месяцам, годам и дням', () => {
    expect(
      rule(
        draft({
          kind: 'repeat',
          repeatUnit: 'month',
          monthDay: '20',
          durationDays: '5',
          time: '09:00',
        }),
      ),
    ).toMatchObject({
      kind: 'repeat',
      repeat: { unit: 'month', every: 1, day: 20 },
      durationDays: 5,
      time: '09:00',
    });
    expect(
      rule(draft({ kind: 'repeat', repeatUnit: 'year', month: '11', monthDay: '14' })),
    ).toMatchObject({ repeat: { unit: 'year', month: 11, day: 14 } });
    expect(rule(draft({ kind: 'repeat', repeatUnit: 'day', every: '10' }))).toMatchObject({
      repeat: { unit: 'day', every: 10 },
    });
  });

  it('повтор: неверные числа называют поле', () => {
    expect(ruleFromDraft(draft({ kind: 'repeat', every: '0' }))).toMatchObject({ field: 'every' });
    expect(ruleFromDraft(draft({ kind: 'repeat', every: 'abc' }))).toMatchObject({
      field: 'every',
    });
    expect(ruleFromDraft(draft({ kind: 'repeat', monthDay: '32' }))).toMatchObject({
      field: 'monthDay',
    });
    expect(ruleFromDraft(draft({ kind: 'repeat', durationDays: '400' }))).toMatchObject({
      field: 'durationDays',
    });
    expect(ruleFromDraft(draft({ kind: 'repeat', date: '' }))).toMatchObject({ field: 'date' });
  });

  it('«через N после события»: дата события необязательна', () => {
    expect(rule(draft({ kind: 'after', date: '', every: '3', afterUnit: 'month' }))).toMatchObject({
      kind: 'after',
      eventDate: null,
      every: 3,
      unit: 'month',
    });
    expect(
      rule(draft({ kind: 'after', date: '2026-10-05', every: '14', afterUnit: 'day' })),
    ).toMatchObject({ eventDate: '2026-10-05', every: 14, unit: 'day' });
  });

  it('предупреждения: без повторов, по убыванию', () => {
    expect(rule(draft({ warnings: [1, 7, 7, 3] }))).toMatchObject({ warnings: [7, 3, 1] });
  });

  it('правка: правило и черновик переводятся друг в друга без потерь', () => {
    const drafts = [
      draft({ kind: 'date', date: '2026-10-05', time: '09:30', warnings: [3, 1] }),
      draft({
        kind: 'window',
        date: '2026-10-20',
        endDate: '2026-10-25',
        time: '09:00',
        endTime: '18:00',
        warnings: [7],
      }),
      draft({
        kind: 'repeat',
        repeatUnit: 'year',
        date: '2026-01-01',
        month: '11',
        monthDay: '14',
        every: '2',
        durationDays: '3',
        warnings: [30, 7],
      }),
      draft({ kind: 'after', date: '', every: '3', afterUnit: 'month', warnings: [] }),
    ];
    for (const original of drafts) {
      const saved = rule(original);
      expect(rule(draftFromRule(saved, TODAY))).toEqual(saved);
    }
  });
});
