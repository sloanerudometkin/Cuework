import { and, eq, inArray } from "drizzle-orm";
import type { Db } from "@/lib/db/connect";
import { dataSources, metricSnapshots } from "@/lib/db/schema";
import { DATASET_DEFS, parseDataset, type CsvParseResult, type DatasetId } from "@/lib/domain/csv";
import { checkLimit } from "@/lib/domain/entitlements";
import { measureOutcomes } from "./outcomes";
import { refreshRecommendations } from "./recommendations";
import { loadWorkspace, ServiceError } from "./workspace";

export interface ImportSummary {
  rows: number;
  months: string[];
  replaced: number;
  newRecommendations: number;
  outcomesMeasured: number;
}

/**
 * Validates and imports one CSV. All-or-nothing: a file with any invalid row is
 * rejected, because a silently partial import would corrupt month-over-month math.
 */
export async function importDataset(
  db: Db,
  args: { orgId: string; propertyId: string; dataset: DatasetId; csv: string; fileName: string },
): Promise<ImportSummary> {
  const { orgId, propertyId, dataset, csv, fileName } = args;
  const ws = await loadWorkspace(db, orgId);
  if (!ws.properties.some((p) => p.id === propertyId)) throw new ServiceError("Choose one of your properties.", "not_found");
  if (!(dataset in DATASET_DEFS)) throw new ServiceError("Unknown dataset type.");

  const limit = checkLimit(ws.planKey, "importsPerMonth", ws.usage);
  if (!limit.allowed) throw new ServiceError(limit.message ?? "Import limit reached.", "limit");

  const parsed = parseDataset(dataset, csv);
  if (parsed.fatal) throw new ServiceError(parsed.fatal);
  if (parsed.errors.length) {
    throw new ServiceError(`${parsed.errors.length} row${parsed.errors.length > 1 ? "s" : ""} need fixing before import. First problem: line ${parsed.errors[0].line}: ${parsed.errors[0].message}`);
  }

  const def = DATASET_DEFS[dataset];
  const months = parsed.months;

  const summary = await db.transaction(async (tx) => {
    const txDb = tx as unknown as Db;
    const [source] = await tx
      .insert(dataSources)
      .values({
        orgId,
        propertyId,
        kind: "csv",
        status: "imported",
        label: `${def.label} — ${fileName.slice(0, 80)}`,
        dataset,
        rowCount: parsed.rows.length,
        firstPeriod: months[0],
        lastPeriod: months[months.length - 1],
      })
      .returning();

    // Replace, don't stack: re-importing a month must not double-count it. But only rows that
    // this file re-supplies (same month, channel, item) are replaced — a partial file must never
    // delete data it says nothing about.
    const natural = (r: { periodStart: string; channel: string; dimension: string; key: string; secondaryKey: string | null }) =>
      `${r.periodStart}|${r.channel}|${r.dimension}|${r.key}|${r.secondaryKey ?? ""}`;
    const incoming = new Set(parsed.rows.map(natural));
    const existing = await tx
      .select({ id: metricSnapshots.id, periodStart: metricSnapshots.periodStart, channel: metricSnapshots.channel, dimension: metricSnapshots.dimension, key: metricSnapshots.key, secondaryKey: metricSnapshots.secondaryKey })
      .from(metricSnapshots)
      .where(and(eq(metricSnapshots.propertyId, propertyId), inArray(metricSnapshots.periodStart, months)));
    const replaceIds = existing
      .filter((r) => def.produces.some((p) => p.channel === r.channel && p.dimension === r.dimension) && incoming.has(natural(r)))
      .map((r) => r.id);
    for (let i = 0; i < replaceIds.length; i += 500) {
      await tx.delete(metricSnapshots).where(inArray(metricSnapshots.id, replaceIds.slice(i, i + 500)));
    }
    const replaced = replaceIds.length;

    for (let i = 0; i < parsed.rows.length; i += 500) {
      await tx.insert(metricSnapshots).values(
        parsed.rows.slice(i, i + 500).map((r) => ({
          orgId,
          propertyId,
          dataSourceId: source.id,
          periodStart: r.periodStart,
          channel: r.channel,
          dimension: r.dimension,
          key: r.key,
          secondaryKey: r.secondaryKey,
          impressions: Math.round(r.impressions),
          clicks: Math.round(r.clicks),
          sessions: Math.round(r.sessions),
          conversions: r.conversions,
          cost: r.cost,
          avgPosition: r.avgPosition,
          attrs: r.attrs,
        })),
      );
    }

    const refreshed = await refreshRecommendations(txDb, orgId);
    const measured = await measureOutcomes(txDb, orgId);
    return { rows: parsed.rows.length, months, replaced, newRecommendations: refreshed.created, outcomesMeasured: measured.measured };
  });
  return summary;
}

export function previewDataset(dataset: DatasetId, csv: string): CsvParseResult & { sample: CsvParseResult["rows"] } {
  const parsed = parseDataset(dataset, csv);
  return { ...parsed, rows: [], sample: parsed.rows.slice(0, 6) };
}
