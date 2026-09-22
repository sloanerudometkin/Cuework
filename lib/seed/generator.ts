/**
 * Demo data for the three fictional Harborline properties.
 *
 * Everything here is invented. Numbers are generated (deterministically) from
 * seasonality, trend and noise so the dashboards, comparisons and rules behave
 * like real data — and every table that shows it is labelled "Demo data".
 */
import { addMonths } from "@/lib/domain/dates";
import type { Snapshot } from "@/lib/domain/types";

export type DemoKey = "authority" | "ferry" | "airport";

export const DEMO_PROPERTIES: {
  key: DemoKey;
  name: string;
  kind: string;
  domain: string;
  goal: string;
  conversionLabel: string;
  strategicWeight: number;
}[] = [
  {
    key: "authority",
    name: "Harborline Port Authority",
    kind: "authority",
    domain: "harborlineauthority.example",
    goal: "Make permits, tenders and public notices easy to find and complete online",
    conversionLabel: "Permit and lease application starts",
    strategicWeight: 3,
  },
  {
    key: "ferry",
    name: "Harborline Ferries",
    kind: "ferry",
    domain: "harborlineferries.example",
    goal: "Grow direct online ticket sales at an efficient cost per booking",
    conversionLabel: "Ticket bookings",
    strategicWeight: 5,
  },
  {
    key: "airport",
    name: "Harborline Regional Airport",
    kind: "airport",
    domain: "flyharborline.example",
    goal: "Increase pre-booked parking and ground-transport revenue",
    conversionLabel: "Parking reservations",
    strategicWeight: 4,
  },
];

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const MONTHS = 24;
const LAST = MONTHS - 1; // index of the latest month

interface PageCfg {
  key: string;
  share: number;
  conv: number | ((i: number) => number);
  /** Extra multiplier on this page's sessions (e.g. a page that lost rankings). */
  mult?: (i: number) => number;
}

interface QueryCfg {
  key: string;
  page: string | null;
  imp: number;
  pos: number;
  ctr: number;
  question?: boolean;
  answerReady?: boolean;
  /** Impression multipliers for specific month indices. */
  overrides?: Partial<Record<number, number>>;
}

interface KeywordCfg {
  key: string;
  share: number;
  cpc: number;
  converting: boolean;
}

interface CampaignCfg {
  name: string;
  cost: number;
  cpa: number | ((i: number) => number);
  seasonExp: number;
  budgetLimited?: boolean;
  keywords: KeywordCfg[];
}

interface PropertyCfg {
  seasonal: number[];
  organic: number;
  trend: (i: number) => number;
  ctr: number;
  pages: PageCfg[];
  tailConv: number;
  other: { sessions: number; conv: number };
  queries: QueryCfg[];
  campaigns: CampaignCfg[];
  /** Multiplies recorded conversions in a month (models a tracking break). */
  convMult?: (i: number) => number;
}

