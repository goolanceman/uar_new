"use client";

import { useEffect, useState } from "react";
import {
  Boxes,
  ClipboardCheck,
  ClipboardList,
  HandCoins,
  HandHeart,
  Hourglass,
  LayoutDashboard,
  PackageOpen,
  PawPrint,
  Pill,
  ReceiptText,
  ScanLine,
  UserRound,
} from "lucide-react";
import type { SessionUser } from "@/hooks/use-auth";
import { get } from "@/lib/api-client";
import { navigate, useRoute } from "@/lib/router";
import { PortalLayout, type PortalNavItem } from "./portal-layout";
import DonorOverview from "./donor/overview";
import DonorDonations from "./donor/donations";
import DonorCauses from "./donor/causes";
import DonorAnimals from "./donor/animals";
import DonorReceipts from "./donor/receipts";
import DonorProfile from "./donor/profile";
import VolunteerApplicationView from "./volunteer/application";
import VolunteerOverview from "./volunteer/overview";
import VolunteerTasks from "./volunteer/tasks";
import VolunteerDistributions from "./volunteer/distributions";
import VolunteerScan from "./volunteer/scan";
import VolunteerInventory from "./volunteer/inventory";
import VolunteerProfileView from "./volunteer/profile";
import BeneficiaryHub from "./beneficiary/hub";
import { Skeleton } from "@/components/ui/skeleton";

/** Canonical Volunteer shape (subset) returned by GET /api/volunteers/me */
export interface VolunteerProfile {
  id: string;
  userId: string;
  skills?: string | null; // JSON string
  availability?: string | null; // JSON string
  assignedArea?: string | null;
  emergencyContact?: string | null;
  idProof?: string | null;
  status: string; // PENDING | ACTIVE | INACTIVE | SUSPENDED
  joinedAt?: string;
}

/* ============================== DONOR ============================== */

const DONOR_NAV: PortalNavItem[] = [
  { key: "overview", label: "Overview", icon: LayoutDashboard },
  { key: "donations", label: "Donations", icon: HandCoins },
  { key: "causes", label: "Adopt-a-Medicine", icon: Pill },
  { key: "animals", label: "Animal Sponsorship", icon: PawPrint },
  { key: "receipts", label: "Receipts", icon: ReceiptText },
  { key: "profile", label: "Profile", icon: UserRound },
];

function DonorPortal({ user }: { user: SessionUser }) {
  const { segments } = useRoute();
  const view = segments[1] ?? "overview";
  const viewKey = DONOR_NAV.some((n) => n.key === view) ? view : "overview";

  return (
    <PortalLayout
      user={user}
      nav={DONOR_NAV}
      active={viewKey}
      onNavigate={(key) => navigate(`/donor/${key}`)}
      accent="emerald"
    >
      {viewKey === "overview" && <DonorOverview user={user} />}
      {viewKey === "donations" && <DonorDonations user={user} />}
      {viewKey === "causes" && <DonorCauses user={user} />}
      {viewKey === "animals" && <DonorAnimals user={user} />}
      {viewKey === "receipts" && <DonorReceipts user={user} />}
      {viewKey === "profile" && <DonorProfile user={user} />}
    </PortalLayout>
  );
}

/* ============================ VOLUNTEER ============================ */

const VOLUNTEER_ACTIVE_NAV: PortalNavItem[] = [
  { key: "overview", label: "Overview", icon: LayoutDashboard },
  { key: "tasks", label: "Tasks", icon: ClipboardList },
  { key: "distributions", label: "Distributions", icon: PackageOpen },
  { key: "scan", label: "Scan Kit", icon: ScanLine },
  { key: "inventory", label: "Inventory", icon: Boxes },
  { key: "profile", label: "Profile", icon: UserRound },
];

const VOLUNTEER_GATED_NAV: PortalNavItem[] = [
  { key: "application", label: "Application", icon: ClipboardCheck },
  { key: "profile", label: "Profile", icon: UserRound },
];

