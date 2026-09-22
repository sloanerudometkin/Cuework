/**
 * Subscription entitlements. Plans live in code (typed, reviewable, versioned with
 * the app); a `subscriptions` row simply binds an organisation to a plan key.
 * `Infinity` means unlimited. Every limit here is enforced server-side.
 */

export const PLAN_KEYS = ["starter", "growth", "scale"] as const;
export type PlanKey = (typeof PLAN_KEYS)[number];

export interface PlanLimits {
  properties: number;
  teamMembers: number;
  /** CSV imports per calendar month. */
  importsPerMonth: number;
  /** Open recommendations visible in the inbox at once. */
  openRecommendations: number;
  leadershipBriefs: boolean;
  outcomeTracking: boolean;
  portfolioIntelligence: boolean;
  approvalWorkflows: boolean;
  customReporting: boolean;
}

export interface Plan {
  key: PlanKey;
  name: string;
  tagline: string;
  audience: string;
  monthlyPrice: number;
  /** Per-month price when billed annually. */
  annualMonthlyPrice: number;
  highlighted?: boolean;
  limits: PlanLimits;
  features: string[];
}

export const PLANS: Record<PlanKey, Plan> = {
  starter: {
    key: "starter",
    name: "Starter",
    tagline: "One brand, one small team, one clear weekly plan.",
    audience: "For a single property and a very small team",
    monthlyPrice: 79,
    annualMonthlyPrice: 65,
    limits: {
      properties: 1,
      teamMembers: 2,
      importsPerMonth: 2,
      openRecommendations: 8,
      leadershipBriefs: false,
      outcomeTracking: false,
      portfolioIntelligence: false,
      approvalWorkflows: false,
      customReporting: false,
    },
    features: [
      "1 property",
      "Up to 2 team members",
      "2 CSV imports per month",
      "Recommendation inbox (top 8 open)",
      "Weekly commitment planning with capacity limits",
      "Work board",
      "Basic performance reporting",
    ],
  },
  growth: {
    key: "growth",
    name: "Growth",
    tagline: "The full loop for small teams running several brands.",
    audience: "For small teams managing multiple brands",
    monthlyPrice: 199,
    annualMonthlyPrice: 165,
    highlighted: true,
    limits: {
      properties: 5,
      teamMembers: 6,
      importsPerMonth: 30,
      openRecommendations: 60,
      leadershipBriefs: true,
      outcomeTracking: true,
      portfolioIntelligence: true,
      approvalWorkflows: false,
      customReporting: false,
    },
    features: [
      "Up to 5 properties",
      "Up to 6 team members",
      "30 CSV imports per month",
      "Portfolio intelligence across every brand",
      "Up to 60 open recommendations",
      "Capacity planning per person, per week",
      "Outcome tracking with correlation vs. proof",
      "Leadership briefs",
    ],
  },
  scale: {
    key: "scale",
    name: "Scale",
    tagline: "Governance and reach for agencies and large multi-brand teams.",
    audience: "For agencies and larger multi-brand teams",
    monthlyPrice: 499,
    annualMonthlyPrice: 415,
    limits: {
      properties: 25,
      teamMembers: 25,
      importsPerMonth: Infinity,
      openRecommendations: Infinity,
      leadershipBriefs: true,
      outcomeTracking: true,
      portfolioIntelligence: true,
      approvalWorkflows: true,
      customReporting: true,
    },
    features: [
      "Up to 25 properties and 25 users",
      "Unlimited imports and recommendations",
      "Approval workflows (coming soon)",
      "Custom reporting (coming soon)",
      "Advanced governance and audit history",
      "Expanded integrations (coming soon)",
      "Priority support",
    ],
  },
};

export function getPlan(key: PlanKey): Plan {
  return PLANS[key];
}

export interface Usage {
  properties: number;
  teamMembers: number;
  importsThisMonth: number;
}

export type LimitKey = "properties" | "teamMembers" | "importsPerMonth";

export interface LimitCheck {
  allowed: boolean;
  limit: number;
  used: number;
  /** Ready-to-show message when blocked. */
  message: string | null;
  /** The cheapest plan that would allow the action. */
  upgradeTo: PlanKey | null;
}

const NOUN: Record<LimitKey, { singular: string; plural: string; period?: string }> = {
  properties: { singular: "property", plural: "properties" },
  teamMembers: { singular: "team member", plural: "team members" },
  importsPerMonth: { singular: "CSV import", plural: "CSV imports", period: " this month" },
};

function usedFor(key: LimitKey, usage: Usage): number {
  return key === "properties" ? usage.properties : key === "teamMembers" ? usage.teamMembers : usage.importsThisMonth;
}

/** Can the organisation add one more of `key` under `plan`? */
export function checkLimit(plan: PlanKey, key: LimitKey, usage: Usage): LimitCheck {
  const limit = PLANS[plan].limits[key];
  const used = usedFor(key, usage);
  if (used < limit) return { allowed: true, limit, used, message: null, upgradeTo: null };
  const upgradeTo = PLAN_KEYS.find((k) => PLANS[k].limits[key] > used) ?? null;
  const n = NOUN[key];
  const noun = limit === 1 ? n.singular : n.plural;
  return {
    allowed: false,
    limit,
    used,
    message: `The ${PLANS[plan].name} plan includes ${limit} ${noun}${n.period ?? ""}, and you've used ${used}.${
      upgradeTo ? ` Upgrade to ${PLANS[upgradeTo].name} to add more.` : ""
    }`,
    upgradeTo,
  };
}

export type FeatureKey = Exclude<keyof PlanLimits, LimitKey | "openRecommendations">;

export function hasFeature(plan: PlanKey, feature: FeatureKey): boolean {
  return PLANS[plan].limits[feature];
}

export function upgradeTargetFor(feature: FeatureKey): PlanKey {
  return PLAN_KEYS.find((k) => PLANS[k].limits[feature]) ?? "scale";
}

export interface DowngradeViolation {
  limit: LimitKey;
  used: number;
  allowed: number;
  message: string;
}

/**
 * A downgrade is only allowed when current usage already fits the target plan.
 * We never silently delete customer data to make a plan change work.
 */
export function downgradeViolations(target: PlanKey, usage: Pick<Usage, "properties" | "teamMembers">): DowngradeViolation[] {
  const limits = PLANS[target].limits;
  const out: DowngradeViolation[] = [];
  if (usage.properties > limits.properties) {
    out.push({
      limit: "properties",
      used: usage.properties,
      allowed: limits.properties,
      message: `${PLANS[target].name} allows ${limits.properties} ${limits.properties === 1 ? "property" : "properties"}; you have ${usage.properties}. Archive ${usage.properties - limits.properties} first.`,
    });
  }
  if (usage.teamMembers > limits.teamMembers) {
    out.push({
      limit: "teamMembers",
      used: usage.teamMembers,
      allowed: limits.teamMembers,
      message: `${PLANS[target].name} allows ${limits.teamMembers} team members; you have ${usage.teamMembers}. Remove ${usage.teamMembers - limits.teamMembers} first.`,
    });
  }
  return out;
}

/** Applies the open-recommendation cap. Input must already be sorted best-first. */
export function capRecommendations<T>(sortedOpen: T[], plan: PlanKey): { visible: T[]; hidden: number } {
  const cap = PLANS[plan].limits.openRecommendations;
  if (sortedOpen.length <= cap) return { visible: sortedOpen, hidden: 0 };
  return { visible: sortedOpen.slice(0, cap), hidden: sortedOpen.length - cap };
}
