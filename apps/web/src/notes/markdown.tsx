import { Fragment, type ReactNode } from 'react';

// Markdown заметки — ADR-0020: абзацы, заголовки, списки, выделение, ссылки. Сырого HTML нет:
// всё, что похоже на разметку, выводится текстом, а в DOM попадают только элементы, которые
// создаёт этот модуль. Ссылки — только http, https, mailto и tel. Картинки не загружаются:
// внешний запрос выдал бы адрес и время чтения заметки.

const SAFE_PROTOCOLS: ReadonlySet<string> = new Set(['http:', 'https:', 'mailto:', 'tel:']);

/** Адрес для ссылки или `null`, если протокол не разрешён или адрес относительный. */
export function safeHref(raw: string): string | null {
  const value = raw.trim();
  if (value === '' || value.length > 2000) return null;
  try {
    const url = new URL(value);
    return SAFE_PROTOCOLS.has(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}

// Закрывающий знак ищется в ограниченном окне: так длинный текст из одних скобок и звёздочек
// не заставит страницу считать квадратичное время.
const LOOKAHEAD = 2000;

function find(text: string, token: string, from: number, limit = LOOKAHEAD): number {
  const index = text.slice(from, from + limit).indexOf(token);
  return index < 0 ? -1 : from + index;
}

const ESCAPABLE = '\\`*_{}[]()#+-.!>';
const isWordChar = (char: string | undefined) => char !== undefined && /[\p{L}\p{N}]/u.test(char);

const BARE_URL = /https?:\/\/[^\s<>]+/g;
const TRAILING = /[.,;:!?)\]'"»]+$/;

/** Голые адреса http и https в обычном тексте становятся ссылками. */
function linkify(text: string, keys: { next: () => string }): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  for (const match of text.matchAll(BARE_URL)) {
    const raw = match[0].replace(TRAILING, '');
    const href = safeHref(raw);
    const start = match.index ?? 0;
    if (href === null) continue;
    if (start > last) out.push(text.slice(last, start));
    out.push(
      <a key={keys.next()} href={href} target="_blank" rel="noopener noreferrer nofollow">
        {raw}
      </a>,
    );
    last = start + raw.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

function renderInline(text: string, keys: { next: () => string }, depth = 0): ReactNode[] {
  const out: ReactNode[] = [];
  let buffer = '';
  let i = 0;
  const flush = () => {
    if (buffer !== '') {
      out.push(...linkify(buffer, keys));
      buffer = '';
    }
  };
  while (i < text.length) {
    const char = text.charAt(i);
    const next = text.charAt(i + 1);
    if (char === '\\' && next !== '' && ESCAPABLE.includes(next)) {
      buffer += next;
      i += 2;
      continue;
    }
    if (char === '`') {
      const end = find(text, '`', i + 1);
      if (end > i + 1) {
        flush();
        out.push(<code key={keys.next()}>{text.slice(i + 1, end)}</code>);
        i = end + 1;
        continue;
      }
    }
    if ((char === '*' || char === '_') && next === char && depth < 4) {
      const end = find(text, char + char, i + 2);
      if (end > i + 2) {
        flush();
        out.push(
          <strong key={keys.next()}>
            {renderInline(text.slice(i + 2, end), keys, depth + 1)}
          </strong>,
        );
        i = end + 2;
        continue;
      }
    }
    if ((char === '*' || char === '_') && depth < 4 && !(char === '_' && isWordChar(text[i - 1]))) {
      const end = find(text, char, i + 1);
      if (end > i + 1 && text.charAt(i + 1) !== ' ') {
        flush();
        out.push(
          <em key={keys.next()}>{renderInline(text.slice(i + 1, end), keys, depth + 1)}</em>,
        );
        i = end + 1;
        continue;
      }
    }
    const image = char === '!' && next === '[';
    if (char === '[' || image) {
      const open = image ? i + 1 : i;
      const middle = find(text, '](', open + 1, 600);
      const close = middle < 0 ? -1 : find(text, ')', middle + 2, 2000);
      if (middle > open && close > middle) {
        const label = text.slice(open + 1, middle);
        const href = safeHref(text.slice(middle + 2, close));
        flush();
        if (image || href === null) {
          // Картинка и ссылка с чужим протоколом остаются обычным текстом подписи.
          out.push(...renderInline(label, keys, depth + 1));
        } else {
          out.push(
            <a key={keys.next()} href={href} target="_blank" rel="noopener noreferrer nofollow">
              {renderInline(label, keys, depth + 1)}
            </a>,
          );
        }
        i = close + 1;
        continue;
      }
    }
    buffer += char;
    i += 1;
  }
  flush();
  return out;
}

const HEADING = /^(#{1,6})\s+(.*?)\s*#*\s*$/;
const RULE = /^\s{0,3}([-*_])(?:\s*\1){2,}\s*$/;
const BULLET = /^\s*[-*+]\s+(.*)$/;
const ORDERED = /^\s*\d{1,9}[.)]\s+(.*)$/;
const QUOTE = /^\s{0,3}>\s?(.*)$/;
const FENCE = /^\s{0,3}(```|~~~)/;

type Block =
  | { kind: 'heading'; level: number; text: string }
  | { kind: 'paragraph'; lines: string[] }
  | { kind: 'list'; ordered: boolean; items: string[] }
  | { kind: 'quote'; lines: string[] }
  | { kind: 'code'; text: string }
  | { kind: 'rule' };

const startsBlock = (line: string) =>
  HEADING.test(line) ||
  RULE.test(line) ||
  BULLET.test(line) ||
  ORDERED.test(line) ||
  QUOTE.test(line) ||
  FENCE.test(line);

/** Разбор по блокам. Вложенные списки плоские: отступ у пункта не учитывается. */
export function parseBlocks(source: string): Block[] {
  const lines = source.replace(/\r\n?/g, '\n').split('\n');
  const blocks: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i] ?? '';
    if (line.trim() === '') {
      i += 1;
      continue;
    }
    const fence = FENCE.exec(line);
    if (fence) {
      const code: string[] = [];
      i += 1;
      while (i < lines.length && !(lines[i] ?? '').trimStart().startsWith(fence[1] ?? '```')) {
        code.push(lines[i] ?? '');
        i += 1;
      }
      i += 1;
      blocks.push({ kind: 'code', text: code.join('\n') });
      continue;
    }
    const heading = HEADING.exec(line);
    if (heading) {
      blocks.push({ kind: 'heading', level: (heading[1] ?? '#').length, text: heading[2] ?? '' });
      i += 1;
      continue;
    }
    if (RULE.test(line)) {
      blocks.push({ kind: 'rule' });
      i += 1;
      continue;
    }
    const listPattern = BULLET.test(line) ? BULLET : ORDERED.test(line) ? ORDERED : null;
    if (listPattern) {
      const items: string[] = [];
      while (i < lines.length) {
        const match = listPattern.exec(lines[i] ?? '');
        if (!match) break;
        items.push(match[1] ?? '');
        i += 1;
      }
      blocks.push({ kind: 'list', ordered: listPattern === ORDERED, items });
      continue;
    }
    if (QUOTE.test(line)) {
      const quoted: string[] = [];
      while (i < lines.length) {
        const match = QUOTE.exec(lines[i] ?? '');
        if (!match) break;
        quoted.push(match[1] ?? '');
        i += 1;
      }
      blocks.push({ kind: 'quote', lines: quoted });
      continue;
    }
    const paragraph: string[] = [];
    while (i < lines.length && (lines[i] ?? '').trim() !== '' && !startsBlock(lines[i] ?? '')) {
      paragraph.push(lines[i] ?? '');
      i += 1;
    }
    if (paragraph.length === 0) {
      paragraph.push(line);
      i += 1;
    }
    blocks.push({ kind: 'paragraph', lines: paragraph });
  }
  return blocks;
}

