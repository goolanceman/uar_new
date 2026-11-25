"use client";

/**
 * Food Security — Distribution Events tab.
 * Event list + operations detail sheet: lifecycle transitions, package
 * requirements vs live stock, FEFO reservation/issuing, registrations,
 * expenses and the printable QR label. All numbers come from the API —
 * planned/reserved/packed/distributed are separate states.
 */

import { useCallback, useEffect, useState } from "react";
import QRCode from "qrcode";
import {
  CalendarDays, CalendarPlus, PackageCheck, PackagePlus, Plus, Printer, Tent, Users, UtensilsCrossed,
} from "lucide-react";
import { toast } from "sonner";
import { get, post, patch, del } from "@/lib/api-client";
import { formatDate, formatDateTime, formatINR } from "@/lib/format";
import { DataTable } from "@/components/shared/data-table";
import { FormSheet } from "@/components/shared/form-sheet";
import { StatusBadge } from "@/components/shared/status-badge";
import { EmptyState } from "@/components/shared/empty-state";
import { SectionCard } from "@/components/shared/section-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FieldGrid, TextField, TextareaField, SelectField, SwitchField } from "@/components/shared/form-fields";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { asArray, labelOf, FOOD_EVENT_TYPES, FOOD_EVENT_STATUSES, type FoodEvent, type FoodProgramme, type TabProps } from "./shared";
import { FOOD_EVENT_TRANSITIONS } from "@/lib/food-workflows";

// Distribution-day roles — stored in VolunteerTask.description, enforced
// server-side by /api/food/events/:id/volunteers.
const VOLUNTEER_ROLES: Array<{ value: string; label: string }> = [
  { value: "PACKING", label: "Packing" },
  { value: "QUEUE", label: "Queue management" },
  { value: "SERVING", label: "Serving" },
  { value: "DELIVERY", label: "Delivery" },
  { value: "COORDINATION", label: "Coordination" },
];

const NEXT_STATUS_LABEL: Record<string, string> = {
  APPROVED: "Approve", PUBLISHED: "Publish", REGISTRATION_OPEN: "Open registration",
  REGISTRATION_CLOSED: "Close registration", PLANNING: "Start planning",
  STOCK_ALLOCATED: "Mark stock allocated", PACKAGES_PREPARED: "Mark packages prepared",
  READY: "Mark ready", IN_PROGRESS: "Start distribution", COMPLETED: "Complete distribution",
  RECONCILED: "Reconcile stock", CLOSED: "Close event",
  POSTPONED: "Postpone", CANCELLED: "Cancel event", SUSPENDED: "Suspend",
};

interface EventDetail extends FoodEvent {
  programme?: { id: string; code: string; title: string; category: string };
  packageTemplate?: { id: string; name: string; items: string } | null;
  requirements: Array<{ name: string; unit: string | null; qtyPerUnit: number; total: number; itemId: string | null; available: number | null }>;
  progress: { activeRegistrations: number; allocatedUnits: number; reservedUnits: number; issuedUnits: number; distributedUnits: number; shortfall: number; packed: number };
  registrations: Array<{
    id: string; code: string; status: string; unitsAllocated: number; unitsDelivered: number;
    beneficiary: { id: string; code: string; name: string; phone?: string | null };
  }>;
  allocations: Array<{
    id: string; status: string; quantity: number; issuedByName?: string | null;
    batch: { batchNo: string; expiryDate: string | null };
    item: { name: string; unit: string };
  }>;
  expenses: Array<{ id: string; head: string; amount: number; spentAt: string }>;
}

interface EventVolunteer {
  id: string;
  title: string;
  description: string | null;
  status: string;
  scheduledDate: string;
  notes: string | null;
  volunteer: { id: string; code: string; user: { name: string; phone: string | null; email: string | null } };
}

interface AvailableVolunteer { id: string; code: string; name: string; phone: string | null }

interface EventForm {
  programmeId: string; title: string; description: string; eventDate: string;
  startTime: string; endTime: string; venue: string; city: string; address: string;
  eventType: string; packageTemplateId: string; plannedUnits: string; maxCapacity: string;
  coordinatorName: string; registrationDeadline: string; registrationOpen: boolean;
  publicVisible: boolean; specialInstructions: string; budget: string;
}

