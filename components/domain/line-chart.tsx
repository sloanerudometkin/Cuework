import { formatMonth } from "@/lib/domain/dates";
import { formatMetricValue } from "@/lib/domain/metrics";
import type { MetricId } from "@/lib/domain/types";

interface Point {
  period: string;
  value: number | null;
}

/**
 * Two-line comparison: this year vs. the same months a year earlier (dashed).
 * Includes an accessible text summary and a visually-hidden data table.
 */
export function ComparisonChart({ metric, current, previous, name }: { metric: MetricId; current: Point[]; previous: Point[]; name: string }) {
  const W = 560;
  const H = 168;
  const pad = { l: 44, r: 12, t: 12, b: 24 };
  const vals = [...current, ...previous].map((p) => p.value).filter((v): v is number => v != null);
  if (current.filter((p) => p.value != null).length < 2) return <p className="text-sm text-muted">Not enough history to chart yet.</p>;
  const min = Math.min(0, ...vals);
  const max = Math.max(...vals) * 1.08 || 1;
  const n = current.length;
  const x = (i: number) => pad.l + (i / (n - 1)) * (W - pad.l - pad.r);
  const y = (v: number) => pad.t + (1 - (v - min) / (max - min || 1)) * (H - pad.t - pad.b);
  const path = (pts: Point[]) =>
    pts
      .map((p, i) => (p.value == null ? null : `${i === 0 || pts[i - 1].value == null ? "M" : "L"}${x(i).toFixed(1)} ${y(p.value).toFixed(1)}`))
      .filter(Boolean)
      .join(" ");
  const ticks = [min, (min + max) / 2, max];
  const last = current[n - 1];
  const first = current[0];

  return (
    <figure>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={`${name}: ${formatMetricValue(metric, last.value)} in ${formatMonth(last.period)}, compared with ${formatMetricValue(metric, previous[n - 1]?.value ?? null)} a year earlier.`}>
        {ticks.map((t, i) => (
          <g key={i}>
            <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} stroke="var(--color-line)" strokeWidth="1" />
            <text x={pad.l - 8} y={y(t) + 4} textAnchor="end" fontSize="10.5" fill="var(--color-muted)" className="tabular">
              {formatMetricValue(metric, t, { compact: true })}
            </text>
          </g>
        ))}
        <path d={path(previous)} fill="none" stroke="var(--color-line-strong)" strokeWidth="2" strokeDasharray="4 4" strokeLinecap="round" />
        <path d={path(current)} fill="none" stroke="var(--color-ink)" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round" />
        {last.value != null ? <circle cx={x(n - 1)} cy={y(last.value)} r="4" fill="var(--color-cue)" stroke="white" strokeWidth="1.5" /> : null}
        <text x={x(0)} y={H - 6} fontSize="10.5" fill="var(--color-muted)" textAnchor="start">{formatMonth(first.period, { short: true })}</text>
        <text x={x(n - 1)} y={H - 6} fontSize="10.5" fill="var(--color-muted)" textAnchor="end">{formatMonth(last.period, { short: true })}</text>
      </svg>
      <figcaption className="mt-1 flex items-center gap-4 text-xs text-muted">
        <span className="inline-flex items-center gap-1.5"><span className="h-0.5 w-5 bg-ink" aria-hidden />This year</span>
        <span className="inline-flex items-center gap-1.5"><span className="h-0 w-5 border-t-2 border-dashed border-line-strong" aria-hidden />Same months last year</span>
      </figcaption>
      {/* A div wrapper: a <table> ignores sr-only's 1px width and would keep its full layout width, stretching the page. */}
      <div className="sr-only">
      <table>
        <caption>{name} by month</caption>
        <thead><tr><th>Month</th><th>This year</th><th>Last year</th></tr></thead>
        <tbody>
          {current.map((p, i) => (
            <tr key={p.period}><td>{formatMonth(p.period)}</td><td>{formatMetricValue(metric, p.value)}</td><td>{formatMetricValue(metric, previous[i]?.value ?? null)}</td></tr>
          ))}
        </tbody>
      </table>
      </div>
    </figure>
  );
}
