"use client";

/**
 * Health Programme — Admin console shell (round 6 healthcare module).
 *
 * Like settings-view/volunteers-view: a PageHeader + horizontally scrollable
 * internal tab nav, with every tab living in its own file under
 * ./health/ (overview, camps, partners, professionals, registrations,
 * appointments, clinical, prescriptions, diagnostics, referrals, pharmacy,
 * documents, reports, ai-insights[ADMIN]).
 *
 * A `revision` counter feeds every tab so the header Refresh button
 * re-fetches all mounted data; tabs degrade to per-tab retry states while
 * backend healthcare routes land agent-by-agent.
 */

import { useCallback, useState } from "react";
import {
  Building2,
  CalendarDays,
  FileBarChart,
  FlaskConical,
  FolderOpen,
  HeartPulse,
  LayoutDashboard,
  Package,
  Pill,
  RefreshCw,
  Send,
  Share2,
  Sparkles,
  Stethoscope,
  Tent,
  Users,
} from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import OverviewTab, { type TabProps } from "./health/overview";
import CampsTab from "./health/camps";
import PartnersTab from "./health/partners";
import ProfessionalsTab from "./health/professionals";
import RegistrationsTab from "./health/registrations";
import AppointmentsTab from "./health/appointments";
import ClinicalTab from "./health/clinical";
import PrescriptionsTab from "./health/prescriptions";
import DiagnosticsTab from "./health/diagnostics";
import ReferralsTab from "./health/referrals";
import PharmacyTab from "./health/pharmacy";
import DocumentsTab from "./health/documents";
import ReportsTab from "./health/reports";
import AiInsightsTab from "./health/ai-insights";

const TABS: Array<{ value: string; label: string; icon: React.ElementType; adminOnly?: boolean }> = [
  { value: "overview", label: "Overview", icon: LayoutDashboard },
  { value: "camps", label: "Camps", icon: Tent },
  { value: "partners", label: "Partners", icon: Building2 },
  { value: "professionals", label: "Professionals", icon: Stethoscope },
  { value: "registrations", label: "Registrations", icon: Users },
  { value: "appointments", label: "Appointments", icon: CalendarDays },
  { value: "clinical", label: "Clinical", icon: HeartPulse },
  { value: "prescriptions", label: "Prescriptions", icon: Pill },
  { value: "diagnostics", label: "Diagnostics", icon: FlaskConical },
  { value: "referrals", label: "Referrals", icon: Share2 },
  { value: "pharmacy", label: "Pharmacy", icon: Package },
  { value: "documents", label: "Documents", icon: FolderOpen },
  { value: "reports", label: "Reports", icon: FileBarChart },
  { value: "ai-insights", label: "AI Insights", icon: Sparkles, adminOnly: true },
];

export default function HealthView() {
  const { user } = useAuth();
  const isAdmin = user?.role === "ADMIN";
  const [tab, setTab] = useState("overview");
  const [revision, setRevision] = useState(0);

  const bump = useCallback(() => setRevision((r) => r + 1), []);

  const tabProps: TabProps = { revision, isAdmin, onNavigate: setTab };

  const visibleTabs = TABS.filter((t) => !t.adminOnly || isAdmin);

  return (
    <div className="space-y-4 sm:space-y-6">
      <PageHeader
        title="Health Programme"
        description="Medical camps, partners and professionals, clinical operations, pharmacy oversight and programme reports."
        icon={<HeartPulse className="size-5" aria-hidden="true" />}
        actions={
          <Button
            variant="outline"
            onClick={bump}
            aria-label="Refresh health programme data"
          >
            <RefreshCw className="size-4" aria-hidden="true" /> Refresh
          </Button>
        }
      />

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList
          className="h-auto w-full max-w-full justify-start gap-1 overflow-x-auto scrollbar-thin sm:flex-wrap"
          aria-label="Health programme sections"
        >
          {visibleTabs.map((t) => {
            const Icon = t.icon;
            return (
              <TabsTrigger key={t.value} value={t.value} className="shrink-0 gap-1.5">
                <Icon className="size-3.5" aria-hidden="true" />
                {t.label}
              </TabsTrigger>
            );
          })}
        </TabsList>

        <TabsContent value="overview" className="mt-4">
          <OverviewTab {...tabProps} />
        </TabsContent>
        <TabsContent value="camps" className="mt-4">
          <CampsTab {...tabProps} />
        </TabsContent>
        <TabsContent value="partners" className="mt-4">
          <PartnersTab {...tabProps} />
        </TabsContent>
        <TabsContent value="professionals" className="mt-4">
          <ProfessionalsTab {...tabProps} />
        </TabsContent>
        <TabsContent value="registrations" className="mt-4">
          <RegistrationsTab {...tabProps} />
        </TabsContent>
        <TabsContent value="appointments" className="mt-4">
          <AppointmentsTab {...tabProps} />
        </TabsContent>
        <TabsContent value="clinical" className="mt-4">
          <ClinicalTab {...tabProps} />
        </TabsContent>
        <TabsContent value="prescriptions" className="mt-4">
          <PrescriptionsTab {...tabProps} />
        </TabsContent>
        <TabsContent value="diagnostics" className="mt-4">
          <DiagnosticsTab {...tabProps} />
        </TabsContent>
        <TabsContent value="referrals" className="mt-4">
          <ReferralsTab {...tabProps} />
        </TabsContent>
        <TabsContent value="pharmacy" className="mt-4">
          <PharmacyTab {...tabProps} />
        </TabsContent>
        <TabsContent value="documents" className="mt-4">
          <DocumentsTab {...tabProps} />
        </TabsContent>
        <TabsContent value="reports" className="mt-4">
          <ReportsTab {...tabProps} />
        </TabsContent>
        {isAdmin ? (
          <TabsContent value="ai-insights" className="mt-4">
            <AiInsightsTab {...tabProps} />
          </TabsContent>
        ) : null}
      </Tabs>
    </div>
  );
}
