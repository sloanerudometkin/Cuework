# Cuework

An AI-ready marketing operating system for small, overloaded teams running several brands.
It turns fragmented marketing data into expert priorities, **realistic weekly commitments**, completed work and leadership-ready reporting — in one connected loop:

```
DATA → RECOMMENDATION → PRIORITY → CAPACITY-AWARE WEEKLY COMMITMENT → COMPLETED WORK → OUTCOME → LEADERSHIP REPORT
```

This repository is the one-day MVP. It ships a sample workspace with three **fictional** Harborline properties (an authority, a ferry service and an airport), clearly labelled as demo data.

## Quick start

Requires Node 20.19+ (developed on Node 24). No database server is needed locally — Cuework falls back to an embedded PostgreSQL (PGlite).

```bash
npm install
npm run setup        # creates .env.local with a generated SESSION_SECRET (never overwrites)
npm run dev          # http://localhost:3000
```

Open the app and choose **Explore the demo workspace** (enabled by `DEMO_MODE=true`, the default in `.env.example`). The demo workspace is created on first use; you can also build or reset it explicitly:

```bash
npm run db:seed      # create the demo workspace if it doesn't exist
npm run db:reset     # wipe ONLY the demo workspace and rebuild it
```

The demo banner also has a **Reset demo** button. To start from nothing, delete `.data/` (the embedded database) or point `DATABASE_URL` at an empty PostgreSQL database.

### Walk through the critical workflow (≈5 minutes)

1. **Command Center** — read *What needs attention today?* (a blocked tracking fix, decisions waiting).
2. **Recommendations** — open one, read the evidence and the *Can the team realistically do it?* check, then **Accept**. It becomes a backlog work item and the decision is logged with your reason.
3. **Weekly Plan** — add work. Push one person past their hours: the meter turns red and **Commit is blocked** until it fits. Try **Suggest a plan**, **Trim to capacity**, or reassign an owner, then commit.
4. **Work Board** — open an item, start it, log time, complete it. Its outcome is recorded with a baseline and honestly labelled *Awaiting data · Correlated*.
5. **Performance** — see completed work beside the metric it targeted, with *Correlated / Corroborated / Proven (tested)* kept distinct.
6. **Leadership Brief** — copy it for email, print it, or save a version.

Also try **Import data** (paste CSV rows with a deliberate error), **Settings → Subscription** (a downgrade to Starter is refused while you have 3 properties), and `/pricing`.

## Commands

| Command | What it does |
| --- | --- |
| `npm run dev` / `build` / `start` | Next.js development server / production build / production server |
| `npm run check` | Type-check + lint + all tests (run this before committing) |
| `npm run typecheck` · `lint` · `test` | The three checks individually (`test:watch` for watch mode) |
| `npm run db:generate` | Generate a SQL migration after editing `lib/db/schema.ts` |
| `npm run db:migrate` | Apply migrations to the configured database |
| `npm run db:seed` · `db:reset` | Create / rebuild the demo workspace |
| `npm run setup` | Create `.env.local` with a fresh `SESSION_SECRET` |

## Testing

```bash
npm test
```

105 automated tests cover the business logic that matters most:

* **Prioritization** — score bounds, monotonicity in every input, weighting order, explainability.
* **Capacity** — per-person and team limits, tight/over thresholds, commit blocking, auto-fit, trim, reorder, completion-rate calibration.
* **Recommendation engine** — all eight rules on the demo data, seasonality-aware anomaly detection, suppression rules, determinism.
* **Entitlements** — limits, upgrade suggestions, downgrade refusal.
* **CSV import** — validation, exact line-numbered errors, duplicate rows, safe partial-file replacement.
* **End-to-end workflow integration** — recommendation → decision → work → capacity-checked commitment → completion → outcome → brief, plus tenancy isolation, plan limits and sign-up. These run against a real PostgreSQL schema (in-memory PGlite by default).

To run the same suite against a real PostgreSQL server (it creates and drops throwaway databases):

```bash
docker run -d --name cw-pg -e POSTGRES_PASSWORD=cuework_test -p 5433:5432 postgres:16-alpine
TEST_DATABASE_URL=postgresql://postgres:cuework_test@localhost:5433/postgres npm test
```

## Architecture

**Stack:** Next.js 16 (App Router, Server Actions) · TypeScript · Tailwind CSS 4 · Radix primitives · Drizzle ORM · PostgreSQL · Zod · Vitest. One deployable unit — no microservices, queues or workers.

