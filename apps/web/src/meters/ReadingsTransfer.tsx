import { ArrowSquareOut, CheckCircle, Copy, PaperPlaneTilt, Phone } from '@phosphor-icons/react';
import { Link, useNavigate } from 'react-router';
import { describeTransmission, type Transmission } from '../accounts/labels.ts';
import { useAccounts } from '../accounts/queries.ts';
import { Notice, useAction } from '../auth/components.tsx';
import { ObjectError } from '../objects/components.tsx';
import { CopyButton, copyText } from '../ui/CopyButton.tsx';
import { EmptyState } from '../ui/EmptyState.tsx';
import { type DateOnly, formatShortDate, toTelHref } from '../ui/format.ts';
import { EXTERNAL_LINK } from '../ui/link.ts';
import { Status } from '../ui/Row.tsx';
import { useToast } from '../ui/Toast.tsx';
import {
  type MeterListItem,
  markTransmitted,
  type TransmissionGroup,
  type TransmissionReading,
  trashReading,
} from './api.ts';
import { showDecimal, showWithUnit } from './decimal.ts';
import { RESOURCE_UNITS, zoneLabel } from './labels.ts';
import { useRefreshMeters, useTransmission } from './queries.ts';
import { useReadings } from './ReadingsLayout.tsx';
import { emptyDraft } from './readings.ts';

/** Госуслуги Дом не дают ссылки на лицевой счёт, поэтому открывается главная страница сервиса. */
const GOSUSLUGI_DOM_URL = 'https://dom.gosuslugi.ru/';
const WEB_LINK = /^https?:\/\//i;

const NO_ACCOUNT = 'Без лицевого счёта';

function meterOf(meters: readonly MeterListItem[], id: string): MeterListItem | undefined {
  return meters.find((meter) => meter.id === id);
}

/** Строки значений одного показания: «ХВС, санузел: 123,456» (по зонам — отдельной строкой). */
function readingLines(
  reading: TransmissionReading,
  meters: readonly MeterListItem[],
): { label: string; value: string }[] {
  const meter = meterOf(meters, reading.meterId);
  const title = meter?.title ?? 'Счётчик';
  return reading.values.map((value, index) => {
    const zone = zoneLabel(reading.zones, index);
    return { label: zone === null ? title : `${title} (${zone})`, value: showDecimal(value) };
  });
}

/** Текст для вставки в приложение поставщика: счёт и значения, без группировки тысяч. */
export function groupText(
  title: string,
  number: string,
  readings: readonly TransmissionReading[],
  meters: readonly MeterListItem[],
): string {
  const head = number === '' ? title : `${title}, лицевой счёт ${number}`;
  const lines = readings.flatMap((reading) =>
    readingLines(reading, meters).map((line) => `${line.label}: ${line.value}`),
  );
  return [head, ...lines].join('\n');
}

function TransmissionMethod({
  transmission,
  hasAccount,
  objectId,
}: {
  transmission: Transmission | null;
  hasAccount: boolean;
  objectId: string;
}) {
  if (transmission === null) {
    return (
      <p className="muted">
        Способ передачи не указан.{' '}
        {hasAccount ? (
          <Link to={`/home/${objectId}/accounts`}>Указать в лицевом счёте</Link>
        ) : (
          'Привяжите счётчики к лицевому счёту на вкладке «Счётчики».'
        )}
      </p>
    );
  }
  switch (transmission.method) {
    case 'gosuslugi_dom':
      return (
        <a className="btn btn--secondary btn--block" href={GOSUSLUGI_DOM_URL} {...EXTERNAL_LINK}>
          <ArrowSquareOut size={20} aria-hidden />
          Открыть «Госуслуги Дом»
        </a>
      );
    case 'provider':
      return WEB_LINK.test(transmission.url) ? (
        <a className="btn btn--secondary btn--block" href={transmission.url} {...EXTERNAL_LINK}>
          <ArrowSquareOut size={20} aria-hidden />
          Открыть сайт поставщика
        </a>
      ) : (
        <p className="muted">
          Ссылка поставщика не похожа на веб-адрес. Поправьте её в лицевом счёте.
        </p>
      );
    case 'phone':
      return (
        <div className="transfer-phone">
          <span>
            Передать по телефону: <strong className="mono">{transmission.phone}</strong>
          </span>
          <CopyButton value={transmission.phone} what="телефон для передачи показаний" />
          <a className="btn btn--secondary" href={toTelHref(transmission.phone)}>
            <Phone size={20} aria-hidden />
            Позвонить
          </a>
        </div>
      );
    case 'automatic':
      return (
        <p className="muted">
          Показания передаются автоматически: вручную ничего открывать не нужно.
        </p>
      );
    case 'not_required':
      return <p className="muted">Передавать показания не требуется.</p>;
  }
}

