"use client";

/**
 * Food Security — Programmes tab.
 * Configurable food programme registry (categories, frequency, eligibility,
 * public visibility, lifecycle). Reuses DataTable + FormSheet + StatusBadge.
 */

import { useCallback, useEffect, useState } from "react";
import { Apple, Plus } from "lucide-react";
import { toast } from "sonner";
import { get, post, patch } from "@/lib/api-client";
import { formatDate, formatINR } from "@/lib/format";
import { DataTable } from "@/components/shared/data-table";
import { FormSheet } from "@/components/shared/form-sheet";
import { StatusBadge } from "@/components/shared/status-badge";
import { EmptyState } from "@/components/shared/empty-state";
import { Button } from "@/components/ui/button";
import { FieldGrid, TextField, TextareaField, SelectField, SwitchField } from "@/components/shared/form-fields";
import { FOOD_PROGRAMME_CATEGORIES, asArray, labelOf, type FoodProgramme, type TabProps } from "./shared";
import { FOOD_PROGRAMME_STATUSES, FOOD_PROGRAMME_TRANSITIONS } from "@/lib/food-workflows";

const FREQUENCIES = [
  { value: "ONE_TIME", label: "One-time" },
  { value: "WEEKLY", label: "Weekly" },
  { value: "MONTHLY", label: "Monthly" },
  { value: "QUARTERLY", label: "Quarterly" },
];

interface FormState {
  title: string;
  description: string;
  category: string;
  frequency: string;
  targetGroup: string;
  geographicCoverage: string;
  budget: string;
  fundraisingTarget: string;
  eligibilityCriteria: string;
  coordinatorName: string;
  coordinatorPhone: string;
  publicVisible: boolean;
  status: string;
}

const EMPTY: FormState = {
  title: "", description: "", category: "GROCERY_KIT", frequency: "ONE_TIME",
  targetGroup: "", geographicCoverage: "", budget: "", fundraisingTarget: "",
  eligibilityCriteria: "", coordinatorName: "", coordinatorPhone: "",
  publicVisible: true, status: "DRAFT",
};

