import { expect, it } from 'vitest';
import { toastDuration } from './Toast.tsx';

it('D20a: обычные сообщения закрываются через 4,5 с, включая прежние длинные', () => {
  expect(toastDuration({ message: 'Сохранено' })).toBe(4500);
  expect(toastDuration({ message: 'Сохранено', durationMs: 12000 })).toBe(4500);
  expect(
    toastDuration({
      message: 'Сохранено',
      durationMs: 10000,
      action: { label: 'Показать всё', onClick() {} },
    }),
  ).toBe(4500);
});
it('D20a: окно отмены сохраняется, включая остаток серверного окна', () => {
  const action = { label: 'Отменить', onClick() {} };
  expect(toastDuration({ message: 'Выполнено', action })).toBe(7000);
  expect(toastDuration({ message: 'Выполнено', action, durationMs: 2360 })).toBe(2360);
  expect(
    toastDuration({ message: 'Связь убрана', action: { label: 'Вернуть', onClick() {} } }),
  ).toBe(7000);
});
