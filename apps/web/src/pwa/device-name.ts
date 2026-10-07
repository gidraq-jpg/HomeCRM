// Название устройства для списка «Мои устройства»: «Android · Chrome». Без версий и моделей:
// по ним человека не отличить от других, а в списке нужно лишь узнать свой телефон.
// Модуль без обращений к окну: его вызывают и страница, и сервис-воркер.

const SYSTEMS: readonly [RegExp, string][] = [
  [/Android/i, 'Android'],
  [/iPhone|iPad|iPod/i, 'iOS'],
  [/Windows/i, 'Windows'],
  [/Mac OS X|Macintosh/i, 'macOS'],
  [/CrOS/i, 'ChromeOS'],
  [/Linux|X11/i, 'Linux'],
];

// Порядок важен: Edge, Opera и Яндекс Браузер в строке содержат «Chrome», Chrome — «Safari».
const BROWSERS: readonly [RegExp, string][] = [
  [/Edg(?:e|A|iOS)?\//, 'Edge'],
  [/OPR\/|Opera/, 'Opera'],
  [/YaBrowser\//, 'Яндекс Браузер'],
  [/SamsungBrowser\//, 'Samsung Internet'],
  [/Firefox\/|FxiOS\//, 'Firefox'],
  [/Chrome\/|CriOS\//, 'Chrome'],
  [/Safari\//, 'Safari'],
];

export const UNKNOWN_DEVICE = 'Неизвестное устройство';

export function deviceName(userAgent: string): string {
  const system = SYSTEMS.find(([pattern]) => pattern.test(userAgent))?.[1];
  const browser = BROWSERS.find(([pattern]) => pattern.test(userAgent))?.[1];
  if (system && browser) return `${system} · ${browser}`;
  return system ?? browser ?? UNKNOWN_DEVICE;
}