const emptyForm = (): EventForm => ({
  programmeId: "", title: "", description: "", eventDate: "", startTime: "09:00",
  endTime: "13:00", venue: "", city: "", address: "", eventType: "COMMUNITY",
  packageTemplateId: "", plannedUnits: "0", maxCapacity: "", coordinatorName: "",
  registrationDeadline: "", registrationOpen: true, publicVisible: true,
  specialInstructions: "", budget: "",
});

export default function EventsTab({ revision, isAdmin, onNavigate }: TabProps) {
  const [rows, setRows] = useState<FoodEvent[]>([]);
  const [programmes, setProgrammes] = useState<FoodProgramme[]>([]);
  const [templates, setTemplates] = useState<Array<{ id: string; name: string }>>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("");
  const [cityFilter, setCityFilter] = useState("");
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<EventForm>(emptyForm());
  const [saving, setSaving] = useState(false);
  const [detail, setDetail] = useState<EventDetail | null>(null);
  const [expense, setExpense] = useState({ head: "", amount: "" });
  const [qr, setQr] = useState<string | null>(null);
  const [volunteers, setVolunteers] = useState<EventVolunteer[]>([]);
  const [available, setAvailable] = useState<AvailableVolunteer[]>([]);
  const [assign, setAssign] = useState({ volunteerId: "", role: "" });

  const set = (k: keyof EventForm) => (v: string | boolean) =>
    setForm((f) => ({ ...f, [k]: v }) as EventForm);

  const load = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (statusFilter) params.set("status", statusFilter);
    if (cityFilter) params.set("city", cityFilter);
    if (q.trim()) params.set("q", q.trim());
    const qs = params.toString();
    await Promise.allSettled([
      get<unknown>(`/api/food/events${qs ? `?${qs}` : ""}`).then((d) => setRows(asArray<FoodEvent>(d))).catch(() => setRows([])),
      get<unknown>("/api/food/programmes").then((d) => setProgrammes(asArray<FoodProgramme>(d))).catch(() => setProgrammes([])),
      get<unknown>("/api/kit-templates").then((d) =>
        setTemplates(asArray<{ id: string; name: string; kind?: string }>(d).filter((t) => !t.kind || t.kind === "FOOD" || t.kind === "RATION"))
      ).catch(() => setTemplates([])),
    ]);
    setLoading(false);
  }, [statusFilter, cityFilter, q]);

  useEffect(() => {
    load();
  }, [load, revision]);

  const loadVolunteers = useCallback(async (eventId: string) => {
    get<unknown>(`/api/food/events/${eventId}/volunteers`)
      .then((d) => setVolunteers(asArray<EventVolunteer>(d)))
      .catch(() => setVolunteers([]));
    if (isAdmin)
      get<unknown>(`/api/food/events/${eventId}/volunteers?available=1`)
        .then((d) => setAvailable(asArray<AvailableVolunteer>(d)))
        .catch(() => setAvailable([]));
  }, [isAdmin]);

  const openDetail = async (e: FoodEvent) => {
    try {
      setDetail(await get<EventDetail>(`/api/food/events/${e.id}`));
      setQr(await QRCode.toDataURL(e.code, { margin: 1, width: 160 }));
      loadVolunteers(e.id);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to load event");
    }
  };

  const openCreate = () => {
    setForm(emptyForm());
    setOpen(true);
  };

  const save = async () => {
    if (!form.programmeId || !form.title.trim() || !form.venue.trim() || !form.eventDate) {
      toast.error("Programme, title, venue and date are required");
      return;
    }
    setSaving(true);
    try {
      await post("/api/food/events", {
        ...form,
        plannedUnits: Number(form.plannedUnits) || 0,
        maxCapacity: form.maxCapacity ? Number(form.maxCapacity) : null,
        budget: form.budget ? Number(form.budget) : null,
        registrationDeadline: form.registrationDeadline || null,
        packageTemplateId: form.packageTemplateId || null,
      });
      toast.success("Distribution event created");
      setOpen(false);
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const transition = async (e: FoodEvent, status: string, statusReason?: string) => {
    try {
      await patch(`/api/food/events/${e.id}`, { status, statusReason });
      toast.success(`Event moved to ${status.replace(/_/g, " ").toLowerCase()}`);
      load();
      if (detail?.id === e.id) openDetail(e);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Transition failed");
    }
  };

  const reserveAll = async (e: EventDetail) => {
    const lines = e.requirements
      .filter((r) => r.itemId && r.total > 0)
      .map((r) => ({ itemId: r.itemId as string, quantity: r.total }));
    if (!lines.length) {
      toast.error("No template lines could be matched to inventory items");
      return;
    }
    try {
      await post("/api/food/allocations", { eventId: e.id, lines });
      toast.success("Stock reserved FEFO across inspected batches");
      openDetail(e);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Reservation failed");
    }
  };

  const allocationAction = async (eventId: string, id: string, action: "issue" | "cancel") => {
    try {
      await patch(`/api/food/allocations/${id}`, { action });
      toast.success(action === "issue" ? "Stock issued to packing" : "Reservation released");
      const ev = rows.find((r) => r.id === eventId);
      if (ev) openDetail(ev);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Action failed");
    }
  };

  const addExpense = async () => {
    if (!detail || !expense.head.trim() || !Number(expense.amount)) {
      toast.error("Expense head and amount are required");
      return;
    }
    try {
      await post(`/api/food/events/${detail.id}/expenses`, { head: expense.head, amount: Number(expense.amount) });
      setExpense({ head: "", amount: "" });
      toast.success("Expense recorded");
      openDetail(detail);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to record expense");
    }
  };

  const assignVolunteer = async () => {
    if (!detail || !assign.volunteerId || !assign.role) {
      toast.error("Pick a volunteer and a role to assign");
      return;
    }
    try {
      await post(`/api/food/events/${detail.id}/volunteers`, assign);
      toast.success("Volunteer assigned to this event");
      setAssign({ volunteerId: "", role: "" });
      loadVolunteers(detail.id);
      openDetail(detail);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Assign failed");
    }
  };

  const removeVolunteer = async (taskId: string) => {
    if (!detail) return;
    try {
      await del(`/api/food/events/${detail.id}/volunteers?taskId=${taskId}`);
      toast.success("Volunteer removed from this event");
      loadVolunteers(detail.id);
      openDetail(detail);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Remove failed");
    }
  };

  const nextOptions = (e: FoodEvent) => FOOD_EVENT_TRANSITIONS[e.status] ?? [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div className="flex flex-wrap items-end gap-2">
          <div className="w-44">
            <TextField label="Search" value={q} onChange={setQ} placeholder="Title / code / venue" />
          </div>
          <div className="w-44">
            <SelectField label="Status" value={statusFilter} onChange={setStatusFilter} placeholder="All statuses"
              options={[{ value: "", label: "All statuses" }, ...FOOD_EVENT_STATUSES.map((s) => ({ value: s, label: s.replace(/_/g, " ") }))]} />
          </div>
          <div className="w-40">
            <TextField label="City" value={cityFilter} onChange={setCityFilter} placeholder="All cities" />
          </div>
        </div>
        <Button onClick={openCreate} disabled={!isAdmin}>
          <Plus className="size-4" /> New distribution event
        </Button>
      </div>

      <DataTable
        columns={[
          { key: "code", header: "Code", mono: true, className: "w-32" },
          { key: "title", header: "Event" },
          { key: "date", header: "Date", hideBelow: "sm" },
          { key: "venue", header: "Venue", hideBelow: "md" },
          { key: "type", header: "Type", hideBelow: "lg" },
          { key: "planned", header: "Planned", align: "right", hideBelow: "sm" },
          { key: "registered", header: "Registered", align: "right", hideBelow: "sm" },
          { key: "status", header: "Status" },
          { key: "actions", header: "" },
        ]}
        rows={rows}
        rowKey={(r) => r.id}
        loading={loading}
        height="auto"
        onRowClick={openDetail}
        empty={
          <EmptyState
            icon={<Tent className="size-8" />}
            title="No distribution events"
            hint="Create an event under a programme, pick a package template and the stock maths is done for you."
          >
            <Button onClick={openCreate}><CalendarPlus className="size-4" /> Create event</Button>
          </EmptyState>
        }
      >
        {(row, col) => {
          if (col.key === "code") return <span className="font-mono text-xs">{row.code}</span>;
          if (col.key === "title")
            return (
              <div className="min-w-0">
                <p className="truncate font-medium">{row.title}</p>
                <p className="truncate text-xs text-muted-foreground">{row.programme?.title}</p>
              </div>
            );
          if (col.key === "date") return <span className="text-sm">{formatDate(row.eventDate)}</span>;
          if (col.key === "venue") return <span className="block max-w-52 truncate text-sm">{row.venue}{row.city ? `, ${row.city}` : ""}</span>;
          if (col.key === "type") return <span className="text-sm">{labelOf(FOOD_EVENT_TYPES, row.eventType)}</span>;
          if (col.key === "planned") return <span className="text-sm tabular-nums">{row.plannedUnits}</span>;
          if (col.key === "registered") return <span className="text-sm tabular-nums">{row._count?.registrations ?? 0}{row.maxCapacity ? ` / ${row.maxCapacity}` : ""}</span>;
          if (col.key === "status") return <StatusBadge status={row.status} />;
          if (col.key === "actions")
            return (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm" disabled={!isAdmin}>Operate</Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuLabel>Lifecycle</DropdownMenuLabel>
                  {nextOptions(row).map((s) => (
                    <DropdownMenuItem key={s} onClick={() => transition(row, s)}>
                      {NEXT_STATUS_LABEL[s] ?? s}
                    </DropdownMenuItem>
                  ))}
                  {nextOptions(row).length > 0 && <DropdownMenuSeparator />}
                  <DropdownMenuItem onClick={() => openDetail(row)}>Open operations desk</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            );
          return null;
        }}
      </DataTable>

      {/* ── create sheet ── */}
      <FormSheet open={open} onOpenChange={setOpen} title="New distribution event" description="Every event belongs to a food programme and can draw stock from inspected food batches." onSubmit={save} loading={saving} size="lg">
        <div className="space-y-4">
          <FieldGrid>
            <SelectField label="Food programme" required value={form.programmeId} onChange={set("programmeId")}
              options={programmes.map((p) => ({ value: p.id, label: `${p.code} — ${p.title}` }))} />
            <SelectField label="Event type" value={form.eventType} onChange={set("eventType")} options={FOOD_EVENT_TYPES} />
          </FieldGrid>
          <FieldGrid>
            <TextField label="Event name" required value={form.title} onChange={set("title")} placeholder="Ramadan food kit distribution — Whitefield" />
            <TextField label="Budget (₹)" inputMode="decimal" value={form.budget} onChange={set("budget")} />
          </FieldGrid>
          <TextareaField label="Description" value={form.description} onChange={set("description")} />
          <FieldGrid cols={3}>
            <TextField label="Date" type="date" required value={form.eventDate} onChange={set("eventDate")} />
            <TextField label="Start time" type="time" value={form.startTime} onChange={set("startTime")} />
            <TextField label="End time" type="time" value={form.endTime} onChange={set("endTime")} />
          </FieldGrid>
          <FieldGrid>
            <TextField label="Venue" required value={form.venue} onChange={set("venue")} placeholder="Community Hall, Peenya" />
            <TextField label="City" value={form.city} onChange={set("city")} />
          </FieldGrid>
          <TextField label="Exact address (admin-only — never shown publicly)" value={form.address} onChange={set("address")} />
          <FieldGrid>
            <SelectField label="Package template" value={form.packageTemplateId} onChange={set("packageTemplateId")}
              options={[{ value: "", label: "— none —" }, ...templates.map((t) => ({ value: t.id, label: t.name }))]} />
            <TextField label="Registration deadline" type="date" value={form.registrationDeadline} onChange={set("registrationDeadline")} />
          </FieldGrid>
          <FieldGrid cols={3}>
            <TextField label="Planned packages" inputMode="numeric" value={form.plannedUnits} onChange={set("plannedUnits")} />
            <TextField label="Max registrations" inputMode="numeric" value={form.maxCapacity} onChange={set("maxCapacity")} />
            <TextField label="Coordinator" value={form.coordinatorName} onChange={set("coordinatorName")} />
          </FieldGrid>
          <TextareaField label="Special instructions" value={form.specialInstructions} onChange={set("specialInstructions")} />
          <FieldGrid>
            <SwitchField label="Open for registration" checked={form.registrationOpen} onChange={set("registrationOpen")} />
            <SwitchField label="Show on public website" checked={form.publicVisible} onChange={set("publicVisible")} />
          </FieldGrid>
        </div>
      </FormSheet>

      {/* ── operations detail sheet ── */}
      <FormSheet
        open={!!detail}
        onOpenChange={(o) => !o && setDetail(null)}
        title={detail ? `${detail.code} — ${detail.title}` : ""}
        description={detail ? `${formatDate(detail.eventDate)}${detail.startTime ? ` · ${detail.startTime}${detail.endTime ? `–${detail.endTime}` : ""}` : ""} · ${detail.venue}` : ""}
        badge={detail ? <StatusBadge status={detail.status} /> : null}
        size="xl"
        footerExtra={
          detail && qr ? (
            <Button variant="outline" size="sm" onClick={() => window.open(qr, "_blank")}>
              <Printer className="size-4" /> QR label
            </Button>
          ) : null
        }
      >
        {detail && (
          <Tabs defaultValue="stock" className="space-y-4">
            <TabsList className="flex w-full overflow-x-auto">
              <TabsTrigger value="stock" className="shrink-0 gap-1.5"><PackageCheck className="size-4" /> Stock & packing</TabsTrigger>
              <TabsTrigger value="registrations" className="shrink-0 gap-1.5"><CalendarDays className="size-4" /> Registrations ({detail.progress.activeRegistrations})</TabsTrigger>
              <TabsTrigger value="expenses" className="shrink-0 gap-1.5"><UtensilsCrossed className="size-4" /> Expenses</TabsTrigger>
              <TabsTrigger value="volunteers" className="shrink-0 gap-1.5"><Users className="size-4" /> Volunteers ({volunteers.filter((v) => v.status !== "CANCELLED").length})</TabsTrigger>
            </TabsList>

            <TabsContent value="stock" className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-4">
                {[
                  ["Allocated units", detail.progress.allocatedUnits],
                  ["Reserved", detail.progress.reservedUnits],
                  ["Packed (issued)", detail.progress.packed],
                  ["Distributed", detail.progress.distributedUnits],
                ].map(([label, v]) => (
                  <div key={label as string} className="rounded-lg border bg-muted/30 p-3 text-center">
                    <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
                    <p className="text-xl font-bold tabular-nums">{v as number}</p>
                  </div>
                ))}
              </div>
              {detail.progress.shortfall > 0 && (
                <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-400">
                  Shortfall: {detail.progress.shortfall} more unit(s) of stock needed for the allocated registrations — reserve additional batches or increase stock.
                </p>
              )}

              <SectionCard
                title="Required stock (from package template)"
                description={detail.packageTemplate ? `${detail.packageTemplate.name} × ${detail.plannedUnits} planned packages` : "No package template selected"}
                icon={<PackagePlus className="size-4" />}
                actions={
                  isAdmin && detail.requirements.some((r) => r.itemId) ? (
                    <Button size="sm" onClick={() => reserveAll(detail)}>Reserve FEFO</Button>
                  ) : null
                }
              >
                <ul className="divide-y px-5 pb-4">
                  {detail.requirements.length === 0 && (
                    <li className="py-3 text-sm text-muted-foreground">Pick a package template to auto-calculate required stock.</li>
                  )}
                  {detail.requirements.map((r) => (
                    <li key={r.name} className="flex items-center justify-between gap-3 py-2">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{r.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {r.qtyPerUnit}{r.unit ? ` ${r.unit}` : ""} per package × {detail.plannedUnits}
                          {r.itemId === null ? " · not linked to an inventory item" : r.available != null && r.available < r.total ? ` · only ${r.available} in stock` : ""}
                        </p>
                      </div>
                      <span className={`shrink-0 text-sm font-semibold tabular-nums ${r.itemId && r.available != null && r.available < r.total ? "text-destructive" : ""}`}>
                        {r.total}{r.unit ? ` ${r.unit}` : ""}
                      </span>
                    </li>
                  ))}
                </ul>
              </SectionCard>

              <SectionCard title="Batch allocations" description="FEFO across inspected, unexpired batches" icon={<PackageCheck className="size-4" />}>
                {detail.allocations.length === 0 ? (
                  <EmptyState icon={<PackagePlus className="size-8" />} title="No stock reserved yet" className="border-0" />
                ) : (
                  <ul className="divide-y px-5 pb-4">
                    {detail.allocations.map((a) => (
                      <li key={a.id} className="flex flex-wrap items-center gap-2 py-2">
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium">{a.item.name} × {a.quantity} {a.item.unit}</p>
                          <p className="text-xs text-muted-foreground">
                            Batch {a.batch.batchNo}
                            {a.batch.expiryDate ? ` · expires ${formatDate(a.batch.expiryDate)}` : ""}
                            {a.issuedByName ? ` · issued by ${a.issuedByName}` : ""}
                          </p>
                        </div>
                        <StatusBadge status={a.status} />
                        {isAdmin && a.status === "RESERVED" && (
                          <>
                            <Button size="sm" onClick={() => allocationAction(detail.id, a.id, "issue")}>Issue</Button>
                            <Button size="sm" variant="outline" onClick={() => allocationAction(detail.id, a.id, "cancel")}>Release</Button>
                          </>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </SectionCard>
            </TabsContent>

            <TabsContent value="registrations" className="space-y-3">
              {detail.registrations.length === 0 ? (
                <EmptyState icon={<CalendarDays className="size-8" />} title="No beneficiaries registered" hint="Allocate beneficiaries from the Registrations tab." className="border-0" />
              ) : (
                <ul className="divide-y rounded-lg border">
                  {detail.registrations.map((r) => (
                    <li key={r.id} className="flex items-center gap-3 p-3">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{r.beneficiary?.name} <span className="font-mono text-xs text-muted-foreground">{r.code}</span></p>
                        <p className="text-xs text-muted-foreground">
                          {r.unitsAllocated} unit(s){r.unitsDelivered ? ` · delivered ${r.unitsDelivered}` : ""}
                          {r.beneficiary?.phone ? ` · ${r.beneficiary.phone}` : ""}
                        </p>
                      </div>
                      <StatusBadge status={r.status} />
                    </li>
                  ))}
                </ul>
              )}
              <Button variant="outline" onClick={() => onNavigate?.("registrations")}>Open registration desk</Button>
            </TabsContent>

            <TabsContent value="expenses" className="space-y-3">
              {isAdmin && (
                <div className="flex flex-wrap items-end gap-2">
                  <div className="min-w-40 flex-1">
                    <TextField label="Head" value={expense.head} onChange={(v) => setExpense((e) => ({ ...e, head: v }))} placeholder="Transport / packaging / purchase" />
                  </div>
                  <div className="w-32">
                    <TextField label="Amount (₹)" inputMode="decimal" value={expense.amount} onChange={(v) => setExpense((e) => ({ ...e, amount: v }))} />
                  </div>
                  <Button onClick={addExpense}>Add</Button>
                </div>
              )}
              {detail.expenses.length === 0 ? (
                <EmptyState icon={<UtensilsCrossed className="size-8" />} title="No expenses recorded" className="border-0" />
              ) : (
                <ul className="divide-y rounded-lg border">
                  {detail.expenses.map((x) => (
                    <li key={x.id} className="flex items-center justify-between p-3 text-sm">
                      <span>{x.head}</span>
                      <span className="font-medium tabular-nums">{formatINR(x.amount)} <span className="text-xs text-muted-foreground">· {formatDateTime(x.spentAt)}</span></span>
                    </li>
                  ))}
                </ul>
              )}
            </TabsContent>
            <TabsContent value="volunteers" className="space-y-3">
              {isAdmin && (
                <div className="flex flex-wrap items-end gap-2">
                  <div className="min-w-52 flex-1">
                    <SelectField label="Volunteer" value={assign.volunteerId} onChange={(v) => setAssign((a) => ({ ...a, volunteerId: v }))}
                      placeholder="Select volunteer…"
                      options={available.map((v) => ({ value: v.id, label: `${v.code} — ${v.name}` }))} />
                  </div>
                  <div className="w-44">
                    <SelectField label="Role" value={assign.role} onChange={(v) => setAssign((a) => ({ ...a, role: v }))}
                      placeholder="Select role…" options={VOLUNTEER_ROLES} />
                  </div>
                  <Button onClick={assignVolunteer}>Assign</Button>
                </div>
              )}
              {volunteers.length === 0 ? (
                <EmptyState icon={<Users className="size-8" />} title="No volunteers assigned" hint="Assign volunteers so they can check in beneficiaries at this event's distribution desk." className="border-0" />
              ) : (
                <ul className="divide-y rounded-lg border">
                  {volunteers.map((t) => (
                    <li key={t.id} className="flex flex-wrap items-center gap-3 p-3">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">
                          {t.volunteer.user.name} <span className="font-mono text-xs text-muted-foreground">{t.volunteer.code}</span>
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {t.scheduledDate ? `Shift ${formatDate(t.scheduledDate)}` : "Shift —"}
                          {t.volunteer.user.phone ? ` · ${t.volunteer.user.phone}` : ""}
                        </p>
                      </div>
                      <span className="text-sm">{VOLUNTEER_ROLES.find((r) => r.value === t.description)?.label ?? t.description ?? "—"}</span>
                      <StatusBadge status={t.status} />
                      {isAdmin && t.status !== "CANCELLED" && (
                        <Button size="sm" variant="outline" onClick={() => removeVolunteer(t.id)}>Remove</Button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </TabsContent>
          </Tabs>
        )}
      </FormSheet>
    </div>
  );
}
