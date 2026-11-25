"use client";

/**
 * Food Security — Households tab.
 * Household master records with members; prevents duplicate distribution to
 * multiple members of the same family registering independently.
 */

import { useCallback, useEffect, useState } from "react";
import { Home, Plus } from "lucide-react";
import { toast } from "sonner";
import { get, post, patch } from "@/lib/api-client";
import { DataTable } from "@/components/shared/data-table";
import { FormSheet } from "@/components/shared/form-sheet";
import { EmptyState } from "@/components/shared/empty-state";
import { Button } from "@/components/ui/button";
import { FieldGrid, TextField, TextareaField } from "@/components/shared/form-fields";
import { asArray, type Household, type TabProps } from "./shared";

interface FormState {
  name: string; primaryPhone: string; address: string; city: string; pincode: string;
  size: string; childrenCount: string; seniorCount: string; incomeRange: string; notes: string;
}

const EMPTY: FormState = {
  name: "", primaryPhone: "", address: "", city: "", pincode: "",
  size: "1", childrenCount: "0", seniorCount: "0", incomeRange: "", notes: "",
};

export default function HouseholdsTab({ revision, isAdmin }: TabProps) {
  const [rows, setRows] = useState<Household[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Household | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY);
  const [members, setMembers] = useState("");
  const [saving, setSaving] = useState(false);

  const set = (k: keyof FormState) => (v: string) => setForm((f) => ({ ...f, [k]: v }));

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setRows(asArray<Household>(await get("/api/food/households")));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load households");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load, revision]);

  const openCreate = () => {
    setEditing(null);
    setForm(EMPTY);
    setMembers("");
    setOpen(true);
  };

  const openEdit = (h: Household) => {
    setEditing(h);
    setForm({
      name: h.name, primaryPhone: h.primaryPhone ?? "", address: h.address ?? "",
      city: h.city ?? "", pincode: h.pincode ?? "", size: String(h.size),
      childrenCount: String(h.childrenCount), seniorCount: String(h.seniorCount),
      incomeRange: h.incomeRange ?? "", notes: h.notes ?? "",
    });
    setMembers("");
    setOpen(true);
  };

  const save = async () => {
    if (!form.name.trim()) {
      toast.error("Household name is required");
      return;
    }
    setSaving(true);
    try {
      const payload = {
        ...form,
        size: Number(form.size) || 1,
        childrenCount: Number(form.childrenCount) || 0,
        seniorCount: Number(form.seniorCount) || 0,
      };
      if (editing) {
        const addMembers = members.split("\n").map((line) => {
          const [name, age, relation] = line.split(",").map((s) => s.trim());
          return { name, age: age ? Number(age) : undefined, relation };
        }).filter((m) => m.name);
        await patch(`/api/food/households/${editing.id}`, { ...payload, ...(addMembers.length ? { addMembers } : {}) });
      } else {
        const parsed = members.split("\n").map((line) => {
          const [name, age, relation] = line.split(",").map((s) => s.trim());
          return { name, age: age ? Number(age) : undefined, relation };
        }).filter((m) => m.name);
        await post("/api/food/households", { ...payload, members: parsed });
      }
      toast.success(editing ? "Household updated" : "Household created");
      setOpen(false);
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button onClick={openCreate} disabled={!isAdmin}>
          <Plus className="size-4" /> New household
        </Button>
      </div>

      <DataTable
        columns={[
          { key: "code", header: "Code", mono: true, className: "w-32" },
          { key: "name", header: "Household" },
          { key: "size", header: "Members", align: "right" },
          { key: "location", header: "Location", hideBelow: "md" },
          { key: "phone", header: "Phone", hideBelow: "lg" },
          { key: "assistance", header: "Assistances", align: "right", hideBelow: "sm" },
          { key: "actions", header: "" },
        ]}
        rows={rows}
        rowKey={(r) => r.id}
        loading={loading}
        height="auto"
        onRowClick={openEdit}
        empty={
          <EmptyState
            icon={<Home className="size-8" />}
            title="No households recorded"
            hint="Register a household to keep family-level assistance consistent — one household, several beneficiaries."
          />
        }
      >
        {(row, col) => {
          if (col.key === "code") return <span className="font-mono text-xs">{row.code}</span>;
          if (col.key === "name")
            return (
              <div className="min-w-0">
                <p className="truncate font-medium">{row.name}</p>
                <p className="truncate text-xs text-muted-foreground">{row.members?.length ?? 0} linked member(s)</p>
              </div>
            );
          if (col.key === "size") return <span className="text-sm tabular-nums">{row.size}</span>;
          if (col.key === "location") return <span className="text-sm">{row.city ?? "—"} {row.pincode ?? ""}</span>;
          if (col.key === "phone") return <span className="text-sm">{row.primaryPhone ?? "—"}</span>;
          if (col.key === "assistance") return <span className="text-sm tabular-nums">{row._count?.registrations ?? 0}</span>;
          if (col.key === "actions")
            return (
              <Button variant="outline" size="sm" onClick={(e) => { e.stopPropagation(); openEdit(row); }} disabled={!isAdmin}>
                Edit
              </Button>
            );
          return null;
        }}
      </DataTable>

      <FormSheet
        open={open}
        onOpenChange={setOpen}
        title={editing ? `Edit ${editing.code}` : "New household"}
        description="A household groups beneficiaries who receive assistance together. Duplicate-registration prevention uses this record."
        onSubmit={save}
        loading={saving}
        size="lg"
      >
        <div className="space-y-4">
          <FieldGrid>
            <TextField label="Household name" required value={form.name} onChange={set("name")} placeholder="Suresh & family" />
            <TextField label="Primary phone" inputMode="tel" value={form.primaryPhone} onChange={set("primaryPhone")} />
          </FieldGrid>
          <TextareaField label="Address" value={form.address} onChange={set("address")} />
          <FieldGrid cols={3}>
            <TextField label="City" value={form.city} onChange={set("city")} />
            <TextField label="PIN code" inputMode="numeric" value={form.pincode} onChange={set("pincode")} />
            <TextField label="Income range (optional, voluntary)" value={form.incomeRange} onChange={set("incomeRange")} placeholder="Below ₹10,000/month" />
          </FieldGrid>
          <FieldGrid cols={3}>
            <TextField label="Household size" inputMode="numeric" value={form.size} onChange={set("size")} />
            <TextField label="Children" inputMode="numeric" value={form.childrenCount} onChange={set("childrenCount")} />
            <TextField label="Senior citizens" inputMode="numeric" value={form.seniorCount} onChange={set("seniorCount")} />
          </FieldGrid>
          <TextareaField
            label={editing ? "Add members (one per line: name, age, relation)" : "Members (one per line: name, age, relation)"}
            value={members}
            onChange={setMembers}
            placeholder={"Lakshmi, 34, SPOUSE\nAnanya, 7, CHILD"}
          />
          {editing && editing.members && editing.members.length > 0 && (
            <ul className="divide-y rounded-lg border text-sm">
              {editing.members.map((m) => (
                <li key={m.id} className="flex items-center justify-between px-3 py-2">
                  <span>{m.name}</span>
                  <span className="text-xs text-muted-foreground">{m.relation ?? "—"}{m.age ? ` · ${m.age}` : ""}</span>
                </li>
              ))}
            </ul>
          )}
          <TextareaField label="Notes" value={form.notes} onChange={set("notes")} />
        </div>
      </FormSheet>
    </div>
  );
}
