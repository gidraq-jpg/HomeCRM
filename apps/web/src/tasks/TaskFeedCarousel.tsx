import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useLocation, useSearchParams } from 'react-router';
import { useHousehold } from '../household/HouseholdContext.tsx';
import { ShoppingScreen } from '../shopping/ShoppingScreen.tsx';
import { Page } from '../ui/Page.tsx';
import { RollingNumber } from '../ui/RollingNumber.tsx';
import { FeedPane, type FeedSummary } from './feed-pane.tsx';
import { TasksScreen } from './TasksScreen.tsx';
import { TaskTabs } from './TaskTabs.tsx';

const paths = ['/today', '/today/plan', '/today/all', '/more/shopping'];
const labels = ['Сегодня', 'План', 'Все дела', 'Покупки'];

/** Соседи загружены и остаются рядом под пальцем; интерактивна только выбранная лента. */
export function TaskFeedCarousel() {
  const { pathname } = useLocation();
  const [params] = useSearchParams();
  const { me, householdId } = useHousehold();
  const house = me.roles.some((role) => role.householdId === params.get('householdId'))
    ? params.get('householdId')
    : householdId;
  const [summaries, setSummaries] = useState<Record<number, FeedSummary>>({});
  const root = useRef<HTMLDivElement>(null);
  // Отсоединённые контейнеры сохраняют данные и черновики соседей без дублей в документе.
  const [hosts] = useState(() =>
    typeof document === 'undefined' ? [] : paths.map(() => document.createElement('div')),
  );
  const report = useCallback((index: number, summary: FeedSummary) => {
    setSummaries((current) => {
      const old = current[index];
      return old?.count === summary.count &&
        old?.detail === summary.detail &&
        old?.ready === summary.ready &&
        old?.house === summary.house
        ? current
        : { ...current, [index]: summary };
    });
  }, []);
  const active = Math.max(0, paths.indexOf(pathname));
  const summary = summaries[active];
  const tabHouse = summary?.house ?? house;
  useLayoutEffect(() => {
    const carousel = root.current;
    if (!carousel) return;
    const update = () => {
      const preview = carousel.hasAttribute('data-feed-preview');
      hosts.forEach((host, index) => {
        if (index === active || preview) {
          const slot = carousel.querySelector(`[data-feed-pane="${index}"]`);
          if (slot && host.parentElement !== slot) slot.append(host);
        } else host.remove();
      });
    };
    update();
    carousel.addEventListener('feed-preview', update);
    return () => carousel.removeEventListener('feed-preview', update);
  }, [active, hosts]);
  return (
    <>
      <Page
        title={labels[active] ?? 'Сегодня'}
        className="feed-page"
        heading={
          <div className="feed-heading">
            <h1 className="visually-hidden">{labels[active]}</h1>
            <p className="page-heading__eyebrow">Дела дома и ваши личные</p>
            <p className="feed-heading__summary">
              {labels[active]}:{' '}
              {summary?.count !== undefined ? (
                <>
                  <RollingNumber value={summary.count} />{' '}
                </>
              ) : null}
              {summary?.detail ?? 'Загружаем…'}
            </p>
          </div>
        }
      >
        <div className="studio-panel feed-panel">
          <TaskTabs
            houseQuery={tabHouse && tabHouse !== householdId ? `?householdId=${tabHouse}` : ''}
          />
          <div className="feed-carousel" data-feed-index={active} ref={root}>
            <div className="feed-carousel__track">
              {paths.map((path, index) => (
                <div
                  key={path}
                  className="feed-carousel__pane"
                  data-feed-pane={index}
                  data-feed-active={index === active}
                  data-feed-ready={summaries[index]?.ready ?? false}
                  inert={index !== active}
                  aria-hidden={index !== active || undefined}
                  style={{ transform: `translateX(${(index - active) * 100}%)` }}
                >
                  {!hosts.length && index === active ? (
                    <FeedPane.Provider value={{ index, active: true, report }}>
                      {index === 3 ? (
                        <ShoppingScreen />
                      ) : (
                        <TasksScreen view={index === 1 ? 'plan' : index === 2 ? 'all' : 'today'} />
                      )}
                    </FeedPane.Provider>
                  ) : null}
                </div>
              ))}
            </div>
          </div>
        </div>
      </Page>
      {hosts.map((host, index) =>
        createPortal(
          <FeedPane.Provider value={{ index, active: index === active, report }}>
            {index === 3 ? (
              <ShoppingScreen key={house} />
            ) : (
              <TasksScreen
                key={house}
                view={index === 1 ? 'plan' : index === 2 ? 'all' : 'today'}
              />
            )}
          </FeedPane.Provider>,
          host,
          paths[index],
        ),
      )}
    </>
  );
}
