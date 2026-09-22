import Papa from "papaparse";
import { z } from "zod";
import { addMonths, monthStart } from "./dates";
import type { Channel, Dimension, Snapshot } from "./types";

export const DATASETS = ["site_totals", "search_queries", "paid_keywords", "paid_campaigns", "landing_pages"] as const;
export type DatasetId = (typeof DATASETS)[number];

export interface DatasetDef {
  id: DatasetId;
  label: string;
  description: string;
  columns: string[];
  optional: string[];
  /** Which (channel, dimension) rows this dataset replaces when imported. */
  produces: { channel: Channel; dimension: Dimension }[];
}

export const DATASET_DEFS: Record<DatasetId, DatasetDef> = {
  site_totals: {
    id: "site_totals",
    label: "Site totals by channel",
    description: "Monthly totals per channel (from GA4 or Search Console exports). Powers KPIs, YoY and anomaly checks.",
    columns: ["month", "channel", "impressions", "clicks", "sessions", "conversions", "cost"],
    optional: ["impressions", "clicks", "cost"],
    produces: [
      { channel: "organic", dimension: "property" },
      { channel: "paid", dimension: "property" },
      { channel: "other", dimension: "property" },
    ],
  },
  search_queries: {
    id: "search_queries",
    label: "Search queries",
    description: "Organic queries with impressions, clicks and position (Search Console “Queries” export).",
    columns: ["month", "query", "landing_page", "impressions", "clicks", "avg_position", "intent", "answer_ready"],
    optional: ["landing_page", "intent", "answer_ready"],
    produces: [{ channel: "organic", dimension: "query" }],
  },
  paid_keywords: {
    id: "paid_keywords",
    label: "Paid keywords",
    description: "Keyword-level spend and conversions (Google Ads “Search keywords” export).",
    columns: ["month", "campaign", "keyword", "impressions", "clicks", "cost", "conversions"],
    optional: ["impressions"],
    produces: [{ channel: "paid", dimension: "keyword" }],
  },
  paid_campaigns: {
    id: "paid_campaigns",
    label: "Paid campaigns",
    description: "Campaign-level spend and conversions, with an optional budget-limited flag.",
    columns: ["month", "campaign", "impressions", "clicks", "cost", "conversions", "budget_limited"],
    optional: ["impressions", "budget_limited"],
    produces: [{ channel: "paid", dimension: "campaign" }],
  },
  landing_pages: {
    id: "landing_pages",
    label: "Landing pages",
    description: "Organic landing-page sessions and conversions (GA4 “Landing page” report).",
    columns: ["month", "page", "sessions", "conversions"],
    optional: [],
    produces: [{ channel: "organic", dimension: "page" }],
  },
};

const num = () =>
  z
    .union([z.string(), z.number()])
    .transform((v) => {
      if (typeof v === "number") return v;
      const cleaned = String(v).replace(/[$,%\s]/g, "");
      return cleaned === "" ? Number.NaN : Number(cleaned);
    })
    // One message per problem; the field name is added to the message by the caller.
    .superRefine((n, ctx) => {
      if (!Number.isFinite(n)) ctx.addIssue({ code: "custom", message: "must be a number" });
      else if (n < 0) ctx.addIssue({ code: "custom", message: "can't be negative" });
    });

const optNum = () =>
  z
    .union([z.string(), z.number()])
    .nullish() // must be optional *before* the transform, or a missing column fails as "nonoptional"
    .transform((v) => (v === undefined || v === null || String(v).trim() === "" ? 0 : Number(String(v).replace(/[$,%\s]/g, ""))))
    .refine((n) => Number.isFinite(n) && n >= 0, { message: "must be a non-negative number" });

/** YYYY-MM or YYYY-MM-DD with a real calendar month/day; normalised to the first of the month. */
const month = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}(-\d{2})?$/, "must look like 2026-08")
  .refine(
    (s) => {
      const [y, m, d] = s.split("-").map(Number);
      if (m < 1 || m > 12) return false;
      const day = d ?? 1;
      const probe = new Date(Date.UTC(y, m - 1, day));
      return probe.getUTCMonth() === m - 1 && probe.getUTCDate() === day;
    },
    { message: "isn't a valid date" },
  )
  .transform((s) => monthStart(s.length === 7 ? `${s}-01` : s));

