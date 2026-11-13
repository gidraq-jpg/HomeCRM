import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const src = fileURLToPath(new URL('..', import.meta.url));
const tokensPath = join(src, 'styles', 'tokens.css');
const tokens = readFileSync(tokensPath, 'utf8');
const styles = readdirSync(src, { recursive: true, withFileTypes: true })
  .filter((entry) => entry.isFile() && entry.name.endsWith('.css'))
  .map((entry) => join(entry.parentPath, entry.name))
  .filter((path) => path !== tokensPath);

describe('шкалы интерфейса D50', () => {
  it.each([
    ['font-xs', '0.75rem'],
    ['font-sm', '0.8125rem'],
    ['font-body', '0.9375rem'],
    ['font-title', '1.0625rem'],
    ['font-heading', '1.375rem'],
    ['font-display', '1.75rem'],
    ['radius-sm', '8px'],
    ['radius-md', '12px'],
    ['radius-lg', '16px'],
    ['radius-xl', '20px'],
    ['radius-pill', '999px'],
    ['space-1', '4px'],
    ['space-2', '8px'],
    ['space-3', '12px'],
    ['space-4', '16px'],
    ['space-5', '24px'],
    ['space-6', '32px'],
  ])('--%s: %s', (name, value) => {
    expect(tokens).toContain(`--${name}: ${value};`);
  });

  it('размеры текста, радиусы и отступы в стилях берутся из токенов', () => {
    const errors: string[] = [];
    const size =
      /^\s*(font-size|border-radius|(?:margin|padding|gap|row-gap|column-gap)(?:-[\w-]+)?):\s*([^;{}]+);/gm;
    for (const path of styles) {
      const css = readFileSync(path, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
      for (const [, property, value = ''] of css.matchAll(size)) {
        if (property === 'font-size') {
          if (
            /^(inherit|var\(--(?:font-(?:xs|sm|body|title|heading|display)|text-(?:title|meta|section))\))$/.test(
              value,
            )
          )
            continue;
        } else if (property === 'border-radius') {
          if (
            value
              .split(/\s+/)
              .every((part) =>
                /^(0|inherit|var\(--(?:radius-(?:sm|md|lg|xl|pill)|studio-(?:group|field|tile)-radius)\))$/.test(
                  part,
                ),
              )
          )
            continue;
        } else if (!/(?<![\d.])-?(?!0px\b|-?1px\b)\d+px\b/.test(value)) {
          // 0 px в вычислениях, 1 px для кода и подписи меню, −1 px для скрытого текста.
          continue;
        }
        errors.push(`${relative(src, path)} — ${property}: ${value}`);
      }
    }
    expect(errors).toEqual([]);
  });
});