const authority: PropertyCfg = {
  seasonal: [1.0, 1.0, 1.05, 1.05, 1.0, 0.95, 0.9, 0.92, 1.05, 1.05, 1.0, 0.85],
  organic: 92_000,
  // Grows gently, then loses rankings after a site migration six months ago.
  trend: (i) => (i <= 17 ? 1 + 0.004 * i : (1 + 0.004 * 17) * (1 - 0.03 * (i - 17))),
  ctr: 0.031,
  pages: [
    { key: "/permits/berth", share: 0.22, conv: 0.03, mult: (i) => (i > 17 ? 1 - 0.006 * (i - 17) : 1) },
    { key: "/tenders", share: 0.16, conv: 0.012, mult: (i) => (i > 17 ? 1 - 0.018 * (i - 17) : 1) },
    // Still down year over year, but recovering since the redirect chains were fixed in August.
    { key: "/notices", share: 0.14, conv: 0.003, mult: (i) => (i > 17 ? 1 - 0.022 * (i - 17) + (i === LAST ? 0.09 : 0) : 1) },
    { key: "/leases", share: 0.1, conv: 0.025 },
    { key: "/environment/reports", share: 0.09, conv: 0.004 },
    { key: "/board/meetings", share: 0.08, conv: 0.001 },
    { key: "/careers", share: 0.08, conv: 0.02 },
    { key: "/contact", share: 0.05, conv: 0.015 },
  ],
  tailConv: 0.008,
  other: { sessions: 26_000, conv: 0.012 },
  queries: [
    { key: "harborline port authority", page: "/", imp: 9000, pos: 1.2, ctr: 0.42 },
    { key: "berth permit application", page: "/permits/berth", imp: 5200, pos: 2.8, ctr: 0.13 },
    { key: "port tenders", page: "/tenders", imp: 4200, pos: 3.2, ctr: 0.095 },
    { key: "harbour notices to mariners", page: "/notices", imp: 3600, pos: 2.1, ctr: 0.135 },
    { key: "port environmental reports", page: "/environment/reports", imp: 1900, pos: 4.5, ctr: 0.06 },
    { key: "port authority careers", page: "/careers", imp: 3100, pos: 2.0, ctr: 0.14 },
    { key: "port tenant lease application requirements", page: null, imp: 2100, pos: 14.2, ctr: 0.008 },
    { key: "harbour dredging permit fees", page: null, imp: 1650, pos: 11.8, ctr: 0.01 },
    { key: "marina development approval process", page: null, imp: 1300, pos: 16, ctr: 0.006 },
    { key: "how do i apply for a berth permit", page: "/permits/berth", imp: 1900, pos: 5.2, ctr: 0.05, question: true, answerReady: false },
    { key: "how long does a marine permit take", page: "/permits/berth", imp: 1100, pos: 6.4, ctr: 0.03, question: true, answerReady: false },
    { key: "who regulates the harbour", page: "/about", imp: 900, pos: 3.8, ctr: 0.06, question: true, answerReady: false },
  ],
  campaigns: [
    {
      name: "Careers — Port Operations",
      cost: 2400,
      cpa: 22,
      seasonExp: 0.2,
      keywords: [
        { key: "port jobs", share: 0.4, cpc: 1.1, converting: true },
        { key: "marine operations careers", share: 0.3, cpc: 1.4, converting: true },
      ],
    },
  ],
};

