"use client";

import { useState } from "react";
import {
  Activity, Ambulance, BadgeCheck, Boxes, ChevronDown, ClipboardList,
  ExternalLink, FileBarChart, HeartHandshake, LayoutDashboard,
  LogIn, LogOut, Menu, Package, PawPrint, Pill, RefreshCw, Settings, ShieldCheck,
  Sprout, TrendingUp, Users, X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { navigate, useRoute } from "@/lib/router";
import { useAuth } from "@/hooks/use-auth";
import { ThemeToggle } from "@/components/shared/theme-toggle";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { AssistantWidget } from "@/components/shared/assistant-widget";
import DashboardView from "@/components/admin/dashboard-view";
import DonationsView from "@/components/admin/donations-view";
import CampaignsView from "@/components/admin/campaigns-view";
import CausesView from "@/components/admin/causes-view";
import AnimalsView from "@/components/admin/animals-view";
import AmbulanceView from "@/components/admin/ambulance-view";
import BeneficiariesView from "@/components/admin/beneficiaries-view";
import VolunteersView from "@/components/admin/volunteers-view";
import UsersView from "@/components/admin/users-view";
import DistributionsView from "@/components/admin/distributions-view";
import InventoryView from "@/components/admin/inventory-view";
import KitsView from "@/components/admin/kits-view";
import MastersView from "@/components/admin/masters-view";
import ReportsView from "@/components/admin/reports-view";
import ActivityView from "@/components/admin/activity-view";
import SettingsView from "@/components/admin/settings-view";

const NAV = [
  {
    group: "Overview",
    items: [{ key: "dashboard", label: "Dashboard", icon: LayoutDashboard }],
  },
  {
    group: "Fundraising",
    items: [
      { key: "donations", label: "Donations", icon: TrendingUp },
      { key: "campaigns", label: "Campaigns", icon: Sprout },
    ],
  },
  {
    group: "Health",
    items: [
      { key: "causes", label: "Adopt-a-Medicine", icon: Pill },
      { key: "ambulance", label: "Ambulance & Green Corridor", icon: Ambulance },
    ],
  },
  {
    group: "Welfare",
    items: [{ key: "animals", label: "Animal Welfare", icon: PawPrint }],
  },
  {
    group: "People",
    items: [
      { key: "beneficiaries", label: "Beneficiaries", icon: HeartHandshake },
      { key: "volunteers", label: "Volunteers", icon: BadgeCheck },
      { key: "users", label: "Users & Roles", icon: Users },
    ],
  },
  {
    group: "Operations",
    items: [
      { key: "distributions", label: "Distributions", icon: Package },
      { key: "inventory", label: "Inventory", icon: Boxes },
      { key: "kits", label: "Ration Kits", icon: ClipboardList },
    ],
  },
  {
    group: "System",
    items: [
      { key: "masters", label: "Masters (MDM)", icon: ShieldCheck },
      { key: "reports", label: "Reports", icon: FileBarChart },
      { key: "activity", label: "Activity Logs", icon: Activity },
      { key: "settings", label: "Settings", icon: Settings },
    ],
  },
];

type NavItem = { key: string; label: string; icon: React.ComponentType<{ className?: string }> };

function AdminNav({
  view,
  onNavigate,
}: {
  view: string;
  onNavigate?: () => void;
}) {
  return (
    <nav className="flex-1 space-y-4 overflow-y-auto px-3 py-4 scrollbar-thin" aria-label="Admin sections">
      {NAV.map((group: { group: string; items: NavItem[] }) => (
        <div key={group.group}>
          <p className="px-3 pb-1.5 text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground/80">
            {group.group}
          </p>
          <div className="space-y-0.5">
            {group.items.map((item) => {
              const active = view === item.key;
              const Icon = item.icon;
              return (
                <button
                  key={item.key}
                  onClick={() => {
                    navigate(`/admin/${item.key}`);
                    onNavigate?.();
                  }}
                  className={cn(
                    "flex min-h-11 w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-sm font-medium outline-none transition-all focus-visible:ring-2 focus-visible:ring-sidebar-ring",
                    active
                      ? "bg-primary text-primary-foreground shadow-sm ring-1 ring-primary/40"
                      : "text-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                  )}
                >
                  <Icon className="size-4 shrink-0" />
                  <span className="truncate">{item.label}</span>
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </nav>
  );
}

export default function AdminApp() {
  const { user, logout, loading } = useAuth();
  const route = useRoute();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const view = route.segments[1] ?? "dashboard";

  const current = NAV.flatMap((g) => g.items).find((i) => i.key === view);

  if (loading) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3">
        <RefreshCw className="size-6 animate-spin text-primary" />
        <p className="text-sm text-muted-foreground">Checking your session…</p>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-muted/40 p-6">
        <div className="w-full max-w-md rounded-2xl border bg-card p-8 text-center shadow-sm">
          <div className="mx-auto mb-4 flex size-14 items-center justify-center rounded-2xl bg-primary/10">
            <ShieldCheck className="size-7 text-primary" />
          </div>
          <h1 className="text-xl font-bold">Admin sign-in required</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Your session could not be verified. Sign in with an admin account
            to open the console — data stays private to authorised users.
          </p>
          <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:justify-center">
            <Button onClick={() => navigate("/login")}>
              <LogIn className="size-4" /> Sign in
            </Button>
            <Button variant="outline" onClick={() => navigate("/")}>
              Back to site
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen bg-muted/40">
      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col border-r bg-sidebar lg:flex">
        <button
          className="flex items-center gap-2.5 px-5 py-4 text-left"
          onClick={() => navigate("/")}
        >
          <span className="flex size-9 items-center justify-center rounded-xl bg-primary text-primary-foreground">
            <ShieldCheck className="size-5" />
          </span>
          <span>
            <span className="block text-sm font-bold leading-tight">United Angel Reach</span>
            <span className="block text-[11px] text-muted-foreground">Admin Console · Bengaluru</span>
          </span>
        </button>
        <AdminNav view={view} />
        <div className="border-t p-3">
          <Button variant="outline" className="w-full justify-start" onClick={() => navigate("/")}>
            <ChevronDown className="size-4 rotate-90" /> View public site
          </Button>
        </div>
      </aside>

      {/* Mobile sidebar sheet */}
      {sidebarOpen && (
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-label="Admin menu">
          <div className="absolute inset-0 bg-black/50" onClick={() => setSidebarOpen(false)} />
          <aside className="absolute inset-y-0 left-0 flex w-72 flex-col bg-sidebar shadow-xl">
            <div className="flex items-center justify-between px-4 py-4">
              <span className="text-sm font-bold">UAR Admin</span>
              <Button size="icon" variant="ghost" onClick={() => setSidebarOpen(false)} aria-label="Close menu">
                <X className="size-5" />
              </Button>
            </div>
            <AdminNav view={view} onNavigate={() => setSidebarOpen(false)} />
          </aside>
        </div>
      )}

      {/* Main */}
      <div className="flex min-w-0 flex-1 flex-col lg:pl-64">
        <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b bg-background/95 px-4 backdrop-blur">
          <Button
            size="icon"
            variant="ghost"
            className="lg:hidden"
            onClick={() => setSidebarOpen(true)}
            aria-label="Open admin menu"
          >
            <Menu className="size-5" />
          </Button>
          <h1 className="truncate text-sm font-semibold sm:text-base">
            {current?.label ?? "Dashboard"}
          </h1>
          <div className="ml-auto flex items-center gap-1.5 sm:gap-2">
            <ThemeToggle align="end" />
            <Button
              size="icon"
              variant="ghost"
              className="sm:hidden"
              aria-label="Sign out"
              onClick={async () => {
                await logout();
                navigate("/");
              }}
            >
              <LogOut className="size-4" aria-hidden="true" />
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  aria-label="Account menu"
                  className="hidden min-h-11 items-center gap-2 rounded-full bg-primary/10 py-1 pl-1.5 pr-2.5 outline-none transition-colors hover:bg-primary/15 focus-visible:ring-2 focus-visible:ring-ring sm:flex"
                >
                  <span className="flex size-7 items-center justify-center rounded-full bg-primary text-[10px] font-bold text-primary-foreground">
                    {(user?.name ?? "A")
                      .split(" ")
                      .filter(Boolean)
                      .slice(0, 2)
                      .map((w) => w.charAt(0).toUpperCase())
                      .join("")}
                  </span>
                  <span className="max-w-[140px] truncate text-xs font-semibold text-primary">
                    {user?.name}
                  </span>
                  <ChevronDown className="size-3.5 text-primary/70" aria-hidden="true" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel>
                  <span className="block truncate">{user?.name}</span>
                  <span className="text-xs font-normal text-muted-foreground">
                    {user?.email} · {user?.role ?? "ADMIN"}
                  </span>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => navigate("/")}>
                  <ExternalLink className="size-4" aria-hidden="true" /> View public site
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  variant="destructive"
                  onClick={async () => {
                    await logout();
                    navigate("/");
                  }}
                >
                  <LogOut className="size-4" aria-hidden="true" /> Sign out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>

        <main className="min-w-0 flex-1 p-4 sm:p-6">
          {view === "dashboard" && <DashboardView />}
          {view === "donations" && <DonationsView />}
          {view === "campaigns" && <CampaignsView />}
          {view === "causes" && <CausesView />}
          {view === "animals" && <AnimalsView />}
          {view === "ambulance" && <AmbulanceView />}
          {view === "beneficiaries" && <BeneficiariesView />}
          {view === "volunteers" && <VolunteersView />}
          {view === "users" && <UsersView />}
          {view === "distributions" && <DistributionsView />}
          {view === "inventory" && <InventoryView />}
          {view === "kits" && <KitsView />}
          {view === "masters" && <MastersView />}
          {view === "reports" && <ReportsView />}
          {view === "activity" && <ActivityView />}
          {view === "settings" && <SettingsView />}
        </main>

        <footer className="mt-auto border-t bg-background px-4 py-3 text-center text-xs text-muted-foreground sm:px-6">
          United Angel Reach · Bengaluru, Karnataka → serving all of India
        </footer>
      </div>

      <AssistantWidget />
    </div>
  );
}
