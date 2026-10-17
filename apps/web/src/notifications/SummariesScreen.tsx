import { SummaryMetadata, SummaryResponse } from '@homecrm/shared';
import { CalendarBlank } from '@phosphor-icons/react';
import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router';
import { z } from 'zod';
import { apiRequest } from '../auth/api.ts';
import { Notice } from '../auth/components.tsx';
import type { RadarItem } from '../deadlines/api.ts';
import { RadarRows } from '../deadlines/RadarScreen.tsx';
import { buildRows } from '../deadlines/radar.ts';
import { useHousehold } from '../household/HouseholdContext.tsx';
import { todayIn } from '../objects/dates.ts';
import { type DateOnly, formatShortDate } from '../ui/format.ts';
import { Section } from '../ui/Page.tsx';
import { Row, RowList } from '../ui/Row.tsx';
import { StudioPage as Page } from '../ui/StudioPage.tsx';

export function SummariesScreen() {
  const { me } = useHousehold(),
    { summaryId } = useParams();
  const list = useQuery({
    queryKey: ['summaries', me.id, 'list'],
    queryFn: ({ signal }) =>
      apiRequest('GET', 'summaries', z.array(SummaryMetadata), undefined, signal),
  });
  const selected = useQuery({
    queryKey: ['summaries', me.id, summaryId],
    enabled: !!summaryId,
    queryFn: ({ signal }) =>
      apiRequest('GET', `summaries/${summaryId}`, SummaryResponse, undefined, signal),
  });
  const data = selected.data;
  const rows = (items: z.infer<typeof RadarItem>[]) =>
    buildRows(items, {
      now: new Date(),
      timeZone: data?.metadata.timeZone ?? me.timeZone,
      today: todayIn(data?.metadata.timeZone ?? me.timeZone),
      titleOf: () => undefined,
      locate: () => undefined,
    });
  return (
    <Page service title="Сводки" back={{ to: '/more/notifications', label: 'Уведомления' }}>
      {(summaryId ? selected : list).isPending ? <Notice>Загружаем сводки…</Notice> : null}
      {(summaryId ? selected : list).isError ? (
        <Notice error>Сводка недоступна или не удалось её загрузить.</Notice>
      ) : null}
      {!summaryId ? (
        <>
          {list.data?.length === 0 ? <p>Сводок пока нет.</p> : null}
          {list.data?.length ? (
            <RowList label="Сводки">
              {list.data.map((s) => (
                <Row
                  key={s.id}
                  to={`/more/summaries/${s.id}`}
                  icon={<CalendarBlank size={22} aria-hidden />}
                  title={s.kind === 'morning' ? 'Утренняя' : 'Недельная'}
                  meta={`${s.householdName ?? 'Дом'} · ${formatShortDate(s.localDate as DateOnly, todayIn(s.timeZone))} · ${s.timeZone}`}
                />
              ))}
            </RowList>
          ) : null}
        </>
      ) : data ? (
        <>
          <p className="muted">
            {data.metadata.kind === 'morning' ? 'Утренняя' : 'Недельная'} ·{' '}
            {data.metadata.householdName ?? 'Дом'} ·{' '}
            {formatShortDate(data.metadata.localDate as DateOnly, todayIn(data.metadata.timeZone))}{' '}
            · {data.metadata.timeZone}. Содержимое учитывает текущие права и состояние записей.
          </p>
          {data.recalculating ? (
            <Notice>Идёт пересчёт сроков. Показаны прежние даты.</Notice>
          ) : null}
          {data.metadata.kind === 'weekly' ? (
            <Section title="Что сделано">
              {data.done.length ? (
                data.done.map((d) => (
                  <p key={`${d.type}:${d.id}`}>
                    <Link className="text-button" to={d.href}>
                      {d.title}
                    </Link>
                  </p>
                ))
              ) : (
                <p>За период выполненного нет.</p>
              )}
            </Section>
          ) : null}
          <Section title={data.metadata.kind === 'morning' ? 'Сегодня' : 'На подходе'}>
            {(data.metadata.kind === 'morning' ? data.today : data.upcoming).length ? (
              <RadarRows
                label="Сроки сводки"
                rows={rows(data.metadata.kind === 'morning' ? data.today : data.upcoming)}
              />
            ) : (
              <p>Подходящих сроков нет.</p>
            )}
          </Section>
          <Section title={data.metadata.kind === 'morning' ? 'Срочное' : 'Что зависло'}>
            {data.stuck.length ? (
              <RadarRows label="Срочные сроки" rows={rows(data.stuck)} />
            ) : (
              <p>Открытой просрочки нет.</p>
            )}
          </Section>
          {data.deferred.length ? (
            <Section title="Отложенные уведомления">
              <p>Доступные актуальные события: {data.deferred.length}.</p>
              {data.deferred.map((d) =>
                d.recordId ? (
                  <p key={d.id}>
                    <Link className="text-button" to={`/open/${d.recordId}`}>
                      Открыть запись события
                    </Link>
                  </p>
                ) : null,
              )}
            </Section>
          ) : null}
        </>
      ) : null}
    </Page>
  );
}