const ferry: PropertyCfg = {
  seasonal: [0.55, 0.55, 0.65, 0.8, 1.0, 1.35, 1.6, 1.65, 1.2, 0.85, 0.6, 0.6],
  organic: 120_000,
  trend: (i) => 1 + 0.006 * i,
  ctr: 0.045,
  pages: [
    { key: "/schedules", share: 0.22, conv: 0.01 },
    // Booking-flow entry: healthy until six months ago, then steadily worse.
    { key: "/book", share: 0.18, conv: (i) => (i <= 17 ? 0.1 : 0.1 * (1 - 0.075 * (i - 17))) },
    // A/B-tested CTA shipped in July (see the completed work in the seed).
    { key: "/fares", share: 0.1, conv: (i) => (i >= LAST ? 0.0564 : 0.052) },
    { key: "/cruises", share: 0.12, conv: 0.035 },
    { key: "/alerts", share: 0.1, conv: 0 },
    { key: "/routes", share: 0.08, conv: 0.012 },
    { key: "/faq", share: 0.06, conv: 0.002 },
    { key: "/timetables", share: 0.04, conv: 0.004 },
  ],
  tailConv: 0.01,
  other: { sessions: 60_000, conv: 0.03 },
  queries: [
    { key: "ferry schedule", page: "/schedules", imp: 118_000, pos: 4.3, ctr: 0.024 },
    { key: "harbour cruise times", page: "/cruises", imp: 33_000, pos: 4.4, ctr: 0.02 },
    { key: "ferry times today", page: "/schedules", imp: 42_000, pos: 5.1, ctr: 0.018 },
    { key: "harborline ferries", page: "/", imp: 64_000, pos: 1.1, ctr: 0.5 },
    { key: "ferry tickets", page: "/book", imp: 74_000, pos: 3.1, ctr: 0.09 },
    { key: "island ferry prices", page: "/fares", imp: 31_000, pos: 2.6, ctr: 0.12 },
    { key: "ferry service alerts", page: "/alerts", imp: 18_000, pos: 1.8, ctr: 0.2 },
    { key: "harbour cruise", page: "/cruises", imp: 44_000, pos: 5.5, ctr: 0.048 },
    { key: "ferry with dogs allowed", page: null, imp: 5800, pos: 12, ctr: 0.007 },
    { key: "wheelchair accessible ferry", page: null, imp: 3200, pos: 9.5, ctr: 0.012 },
    { key: "can you take a car on the ferry", page: "/faq", imp: 6400, pos: 4.1, ctr: 0.04, question: true, answerReady: false },
    { key: "how long is the ferry ride", page: "/faq", imp: 9000, pos: 2.9, ctr: 0.07, question: true, answerReady: false },
    { key: "do ferries run in bad weather", page: "/alerts", imp: 4100, pos: 5.3, ctr: 0.03, question: true, answerReady: false },
  ],
  campaigns: [
    {
      name: "Brand — Ferry Tickets",
      cost: 5400,
      cpa: 7,
      seasonExp: 0.5,
      budgetLimited: true,
      keywords: [
        { key: "harborline ferries", share: 0.55, cpc: 0.6, converting: true },
        { key: "harborline ferry tickets", share: 0.3, cpc: 0.7, converting: true },
      ],
    },
    {
      name: "Generic — Island Ferry",
      cost: 17_500,
      // Ad groups were restructured by route in mid-August (see completed work).
      cpa: (i) => (i >= LAST ? 31.2 : 38),
      seasonExp: 0.6,
      keywords: [
        { key: "island ferry tickets", share: 0.3, cpc: 1.3, converting: true },
        { key: "ferry to the islands", share: 0.18, cpc: 1.2, converting: true },
        { key: "cheap boat rides", share: 0.05, cpc: 1.15, converting: false },
        { key: "ferry jobs", share: 0.03, cpc: 0.9, converting: false },
        { key: "boat rental", share: 0.025, cpc: 1.8, converting: false },
      ],
    },
    {
      name: "Seasonal — Harbour Cruises",
      cost: 8600,
      cpa: 55,
      seasonExp: 1.2,
      keywords: [
        { key: "sunset harbour cruise", share: 0.3, cpc: 1.9, converting: true },
        { key: "harbour cruise deals", share: 0.2, cpc: 1.6, converting: true },
        { key: "free harbour cruise", share: 0.04, cpc: 1.3, converting: false },
      ],
    },
  ],
};

