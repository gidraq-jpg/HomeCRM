import { Camera, Gauge, X } from '@phosphor-icons/react';
import { useId, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { Notice, useAction } from '../auth/components.tsx';
import { uploadFile } from '../files/api.ts';
import { fileErrorMessage, LOCAL_MESSAGES } from '../files/errors.ts';
import { localProblem, prepareForUpload } from '../files/prepare.ts';
import { ObjectError } from '../objects/components.tsx';
import { CheckLine } from '../ui/CheckLine.tsx';
import { EmptyState } from '../ui/EmptyState.tsx';
import { type DateOnly, formatShortDate } from '../ui/format.ts';
import { useToast } from '../ui/Toast.tsx';
import { type MeterListItem, saveReadings } from './api.ts';
import { showDecimal, showWithUnit } from './decimal.ts';
import { RESOURCE_UNITS, zoneLabel } from './labels.ts';
import { ReplaceSheet } from './MeterForms.tsx';
import { useRefreshMeters } from './queries.ts';
import { type ReadingsContext, useReadings } from './ReadingsLayout.tsx';
import {
  blockingDate,
  buildPayload,
  emptyDraft,
  evaluateMeter,
  type ReadingDraft,
} from './readings.ts';

const MAX_PHOTOS = 3;
const PHOTO_ACCEPT = 'image/jpeg,image/png,image/webp,image/heic,image/heif';

interface MeterFieldProps {
  meter: MeterListItem;
  ctx: ReadingsContext;
  /** Проверка при «Сохранить всё» уже была: ошибки показываются и у пустых зон. */
  submitted: boolean;
  photoProblem: string | undefined;
  onPhotoProblem: (text: string | undefined) => void;
}

/** Один счётчик: место, прошлое значение, поля по зонам, расход, фото (UTIL-7). */
function MeterField({ meter, ctx, submitted, photoProblem, onPhotoProblem }: MeterFieldProps) {
  const base = useId();
  const picker = useRef<HTMLInputElement>(null);
  const [replacing, setReplacing] = useState(false);
  const draft = ctx.drafts[meter.id] ?? emptyDraft(meter.data.zones.length);
  const entry = evaluateMeter(meter, draft);
  const unit = meter.data.unit ?? RESOURCE_UNITS[meter.data.resource];
  const previous = meter.previousReading;
  const photos = ctx.files[meter.id] ?? [];
  const titleId = `${base}-title`;

  const change = (next: ReadingDraft) => ctx.setDraft(meter.id, next);
  const consumption = entry.consumption.some((value) => value !== null)
    ? meter.data.zones
        .map((zone, index) => {
          const value = entry.consumption[index];
          if (value === null || value === undefined) return null;
          const text = showWithUnit(value, unit);
          return meter.data.zones.length > 1 ? `${zone} ${text}` : text;
        })
        .filter((text) => text !== null)
        .join(' · ')
    : null;

  function addPhotos(list: FileList | null) {
    const chosen = Array.from(list ?? []);
    if (chosen.length === 0) return;
    const accepted: File[] = [];
    for (const file of chosen) {
      const problem = localProblem(file);
      if (problem !== null) {
        onPhotoProblem(LOCAL_MESSAGES[problem]);
        return;
      }
      accepted.push(file);
    }
    if (photos.length + accepted.length > MAX_PHOTOS) {
      onPhotoProblem(`К одному показанию — не больше ${MAX_PHOTOS} фото.`);
      return;
    }
    onPhotoProblem(undefined);
    ctx.setFiles(meter.id, [...photos, ...accepted]);
  }

  return (
    <li className="reading-item">
      <section className="reading" aria-labelledby={titleId}>
        <div className="reading__head">
          <h2 className="reading__title" id={titleId}>
            {meter.title}
          </h2>
          {meter.data.serialNumber === '' ? null : (
            <span className="reading__serial">№ {meter.data.serialNumber}</span>
          )}
        </div>
        <p className="reading__prev">
          {previous === null ? (
            'Прошлого показания нет: введённое станет начальным.'
          ) : (
            <>
              Прошлое:{' '}
              <strong>
                {previous.values
                  .map((value, index) => {
                    const zone = zoneLabel(meter.data.zones, index);
                    return zone === null ? showDecimal(value) : `${zone} ${showDecimal(value)}`;
                  })
                  .join(' · ')}{' '}
                {unit}
              </strong>{' '}
              · {formatShortDate(previous.occurredOn as DateOnly, ctx.today as DateOnly)}
            </>
          )}
        </p>

        {ctx.canWrite
          ? meter.data.zones.map((zone, index) => {
              const inputId = `${base}-value-${index}`;
              const problem = entry.problems[index];
              const shown =
                problem !== undefined && ((draft.values[index] ?? '').trim() !== '' || submitted)
                  ? problem
                  : undefined;
              const label =
                meter.data.zones.length === 1
                  ? `Новое значение, ${unit}`
                  : `${zone}: новое значение, ${unit}`;
              return (
                <div className="reading__zone" key={zone + String(index)}>
                  <label className="field__label" htmlFor={inputId}>
                    {label}
                  </label>
                  <input
                    id={inputId}
                    className="input"
                    type="text"
                    inputMode="decimal"
                    autoComplete="off"
                    enterKeyHint="next"
                    value={draft.values[index] ?? ''}
                    aria-invalid={shown !== undefined}
                    aria-describedby={shown === undefined ? undefined : `${inputId}-error`}
                    onChange={(event) => {
                      const values = [...draft.values];
                      values[index] = event.target.value;
                      change({ ...draft, values });
                    }}
                  />
                  {shown === undefined ? null : (
                    <p className="field__error" id={`${inputId}-error`} role="alert">
                      {shown}
                    </p>
                  )}
                </div>
              );
            })
          : null}

        {ctx.canWrite && entry.anyLower ? (
          <div className="reading__choice">
            <p className="reading__choice-text">
              Значение меньше прошлого. Выберите, что произошло:
            </p>
            <CheckLine
              checked={draft.rollover}
              onChange={(rollover) => change({ ...draft, rollover })}
            >
              Переход через ноль
            </CheckLine>
            <button
              type="button"
              className="btn btn--secondary btn--block"
              onClick={() => setReplacing(true)}
            >
              Замена счётчика
            </button>
          </div>
        ) : null}

        <p className="reading__note" aria-live="polite">
          {consumption === null ? null : (
            <span className="reading__consumption">Расход: {consumption}</span>
          )}
        </p>

        {ctx.canWrite ? (
          <div className="reading__photos">
            <input
              ref={picker}
              type="file"
              accept={PHOTO_ACCEPT}
              multiple
              hidden
              aria-label={`Фото счётчика: ${meter.title}`}
              onChange={(event) => {
                addPhotos(event.currentTarget.files);
                event.currentTarget.value = '';
              }}
            />
            <button
              type="button"
              className="btn btn--secondary reading__photo"
              disabled={photos.length >= MAX_PHOTOS}
              onClick={() => picker.current?.click()}
            >
              <Camera size={22} aria-hidden />
              {photos.length === 0 ? 'Фото' : 'Ещё фото'}
            </button>
            {photos.map((file, index) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: у фото в черновике нет своих id, список меняется только добавлением и удалением
              <span className="reading__photo-chip" key={`${file.lastModified}-${index}`}>
                Фото {index + 1}
                <button
                  type="button"
                  className="icon-button"
                  aria-label={`Убрать фото ${index + 1}: ${meter.title}`}
                  onClick={() => {
                    ctx.setFiles(
                      meter.id,
                      photos.filter((_, position) => position !== index),
                    );
                    ctx.setUploaded({ ...ctx.uploaded, [meter.id]: [] });
                  }}
                >
                  <X size={18} aria-hidden />
                </button>
              </span>
            ))}
            {photoProblem === undefined ? null : (
              <p className="field__error" role="alert">
                {photoProblem}
              </p>
            )}
          </div>
        ) : null}
      </section>
      {replacing ? (
        <ReplaceSheet
          objectId={ctx.card.id}
          old={meter}
          {...((draft.values[0] ?? '').trim() !== '' && meter.data.zones.length === 1
            ? { suggestedInitial: draft.values[0] ?? '' }
            : {})}
          onDone={() => change(emptyDraft(meter.data.zones.length))}
          onClose={() => setReplacing(false)}
        />
      ) : null}
    </li>
  );
}

