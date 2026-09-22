import { Building2 } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { EmptyState } from "@/components/domain/empty-state";
import { ImportWizard } from "@/components/import-wizard";
import { PageHeader } from "@/components/domain/page-header";
import { buttonStyles } from "@/components/ui/button";
import { requireWorkspace } from "@/lib/auth/session";
import { addMonths, monthStart } from "@/lib/domain/dates";
import { PLANS } from "@/lib/domain/entitlements";
import { loadWorkspace } from "@/lib/services/workspace";

export const metadata: Metadata = { title: "Import data" };

export default async function ImportPage() {
  const { db, orgId } = await requireWorkspace();
  const ws = await loadWorkspace(db, orgId);
  const plan = PLANS[ws.planKey];

  return (
    <div className="animate-rise">
      <PageHeader
        eyebrow="Data"
        title="Bring in your marketing data"
        description="Upload exports from Search Console, Google Ads or GA4. Cuework validates every row, labels the data as imported, and re-runs its analysis straight away."
      />
      {ws.properties.length ? (
        <ImportWizard
          properties={ws.properties.map((p) => ({ id: p.id, name: p.name }))}
          latestMonth={ws.period ?? addMonths(monthStart(new Date()), -1)}
          usage={{ used: ws.usage.importsThisMonth, limit: plan.limits.importsPerMonth, planName: plan.name }}
        />
      ) : (
        <EmptyState icon={Building2} title="Add a property first" action={<Link href="/settings#properties" className={buttonStyles({})}>Add a property</Link>}>
          Data is imported into a brand or website, so add one before you upload a file.
        </EmptyState>
      )}
    </div>
  );
}
