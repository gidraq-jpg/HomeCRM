import { Buildings, ClockCounterClockwise, FileText, Note } from '@phosphor-icons/react';
import { Link } from 'react-router';
import { AccessBadge } from '../access/AccessBadge.tsx';
import { CopyButton } from '../ui/CopyButton.tsx';
import { countWord } from '../ui/format.ts';
import { Section } from '../ui/Page.tsx';
import type { SearchResult } from './api.ts';

const icons = {
  note: Note,
  object: Buildings,
  object_event: ClockCounterClockwise,
  document: FileText,
};
/** Куда ведёт результат: заметка, документ, объект или его лента. */
function pathOf(item: SearchResult['groups'][number]['items'][number]): string {
  if (item.type === 'note') return `/more/notes/${item.targetId}`;
  if (item.type === 'document') return `/documents/${item.targetId}`;
  return `/home/${item.targetId}${item.type === 'object_event' ? '/timeline' : ''}`;
}

/** Фрагменты — текстовые узлы React. HTML исходной заметки не становится разметкой. */
function Snippet({ text }: { text: string }) {
  return text.split(/(‹[^›]*›)/g).map((part, index) =>
    part.startsWith('‹') && part.endsWith('›') ? (
      // Фрагмент неизменяемый, без состояния; позиция различает повтор одного слова.
      // biome-ignore lint/suspicious/noArrayIndexKey: текстовые фрагменты одного ответа
      <mark key={`${index}-${part}`}>{part.slice(1, -1)}</mark>
    ) : (
      part
    ),
  );
}
export function Results({ data }: { data: SearchResult }) {
  return (
    <>
      <p className="muted" role="status">
        Найдено: {countWord(data.total, ['совпадение', 'совпадения', 'совпадений'])}.
      </p>
      {data.hasMore ? (
        <p className="muted">Показаны первые 150 совпадений. Уточните запрос.</p>
      ) : null}
      {data.groups.map((group) => {
        const Icon = icons[group.type];
        return (
          <Section
            key={group.type}
            title={group.label}
            aside={<span className="muted">{group.items.length}</span>}
          >
            <ul className="row-list">
              {group.items.map((item) => (
                <li key={item.id} className="search-result">
                  <Link className="row" to={pathOf(item)}>
                    <span className="row__icon">
                      <Icon size={22} aria-hidden />
                    </span>
                    <span className="row__body">
                      <span className="row__title">{item.title}</span>
                      <span className="row__meta search-result__snippet">
                        <Snippet text={item.snippet} />
                      </span>
                      <span className="row__meta">{item.space}</span>
                    </span>
                    <AccessBadge visibility={item.visibility} />
                  </Link>
                  {item.type !== 'document' && item.numbers.length > 0 ? (
                    <ul className="search-result__numbers">
                      {item.numbers.map((number) => (
                        <li key={number}>
                          <span>{number}</span>
                          <CopyButton value={number} what={`номер ${number}`} />
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </li>
              ))}
            </ul>
          </Section>
        );
      })}
    </>
  );
}
