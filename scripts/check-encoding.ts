// Проверка текстовых файлов репозитория: корректный UTF-8 без BOM и без следов поломки кодировки.
// Правило из AGENTS.md: русский текст, прошедший через неверную кодировку, должен ловиться до коммита.
// Строка с пометкой `encoding-check: ignore-line` пропускается — для документации о самих признаках.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { extname } from 'node:path';

const BINARY_EXTENSIONS = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.ico',
  '.pdf',
  '.woff',
  '.woff2',
  '.zip',
  '.gz',
]);
const IGNORE_MARK = 'encoding-check: ignore-line';

// Символы задаются кодами, чтобы в самом файле не было тех признаков, которые он ищет.
const chars = (...codes: number[]): string => String.fromCodePoint(...codes);

// UTF-8, прочитанный как Windows-1251: «Привет» превращается в «РџСЂРёРІРµС‚». encoding-check: ignore-line
// Первый байт кириллицы в UTF-8 (D0 или D1) даёт «Р» или «С», второй — один из символов ниже.
// Одна такая пара встречается и в обычном тексте, поэтому ловим две подряд.
const CP1251_FIRST = chars(0x0420, 0x0421);
const CP1251_SECOND = chars(
  ...[0x0402, 0x0403, 0x201a, 0x0453, 0x201e, 0x2026, 0x2020, 0x2021, 0x20ac, 0x2030, 0x0409],
  ...[0x2039, 0x040a, 0x040c, 0x040b, 0x040f, 0x0452, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022],
  ...[0x2013, 0x2014, 0x2122, 0x0459, 0x203a, 0x045a, 0x045c, 0x045b, 0x045f, 0x040e, 0x045e],
  ...[0x0408, 0x00a4, 0x0490, 0x00a6, 0x00a7, 0x0401, 0x00a9, 0x0404, 0x00ab, 0x00ac, 0x00ae],
  ...[0x0407, 0x00b0, 0x00b1, 0x0406, 0x0456, 0x0491, 0x00b5, 0x00b6, 0x00b7, 0x0451, 0x2116],
  ...[0x0454, 0x00bb, 0x0458, 0x0405, 0x0455, 0x0457],
);

const PATTERNS: ReadonlyArray<{ name: string; re: RegExp }> = [
  { name: 'символ замены U+FFFD', re: new RegExp(chars(0xfffd)) },
  { name: 'четыре вопросительных знака подряд', re: /\?{4,}/ },
  {
    name: 'UTF-8, прочитанный как Windows-1251',
    re: new RegExp(`(?:[${CP1251_FIRST}][${CP1251_SECOND}]){2,}`),
  },
  {
    name: 'UTF-8, прочитанный как Latin-1',
    re: new RegExp(`[${chars(0xd0, 0xd1)}][${chars(0x80)}-${chars(0xbf)}]`),
  },
];

const decoder = new TextDecoder('utf-8', { fatal: true });

function listFiles(): string[] {
  const out = execFileSync(
    'git',
    ['ls-files', '-z', '--cached', '--others', '--exclude-standard'],
    {
      encoding: 'utf8',
    },
  );
  return out.split('\0').filter((file) => file.length > 0);
}

function checkFile(file: string): string[] {
  if (BINARY_EXTENSIONS.has(extname(file).toLowerCase())) return [];
  let bytes: Buffer;
  try {
    bytes = readFileSync(file);
  } catch {
    return []; // файл удалён, но ещё числится в индексе
  }
  if (bytes.includes(0)) return []; // двоичный файл без известного расширения

  let text: string;
  try {
    text = decoder.decode(bytes);
  } catch {
    return [`${file}: не UTF-8`];
  }

  const problems: string[] = [];
  if (text.startsWith('﻿')) problems.push(`${file}: BOM в начале файла`);

  const lines = text.split('\n');
  for (const [index, line] of lines.entries()) {
    if (line.includes(IGNORE_MARK)) continue;
    for (const { name, re } of PATTERNS) {
      if (re.test(line)) problems.push(`${file}:${index + 1}: ${name}`);
    }
  }
  return problems;
}

const problems = listFiles().flatMap(checkFile);
if (problems.length > 0) {
  console.error(`Проблемы с кодировкой (${problems.length}):`);
  for (const problem of problems) console.error(`  ${problem}`);
  process.exit(1);
}
console.log('Кодировка в порядке.');
