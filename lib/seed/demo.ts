import { eq } from "drizzle-orm";
import type { Db } from "@/lib/db/connect";
import {
  dataSources,
  memberships,
  metricSnapshots,
  organizations,
  outcomes,
  properties,
  recommendationDecisions,
  recommendationEvidence,
  recommendations,
  subscriptions,
  teamMembers,
  users,
  weeklyCommitments,
  workItems,
} from "@/lib/db/schema";
import { addDays, addMonths, monthStart, weekStart as toWeekStart } from "@/lib/domain/dates";
import { evaluateTarget, formatMetricValue } from "@/lib/domain/metrics";
import { scorePriority } from "@/lib/domain/prioritization";
import type { Category, EvidenceDraft, MetricTarget } from "@/lib/domain/types";
import { recordOutcomeForCompletion } from "@/lib/services/outcomes";
import { decideRecommendation, refreshRecommendations } from "@/lib/services/recommendations";
import { saveWeekPlan, getWeekPlan } from "@/lib/services/planning";
import { transitionWork } from "@/lib/services/work";
import { loadSnapshots, type Actor } from "@/lib/services/workspace";
import { DEMO_PROPERTIES, generateDemoSnapshots, type DemoKey } from "./generator";

export const DEMO_EMAIL = "demo@cuework.example";
export const DEMO_ORG_NAME = "Harborline Group — Marketing";

const at = (iso: string, dayOffset: number, hour = 15) => new Date(`${addDays(iso, dayOffset)}T${String(hour).padStart(2, "0")}:00:00.000Z`);

interface SeedResult {
  userId: string;
  orgId: string;
}

/** Idempotent entry point: returns the demo workspace, creating it on first use. */
export async function ensureDemoWorkspace(db: Db, now = new Date()): Promise<SeedResult> {
  const [user] = await db.select().from(users).where(eq(users.email, DEMO_EMAIL));
  if (user) {
    const [m] = await db.select().from(memberships).where(eq(memberships.userId, user.id));
    if (m) return { userId: user.id, orgId: m.orgId };
  }
  return seedDemoWorkspace(db, now);
}

/** Wipes the demo workspace (and only it) and rebuilds it from scratch. */
export async function resetDemoWorkspace(db: Db, now = new Date()): Promise<SeedResult> {
  const [user] = await db.select().from(users).where(eq(users.email, DEMO_EMAIL));
  if (user) {
    const orgs = await db.select({ id: organizations.id }).from(memberships).innerJoin(organizations, eq(organizations.id, memberships.orgId)).where(eq(memberships.userId, user.id));
    for (const o of orgs) await db.delete(organizations).where(eq(organizations.id, o.id));
    await db.delete(users).where(eq(users.id, user.id));
  }
  return seedDemoWorkspace(db, now);
}

