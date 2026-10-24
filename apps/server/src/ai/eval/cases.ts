// Только вымышленная семья. Фиксированное «сегодня» пересекает полночь UTC и дату дома.
const anna = '11111111-1111-4111-8111-111111111111';
const boris = '22222222-2222-4222-8222-222222222222';
const vera = '33333333-3333-4333-8333-333333333333';
const dacha = '44444444-4444-4444-8444-444444444444';
const flat = '55555555-5555-4555-8555-555555555555';
export const context = {
  now: new Date('2026-10-23T22:30:00Z'),
  timeZone: 'Asia/Yekaterinburg',
  members: [
    { id: anna, name: 'Анна' },
    { id: boris, name: 'Борис' },
    { id: vera, name: 'Вера' },
  ],
  objects: [
    { id: dacha, title: 'Дача' },
    { id: flat, title: 'Квартира на Лунной' },
  ],
} as const;
const f = <T>(value: T) => ({ value, confident: value !== null });
function task(
  title: string,
  date: string | null = null,
  time: string | null = null,
  assigneeId: string | null = null,
  objectId: string | null = null,
) {
  return {
    title: f(title),
    date: f(date),
    time: f(time),
    assigneeId: f(assigneeId),
    objectId: f(objectId),
  };
}
const shop = (title: string, quantity: string | null = null) => ({
  title: f(title),
  quantity: f(quantity),
});
const note = (title: string, body: string) => ({ title: f(title), body: f(body) });
export const cases = [
  {
    kind: 'task',
    text: 'Завтра позвонить сантехнику',
    expected: task('Позвонить сантехнику', '2026-10-25'),
  },
  {
    kind: 'task',
    text: 'Анне в пятницу к 18 проверить насос на даче',
    expected: task('Проверить насос', '2026-10-30', '18:00', anna, dacha),
  },
  {
    kind: 'task',
    text: 'Борису сегодня в 9:30 забрать посылку',
    expected: task('Забрать посылку', '2026-10-24', '09:30', boris),
  },
  { kind: 'task', text: 'Послезавтра полить цветы', expected: task('Полить цветы', '2026-10-26') },
  {
    kind: 'task',
    text: 'Через неделю проверить фильтр в Квартире на Лунной',
    expected: task('Проверить фильтр', '2026-10-31', null, null, flat),
  },
  {
    kind: 'task',
    text: 'Через 3 дня Вере разобрать книги',
    expected: task('Разобрать книги', '2026-10-27', null, vera),
  },
  {
    kind: 'task',
    text: '5 ноября в 12 отвезти стул на Дачу',
    expected: task('Отвезти стул', '2026-11-05', '12:00', null, dacha),
  },
  { kind: 'task', text: 'Полить фикус', expected: task('Полить фикус') },
  { kind: 'task', text: 'Сергею проверить насос', expected: task('Проверить насос') },
  { kind: 'task', text: 'Когда-нибудь разобрать кладовку', expected: task('Разобрать кладовку') },
  {
    kind: 'task',
    text: 'Слушай, завтра надо позвонить электрику',
    expected: task('Позвонить электрику', '2026-10-25'),
  },
  {
    kind: 'task',
    text: 'Завтра проверитъ замок на Даче',
    expected: task('Проверить замок', '2026-10-25', null, null, dacha),
  },
  {
    kind: 'shopping',
    text: 'Купить молоко 2 л и хлеб 1 шт',
    expected: [shop('молоко', '2 л'), shop('хлеб', '1 шт')],
  },
  {
    kind: 'shopping',
    text: 'Картошка 2 кг, яйца 10 шт',
    expected: [shop('Картошка', '2 кг'), shop('яйца', '10 шт')],
  },
  { kind: 'shopping', text: 'Лампочки, соль', expected: [shop('Лампочки'), shop('соль')] },
  { kind: 'shopping', text: 'Купить рис 500 г', expected: [shop('рис', '500 г')] },
  {
    kind: 'shopping',
    text: 'Бумага 3 рулона и мыло 2 шт',
    expected: [shop('Бумага', '3 рулона'), shop('мыло', '2 шт')],
  },
  { kind: 'shopping', text: 'Ну и купи пожалуйста сахар 1 кг', expected: [shop('сахар', '1 кг')] },
  {
    kind: 'shopping',
    text: 'Купить макароны 2 пачки, сыр 300 г, чай',
    expected: [shop('макароны', '2 пачки'), shop('сыр', '300 г'), shop('чай')],
  },
  { kind: 'shopping', text: 'Малоко 1 л', expected: [shop('Молоко', '1 л')] },
  {
    kind: 'note',
    text: 'Заметка «Ключи»: запасной ключ у соседки Нины.',
    expected: note('Ключи', 'запасной ключ у соседки Нины.'),
  },
  {
    kind: 'note',
    text: 'Запиши заметку «Фильтр»: фильтр заменили в мае, следующий осмотр осенью.',
    expected: note('Фильтр', 'фильтр заменили в мае, следующий осмотр осенью.'),
  },
  {
    kind: 'note',
    text: 'Заметка «Гарантия»: чек на чайник лежит в синей папке.',
    expected: note('Гарантия', 'чек на чайник лежит в синей папке.'),
  },
  {
    kind: 'note',
    text: 'Заметка «Почта»: посылки забираем по субботам.',
    expected: note('Почта', 'посылки забираем по субботам.'),
  },
  {
    kind: 'auto',
    text: 'Завтра позвонить сантехнику и купить лампочки',
    expected: [
      { kind: 'task', ...task('Позвонить сантехнику', '2026-10-25') },
      { kind: 'shopping', ...shop('лампочки') },
    ],
  },
  {
    kind: 'auto',
    text: 'Борису сегодня проверить насос на Даче и купить соль 1 кг',
    expected: [
      { kind: 'task', ...task('Проверить насос', '2026-10-24', null, boris, dacha) },
      { kind: 'shopping', ...shop('соль', '1 кг') },
    ],
  },
  {
    kind: 'auto',
    text: 'Купить хлеб и молоко 2 л',
    expected: [
      { kind: 'shopping', ...shop('хлеб') },
      { kind: 'shopping', ...shop('молоко', '2 л') },
    ],
  },
  {
    kind: 'auto',
    text: 'Заметка «Ключи»: ключ у соседки. И завтра позвонить Борису',
    expected: [
      { kind: 'note', ...note('Ключи', 'ключ у соседки.') },
      { kind: 'task', ...task('Позвонить Борису', '2026-10-25') },
    ],
  },
] as const;