function VolunteerPortal({ user }: { user: SessionUser }) {
  const { segments } = useRoute();
  const [volunteer, setVolunteer] = useState<VolunteerProfile | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let alive = true;
    get<unknown>("/api/volunteers/me")
      .then((data) => {
        if (!alive) return;
        // Accept {volunteer}, raw volunteer, null, or a {success,data} envelope.
        const rec = (data ?? {}) as Record<string, unknown>;
        const inner =
          rec.volunteer ??
          (rec.data && typeof rec.data === "object"
            ? (rec.data as Record<string, unknown>).volunteer ?? rec.data
            : rec);
        setVolunteer(
          inner && typeof inner === "object" && "id" in (inner as Record<string, unknown>)
            ? (inner as VolunteerProfile)
            : null
        );
      })
      .catch(() => {
        if (alive) setVolunteer(null);
      })
      .finally(() => {
        if (alive) setLoaded(true);
      });
    return () => {
      alive = false;
    };
  }, [user.status]);

  // Approval gate — kept EXACT:
  //  · Genuine volunteers go through the ACTIVE check (PENDING / no profile /
  //    not-yet-ACTIVE ⇒ application view only — tasks, scan and distributions
  //    stay hidden).
  //  · Any other signed-in role (DONOR / BENEFICIARY) wandering into /volunteer
  //    is gated too: they see the application form until an admin approves them.
  const gated =
    user.role === "VOLUNTEER"
      ? user.status === "PENDING" ||
        !loaded ||
        !volunteer ||
        volunteer.status !== "ACTIVE"
      : true;

  const nav = gated ? VOLUNTEER_GATED_NAV : VOLUNTEER_ACTIVE_NAV;
  const requested = segments[1] ?? "";
  const viewKey = nav.some((n) => n.key === requested)
    ? requested
    : nav[0].key;

  return (
    <PortalLayout
      user={user}
      nav={nav}
      active={viewKey}
      onNavigate={(key) => navigate(`/volunteer/${key}`)}
      accent="teal"
    >
      {gated && loaded && (
        <div
          role="status"
          className="mb-4 flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200"
        >
          <Hourglass className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden="true" />
          <p>
            <span className="font-semibold">
              {user.role === "VOLUNTEER"
                ? "Your account is awaiting admin approval."
                : "Volunteer tools open after approval."}
            </span>{" "}
            {user.role === "VOLUNTEER" && user.status === "PENDING"
              ? "Complete your volunteer application below — once approved, the full volunteer portal unlocks."
              : "Send your volunteer application below — once our team approves it, the full portal unlocks."}
          </p>
        </div>
      )}

      {!loaded ? (
        <div className="space-y-4" aria-label="Loading volunteer portal">
          <Skeleton className="h-24 w-full rounded-xl" />
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-28 rounded-xl" />
            ))}
          </div>
          <Skeleton className="h-64 w-full rounded-xl" />
        </div>
      ) : (
        <>
          {viewKey === "application" && (
            <VolunteerApplicationView user={user} volunteer={volunteer} />
          )}
          {viewKey === "overview" && (
            <VolunteerOverview user={user} volunteer={volunteer} />
          )}
          {viewKey === "tasks" && (
            <VolunteerTasks user={user} volunteer={volunteer} />
          )}
          {viewKey === "distributions" && (
            <VolunteerDistributions user={user} volunteer={volunteer} />
          )}
          {viewKey === "scan" && <VolunteerScan user={user} volunteer={volunteer} />}
          {viewKey === "inventory" && (
            <VolunteerInventory user={user} volunteer={volunteer} />
          )}
          {viewKey === "profile" && (
            <VolunteerProfileView user={user} volunteer={volunteer} />
          )}
        </>
      )}
    </PortalLayout>
  );
}

/* =========================== BENEFICIARY =========================== */

const BENEFICIARY_NAV: PortalNavItem[] = [
  { key: "help", label: "Help Centre", icon: HandHeart },
];

/* ============================== ROOT =============================== */

export default function PortalRouter({ user }: { user: SessionUser }) {
  const { segments } = useRoute();
  const seg = segments[0] ?? "";

  if (seg === "donor") return <DonorPortal user={user} />;
  if (seg === "volunteer") return <VolunteerPortal user={user} />;
  return (
    <PortalLayout
      user={user}
      nav={BENEFICIARY_NAV}
      active="help"
      onNavigate={() => navigate("/beneficiary/help")}
      accent="pink"
    >
      <BeneficiaryHub user={user} />
    </PortalLayout>
  );
}