function GroupCard({
  group,
  accountTitle,
  meters,
  objectId,
  canWrite,
  busy,
  onMark,
}: {
  group: TransmissionGroup;
  accountTitle: string;
  meters: readonly MeterListItem[];
  objectId: string;
  canWrite: boolean;
  busy: boolean;
  onMark: () => void;
}) {
  const toast = useToast();
  const text = groupText(accountTitle, group.number, group.readings, meters);
  const headingId = `transfer-${group.utilityAccountId ?? 'none'}`;
  return (
    <section className="card transfer-card" aria-labelledby={headingId}>
      <h3 className="card__title" id={headingId}>
        {accountTitle}
      </h3>
      {group.number === '' ? null : (
        <p className="transfer-card__number">
          Лицевой счёт <span className="mono">{group.number}</span>
          <CopyButton value={group.number} what="номер лицевого счёта" />
        </p>
      )}
      <ul className="transfer-list" aria-label={`Значения: ${accountTitle}`}>
        {group.readings.map((reading) => {
          const meter = meterOf(meters, reading.meterId);
          const unit = meter?.data.unit ?? RESOURCE_UNITS[meter?.data.resource ?? 'cold_water'];
          return (
            <li key={reading.id} className="transfer-list__item">
              <div className="transfer-list__head">
                <strong>{meter?.title ?? 'Счётчик'}</strong>
                {reading.consumption === null ? <Status tone="neutral">Начальное</Status> : null}
              </div>
              {readingLines(reading, meters).map((line, index) => (
                <div className="transfer-list__value" key={line.label}>
                  <span>
                    {reading.zones.length > 1
                      ? (zoneLabel(reading.zones, index) ?? '')
                      : 'Значение'}
                    {': '}
                    <strong className="mono">
                      {showWithUnit(reading.values[index] ?? '', unit)}
                    </strong>
                  </span>
                  <CopyButton value={line.value} what={`значение: ${line.label}`} />
                </div>
              ))}
            </li>
          );
        })}
      </ul>
      <div className="btn-row">
        <button
          type="button"
          className="btn btn--secondary"
          onClick={async () => {
            const copied = await copyText(text);
            toast.show({
              message: copied ? 'Скопировано: все значения счёта' : 'Не удалось скопировать',
              detail: copied ? 'Вставьте их в приложение поставщика.' : 'Выделите текст вручную.',
            });
          }}
        >
          <Copy size={20} aria-hidden />
          Скопировать всё
        </button>
      </div>
      <TransmissionMethod
        transmission={group.transmission}
        hasAccount={group.utilityAccountId !== null}
        objectId={objectId}
      />
      {canWrite ? (
        <button
          type="button"
          className="btn btn--primary btn--block transfer-card__mark"
          disabled={busy}
          onClick={onMark}
        >
          <CheckCircle size={20} aria-hidden />
          Отметить переданными
        </button>
      ) : null}
    </section>
  );
}

