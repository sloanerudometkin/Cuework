"use client";

import { CircleCheck, Download, FileSpreadsheet, TriangleAlert } from "lucide-react";
import Link from "next/link";
import * as React from "react";
import { Badge } from "@/components/ui/badge";
import { Button, buttonStyles } from "@/components/ui/button";
import { Card, CardBody, Eyebrow } from "@/components/ui/card";
import { Field, Select, Textarea } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";
import { importAction, previewImportAction } from "@/lib/actions/workspace";
import { DATASET_DEFS, DATASETS, templateCsv, type DatasetId } from "@/lib/domain/csv";
import { formatMonth } from "@/lib/domain/dates";
import { cn } from "@/lib/utils";

interface Preview {
  fileName: string;
  totalRows: number;
  errors: { line: number; message: string }[];
  fatal: string | null;
  months: string[];
  sample: { month: string; key: string; secondary: string | null; impressions: number; clicks: number; sessions: number; conversions: number; cost: number }[];
}
interface Result {
  rows: number;
  months: string[];
  replaced: number;
  newRecommendations: number;
  outcomesMeasured: number;
}

export function ImportWizard({
  properties,
  latestMonth,
  usage,
}: {
  properties: { id: string; name: string }[];
  latestMonth: string;
  usage: { used: number; limit: number; planName: string };
}) {
  const toast = useToast();
  const [propertyId, setPropertyId] = React.useState(properties[0]?.id ?? "");
  const [dataset, setDataset] = React.useState<DatasetId>("site_totals");
  const [file, setFile] = React.useState<File | null>(null);
  const [pasted, setPasted] = React.useState("");
  const [preview, setPreview] = React.useState<Preview | null>(null);
  const [result, setResult] = React.useState<Result | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState<"preview" | "import" | null>(null);
  const fileRef = React.useRef<HTMLInputElement>(null);

  const atLimit = Number.isFinite(usage.limit) && usage.used >= usage.limit;
  const source: File | null = file ?? (pasted.trim() ? new File([pasted], "pasted-data.csv", { type: "text/csv" }) : null);

  const form = (f: File) => {
    const fd = new FormData();
    fd.set("dataset", dataset);
    fd.set("propertyId", propertyId);
    fd.set("file", f);
    return fd;
  };

  const reset = () => {
    setPreview(null);
    setResult(null);
    setError(null);
  };

  const doPreview = async () => {
    if (!source) return setError("Choose a file or paste some CSV rows first.");
    reset();
    setBusy("preview");
    const r = await previewImportAction(form(source));
    setBusy(null);
    if (r.ok) setPreview(r.data);
    else setError(r.error);
  };

  const doImport = async () => {
    if (!source) return;
    setBusy("import");
    const r = await importAction(form(source));
    setBusy(null);
    if (r.ok) {
      setResult(r.data);
      setPreview(null);
      setFile(null);
      setPasted("");
      if (fileRef.current) fileRef.current.value = "";
      toast.success(`Imported ${r.data.rows.toLocaleString()} rows.`);
    } else {
      setError(r.error);
      toast.error(r.error);
    }
  };

  const download = () => {
    const blob = new Blob([templateCsv(dataset, latestMonth)], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `cuework-${dataset.replace("_", "-")}-template.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const def = DATASET_DEFS[dataset];
  const valid = preview && !preview.fatal && preview.errors.length === 0;

  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_320px]">
      <div className="space-y-6">
        <Card>
          <CardBody className="space-y-6">
            <Field label="Which property is this data for?" htmlFor="property">
              <Select id="property" value={propertyId} onChange={(e) => { setPropertyId(e.target.value); reset(); }}>
                {properties.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </Select>
            </Field>

            <fieldset>
              <legend className="mb-2 text-[14.56px] font-medium">What kind of export is it?</legend>
              <div className="grid gap-2 sm:grid-cols-2">
                {DATASETS.map((d) => (
                  <label key={d} className={cn("flex cursor-pointer gap-3 rounded-xl border p-3.5 transition-colors has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-cue-700", dataset === d ? "border-ink bg-sunken/60" : "border-line hover:border-line-strong")}>
                    <input type="radio" name="dataset" value={d} checked={dataset === d} onChange={() => { setDataset(d); reset(); }} className="mt-1 size-4 accent-[var(--color-ink)]" />
                    <span>
                      <span className="block text-sm font-medium">{DATASET_DEFS[d].label}</span>
                      <span className="mt-0.5 block text-xs leading-snug text-muted">{DATASET_DEFS[d].description}</span>
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>

            <div className="rounded-xl bg-sunken/70 p-4 text-sm">
              <p className="font-medium">Expected columns</p>
              <p className="mt-1 font-mono text-xs leading-relaxed text-soft">{def.columns.join(", ")}</p>
              <p className="mt-1.5 text-xs text-muted">{def.optional.length ? `Optional: ${def.optional.join(", ")}. ` : ""}Months look like 2026-08. Headers aren&apos;t case-sensitive.</p>
              <Button variant="secondary" size="sm" className="mt-3" onClick={download}><Download className="size-3.5" aria-hidden /> Download a template</Button>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Upload a CSV file" htmlFor="file" hint="Up to 4 MB.">
                <input
                  ref={fileRef}
                  id="file"
                  type="file"
                  accept=".csv,text/csv"
                  onChange={(e) => { setFile(e.target.files?.[0] ?? null); reset(); }}
                  className="block w-full rounded-lg border border-line-strong bg-surface text-sm shadow-card file:mr-3 file:h-10 file:cursor-pointer file:border-0 file:bg-sunken file:px-4 file:text-sm file:font-medium file:text-ink hover:file:bg-line"
                />
              </Field>
              <Field label="…or paste rows" htmlFor="paste" hint="Include the header row.">
                <Textarea id="paste" value={pasted} onChange={(e) => { setPasted(e.target.value); reset(); }} placeholder={`${def.columns.join(",")}\n…`} className="min-h-[5.5rem] font-mono text-xs" disabled={Boolean(file)} />
              </Field>
            </div>

            {atLimit ? (
              <p role="alert" className="rounded-lg border border-cue/40 bg-cue-soft px-4 py-3 text-sm">
                You&apos;ve used all {usage.limit} imports included in the {usage.planName} plan this month. <Link href="/settings#plan" className="font-medium underline underline-offset-4">Upgrade to import more →</Link>
              </p>
            ) : null}
            {error ? <p role="alert" className="rounded-lg border border-brick/30 bg-brick-soft px-4 py-3 text-sm font-medium text-brick">{error}</p> : null}

            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" onClick={doPreview} disabled={busy !== null || !source || atLimit}>{busy === "preview" ? "Checking…" : "Check the file"}</Button>
              <Button onClick={doImport} disabled={busy !== null || !valid || atLimit}>{busy === "import" ? "Importing…" : "Import data"}</Button>
            </div>
          </CardBody>
        </Card>

        {preview ? (
          <Card aria-live="polite">
            <CardBody className="space-y-4">
              <div className="flex flex-wrap items-center gap-2">
                <FileSpreadsheet className="size-5 text-soft" aria-hidden />
                <p className="font-medium">{preview.fileName}</p>
                {preview.fatal ? <Badge tone="bad">Can&apos;t import</Badge> : preview.errors.length ? <Badge tone="bad">{preview.errors.length} problem{preview.errors.length === 1 ? "" : "s"}</Badge> : <Badge tone="good">Looks good</Badge>}
              </div>
              {preview.fatal ? (
                <p className="flex items-start gap-2 text-sm text-brick"><TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />{preview.fatal}</p>
              ) : (
                <>
                  <p className="text-sm text-soft">{preview.totalRows.toLocaleString()} rows covering {preview.months.map((m) => formatMonth(m, { short: true })).join(", ")}. Rows for the same month and item are replaced, never added twice; anything the file doesn\u2019t mention is left alone.</p>
                  {preview.errors.length ? (
                    <div>
                      <Eyebrow>Fix these rows, then check again</Eyebrow>
                      <ul className="mt-2 space-y-1.5 text-sm">
                        {preview.errors.map((e, i) => <li key={i} className="flex gap-3"><span className="tabular w-16 shrink-0 font-medium text-brick">{e.line ? `Line ${e.line}` : "…"}</span><span className="text-soft">{e.message}</span></li>)}
                      </ul>
                    </div>
                  ) : (
                    <div className="thin-scroll overflow-x-auto">
                      <table className="tabular w-full min-w-[520px] text-left text-xs">
                        <thead className="text-muted"><tr><th scope="col" className="py-1 pr-3 font-medium">Month</th><th scope="col" className="py-1 pr-3 font-medium">Key</th><th scope="col" className="py-1 pr-3 text-right font-medium">Impr.</th><th scope="col" className="py-1 pr-3 text-right font-medium">Clicks</th><th scope="col" className="py-1 pr-3 text-right font-medium">Sessions</th><th scope="col" className="py-1 pr-3 text-right font-medium">Conv.</th><th scope="col" className="py-1 text-right font-medium">Cost</th></tr></thead>
                        <tbody className="divide-y divide-line">{preview.sample.map((r, i) => <tr key={i}><td className="py-1.5 pr-3">{formatMonth(r.month, { short: true })}</td><td className="max-w-56 truncate py-1.5 pr-3">{r.key}</td><td className="py-1.5 pr-3 text-right">{r.impressions.toLocaleString()}</td><td className="py-1.5 pr-3 text-right">{r.clicks.toLocaleString()}</td><td className="py-1.5 pr-3 text-right">{r.sessions.toLocaleString()}</td><td className="py-1.5 pr-3 text-right">{r.conversions.toLocaleString()}</td><td className="py-1.5 text-right">{r.cost ? `$${r.cost.toLocaleString()}` : "—"}</td></tr>)}</tbody>
                      </table>
                      <p className="mt-2 text-xs text-muted">First {preview.sample.length} of {preview.totalRows.toLocaleString()} rows shown.</p>
                    </div>
                  )}
                </>
              )}
            </CardBody>
          </Card>
        ) : null}

        {result ? (
          <Card className="border-moss/40" aria-live="polite">
            <CardBody>
              <p className="flex items-center gap-2 font-semibold"><CircleCheck className="size-5 text-moss" aria-hidden /> Import complete</p>
              <ul className="mt-3 space-y-1 text-sm text-soft">
                <li>{result.rows.toLocaleString()} rows imported for {result.months.map((m) => formatMonth(m, { short: true })).join(", ")}, labelled <strong className="text-ink">Imported data</strong>.</li>
                {result.replaced ? <li>{result.replaced.toLocaleString()} existing {result.replaced === 1 ? "row was" : "rows were"} replaced by this file, not double-counted. Rows the file didn\u2019t mention were left alone.</li> : null}
                <li>Analysis re-run: {result.newRecommendations} new recommendation{result.newRecommendations === 1 ? "" : "s"}{result.outcomesMeasured ? `, ${result.outcomesMeasured} outcome${result.outcomesMeasured === 1 ? "" : "s"} re-measured` : ""}.</li>
              </ul>
              <div className="mt-4 flex flex-wrap gap-2">
                <Link href="/recommendations" className={buttonStyles({})}>Review recommendations</Link>
                <Link href="/performance" className={buttonStyles({ variant: "secondary" })}>See performance</Link>
              </div>
            </CardBody>
          </Card>
        ) : null}
      </div>

      <aside className="space-y-4">
        <Card>
          <CardBody>
            <Eyebrow>Imports this month</Eyebrow>
            <p className="tabular mt-1 text-2xl font-semibold">{usage.used}<span className="text-base font-normal text-muted"> / {Number.isFinite(usage.limit) ? usage.limit : "unlimited"}</span></p>
            <p className="mt-1 text-xs text-muted">{usage.planName} plan</p>
          </CardBody>
        </Card>
        <Card>
          <CardBody className="text-sm text-soft">
            <p className="font-medium text-ink">Tips</p>
            <ul className="mt-2 list-disc space-y-1.5 pl-4 text-[14.56px]">
              <li>Import <strong>Site totals</strong> first — KPIs, year-over-year and anomaly checks depend on them.</li>
              <li>Include 13+ months so year-over-year comparisons work.</li>
              <li>Files with any invalid row are rejected whole, so partial data never skews your reports.</li>
              <li>Direct connections to GA4, Search Console and Google Ads are <strong>coming soon</strong>; until then, CSV is the way in.</li>
            </ul>
          </CardBody>
        </Card>
      </aside>
    </div>
  );
}
