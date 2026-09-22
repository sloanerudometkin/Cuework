You are my senior product strategist, SaaS designer, full-stack engineer, and AWS deployment lead. Build a polished, functional, monetizable SaaS MVP called Cuework in one day.

Do not merely create a plan or static mockup. Build the application, test its critical workflow, and prepare it for deployment.

## Product vision

Cuework is an AI-powered marketing operating system for small, overloaded marketing teams managing multiple brands or websites.

Its promise is:

“Turn fragmented marketing data into expert priorities, realistic weekly commitments, completed work, and leadership-ready reporting—all in one place.”

Cuework should give a two-person marketing team the strategic clarity and operational leverage of a much larger SEO, AEO, and paid-media department.

The experience should make the target user think:

“This is genius. It understands my constraints, tells me exactly what matters, and gives me one place to run everything.”

## The real problem

I am an experienced digital marketing manager working with one digital marketing coordinator. Our two-person team is responsible for SEO, AEO, SEM, analytics, optimization, and reporting across three distinct websites:

- A public authority website
- A ferry website
- An airport website

Our workflow is broken:

1. Separate consultants provide paid and organic growth analysis that the internal team cannot continuously perform.
2. We review Google Search Console, Google Ads, GA4, and other tools across multiple properties sharing one team and one budget.
3. Prioritization happens informally.
4. Recommendations must be manually converted into work.
5. Work remains unfinished because plans ignore actual team capacity.
6. Analytics data is exported into spreadsheets for month-over-month and year-over-year reporting.
7. Leadership reporting is disconnected from the data, decisions, and work that produced the results.
8. Knowledge is scattered across dashboards, spreadsheets, emails, consultants, and task-management tools.

Cuework must connect this entire loop.

## One-day MVP scope

Build one excellent, believable product workflow:

DATA → INSIGHT → PRIORITY → COMMITMENT → EXECUTION → OUTCOME → REPORT

The MVP must allow a user to:

1. Create an organization and add multiple brands or websites.
2. View a unified portfolio overview across those properties.
3. Import or enter marketing performance data.
4. Receive expert-style SEO, AEO, and paid-media recommendations.
5. See the evidence and reasoning behind every recommendation.
6. Compare recommendations using impact, effort, urgency, confidence, and strategic relevance.
7. Convert selected recommendations into actionable work.
8. Set the team’s available weekly capacity.
9. Build a realistic weekly commitment that does not exceed that capacity.
10. Track work from planned to in progress to complete.
11. Connect completed work to performance outcomes.
12. Generate a concise, leadership-ready report explaining:
    - What changed
    - What the team completed
    - What improved or declined
    - What should happen next
    - What is blocked
    - Where leadership attention is needed

## Product principle

Cuework must not be another generic dashboard, chatbot, analytics viewer, or task manager.

Its core intelligence is prioritization under constraints.

Every recommendation must answer:

- What should we do?
- Why does it matter?
- What evidence supports it?
- Which brand or property does it affect?
- What channel does it belong to?
- What outcome should it influence?
- How confident are we?
- How much effort will it require?
- Why should it be done now?
- Can the current team realistically complete it?

The AI should behave like an embedded cross-functional marketing strategist, not a conversational assistant waiting for broad questions.

Do not make an empty chatbot the center of the product.

## Core screens

Build these connected screens:

### 1. Portfolio Command Center

Show:

- All brands/properties
- Key KPI movement
- Important anomalies
- Current weekly capacity
- Work committed versus available capacity
- Recommendations needing decisions
- At-risk work
- Recent wins
- A clear “What needs attention today?” section

### 2. Recommendation Inbox

Each recommendation should display:

- Clear action-oriented title
- Brand/property
- SEO, AEO, SEM, analytics, or content category
- Supporting evidence
- Plain-language rationale
- Expected outcome
- Impact
- Effort
- Urgency
- Confidence
- Estimated hours
- Suggested owner
- Relevant metric
- Recommended next step

Available decisions:

- Accept
- Defer
- Dismiss
- Request refinement
- Convert to work

Record the decision and its rationale so Cuework develops institutional memory.

### 3. Weekly Commitment Builder

Let the user:

- Define each team member’s weekly capacity
- Review recommended work
- Select work for the week
- See hours used and hours remaining
- Receive warnings when the plan exceeds capacity
- Reorder work by priority
- Commit to a realistic weekly plan

This should be a signature Cuework experience.

### 4. Work Board

Use a clean workflow:

- Backlog
- Committed
- In progress
- Blocked
- Complete

Each work item should retain its connection to:

- The original recommendation
- Supporting evidence
- Brand/property
- Strategic objective
- Expected metric
- Actual outcome

### 5. Performance and Outcomes

Show:

- Month-over-month movement
- Year-over-year movement
- Trends by property and channel
- Completed actions related to each metric
- Wins, declines, and anomalies
- Clear distinctions between correlation and proven causation

### 6. Leadership Brief

Generate an executive summary suitable for copying into an email or presentation.

It should connect performance to decisions and completed work rather than showing disconnected charts.

### 7. Settings and Data Sources

Include:

- Organization settings
- Team members
- Brands/properties
- Capacity defaults
- Data-source status
- Subscription tier
- Billing-management placeholder

## Data strategy for the one-day MVP

Do not let unavailable third-party credentials block the MVP.

Support:

- A polished sample workspace with realistic but clearly labeled demo data
- CSV import for marketing data
- Manual data entry where useful
- A modular connector architecture for future GA4, Google Search Console, and Google Ads integrations
- Clear “Demo data,” “Imported data,” and “Connected data” labels

