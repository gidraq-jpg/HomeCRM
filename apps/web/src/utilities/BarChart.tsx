import { useId } from 'react';
import { maxOf, ratio } from './analytics.ts';

// Простая диаграмма из SVG без библиотек. Она только показывает форму данных: точные значения лежат
// в таблице рядом, а сам рисунок для экранного диктора описан одной фразой (`summary`).

export interface BarSlot {
  /** Постоянный ключ столбцов: месяц 2026-10. */
  key: string;
  /** Подпись под столбцами: номер месяца. */
  label: string;
  /** Год под подписью — у первого месяца и у января. */
  year?: string;
  /** Высоты столбцов: числа только для рисования. */
  bars: readonly number[];
  /** Отметка «год назад»; `null` — нет. */
  marker: number | null;
}

interface BarChartProps {
  slots: readonly BarSlot[];
  /** Фраза для экранного диктора вместо рисунка. */
  summary: string;
  /** Подпись наибольшего значения шкалы, например «макс. 12 345 ₽». */
  maxLabel: string;
}

const WIDTH = 336;
const HEIGHT = 178;
const LEFT = 8;
const PLOT_TOP = 22;
const PLOT_HEIGHT = 112;
const AXIS = PLOT_TOP + PLOT_HEIGHT;

/** Столбцы по месяцам. Второй столбец в группе заштрихован, отметка «год назад» — чёрточка. */
export function BarChart({ slots, summary, maxLabel }: BarChartProps) {
  const hatch = `hatch-${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  const max = maxOf(
    slots.flatMap((slot) => [...slot.bars, ...(slot.marker === null ? [] : [slot.marker])]),
  );
  const step = (WIDTH - LEFT * 2) / Math.max(1, slots.length);
  const groupSize = Math.max(1, ...slots.map((slot) => slot.bars.length));
  const barWidth = groupSize === 1 ? 14 : 9;
  const gap = 2;
  const groupWidth = barWidth * groupSize + gap * (groupSize - 1);

  return (
    <svg
      className="chart"
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      role="img"
      aria-label={summary}
      focusable="false"
    >
      <defs>
        <pattern
          id={hatch}
          width="4"
          height="4"
          patternUnits="userSpaceOnUse"
          patternTransform="rotate(45)"
        >
          <rect width="4" height="4" className="chart__hatch-bg" />
          <rect width="2" height="4" className="chart__hatch-line" />
        </pattern>
      </defs>
      <text className="chart__scale" x={LEFT} y={12}>
        {maxLabel}
      </text>
      <line className="chart__axis" x1={LEFT} y1={AXIS} x2={WIDTH - LEFT} y2={AXIS} />
      {slots.map((slot, index) => {
        const x = LEFT + index * step + (step - groupWidth) / 2;
        const center = LEFT + index * step + step / 2;
        return (
          <g key={slot.key}>
            {slot.bars.map((value, barIndex) => {
              const height = ratio(value, max) * PLOT_HEIGHT;
              return (
                <rect
                  // Порядок столбцов в группе неизменен: позиция однозначно их различает.
                  // biome-ignore lint/suspicious/noArrayIndexKey: фиксированная группа столбцов
                  key={barIndex}
                  className={barIndex === 0 ? 'chart__bar' : 'chart__bar chart__bar--second'}
                  x={x + barIndex * (barWidth + gap)}
                  y={AXIS - height}
                  width={barWidth}
                  height={height}
                  {...(barIndex === 0 ? {} : { style: { fill: `url(#${hatch})` } })}
                />
              );
            })}
            {slot.marker !== null && slot.marker > 0 ? (
              <line
                className="chart__marker"
                x1={center - groupWidth / 2 - 2}
                x2={center + groupWidth / 2 + 2}
                y1={AXIS - ratio(slot.marker, max) * PLOT_HEIGHT}
                y2={AXIS - ratio(slot.marker, max) * PLOT_HEIGHT}
              />
            ) : null}
            <text className="chart__label" x={center} y={AXIS + 14} textAnchor="middle">
              {slot.label}
            </text>
            {slot.year ? (
              <text className="chart__label" x={center} y={AXIS + 28} textAnchor="middle">
                {slot.year}
              </text>
            ) : null}
          </g>
        );
      })}
    </svg>
  );
}
