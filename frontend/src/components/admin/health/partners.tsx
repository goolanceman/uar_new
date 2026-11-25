"use client";

/**
 * Health Programme — Partners tab (health organisations).
 *
 * Orgs list (DataTable/grid): type + status filters, search, CSV export,
 * verify workflow (ConfirmDialog → PATCH VERIFIED/REJECTED), DetailSheet with
 * profile, staff list and camp participation, "Add partner" FormSheet
 * (creates as PENDING).
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Building2,
  Check,
  MoreHorizontal,
  Plus,
  ShieldCheck,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { get, patch, post } from "@/lib/api-client";
import { ORG_STATUSES as ORG_STATUS_LIB } from "@/lib/health-orgs";
import { formatDate } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { humanize, StatusBadge } from "@/components/shared/status-badge";
import { EmptyState } from "@/components/shared/empty-state";
import { FormSheet } from "@/components/shared/form-sheet";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { DetailGrid, DetailSection, DetailSheet } from "@/components/shared/detail-sheet";
import { DataField } from "@/components/shared/data-field";
import { FieldGrid, FormSection, SelectField, TextField, TextareaField } from "@/components/shared/form-fields";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { ExportMenu, type CsvColumn } from "@/components/shared/csv";
import { useViewPref, ViewSwitcher } from "@/components/shared/view-switcher";
import { DataTable, type DataTableColumn } from "@/components/shared/data-table";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { TabProps } from "./overview";
import {
  asPaged,
  errorText,
  FilterChips,
  ORG_TYPES,
  useDebounced,
  type HealthOrg,
  type OrgDetail,
} from "./shared";

const ORG_STATUSES: Array<"ALL" | (typeof ORG_STATUS_LIB)[number]> = ["ALL", ...ORG_STATUS_LIB];

const TYPE_CHIP: Record<string, string> = {
  HOSPITAL: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  CLINIC: "border-teal-500/30 bg-teal-500/10 text-teal-700 dark:text-teal-300",
  LAB: "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300",
  PHARMACY: "border-pink-500/30 bg-pink-500/10 text-pink-700 dark:text-pink-300",
  NGO: "border-cyan-500/30 bg-cyan-500/10 text-cyan-700 dark:text-cyan-300",
};

const EMPTY_FORM = {
  name: "",
  type: "",
  city: "",
  phone: "",
  email: "",
  contactPerson: "",
  address: "",
  regNumber: "",
  notes: "",
};

export default function PartnersTab({ revision, isAdmin }: TabProps) {
  const [rows, setRows] = useState<HealthOrg[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [query, setQuery] = useState("");
  const q = useDebounced(query.trim());
  const [type, setType] = useState("ALL");
  const [status, setStatus] = useState("ALL");
  const [view, setView] = useViewPref("health-partners");

  const [detailId, setDetailId] = useState<string | null>(null);
  const [detail, setDetail] = useState<OrgDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const [verifyTarget, setVerifyTarget] = useState<{ org: HealthOrg; next: "VERIFIED" | "REJECTED" } | null>(null);
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
      if (type !== "ALL") sp.set("type", type);
      if (status !== "ALL") sp.set("status", status);
      const d = await get<unknown>(`/api/health-orgs?${sp.toString()}`);
      // PENDING queue first, then newest
      const list = asPaged<HealthOrg>(d).items.slice();
      list.sort((a, b) => {
        const rank = (s: string) => (s === "PENDING" ? 0 : s === "VERIFIED" ? 1 : 2);
        if (rank(a.status) !== rank(b.status)) return rank(a.status) - rank(b.status);
        return new Date(b.createdAt ?? 0).getTime() - new Date(a.createdAt ?? 0).getTime();
      });
      setRows(list);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setLoading(false);
    }
  }, [q, type, status]);

  useEffect(() => {
    load();
  }, [load, revision]);

  const openDetail = useCallback(async (id: string) => {
    setDetailId(id);
    setDetailLoading(true);
    try {
      const d = await get<OrgDetail>(`/api/health-orgs/${id}`);
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
      await patch(`/api/health-orgs/${verifyTarget.org.id}`, { status: verifyTarget.next });
      toast.success(verifyTarget.next === "VERIFIED" ? "Partner verified" : "Partner rejected");
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

  const create = async () => {
    if (!form.name.trim() || !form.type) {
      toast.error("Name and organisation type are required");
      return;
    }
    setSaving(true);
    try {
      await post("/api/health-orgs", {
        name: form.name.trim(),
        type: form.type,
        city: form.city.trim() || undefined,
        phone: form.phone.trim() || undefined,
        email: form.email.trim() || undefined,
        contactPerson: form.contactPerson.trim() || undefined,
        address: form.address.trim() || undefined,
        regNumber: form.regNumber.trim() || undefined,
        notes: form.notes.trim() || undefined,
      });
      toast.success("Partner added — verify after document checks");
      setNewOpen(false);
      setForm(EMPTY_FORM);
      await load();
    } catch (e) {
      toast.error(errorText(e));
    } finally {
      setSaving(false);
    }
  };

  const csv: CsvColumn<HealthOrg>[] = useMemo(
    () => [
      { header: "Name", value: (o) => o.name },
      { header: "Type", value: (o) => o.type },
      { header: "City", value: (o) => o.city ?? "" },
      { header: "Status", value: (o) => o.status },
      { header: "Phone", value: (o) => o.phone ?? "" },
      { header: "Email", value: (o) => o.email ?? "" },
      { header: "Contact person", value: (o) => o.contactPerson ?? "" },
      { header: "Registration no", value: (o) => o.regNumber ?? "" },
      { header: "Added", value: (o) => (o.createdAt ? formatDate(o.createdAt) : "") },
    ],
    []
  );

  const columns: DataTableColumn<HealthOrg>[] = [
    {
      key: "name",
      header: "Organisation",
      accessor: (o) => (
        <div className="min-w-0">
          <p className="truncate font-medium">{o.name}</p>
          <p className="truncate text-xs text-muted-foreground">{[o.city, o.contactPerson].filter(Boolean).join(" · ") || "—"}</p>
        </div>
      ),
    },
    {
      key: "type",
      header: "Type",
      accessor: (o) => (
        <Badge variant="outline" className={TYPE_CHIP[o.type] ?? ""}>
          {humanize(o.type)}
        </Badge>
      ),
    },
    { key: "phone", header: "Phone", mono: true, hideBelow: "md", accessor: (o) => o.phone || "—" },
    { key: "status", header: "Status", accessor: (o) => <StatusBadge status={o.status} /> },
    {
      key: "added",
      header: "Added",
      hideBelow: "lg",
      accessor: (o) => (
        <span className="whitespace-nowrap text-xs text-muted-foreground">{o.createdAt ? formatDate(o.createdAt) : "—"}</span>
      ),
    },
    {
      key: "actions",
      header: "",
      align: "right",
      className: "w-12",
      accessor: (o) => (
        <div className="flex justify-end" onClick={(e) => e.stopPropagation()}>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="size-8" aria-label={`Actions for ${o.name}`}>
                <MoreHorizontal className="size-4" aria-hidden="true" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuItem onClick={() => openDetail(o.id)}>
                <Building2 className="size-4" aria-hidden="true" /> View profile
              </DropdownMenuItem>
              {isAdmin && o.status === "PENDING" ? (
                <>
                  <DropdownMenuItem onClick={() => setVerifyTarget({ org: o, next: "VERIFIED" })}>
                    <Check className="size-4" aria-hidden="true" /> Verify
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    className="text-red-600 focus:text-red-600 dark:text-red-400 dark:focus:text-red-400"
                    onClick={() => setVerifyTarget({ org: o, next: "REJECTED" })}
                  >
                    <X className="size-4" aria-hidden="true" /> Reject
                  </DropdownMenuItem>
                </>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      ),
    },
  ];

  const filtersActive = q !== "" || type !== "ALL" || status !== "ALL";

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full sm:w-60">
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search organisations…"
            aria-label="Search health organisations"
            className="h-11 sm:h-9"
          />
        </div>
        <FilterChips label="Filter by org type" options={["ALL", ...ORG_TYPES]} value={type} onChange={setType} />
        <FilterChips label="Filter by status" options={ORG_STATUSES} value={status} onChange={setStatus} />
        <span className="text-xs tabular-nums text-muted-foreground" aria-live="polite">
          {loading ? "Loading…" : `${rows.length} organisation${rows.length === 1 ? "" : "s"}`}
        </span>
        <div className="flex flex-wrap items-center gap-2 sm:ml-auto">
          <ExportMenu columns={csv} rows={rows} filename="uar-health-partners" disabled={rows.length === 0} />
          <ViewSwitcher value={view} onChange={setView} options={["table", "grid"]} />
          <Button className="min-h-11 sm:min-h-9" onClick={() => setNewOpen(true)}>
            <Plus className="size-4" aria-hidden="true" /> Add partner
          </Button>
        </div>
      </div>

      {error ? (
        <EmptyState
          icon={<Building2 className="size-8" aria-hidden="true" />}
          title="Partners could not load"
          hint={error}
        >
          <Button variant="outline" size="sm" className="min-h-11" onClick={load}>
            Retry
          </Button>
        </EmptyState>
      ) : view === "table" ? (
        <DataTable
          columns={columns}
          rows={rows}
          rowKey={(o) => o.id}
          loading={loading}
          skeletonRows={6}
          height="fill"
          fillOffset={420}
          onRowClick={(o) => openDetail(o.id)}
          itemLabel="organisations"
          empty={
            <EmptyState
              icon={<Building2 className="size-8" aria-hidden="true" />}
              title={filtersActive ? "No organisations match these filters" : "No partner organisations yet"}
              hint="Add the hospitals, clinics, labs and pharmacies UAR camps run with — verification unlocks camp invitations."
            >
              <Button size="sm" className="min-h-11" onClick={() => setNewOpen(true)}>
                <Plus className="size-4" aria-hidden="true" /> Add partner
              </Button>
            </EmptyState>
          }
        />
      ) : loading ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3" aria-busy="true">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-40 rounded-xl" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <EmptyState
          icon={<Building2 className="size-8" aria-hidden="true" />}
          title={filtersActive ? "No organisations match these filters" : "No partner organisations yet"}
          hint="Add the first hospital or clinic partner."
        />
      ) : (
        <div
          className="grid max-h-[36rem] gap-4 overflow-y-auto scrollbar-thin sm:grid-cols-2 xl:grid-cols-3"
          role="list"
          aria-label="Health organisations"
        >
          {rows.map((o) => (
            <div
              key={o.id}
              role="listitem"
              className="flex cursor-pointer flex-col gap-2.5 rounded-xl border bg-card p-4 shadow-sm transition-colors hover:bg-accent/40"
              onClick={() => openDetail(o.id)}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold">{o.name}</p>
                  <p className="truncate text-xs text-muted-foreground">{o.city || "—"}</p>
                </div>
                <StatusBadge status={o.status} />
              </div>
              <div className="flex items-center gap-2">
                <Badge variant="outline" className={TYPE_CHIP[o.type] ?? ""}>
                  {humanize(o.type)}
                </Badge>
                {o.regNumber ? (
                  <span className="truncate font-mono text-[10px] text-muted-foreground/70">{o.regNumber}</span>
                ) : null}
              </div>
              {o.status === "PENDING" && isAdmin ? (
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    className="min-h-9 flex-1"
                    onClick={(e) => {
                      e.stopPropagation();
                      setVerifyTarget({ org: o, next: "VERIFIED" });
                    }}
                  >
                    <ShieldCheck className="size-3.5" aria-hidden="true" /> Verify
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="min-h-9 text-red-600 hover:bg-red-500/10 dark:text-red-400"
                    onClick={(e) => {
                      e.stopPropagation();
                      setVerifyTarget({ org: o, next: "REJECTED" });
                    }}
                  >
                    <X className="size-3.5" aria-hidden="true" /> Reject
                  </Button>
                </div>
              ) : null}
            </div>
          ))}
        </div>
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
        eyebrow="Health partner"
        title={detail?.name ?? "Organisation"}
        description={detail ? [detail.city, detail.contactPerson && `Contact: ${detail.contactPerson}`].filter(Boolean).join(" · ") : undefined}
        status={detail ? <StatusBadge status={detail.status} /> : null}
        loading={detailLoading}
        footer={
          detail && isAdmin && detail.status === "PENDING" ? (
            <div className="flex gap-2">
              <Button size="sm" onClick={() => setVerifyTarget({ org: detail, next: "VERIFIED" })}>
                <Check className="size-3.5" aria-hidden="true" /> Verify partner
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="text-red-600 hover:bg-red-500/10 dark:text-red-400"
                onClick={() => setVerifyTarget({ org: detail, next: "REJECTED" })}
              >
                <X className="size-3.5" aria-hidden="true" /> Reject
              </Button>
            </div>
          ) : null
        }
      >
        {detail ? (
          <>
            <DetailSection title="Profile" description="Registration details as submitted.">
              <DetailGrid cols={3}>
                <DataField label="Type" value={humanize(detail.type)} />
                <DataField label="City" value={detail.city ?? null} />
                <DataField label="Phone" value={detail.phone ?? null} mono />
                <DataField label="Email" value={detail.email ?? null} />
                <DataField label="Contact person" value={detail.contactPerson ?? null} />
                <DataField label="Reg. number" value={detail.regNumber ?? null} mono />
                <DataField label="Address" value={detail.address ?? null} />
                <DataField label="Added" value={detail.createdAt ? formatDate(detail.createdAt) : null} />
                <DataField label="Status" value={<StatusBadge status={detail.status} />} />
              </DetailGrid>
              {detail.notes ? (
                <p className="rounded-lg border bg-muted/30 px-3 py-2.5 text-sm leading-relaxed text-muted-foreground">
                  {detail.notes}
                </p>
              ) : null}
            </DetailSection>

            <DetailSection title="Staff" description="Professionals linked to this organisation.">
              {(detail.staff ?? []).length === 0 ? (
                <p className="text-sm text-muted-foreground">No staff linked yet.</p>
              ) : (
                <ul className="grid gap-2 sm:grid-cols-2">
                  {(detail.staff ?? []).map((s) => (
                    <li key={s.id} className="flex items-center justify-between gap-2 rounded-lg border px-3 py-2">
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium">{s.name}</span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {[s.kind && humanize(s.kind), s.speciality].filter(Boolean).join(" · ") || "—"}
                        </span>
                      </span>
                      {s.verificationStatus ? <StatusBadge status={s.verificationStatus} /> : null}
                    </li>
                  ))}
                </ul>
              )}
            </DetailSection>

            <DetailSection title="Camp participation" description="Camps this partner is invited to or hosts.">
              {(detail.campPartners ?? []).length === 0 ? (
                <p className="text-sm text-muted-foreground">No camp participation yet.</p>
              ) : (
                <ul className="space-y-1.5">
                  {(detail.campPartners ?? []).map((p) => (
                    <li key={p.id} className="flex items-center justify-between gap-2 rounded-lg border px-3 py-2">
                      <span className="truncate text-sm">Camp #{p.orgId?.slice(-6) ?? "—"}</span>
                      <span className="flex items-center gap-2">
                        {p.role ? <Badge variant="outline">{humanize(p.role)}</Badge> : null}
                        <StatusBadge status={p.status ?? "PENDING"} />
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </DetailSection>
          </>
        ) : null}
      </DetailSheet>

      {/* verify confirm */}
      <ConfirmDialog
        open={!!verifyTarget}
        onOpenChange={(o) => !o && setVerifyTarget(null)}
        title={verifyTarget?.next === "VERIFIED" ? "Verify this partner?" : "Reject this partner?"}
        recordName={verifyTarget ? `${verifyTarget.org.name} · ${humanize(verifyTarget.org.type)}` : null}
        description={
          verifyTarget?.next === "VERIFIED"
            ? "Verified partners can be invited to camps and appear in the partner directory."
            : "Rejected partners cannot be invited to camps. You can revisit the decision later."
        }
        confirmLabel={verifyTarget?.next === "VERIFIED" ? "Verify" : "Reject"}
        loading={acting}
        onConfirm={runVerify}
      />

      {/* add partner FormSheet */}
      <FormSheet
        open={newOpen}
        onOpenChange={setNewOpen}
        title="Add partner organisation"
        description="New partners start as PENDING until an admin verifies their credentials."
        size="lg"
        submitLabel="Add partner"
        loading={saving}
        dirty={Object.values(form).some((v) => v !== "")}
        onSubmit={create}
      >
        <FormSection title="Identity">
          <FieldGrid>
            <TextField label="Organisation name" required value={form.name} onChange={(v) => setForm({ ...form, name: v })} placeholder="e.g. Sunrise Multispeciality Hospital" />
            <SelectField
              label="Type"
              required
              value={form.type}
              onChange={(v) => setForm({ ...form, type: v })}
              options={ORG_TYPES.map((t) => ({ value: t, label: humanize(t) }))}
            />
          </FieldGrid>
          <FieldGrid>
            <TextField label="City" value={form.city} onChange={(v) => setForm({ ...form, city: v })} />
            <TextField label="Registration number" value={form.regNumber} onChange={(v) => setForm({ ...form, regNumber: v })} placeholder="Hospital / clinic reg. no" />
          </FieldGrid>
        </FormSection>
        <FormSection title="Contact">
          <FieldGrid>
            <TextField label="Phone" value={form.phone} onChange={(v) => setForm({ ...form, phone: v })} inputMode="tel" />
            <TextField label="Email" value={form.email} onChange={(v) => setForm({ ...form, email: v })} inputMode="email" />
          </FieldGrid>
          <TextField label="Contact person" value={form.contactPerson} onChange={(v) => setForm({ ...form, contactPerson: v })} />
          <TextField label="Address" value={form.address} onChange={(v) => setForm({ ...form, address: v })} />
          <TextareaField label="Notes" value={form.notes} onChange={(v) => setForm({ ...form, notes: v })} placeholder="MOU status, specialties offered…" rows={2} />
        </FormSection>
      </FormSheet>
    </div>
  );
}
