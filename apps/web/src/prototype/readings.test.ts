import { describe, expect, it } from 'vitest';
import { ACCOUNTS, METERS } from './data/index.ts';
import type { Meter } from './model.ts';
import { buildTransferText, checkReading, formatReading } from './readings.ts';

const meter = (id: string): Meter => {
  const found = METERS.find((item) => item.id === id);
  if (!found) throw new Error(`Нет счётчика ${id}`);
  return found;
};

const coldKitchen = meter('m-sad-hvs-kitchen'); // прошлое 147,512; обычно 3,1 м³
const power = meter('m-sad-power'); // прошлое 14 827; обычно 190 кВт·ч

describe('проверка показания (UTIL-5)', () => {
  it('пустое поле — не ошибка, а «не введено»', () => {
    expect(checkReading(coldKitchen, '')).toEqual({ status: 'empty' });
    expect(checkReading(coldKitchen, '   ')).toEqual({ status: 'empty' });
  });

  it('принимает и запятую, и точку', () => {
    for (const input of ['150,3', '150.3', ' 150,3 ']) {
      const check = checkReading(coldKitchen, input);
      expect(check.status).toBe('ok');
      if (check.status === 'ok') expect(check.value).toBe(150.3);
    }
  });

  it('считает расход без хвостов плавающей точки', () => {
    const check = checkReading(coldKitchen, '150,3');
    expect(check.status === 'ok' && check.consumption).toBe(2.788);
  });

  it('значение меньше прошлого не принимается, равное — принимается', () => {
    const less = checkReading(coldKitchen, '147,5');
    expect(less.status).toBe('invalid');
    if (less.status === 'invalid') expect(less.message).toContain('147,512');
    const equal = checkReading(coldKitchen, '147,512');
    expect(equal).toEqual({ status: 'ok', value: 147.512, consumption: 0 });
  });

  it('не число — понятная ошибка', () => {
    for (const input of ['abc', '12,3,4', '-5']) {
      expect(checkReading(coldKitchen, input).status).toBe('invalid');
    }
  });

  it('расход на 40% и больше выше обычного — предупреждение, но значение принимается', () => {
    const high = checkReading(coldKitchen, '152'); // расход 4,488 при обычных 3,1
    expect(high.status).toBe('ok');
    if (high.status === 'ok') expect(high.warning).toContain('утечки');
    const normal = checkReading(coldKitchen, '150,3');
    expect(normal.status === 'ok' && normal.warning).toBeUndefined();
  });

  it('граница аномалии: ровно на 40% выше — уже предупреждение', () => {
    // 190 × 1,4 = 266
    const border = checkReading(power, String(14_827 + 266));
    expect(border.status === 'ok' && border.warning).toBeTruthy();
    const below = checkReading(power, String(14_827 + 265));
    expect(below.status === 'ok' && below.warning).toBeUndefined();
  });

  it('форматирует значение со знаками счётчика и единицей', () => {
    expect(formatReading(coldKitchen, 150.3)).toBe('150,300 м³');
    expect(formatReading(power, 15_000).replace(String.fromCodePoint(0xa0), ' ')).toBe(
      '15 000 кВт·ч',
    );
  });
});

describe('текст для передачи показаний (UTIL-8)', () => {
  const sadovaya = METERS.filter((item) => item.propertyId === 'sadovaya');
  const accounts = Object.fromEntries(
    ACCOUNTS.map((account) => [account.id, { title: account.title, number: account.number }]),
  );

  it('собирает введённые значения по лицевым счетам и пропускает пустые и неверные', () => {
    const text = buildTransferText(sadovaya, accounts, {
      'm-sad-hvs-kitchen': '150,3',
      'm-sad-gvs-bath': '64.1',
      'm-sad-hvs-bath': '1', // меньше прошлого — не попадает
    });
    expect(text).toContain('Водоснабжение и водоотведение, лицевой счёт 310-8842-17');
    expect(text).toContain('ХВС, кухня: 150,300');
    expect(text).toContain('ГВС, ванная: 64,100');
    expect(text).not.toContain('ХВС, ванная');
    expect(text).not.toContain('Электроэнергия');
  });

  it('без значений текста нет', () => {
    expect(buildTransferText(sadovaya, accounts, {})).toBe('');
  });
});