const text = () => z.string().trim().min(1, "is required").max(300, "is too long");

const bool = z
  .union([z.string(), z.boolean()])
  .optional()
  .transform((v) => (typeof v === "boolean" ? v : ["true", "yes", "1", "y"].includes(String(v ?? "").trim().toLowerCase())));

const SCHEMAS = {
  site_totals: z.object({
    month,
    channel: z.string().trim().toLowerCase().pipe(z.enum(["organic", "paid", "other"], { message: "must be organic, paid or other" })),
    impressions: optNum(),
    clicks: optNum(),
    sessions: num(),
    conversions: num(),
    cost: optNum(),
  }),
  search_queries: z.object({
    month,
    query: text(),
    landing_page: z.string().trim().optional(),
    impressions: num(),
    clicks: num(),
    avg_position: num(),
    intent: z.string().trim().toLowerCase().optional(),
    answer_ready: bool,
  }),
  paid_keywords: z.object({
    month,
    campaign: text(),
    keyword: text(),
    impressions: optNum(),
    clicks: num(),
    cost: num(),
    conversions: num(),
  }),
  paid_campaigns: z.object({
    month,
    campaign: text(),
    impressions: optNum(),
    clicks: num(),
    cost: num(),
    conversions: num(),
    budget_limited: bool,
  }),
  landing_pages: z.object({
    month,
    page: text(),
    sessions: num(),
    conversions: num(),
  }),
} as const;

export interface CsvRowError {
  line: number;
  message: string;
}

/** A validated row, before it is attached to a property and data source. */
export type ImportRow = Omit<Snapshot, "id" | "propertyId" | "dataSourceId">;

export interface CsvParseResult {
  rows: ImportRow[];
  errors: CsvRowError[];
  totalRows: number;
  months: string[];
  fatal: string | null;
}

export const MAX_ROWS = 20_000;

function base(): Omit<ImportRow, "periodStart" | "channel" | "dimension" | "key" | "secondaryKey"> {
  return { impressions: 0, clicks: 0, sessions: 0, conversions: 0, cost: 0, avgPosition: null, attrs: {} };
}

/** Parse and validate CSV text for a dataset. Never throws; problems come back in `errors`/`fatal`. */
export function parseDataset(dataset: DatasetId, csvText: string): CsvParseResult {
  const def = DATASET_DEFS[dataset];
  const empty: CsvParseResult = { rows: [], errors: [], totalRows: 0, months: [], fatal: null };

  const parsed = Papa.parse<Record<string, string>>(csvText.replace(/^﻿/, ""), {
    header: true,
    skipEmptyLines: "greedy",
    transformHeader: (h) => h.trim().toLowerCase().replace(/\s+/g, "_"),
  });

  const headers = parsed.meta.fields ?? [];
  const required = def.columns.filter((c) => !def.optional.includes(c));
  const missing = required.filter((c) => !headers.includes(c));
  if (missing.length) {
    return { ...empty, fatal: `Missing required column${missing.length > 1 ? "s" : ""}: ${missing.join(", ")}. Expected: ${def.columns.join(", ")}.` };
  }
  if (parsed.data.length === 0) return { ...empty, fatal: "The file has a header but no data rows." };
  if (parsed.data.length > MAX_ROWS) return { ...empty, fatal: `The file has ${parsed.data.length.toLocaleString()} rows; the limit is ${MAX_ROWS.toLocaleString()} per import.` };

  const schema = SCHEMAS[dataset];
  const rows: CsvParseResult["rows"] = [];
  const errors: CsvRowError[] = [];
  const months = new Set<string>();
  const seen = new Map<string, number>();
  let bad = 0;

  parsed.data.forEach((raw, idx) => {
    const line = idx + 2; // header is line 1
    const r = schema.safeParse(raw);
    if (!r.success) {
      bad++;
      if (errors.length < 25) errors.push({ line, message: r.error.issues.map((i) => `${i.path.join(".") || "row"}: ${i.message}`).join("; ") });
      return;
    }
    const v = r.data as Record<string, unknown> & { month: string };
    const row = mapRow(dataset, v);
    // The same month + item twice would be counted twice, so it is an error rather than a silent sum.
    const natural = `${row.periodStart}|${row.channel}|${row.dimension}|${row.key}|${row.secondaryKey ?? ""}`;
    const first = seen.get(natural);
    if (first !== undefined) {
      bad++;
      if (errors.length < 25) errors.push({ line, message: `duplicates line ${first} (same month and item). Combine them into one row.` });
      return;
    }
    seen.set(natural, line);
    months.add(v.month);
    rows.push(row);
  });

  if (bad > errors.length) errors.push({ line: 0, message: `…and ${bad - errors.length} more invalid rows.` });
  return { rows, errors, totalRows: parsed.data.length, months: [...months].sort(), fatal: null };
}

