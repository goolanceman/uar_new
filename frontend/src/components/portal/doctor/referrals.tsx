"use client";

/**
 * Doctor portal — Referrals. Refer a patient to a partner hospital/organisation
 * and track the status of outgoing referrals.
 */

import { useCallback, useEffect, useState } from "react";
import { Plus, RefreshCw, Share2, Users, X } from "lucide-react";
import { toast } from "sonner";
import type { SessionUser } from "@/hooks/use-auth";
import { get, patch, post } from "@/lib/api-client";
import { formatDateTime } from "@/lib/format";
import { PageHeader } from "@/components/shared/page-header";
import { SectionCard } from "@/components/shared/section-card";
import { StatusBadge } from "@/components/shared/status-badge";
import { FormSheet } from "@/components/shared/form-sheet";
import { FieldGrid, SelectField, TextField, TextareaField } from "@/components/shared/form-fields";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  ageSexLine,
  asArray,
  ListSkeleton,
  medTone,
  QuietEmpty,
  toastError,
  useBeneficiarySearch,
  type BeneficiaryLite,
  type HealthOrgRow,
  type ReferralRow,
} from "./shared";

interface ReferralForm {
  orgId: string;
  priority: string;
  reason: string;
  notes: string;
}

const PRIORITY_OPTIONS = [
  { value: "ROUTINE", label: "Routine" },
  { value: "URGENT", label: "Urgent" },
  { value: "CRITICAL", label: "Critical" },
];