function Lines({ lines, keys }: { lines: readonly string[]; keys: { next: () => string } }) {
  return lines.map((line, index) => (
    <Fragment key={keys.next()}>
      {index > 0 ? <br /> : null}
      {renderInline(line, keys)}
    </Fragment>
  ));
}

const HEADINGS = ['h2', 'h3', 'h4', 'h5', 'h6', 'h6'] as const;

/**
 * Показывает Markdown заметки. Заголовок самой заметки — `h1`, поэтому `#` в тексте — это `h2`.
 */
export function Markdown({ source }: { source: string }) {
  let counter = 0;
  const keys = { next: () => `m${++counter}` };
  return (
    <div className="markdown">
      {parseBlocks(source).map((block) => {
        const key = keys.next();
        switch (block.kind) {
          case 'heading': {
            const Tag = HEADINGS[Math.min(block.level, 6) - 1] ?? 'h6';
            return <Tag key={key}>{renderInline(block.text, keys)}</Tag>;
          }
          case 'rule':
            return <hr key={key} />;
          case 'code':
            return (
              <pre key={key}>
                <code>{block.text}</code>
              </pre>
            );
          case 'quote':
            return (
              <blockquote key={key}>
                <p>
                  <Lines lines={block.lines} keys={keys} />
                </p>
              </blockquote>
            );
          case 'list': {
            const Tag = block.ordered ? 'ol' : 'ul';
            return (
              <Tag key={key}>
                {block.items.map((item) => (
                  <li key={keys.next()}>{renderInline(item, keys)}</li>
                ))}
              </Tag>
            );
          }
          default:
            return (
              <p key={key}>
                <Lines lines={block.lines} keys={keys} />
              </p>
            );
        }
      })}
    </div>
  );
}
