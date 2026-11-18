import { lazySection } from './lazy.tsx';

// Части сборки по разделам нижнего меню и «Ещё» (D53c). Первый экран «Сегодня» — в основной
// части; остальные грузятся при первом переходе или заранее, через `preloadSections`.
export const tasksSection = lazySection(() => import('./sections/tasks.ts'));
export const homeSection = lazySection(() => import('./sections/home.ts'));
export const documentsSection = lazySection(() => import('./sections/documents.ts'));
export const peopleSection = lazySection(() => import('./sections/people.ts'));
export const inboxSection = lazySection(() => import('./sections/inbox.ts'));
export const moreSection = lazySection(() => import('./sections/more.ts'));
export const rareSection = lazySection(() => import('./sections/rare.ts'));

const ALL = [
  homeSection,
  documentsSection,
  peopleSection,
  moreSection,
  tasksSection,
  inboxSection,
  rareSection,
];

/** Загружает все разделы; сбой одного не мешает остальным — экран повторит загрузку сам. */
export function preloadSections(): Promise<unknown> {
  return Promise.allSettled(ALL.map((section) => section.preload()));
}