export default function DoctorReferrals({ user }: { user: SessionUser }) {
  const [rows, setRows] = useState<ReferralRow[]>([]);
  const [orgs, setOrgs] = useState<HealthOrgRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [sheetOpen, setSheetOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<ReferralForm>({ orgId: "", priority: "ROUTINE", reason: "", notes: "" });
  const search = useBeneficiarySearch();
  const [picked, setPicked] = useState<BeneficiaryLite | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [refData, orgData] = await Promise.all([
        get<unknown>("/api/referrals"),
        get<unknown>("/api/health-orgs").catch(() => []),
      ]);
      setRows(asArray<ReferralRow>(refData));
      setOrgs(asArray<HealthOrgRow>(orgData).filter((o) => (o.status ?? "VERIFIED") !== "PENDING" || true));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load referrals");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const openSheet = () => {
    setForm({ orgId: "", priority: "ROUTINE", reason: "", notes: "" });
    setPicked(null);
    search.setQ("");
    setSheetOpen(true);
  };

  const save = async () => {
    if (!picked) {
      toast.error("Pick a patient first");
      return;
    }
    if (!form.orgId) {
      toast.error("Choose the hospital or organisation");
      return;
    }
    setSaving(true);
    try {
      await post("/api/referrals", {
        beneficiaryId: picked.id,
        orgId: form.orgId,
        priority: form.priority,
        reason: form.reason.trim() || undefined,
        notes: form.notes.trim() || undefined,
      });
      toast.success("Referral sent — the receiving organisation will accept or decline");
      setSheetOpen(false);
      await load();
    } catch (e) {
      toastError(e, "Could not send the referral");
    } finally {
      setSaving(false);
    }
  };

  const updateStatus = async (row: ReferralRow, status: string) => {
    try {
      await patch(`/api/referrals/${row.id}`, { status });
      toast.success(`Referral marked ${status.toLowerCase()}`);
      await load();
    } catch (e) {
      toastError(e, "Could not update the referral");
    }
  };

  const orgOptions = orgs.map((o) => ({ value: o.id, label: o.name }));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Referrals"
        description="Send patients to partner hospitals and track how the referral progresses."
        icon={<Share2 className="size-5" />}
        actions={
          <>
            <Button variant="outline" size="sm" className="min-h-11 gap-1.5 sm:min-h-9" onClick={load} aria-label="Refresh referrals">
              <RefreshCw className="size-4" aria-hidden="true" />
              Refresh
            </Button>
            <Button size="sm" className="min-h-11 gap-1.5 sm:min-h-9" onClick={openSheet}>
              <Plus className="size-4" aria-hidden="true" />
              New referral
            </Button>
          </>
        }
      />

      <SectionCard title="My referrals" description="Newest first" icon={<Share2 className="size-5" />}>
        {loading ? (
          <ListSkeleton rows={3} />
        ) : rows.length === 0 ? (
          <QuietEmpty icon={<Share2 className="size-5" />} title="No referrals yet" error={error} />
        ) : (
          <ul className="max-h-[32rem] divide-y overflow-y-auto scrollbar-thin">
            {rows.map((row) => (
              <li key={row.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 py-3 first:pt-0 last:pb-0">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">
                    {row.beneficiary?.name ?? "Patient"} → {row.org?.name ?? "Partner organisation"}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {row.priority && row.priority !== "ROUTINE" ? `${row.priority} · ` : ""}
                    {row.createdAt ? formatDateTime(row.createdAt) : ""}
                    {row.reason ? ` · ${row.reason}` : ""}
                  </p>
                </div>
                <StatusBadge status={row.status} tone={medTone(row.status)} />
                {row.status === "PENDING" && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="min-h-11 sm:min-h-9"
                    onClick={() => void updateStatus(row, "CANCELLED")}
                    aria-label={`Cancel referral for ${row.beneficiary?.name ?? "patient"}`}
                  >
                    <X className="size-4" aria-hidden="true" />
                    <span className="sr-only sm:not-sr-only sm:text-xs">Cancel</span>
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </SectionCard>

      {/* Create FormSheet */}
      <FormSheet
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        title="New referral"
        description="Pick the patient, the receiving organisation and the urgency."
        size="md"
        submitLabel="Send referral"
        onSubmit={save}
        loading={saving}
        dirty={!!picked || form.reason !== "" || form.notes !== ""}
      >
        {picked ? (
          <div className="flex items-center gap-3 rounded-lg border bg-muted/40 p-3">
            <Users className="size-4 shrink-0 text-primary" aria-hidden="true" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{picked.name}</p>
              <p className="truncate text-xs text-muted-foreground">{ageSexLine(picked)}</p>
            </div>
            <Button type="button" size="icon" variant="ghost" className="size-11" onClick={() => setPicked(null)} aria-label="Change patient">
              <X className="size-4" />
            </Button>
          </div>
        ) : (
          <>
            <Input
              type="search"
              value={search.q}
              onChange={(e) => search.setQ(e.target.value)}
              placeholder="Search patient by name, phone or code…"
              aria-label="Search patients"
              className="h-11"
            />
            {search.results.length > 0 && (
              <ul className="max-h-56 divide-y overflow-y-auto rounded-lg border scrollbar-thin">
                {search.results.map((b) => (
                  <li key={b.id}>
                    <button
                      type="button"
                      onClick={() => setPicked(b)}
                      className="flex w-full min-h-11 flex-col justify-center px-3 py-2.5 text-left transition hover:bg-accent"
                    >
                      <span className="block truncate text-sm font-medium">{b.name}</span>
                      <span className="block truncate text-xs text-muted-foreground">{ageSexLine(b)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {search.q.trim().length >= 2 && !search.loading && search.results.length === 0 && (
              <p className="text-xs text-muted-foreground">No patients match — check the spelling or phone number.</p>
            )}
          </>
        )}

        <FieldGrid>
          <SelectField
            label="Hospital / organisation"
            required
            value={form.orgId as string}
            onChange={(v) => setForm((f) => ({ ...f, orgId: v }))}
            options={orgOptions}
            placeholder={orgOptions.length ? "Select…" : "Loading organisations…"}
          />
          <SelectField
            label="Priority"
            value={form.priority as "ROUTINE" | "URGENT" | "CRITICAL"}
            onChange={(v) => setForm((f) => ({ ...f, priority: v }))}
            options={PRIORITY_OPTIONS}
          />
        </FieldGrid>
        <TextField
          label="Reason"
          value={form.reason}
          onChange={(v) => setForm((f) => ({ ...f, reason: v }))}
          placeholder="e.g. Cardiology opinion needed"
        />
        <TextareaField
          label="Clinical notes"
          value={form.notes}
          onChange={(v) => setForm((f) => ({ ...f, notes: v }))}
          placeholder="What the receiving team should know…"
        />
      </FormSheet>
    </div>
  );
}