/** Вкладка «Передача» (UTIL-8): значения по лицевым счетам, способ передачи, «Отметить переданными». */
export function ReadingsTransfer() {
  const ctx = useReadings();
  const { card, allMeters, saved } = ctx;
  const navigate = useNavigate();
  const toast = useToast();
  const refresh = useRefreshMeters();
  const query = useTransmission(card.id);
  const accounts = useAccounts(card.id);
  const mark = useAction();
  const fix = useAction();
  const base = `/home/${card.id}/readings`;

  const groups = query.data ?? [];
  const titleOf = (group: TransmissionGroup) =>
    group.utilityAccountId === null
      ? NO_ACCOUNT
      : (accounts.data?.find((account) => account.id === group.utilityAccountId)?.title ??
        'Лицевой счёт');

  function markGroups(targets: readonly TransmissionGroup[]) {
    void mark.run(async () => {
      // Каждый лицевой счёт отмечается своим способом, поэтому по запросу на счёт: внутри счёта всё или ничего.
      for (const group of targets) {
        await markTransmitted(
          card.id,
          group.readings.map((reading) => reading.id),
          describeTransmission(group.transmission),
        );
      }
      await refresh();
      ctx.setSaved(null);
      toast.show({ message: 'Показания отмечены переданными' });
    });
  }

  function correct(readingId: string, meterId: string, values: string[]) {
    void fix.run(async () => {
      await trashReading(readingId);
      await refresh();
      ctx.setSaved(
        saved === null
          ? null
          : { readings: saved.readings.filter((item) => item.id !== readingId) },
      );
      ctx.prefill(meterId, { ...emptyDraft(values.length), values: values.map(showDecimal) });
      toast.show({ message: 'Показание убрано в корзину', detail: 'Введите верное значение.' });
      navigate(base);
    });
  }

  const warned = (saved?.readings ?? []).filter((reading) => reading.warnings.length > 0);

  return (
    <>
      {saved === null || saved.readings.length === 0 ? null : (
        <section className="card transfer-saved" aria-labelledby="saved-title">
          <h2 className="card__title" id="saved-title">
            Показания сохранены
          </h2>
          <p className="card__meta">Осталось передать их поставщику — значения ниже.</p>
          <ul className="transfer-list" aria-label="Сохранённые показания">
            {saved.readings.map((reading) => {
              const meter = meterOf(allMeters, reading.parentId);
              const unit = meter?.data.unit ?? RESOURCE_UNITS[meter?.data.resource ?? 'cold_water'];
              const consumption = reading.consumption
                ?.map((value, index) => {
                  const zone = zoneLabel(meter?.data.zones ?? [], index);
                  const text = showWithUnit(value, unit);
                  return zone === null ? text : `${zone} ${text}`;
                })
                .join(' · ');
              return (
                <li key={reading.id} className="transfer-list__item">
                  <div className="transfer-list__head">
                    <strong>{meter?.title ?? 'Счётчик'}</strong>
                    <span className="muted">
                      {formatShortDate(reading.occurredOn as DateOnly, ctx.today as DateOnly)}
                    </span>
                  </div>
                  <p>
                    {reading.values
                      .map((value, index) => {
                        const zone = zoneLabel(meter?.data.zones ?? [], index);
                        return zone === null
                          ? showWithUnit(value, unit)
                          : `${zone} ${showWithUnit(value, unit)}`;
                      })
                      .join(' · ')}
                  </p>
                  {consumption === undefined ? null : (
                    <p className="reading__consumption">Расход: {consumption}</p>
                  )}
                  {reading.warnings.map((warning) => (
                    <p className="reading__warning" role="status" key={warning}>
                      {warning}
                    </p>
                  ))}
                  {reading.warnings.length > 0 && ctx.canWrite ? (
                    <button
                      type="button"
                      className="btn btn--secondary"
                      disabled={fix.disabled}
                      onClick={() => correct(reading.id, reading.parentId, reading.values)}
                    >
                      Исправить значение
                    </button>
                  ) : null}
                </li>
              );
            })}
          </ul>
          {warned.length > 0 ? (
            <p className="muted">
              Предупреждение не мешает: если значение верное, просто передайте его.
            </p>
          ) : null}
          <ObjectError error={fix.error} action="reading" />
        </section>
      )}

      <section className="section" aria-labelledby="transfer-heading">
        <div className="section__head">
          <h2 className="section__title" id="transfer-heading">
            Передача показаний
          </h2>
        </div>
        {query.isPending ? <Notice>Загружаем показания к передаче…</Notice> : null}
        {query.isError ? (
          <>
            <ObjectError error={query.error} action="load" />
            <button className="text-button" type="button" onClick={() => void query.refetch()}>
              Повторить загрузку
            </button>
          </>
        ) : null}
        {query.data && groups.length === 0 ? (
          <EmptyState
            icon={<PaperPlaneTilt size={24} aria-hidden />}
            title="Передавать нечего"
            actions={
              <Link className="btn btn--primary btn--block" to={base}>
                Ввести показания
              </Link>
            }
          >
            <p>Все сохранённые показания отмечены переданными. Новые появятся здесь после ввода.</p>
          </EmptyState>
        ) : null}
        {groups.length > 1 && ctx.canWrite ? (
          <button
            type="button"
            className="btn btn--secondary btn--block"
            disabled={mark.disabled}
            onClick={() => markGroups(groups)}
          >
            <CheckCircle size={20} aria-hidden />
            Отметить все переданными
          </button>
        ) : null}
        <div className="card-list">
          {groups.map((group) => (
            <GroupCard
              key={group.utilityAccountId ?? 'none'}
              group={group}
              accountTitle={titleOf(group)}
              meters={allMeters}
              objectId={card.id}
              canWrite={ctx.canWrite}
              busy={mark.disabled}
              onMark={() => markGroups([group])}
            />
          ))}
        </div>
        <ObjectError error={mark.error} action="transmit" />
      </section>
    </>
  );
}
