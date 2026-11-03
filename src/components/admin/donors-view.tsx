"use client";

/**
 * Donors (CRM) — placeholder wired into the admin shell; full donor-360
 * implementation lands with the donors module wave.
 */

import { PageHeader } from "@/components/shared/page-header";
import { SectionCard } from "@/components/shared/section-card";
import { EmptyState } from "@/components/shared/empty-state";
import { HeartHandshake } from "lucide-react";

export default function DonorsView() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Donors (CRM)"
        description="Every supporter in one place — lifetime value, receipts, pledges and outreach."
        icon={<HeartHandshake className="size-5" />}
      />
      <SectionCard title="Donor directory" description="Loading the full donor registry…">
        <EmptyState
          icon={<HeartHandshake className="size-8" />}
          title="Donor CRM is being rebuilt"
          hint="This module gets table/grid/list layouts, donor 360 profiles, and lifetime-value analytics."
        />
      </SectionCard>
    </div>
  );
}