export default function ProgrammesTab({ revision, isAdmin }: TabProps) {
  const [rows, setRows] = useState<FoodProgramme[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<FoodProgramme | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY);
  const [saving, setSaving] = useState(false);

  const set = (k: keyof FormState) => (v: string | boolean) =>
    setForm((f) => ({ ...f, [k]: v }) as FormState);
  const statusOptions = editing
    ? [editing.status, ...(FOOD_PROGRAMME_TRANSITIONS[editing.status] ?? [])]
    : [FOOD_PROGRAMME_STATUSES[0]];

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setRows(asArray<FoodProgramme>(await get("/api/food/programmes")));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load programmes");
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
    setOpen(true);
  };

  const openEdit = (p: FoodProgramme) => {
    setEditing(p);
    setForm({
      title: p.title,
      description: p.description,
      category: p.category,
      frequency: p.frequency,
      targetGroup: p.targetGroup ?? "",
      geographicCoverage: p.geographicCoverage ?? "",
      budget: p.budget != null ? String(p.budget) : "",
      fundraisingTarget: p.fundraisingTarget != null ? String(p.fundraisingTarget) : "",
      eligibilityCriteria: p.eligibilityCriteria ?? "",
      coordinatorName: p.coordinatorName ?? "",
      coordinatorPhone: p.coordinatorPhone ?? "",
      publicVisible: p.publicVisible,
      status: p.status,
    });
    setOpen(true);
  };

  const save = async () => {
    if (!form.title.trim() || !form.description.trim()) {
      toast.error("Title and description are required");
      return;
    }
    setSaving(true);
    try {
      const payload = {
        ...form,
        budget: form.budget ? Number(form.budget) : null,
        fundraisingTarget: form.fundraisingTarget ? Number(form.fundraisingTarget) : null,
      };
      if (editing) await patch(`/api/food/programmes/${editing.id}`, payload);
      else await post("/api/food/programmes", payload);
      toast.success(editing ? "Programme updated" : "Programme created");
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
          <Plus className="size-4" /> New programme
        </Button>
      </div>

      <DataTable
        columns={[
          { key: "code", header: "Code", mono: true, className: "w-32" },
          { key: "title", header: "Programme" },
          { key: "category", header: "Category", hideBelow: "md" },
          { key: "frequency", header: "Frequency", hideBelow: "lg" },
          { key: "budget", header: "Budget", align: "right", hideBelow: "md" },
          { key: "events", header: "Events", align: "right", hideBelow: "sm" },
          { key: "status", header: "Status" },
          { key: "actions", header: "" },
        ]}
        rows={rows}
        rowKey={(r) => r.id}
        loading={loading}
        height="auto"
        empty={
          <EmptyState
            icon={<Apple className="size-8" />}
            title="No food programmes yet"
            hint="Create your first food programme — grocery kits, cooked meals, monthly ration support and more."
          />
        }
      >
        {(row, col) => {
          if (col.key === "code") return <span className="font-mono text-xs">{row.code}</span>;
          if (col.key === "title")
            return (
              <div className="min-w-0">
                <p className="truncate font-medium">{row.title}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {row.startDate ? `From ${formatDate(row.startDate)}` : ""}{row.coordinatorName ? ` · ${row.coordinatorName}` : ""}
                </p>
              </div>
            );
          if (col.key === "category") return <span className="text-sm">{labelOf(FOOD_PROGRAMME_CATEGORIES, row.category)}</span>;
          if (col.key === "frequency") return <span className="text-sm">{labelOf(FREQUENCIES, row.frequency)}</span>;
          if (col.key === "budget") return <span className="text-sm tabular-nums">{row.budget != null ? formatINR(row.budget) : "—"}</span>;
          if (col.key === "events") return <span className="text-sm tabular-nums">{row._count?.events ?? 0}</span>;
          if (col.key === "status") return <StatusBadge status={row.status} />;
          if (col.key === "actions")
            return (
              <Button variant="outline" size="sm" onClick={() => openEdit(row)} disabled={!isAdmin}>
                Manage
              </Button>
            );
          return null;
        }}
      </DataTable>

      <FormSheet
        open={open}
        onOpenChange={setOpen}
        title={editing ? `Edit ${editing.code}` : "New food programme"}
        description="Programmes group distribution events, budgets, eligibility and public visibility. Categories drive the public website copy."
        onSubmit={save}
        loading={saving}
        size="lg"
      >
        <div className="space-y-4">
          <FieldGrid>
            <TextField label="Programme name" required value={form.title} onChange={set("title")} placeholder="Monthly Family Ration Assistance" />
            <SelectField label="Category" value={form.category} onChange={set("category")} options={FOOD_PROGRAMME_CATEGORIES} />
          </FieldGrid>
          <TextareaField label="Description" required value={form.description} onChange={set("description")} placeholder="What this programme delivers, to whom, and how often." />
          <FieldGrid>
            <TextField label="Target group" value={form.targetGroup} onChange={set("targetGroup")} placeholder="Families with children under 5" />
            <TextField label="Geographic coverage" value={form.geographicCoverage} onChange={set("geographicCoverage")} placeholder="Bengaluru Urban" />
          </FieldGrid>
          <FieldGrid cols={3}>
            <SelectField label="Frequency" value={form.frequency} onChange={set("frequency")} options={FREQUENCIES} />
            <TextField label="Budget (₹)" inputMode="decimal" value={form.budget} onChange={set("budget")} />
            <TextField label="Fundraising target (₹)" inputMode="decimal" value={form.fundraisingTarget} onChange={set("fundraisingTarget")} />
          </FieldGrid>
          <TextareaField label="Eligibility criteria" value={form.eligibilityCriteria} onChange={set("eligibilityCriteria")} placeholder="Household income below X, priority to families with seniors…" />
          <FieldGrid>
            <TextField label="Coordinator" value={form.coordinatorName} onChange={set("coordinatorName")} />
            <TextField label="Coordinator phone" inputMode="tel" value={form.coordinatorPhone} onChange={set("coordinatorPhone")} />
          </FieldGrid>
          <FieldGrid>
            <SelectField
              label="Status"
              value={form.status}
              onChange={set("status")}
              options={statusOptions.map((s) => ({ value: s, label: s.replace(/_/g, " ") }))}
            />
            <SwitchField label="Show on public website" checked={form.publicVisible} onChange={set("publicVisible")} />
          </FieldGrid>
        </div>
      </FormSheet>
    </div>
  );
}
