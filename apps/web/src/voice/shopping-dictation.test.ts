import { describe, expect, it } from 'vitest';
import { splitShoppingDictation } from './shopping-dictation.ts';

describe('SHOP-4: разбор надиктованных покупок', () => {
  const cases: [string, ReturnType<typeof splitShoppingDictation>][] = [
    [
      'молоко, хлеб и два десятка яиц',
      [{ title: 'Молоко' }, { title: 'Хлеб' }, { title: 'Яйца', quantity: '20 шт.' }],
    ],
    ['3 батона', [{ title: 'Батон', quantity: '3 шт.' }]],
    ['3 батона хлеба', [{ title: 'Хлеб', quantity: '3 батона' }]],
    ['килограмм яблок', [{ title: 'Яблоки', quantity: '1 кг' }]],
    ['2 кг картошки', [{ title: 'Картошка', quantity: '2 кг' }]],
    ['500 грамм сыра', [{ title: 'Сыр', quantity: '500 г' }]],
    ['1,5 литра молока', [{ title: 'Молоко', quantity: '1,5 л' }]],
    ['две пачки масла', [{ title: 'Масло', quantity: '2 пачки' }]],
    ['пять пачек салфеток', [{ title: 'Салфетки', quantity: '5 пачек' }]],
    ['пачка чая', [{ title: 'Чай', quantity: '1 пачка' }]],
    ['пару лимонов', [{ title: 'Лимоны', quantity: '2 шт.' }]],
    ['десяток яиц', [{ title: 'Яйца', quantity: '10 шт.' }]],
    ['три яблока', [{ title: 'Яблоки', quantity: '3 шт.' }]],
    ['бутылка воды ещё сок', [{ title: 'Вода', quantity: '1 бутылка' }, { title: 'Сок' }]],
    [
      'Купить хлеб, а также сметану потом гречку',
      [{ title: 'Хлеб' }, { title: 'Сметану' }, { title: 'Гречку' }],
    ],
    ['хлеб и соль', [{ title: 'Хлеб' }, { title: 'Соль' }]],
    ['хлеб-соль', [{ title: 'Хлеб-соль' }]],
    ['молоко 2,5%', [{ title: 'Молоко 2,5%' }]],
    ['', []],
    ['   ', []],
    [', , и ещё ,', []],
    ['и молоко,, и  ,хлеб и', [{ title: 'Молоко' }, { title: 'Хлеб' }]],
    ['ещё батон', [{ title: 'Батон' }]],
    ['Молоко. Хлеб. Сыр', [{ title: 'Молоко' }, { title: 'Хлеб' }, { title: 'Сыр' }]],
    [
      '6 йогуртов плюс 4 банки фасоли',
      [
        { title: 'Йогурты', quantity: '6 шт.' },
        { title: 'Фасоли', quantity: '4 банки' },
      ],
    ],
    ['двенадцать сосисок', [{ title: 'Сосиски', quantity: '12 шт.' }]],
    [
      'кофе и вымышленный корм для кота',
      [{ title: 'Кофе' }, { title: 'Вымышленный корм для кота' }],
    ],
    ['2 кг', [{ title: '2 кг' }]],
  ];
  it.each(cases)('«%s»', (text, expected) => {
    expect(splitShoppingDictation(text)).toEqual(expected);
  });

  it('длинное название обрезается до 200 знаков', () => {
    const [item] = splitShoppingDictation('а'.repeat(250));
    expect(item?.title).toHaveLength(200);
  });
});
