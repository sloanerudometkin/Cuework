"use client";

import {
  CalendarCheck,
  ChartLine,
  FileText,
  Inbox,
  LayoutDashboard,
  LogOut,
  Menu,
  Settings,
  SquareKanban,
  Upload,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import * as React from "react";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Logo, LogoMark } from "@/components/domain/logo";
import { DemoBanner } from "@/components/demo-banner";
import { logoutAction } from "@/lib/actions/auth";
import type { ShellData } from "@/lib/services/shell";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/overview", label: "Command Center", icon: LayoutDashboard },
  { href: "/recommendations", label: "Recommendations", icon: Inbox, badge: "open" as const },
  { href: "/plan", label: "Weekly Plan", icon: CalendarCheck, badge: "week" as const },
  { href: "/work", label: "Work Board", icon: SquareKanban, badge: "blocked" as const },
  { href: "/performance", label: "Performance", icon: ChartLine },
  { href: "/brief", label: "Leadership Brief", icon: FileText },
];
const SECONDARY = [
  { href: "/import", label: "Import data", icon: Upload },
  { href: "/settings", label: "Settings", icon: Settings },
];

function NavLinks({ shell, onNavigate }: { shell: ShellData; onNavigate?: () => void }) {
  const pathname = usePathname();
  const item = (n: (typeof NAV)[number] | (typeof SECONDARY)[number]) => {
    const active = pathname === n.href || pathname.startsWith(`${n.href}/`);
    const badge = "badge" in n ? n.badge : undefined;
    let chip: React.ReactNode = null;
    if (badge === "open" && shell.openRecommendations > 0)
      chip = <span className="tabular rounded-full bg-cue px-1.5 text-[11px] font-semibold leading-5 text-ink">{shell.openRecommendations}</span>;
    if (badge === "blocked" && shell.blockedWork > 0)
      chip = <span className="tabular rounded-full bg-brick px-1.5 text-[11px] font-semibold leading-5 text-white" title="Blocked items">{shell.blockedWork}</span>;
    if (badge === "week" && shell.weekUtilization != null)
      chip = (
        <span className={cn("tabular text-[11px] font-medium", shell.weekStatus === "over" ? "text-[#f0a79f]" : shell.weekStatus === "tight" ? "text-cue" : "text-side-muted")}>
          {Math.round(shell.weekUtilization * 100)}%
        </span>
      );
    return (
      <li key={n.href}>
        <Link
          href={n.href}
          onClick={onNavigate}
          aria-current={active ? "page" : undefined}
          className={cn(
            "group flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
            active ? "bg-white/10 text-white" : "text-side-text hover:bg-white/5 hover:text-white",
          )}
        >
          <n.icon className={cn("size-[18px] shrink-0", active ? "text-cue" : "text-side-muted group-hover:text-side-text")} aria-hidden />
          <span className="flex-1">{n.label}</span>
          {chip}
        </Link>
      </li>
    );
  };
  return (
    <nav aria-label="Primary" className="flex flex-1 flex-col">
      <ul className="space-y-0.5">{NAV.map(item)}</ul>
      <p className="mb-2 mt-7 px-3 text-[11px] font-semibold uppercase tracking-[0.08em] text-side-muted">Workspace</p>
      <ul className="space-y-0.5">{SECONDARY.map(item)}</ul>
    </nav>
  );
}

function SidebarBody({ shell, user, onNavigate }: { shell: ShellData; user: { name: string; email: string }; onNavigate?: () => void }) {
  return (
    <div className="flex h-full flex-col gap-6">
      <Logo variant="reverse" height={26} className="ml-1" />
      <div className="rounded-lg border border-white/10 bg-white/5 px-3 py-2.5">
        <p className="truncate text-sm font-medium text-white">{shell.orgName}</p>
        <div className="mt-1 flex items-center gap-2 text-xs text-side-muted">
          <span>{shell.planName} plan</span>
          {shell.isDemo ? <span className="rounded-full bg-cue px-1.5 font-semibold text-ink">Demo</span> : null}
        </div>
      </div>
      <NavLinks shell={shell} onNavigate={onNavigate} />
      <div className="border-t border-white/10 pt-4">
        <p className="truncate text-sm font-medium text-white">{user.name}</p>
        <p className="truncate text-xs text-side-muted">{user.email}</p>
        <form action={logoutAction} className="mt-3">
          <button className="inline-flex items-center gap-2 rounded-lg px-1 py-1 text-[13px] text-side-text hover:text-white">
            <LogOut className="size-4" aria-hidden /> Sign out
          </button>
        </form>
      </div>
    </div>
  );
}

export function AppShell({ shell, user, children }: { shell: ShellData; user: { name: string; email: string }; children: React.ReactNode }) {
  const [open, setOpen] = React.useState(false);
  return (
    <div className="min-h-dvh lg:pl-64">
      <aside className="no-print fixed inset-y-0 left-0 hidden w-64 bg-ink px-4 py-6 lg:block">
        <SidebarBody shell={shell} user={user} />
      </aside>

      <header className="no-print sticky top-0 z-30 flex h-14 items-center justify-between bg-ink px-4 lg:hidden">
        <Link href="/overview" aria-label="Cuework home">
          <LogoMark variant="reverse" size={30} />
        </Link>
        <p className="mx-3 min-w-0 flex-1 truncate text-sm font-medium text-white">{shell.orgName}</p>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <button aria-label="Open menu" className="rounded-lg p-2 text-white hover:bg-white/10">
              <Menu className="size-6" aria-hidden />
            </button>
          </DialogTrigger>
          <DialogContent title="Menu" side="left" className="bg-ink text-white [&_h2]:text-white [&>div:first-child]:border-white/10 [&_button[aria-label=Close]]:text-side-text [&>div:first-child_p]:text-side-muted">
            <SidebarBody shell={shell} user={user} onNavigate={() => setOpen(false)} />
          </DialogContent>
        </Dialog>
      </header>

      {shell.isDemo ? <DemoBanner /> : null}
      <main id="main" className="mx-auto w-full max-w-[1240px] px-4 py-7 sm:px-6 lg:px-10 lg:py-10">
        {children}
      </main>
    </div>
  );
}
