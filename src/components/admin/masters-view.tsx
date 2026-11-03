"use client";

/**
 * Masters (MDM) — round-5: DataTable with inline label/sort/active editing,
 * full-screen DetailSheet per entry (fields + category preview with
 * sort/order/active state), FormSheet (sm) for add-entry, shared
 * ConfirmDialog for deletes and the bulk-import FormSheet.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  FolderTree,
  Info,
  Loader2,
  Plus,
  RefreshCw,
  ShieldCheck,
  Tag,
  Trash2,
  Upload,
} from "lucide-react";
import { toast } from "sonner";
import { del, get, patch, post } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { titleCase } from "@/lib/format";
import { downloadCsv, ExportMenu, type CsvColumn } from "@/components/shared/csv";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { FormSheet } from "@/components/shared/form-sheet";
import {
  FieldGrid,
  FormSection,
  SelectField,
  TextField,
  TextareaField,
} from "@/components/shared/form-fields";
import {
  DataTable,
  type DataTableColumn,
} from "@/components/shared/data-table";
import {
  DetailGrid,
  DetailSection,
  DetailSheet,
} from "@/components/shared/detail-sheet";
import { DataField } from "@/components/shared/data-field";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { EmptyState } from "@/components/shared/empty-state";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Switch } from "@/components/ui/switch";

/* ------------------------------ types & helpers ----------------------------- */

interface MasterEntry {
  id: string;
  category: string;
  value: string;
  label: string;
  sortOrder: number;
  active: boolean;
}

interface ImportResult {
  line: number;
  value: string;
  ok: boolean;
  message: string;
}

interface ParsedLine {
  value: string;
  label: string;
  sortOrder: number;
}

interface AddFormState {
  category: string;
  newCategory: string;
  value: string;
  label: string;
  sortOrder: string;
}

const EMPTY_ADD: AddFormState = { category: "", newCategory: "", value: "", label: "", sortOrder: "0" };

/** Where each registry surfaces in the product — shown as a hint per tab. */
const USAGE_HINTS: Record<string, string> = {
  CITY: "Fills city dropdowns across onboarding forms",
  SKILL: "Volunteer skill chips and the application form",
  AVAILABILITY: "Volunteer availability options on applications",
  CONDITION: "Adopt-a-Medicine patient condition filter",
  ANIMAL_SPECIES: "Animal welfare forms and species filters",
  AMBULANCE_TYPE: "Ambulance fleet registration",
  EMERGENCY_TYPE: "Green-corridor mission requests",
  INVENTORY_CATEGORY: "Inventory item categories",
  UNIT: "Kit templates and inventory units",
  BENEFICIARY_CATEGORY: "Beneficiary onboarding categories",
  DISTRIBUTION_TYPE: "Distribution record types",
  TASK_TYPE: "Volunteer task types",
  DONATION_CATEGORY: "Donation categories on the donate flow",
};

function usageHint(category: string): string {
  return USAGE_HINTS[category] ?? "Used across forms that reference this registry";
}

/** Parses "value,label,sortOrder" lines; label and sortOrder are optional. */
function parseImportLines(text: string): { rows: ParsedLine[]; errors: string[] } {
  const rows: ParsedLine[] = [];
  const errors: string[] = [];
  text.split(/\r?\n/).forEach((raw, i) => {
    const line = raw.trim();
    if (!line) return;
    const parts = line.split(",").map((s) => s.trim());
    const value = parts[0] ?? "";
    if (!value) {
      errors.push(`Line ${i + 1}: value is required`);
      return;
    }
    const label = parts[1] || value;
    const sortOrderRaw = parts[2];
    const sortOrder = sortOrderRaw ? Math.trunc(Number(sortOrderRaw)) || 0 : 0;
    rows.push({ value, label, sortOrder });
  });
  return { rows, errors };
}

/* ---------------------------------- view ----------------------------------- */