/** Вкладка «Ввод»: все работающие счётчики объекта, «Сохранить всё» одним запросом (S3). */
export function ReadingsEntry() {
  const ctx = useReadings();
  const navigate = useNavigate();
  const toast = useToast();
  const refresh = useRefreshMeters();
  const state = useAction();
  const list = useRef<HTMLUListElement>(null);
  const dateId = useId();
  const [submitted, setSubmitted] = useState(false);
  const [formError, setFormError] = useState('');
  const [photoProblems, setPhotoProblems] = useState<Record<string, string | undefined>>({});
  const [uploading, setUploading] = useState(false);

  const { card, meters } = ctx;
  const base = `/home/${card.id}/readings`;
  const blocked = blockingDate(meters, ctx.drafts, ctx.date);
  const future = ctx.date > ctx.today;
  const dateProblem = !/^\d{4}-\d{2}-\d{2}$/.test(ctx.date)
    ? 'Укажите дату полностью: день, месяц и год.'
    : future
      ? 'Дата показаний не может быть в будущем.'
      : blocked !== null
        ? `На эту дату у счётчика уже есть показание, или оно позже. Выберите дату позже ${formatShortDate(blocked as DateOnly, ctx.today as DateOnly)}.`
        : undefined;

  if (ctx.metersLoading) return <Notice>Загружаем счётчики…</Notice>;

  if (meters.length === 0) {
    return (
      <EmptyState
        icon={<Gauge size={24} aria-hidden />}
        title="Работающих счётчиков нет"
        actions={
          <Link className="btn btn--primary btn--block" to={`/home/${card.id}/meters`}>
            К счётчикам объекта
          </Link>
        }
      >
        <p>Чтобы вводить показания, заведите счётчик на вкладке «Счётчики» объекта.</p>
      </EmptyState>
    );
  }

  function save() {
    setSubmitted(true);
    const first = () =>
      window.setTimeout(
        () => list.current?.querySelector<HTMLInputElement>('input[aria-invalid="true"]')?.focus(),
        0,
      );
    if (dateProblem !== undefined) {
      setFormError('Исправьте дату показаний.');
      document.getElementById(dateId)?.focus();
      return;
    }
    const probe = buildPayload(meters, ctx.drafts, ctx.date, {});
    if (probe.invalid.length > 0) {
      setFormError('Исправьте значения, отмеченные ошибкой.');
      first();
      return;
    }
    if (probe.readings.length === 0) {
      setFormError('Введите хотя бы одно показание.');
      return;
    }
    setFormError('');
    void state.run(async () => {
      // Фото уходят в файлы объекта до показаний; уже загруженные при повторе не отправляются снова.
      const ids: Record<string, string[]> = { ...ctx.uploaded };
      const problems: Record<string, string | undefined> = {};
      setUploading(true);
      try {
        for (const reading of probe.readings) {
          const pending = ctx.files[reading.meterId] ?? [];
          if (pending.length === 0 || (ids[reading.meterId]?.length ?? 0) === pending.length) {
            continue;
          }
          ids[reading.meterId] = [];
          for (const file of pending) {
            try {
              const prepared = await prepareForUpload(file);
              const meta = await uploadFile({ kind: 'object', id: card.id }, prepared);
              ids[reading.meterId]?.push(meta.id);
            } catch (error) {
              problems[reading.meterId] = fileErrorMessage(error, 'upload');
              ctx.setUploaded(ids);
              setPhotoProblems(problems);
              setFormError(
                'Не удалось загрузить фото. Уберите его или повторите: значения не потеряны.',
              );
              return;
            }
          }
        }
      } finally {
        setUploading(false);
      }
      ctx.setUploaded(ids);
      const payload = buildPayload(meters, ctx.drafts, ctx.date, ids);
      const result = await saveReadings(card.id, payload.readings);
      await refresh();
      ctx.setSaved({ readings: result });
      for (const reading of payload.readings) {
        ctx.setDraft(reading.meterId, emptyDraft(reading.values.length));
        ctx.setFiles(reading.meterId, []);
      }
      ctx.setUploaded({});
      setSubmitted(false);
      setPhotoProblems({});
      toast.show({ message: 'Показания сохранены', detail: 'Осталось передать их поставщику.' });
      navigate(`${base}/transfer`);
    });
  }

  return (
    <>
      {ctx.canWrite ? (
        <p className="muted">
          Введите текущие значения. Цифры принимаются и с запятой, и с точкой — как удобнее. Пустые
          счётчики пропускаются.
        </p>
      ) : (
        <Notice>
          Вводить показания могут только взрослые участники дома. Здесь прошлые значения — только
          для чтения.
        </Notice>
      )}

      {ctx.canWrite ? (
        <div className="field reading-date">
          <label className="field__label" htmlFor={dateId}>
            Дата показаний
          </label>
          <input
            id={dateId}
            className="input"
            type="date"
            value={ctx.date}
            max={ctx.today}
            aria-invalid={dateProblem !== undefined && submitted}
            aria-describedby={
              dateProblem !== undefined && submitted ? `${dateId}-error` : undefined
            }
            onChange={(event) => ctx.setDate(event.target.value)}
          />
          {dateProblem !== undefined && (submitted || future) ? (
            <p className="field__error" id={`${dateId}-error`} role="alert">
              {dateProblem}
            </p>
          ) : null}
        </div>
      ) : null}

      <ul className="reading-list" ref={list} aria-label="Счётчики">
        {meters.map((meter) => (
          <MeterField
            key={meter.id}
            meter={meter}
            ctx={ctx}
            submitted={submitted}
            photoProblem={photoProblems[meter.id]}
            onPhotoProblem={(text) =>
              setPhotoProblems((previous) => ({ ...previous, [meter.id]: text }))
            }
          />
        ))}
      </ul>

      {formError === '' ? null : (
        <p className="field__error" role="alert">
          {formError}
        </p>
      )}
      <ObjectError error={state.error} action="reading" />
      {ctx.canWrite ? (
        <button
          type="button"
          className="btn btn--primary btn--block reading__save"
          disabled={state.disabled}
          onClick={save}
        >
          {uploading ? 'Загружаем фото…' : state.pending ? 'Сохраняем…' : 'Сохранить всё'}
        </button>
      ) : null}
    </>
  );
}