const airport: PropertyCfg = {
  seasonal: [0.9, 0.85, 1.0, 1.0, 1.05, 1.15, 1.2, 1.2, 1.0, 1.0, 1.05, 1.1],
  organic: 95_000,
  trend: (i) => 1 + 0.003 * i,
  ctr: 0.04,
  pages: [
    { key: "/parking", share: 0.26, conv: 0.075 },
    { key: "/flights/arrivals", share: 0.2, conv: 0.002 },
    { key: "/flights/departures", share: 0.18, conv: 0.002 },
    { key: "/security", share: 0.09, conv: 0.001 },
    { key: "/ground-transport", share: 0.07, conv: 0.01 },
    { key: "/lost-property", share: 0.04, conv: 0.001 },
    { key: "/terminal-map", share: 0.03, conv: 0.001 },
  ],
  tailConv: 0.01,
  other: { sessions: 48_000, conv: 0.02 },
  // The parking-reservation tag stopped firing after last month's site release.
  convMult: (i) => (i === LAST ? 0.28 : 1),
  queries: [
    { key: "harborline airport flight status", page: "/flights/arrivals", imp: 48_000, pos: 2.4, ctr: 0.065 },
    { key: "harborline airport parking", page: "/parking", imp: 41_000, pos: 1.6, ctr: 0.3 },
    { key: "airport parking prices", page: "/parking", imp: 27_000, pos: 4.4, ctr: 0.048 },
    { key: "harborline airport arrivals", page: "/flights/arrivals", imp: 22_000, pos: 1.3, ctr: 0.31 },
    { key: "airport shuttle bus", page: "/ground-transport", imp: 19_000, pos: 6.5, ctr: 0.022 },
    { key: "harborline airport", page: "/", imp: 88_000, pos: 1.1, ctr: 0.55 },
    { key: "private car service to airport", page: null, imp: 1900, pos: 13.5, ctr: 0.008 },
    { key: "airport lounge access", page: null, imp: 2800, pos: 10.6, ctr: 0.012 },
    { key: "how early should i arrive at the airport", page: "/flights/departures", imp: 14_000, pos: 4.5, ctr: 0.035, question: true, answerReady: false },
    { key: "what can i bring in hand luggage", page: "/security", imp: 9500, pos: 5.8, ctr: 0.03, question: true, answerReady: false },
    { key: "is there free wifi at the airport", page: "/terminal-map", imp: 3200, pos: 6.9, ctr: 0.025, question: true, answerReady: false },
    // FAQ schema shipped four weeks ago (see completed work): impressions are climbing.
    { key: "can i bring a stroller through security", page: "/security", imp: 3300, pos: 3.6, ctr: 0.05, question: true, answerReady: true, overrides: { 22: 1.05, 23: 1.28 } },
  ],
  campaigns: [
    {
      name: "Parking — Brand",
      cost: 3100,
      cpa: 5.2,
      seasonExp: 0.4,
      keywords: [
        { key: "harborline airport parking", share: 0.6, cpc: 0.55, converting: true },
        { key: "harborline parking reservation", share: 0.3, cpc: 0.6, converting: true },
      ],
    },
    {
      name: "Parking — Generic",
      cost: 6800,
      cpa: 11,
      seasonExp: 0.5,
      keywords: [
        { key: "airport parking", share: 0.4, cpc: 1.4, converting: true },
        { key: "long term airport parking", share: 0.25, cpc: 1.2, converting: true },
      ],
    },
    {
      name: "Ground Transport",
      cost: 1400,
      cpa: 18,
      seasonExp: 0.4,
      keywords: [{ key: "airport shuttle booking", share: 0.6, cpc: 1.1, converting: true }],
    },
  ],
};

const CONFIGS: Record<DemoKey, PropertyCfg> = { authority, ferry, airport };
const SEEDS: Record<DemoKey, number> = { authority: 11, ferry: 23, airport: 37 };

export interface GenerateArgs {
  propertyIds: Record<DemoKey, string>;
  dataSourceIds: Record<DemoKey, string>;
  /** Latest complete month (YYYY-MM-01). */
  latest: string;
}

export function generateDemoSnapshots(args: GenerateArgs): Snapshot[] {
  const out: Snapshot[] = [];
  (Object.keys(CONFIGS) as DemoKey[]).forEach((key) => {
    out.push(...generateProperty(CONFIGS[key], args.propertyIds[key], args.dataSourceIds[key], args.latest, SEEDS[key]));
  });
  return out;
}

