"use client";

/**
 * Food Security — Donation Pickups tab (§7.2 + §18.D).
 * Food donation pledges from the public site: schedule pickup → collect →
 * receive into a traceable FoodBatch (same write path as manual goods
 * receipt) or reject with a reason.
 */

import { useCallback, useEffect, useState } from "react";
import { CalendarClock, CheckCircle2, PackageCheck, PackagePlus, PackageX, Truck } from "lucide-react";
import { toast } from "sonner";
import { get, patch } from "@/lib/api-client";
import { formatDateTime } from "@/lib/format";
import { DataTable } from "@/components/shared/data-table";
import { FormSheet } from "@/components/shared/form-sheet";
import { StatusBadge } from "@/components/shared/status-badge";
import { EmptyState } from "@/components/shared/empty-state";
import { Button } from "@/components/ui/button";
import { FieldGrid, TextField, TextareaField, SelectField } from "@/components/shared/form-fields";
import { asArray, type TabProps } from "./shared";

interface Pledge {
  id: string;
  code: string;
  donorName: string;
  phone: string;
  email?: string | null;
  orgName?: string | null;
  items: string;
  pickupAddress: string;
  city?: string | null;
  pincode?: string | null;
  availability?: string | null;
  storageNotes?: string | null;
  status: string;
  scheduledFor?: string | null;
  assignedToName?: string | null;
  receivedBatchNo?: string | null;
  rejectionReason?: string | null;
  createdAt: string;
}

interface InvItem { id: string; name: string; unit: string; category: string }

