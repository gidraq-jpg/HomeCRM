import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Контраст токенов тем «Монохром» и «iOS» (UI-11): браузерные сценарии по темам не запускаются
// (AGENTS.md, «Одна тема»), поэтому пары текста и фона проверяются здесь по WCAG 2.2.
const css = readFileSync(new URL('../styles/tokens.css', import.meta.url), 'utf8').replace(
  /\/\*[\s\S]*?\*\//g,
  '',
);

const BLOCKS: Readonly<Record<string, string>> = {
  base: ':root',
  studio: ':root[data-design="studio"]',
  mono: ':root[data-design="studio"][data-theme="mono"]',
  ios: ':root[data-design="studio"][data-theme="ios"]',
};

/** Значения токенов темы: базовые, затем Studio, затем переопределения темы. */
function tokensFor(theme: 'mono' | 'ios'): Map<string, string> {
  const selectors = [BLOCKS.base, BLOCKS.studio, BLOCKS[theme]];
  const tokens = new Map<string, string>();
  for (const match of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selector = (match[1] ?? '').trim().replace(/\s+/g, ' ');
    if (!selectors.includes(selector)) continue;
    for (const decl of (match[2] ?? '').matchAll(/--([\w-]+):\s*([^;]+);/g)) {
      tokens.set(decl[1] ?? '', (decl[2] ?? '').trim());
    }
  }
  return tokens;
}

function resolve(tokens: Map<string, string>, name: string): string {
  const value = tokens.get(name);
  if (value === undefined) throw new Error(`Нет токена --${name}`);
  const ref = /^var\(--([\w-]+)\)$/.exec(value);
  return ref?.[1] ? resolve(tokens, ref[1]) : value;
}

function channel(value: number): number {
  const unit = value / 255;
  return unit <= 0.03928 ? unit / 12.92 : ((unit + 0.055) / 1.055) ** 2.4;
}

function luminance(hex: string): number {
  const match = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex);
  if (!match) throw new Error(`Не HEX-цвет: ${hex}`);
  const digits = match[1] ?? '';
  const full =
    digits.length === 3
      ? digits
          .split('')
          .map((d) => d + d)
          .join('')
      : digits;
  const [r, g, b] = [0, 2, 4].map((i) => channel(parseInt(full.slice(i, i + 2), 16)));
  return 0.2126 * (r ?? 0) + 0.7152 * (g ?? 0) + 0.0722 * (b ?? 0);
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return ((hi ?? 0) + 0.05) / ((lo ?? 0) + 0.05);
}

// Пары «текст — фон» и «подпись — плашка»: текст и подписи не ниже 4,5:1.
const PAIRS: ReadonlyArray<readonly [string, string, string]> = [
  ['--ink', '--paper', 'основной текст на фоне'],
  ['--ink', '--surface', 'основной текст на карточке'],
  ['--muted', '--paper', 'второстепенный текст на фоне'],
  ['--muted', '--surface', 'второстепенный текст на карточке'],
  ['--muted', '--soft', 'второстепенный текст на плашке'],
  ['--text-subtle', '--soft', 'мета-строка на плашке'],
  ['--nav-link', '--nav-bg', 'пункт меню'],
  ['--nav-active-fg', '--nav-active-bg', 'выбранный пункт меню'],
  ['--seg-on-fg', '--seg-on-bg', 'выбранный сегмент'],
  ['--tabs-on-fg', '--tabs-on-bg', 'выбранная вкладка'],
  ['--pressed-fg', '--pressed-bg', 'нажатая кнопка'],
  ['--on-accent', '--fill', 'текст кнопки'],
  ['--accent', '--surface', 'ссылка и акцентный текст'],
];

describe.each(['mono', 'ios'] as const)('контраст токенов темы %s', (theme) => {
  it.each(PAIRS)('%s на %s — %s — не ниже 4,5:1', (fg, bg) => {
    const tokens = tokensFor(theme);
    const ratio = contrast(resolve(tokens, fg.slice(2)), resolve(tokens, bg.slice(2)));
    expect(ratio, `${fg} на ${bg}`).toBeGreaterThanOrEqual(4.5);
  });
});
