import { describe, expect, it } from "vitest";
import { parseDataset, templateCsv, DATASETS } from "@/lib/domain/csv";

describe("parseDataset", () => {
  it("parses a valid paid-keyword file and normalises the month", () => {
    const r = parseDataset("paid_keywords", "month,campaign,keyword,impressions,clicks,cost,conversions\n2026-08,Brand,ferry tickets,\"1,200\",90,$120.50,7\n");
    expect(r.fatal).toBeNull();
    expect(r.errors).toEqual([]);
    expect(r.rows[0]).toMatchObject({ periodStart: "2026-08-01", channel: "paid", dimension: "keyword", key: "ferry tickets", secondaryKey: "Brand", impressions: 1200, cost: 120.5, conversions: 7 });
    expect(r.months).toEqual(["2026-08-01"]);
  });

  it("reports missing required columns as a fatal error that lists what's expected", () => {
    const r = parseDataset("landing_pages", "month,page\n2026-08,/x\n");
    expect(r.fatal).toMatch(/Missing required columns?: sessions, conversions/);
    expect(r.rows).toEqual([]);
  });

  it("reports the line number and reason for each bad row without dropping the good ones silently", () => {
    const r = parseDataset("landing_pages", "month,page,sessions,conversions\n2026-08,/ok,100,5\n2026-13,/bad-month,100,5\n2026-08,/neg,-4,1\n2026-08,,10,1\n2026-08,/blank,,1\n");
    expect(r.rows).toHaveLength(1);
    expect(r.errors.map((e) => e.line)).toEqual([3, 4, 5, 6]);
    expect(r.errors[0].message).toMatch(/month/);
    expect(r.errors[1].message).toMatch(/negative/);
    expect(r.errors[3].message).toBe("sessions: must be a number");
    expect(r.errors[2].message).toBe("page: is required");
    expect(r.errors[1].message).toBe("sessions: can't be negative");
  });

  it("rejects a month + item that appears twice instead of silently double-counting it", () => {
    const r = parseDataset("landing_pages", "month,page,sessions,conversions\n2026-08,/book,100,5\n2026-08,/fares,50,2\n2026-08,/book,300,9\n");
    expect(r.errors).toEqual([{ line: 4, message: "duplicates line 2 (same month and item). Combine them into one row." }]);
    // Same page in a different month is fine.
    expect(parseDataset("landing_pages", "month,page,sessions,conversions\n2026-07,/book,100,5\n2026-08,/book,300,9\n").errors).toEqual([]);
  });

  it("rejects empty files and enforces the row limit", () => {
    expect(parseDataset("landing_pages", "month,page,sessions,conversions\n").fatal).toMatch(/no data rows/);
  });

  it("maps search queries to organic query rows with AEO attributes", () => {
    const r = parseDataset("search_queries", "month,query,landing_page,impressions,clicks,avg_position,intent,answer_ready\n2026-08,how do i renew,,900,10,8.2,question,false\n");
    expect(r.rows[0]).toMatchObject({ channel: "organic", dimension: "query", secondaryKey: null, avgPosition: 8.2, attrs: { intent: "question", answerReady: false } });
  });

  it("accepts a BOM and mixed-case headers exported by spreadsheets", () => {
    const r = parseDataset("site_totals", "﻿Month,Channel,Sessions,Conversions\n2026-08-15,Organic,1000,20\n");
    expect(r.fatal).toBeNull();
    expect(r.rows[0]).toMatchObject({ periodStart: "2026-08-01", channel: "organic", sessions: 1000 });
  });

  it("rejects unknown channels", () => {
    const r = parseDataset("site_totals", "month,channel,sessions,conversions\n2026-08,social,1,1\n");
    expect(r.errors[0].message).toBe("channel: must be organic, paid or other");
  });

  it("ships a template for every dataset that parses cleanly", () => {
    for (const d of DATASETS) {
      const r = parseDataset(d, templateCsv(d, "2026-08-01"));
      expect(r.fatal, d).toBeNull();
      expect(r.errors, d).toEqual([]);
      expect(r.rows.length, d).toBeGreaterThan(0);
    }
  });
});