export default function PickupsTab({ revision, isAdmin }: TabProps) {
  const [rows, setRows] = useState<Pledge[]>([]);
  const [items, setItems] = useState<InvItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [action, setAction] = useState<{ pledge: Pledge; kind: "schedule" | "receive" | "reject" } | null>(null);
  const [form, setForm] = useState({ scheduledFor: "", assignedToName: "", itemId: "", batchNo: "", quantityReceived: "", expiryDate: "", reason: "" });
  const [busy, setBusy] = useState(false);

  const set = (k: keyof typeof form) => (v: string) => setForm((f) => ({ ...f, [k]: v }));

  const load = useCallback(async () => {
    setLoading(true);
    await Promise.allSettled([
      get<unknown>("/api/food/pledges").then((d) => setRows(asArray<Pledge>(d))).catch(() => setRows([])),
      get<unknown>("/api/inventory").then((d) =>
        setItems(asArray<InvItem>(d).filter((i) => i.category === "FOOD_KIT"))
      ).catch(() => setItems([])),
    ]);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load, revision]);

  const openAction = (pledge: Pledge, kind: "schedule" | "receive" | "reject") => {
    setAction({ pledge, kind });
    setForm({
      scheduledFor: kind === "schedule" ? new Date(Date.now() + 86400000).toISOString().slice(0, 16) : "",
      assignedToName: "",
      itemId: items[0]?.id ?? "",
      batchNo: `PLEDGE-${pledge.code.replace("UAR-FDP-", "")}`,
      quantityReceived: "",
      expiryDate: "",
      reason: "",
    });
  };

  const submit = async () => {
    if (!action) return;
    setBusy(true);
    try {
      const payload: Record<string, unknown> =
        action.kind === "schedule"
          ? { action: "schedule", scheduledFor: form.scheduledFor, assignedToName: form.assignedToName || undefined }
          : action.kind === "receive"
            ? { action: "receive", itemId: form.itemId, batchNo: form.batchNo, quantityReceived: Number(form.quantityReceived), expiryDate: form.expiryDate || undefined }
            : { action: "reject", reason: form.reason };
      await patch(`/api/food/pledges/${action.pledge.id}`, payload);
      toast.success(`Pledge ${action.pledge.code} updated`);
      setAction(null);
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Action failed");
    } finally {
      setBusy(false);
    }
  };

  const pending = rows.filter((r) => r.status === "PENDING").length;
  const scheduled = rows.filter((r) => r.status === "SCHEDULED" || r.status === "COLLECTED").length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-3 text-sm text-muted-foreground">
        <span className="rounded-full bg-amber-500/10 px-3 py-1 text-amber-700 dark:text-amber-400">{pending} awaiting pickup scheduling</span>
        <span className="rounded-full bg-cyan-500/10 px-3 py-1 text-cyan-700 dark:text-cyan-400">{scheduled} in transit</span>
      </div>

      <DataTable
        columns={[
          { key: "code", header: "Ref", mono: true, className: "w-32" },
          { key: "donor", header: "Donor" },
          { key: "items", header: "Items", hideBelow: "md" },
          { key: "pickup", header: "Pickup", hideBelow: "lg" },
          { key: "pickupTime", header: "Scheduled", hideBelow: "sm" },
          { key: "status", header: "Status" },
          { key: "actions", header: "" },
        ]}
        rows={rows}
        rowKey={(r) => r.id}
        loading={loading}
        height="auto"
        empty={
          <EmptyState
            icon={<PackagePlus className="size-8" />}
            title="No food donation pledges yet"
            hint="Pledges from the “Donate groceries” form on the public food page land here."
          />
        }
      >
        {(row, col) => {
          if (col.key === "code") return <span className="font-mono text-xs">{row.code}</span>;
          if (col.key === "donor")
            return (
              <div className="min-w-0">
                <p className="truncate font-medium">{row.donorName}{row.orgName ? ` · ${row.orgName}` : ""}</p>
                <p className="truncate text-xs text-muted-foreground">{row.phone}</p>
              </div>
            );
          if (col.key === "items") return <span className="block max-w-64 truncate text-sm">{row.items}</span>;
          if (col.key === "pickup") return <span className="block max-w-52 truncate text-sm">{row.pickupAddress}{row.city ? `, ${row.city}` : ""}</span>;
          if (col.key === "pickupTime")
            return <span className="text-xs">{row.scheduledFor ? formatDateTime(row.scheduledFor) : row.availability ?? "—"}</span>;
          if (col.key === "status") return <StatusBadge status={row.status} />;
          if (col.key === "actions")
            return (
              <div className="flex flex-wrap justify-end gap-1.5">
                {isAdmin && row.status === "PENDING" && (
                  <Button size="sm" variant="outline" onClick={() => openAction(row, "schedule")}>
                    <CalendarClock className="size-4" /> Schedule
                  </Button>
                )}
                {isAdmin && row.status === "SCHEDULED" && (
                  <Button size="sm" variant="outline" onClick={async () => {
                    try {
                      await patch(`/api/food/pledges/${row.id}`, { action: "collect" });
                      toast.success("Marked collected");
                      load();
                    } catch (e) { toast.error(e instanceof Error ? e.message : "Failed"); }
                  }}>
                    <Truck className="size-4" /> Collected
                  </Button>
                )}
                {isAdmin && ["SCHEDULED", "COLLECTED"].includes(row.status) && (
                  <Button size="sm" onClick={() => openAction(row, "receive")}>
                    <PackageCheck className="size-4" /> Receive
                  </Button>
                )}
                {isAdmin && ["PENDING", "SCHEDULED"].includes(row.status) && (
                  <Button size="sm" variant="ghost" onClick={() => openAction(row, "reject")}>
                    <PackageX className="size-4" />
                  </Button>
                )}
              </div>
            );
          return null;
        }}
      </DataTable>

      <FormSheet
        open={!!action}
        onOpenChange={(o) => !o && setAction(null)}
        title={
          action?.kind === "schedule" ? `Schedule pickup — ${action.pledge.code}`
          : action?.kind === "receive" ? `Receive into stock — ${action.pledge.code}`
          : action ? `Reject pledge — ${action.pledge.code}` : ""
        }
        description={action?.kind === "receive" ? "Creates a traceable food batch, increments master stock and writes the inventory transaction — identical to a manual goods receipt. Quality inspection happens next on the Food Inventory tab." : undefined}
        onSubmit={submit}
        loading={busy}
        size="md"
      >
        {action?.kind === "schedule" && (
          <div className="space-y-4">
            <FieldGrid>
              <TextField label="Pickup date & time" type="datetime-local" required value={form.scheduledFor} onChange={set("scheduledFor")} />
              <TextField label="Assigned to (volunteer / logistics)" value={form.assignedToName} onChange={set("assignedToName")} />
            </FieldGrid>
            <p className="text-sm text-muted-foreground">Donor: {action.pledge.donorName} · {action.pledge.phone} · {action.pledge.pickupAddress}</p>
          </div>
        )}
        {action?.kind === "receive" && (
          <div className="space-y-4">
            <FieldGrid>
              <SelectField label="Inventory item" required value={form.itemId} onChange={set("itemId")}
                options={items.map((i) => ({ value: i.id, label: `${i.name} (${i.unit})` }))} />
              <TextField label="Batch number" required value={form.batchNo} onChange={set("batchNo")} />
            </FieldGrid>
            <FieldGrid cols={2}>
              <TextField label="Quantity received" required inputMode="numeric" value={form.quantityReceived} onChange={set("quantityReceived")} />
              <TextField label="Expiry date" type="date" value={form.expiryDate} onChange={set("expiryDate")} />
            </FieldGrid>
          </div>
        )}
        {action?.kind === "reject" && (
          <TextareaField label="Reason (unsafe, spoiled, unverifiable donor…)" required value={form.reason} onChange={set("reason")} />
        )}
      </FormSheet>
    </div>
  );
}