function generateProperty(cfg: PropertyCfg, propertyId: string, dataSourceId: string, latest: string, seed: number): Snapshot[] {
  const rand = mulberry32(seed);
  const noise = (amp: number) => 1 + (rand() - 0.5) * 2 * amp;
  const rows: Snapshot[] = [];
  const base = { propertyId, dataSourceId, secondaryKey: null as string | null, avgPosition: null as number | null, attrs: {} as Snapshot["attrs"] };
  const push = (r: Partial<Snapshot> & Pick<Snapshot, "periodStart" | "channel" | "dimension">) =>
    rows.push({ ...base, key: "", impressions: 0, clicks: 0, sessions: 0, conversions: 0, cost: 0, ...r } as Snapshot);

  for (let i = 0; i < MONTHS; i++) {
    const period = addMonths(latest, i - LAST);
    const moy = Number(period.slice(5, 7)) - 1;
    const seas = cfg.seasonal[moy];
    const trend = cfg.trend(i);
    const convMult = cfg.convMult?.(i) ?? 1;
    const organicBase = cfg.organic * seas * trend;

    // --- Organic pages (and long tail) ---
    let orgSessions = 0;
    let orgConv = 0;
    const pageShare = cfg.pages.reduce((s, p) => s + p.share, 0);
    for (const p of cfg.pages) {
      const sessions = Math.round(organicBase * p.share * (p.mult?.(i) ?? 1) * noise(0.03));
      const rate = typeof p.conv === "function" ? p.conv(i) : p.conv;
      const conversions = Math.round(sessions * rate * convMult * noise(0.05));
      orgSessions += sessions;
      orgConv += conversions;
      push({ periodStart: period, channel: "organic", dimension: "page", key: p.key, sessions, conversions });
    }
    const tailSessions = Math.round(organicBase * (1 - pageShare) * noise(0.03));
    const tailConv = Math.round(tailSessions * cfg.tailConv * convMult * noise(0.05));
    orgSessions += tailSessions;
    orgConv += tailConv;
    const clicks = Math.round(orgSessions * 0.95);
    push({
      periodStart: period,
      channel: "organic",
      dimension: "property",
      sessions: orgSessions,
      clicks,
      impressions: Math.round(clicks / (cfg.ctr * noise(0.03))),
      conversions: orgConv,
    });

    // --- Organic queries ---
    for (const q of cfg.queries) {
      const ov = q.overrides?.[i];
      const imp = Math.round(q.imp * seas * trend * noise(0.05) * (ov ?? 1));
      const pos = Math.max(1, q.pos + (rand() - 0.5) * 0.3);
      const ctr = q.ctr * noise(0.05);
      push({
        periodStart: period,
        channel: "organic",
        dimension: "query",
        key: q.key,
        secondaryKey: q.page,
        impressions: imp,
        clicks: Math.round(imp * ctr),
        avgPosition: Math.round(pos * 10) / 10,
        attrs: q.question ? { intent: "question", answerReady: q.answerReady ?? false } : { intent: "informational" },
      });
    }

    // --- Other channels (direct, referral, email) ---
    const otherSessions = Math.round(cfg.other.sessions * (0.7 + 0.3 * seas) * trend * noise(0.03));
    push({
      periodStart: period,
      channel: "other",
      dimension: "property",
      sessions: otherSessions,
      conversions: Math.round(otherSessions * cfg.other.conv * convMult * noise(0.05)),
    });

    // --- Paid campaigns ---
    let pImp = 0;
    let pClicks = 0;
    let pCost = 0;
    let pConv = 0;
    for (const c of cfg.campaigns) {
      const cost = Math.round(c.cost * Math.pow(seas, c.seasonExp) * noise(0.04));
      const cpa = (typeof c.cpa === "function" ? c.cpa(i) : c.cpa) * noise(0.03);
      const conversions = Math.round((cost / cpa) * convMult);
      const cpc = 1.25 * noise(0.05);
      const cClicks = Math.round(cost / cpc);
      const cImp = Math.round(cClicks / (0.045 * noise(0.05)));
      pImp += cImp;
      pClicks += cClicks;
      pCost += cost;
      pConv += conversions;
      push({
        periodStart: period,
        channel: "paid",
        dimension: "campaign",
        key: c.name,
        impressions: cImp,
        clicks: cClicks,
        cost,
        conversions,
        attrs: { budgetLimited: i === LAST ? Boolean(c.budgetLimited) : false },
      });
      if (i >= MONTHS - 6) {
        for (const k of c.keywords) {
          const kCost = Math.round(cost * k.share * noise(0.06));
          const kClicks = Math.round(kCost / k.cpc);
          push({
            periodStart: period,
            channel: "paid",
            dimension: "keyword",
            key: k.key,
            secondaryKey: c.name,
            impressions: Math.round(kClicks / 0.05),
            clicks: kClicks,
            cost: kCost,
            conversions: k.converting ? Math.round((kCost / cpa) * convMult) : 0,
          });
        }
      }
    }
    push({
      periodStart: period,
      channel: "paid",
      dimension: "property",
      impressions: pImp,
      clicks: pClicks,
      sessions: Math.round(pClicks * 0.97),
      conversions: pConv,
      cost: pCost,
    });
  }
  return rows;
}
