import { Camera, CheckCircle, Copy, PencilSimple } from '@phosphor-icons/react';
import { useId, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router';
import { copyText } from '../../ui/CopyButton.tsx';
import { formatShortDate } from '../../ui/format.ts';
import { Page } from '../../ui/Page.tsx';
import { Status } from '../../ui/Row.tsx';
import { useToast } from '../../ui/Toast.tsx';
import { NotFoundScreen } from '../components.tsx';
import { ACCOUNTS, METERS, TODAY } from '../data/index.ts';
import type { Meter } from '../model.ts';
import { buildTransferText, checkReading, formatReading } from '../readings.ts';
import { usePrototype, useRecord } from '../store.tsx';

const NBSP = String.fromCodePoint(0xa0);

interface MeterFieldProps {
  meter: Meter;
  value: string;
  photo: boolean;
  forceError: boolean;
  onChange: (value: string) => void;
  onPhoto: () => void;
}

/** Поле показания: прошлое значение, цифровая клавиатура, расход и предупреждения (UTIL-7). */
function MeterField({ meter, value, photo, forceError, onChange, onPhoto }: MeterFieldProps) {
  const id = useId();
  const check = checkReading(meter, value);
  const message = check.status === 'invalid' ? check.message : undefined;
  const showError = message !== undefined && (value.trim() !== '' || forceError);
  return (
    <div className="reading">
      <div className="reading__head">
        <h2 className="reading__title">
          {meter.resource} · {meter.place}
        </h2>
        <span className="reading__serial">№ {meter.serial}</span>
      </div>
      <p className="reading__prev">
        Прошлое: <strong>{formatReading(meter, meter.previous)}</strong> ·{' '}
        {formatShortDate(meter.previousDate, TODAY)}
      </p>
      <label className="field__label" htmlFor={id}>
        Новое значение, {meter.unit}
      </label>
      <div className="reading__input-row">
        <input
          id={id}
          className="input"
          type="text"
          inputMode="decimal"
          autoComplete="off"
          enterKeyHint="next"
          value={value}
          data-meter={meter.id}
          aria-invalid={showError}
          aria-describedby={`${id}-note`}
          onChange={(event) => onChange(event.target.value)}
        />
        <button
          type="button"
          className="btn btn--secondary reading__photo"
          aria-pressed={photo}
          aria-label={`Фото счётчика: ${meter.resource}, ${meter.place.toLowerCase()}`}
          onClick={onPhoto}
        >
          <Camera size={22} aria-hidden />
          {photo ? 'Есть фото' : 'Фото'}
        </button>
      </div>
      <p id={`${id}-note`} className="reading__note" aria-live="polite">
        {showError ? (
          <span className="field__error">{message}</span>
        ) : check.status === 'ok' ? (
          <>
            <span className="reading__consumption">
              Расход: {formatReading(meter, check.consumption)}
            </span>
            {check.warning ? <span className="reading__warning">{check.warning}</span> : null}
          </>
        ) : null}
      </p>
    </div>
  );
}

/** «Показания» по объекту: все активные счётчики, ввод, «Сохранить всё», передача (UTIL-7, 8). */
export function ReadingsScreen() {
  const { propertyId } = useParams();
  const property = useRecord('property', propertyId);
  const { state, dispatch } = usePrototype();
  const toast = useToast();
  const list = useRef<HTMLDivElement | null>(null);

  const meters = useMemo(
    () => METERS.filter((meter) => meter.propertyId === propertyId),
    [propertyId],
  );
  const saved = propertyId ? state.readings[propertyId] : undefined;
  const [values, setValues] = useState<Record<string, string>>(saved?.values ?? {});
  const [photos, setPhotos] = useState<Record<string, boolean>>({});
  const [editing, setEditing] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [formError, setFormError] = useState('');

  if (property === undefined || propertyId === undefined) {
    return <NotFoundScreen what="Объект не найден" />;
  }

  const accountTitles = Object.fromEntries(
    ACCOUNTS.map((account) => [account.id, { title: account.title, number: account.number }]),
  );
  const checks = meters.map((meter) => checkReading(meter, values[meter.id] ?? ''));
  const showSummary = saved !== undefined && !editing;

  function save() {
    setSubmitted(true);
    if (checks.some((check) => check.status === 'invalid')) {
      setFormError('Исправьте значения, отмеченные ошибкой.');
      const bad = checks.findIndex((check) => check.status === 'invalid');
      const badId = meters[bad]?.id;
      window.setTimeout(() => {
        list.current?.querySelector<HTMLInputElement>(`[data-meter="${badId}"]`)?.focus();
      }, 0);
      return;
    }
    if (checks.every((check) => check.status === 'empty')) {
      setFormError('Введите хотя бы одно показание.');
      return;
    }
    setFormError('');
    const filled = Object.fromEntries(
      meters.flatMap((meter, index) =>
        checks[index]?.status === 'ok' ? [[meter.id, values[meter.id] ?? '']] : [],
      ),
    );
    dispatch({ type: 'saveReadings', propertyId: propertyId ?? '', values: filled });
    setEditing(false);
    toast.show({ message: 'Показания сохранены', detail: 'Осталось передать их поставщику.' });
  }

  if (showSummary) {
    const transferText = buildTransferText(meters, accountTitles, saved.values);
    return (
      <Page title="Показания" back={{ to: `/home/${propertyId}`, label: property.title }}>
        <section className="card transfer">
          <h2 className="card__title">
            {saved.transmitted ? 'Показания переданы' : 'Показания сохранены'}
          </h2>
          <p className="card__meta">
            {saved.transmitted
              ? 'Пункт в радаре закрыт.'
              : 'Осталось передать их в «Госуслуги Дом» или на сайте поставщика.'}
          </p>
          <ul className="transfer__list">
            {meters.map((meter, index) => {
              const check = checks[index];
              if (check?.status !== 'ok') return null;
              return (
                <li key={meter.id}>
                  <span>
                    {meter.resource} · {meter.place}
                  </span>
                  <strong>{formatReading(meter, check.value)}</strong>
                </li>
              );
            })}
          </ul>
          {saved.transmitted ? (
            <Status tone="ok">Переданы</Status>
          ) : (
            <div className="btn-row">
              <button
                type="button"
                className="btn btn--secondary"
                onClick={async () => {
                  const copied = await copyText(transferText);
                  toast.show({
                    message: copied ? 'Значения скопированы' : 'Не удалось скопировать',
                    detail: copied
                      ? 'Вставьте их в приложение поставщика.'
                      : 'Выделите текст вручную.',
                  });
                }}
              >
                <Copy size={20} aria-hidden />
                Скопировать значения
              </button>
              <button
                type="button"
                className="btn btn--secondary"
                onClick={() =>
                  toast.show({
                    message: 'В прототипе способ передачи не открывается',
                    detail: 'В рабочей версии здесь откроется «Госуслуги Дом» или сайт поставщика.',
                  })
                }
              >
                Открыть «Госуслуги Дом»
              </button>
              <button
                type="button"
                className="btn btn--primary"
                onClick={() => {
                  dispatch({ type: 'markTransmitted', propertyId });
                  toast.show({ message: 'Отмечено: показания переданы' });
                }}
              >
                <CheckCircle size={20} aria-hidden />
                Отметить переданными
              </button>
            </div>
          )}
        </section>
        {!saved.transmitted ? (
          <button type="button" className="text-button" onClick={() => setEditing(true)}>
            <PencilSimple size={20} aria-hidden />
            Изменить значения
          </button>
        ) : null}
      </Page>
    );
  }

  return (
    <Page title="Показания" back={{ to: `/home/${propertyId}`, label: property.title }}>
      <p className="muted">
        Введите текущие значения. Цифры принимаются и с запятой, и с точкой{NBSP}— как удобнее.
      </p>
      <div className="reading-list" ref={list}>
        {meters.map((meter) => (
          <MeterField
            key={meter.id}
            meter={meter}
            value={values[meter.id] ?? ''}
            photo={photos[meter.id] === true}
            forceError={submitted}
            onChange={(value) => {
              setValues((previous) => ({ ...previous, [meter.id]: value }));
              setFormError('');
            }}
            onPhoto={() =>
              setPhotos((previous) => ({ ...previous, [meter.id]: !previous[meter.id] }))
            }
          />
        ))}
      </div>
      {formError ? (
        <p className="field__error" role="alert">
          {formError}
        </p>
      ) : null}
      <button type="button" className="btn btn--primary btn--block reading__save" onClick={save}>
        Сохранить всё
      </button>
    </Page>
  );
}