Do not imply that an integration is live when it is mocked.

Seed the application with three fictionalized properties representing an authority, ferry service, and airport. Do not use confidential information or make unsupported claims about real organizations.

Generate enough realistic historical data to make the dashboards, recommendations, comparisons, and reports convincing.

## Recommendation engine

For the MVP, implement a deterministic recommendation engine that analyzes seeded or imported data and produces useful recommendations.

Examples:

- High impressions but low organic click-through rate
- Paid keywords spending without conversions
- Landing pages with declining conversions
- Significant year-over-year traffic declines
- Strong queries without matching content
- Potential answer-engine content gaps
- Campaign budget imbalance
- Conversion-tracking anomalies

Keep the recommendation service modular so a production AI model can later enhance the analysis.

If an AI API key is available, use it only where it adds meaningful value, such as recommendation explanations or executive summaries. The core workflow must remain functional without it.

## SaaS plans

Create three clearly differentiated subscription tiers:

### Starter

For one brand and a very small team.

Include:

- One property
- Limited data imports
- Recommendation inbox
- Weekly commitment planning
- Basic reporting

### Growth

For small teams managing multiple brands.

Include:

- Multiple properties
- Portfolio intelligence
- More recommendations
- Capacity planning
- Outcome tracking
- Leadership briefs

Make this the highlighted plan.

### Scale

For agencies or larger multi-brand teams.

Include:

- More properties and users
- Advanced governance
- Approval workflows
- Custom reporting
- Expanded integrations
- Priority support

Implement a polished pricing page and enforce meaningful plan limits in the application. Billing may use a clean abstraction or test-mode Stripe integration if credentials are available. Do not let billing setup block the core MVP.

## Design direction

First, inspect the supplied logo files and derive a restrained visual system from them. Preserve the logo’s proportions and appearance. Do not redesign it unless explicitly asked.

The interface should feel:

- Premium
- Calm
- Intelligent
- Decisive
- Trustworthy
- Modern
- Operationally serious

Avoid:

- Generic AI gradients
- Excessive glass effects
- Neon colors
- Cartoon illustrations
- Dense walls of charts
- Template-like dashboard layouts
- Decorative elements that do not improve decisions
- A UI that looks like a generic project-management clone

Use excellent typography, generous spacing, strong information hierarchy, subtle motion, accessible contrast, thoughtful empty states, and polished loading and error states.

Desktop is the primary experience, but all major screens must remain usable on mobile.

Every screen should clearly answer:

- What changed?
- What matters?
- What should I do next?
- Can my team realistically do it?

## Technical requirements

Use a production-minded but one-day-friendly architecture.

Preferred stack unless the existing repository indicates otherwise:

- Next.js with TypeScript
- App Router
- Tailwind CSS
- A polished accessible component system
- PostgreSQL-compatible data model
- Prisma or another appropriate typed database layer
- Secure authentication
- Schema validation
- Reusable charting components
- Automated tests for the most important business logic

Because the product will be hosted on AWS, choose the simplest credible AWS deployment path for this stack. Favor speed, reliability, clear environment configuration, and low operational overhead.

Do not introduce microservices, queues, or infrastructure complexity that the MVP does not need.

Keep these concerns separated:

- Data ingestion
- Metric calculation
- Recommendation generation
- Prioritization
- Capacity planning
- Reporting
- Subscription entitlements

Use secure defaults. Never commit secrets. Provide an environment-variable template.

## Data model

Create a coherent model covering at least:

- User
- Organization
- Membership
- Property/brand
- Team member
- Data source
- Metric snapshot
- Recommendation
- Recommendation evidence
- Recommendation decision
- Work item
- Weekly capacity
- Weekly commitment
- Outcome
- Leadership report
- Subscription and plan entitlement

Preserve traceability from source data through recommendation, decision, work, outcome, and report.

## Execution rules

Work autonomously and make sensible product decisions.

Before coding:

1. Inspect the repository and logo assets.
2. Determine what already exists.
3. Confirm the fastest viable architecture.
4. Create a concise implementation plan ordered by user value.
5. Identify the critical end-to-end path.

Then implement immediately.

Prioritize in this order:

1. A complete end-to-end product loop
2. Clear and impressive user experience
3. Reliable business logic
4. Realistic seeded data
5. Responsive visual polish
6. AWS deployment readiness
7. Secondary features

Do not spend most of the day building infrastructure before the product is visible.

Do not leave the application as disconnected screens. All key actions must update shared application state and produce believable downstream effects.

Do not fill the interface with nonfunctional buttons. If a secondary feature cannot be implemented, either omit it or clearly mark it as coming soon.

## Verification

Before declaring completion:

- Run the application
- Run type checking
- Run linting
- Run automated tests
- Test the critical user journey in a browser
- Check the major screens at desktop and mobile widths
- Verify empty, loading, populated, and error states
- Confirm that accepted recommendations become work
- Confirm that capacity limits affect weekly planning
- Confirm that completed work appears in outcomes and reporting
- Confirm that subscription limits are enforced
- Fix visible runtime errors and broken interactions

## Required deliverables

At the end, provide:

1. A working application
2. A concise README
3. Local setup instructions
4. Seed/demo instructions
5. Test instructions
6. AWS deployment instructions
7. Environment-variable documentation
8. A brief architecture summary
9. A list of what is fully functional
10. A separate list of integrations or features that are simulated or deferred
11. The recommended next three improvements after the MVP

Begin by inspecting the repository and logo files. Then state the implementation plan in no more than 15 lines and start building without waiting for additional confirmation unless a truly blocking decision requires me.