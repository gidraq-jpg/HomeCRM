// Часовые пояса, из которых выбирается пояс дома (DEAD-6): города России и ближайших стран.
// Сервер принимает любой пояс IANA; выбор из списка защищает от опечаток.

export const HOME_ZONES: readonly { id: string; city: string }[] = [
  { id: 'Europe/Kaliningrad', city: 'Калининград' },
  { id: 'Europe/Moscow', city: 'Москва' },
  { id: 'Europe/Minsk', city: 'Минск' },
  { id: 'Europe/Samara', city: 'Самара' },
  { id: 'Asia/Yekaterinburg', city: 'Екатеринбург' },
  { id: 'Asia/Omsk', city: 'Омск' },
  { id: 'Asia/Novosibirsk', city: 'Новосибирск' },
  { id: 'Asia/Krasnoyarsk', city: 'Красноярск' },
  { id: 'Asia/Irkutsk', city: 'Иркутск' },
  { id: 'Asia/Yakutsk', city: 'Якутск' },
  { id: 'Asia/Vladivostok', city: 'Владивосток' },
  { id: 'Asia/Magadan', city: 'Магадан' },
  { id: 'Asia/Kamchatka', city: 'Камчатка' },
  { id: 'Europe/Istanbul', city: 'Стамбул' },
  { id: 'Asia/Almaty', city: 'Алматы' },
  { id: 'Asia/Tashkent', city: 'Ташкент' },
  { id: 'Asia/Tbilisi', city: 'Тбилиси' },
  { id: 'Asia/Yerevan', city: 'Ереван' },
  { id: 'UTC', city: 'Всемирное время' },
];

/** `+03:00` → `+3`, `+05:30` → `+5:30`, пусто → `0`. */
function shortOffset(longOffset: string): string {
  const match = /([+-])(\d{2}):(\d{2})$/.exec(longOffset);
  if (!match) return '0';
  const [, sign = '+', hours = '00', minutes = '00'] = match;
  if (Number(hours) === 0 && minutes === '00') return '0';
  return `${sign}${Number(hours)}${minutes === '00' ? '' : `:${minutes}`}`;
}

/** Смещение от UTC в этот момент: «UTC+3». */
export function zoneOffset(timeZone: string, now: Date = new Date()): string {
  const name =
    new Intl.DateTimeFormat('en', { timeZone, timeZoneName: 'longOffset' })
      .formatToParts(now)
      .find((part) => part.type === 'timeZoneName')?.value ?? '';
  const offset = shortOffset(name);
  return offset === '0' ? 'UTC' : `UTC${offset}`;
}

/** «Москва (UTC+3)»; пояс вне списка показывается как есть: «Asia/Dubai (UTC+4)». */
export function zoneLabel(timeZone: string, now: Date = new Date()): string {
  const city = HOME_ZONES.find((zone) => zone.id === timeZone)?.city ?? timeZone;
  return `${city} (${zoneOffset(timeZone, now)})`;
}
