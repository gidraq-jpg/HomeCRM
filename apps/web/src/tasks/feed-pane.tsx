import { createContext, useContext, useLayoutEffect } from 'react';
import { Page, type PageProps } from '../ui/Page.tsx';

export interface FeedSummary {
  count?: number;
  detail: string;
  ready: boolean;
  house?: string | null;
  /** Верхняя строка общей шапки; без неё — «Дела дома и ваши личные». */
  eyebrow?: string;
  /** Приветствие между верхней строкой и сводкой (только «Сегодня»). */
  greeting?: string;
}
export const FeedPane = createContext<{
  index: number;
  active: boolean;
  report: (index: number, summary: FeedSummary) => void;
} | null>(null);
export const useFeedPane = () => useContext(FeedPane);

export function useFeedSummary(
  count: number | undefined,
  detail: string,
  ready: boolean,
  house?: string | null,
  heading?: { eyebrow?: string; greeting?: string },
) {
  const pane = useFeedPane();
  const index = pane?.index;
  const report = pane?.report;
  const eyebrow = heading?.eyebrow;
  const greeting = heading?.greeting;
  useLayoutEffect(() => {
    if (index !== undefined)
      report?.(index, {
        count,
        detail,
        ready,
        house,
        ...(eyebrow !== undefined ? { eyebrow } : {}),
        ...(greeting !== undefined ? { greeting } : {}),
      });
  }, [count, detail, ready, house, eyebrow, greeting, index, report]);
}

/** Шапка и название документа принадлежат активной карусели, а не скрытым соседям. */
export function FeedPage(props: PageProps) {
  const pane = useFeedPane();
  return pane ? <div className="shopping-page">{props.children}</div> : <Page {...props} />;
}
