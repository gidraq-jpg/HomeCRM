import { beforeEach, expect, it, vi } from 'vitest';
import { createShopping, type ShoppingCard, shoppingAction } from './api.ts';
import { shoppingBatch } from './batch.ts';
import { listedNames } from './duplicates.ts';
import { quantityStep } from './quantity.ts';

vi.mock('./api.ts', () => ({ createShopping: vi.fn(), shoppingAction: vi.fn() }));
vi.mock('./duplicates.ts', async (original) => ({
  ...(await original<typeof import('./duplicates.ts')>()),
  listedNames: vi.fn(),
}));
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(listedNames).mockResolvedValue(new Set(['молоко']));
  vi.mocked(createShopping).mockImplementation(
    async (body) => ({ id: body.title, updatedAt: 'v1' }) as ShoppingCard,
  );
  vi.mocked(shoppingAction).mockResolvedValue({} as ShoppingCard);
});
it('пропускает открытые дубли и повторы внутри пачки; отменяет только созданное один раз', async () => {
  const batch = shoppingBatch(
    [{ title: 'Молоко' }, { title: 'Хлеб' }, { title: 'хлеб' }, { title: 'Яйца', quantity: '10' }],
    'personal',
    null,
  );
  expect(await batch.add()).toEqual({ added: 2, duplicates: 2 });
  expect(createShopping).toHaveBeenCalledTimes(2);
  await Promise.all([batch.undo(), batch.undo()]);
  await batch.undo();
  expect(shoppingAction).toHaveBeenCalledTimes(2);
  expect(vi.mocked(shoppingAction).mock.calls.map((call) => call[0].id)).toEqual(['Хлеб', 'Яйца']);
});
it('после потерянного ответа повторяет прежний ключ, даже если позиция уже появилась в GET', async () => {
  const batch = shoppingBatch([{ title: 'Хлеб' }, { title: 'Яйца' }], 'personal', null);
  vi.mocked(createShopping).mockRejectedValueOnce(new Error('network'));
  await expect(batch.add()).rejects.toThrow('network');
  vi.mocked(listedNames).mockResolvedValue(new Set(['хлеб']));
  expect(await batch.add()).toEqual({ added: 2, duplicates: 0 });
  expect(vi.mocked(createShopping).mock.calls[0]?.[0]).toEqual(
    vi.mocked(createShopping).mock.calls[1]?.[0],
  );
});
it('при повторе отмены сохраняет ключ и не повторяет уже отменённую позицию', async () => {
  const batch = shoppingBatch([{ title: 'Хлеб' }, { title: 'Яйца' }], 'personal', null);
  await batch.add();
  vi.mocked(shoppingAction)
    .mockResolvedValueOnce({} as ShoppingCard)
    .mockRejectedValueOnce(new Error('network'));
  await expect(batch.undo()).rejects.toThrow('network');
  await batch.undo();
  const calls = vi.mocked(shoppingAction).mock.calls;
  expect(calls.map((call) => call[0].id)).toEqual(['Хлеб', 'Яйца', 'Яйца']);
  expect(calls[1]?.[2]).toBe(calls[2]?.[2]);
});
it('меняет число, сохраняет единицу и не меняет свободный текст', () => {
  expect(quantityStep(null, 1)).toBe('2');
  expect(quantityStep('2 л', -1)).toBe('1 л');
  expect(quantityStep('1,5 кг', 1)).toBe('2,5 кг');
  expect(quantityStep('1', -1)).toBeNull();
  expect(quantityStep('пачка', 1)).toBeNull();
});
