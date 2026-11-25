"use client";

/**
 * Camp operations — inner tabs hosted by the camp DetailSheet (camps tab):
 *
 *  - AttendanceOps   check-in desk: beneficiary search + QR/ID/PHONE/MANUAL
 *                    check-in methods, live queue table with status advance
 *                    and no-show action.
 *  - RegistrationsOps register existing beneficiaries, capacity bar,
 *                    confirm/cancel workflow.
 *  - StaffOps        assign professionals to the camp duty roster.
 *  - PartnersOps     invite partner orgs, accept/decline status flow.
 *  - ExpensesOps     per-camp expense ledger with running total.
 */

import { useCallback, useEffect, useState } from "react";
import { Check, Loader2, MoreHorizontal, Plus, ScanLine, X } from "lucide-react";
import { toast } from "sonner";
import { get, patch, post } from "@/lib/api-client";
import { formatDateTime, formatINR } from "@/lib/format";
import { StatusBadge } from "@/components/shared/status-badge";
import { EmptyState } from "@/components/shared/empty-state";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { humanize } from "@/components/shared/status-badge";
import { CapacityBar, BeneficiarySearch, errorText, OrgSelect, ProfessionalSelect, REGISTER_VIA, runMutation } from "./shared";
import { CheckinSearch, QueueTable } from "./camp-attendance";
import { CAMP_STAFF_ACTION_LABELS, CAMP_STAFF_TRANSITIONS } from "@/lib/camp-staff";
import type { AttendanceRow, CampAttendanceSummary, CampDetail, CampPartnerRow, CampStaffRow, ExpenseRow, RegRow } from "./shared";
import { FieldGrid, FormSection, SelectField, TextField } from "@/components/shared/form-fields";
import { FormSheet } from "@/components/shared/form-sheet";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/* ═══════════════════════════ ATTENDANCE OPS ═══════════════════════════ */

export function AttendanceOps({
  camp,
  summary,
  onChanged,
}: {
  camp: CampDetail;
  summary: CampAttendanceSummary | null;
  onChanged: () => void;
}) {
  const [rows, setRows] = useState<AttendanceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [regs, setRegs] = useState<RegRow[]>([]);
  const [method, setMethod] = useState<string>("QR");
  const [checkingIn, setCheckingIn] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [att, regList] = await Promise.all([
        get<unknown>(`/api/camp-attendance?campId=${camp.id}`),
        get<unknown>(`/api/camp-registrations?campId=${camp.id}&limit=200`),
      ]);
      setRows(Array.isArray(att) ? att : ((att as { items?: AttendanceRow[] }).items ?? []));
      const r = regList as { items?: RegRow[] } | RegRow[];
      setRegs(Array.isArray(r) ? r : (r.items ?? []));
    } catch (e) {
      toast.error(errorText(e));
    } finally {
      setLoading(false);
    }
  }, [camp.id]);

  useEffect(() => {
    load();
  }, [load]);

  /** Check the picked beneficiary in with the chosen method (409 → toast). */
  const checkIn = async (registrationId: string) => {
    setCheckingIn(true);
    try {
      await post("/api/camp-attendance", { registrationId, method });
      toast.success("Checked in — token issued");
      await load();
      onChanged();
    } catch (e) {
      toast.error(errorText(e)); // 409 "already checked in" surfaces here
    } finally {
      setCheckingIn(false);
    }
  };

  const advance = async (row: AttendanceRow, status: string) => {
    const ok = await runMutation(
      () => patch(`/api/camp-attendance`, { id: row.id, status }),
      status === "NO_SHOW" ? "Marked as no-show" : `Status → ${status.toLowerCase().replace(/_/g, " ")}`
    );
    if (ok) {
      await load();
      onChanged();
    }
  };

  return (
    <div className="space-y-4">
      {/* Check-in desk */}
      <div className="rounded-xl border bg-muted/30 p-4">
        <p className="mb-2 flex items-center gap-2 text-sm font-semibold">
          <ScanLine className="size-4 text-primary" aria-hidden="true" /> Check-in desk
        </p>
        <CheckinSearch
          regs={regs}
          disabled={checkingIn}
          onCheckIn={(reg) => checkIn(reg.id)}
          method={method}
          onMethodChange={setMethod}
        />
        {summary ? (
          <p className="mt-2 text-xs text-muted-foreground" aria-live="polite">
            {summary.checkedIn} checked in · {summary.waiting} waiting · {summary.inConsultation} in consultation ·{" "}
            {summary.completed} completed
          </p>
        ) : null}
        {checkingIn ? (
          <p className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
            <Loader2 className="size-3 animate-spin" aria-hidden="true" /> Processing check-in…
          </p>
        ) : null}
      </div>

      {/* Queue */}
      <QueueTable rows={rows} loading={loading} onAdvance={advance} />
    </div>
  );
}

