"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Activity, Ambulance, BadgeCheck, Boxes, ChevronDown, ClipboardList,
  FileBarChart, HeartHandshake, LayoutDashboard,
  LogOut, Menu, Package, PawPrint, Pill, RefreshCw, Settings, ShieldCheck,
  Sprout, TrendingUp, Users, X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { navigate, useRoute } from "@/lib/router";
import { useAuth } from "@/hooks/use-auth";
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

export default function AdminApp() {
  const { user, logout, loading } = useAuth();
  const route = useRoute();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const view = useMemo(() => {
    const seg = route.segments[1] ?? "dashboard";
    return seg;
  }, [route.segments]);

  useEffect(() => setSidebarOpen(false), [view]);

  const current = NAV.flatMap((g) => g.items).find((i) => i.key === view);

  const NavList = ({ onNavigate }: { onNavigate?: () => void }) => (
    <nav className="flex-1 space-y-4 overflow-y-auto px-3 py-4 scrollbar-thin" aria-label="Admin sections">
      {NAV.map((group) => (
        <div key={group.group}>
          <p className="px-2 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
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
                    "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm font-medium transition",
                    active
                      ? "bg-primary text-primary-foreground shadow-sm"
                      : "text-foreground/70 hover:bg-accent hover:text-foreground"
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

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <RefreshCw className="size-6 animate-spin text-primary" />
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
        <NavList />
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
            <NavList onNavigate={() => setSidebarOpen(false)} />
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
          <div className="ml-auto flex items-center gap-2">
            <span className="hidden rounded-full bg-primary/10 px-2.5 py-1 text-xs font-semibold text-primary sm:inline">
              {user?.name} · ADMIN
            </span>
            <Button
              size="icon"
              variant="ghost"
              aria-label="Sign out"
              onClick={async () => {
                await logout();
                navigate("/");
              }}
            >
              <LogOut className="size-4" />
            </Button>
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

        <footer className="mt-auto border-t bg-background px-6 py-3 text-center text-xs text-muted-foreground">
          United Angel Reach Trust · Bengaluru, Karnataka → serving all of India · 80G eligible
        </footer>
      </div>

      <AssistantWidget />
    </div>
  );
}