export default function MastersView() {
  const [entries, setEntries] = useState<MasterEntry[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [selected, setSelected] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // inline drafts
  const [labelDrafts, setLabelDrafts] = useState<Record<string, string>>({});
  const [sortDrafts, setSortDrafts] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);

  // add entry sheet (FormSheet sm)
  const [addOpen, setAddOpen] = useState(false);
  const [addForm, setAddForm] = useState<AddFormState>({ ...EMPTY_ADD });

  // bulk import
  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState("");
  const [importing, setImporting] = useState(false);
  const [importResults, setImportResults] = useState<ImportResult[]>([]);

  const [deleteTarget, setDeleteTarget] = useState<MasterEntry | null>(null);
  const [detailTarget, setDetailTarget] = useState<MasterEntry | null>(null);

  // pagination over the selected category
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  /* -------------------------------- loading ------------------------------- */

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [cats, all] = await Promise.all([
        get<unknown>("/api/masters?categories=1"),
        get<MasterEntry[] | { items?: MasterEntry[] }>("/api/masters?all=1"),
      ]);

      const list: MasterEntry[] = Array.isArray(all) ? all : ((all as { items?: MasterEntry[] })?.items ?? []);
      setEntries(list);

      const names = new Set<string>();
      if (Array.isArray(cats)) {
        for (const c of cats as unknown[]) {
          if (typeof c === "string") names.add(c);
          else if (c && typeof c === "object") {
            const name = (c as Record<string, unknown>).category;
            if (typeof name === "string") names.add(name);
          }
        }
      }
      for (const e of list) names.add(e.category);
      const catList = Array.from(names).sort();
      setCategories(catList);
      setSelected((prev) => (prev && catList.includes(prev) ? prev : catList[0] ?? ""));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load master data");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const selectedEntries = useMemo(
    () =>
      entries
        .filter((e) => e.category === selected)
        .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.label.localeCompare(b.label)),
    [entries, selected]
  );

  useEffect(() => {
    setPage(1);
  }, [selected, pageSize]);

  const pages = Math.max(1, Math.ceil(selectedEntries.length / pageSize));
  const pageSafe = Math.min(page, pages);
  const paged = useMemo(
    () => selectedEntries.slice((pageSafe - 1) * pageSize, pageSafe * pageSize),
    [selectedEntries, pageSafe, pageSize]
  );

  const parsedImport = useMemo(() => parseImportLines(importText), [importText]);

  /* ------------------------------- mutations ------------------------------ */

  const saveLabel = async (entry: MasterEntry) => {
    const draft = labelDrafts[entry.id];
    if (draft === undefined || draft.trim() === "" || draft === entry.label) return;
    setBusyId(entry.id);
    try {
      await patch(`/api/masters/${entry.id}`, { label: draft.trim() });
      setEntries((prev) => prev.map((e) => (e.id === entry.id ? { ...e, label: draft.trim() } : e)));
      toast.success("Label updated");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to update label");
    } finally {
      setBusyId(null);
    }
  };

  const saveSortOrder = async (entry: MasterEntry) => {
    const draft = sortDrafts[entry.id];
    if (draft === undefined || draft.trim() === "" || Number(draft) === entry.sortOrder) return;
    const n = Math.trunc(Number(draft));
    if (!Number.isFinite(n)) {
      toast.error("Sort order must be a whole number");
      return;
    }
    setBusyId(entry.id);
    try {
      await patch(`/api/masters/${entry.id}`, { sortOrder: n });
      setEntries((prev) => prev.map((e) => (e.id === entry.id ? { ...e, sortOrder: n } : e)));
      toast.success("Sort order updated");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to update sort order");
    } finally {
      setBusyId(null);
    }
  };

  const toggleActive = async (entry: MasterEntry, active: boolean) => {
    setBusyId(entry.id);
    try {
      await patch(`/api/masters/${entry.id}`, { active });
      setEntries((prev) => prev.map((e) => (e.id === entry.id ? { ...e, active } : e)));
      toast.success(active ? `“${entry.label}” activated` : `“${entry.label}” deactivated — it disappears from dropdowns`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to update entry");
    } finally {
      setBusyId(null);
    }
  };

  const addDirty =
    addOpen &&
    (addForm.category !== "" ||
      addForm.newCategory !== "" ||
      addForm.value.trim() !== "" ||
      addForm.label.trim() !== "" ||
      addForm.sortOrder !== "0");

  const addEntry = async () => {
    const category = addForm.category === "__new__" ? addForm.newCategory.trim().toUpperCase().replace(/\s+/g, "_") : addForm.category;
    if (!category) {
      toast.error("Choose or enter a category");
      return;
    }
    if (!addForm.value.trim() || !addForm.label.trim()) {
      toast.error("Value and label are required");
      return;
    }
    const sortOrder = Math.trunc(Number(addForm.sortOrder)) || 0;
    setSaving(true);
    try {
      await post("/api/masters", {
        category,
        value: addForm.value.trim(),
        label: addForm.label.trim(),
        sortOrder,
      });
      toast.success(`“${addForm.label.trim()}” added to ${titleCase(category)}`);
      setAddOpen(false);
      setAddForm({ ...EMPTY_ADD });
      await load();
      setSelected(category);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to add entry");
    } finally {
      setSaving(false);
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setSaving(true);
    try {
      await del(`/api/masters/${deleteTarget.id}`);
      toast.success(`“${deleteTarget.label}” deleted`);
      setDeleteTarget(null);
      setDetailTarget((d) => (d && d.id === deleteTarget.id ? null : d));
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to delete entry");
    } finally {
      setSaving(false);
    }
  };

  /* ----------------------------- export / import --------------------------- */

  const masterCsv: CsvColumn<MasterEntry>[] = useMemo(
    () => [
      { header: "value", value: (e) => e.value },
      { header: "label", value: (e) => e.label },
      { header: "sortOrder", value: (e) => e.sortOrder },
      { header: "active", value: (e) => (e.active ? "1" : "0") },
    ],
    []
  );

  const openImport = () => {
    setImportText("");
    setImportResults([]);
    setImportOpen(true);
  };

  const runImport = async () => {
    const { rows } = parsedImport;
    if (!selected) {
      toast.error("Choose a category first");
      return;
    }
    if (rows.length === 0) {
      toast.error("Nothing to import — add lines like value,label,sortOrder");
      return;
    }
    setImporting(true);
    setImportResults([]);
    const results: ImportResult[] = [];
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      try {
        await post("/api/masters", {
          category: selected,
          value: r.value,
          label: r.label,
          sortOrder: r.sortOrder,
        });
        results.push({ line: i + 1, value: r.value, ok: true, message: "Imported" });
      } catch (e) {
        const message = e instanceof Error ? e.message : "Failed";
        results.push({ line: i + 1, value: r.value, ok: false, message });
        toast.error(`Row ${i + 1} (${r.value}): ${message}`);
      }
      setImportResults([...results]);
    }
    setImporting(false);
    const okCount = results.filter((r) => r.ok).length;
    const failCount = results.length - okCount;
    if (failCount === 0) {
      toast.success(`Imported ${okCount} ${okCount === 1 ? "entry" : "entries"} into ${titleCase(selected)}`);
    } else {
      toast.warning(`${okCount} imported · ${failCount} failed`);
    }
    await load();
  };

  /* ------------------------------- table cols ------------------------------ */

  const columns: DataTableColumn<MasterEntry>[] = [
    { key: "label", header: "Label", className: "min-w-44" },
    { key: "value", header: "Value", mono: true, hideBelow: "sm" },
    { key: "sortOrder", header: "Sort", align: "right" },
    { key: "active", header: "Active", hideBelow: "md" },
    { key: "actions", header: "", align: "right", className: "w-12" },
  ];

  const detailSiblings = useMemo(() => {
    if (!detailTarget) return [];
    return entries
      .filter((e) => e.category === detailTarget.category)
      .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.label.localeCompare(b.label));
  }, [entries, detailTarget]);

  return (
    <div className="space-y-4 sm:space-y-6">
      <PageHeader
        title="Masters (MDM)"
        description="Single source of truth for every dropdown in the product."
        icon={<ShieldCheck className="size-5" aria-hidden="true" />}
        actions={
          <Button
            onClick={() => {
              setAddForm({ ...EMPTY_ADD, category: selected || categories[0] || "__new__" });
              setAddOpen(true);
            }}
            disabled={!selected}
            aria-label={`Add entry to ${selected}`}
          >
            <Plus className="size-4" /> Add entry
          </Button>
        }
      />

      <Alert>
        <Info className="size-4" aria-hidden="true" />
        <AlertTitle>Master Data Management</AlertTitle>
        <AlertDescription>
          Values here feed every dropdown across the site. Forms load options through
          <span className="mx-1 rounded bg-muted px-1 py-0.5 font-mono text-[11px]">useMasters()</span>
          which fetches this registry on each page load — refresh the page or reopen a form after editing to see new values.
        </AlertDescription>
      </Alert>

      {/* Category tabs */}
      <Tabs value={selected} onValueChange={setSelected}>
        {loading ? (
          <Skeleton className="h-10 w-full max-w-xl" />
        ) : (
          <TabsList className="h-auto w-full flex-wrap justify-start gap-1">
            {categories.map((c) => (
              <TabsTrigger key={c} value={c} className="px-3">
                {titleCase(c)}
              </TabsTrigger>
            ))}
          </TabsList>
        )}
      </Tabs>

      {/* Entries header row */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="flex items-center gap-2 text-sm font-semibold">
            <FolderTree className="size-4 text-primary" aria-hidden="true" />
            {selected ? titleCase(selected) : "Entries"}
          </h3>
          <p className="mt-0.5 text-xs text-muted-foreground">{usageHint(selected ?? "")}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted-foreground" aria-live="polite">
            {loading ? "Loading…" : `${selectedEntries.length} entr${selectedEntries.length === 1 ? "y" : "ies"}`}
          </span>
          <ExportMenu
            columns={masterCsv}
            rows={selectedEntries}
            filename={`uar-masters-${(selected ?? "entries").toLowerCase()}`}
            disabled={!selected || selectedEntries.length === 0}
          />
          <Button
            variant="outline"
            size="sm"
            onClick={openImport}
            disabled={!selected}
            aria-label={`Bulk import ${selected} entries`}
          >
            <Upload className="size-4" aria-hidden="true" /> Import
          </Button>
        </div>
      </div>

      <DataTable
        columns={columns}
        rows={paged}
        rowKey={(e) => e.id}
        loading={loading}
        skeletonRows={6}
        height="fill"
        fillOffset={300}
        onRowClick={(e) => setDetailTarget(e)}
        page={pageSafe}
        pages={pages}
        total={selectedEntries.length}
        pageSize={pageSize}
        onPage={setPage}
        onPageSize={setPageSize}
        itemLabel="entries"
        empty={
          !selected ? (
            <EmptyState
              icon={<FolderTree className="size-6" aria-hidden="true" />}
              title="No categories yet"
              hint="Add the first entry to create a category — it will appear as a tab."
            >
              <Button
                size="sm"
                onClick={() => {
                  setAddForm({ ...EMPTY_ADD, category: "__new__" });
                  setAddOpen(true);
                }}
              >
                <Plus className="size-4" /> Add first entry
              </Button>
            </EmptyState>
          ) : (
            <EmptyState
              icon={<Tag className="size-6" aria-hidden="true" />}
              title={`No entries in ${titleCase(selected)}`}
              hint={`Add the first entry — it will appear in every dropdown that uses ${titleCase(selected)}.`}
            >
              <Button
                size="sm"
                onClick={() => {
                  setAddForm({ ...EMPTY_ADD, category: selected });
                  setAddOpen(true);
                }}
              >
                <Plus className="size-4" /> Add entry
              </Button>
            </EmptyState>
          )
        }
      >
        {(entry, col) => {
          switch (col.key) {
            case "label":
              return (
                <div onClick={(e) => e.stopPropagation()}>
                  <Input
                    value={labelDrafts[entry.id] ?? entry.label}
                    onChange={(e) => setLabelDrafts((p) => ({ ...p, [entry.id]: e.target.value }))}
                    onBlur={() => saveLabel(entry)}
                    onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
                    aria-label={`Edit label for ${entry.value}`}
                    className="h-9 text-sm"
                  />
                </div>
              );
            case "value":
              return <span className="whitespace-nowrap font-mono text-xs text-muted-foreground">{entry.value}</span>;
            case "sortOrder":
              return (
                <div className="flex justify-end" onClick={(e) => e.stopPropagation()}>
                  <Input
                    type="number"
                    value={sortDrafts[entry.id] ?? String(entry.sortOrder ?? 0)}
                    onChange={(e) => setSortDrafts((p) => ({ ...p, [entry.id]: e.target.value }))}
                    onBlur={() => saveSortOrder(entry)}
                    onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
                    aria-label={`Edit sort order for ${entry.value}`}
                    className="h-9 w-20 text-right text-sm"
                  />
                </div>
              );
            case "active":
              return (
                <div onClick={(e) => e.stopPropagation()}>
                  <Switch
                    checked={entry.active}
                    disabled={busyId === entry.id}
                    onCheckedChange={(v) => toggleActive(entry, v)}
                    aria-label={`Toggle ${entry.value} active`}
                  />
                </div>
              );
            case "actions":
              return (
                <div className="flex justify-end" onClick={(e) => e.stopPropagation()}>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="size-11 text-red-600 hover:bg-red-500/10 hover:text-red-700 md:size-9"
                    aria-label={`Delete entry ${entry.value}`}
                    onClick={() => setDeleteTarget(entry)}
                  >
                    {busyId === entry.id ? (
                      <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                    ) : (
                      <Trash2 className="size-4" aria-hidden="true" />
                    )}
                  </Button>
                </div>
              );
            default:
              return null;
          }
        }}
      </DataTable>

      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <RefreshCw className="size-3.5" aria-hidden="true" />
        Tip: deactivating hides a value from every dropdown without deleting history tied to it. Click a row for full details.
      </p>

      {/* ------------------------------ Add sheet (sm) -------------------------- */}
      <FormSheet
        open={addOpen}
        onOpenChange={(o) => {
          if (!o && !saving) {
            setAddOpen(false);
          }
        }}
        title="Add registry entry"
        description="The value is stored internally; the label is what users see in dropdowns."
        submitLabel="Add entry"
        onSubmit={addEntry}
        loading={saving}
        dirty={addDirty}
        size="sm"
      >
        <FormSection title="Category" description="Pick an existing registry or create a new one.">
          <SelectField
            label="Category"
            required
            value={addForm.category}
            onChange={(v) => setAddForm((f) => ({ ...f, category: v }))}
            options={[
              ...categories.map((c) => ({ value: c, label: titleCase(c) })),
              { value: "__new__", label: "— New category —" },
            ]}
            placeholder="Choose a category"
          />
          {addForm.category === "__new__" && (
            <TextField
              label="New category name"
              required
              value={addForm.newCategory}
              onChange={(v) => setAddForm((f) => ({ ...f, newCategory: v }))}
              placeholder="e.g. BLOOD_GROUP"
              hint="Stored in CAPS_WITH_UNDERSCORES."
            />
          )}
        </FormSection>
        <FormSection title="Entry" description="Value is the stored key; label is shown to users.">
          <FieldGrid>
            <TextField
              label="Value"
              required
              value={addForm.value}
              onChange={(v) => setAddForm((f) => ({ ...f, value: v }))}
              placeholder="e.g. WHITEFIELD"
            />
            <TextField
              label="Label"
              required
              value={addForm.label}
              onChange={(v) => setAddForm((f) => ({ ...f, label: v }))}
              placeholder="e.g. Whitefield"
            />
          </FieldGrid>
          <TextField
            label="Sort order"
            type="number"
            value={addForm.sortOrder}
            onChange={(v) => setAddForm((f) => ({ ...f, sortOrder: v }))}
            hint="Lower numbers appear first in dropdowns."
          />
        </FormSection>
      </FormSheet>

      {/* --------------------------- Bulk import sheet ------------------------- */}
      <FormSheet
        open={importOpen}
        onOpenChange={(o) => {
          if (!o && !importing) setImportOpen(false);
        }}
        title={`Import ${selected ? titleCase(selected) : "entries"}`}
        description="Paste one entry per line as value,label,sortOrder. Label and sort order are optional — existing values are updated."
        submitLabel={importing ? "Importing…" : `Import ${parsedImport.rows.length || ""}`.trim()}
        cancelLabel="Cancel"
        loading={importing}
        dirty={importText.trim().length > 0}
        size="md"
        onSubmit={runImport}
      >
        <TextareaField
          label="Entries to import"
          value={importText}
          onChange={setImportText}
          rows={10}
          placeholder={"WHITEFIELD, Whitefield, 1\nKORAMANGALA, Koramangala, 2\nINDIRANAGAR, Indiranagar, 3"}
          hint="One per line — value is required; label defaults to the value; sort order defaults to 0."
          disabled={importing}
        />
        <div className="rounded-lg border bg-muted/40 p-3 text-xs text-muted-foreground">
          <p aria-live="polite">
            <strong className="text-foreground">{parsedImport.rows.length}</strong> line
            {parsedImport.rows.length === 1 ? "" : "s"} ready to import
            {parsedImport.errors.length > 0 && (
              <>
                {" · "}
                <span className="text-red-600 dark:text-red-400">{parsedImport.errors.length} unparsable</span>
              </>
            )}{" "}
            into <strong className="text-foreground">{selected ? titleCase(selected) : "—"}</strong>
          </p>
          {parsedImport.errors.length > 0 && (
            <ul className="mt-2 list-inside list-disc space-y-0.5">
              {parsedImport.errors.slice(0, 5).map((err) => (
                <li key={err} className="text-red-600 dark:text-red-400">{err}</li>
              ))}
            </ul>
          )}
        </div>
        {importResults.length > 0 && (
          <div className="max-h-48 overflow-y-auto rounded-lg border scrollbar-thin" aria-live="polite">
            <ul className="divide-y text-xs">
              {importResults.map((r) => (
                <li key={r.line} className="flex items-center gap-2 px-3 py-2">
                  <span className="w-10 shrink-0 text-muted-foreground">#{r.line}</span>
                  <span className="min-w-0 flex-1 truncate font-mono">{r.value}</span>
                  <span
                    className={cn(
                      "shrink-0 rounded-full px-2 py-0.5 font-medium",
                      r.ok
                        ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                        : "bg-red-500/10 text-red-700 dark:text-red-400"
                    )}
                  >
                    {r.ok ? "Imported" : r.message}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </FormSheet>

      {/* ------------------------------ Detail sheet ---------------------------- */}
      <DetailSheet
        open={!!detailTarget}
        onOpenChange={(o) => !o && setDetailTarget(null)}
        eyebrow="Masters (MDM)"
        title={detailTarget?.label ?? "Entry"}
        description={detailTarget ? `${titleCase(detailTarget.category)} · ${usageHint(detailTarget.category)}` : ""}
        status={detailTarget ? <StatusBadge tone={detailTarget.active ? "success" : "neutral"}>{detailTarget.active ? "Active" : "Inactive"}</StatusBadge> : undefined}
        actions={
          detailTarget ? (
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setAddForm({ ...EMPTY_ADD, category: detailTarget.category });
                setAddOpen(true);
              }}
            >
              <Plus className="size-3.5" aria-hidden="true" /> Add to this registry
            </Button>
          ) : undefined
        }
      >
        {detailTarget ? (
          <>
            <DetailSection title="Entry" description="Stored value vs. the label users see.">
              <DetailGrid cols={2}>
                <DataField label="Category" value={titleCase(detailTarget.category)} />
                <DataField label="Value" value={detailTarget.value} mono copy />
                <DataField label="Label" value={detailTarget.label} />
                <DataField label="Sort order" value={String(detailTarget.sortOrder ?? 0)} />
                <DataField label="Status" value={<StatusBadge tone={detailTarget.active ? "success" : "neutral"}>{detailTarget.active ? "Active" : "Inactive"}</StatusBadge>} />
                <DataField label="Entry ID" value={detailTarget.id} mono copy />
              </DetailGrid>
            </DetailSection>

            <DetailSection
              title={`${titleCase(detailTarget.category)} registry`}
              description={`${detailSiblings.length} entries — order and active state preview exactly as dropdowns render them.`}
            >
              <ol className="max-h-96 space-y-1.5 overflow-y-auto rounded-lg border p-2 scrollbar-thin" aria-label={`Entries in ${detailTarget.category}`}>
                {detailSiblings.map((e, i) => (
                  <li
                    key={e.id}
                    className={cn(
                      "flex items-center gap-3 rounded-md px-2.5 py-2 text-sm",
                      e.id === detailTarget.id && "bg-primary/10"
                    )}
                  >
                    <span className="w-6 shrink-0 text-right font-mono text-xs text-muted-foreground">{i + 1}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{e.label}</span>
                      <span className="block truncate font-mono text-[11px] text-muted-foreground">{e.value}</span>
                    </span>
                    <span className="shrink-0 text-xs text-muted-foreground tabular-nums">#{e.sortOrder ?? 0}</span>
                    <StatusBadge tone={e.active ? "success" : "neutral"} className="shrink-0">
                      {e.active ? "Active" : "Inactive"}
                    </StatusBadge>
                  </li>
                ))}
              </ol>
            </DetailSection>

            <DetailSection title="Danger zone">
              <Button
                variant="outline"
                className="text-red-600 hover:bg-red-500/10 hover:text-red-700 dark:text-red-400"
                onClick={() => setDeleteTarget(detailTarget)}
              >
                <Trash2 className="size-4" aria-hidden="true" /> Delete this entry
              </Button>
            </DetailSection>
          </>
        ) : null}
      </DetailSheet>

      {/* ---------------------------- Delete confirm --------------------------- */}
      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
        title="Delete entry?"
        recordName={deleteTarget ? `${deleteTarget.label} (${deleteTarget.category}/${deleteTarget.value})` : null}
        description="It will be removed from every dropdown that uses it. Existing records keep their stored value."
        confirmLabel="Delete entry"
        loading={saving}
        onConfirm={confirmDelete}
      />
    </div>
  );
}