/* ══════════════════════════ REGISTRATIONS OPS ══════════════════════════ */

export function RegistrationsOps({
  camp,
  onChanged,
}: {
  camp: CampDetail;
  onChanged: () => void;
}) {
  const [rows, setRows] = useState<RegRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [picked, setPicked] = useState<{ id: string; label: string } | null>(null);
  const [via, setVia] = useState<string>("DESK");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const d = await get<unknown>(`/api/camp-registrations?campId=${camp.id}&limit=200`);
      setRows(Array.isArray(d) ? d : ((d as { items?: RegRow[] }).items ?? []));
    } catch (e) {
      toast.error(errorText(e));
    } finally {
      setLoading(false);
    }
  }, [camp.id]);

  useEffect(() => {
    load();
  }, [load]);

  const register = async () => {
    if (!picked) {
      toast.error("Pick a beneficiary first");
      return;
    }
    setSaving(true);
    try {
      await post("/api/camp-registrations", { campId: camp.id, beneficiaryId: picked.id, registeredVia: via });
      toast.success("Beneficiary registered");
      setPicked(null);
      await load();
      onChanged();
    } catch (e) {
      toast.error(errorText(e)); // duplicates / full capacity arrive as 409
    } finally {
      setSaving(false);
    }
  };

  const setStatus = async (row: RegRow, status: string) => {
    const ok = await runMutation(() => patch(`/api/camp-registrations/${row.id}`, { status }), `Registration ${status.toLowerCase()}`);
    if (ok) {
      await load();
      onChanged();
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-4">
        <CapacityBar used={rows.filter((r) => r.status !== "CANCELLED" && r.status !== "REJECTED").length} total={camp.capacity} />
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
          <div className="min-w-52 flex-1">
            {picked ? (
              <div className="flex items-center justify-between gap-2 rounded-lg border bg-primary/5 px-3 py-2">
                <span className="truncate text-sm font-medium">{picked.label}</span>
                <Button variant="ghost" size="sm" className="h-8 px-2" onClick={() => setPicked(null)} aria-label="Clear selected beneficiary">
                  <X className="size-3.5" aria-hidden="true" />
                </Button>
              </div>
            ) : (
              <BeneficiarySearch compact onPick={(b) => setPicked({ id: b.id, label: b.name })} placeholder="Search beneficiary to register…" />
            )}
          </div>
          <SelectField
            label=""
            value={via}
            onChange={setVia}
            options={REGISTER_VIA.map((v) => ({ value: v, label: humanize(v) }))}
            className="w-36"
          />
          <Button className="min-h-11 sm:min-h-9" onClick={register} disabled={saving || !picked}>
            {saving ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Plus className="size-4" aria-hidden="true" />}
            Register
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="space-y-2" aria-busy="true">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-10 animate-pulse rounded-md bg-muted" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <EmptyState
          icon={<Plus className="size-7" aria-hidden="true" />}
          title="No registrations yet"
          hint="Search for an existing beneficiary above and register them — they get a queue token when they check in on camp day."
        />
      ) : (
        <div className="overflow-hidden rounded-xl border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Code</TableHead>
                <TableHead>Beneficiary</TableHead>
                <TableHead className="hidden sm:table-cell">Phone</TableHead>
                <TableHead className="hidden md:table-cell">Via</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-12 text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => {
                const name = r.beneficiary?.name ?? "—";
                return (
                  <TableRow key={r.id}>
                    <TableCell className="font-mono text-xs">{r.code ?? "—"}</TableCell>
                    <TableCell className="font-medium">{name}</TableCell>
                    <TableCell className="hidden font-mono text-xs text-muted-foreground sm:table-cell">
                      {r.beneficiary?.phone ?? "—"}
                    </TableCell>
                    <TableCell className="hidden text-xs text-muted-foreground md:table-cell">
                      {r.registeredVia ? r.registeredVia.toLowerCase().replace(/_/g, " ") : "—"}
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={r.status} />
                    </TableCell>
                    <TableCell className="text-right">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="size-8" aria-label={`Actions for registration of ${name}`}>
                            <MoreHorizontal className="size-4" aria-hidden="true" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-40">
                          {r.status === "PENDING" ? (
                            <DropdownMenuItem onClick={() => setStatus(r, "CONFIRMED")}>
                              <Check className="size-4" aria-hidden="true" /> Confirm
                            </DropdownMenuItem>
                          ) : null}
                          {r.status !== "CANCELLED" ? (
                            <DropdownMenuItem
                              className="text-red-600 focus:text-red-600 dark:text-red-400 dark:focus:text-red-400"
                              onClick={() => setStatus(r, "CANCELLED")}
                            >
                              <X className="size-4" aria-hidden="true" /> Cancel
                            </DropdownMenuItem>
                          ) : null}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}

/* ══════════════════════════════ STAFF OPS ══════════════════════════════ */

export function StaffOps({
  camp,
  onChanged,
}: {
  camp: CampDetail;
  onChanged: () => void;
}) {
  const [professionalId, setProfessionalId] = useState("");
  const [role, setRole] = useState<string>("DOCTOR");
  const [saving, setSaving] = useState(false);
  const [busyStaffId, setBusyStaffId] = useState<string | null>(null);
  const staff = camp.campStaff ?? [];

  const transition = async (row: CampStaffRow, status: string) => {
    if (busyStaffId !== null) return;
    setBusyStaffId(row.id);
    try {
      await patch(`/api/camp-staff/${row.id}`, { status });
      toast.success(CAMP_STAFF_ACTION_LABELS[status] ?? `Staff status → ${humanize(status)}`);
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not update camp staff status");
    } finally {
      setBusyStaffId(null);
    }
  };

  const assign = async () => {
    if (!professionalId) {
      toast.error("Pick a professional to assign");
      return;
    }
    setSaving(true);
    const ok = await runMutation(
      () => post("/api/camp-staff", { campId: camp.id, professionalId, role }),
      "Professional added to the duty roster"
    );
    setSaving(false);
    if (ok) {
      setProfessionalId("");
      onChanged();
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-2 rounded-xl border bg-muted/30 p-4">
        <div className="min-w-52 flex-1">
          <ProfessionalSelect value={professionalId} onChange={setProfessionalId} placeholder="Assign professional…" />
        </div>
        <SelectField
          label=""
          value={role}
          onChange={setRole}
          options={[
            { value: "DOCTOR", label: "Doctor" },
            { value: "NURSE", label: "Nurse" },
            { value: "PHARMACIST", label: "Pharmacist" },
            { value: "LAB_TECH", label: "Lab technician" },
            { value: "COORDINATOR", label: "Coordinator" },
            { value: "VOLUNTEER", label: "Volunteer" },
          ]}
          className="w-40"
        />
        <Button className="min-h-11 sm:min-h-9" onClick={assign} disabled={saving}>
          {saving ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Plus className="size-4" aria-hidden="true" />}
          Add to roster
        </Button>
      </div>

      {staff.length === 0 ? (
        <EmptyState
          icon={<Plus className="size-7" aria-hidden="true" />}
          title="No staff assigned yet"
          hint="Add doctors, nurses, pharmacists and coordinators so the check-in desk and consultations know who is on duty."
        />
      ) : (
        <ul className="grid gap-2 sm:grid-cols-2" aria-label="Camp staff">
          {staff.map((s) => {
            const status = s.status ?? "ASSIGNED";
            const next = CAMP_STAFF_TRANSITIONS[status] ?? [];
            return (
              <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2.5">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{s.professional?.name ?? "Staff member"}</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {s.professional?.speciality || s.professional?.kind || "—"}
                  </span>
                </span>
                <Badge variant="outline">{s.role ? s.role.replace(/_/g, " ") : "Staff"}</Badge>
                <StatusBadge status={status} />
                {next.map((target) => (
                  <Button
                    key={target}
                    size="sm"
                    variant={target === "WITHDRAWN" ? "ghost" : "outline"}
                    disabled={busyStaffId !== null}
                    onClick={() => void transition(s, target)}
                  >
                    {target === "WITHDRAWN" ? <X className="size-3.5" aria-hidden="true" /> : <Check className="size-3.5" aria-hidden="true" />}
                    {CAMP_STAFF_ACTION_LABELS[target] ?? humanize(target)}
                  </Button>
                ))}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/* ════════════════════════════ PARTNERS OPS ════════════════════════════ */

export function PartnersOps({
  camp,
  onChanged,
}: {
  camp: CampDetail;
  onChanged: () => void;
}) {
  const [rows, setRows] = useState<CampPartnerRow[] | null>(null);
  const [orgId, setOrgId] = useState("");
  const [role, setRole] = useState<string>("SUPPORT");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const d = await get<unknown>(`/api/camp-partners?campId=${camp.id}`);
      setRows(Array.isArray(d) ? d : ((d as { items?: CampPartnerRow[] }).items ?? []));
    } catch (e) {
      toast.error(errorText(e));
      setRows([]);
    }
  }, [camp.id]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  const invite = async () => {
    if (!orgId) {
      toast.error("Pick an organisation to invite");
      return;
    }
    setSaving(true);
    const ok = await runMutation(
      () => post("/api/camp-partners", { campId: camp.id, orgId, role }),
      "Invitation sent to the partner organisation"
    );
    setSaving(false);
    if (ok) {
      setOrgId("");
      await load();
      onChanged();
    }
  };

  const respond = async (row: CampPartnerRow, status: "ACCEPTED" | "DECLINED") => {
    const ok = await runMutation(() => patch(`/api/camp-partners/${row.id}`, { status }), `Invitation ${status.toLowerCase()}`);
    if (ok) {
      await load();
      onChanged();
    }
  };

  const list = rows ?? [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-2 rounded-xl border bg-muted/30 p-4">
        <div className="min-w-52 flex-1">
          <OrgSelect value={orgId} onChange={setOrgId} placeholder="Invite organisation…" />
        </div>
        <SelectField
          label=""
          value={role}
          onChange={setRole}
          options={[
            { value: "HOST", label: "Host" },
            { value: "SUPPORT", label: "Support" },
            { value: "SPONSOR", label: "Sponsor" },
          ]}
          className="w-36"
        />
        <Button className="min-h-11 sm:min-h-9" onClick={invite} disabled={saving}>
          {saving ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Plus className="size-4" aria-hidden="true" />}
          Invite
        </Button>
      </div>

      {rows === null ? (
        <div className="space-y-2" aria-busy="true">
          <div className="h-10 animate-pulse rounded-md bg-muted" />
          <div className="h-10 animate-pulse rounded-md bg-muted" />
        </div>
      ) : list.length === 0 ? (
        <EmptyState
          icon={<Plus className="size-7" aria-hidden="true" />}
          title="No partner invitations yet"
          hint="Invite verified hospitals, clinics, labs or NGOs to host or support this camp."
        />
      ) : (
        <ul className="space-y-2" aria-label="Camp partner invitations">
          {list.map((p) => (
            <li key={p.id} className="flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2.5">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{p.org?.name ?? "Organisation"}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {[p.org?.type, p.role].filter(Boolean).join(" · ")}
                </p>
              </div>
              <StatusBadge status={p.status ?? "PENDING"} />
              {p.status === "PENDING" ? (
                <div className="flex gap-1.5">
                  <Button size="sm" variant="outline" className="min-h-9" onClick={() => respond(p, "ACCEPTED")}>
                    <Check className="size-3.5" aria-hidden="true" /> Accept
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="min-h-9 text-red-600 hover:bg-red-500/10 dark:text-red-400"
                    onClick={() => respond(p, "DECLINED")}
                  >
                    <X className="size-3.5" aria-hidden="true" /> Decline
                  </Button>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* ════════════════════════════ EXPENSES OPS ════════════════════════════ */

export function ExpensesOps({
  camp,
  onChanged,
}: {
  camp: CampDetail;
  onChanged: () => void;
}) {
  const [rows, setRows] = useState<ExpenseRow[] | null>(null);
  const [total, setTotal] = useState<number | null>(null);
  const [open, setOpen] = useState(false);
  const [head, setHead] = useState("");
  const [amount, setAmount] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const d = await get<unknown>(`/api/camp-expenses?campId=${camp.id}`);
      const payload = (d ?? {}) as { items?: ExpenseRow[]; totalAmount?: number };
      setRows(Array.isArray(d) ? d : (payload.items ?? []));
      setTotal(typeof payload.totalAmount === "number" ? payload.totalAmount : null);
    } catch (e) {
      toast.error(errorText(e));
      setRows([]);
    }
  }, [camp.id]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  const save = async () => {
    const amt = Number(amount);
    if (!head.trim() || !Number.isFinite(amt) || amt <= 0) {
      toast.error("Enter an expense head and a positive amount");
      return;
    }
    setSaving(true);
    const ok = await runMutation(
      () => post("/api/camp-expenses", { campId: camp.id, head: head.trim(), amount: amt, notes: notes.trim() || undefined }),
      "Expense recorded"
    );
    setSaving(false);
    if (ok) {
      setOpen(false);
      setHead("");
      setAmount("");
      setNotes("");
      await load();
      onChanged();
    }
  };

  const list = rows ?? [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm">
          <span className="font-semibold tabular-nums">{total === null ? "—" : formatINR(total)}</span>
          <span className="ml-1.5 text-xs text-muted-foreground">total across {list.length} entr{list.length === 1 ? "y" : "ies"}</span>
        </p>
        <Button size="sm" className="min-h-9" onClick={() => setOpen(true)}>
          <Plus className="size-4" aria-hidden="true" /> Add expense
        </Button>
      </div>

      {rows === null ? (
        <div className="space-y-2" aria-busy="true">
          <div className="h-10 animate-pulse rounded-md bg-muted" />
          <div className="h-10 animate-pulse rounded-md bg-muted" />
        </div>
      ) : list.length === 0 ? (
        <EmptyState
          icon={<Plus className="size-7" aria-hidden="true" />}
          title="No expenses recorded"
          hint="Track medicines, consumables, transport and other camp spendings here to keep the camp budget accountable."
        />
      ) : (
        <div className="overflow-hidden rounded-xl border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Head</TableHead>
                <TableHead className="hidden sm:table-cell">Notes</TableHead>
                <TableHead className="hidden md:table-cell">Recorded</TableHead>
                <TableHead className="text-right">Amount</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {list.map((e) => (
                <TableRow key={e.id}>
                  <TableCell className="font-medium">{e.head}</TableCell>
                  <TableCell className="hidden max-w-64 truncate text-xs text-muted-foreground sm:table-cell">
                    {e.notes || "—"}
                  </TableCell>
                  <TableCell className="hidden text-xs text-muted-foreground md:table-cell">
                    {e.createdAt ? formatDateTime(e.createdAt) : "—"}
                  </TableCell>
                  <TableCell className="text-right font-mono tabular-nums">{formatINR(e.amount)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <FormSheet
        open={open}
        onOpenChange={setOpen}
        title="Add camp expense"
        description={`Expense against “${camp.title}” (${camp.code}).`}
        size="sm"
        submitLabel="Record expense"
        loading={saving}
        dirty={!!head.trim() || !!amount.trim() || !!notes.trim()}
        onSubmit={save}
      >
        <FormSection title="Expense" description="One line per spend — add multiple entries as needed.">
          <FieldGrid>
            <TextField label="Head" required value={head} onChange={setHead} placeholder="e.g. Medicines, Transport, Prints" />
            <TextField label="Amount (₹)" required value={amount} onChange={setAmount} inputMode="decimal" placeholder="0" />
          </FieldGrid>
          <TextField label="Notes" value={notes} onChange={setNotes} placeholder="Optional detail for the finance report" />
        </FormSection>
      </FormSheet>
    </div>
  );
}
