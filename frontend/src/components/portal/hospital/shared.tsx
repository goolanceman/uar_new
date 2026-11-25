"use client";

/**
 * Hospital partner portal — shared bits: loads the caller's own organisation
 * from GET /api/health-orgs (array or single-object) and small UI helpers.
 */

import { useCallback, useEffect, useState } from "react";
import { Building2 } from "lucide-react";
import { toast } from "sonner";
import { get } from "@/lib/api-client";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { ListSkeleton } from "../doctor/shared";
import type { HealthOrgRow } from "../doctor/shared";

/** Normalises GET /api/health-orgs → the caller's single organisation. */
export async function fetchMyOrg(): Promise<HealthOrgRow | null> {
  const data = await get<unknown>("/api/health-orgs");
  if (Array.isArray(data)) return (data as HealthOrgRow[])[0] ?? null;
  if (data && typeof data === "object") {
    const rec = data as Record<string, unknown>;
    if (rec.id) return data as HealthOrgRow;
    if (rec.org && typeof rec.org === "object") return rec.org as HealthOrgRow;
    if (Array.isArray(rec.items)) return (rec.items as HealthOrgRow[])[0] ?? null;
  }
  return null;
}

/** useMyOrg — loads + reloads the caller's organisation record. */
export function useMyOrg() {
  const [org, setOrg] = useState<HealthOrgRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setOrg(await fetchMyOrg());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load your organisation");
      setOrg(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  return { org, loading, error, reload };
}

export function OrgNotFound() {
  return (
    <EmptyState
      icon={<Building2 className="size-5" />}
      title="No organisation linked to your account"
      hint="Ask a UAR admin to link your hospital profile — then this portal fills in automatically."
    />
  );
}

export function PartnerHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: React.ReactNode;
}) {
  return (
    <PageHeader title={title} description={description} icon={<Building2 className="size-5" />} actions={actions} />
  );
}

export function useToastError() {
  return useCallback((e: unknown, fallback: string) => {
    toast.error(e instanceof Error ? e.message : fallback);
  }, []);
}

export { ListSkeleton };
