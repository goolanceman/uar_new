"use client";

/**
 * Food Security — Admin console shell.
 * Same structure as the Health Programme shell: PageHeader + scrollable
 * internal tabs, each tab in its own file under ./food/, a `revision`
 * counter for the header Refresh button.
 */

import { useCallback, useState } from "react";
import {
  Apple, ClipboardList, ClipboardPlus, Home, LayoutDashboard, PackagePlus,
  PackageSearch, RefreshCw, ScanLine, Sparkles, Tent,
} from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import OverviewTab from "./food/overview";
import ProgrammesTab from "./food/programmes";
import EventsTab from "./food/events";
import DeskTab from "./food/desk";
import ApplicationsTab from "./food/applications";
import HouseholdsTab from "./food/households";
import BatchesTab from "./food/batches";
import PickupsTab from "./food/pickups";
import InsightsTab from "./food/insights";

const TABS = [
  { value: "overview", label: "Overview", icon: LayoutDashboard },
  { value: "programmes", label: "Programmes", icon: Apple },
  { value: "events", label: "Distribution Events", icon: Tent },
  { value: "desk", label: "Check-in Desk", icon: ScanLine },
  { value: "registrations", label: "Registrations", icon: ClipboardList },
  { value: "applications", label: "Applications", icon: ClipboardPlus },
  { value: "households", label: "Households", icon: Home },
  { value: "batches", label: "Food Inventory", icon: PackageSearch },
  { value: "pickups", label: "Donation Pickups", icon: PackagePlus },
  { value: "insights", label: "AI Insights", icon: Sparkles },
];

export default function FoodView() {
  const { user } = useAuth();
  const isAdmin = user?.role === "ADMIN";
  const [tab, setTab] = useState("overview");
  const [revision, setRevision] = useState(0);

  const bump = useCallback(() => setRevision((r) => r + 1), []);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Food Security & Community Nutrition"
        description="Programmes, distribution events, beneficiary applications, food inventory and impact — the complete food assistance operations desk."
        icon={<Apple className="size-5" />}
        actions={
          <Button variant="outline" size="sm" onClick={bump}>
            <RefreshCw className="size-4" /> Refresh
          </Button>
        }
      />

      <Tabs value={tab} onValueChange={setTab} className="space-y-4">
        <TabsList className="flex w-full gap-1 overflow-x-auto p-1 h-auto">
          {TABS.map(({ value, label, icon: Icon }) => (
            <TabsTrigger key={value} value={value} className="shrink-0 gap-1.5">
              <Icon className="size-4" aria-hidden="true" /> {label}
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value="overview" className="mt-4 space-y-4">
          <OverviewTab revision={revision} isAdmin={isAdmin} onNavigate={setTab} />
        </TabsContent>
        <TabsContent value="programmes" className="mt-4 space-y-4">
          <ProgrammesTab revision={revision} isAdmin={isAdmin} onNavigate={setTab} />
        </TabsContent>
        <TabsContent value="events" className="mt-4 space-y-4">
          <EventsTab revision={revision} isAdmin={isAdmin} onNavigate={setTab} />
        </TabsContent>
        <TabsContent value="desk" className="mt-4 space-y-4">
          <DeskTab revision={revision} isAdmin={isAdmin} onNavigate={setTab} />
        </TabsContent>
        <TabsContent value="registrations" className="mt-4 space-y-4">
          <DeskTab revision={revision} isAdmin={isAdmin} onNavigate={setTab} registrationsOnly />
        </TabsContent>
        <TabsContent value="applications" className="mt-4 space-y-4">
          <ApplicationsTab revision={revision} isAdmin={isAdmin} onNavigate={setTab} />
        </TabsContent>
        <TabsContent value="households" className="mt-4 space-y-4">
          <HouseholdsTab revision={revision} isAdmin={isAdmin} onNavigate={setTab} />
        </TabsContent>
        <TabsContent value="batches" className="mt-4 space-y-4">
          <BatchesTab revision={revision} isAdmin={isAdmin} onNavigate={setTab} />
        </TabsContent>
        <TabsContent value="pickups" className="mt-4 space-y-4">
          <PickupsTab revision={revision} isAdmin={isAdmin} onNavigate={setTab} />
        </TabsContent>
        <TabsContent value="insights" className="mt-4 space-y-4">
          <InsightsTab revision={revision} isAdmin={isAdmin} onNavigate={setTab} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
