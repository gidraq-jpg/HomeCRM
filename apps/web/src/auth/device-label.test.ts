import { expect, it } from 'vitest';
import { deviceLabel } from './device-label.ts';

it.each([
  ['Mozilla/5.0 (Linux; Android 14) Chrome/128.0 Mobile Safari/537.36', 'Chrome на Android'],
  [
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Version/18.0 Mobile/15 Safari/604.1',
    'Safari на iPhone',
  ],
  ['Mozilla/5.0 (iPhone) CriOS/130 Mobile/15 Safari/604.1', 'Chrome на iPhone'],
  ['Mozilla/5.0 (iPad) FxiOS/130 Mobile/15 Safari/604.1', 'Firefox на iPad'],
  ['Mozilla/5.0 (Macintosh) Version/18 Mobile/15 Safari/604.1', 'Safari на iPad'],
  ['Mozilla/5.0 (Windows NT 10.0) Chrome/130 Safari/537 Edg/130', 'Edge на Windows'],
  ['Mozilla/5.0 (Android 14) Chrome/130 Safari/537 OPR/80', 'Opera на Android'],
  ['Mozilla/5.0 (Macintosh) Version/18 Safari/604', 'Safari на macOS'],
  ['Mozilla/5.0 (X11; Linux x86_64) Firefox/130', 'Firefox на Linux'],
  ['Unknown/1', 'Браузер · неизвестное устройство'],
  [null, 'Неизвестное устройство'],
])('D20a-1: подпись устройства %s', (agent, expected) => {
  expect(deviceLabel(agent)).toBe(expected);
});