```
app/                    Routes. (workspace)/ is the authenticated app; (public)/ and (auth)/ are marketing and sign-in.
components/             ui/ = accessible primitives; domain/ = capacity meter, priority chip, charts, badges.
lib/domain/             PURE business logic, no I/O — fully unit-tested:
    metrics · recommendations/ (rules + engine) · prioritization · capacity
    outcomes · reporting · entitlements · csv · dates
lib/services/           Use-cases over the database (each takes an explicit db + orgId, so they are testable and tenant-scoped).
lib/actions/            Server Actions: authenticate, call a service, return a readable result.
lib/db/                 schema.ts, migrations in drizzle/, connect.ts (PGlite ⇄ PostgreSQL behind one type).
lib/seed/               Deterministic demo-data generator + demo workspace orchestration.
lib/auth/               Signed-cookie sessions (jose) and scrypt password hashing.
```

**Separation of concerns** (as specified): ingestion (`csv` + `services/imports`), metric calculation (`metrics`), recommendation generation (`recommendations/`), prioritization (`prioritization`), capacity planning (`capacity` + `services/planning`), reporting (`reporting` + `services/reports`) and entitlements (`entitlements`) are separate modules that don't import each other's internals.

**Traceability** is enforced by foreign keys:
`data source → metric snapshot ← recommendation evidence → recommendation → decision → work item → outcome → leadership report`.
Recommendations and work items also carry a re-measurable `MetricTarget` ("CTR of query X on property P"), so an outcome is always computed from source rows, never typed in.

**Recommendation engine.** Eight deterministic rules (low CTR, wasted paid keywords, landing-page conversion decline, sustained YoY decline, content gaps, AEO answer gaps, budget imbalance, conversion-tracking anomaly). Each emits a title, rationale, evidence, expected outcome, next step, why-now, hours, owner role, and 1–5 impact/effort/urgency plus confidence. The engine is pure and is the seam where a production model can later enrich explanations without changing detection or ranking.

**Prioritization.** `value = 0.45·impact + 0.30·urgency + 0.25·strategic fit`, discounted up to 40% for low confidence and adjusted +12% / −20% for low / high effort. The weights are visible in the UI ("How the score is built").

**Capacity.** A plan is committable only if every item has an owner and every person's assigned hours fit their *plannable* hours (weekly hours − reserved − time off). Above 85% (the organisation's planning buffer, adjustable in Settings) is flagged *tight*. The rule is enforced **on the server** (`saveWeekPlan`), not just in the browser. The plan and Command Center also show how much of the last four weeks' commitments the team actually finished, so the buffer can be set realistically.

**Correlation vs. proof.** Outcomes are `correlation` (moved after the work shipped), `corroborated` (moved at least twice as much on the exact slice touched as on the whole property) or `experiment` (controlled test). Nothing else can be called proven.

**Database selection.** `DATABASE_URL` set → PostgreSQL (Amazon RDS). Unset → embedded PGlite in `CUEWORK_PGLITE_DIR`. Migrations run automatically on first connection.

## Environment variables

Copy `.env.example` (or run `npm run setup`). **Never commit real values.** In AWS, inject them from Secrets Manager.

| Variable | Required | Purpose |
| --- | --- | --- |
| `SESSION_SECRET` | **Production** | 32+ random chars; signs session cookies. Fails closed: in production, sessions can't be created or verified without it. |
| `DATABASE_URL` | Production | PostgreSQL connection string. If unset, embedded PGlite is used (dev/demo only). |
| `DATABASE_SSL` | Production on RDS | `false` · `true` (encrypt, no verification) · `verify` (encrypt + verify with the RDS CA bundle baked into the image). |
| `DATABASE_SSL_CA_FILE` | Optional | CA bundle path for `verify` (default `certs/rds-global-bundle.pem`). |
| `CUEWORK_PGLITE_DIR` | Optional | Where the embedded database lives (default `.data/pglite`). |
| `DEMO_MODE` | Optional | `true` shows *Explore the demo workspace* on the login page. Keep `false` for any deployment holding real data — the demo workspace is shared and passwordless. |
| `INSECURE_COOKIES` | Testing only | Allows the session cookie over plain `http://` when running a production build locally. |
| `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY` | Multi-instance | Same 32-byte base64 key on every instance. |
| `TEST_DATABASE_URL` | Tests only | Run the test suite against a real PostgreSQL server. |

## AWS deployment

