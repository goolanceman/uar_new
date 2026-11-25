"use client";

/**
 * Health Programme — Professionals tab.
 *
 * Roster of doctors / nurses / pharmacists / lab technicians: kind filter
 * tabs, verification-status chips (PENDING queue first), verify/reject via
 * ConfirmDialog, deactivate (PATCH active=false), DetailSheet with
 * credentials + availability, add FormSheet.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Check,
  MoreHorizontal,
  Plus,
  ShieldOff,
  Stethoscope,
  UserRoundCheck,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { get, patch, post } from "@/lib/api-client";
import { formatDate } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { humanize, StatusBadge } from "@/components/shared/status-badge";
import { EmptyState } from "@/components/shared/empty-state";
import { FormSheet } from "@/components/shared/form-sheet";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { DetailGrid, DetailSection, DetailSheet } from "@/components/shared/detail-sheet";
import { DataField } from "@/components/shared/data-field";
import { FieldGrid, FormSection, SelectField, TextField } from "@/components/shared/form-fields";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { ExportMenu, type CsvColumn } from "@/components/shared/csv";
import { DataTable, type DataTableColumn } from "@/components/shared/data-table";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { TabProps } from "./overview";
import {
  asPaged,
  errorText,
  FilterChips,
  OrgSelect,
  PROF_KINDS,
  useDebounced,
  type Professional,
} from "./shared";

const VERIFICATION_FILTERS = ["ALL", "PENDING", "VERIFIED", "REJECTED"];

const KIND_CHIP: Record<string, string> = {
  DOCTOR: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  NURSE: "border-teal-500/30 bg-teal-500/10 text-teal-700 dark:text-teal-300",
  PHARMACIST: "border-pink-500/30 bg-pink-500/10 text-pink-700 dark:text-pink-300",
  LAB_TECH: "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300",
};

const EMPTY_FORM = {
  name: "",
  kind: "",
  orgId: "",
  regNumber: "",
  speciality: "",
  qualification: "",
  phone: "",
  email: "",
  availability: "",
};

export default function ProfessionalsTab({ revision, isAdmin }: TabProps) {
  const [rows, setRows] = useState<Professional[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [query, setQuery] = useState("");
  const q = useDebounced(query.trim());
  const [kind, setKind] = useState("ALL");
  const [verification, setVerification] = useState("ALL");

  const [detailId, setDetailId] = useState<string | null>(null);
  const [detail, setDetail] = useState<Professional | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const [verifyTarget, setVerifyTarget] = useState<{ pro: Professional; next: "VERIFIED" | "REJECTED" } | null>(null);
  const [deactivateTarget, setDeactivateTarget] = useState<Professional | null>(null);
  const [acting, setActing] = useState(false);

  const [newOpen, setNewOpen] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const sp = new URLSearchParams();
      if (q) sp.set("q", q);
      if (kind !== "ALL") sp.set("kind", kind);
      if (verification !== "ALL") sp.set("verificationStatus", verification);
      const d = await get<unknown>(`/api/health-professionals?${sp.toString()}`);
      const list = asPaged<Professional>(d).items.slice();
      list.sort((a, b) => {
        const rank = (p: Professional) =>
          p.verificationStatus === "PENDING" ? 0 : p.active === false ? 2 : 1;
        if (rank(a) !== rank(b)) return rank(a) - rank(b);
        return new Date(b.createdAt ?? 0).getTime() - new Date(a.createdAt ?? 0).getTime();
      });
      setRows(list);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setLoading(false);
    }
  }, [q, kind, verification]);

  useEffect(() => {
    load();
  }, [load, revision]);

  const openDetail = useCallback(async (id: string) => {
    setDetailId(id);
    setDetailLoading(true);
    try {
      const d = await get<Professional>(`/api/health-professionals/${id}`);
      setDetail(d);
    } catch (e) {
      toast.error(errorText(e));
      setDetailId(null);
    } finally {
      setDetailLoading(false);
    }
  }, []);

  const runVerify = async () => {
    if (!verifyTarget) return;
    setActing(true);
    try {
      await patch(`/api/health-professionals/${verifyTarget.pro.id}`, { verificationStatus: verifyTarget.next });
      toast.success(verifyTarget.next === "VERIFIED" ? "Professional verified" : "Verification rejected");
      setVerifyTarget(null);
      setDetailId(null);
      setDetail(null);
      await load();
    } catch (e) {
      toast.error(errorText(e));
    } finally {
      setActing(false);
    }
  };

  const runDeactivate = async () => {
    if (!deactivateTarget) return;
    setActing(true);
    try {
      await patch(`/api/health-professionals/${deactivateTarget.id}`, { active: false });
      toast.success("Professional deactivated");
      setDeactivateTarget(null);
      setDetailId(null);
      setDetail(null);
      await load();
    } catch (e) {
      toast.error(errorText(e));
    } finally {
      setActing(false);
    }
  };

  const create = async () => {
    if (!form.name.trim() || !form.kind) {
      toast.error("Name and kind are required");
      return;
    }
    setSaving(true);
    try {
      await post("/api/health-professionals", {
        name: form.name.trim(),
        kind: form.kind,
        orgId: form.orgId || undefined,
        regNumber: form.regNumber.trim() || undefined,
        speciality: form.speciality.trim() || undefined,
        qualification: form.qualification.trim() || undefined,
        phone: form.phone.trim() || undefined,
        email: form.email.trim() || undefined,
        availability: form.availability.trim() || undefined,
      });
      toast.success("Professional added — pending verification");
      setNewOpen(false);
      setForm(EMPTY_FORM);
      await load();
    } catch (e) {
      toast.error(errorText(e));
    } finally {
      setSaving(false);
    }
  };

  const csv: CsvColumn<Professional>[] = useMemo(
    () => [
      { header: "Name", value: (p) => p.name },
      { header: "Kind", value: (p) => p.kind },
      { header: "Organisation", value: (p) => p.org?.name ?? "" },
      { header: "Reg number", value: (p) => p.regNumber ?? "" },
      { header: "Speciality", value: (p) => p.speciality ?? "" },
      { header: "Qualification", value: (p) => p.qualification ?? "" },
      { header: "Phone", value: (p) => p.phone ?? "" },
      { header: "Email", value: (p) => p.email ?? "" },
      { header: "Availability", value: (p) => p.availability ?? "" },
      { header: "Verification", value: (p) => p.verificationStatus },
      { header: "Active", value: (p) => (p.active === false ? "false" : "true") },
    ],
    []
  );

  const columns: DataTableColumn<Professional>[] = [
    {
      key: "name",
      header: "Professional",
      accessor: (p) => (
        <div className="min-w-0">
          <p className="truncate font-medium">{p.name}</p>
          <p className="truncate text-xs text-muted-foreground">
            {[p.speciality, p.org?.name].filter(Boolean).join(" · ") || "—"}
          </p>
        </div>
      ),
    },
    {
      key: "kind",
      header: "Kind",
      accessor: (p) => (
        <Badge variant="outline" className={KIND_CHIP[p.kind] ?? ""}>
          {humanize(p.kind)}
        </Badge>
      ),
    },
    { key: "reg", header: "Reg. no", mono: true, hideBelow: "md", accessor: (p) => p.regNumber || "—" },
    { key: "verification", header: "Verification", accessor: (p) => <StatusBadge status={p.verificationStatus} /> },
    {
      key: "state",
      header: "State",
      hideBelow: "lg",
      accessor: (p) =>
        p.active === false ? (
          <StatusBadge status="INACTIVE" />
        ) : (
          <span className="text-xs text-muted-foreground">Active</span>
        ),
    },
    {
      key: "actions",
      header: "",
      align: "right",
      className: "w-12",
      accessor: (p) => (
        <div className="flex justify-end" onClick={(e) => e.stopPropagation()}>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="size-8" aria-label={`Actions for ${p.name}`}>
                <MoreHorizontal className="size-4" aria-hidden="true" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuItem onClick={() => openDetail(p.id)}>
                <Stethoscope className="size-4" aria-hidden="true" /> View credentials
              </DropdownMenuItem>
              {isAdmin && p.verificationStatus === "PENDING" ? (
                <>
                  <DropdownMenuItem onClick={() => setVerifyTarget({ pro: p, next: "VERIFIED" })}>
                    <Check className="size-4" aria-hidden="true" /> Verify
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    className="text-red-600 focus:text-red-600 dark:text-red-400 dark:focus:text-red-400"
                    onClick={() => setVerifyTarget({ pro: p, next: "REJECTED" })}
                  >
                    <X className="size-4" aria-hidden="true" /> Reject
                  </DropdownMenuItem>
                </>
              ) : null}
              {isAdmin && p.active !== false ? (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    className="text-red-600 focus:text-red-600 dark:text-red-400 dark:focus:text-red-400"
                    onClick={() => setDeactivateTarget(p)}
                  >
                    <ShieldOff className="size-4" aria-hidden="true" /> Deactivate
                  </DropdownMenuItem>
                </>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      ),
    },
  ];

  const filtersActive = q !== "" || kind !== "ALL" || verification !== "ALL";
  const pendingCount = rows.filter((p) => p.verificationStatus === "PENDING").length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full sm:w-60">
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search professionals…"
            aria-label="Search health professionals"
            className="h-11 sm:h-9"
          />
        </div>
        <FilterChips label="Filter by kind" options={["ALL", ...PROF_KINDS]} value={kind} onChange={setKind} />
        <FilterChips
          label="Filter by verification"
          options={VERIFICATION_FILTERS}
          value={verification}
          onChange={setVerification}
        />
        <span className="text-xs tabular-nums text-muted-foreground" aria-live="polite">
          {loading ? "Loading…" : `${rows.length} professional${rows.length === 1 ? "" : "s"}`}
          {pendingCount > 0 ? ` · ${pendingCount} pending verification` : ""}
        </span>
        <div className="flex flex-wrap items-center gap-2 sm:ml-auto">
          <ExportMenu columns={csv} rows={rows} filename="uar-health-professionals" disabled={rows.length === 0} />
          <Button className="min-h-11 sm:min-h-9" onClick={() => setNewOpen(true)}>
            <Plus className="size-4" aria-hidden="true" /> Add professional
          </Button>
        </div>
      </div>

      {error ? (
        <EmptyState
          icon={<Stethoscope className="size-8" aria-hidden="true" />}
          title="Professionals could not load"
          hint={error}
        >
          <Button variant="outline" size="sm" className="min-h-11" onClick={load}>
            Retry
          </Button>
        </EmptyState>
      ) : (
        <DataTable
          columns={columns}
          rows={rows}
          rowKey={(p) => p.id}
          loading={loading}
          skeletonRows={6}
          height="fill"
          fillOffset={420}
          onRowClick={(p) => openDetail(p.id)}
          itemLabel="professionals"
          empty={
            <EmptyState
              icon={<Stethoscope className="size-8" aria-hidden="true" />}
              title={filtersActive ? "No professionals match these filters" : "No health professionals yet"}
              hint="Add the doctors, nurses, pharmacists and lab technicians who serve at UAR camps. Verification happens here before camps assign them."
            >
              <Button size="sm" className="min-h-11" onClick={() => setNewOpen(true)}>
                <Plus className="size-4" aria-hidden="true" /> Add professional
              </Button>
            </EmptyState>
          }
        />
      )}

      {/* detail sheet */}
      <DetailSheet
        open={!!detailId}
        onOpenChange={(o) => {
          if (!o) {
            setDetailId(null);
            setDetail(null);
          }
        }}
        eyebrow="Health professional"
        title={detail?.name ?? "Professional"}
        description={detail ? [humanize(detail.kind), detail.org?.name].filter(Boolean).join(" · ") : undefined}
        status={detail ? <StatusBadge status={detail.verificationStatus} /> : null}
        loading={detailLoading}
        footer={
          detail && isAdmin && detail.verificationStatus === "PENDING" ? (
            <div className="flex gap-2">
              <Button size="sm" onClick={() => setVerifyTarget({ pro: detail, next: "VERIFIED" })}>
                <UserRoundCheck className="size-3.5" aria-hidden="true" /> Verify
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="text-red-600 hover:bg-red-500/10 dark:text-red-400"
                onClick={() => setVerifyTarget({ pro: detail, next: "REJECTED" })}
              >
                <X className="size-3.5" aria-hidden="true" /> Reject
              </Button>
            </div>
          ) : null
        }
      >
        {detail ? (
          <>
            <DetailSection title="Credentials" description="Registration and speciality details.">
              <DetailGrid cols={3}>
                <DataField label="Name" value={detail.name} />
                <DataField label="Kind" value={humanize(detail.kind)} />
                <DataField label="Registration no." value={detail.regNumber ?? null} mono />
                <DataField label="Speciality" value={detail.speciality ?? null} />
                <DataField label="Qualification" value={detail.qualification ?? null} />
                <DataField label="Organisation" value={detail.org?.name ?? null} />
                <DataField label="Phone" value={detail.phone ?? null} mono />
                <DataField label="Email" value={detail.email ?? null} />
                <DataField label="Added" value={detail.createdAt ? formatDate(detail.createdAt) : null} />
              </DetailGrid>
            </DetailSection>
            <DetailSection title="Availability" description="When this professional can serve at camps.">
              <p className="rounded-lg border bg-muted/30 px-3 py-2.5 text-sm leading-relaxed">
                {detail.availability || "Not specified."}
              </p>
            </DetailSection>
          </>
        ) : null}
      </DetailSheet>

      <ConfirmDialog
        open={!!verifyTarget}
        onOpenChange={(o) => !o && setVerifyTarget(null)}
        title={verifyTarget?.next === "VERIFIED" ? "Verify this professional?" : "Reject this verification?"}
        recordName={verifyTarget ? `${verifyTarget.pro.name} · ${humanize(verifyTarget.pro.kind)}` : null}
        description={
          verifyTarget?.next === "VERIFIED"
            ? "Verified professionals can be assigned to camp duty rosters and consultations."
            : "Rejected professionals cannot be assigned to camps. You can revisit the decision later."
        }
        confirmLabel={verifyTarget?.next === "VERIFIED" ? "Verify" : "Reject"}
        loading={acting}
        onConfirm={runVerify}
      />

      <ConfirmDialog
        open={!!deactivateTarget}
        onOpenChange={(o) => !o && setDeactivateTarget(null)}
        title="Deactivate this professional?"
        recordName={deactivateTarget ? `${deactivateTarget.name} · ${humanize(deactivateTarget.kind)}` : null}
        description="They will no longer appear when assigning camp staff or scheduling appointments. Past records keep their name."
        confirmLabel="Deactivate"
        loading={acting}
        onConfirm={runDeactivate}
      />

      <FormSheet
        open={newOpen}
        onOpenChange={setNewOpen}
        title="Add health professional"
        description="New professionals join the PENDING verification queue."
        size="lg"
        submitLabel="Add professional"
        loading={saving}
        dirty={Object.values(form).some((v) => v !== "")}
        onSubmit={create}
      >
        <FormSection title="Identity">
          <FieldGrid>
            <TextField label="Full name" required value={form.name} onChange={(v) => setForm({ ...form, name: v })} />
            <SelectField
              label="Kind"
              required
              value={form.kind}
              onChange={(v) => setForm({ ...form, kind: v })}
              options={PROF_KINDS.map((k) => ({ value: k, label: humanize(k) }))}
            />
          </FieldGrid>
          <FieldGrid>
            <TextField label="Registration number" value={form.regNumber} onChange={(v) => setForm({ ...form, regNumber: v })} placeholder="Medical council reg." />
            <TextField label="Speciality" value={form.speciality} onChange={(v) => setForm({ ...form, speciality: v })} placeholder="e.g. General Medicine" />
          </FieldGrid>
          <FieldGrid>
            <TextField label="Qualification" value={form.qualification} onChange={(v) => setForm({ ...form, qualification: v })} placeholder="MBBS, MD…" />
            <div>
              <p className="mb-1.5 text-xs font-medium">Linked organisation</p>
              <OrgSelect value={form.orgId} onChange={(v) => setForm({ ...form, orgId: v })} placeholder="Optional — employer" />
            </div>
          </FieldGrid>
        </FormSection>
        <FormSection title="Contact & availability">
          <FieldGrid>
            <TextField label="Phone" value={form.phone} onChange={(v) => setForm({ ...form, phone: v })} inputMode="tel" />
            <TextField label="Email" value={form.email} onChange={(v) => setForm({ ...form, email: v })} inputMode="email" />
          </FieldGrid>
          <TextField
            label="Availability"
            value={form.availability}
            onChange={(v) => setForm({ ...form, availability: v })}
            placeholder="e.g. Weekends, second Saturdays"
          />
        </FormSection>
      </FormSheet>
    </div>
  );
}
