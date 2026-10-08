import { describe, expect, it } from 'vitest';
import type { Payment } from '../charges/api.ts';
import { liveIds, markOutcome, ownNewPayment } from './markPayment.ts';

const ME = 'fictional-boris';

function payment(id: string, patch: Partial<Payment> = {}): Payment {
  return {
    id,
    title: 'Оплата',
    parentId: 'charge-1',
    spaceId: 'house',
    spaceKind: 'household',
    audience: 'adults',
    authorId: ME,
    assigneeId: null,
    createdAt: '2026-10-08T10:00:00.000Z',
    updatedAt: '2026-10-08T10:00:00.000Z',
    deletedAt: null,
    paidOn: '2026-10-08',
    amountCents: 10_000,
    payer: { kind: 'member', accountId: ME },
    method: 'card',
    cancelledAt: null,
    cancellationReason: null,
    receiptIds: [],
    ...patch,
  };
}

describe('отмена отметки оплаты: только своя новая оплата', () => {
  it('слепок «до» — только живые оплаты', () => {
    const before = liveIds([payment('a'), payment('b', { cancelledAt: '2026-10-07T00:00:00Z' })]);
    expect([...before]).toEqual(['a']);
  });

  it('одна новая оплата самого участника — её и отменяют', () => {
    const before = liveIds([payment('a')]);
    const after = [payment('a'), payment('b')];
    expect(ownNewPayment(before, after, ME)?.id).toBe('b');
    expect(markOutcome(before, after, ME)).toEqual({ kind: 'created', paymentId: 'b' });
  });

  it('остаток был нулевой: новой оплаты нет, отменять нечего, старые не трогаем', () => {
    const before = liveIds([payment('a')]);
    expect(markOutcome(before, [payment('a')], ME)).toEqual({ kind: 'already-paid' });
  });

  it('оплата другого участника в окне не отменяется', () => {
    const before = liveIds([payment('a')]);
    const after = [payment('a'), payment('c', { authorId: 'fictional-anna' })];
    expect(ownNewPayment(before, after, ME)).toBeNull();
    expect(markOutcome(before, after, ME)).toEqual({ kind: 'unknown' });
  });

  it('своя и чужая новые оплаты вместе: своя единственная, чужая остаётся', () => {
    const before = liveIds([]);
    const after = [payment('b'), payment('c', { authorId: 'fictional-anna' })];
    expect(markOutcome(before, after, ME)).toEqual({ kind: 'created', paymentId: 'b' });
  });

  it('две свои новые оплаты или нет слепка — неизвестно, отмены нет', () => {
    const before = liveIds([]);
    expect(markOutcome(before, [payment('b'), payment('d')], ME)).toEqual({ kind: 'unknown' });
    expect(markOutcome(null, [payment('b')], ME)).toEqual({ kind: 'unknown' });
  });
});
