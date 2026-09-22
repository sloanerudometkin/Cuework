import { cn } from "@/lib/utils";

/** Tiny trend line. Decorative by default; pass `label` to expose it to assistive tech. */
export function Sparkline({
  values,
  className,
  tone = "ink",
  label,
}: {
  values: (number | null)[];
  className?: string;
  tone?: "ink" | "good" | "bad";
  label?: string;
}) {
  const pts = values.map((v, i) => ({ v, i })).filter((p): p is { v: number; i: number } => p.v != null);
  if (pts.length < 2) return <div className={cn("h-8 w-24", className)} aria-hidden />;
  const w = 96;
  const h = 32;
  const min = Math.min(...pts.map((p) => p.v));
  const max = Math.max(...pts.map((p) => p.v));
  const span = max - min || 1;
  const x = (i: number) => (i / (values.length - 1)) * (w - 4) + 2;
  const y = (v: number) => h - 4 - ((v - min) / span) * (h - 8);
  const d = pts.map((p, k) => `${k ? "L" : "M"}${x(p.i).toFixed(1)} ${y(p.v).toFixed(1)}`).join(" ");
  const last = pts[pts.length - 1];
  const stroke = tone === "good" ? "var(--color-moss)" : tone === "bad" ? "var(--color-brick)" : "var(--color-ink)";
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className={cn("h-8 w-24 overflow-visible", className)} role={label ? "img" : undefined} aria-label={label} aria-hidden={label ? undefined : true}>
      <path d={d} fill="none" stroke={stroke} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" opacity="0.85" />
      <circle cx={x(last.i)} cy={y(last.v)} r="2.6" fill={stroke} />
    </svg>
  );
}
