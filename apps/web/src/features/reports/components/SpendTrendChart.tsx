import { useId } from 'react';
import type { SpendTrend } from '@ims/shared';
import { t } from '@/i18n/en';
import { formatBdt } from '@/lib/format';

/**
 * Twelve months of spend, as a line.
 *
 * Inline SVG rather than a charting library. One line with twelve points does not justify a new
 * dependency, a bundle, and a theme adapter — and drawn by hand it inherits the design tokens for
 * free, which is what makes it legible in both themes without a second colour config.
 *
 * The series always has twelve points because the server fills the gaps; a month with no spend is
 * a real zero on the axis, not a hole the line slopes through.
 */

/** Viewbox units. The chart scales to its container; these only fix the aspect and the maths. */
const WIDTH = 720;
const HEIGHT = 220;
const PAD = { top: 12, right: 12, bottom: 26, left: 56 };

/** A rounded "nice" ceiling, so the axis reads 60k rather than 58,412. */
function niceCeiling(max: number): number {
  if (max <= 0) return 1000;
  const magnitude = 10 ** Math.floor(Math.log10(max));
  return Math.ceil(max / magnitude) * magnitude;
}

/** `৳60k` / `৳900`. Axis labels are for scale, not for reading exact figures off. */
function axisLabel(value: number): string {
  if (value >= 1000) return `${Math.round(value / 1000)}k`;
  return String(Math.round(value));
}

export function SpendTrendChart({ trend }: { trend: SpendTrend }) {
  const gradientId = useId();
  const { points } = trend;

  const max = niceCeiling(points.reduce((m, p) => Math.max(m, p.total), 0));
  const plotWidth = WIDTH - PAD.left - PAD.right;
  const plotHeight = HEIGHT - PAD.top - PAD.bottom;

  const x = (index: number) =>
    PAD.left + (points.length === 1 ? plotWidth / 2 : (index / (points.length - 1)) * plotWidth);
  const y = (value: number) => PAD.top + plotHeight - (value / max) * plotHeight;

  const line = points.map((point, index) => `${x(index)},${y(point.total)}`).join(' ');
  // The fill is the line closed down to the baseline, which is what gives the chart weight
  // without a second data series.
  const area = `${PAD.left},${PAD.top + plotHeight} ${line} ${PAD.left + plotWidth},${PAD.top + plotHeight}`;

  const ticks = [0, 0.5, 1].map((fraction) => fraction * max);
  const everythingIsZero = points.every((point) => point.total === 0);

  return (
    <figure className="m-0">
      <figcaption className="sr-only">
        {t.expenses.trendSubtitle.replace('{range}', trend.rangeLabel)}
      </figcaption>

      {everythingIsZero ? (
        <p className="px-4 py-10 text-center text-sm text-ink-subtle">{t.expenses.trendEmpty}</p>
      ) : (
        <svg
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          className="h-56 w-full"
          role="img"
          aria-label={t.expenses.trendSubtitle.replace('{range}', trend.rangeLabel)}
        >
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="currentColor" stopOpacity="0.18" />
              <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
            </linearGradient>
          </defs>

          {/* Gridlines first, so the line and its points sit over them. */}
          <g className="text-border">
            {ticks.map((tick) => (
              <line
                key={tick}
                x1={PAD.left}
                x2={WIDTH - PAD.right}
                y1={y(tick)}
                y2={y(tick)}
                stroke="currentColor"
                strokeWidth={1}
              />
            ))}
          </g>

          <g className="text-ink-subtle" fontSize={11} fill="currentColor">
            {ticks.map((tick) => (
              <text key={tick} x={PAD.left - 8} y={y(tick) + 4} textAnchor="end">
                {axisLabel(tick)}
              </text>
            ))}
            {points.map((point, index) => (
              <text key={point.key} x={x(index)} y={HEIGHT - 8} textAnchor="middle">
                {/* Just the month: twelve "Sep 2025"s will not fit, and the year is in the heading. */}
                {point.label.split(' ')[0]}
              </text>
            ))}
          </g>

          <g className="text-brand">
            <polygon points={area} fill={`url(#${gradientId})`} />
            <polyline
              points={line}
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              strokeLinejoin="round"
              strokeLinecap="round"
            />
            {points.map((point, index) => (
              <circle key={point.key} cx={x(index)} cy={y(point.total)} r={3} fill="currentColor">
                <title>{`${point.label}: ${formatBdt(point.total)}`}</title>
              </circle>
            ))}
          </g>
        </svg>
      )}
    </figure>
  );
}
