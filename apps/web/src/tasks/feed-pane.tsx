import { createContext, useContext, useLayoutEffect } from 'react';
import { Page, type PageProps } from '../ui/Page.tsx';

export interface FeedSummary {
  count?: number;
  detail: string;
  ready: boolean;
  house?: string | null;
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
) {
  const pane = useFeedPane();
  const index = pane?.index;
  const report = pane?.report;
  useLayoutEffect(() => {
    if (index !== undefined) report?.(index, { count, detail, ready, house });
  }, [count, detail, ready, house, index, report]);
}

/** Шапка и название документа принадлежат активной карусели, а не скрытым соседям. */
export function FeedPage(props: PageProps) {
  const pane = useFeedPane();
  return pane ? <div className="shopping-page">{props.children}</div> : <Page {...props} />;
}
