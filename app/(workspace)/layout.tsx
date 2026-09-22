import { AppShell } from "@/components/app-shell";
import { requireWorkspace } from "@/lib/auth/session";
import { getShellData } from "@/lib/services/shell";

export const dynamic = "force-dynamic";

export default async function WorkspaceLayout({ children }: { children: React.ReactNode }) {
  const { db, orgId, name, email } = await requireWorkspace();
  const shell = await getShellData(db, orgId);
  return (
    <AppShell shell={shell} user={{ name, email }}>
      {children}
    </AppShell>
  );
}