The simplest credible path: **container image → Amazon ECR → AWS App Runner → Amazon RDS for PostgreSQL**, with secrets in Secrets Manager. Step-by-step commands are in [`docs/AWS_DEPLOYMENT.md`](docs/AWS_DEPLOYMENT.md). A multi-stage `Dockerfile` (non-root user, health check, migrations and RDS CA bundle included) is provided and has been built and run locally against PostgreSQL 16.

## What is fully functional

* Sign-up, sign-in, sessions, organisations, memberships; every query is tenant-scoped and every Server Action re-authenticates.
* Three-property demo workspace with 24 months of history; add/edit/archive properties and team members.
* **Command Center**: attention list, per-property KPIs with MoM/YoY and sparklines, anomalies, capacity, decisions, at-risk work, recent wins.
* **Recommendation inbox**: 8 rules, evidence, scoring breakdown, capacity-fit check; Accept / Convert to work / Defer / Dismiss / Refine with recorded rationale; decision log; dismissals persist across re-analysis; deferred items resurface.
* **Weekly Commitment Builder**: per-person capacity per week, live hours used/left, warnings, reorder, owner assignment, *Suggest a plan*, *Trim to capacity*, carry-over, server-enforced commit.
* **Work Board**: five-column workflow with legal-transition enforcement, time logging, blocking with a leadership flag, completion with actual hours, full evidence trail per card.
* **Outcomes**: baseline at completion, re-measurement when new data is imported, correlation / corroborated / proven labelling.
* **Performance**: MoM and YoY by property and metric, seasonality-aware anomalies, completed work beside each metric.
* **Leadership Brief**: generated from live data, copy-to-email Markdown, print/PDF, saved immutable versions.
* **CSV import** (5 dataset types): templates, paste or upload, row-level validation, all-or-nothing import, safe replacement, automatic re-analysis.
* **Plans**: Starter / Growth / Scale enforced for properties, team members, imports per month, visible recommendations, and Growth-only features (outcome tracking, leadership briefs); downgrade guard.
* Pricing page, landing page, loading / error / not-found states, security headers, health endpoint.
* Verified: 105 tests (also against real PostgreSQL 16); axe-core WCAG 2.1 A/AA audit found no violations on the 9 screens audited (Command Center, Recommendations, Weekly Plan, Work Board, Performance, Brief, Import, Settings, Pricing); desktop and phone-width layouts checked without horizontal overflow; production build and container run end to end.

## What is simulated or deferred

| Item | Status |
| --- | --- |
| **GA4, Search Console, Google Ads connectors** | **Not built.** Shown as *Not connected · Coming soon*. CSV import is the way in; imported data is labelled *Imported data*. |
| **Demo data** | Generated, fictional (`.example` domains), labelled *Demo data* everywhere it appears. |
| **Billing** | **Simulated.** Plan changes apply instantly and no card is collected; limits are real. No Stripe. |
| **AI** | None used. Recommendations, prose and briefs are deterministic. No API key is needed or read. |
| **AEO measurement** | Answer-engine visibility isn't measurable from Search Console; the AEO rule estimates from question-query demand and says so. |
| **Approval workflows, custom reporting** (Scale) | Listed as *Coming soon* on the pricing page; not implemented. |
| **Email/Slack delivery of briefs, password reset, invitations, MFA, roles/permissions** | Not built. Accounts are single-user-per-sign-up; `memberships` exists for multi-user. |
| **AWS deployment** | Documented and container-tested, but **not executed against a live AWS account** (no credentials available). |

## Known limitations

* The login throttle is in-memory (per instance); put AWS WAF rate limiting in front for multi-instance deployments.
* Metrics are loaded into memory per request (fine for ~10⁵ rows; move to SQL aggregation before large imports).
* Dates use UTC; a team's "week" and "month" boundaries follow UTC.
* Light theme only.

## Recommended next three improvements

1. **Google connectors (GA4, Search Console, Google Ads)** behind the existing import pipeline, with OAuth, incremental sync and per-source freshness — then remove the CSV step for most users.
2. **Team collaboration**: invitations, roles (owner / editor / viewer), comments on recommendations, and scheduled leadership-brief delivery by email/Slack.
3. **Model-assisted explanation with guardrails**: keep the deterministic detection and scoring, but let a model draft rationale and the executive narrative from the structured evidence, with citations back to source rows and a human approval step.

## License

Private / unreleased. Logo files in `brand assets/` are the supplied originals; web copies in `public/brand/` are byte-identical artwork with embedded C2PA provenance metadata stripped.