function mapRow(dataset: DatasetId, r: Record<string, unknown> & { month: string }): ImportRow {
  switch (dataset) {
    case "site_totals":
      return {
        ...base(),
        periodStart: r.month,
        channel: r.channel as Channel,
        dimension: "property",
        key: "",
        secondaryKey: null,
        impressions: r.impressions as number,
        clicks: r.clicks as number,
        sessions: r.sessions as number,
        conversions: r.conversions as number,
        cost: r.cost as number,
      };
    case "search_queries":
      return {
        ...base(),
        periodStart: r.month,
        channel: "organic",
        dimension: "query",
        key: r.query as string,
        secondaryKey: (r.landing_page as string) || null,
        impressions: r.impressions as number,
        clicks: r.clicks as number,
        avgPosition: r.avg_position as number,
        attrs: {
          intent: (r.intent as string) || null,
          answerReady: r.intent === "question" ? Boolean(r.answer_ready) : null,
        },
      };
    case "paid_keywords":
      return {
        ...base(),
        periodStart: r.month,
        channel: "paid",
        dimension: "keyword",
        key: r.keyword as string,
        secondaryKey: r.campaign as string,
        impressions: r.impressions as number,
        clicks: r.clicks as number,
        cost: r.cost as number,
        conversions: r.conversions as number,
      };
    case "paid_campaigns":
      return {
        ...base(),
        periodStart: r.month,
        channel: "paid",
        dimension: "campaign",
        key: r.campaign as string,
        secondaryKey: null,
        impressions: r.impressions as number,
        clicks: r.clicks as number,
        cost: r.cost as number,
        conversions: r.conversions as number,
        attrs: { budgetLimited: Boolean(r.budget_limited) },
      };
    case "landing_pages":
      return {
        ...base(),
        periodStart: r.month,
        channel: "organic",
        dimension: "page",
        key: r.page as string,
        secondaryKey: null,
        sessions: r.sessions as number,
        conversions: r.conversions as number,
      };
  }
}

/** A tiny, realistic template so people can see the exact format. Uses recent months. */
export function templateCsv(dataset: DatasetId, latestMonth: string): string {
  const m1 = latestMonth.slice(0, 7);
  const m0 = addMonths(latestMonth, -1).slice(0, 7);
  switch (dataset) {
    case "site_totals":
      return [
        "month,channel,impressions,clicks,sessions,conversions,cost",
        `${m0},organic,410000,11800,12400,310,0`,
        `${m1},organic,425000,12100,12900,322,0`,
        `${m1},paid,90000,2600,2700,140,3900`,
        `${m1},other,0,0,4100,88,0`,
      ].join("\n");
    case "search_queries":
      return [
        "month,query,landing_page,impressions,clicks,avg_position,intent,answer_ready",
        `${m1},example service hours,/hours,5200,210,3.4,informational,`,
        `${m1},how do i renew a permit,,1800,40,9.1,question,false`,
      ].join("\n");
    case "paid_keywords":
      return [
        "month,campaign,keyword,impressions,clicks,cost,conversions",
        `${m1},Brand,example brand,8000,900,640,88`,
        `${m1},Generic,cheap example,4200,310,420,0`,
      ].join("\n");
    case "paid_campaigns":
      return [
        "month,campaign,impressions,clicks,cost,conversions,budget_limited",
        `${m1},Brand,22000,2100,1500,180,true`,
        `${m1},Generic,61000,3400,4100,95,false`,
      ].join("\n");
    case "landing_pages":
      return ["month,page,sessions,conversions", `${m1},/tickets,8200,290`, `${m1},/hours,5100,40`].join("\n");
  }
}
