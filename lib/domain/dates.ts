/** Date helpers. All in UTC on ISO strings to avoid timezone drift between server and tests. */

export function toISODate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function parseISODate(s: string): Date {
  return new Date(`${s.slice(0, 10)}T00:00:00.000Z`);
}

/** First of the month for the given date. */
export function monthStart(d: Date | string): string {
  const date = typeof d === "string" ? parseISODate(d) : d;
  return toISODate(new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1)));
}

/** Shift a YYYY-MM-01 period by n months (negative = earlier). */
export function addMonths(period: string, n: number): string {
  const d = parseISODate(period);
  return toISODate(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1)));
}

export function lastYear(period: string): string {
  return addMonths(period, -12);
}

/** Inclusive list of monthly periods from `from` to `to`. */
export function monthRange(from: string, to: string): string[] {
  const out: string[] = [];
  for (let p = from; p <= to; p = addMonths(p, 1)) out.push(p);
  return out;
}

/** Monday of the week containing `d`. */
export function weekStart(d: Date | string = new Date()): string {
  const date = typeof d === "string" ? parseISODate(d) : d;
  const day = date.getUTCDay(); // 0 = Sunday
  const diff = day === 0 ? -6 : 1 - day;
  return toISODate(new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + diff)));
}

export function addDays(iso: string, n: number): string {
  const d = parseISODate(iso);
  return toISODate(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + n)));
}

export function formatMonth(period: string, opts: { short?: boolean; year?: boolean } = {}): string {
  const d = parseISODate(period);
  return d.toLocaleDateString("en-US", {
    month: opts.short ? "short" : "long",
    year: opts.year === false ? undefined : "numeric",
    timeZone: "UTC",
  });
}

export function formatDay(iso: string, opts: { weekday?: boolean; year?: boolean } = {}): string {
  return parseISODate(iso).toLocaleDateString("en-US", {
    weekday: opts.weekday ? "short" : undefined,
    month: "short",
    day: "numeric",
    year: opts.year ? "numeric" : undefined,
    timeZone: "UTC",
  });
}

export function formatWeek(weekStartIso: string): string {
  return `${formatDay(weekStartIso)} – ${formatDay(addDays(weekStartIso, 6))}`;
}
