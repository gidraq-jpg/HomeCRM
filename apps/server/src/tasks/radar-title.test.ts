import { expect, it } from 'vitest';
import { type RadarTaskSource, radarTaskTitle } from './radar-title.ts';

const source: RadarTaskSource = {
  source_kind: 'record',
  label: null,
  title: 'Вымышленная квартира',
  date: '2026-10-20',
  period: null,
  document_type: null,
};
it.each([
  ['payment', null, 'Оплатить коммуналку за сентябрь'],
  ['payment', '2026-08', 'Оплатить коммуналку за август'],
  ['readings', null, 'Передать показания за октябрь'],
  ['verification', null, 'Провести поверку: Вымышленная квартира'],
  ['document', null, 'Продлить: Вымышленная квартира'],
  ['birthday', null, 'Поздравить с днём рождения: Вымышленная квартира'],
  ['record', null, 'Вымышленная квартира'],
  ['task_plan', null, 'Вымышленная квартира'],
  ['task_due', null, 'Вымышленная квартира'],
  ['task_waiting', null, 'Вымышленная квартира'],
])('TASK-10/D19a.7: %s — действие и период', (source_kind, period, title) => {
  expect(radarTaskTitle({ ...source, source_kind: source_kind ?? '', period })).toBe(title);
});
it('TASK-10/D19a.7: подпись срока вместо объекта, ОСАГО и переход года', () => {
  expect(radarTaskTitle({ ...source, label: 'Заменить фильтр' })).toBe('Заменить фильтр');
  expect(radarTaskTitle({ ...source, source_kind: 'document', document_type: 'osago' })).toBe(
    'Продлить полис ОСАГО',
  );
  expect(radarTaskTitle({ ...source, source_kind: 'payment', date: '2027-01-05' })).toBe(
    'Оплатить коммуналку за декабрь',
  );
});