export async function seedDemoWorkspace(db: Db, now = new Date()): Promise<SeedResult> {
  const latest = addMonths(monthStart(now), -1);
  const week = toWeekStart(now);

  // --- Identity, organisation, plan -----------------------------------------
  const [user] = await db.insert(users).values({ email: DEMO_EMAIL, name: "Maya Okafor" }).returning();
  const [org] = await db
    .insert(organizations)
    .values({ name: DEMO_ORG_NAME, slug: `harborline-demo-${Math.random().toString(36).slice(2, 7)}`, isDemo: true, planningBuffer: 0.15 })
    .returning();
  const orgId = org.id;
  await db.insert(memberships).values({ userId: user.id, orgId, role: "owner" });
  await db.insert(subscriptions).values({ orgId, plan: "growth", interval: "month", simulated: true });
  const actor: Actor = { userId: user.id, name: "Maya Okafor" };

  const [maya] = await db
    .insert(teamMembers)
    .values({ orgId, userId: user.id, name: "Maya Okafor", title: "Digital Marketing Manager", roleKey: "manager", defaultWeeklyHours: 40, defaultReservedHours: 12 })
    .returning();
  const [jordan] = await db
    .insert(teamMembers)
    .values({ orgId, name: "Jordan Ellis", title: "Digital Marketing Coordinator", roleKey: "coordinator", defaultWeeklyHours: 40, defaultReservedHours: 6 })
    .returning();

  // --- Properties, data sources, snapshots ----------------------------------
  const propertyIds = {} as Record<DemoKey, string>;
  const dataSourceIds = {} as Record<DemoKey, string>;
  for (const p of DEMO_PROPERTIES) {
    const [prop] = await db
      .insert(properties)
      .values({ orgId, name: p.name, kind: p.kind, domain: p.domain, goal: p.goal, conversionLabel: p.conversionLabel, strategicWeight: p.strategicWeight })
      .returning();
    propertyIds[p.key] = prop.id;
    const [src] = await db
      .insert(dataSources)
      .values({
        orgId,
        propertyId: prop.id,
        kind: "demo",
        status: "demo",
        label: `Demo data — ${p.name}`,
        dataset: "all",
        firstPeriod: addMonths(latest, -23),
        lastPeriod: latest,
      })
      .returning();
    dataSourceIds[p.key] = src.id;
  }

  const rows = generateDemoSnapshots({ propertyIds, dataSourceIds, latest });
  for (let i = 0; i < rows.length; i += 500) {
    await db.insert(metricSnapshots).values(
      rows.slice(i, i + 500).map((r) => ({
        orgId,
        propertyId: r.propertyId,
        dataSourceId: r.dataSourceId!,
        periodStart: r.periodStart,
        channel: r.channel,
        dimension: r.dimension,
        key: r.key,
        secondaryKey: r.secondaryKey,
        impressions: r.impressions,
        clicks: r.clicks,
        sessions: r.sessions,
        conversions: r.conversions,
        cost: r.cost,
        avgPosition: r.avgPosition,
        attrs: r.attrs,
      })),
    );
  }
  for (const p of DEMO_PROPERTIES) {
    const n = rows.filter((r) => r.propertyId === propertyIds[p.key]).length;
    await db.update(dataSources).set({ rowCount: n }).where(eq(dataSources.id, dataSourceIds[p.key]));
  }

  // --- Recommendations from the deterministic engine ------------------------
  await refreshRecommendations(db, orgId, now);
  const recs = await db.select().from(recommendations).where(eq(recommendations.orgId, orgId));
  const rec = (fingerprint: string) => {
    const r = recs.find((x) => x.fingerprint === fingerprint);
    if (!r) throw new Error(`Seed expected the engine to produce “${fingerprint}”. Did the rules or generator change?`);
    return r;
  };

  // --- Past weeks: completed work, outcomes, institutional memory -----------
  const snapshots = await loadSnapshots(db, orgId);
  const val = (propertyId: string, target: MetricTarget, period: string) => evaluateTarget(snapshots, propertyId, target, period);
  const fmt = (target: MetricTarget, v: number | null) => formatMetricValue(target.metric, v);
  const prev = addMonths(latest, -1);
  const strategic = Object.fromEntries(DEMO_PROPERTIES.map((p) => [p.key, p.strategicWeight])) as Record<DemoKey, number>;

  interface Hist {
    week: number;
    prop: DemoKey;
    slug: string;
    ruleKey: string;
    title: string;
    category: Category;
    rationale: string;
    expectedOutcome: string;
    nextStep: string;
    whyNow: string;
    target: MetricTarget;
    impact: number;
    effort: number;
    urgency: number;
    confidence: number;
    est: number;
    spent: number;
    owner: typeof maya;
    ownerRole: "manager" | "coordinator";
    evidence: (v: (t: MetricTarget, p: string) => number | null) => EvidenceDraft[];
    decisionNote: string;
    experiment?: boolean;
    /** Anchor the completion date to the latest data month so the outcome is measurable. */
    daysBeforeMonthEnd?: number;
  }

  const genericCpa: MetricTarget = { metric: "cpa", channel: "paid", dimension: "campaign", key: "Generic — Island Ferry", label: "Cost per conversion · Generic — Island Ferry" };
  const faresConv: MetricTarget = { metric: "conversion_rate", channel: "organic", dimension: "page", key: "/fares", label: "Conversion rate · /fares" };
  const stroller: MetricTarget = { metric: "impressions", channel: "organic", dimension: "query", key: "can i bring a stroller through security", label: "Impressions · “can i bring a stroller through security”" };
  const notices: MetricTarget = { metric: "sessions", channel: "organic", dimension: "page", key: "/notices", label: "Organic sessions · /notices" };
  const authClicks: MetricTarget = { metric: "clicks", channel: "organic", dimension: "property", key: "", label: "Organic clicks" };

  const history: Hist[] = [
    {
      week: -6, prop: "ferry", slug: "fares-cta-test", ruleKey: "landing_page_conversion_decline", title: "A/B test the booking call-to-action on the fares page",
      category: "analytics",
      rationale: "The fares page is the last step before booking and its call-to-action used generic wording. A controlled test of clearer, price-led copy would show whether wording alone moves bookings.",
      expectedOutcome: "Lift the /fares conversion rate by 5–10% with no extra traffic.",
      nextStep: "Split traffic 50/50 between the current and price-led CTA for two weeks and read the result at 95% confidence.",
      whyNow: "Summer demand meant every point of conversion rate was worth real revenue.",
      target: faresConv, impact: 4, effort: 3, urgency: 4, confidence: 0.7, est: 10, spent: 11, owner: jordan, ownerRole: "coordinator", experiment: true, daysBeforeMonthEnd: 25,
      evidence: (v) => [{ label: "Conversion rate, prior month", value: fmt(faresConv, v(faresConv, prev)) }, { label: "Monthly sessions", value: "≈ 22k", comparison: "one of the top booking-path pages" }],
      decisionNote: "Worth testing properly — the fares page is where bookings are won or lost.",
    },
    {
      week: -5, prop: "ferry", slug: "generic-adgroups", ruleKey: "campaign_budget_imbalance", title: "Restructure “Generic — Island Ferry” ad groups by route",
      category: "sem",
      rationale: "One broad ad group served every route, so the campaign paid for clicks it couldn't match to the right landing page. Splitting by route improves relevance and lets bids reflect each route's value.",
      expectedOutcome: "Reduce cost per conversion on the campaign by 10–20%.",
      nextStep: "Create one ad group per route with matching ads and landing pages, migrate keywords, and monitor for two weeks.",
      whyNow: "It was the campaign with the largest spend and the weakest cost per conversion.",
      target: genericCpa, impact: 4, effort: 3, urgency: 4, confidence: 0.72, est: 9, spent: 9, owner: maya, ownerRole: "manager", daysBeforeMonthEnd: 19,
      evidence: (v) => [{ label: "Cost per conversion (before)", value: fmt(genericCpa, v(genericCpa, prev)), comparison: "Generic — Island Ferry" }, { label: "Share of paid spend", value: "≈ 50%" }],
      decisionNote: "Biggest budget line with the worst efficiency — do this first.",
    },
    {
      week: -4, prop: "airport", slug: "faq-schema", ruleKey: "aeo_answer_gap", title: "Add FAQ schema and direct answers to security pages",
      category: "aeo",
      rationale: "Passenger questions about security were answered deep inside long pages, without concise answers or FAQ markup — the format answer engines quote.",
      expectedOutcome: "Increase impressions for question-style security queries and earn answer-engine citations.",
      nextStep: "Add 40–60 word answers and FAQ structured data to the security page; track question-query impressions monthly.",
      whyNow: "Low effort and question queries were already growing.",
      target: stroller, impact: 3, effort: 2, urgency: 3, confidence: 0.6, est: 6, spent: 6.5, owner: jordan, ownerRole: "coordinator", daysBeforeMonthEnd: 12,
      evidence: (v) => [{ label: "Impressions, prior month", value: fmt(stroller, v(stroller, prev)), comparison: "“can i bring a stroller through security”" }],
      decisionNote: "Cheap, and a good pilot for AEO on the other properties.",
    },
    {
      week: -3, prop: "authority", slug: "notices-redirects", ruleKey: "yoy_traffic_decline", title: "Fix redirect chains on legacy /notices URLs",
      category: "seo",
      rationale: "Old public-notice URLs redirected through two or three hops before reaching the current page, diluting link equity and slowing crawling of one of the authority's most-visited sections.",
      expectedOutcome: "Recover organic sessions on /notices and stop further ranking erosion there.",
      nextStep: "Map legacy URLs to their final destinations with single 301 redirects and resubmit the sitemap.",
      whyNow: "/notices had the steepest traffic decline after the site migration.",
      target: notices, impact: 4, effort: 2, urgency: 4, confidence: 0.7, est: 5, spent: 5, owner: jordan, ownerRole: "coordinator", daysBeforeMonthEnd: 5,
      evidence: (v) => [{ label: "Organic sessions, prior month", value: fmt(notices, v(notices, prev)), comparison: "/notices" }, { label: "Redirect hops on legacy URLs", value: "2–3", comparison: "should be 1" }],
      decisionNote: "Quick, technical, and directly tied to the migration fallout.",
    },
    {
      week: -2, prop: "authority", slug: "sitemap-errors", ruleKey: "yoy_traffic_decline", title: "Repair XML sitemap errors flagged in Search Console",
      category: "seo",
      rationale: "The sitemap listed URLs that no longer exist after the migration, wasting crawl budget and delaying indexing of current pages.",
      expectedOutcome: "Faster indexing of current pages and steadier organic clicks.",
      nextStep: "Regenerate the sitemap from live URLs only, resubmit, and monitor the coverage report.",
      whyNow: "Small fix that removes an ongoing drag on crawling.",
      target: authClicks, impact: 2, effort: 1, urgency: 3, confidence: 0.6, est: 4, spent: 4, owner: jordan, ownerRole: "coordinator",
      evidence: () => [{ label: "Sitemap errors in Search Console", value: "37 URLs", comparison: "404 or redirected" }],
      decisionNote: "Do it — cheap hygiene after the migration.",
    },
  ];

  const manual: { week: number; prop: DemoKey; title: string; category: Category; est: number; done: boolean; owner: typeof maya }[] = [
    { week: -6, prop: "authority", title: "Monthly reporting refresh — July close", category: "analytics", est: 5, done: true, owner: maya },
    { week: -5, prop: "ferry", title: "Quarterly keyword review", category: "sem", est: 6, done: true, owner: maya },
    { week: -4, prop: "airport", title: "GA4 conversion audit", category: "analytics", est: 8, done: true, owner: maya },
    { week: -3, prop: "authority", title: "Refresh homepage hero copy", category: "content", est: 5, done: false, owner: jordan },
    { week: -2, prop: "ferry", title: "Prepare consultant sync deck", category: "analytics", est: 3, done: true, owner: maya },
    { week: -1, prop: "authority", title: "Build Q3 report template", category: "analytics", est: 6, done: true, owner: maya },
    { week: -1, prop: "airport", title: "Competitor SERP review", category: "seo", est: 8, done: false, owner: jordan },
  ];

  // Commitments are created lazily per week so history can be anchored to real dates.
  const commitments = new Map<string, string>();
  const plannedByWeek = new Map<string, number>();
  const commitmentFor = async (start: string, plannedHours = 0) => {
    plannedByWeek.set(start, (plannedByWeek.get(start) ?? 0) + plannedHours);
    const existing = commitments.get(start);
    if (existing) return existing;
    const [c] = await db
      .insert(weeklyCommitments)
      .values({ orgId, weekStart: start, status: "committed", committedAt: at(start, 0, 9), committedByName: actor.name })
      .returning();
    commitments.set(start, c.id);
    return c.id;
  };
  // Work with a measured outcome must finish inside the latest data month, so its baseline is the month before.
  const monthEnd = addDays(addMonths(latest, 1), -1);

  for (const h of history) {
    const completedDay = h.daysBeforeMonthEnd != null ? addDays(monthEnd, -h.daysBeforeMonthEnd) : addDays(addDays(week, h.week * 7), 3);
    const start = toWeekStart(completedDay);
    const propertyId = propertyIds[h.prop];
    const decidedAt = new Date(`${start}T10:00:00.000Z`);
    const [r] = await db
      .insert(recommendations)
      .values({
        orgId,
        propertyId,
        ruleKey: h.ruleKey,
        fingerprint: `history:${h.slug}`,
        category: h.category,
        title: h.title,
        rationale: h.rationale,
        expectedOutcome: h.expectedOutcome,
        nextStep: h.nextStep,
        whyNow: h.whyNow,
        target: h.target,
        impact: h.impact,
        effort: h.effort,
        urgency: h.urgency,
        strategic: strategic[h.prop],
        confidence: h.confidence,
        estimatedHours: h.est,
        suggestedOwnerRole: h.ownerRole,
        priorityScore: scorePriority({ impact: h.impact, urgency: h.urgency, strategic: strategic[h.prop], confidence: h.confidence, effort: h.effort }),
        status: "converted",
        basedOnPeriod: addMonths(latest, -1),
        generatedAt: at(start, -4),
        updatedAt: decidedAt,
      })
      .returning();
    const ev = h.evidence((t, p) => val(propertyId, t, p));
    await db.insert(recommendationEvidence).values(ev.map((e, i) => ({ recommendationId: r.id, position: i, label: e.label, value: e.value, comparison: e.comparison ?? null, dataSourceId: dataSourceIds[h.prop] })));
    await db.insert(recommendationDecisions).values({ orgId, recommendationId: r.id, decision: "accept", rationale: h.decisionNote, decidedByUserId: user.id, decidedByName: actor.name, createdAt: decidedAt });

    const completedAt = new Date(`${completedDay}T16:00:00.000Z`);
    const [w] = await db
      .insert(workItems)
      .values({
        orgId,
        propertyId,
        recommendationId: r.id,
        commitmentId: await commitmentFor(start, h.est),
        title: h.title,
        description: h.nextStep,
        category: h.category,
        status: "complete",
        assigneeId: h.owner.id,
        estimatedHours: h.est,
        hoursSpent: h.spent,
        priorityScore: r.priorityScore,
        rank: 0,
        objective: DEMO_PROPERTIES.find((p) => p.key === h.prop)!.goal,
        expectedOutcome: h.expectedOutcome,
        target: h.target,
        startedAt: at(start, 0, 14),
        completedAt,
        createdAt: decidedAt,
      })
      .returning();
    const o = await recordOutcomeForCompletion(db, orgId, w.id, completedAt);
    if (h.experiment && o) {
      await db
        .update(outcomes)
        .set({
          evidenceStrength: "experiment",
          note: "Controlled A/B test: 50/50 traffic split for two weeks, result read at 95% confidence (demo data).",
        })
        .where(eq(outcomes.id, o.id));
    }
  }

  for (const m of manual) {
    const start = addDays(week, m.week * 7);
    await db.insert(workItems).values({
      orgId,
      propertyId: propertyIds[m.prop],
      commitmentId: await commitmentFor(start, m.est),
      title: m.title,
      category: m.category,
      status: m.done ? "complete" : "backlog",
      assigneeId: m.owner.id,
      estimatedHours: m.est,
      hoursSpent: m.done ? m.est : 0,
      priorityScore: 30,
      objective: "Routine team work (not from a recommendation)",
      startedAt: m.done ? at(start, 1) : null,
      completedAt: m.done ? at(start, 3, 12) : null,
      createdAt: at(start, -1),
    });
  }

  for (const [start, id] of commitments) {
    await db.update(weeklyCommitments).set({ plannedHours: plannedByWeek.get(start) ?? 0 }).where(eq(weeklyCommitments.id, id));
  }

  // --- This week: decisions made through the real service, then a real plan --
  const acceptAndPlan = async (fp: string, ownerId: string) => {
    const r = rec(fp);
    return decideRecommendation(db, { orgId, recommendationId: r.id, actor, now, input: { decision: "accept", addToBacklog: true, ownerId, rationale: "" } });
  };

  const tracking = await decideRecommendation(db, {
    orgId, actor, now, recommendationId: rec(`tracking_anomaly:${propertyIds.airport}`).id,
    input: { decision: "accept", addToBacklog: true, ownerId: maya.id, rationale: "Highest urgency: paid bidding and month-end reporting are both running on bad data." },
  });
  const ferryCtr = await decideRecommendation(db, {
    orgId, actor, now, recommendationId: rec(`low_ctr:${propertyIds.ferry}:ferry schedule`).id,
    input: { decision: "accept", addToBacklog: true, ownerId: jordan.id, rationale: "Biggest visibility-to-click gap on our most strategic property." },
  });
  const paidWaste = await decideRecommendation(db, {
    orgId, actor, now, recommendationId: rec(`paid_waste:${propertyIds.ferry}`).id,
    input: { decision: "accept", addToBacklog: true, ownerId: maya.id, rationale: "Fast win — we can redeploy this spend before the summer peak ends." },
  });
  const yoy = await acceptAndPlan(`yoy_decline:${propertyIds.authority}`, maya.id);
  const aeo = await acceptAndPlan(`aeo_gap:${propertyIds.airport}`, jordan.id);
  await acceptAndPlan(`budget_imbalance:${propertyIds.ferry}`, maya.id); // backlog only, not yet scheduled

  await decideRecommendation(db, {
    orgId, actor, now, recommendationId: rec(`low_ctr:${propertyIds.airport}:harborline airport flight status`).id,
    input: { decision: "dismiss", rationale: "Flight-status intent is answered by the search result's own flight widget, so a low CTR is expected here. Revisit only if position drops." },
  });
  await decideRecommendation(db, {
    orgId, actor, now, recommendationId: rec(`content_gap:${propertyIds.authority}`).id,
    input: { decision: "defer", deferUntil: addDays(week, 28), rationale: "Web team has a CMS freeze until the migration cleanup finishes — revisit once we can publish." },
  });
  await decideRecommendation(db, {
    orgId, actor, now, recommendationId: rec(`lp_decline:${propertyIds.ferry}:/book`).id,
    input: { decision: "refine", rationale: "Split this into desktop vs. mobile and checkout vs. schedule-to-booking before we commit 8 hours to it." },
  });

  // Team capacity for this week: Jordan is out on Friday.
  await saveWeekPlan(db, {
    orgId, weekStart: week, actor, now, commit: true,
    capacity: [
      { memberId: maya.id, totalHours: 40, reservedHours: 12, note: "Standing meetings, leadership syncs, consultant call" },
      { memberId: jordan.id, totalHours: 32, reservedHours: 6, note: "Out Friday (−8h)" },
    ],
    items: [
      { id: tracking.workItemId!, assigneeId: maya.id },
      { id: ferryCtr.workItemId!, assigneeId: jordan.id },
      { id: paidWaste.workItemId!, assigneeId: maya.id },
      { id: yoy.workItemId!, assigneeId: maya.id },
      { id: aeo.workItemId!, assigneeId: jordan.id },
    ],
  });

  await transitionWork(db, { orgId, id: ferryCtr.workItemId!, action: { type: "start" }, now });
  await transitionWork(db, { orgId, id: ferryCtr.workItemId!, action: { type: "log_hours", hours: 2.5 }, now });
  await transitionWork(db, { orgId, id: tracking.workItemId!, action: { type: "start" }, now });
  await transitionWork(db, { orgId, id: tracking.workItemId!, action: { type: "log_hours", hours: 1.5 }, now });
  await transitionWork(db, {
    orgId, id: tracking.workItemId!, now,
    action: {
      type: "block",
      needsLeadership: true,
      reason: "The parking-reservation tag lives in a container only the web team can publish. Waiting on their release slot — needs leadership to prioritise the IT ticket.",
    },
  });

  // Sanity: the seeded week must be committable and leave room to plan more.
  const plan = await getWeekPlan(db, orgId, week);
  if (!plan.summary.canCommit) throw new Error("Seeded plan should be within capacity.");

  return { userId: user.id, orgId };
}
