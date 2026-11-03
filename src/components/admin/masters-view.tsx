"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Download,
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
import { downloadCsv } from "@/components/shared/csv";
import { FormSheet } from "@/components/shared/form-sheet";
import { TextareaField } from "@/components/shared/form-fields";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

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

  // add entry dialog
  const [addOpen, setAddOpen] = useState(false);
  const [addForm, setAddForm] = useState({ category: "", newCategory: "", value: "", label: "", sortOrder: "0" });

  // bulk import
  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState("");
  const [importing, setImporting] = useState(false);
  const [importResults, setImportResults] = useState<ImportResult[]>([]);

  const [deleteTarget, setDeleteTarget] = useState<MasterEntry | null>(null);

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
      setAddForm({ category: "", newCategory: "", value: "", label: "", sortOrder: "0" });
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
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to delete entry");
    } finally {
      setSaving(false);
    }
  };

  /* ----------------------------- export / import --------------------------- */

  const exportCategory = () => {
    if (!selected || selectedEntries.length === 0) {
      toast.info("Nothing to export in this category yet");
      return;
    }
    downloadCsv(`uar-masters-${selected.toLowerCase()}`, [
      { header: "value", value: (e: MasterEntry) => e.value },
      { header: "label", value: (e: MasterEntry) => e.label },
      { header: "sortOrder", value: (e: MasterEntry) => e.sortOrder },
      { header: "active", value: (e: MasterEntry) => (e.active ? "1" : "0") },
    ], selectedEntries);
    toast.success(`Exported ${selectedEntries.length} ${selectedEntries.length === 1 ? "entry" : "entries"}`);
  };

  const openImport = () => {
    setImportText("");
    setImportResults([]);
    setImportOpen(true);
  };

  const runImport = async () => {
    const { rows, errors } = parsedImport;
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
      toast.warning(`${okCount} imported · ${failCount} failed${errors.length ? ` · ${errors.length} unparsed line${errors.length === 1 ? "" : "s"}` : ""}`);
    }
    await load();
  };

  /* --------------------------------- render -------------------------------- */

  return (
    <div className="space-y-4 sm:space-y-6">
      <PageHeader
        title="Masters (MDM)"
        description="Single source of truth for every dropdown in the product."
        icon={<ShieldCheck className="size-5" aria-hidden="true" />}
        actions={
          <Button
            onClick={() => {
              setAddForm((f) => ({ ...f, category: selected || categories[0] || "__new__", value: "", label: "", sortOrder: "0", newCategory: "" }));
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

      {/* Entries card */}
      <div className="rounded-xl border bg-card">
        <div className="flex flex-wrap items-start justify-between gap-3 border-b p-4">
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
            <Button
              variant="outline"
              size="sm"
              onClick={exportCategory}
              disabled={!selected || selectedEntries.length === 0}
              aria-label={`Export ${selected} entries as CSV`}
            >
              <Download className="size-4" aria-hidden="true" /> Export
            </Button>
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

        {loading ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-11 w-full" />
            ))}
          </div>
        ) : !selected ? (
          <div className="p-6">
            <EmptyState
              icon={<FolderTree className="size-6" aria-hidden="true" />}
              title="No categories yet"
              hint="Add the first entry to create a category — it will appear as a tab."
            >
              <Button
                size="sm"
                onClick={() => {
                  setAddForm({ category: "__new__", newCategory: "", value: "", label: "", sortOrder: "0" });
                  setAddOpen(true);
                }}
              >
                <Plus className="size-4" /> Add first entry
              </Button>
            </EmptyState>
          </div>
        ) : selectedEntries.length === 0 ? (
          <div className="p-6">
            <EmptyState
              icon={<Tag className="size-6" aria-hidden="true" />}
              title={`No entries in ${titleCase(selected)}`}
              hint={`Add the first entry — it will appear in every dropdown that uses ${titleCase(selected)}.`}
            >
              <Button
                size="sm"
                onClick={() => {
                  setAddForm((f) => ({ ...f, category: selected, value: "", label: "", sortOrder: "0", newCategory: "" }));
                  setAddOpen(true);
                }}
              >
                <Plus className="size-4" /> Add entry
              </Button>
            </EmptyState>
          </div>
        ) : (
          <div className="max-h-[30rem] overflow-auto scrollbar-thin">
            <Table>
              <TableHeader className="sticky top-0 bg-background">
                <TableRow>
                  <TableHead>Label</TableHead>
                  <TableHead>Value</TableHead>
                  <TableHead className="w-24">Sort order</TableHead>
                  <TableHead>Active</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {selectedEntries.map((entry) => (
                  <TableRow key={entry.id}>
                    <TableCell className="min-w-44">
                      <Input
                        value={labelDrafts[entry.id] ?? entry.label}
                        onChange={(e) => setLabelDrafts((p) => ({ ...p, [entry.id]: e.target.value }))}
                        onBlur={() => saveLabel(entry)}
                        onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
                        aria-label={`Edit label for ${entry.value}`}
                        className="h-9 text-sm"
                      />
                    </TableCell>
                    <TableCell className="whitespace-nowrap font-mono text-xs text-muted-foreground">{entry.value}</TableCell>
                    <TableCell>
                      <Input
                        type="number"
                        value={sortDrafts[entry.id] ?? String(entry.sortOrder ?? 0)}
                        onChange={(e) => setSortDrafts((p) => ({ ...p, [entry.id]: e.target.value }))}
                        onBlur={() => saveSortOrder(entry)}
                        onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
                        aria-label={`Edit sort order for ${entry.value}`}
                        className="h-9 w-20 text-sm"
                      />
                    </TableCell>
                    <TableCell>
                      <Switch
                        checked={entry.active}
                        disabled={busyId === entry.id}
                        onCheckedChange={(v) => toggleActive(entry, v)}
                        aria-label={`Toggle ${entry.value} active`}
                      />
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        size="icon"
                        variant="ghost"
                        className="size-11 text-red-600 hover:bg-red-500/10 hover:text-red-700 md:size-9"
                        aria-label={`Delete entry ${entry.value}`}
                        onClick={() => setDeleteTarget(entry)}
                      >
                        {busyId === entry.id ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>

      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <RefreshCw className="size-3.5" aria-hidden="true" />
        Tip: deactivating hides a value from every dropdown without deleting history tied to it.
      </p>

      {/* ------------------------------ Add dialog ---------------------------- */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Add registry entry</DialogTitle>
            <DialogDescription>
              The value is stored internally; the label is what users see in dropdowns.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="grid gap-2">
              <Label>Category</Label>
              <Select value={addForm.category} onValueChange={(v) => setAddForm((f) => ({ ...f, category: v }))}>
                <SelectTrigger aria-label="Registry category"><SelectValue placeholder="Choose a category" /></SelectTrigger>
                <SelectContent>
                  {categories.map((c) => (
                    <SelectItem key={c} value={c}>{titleCase(c)}</SelectItem>
                  ))}
                  <SelectItem value="__new__">— New category —</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {addForm.category === "__new__" && (
              <div className="grid gap-2">
                <Label htmlFor="m-newcat">New category name</Label>
                <Input
                  id="m-newcat"
                  value={addForm.newCategory}
                  onChange={(e) => setAddForm((f) => ({ ...f, newCategory: e.target.value }))}
                  placeholder="e.g. BLOOD_GROUP"
                  className="font-mono uppercase"
                />
              </div>
            )}
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor="m-value">Value *</Label>
                <Input
                  id="m-value"
                  value={addForm.value}
                  onChange={(e) => setAddForm((f) => ({ ...f, value: e.target.value }))}
                  placeholder="e.g. WHITEFIELD"
                  className="font-mono"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="m-label">Label *</Label>
                <Input
                  id="m-label"
                  value={addForm.label}
                  onChange={(e) => setAddForm((f) => ({ ...f, label: e.target.value }))}
                  placeholder="e.g. Whitefield"
                />
              </div>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="m-sort">Sort order</Label>
              <Input
                id="m-sort"
                type="number"
                value={addForm.sortOrder}
                onChange={(e) => setAddForm((f) => ({ ...f, sortOrder: e.target.value }))}
                placeholder="0"
              />
              <p className="text-xs text-muted-foreground">Lower numbers appear first in dropdowns.</p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)}>Cancel</Button>
            <Button onClick={addEntry} disabled={saving}>
              {saving ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
              {saving ? "Saving…" : "Add entry"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* --------------------------- Bulk import sheet ------------------------- */}
      <FormSheet
        open={importOpen}
        onOpenChange={setImportOpen}
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

      {/* ---------------------------- Delete confirm -------------------------- */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete entry?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget
                ? `“${deleteTarget.label}” (${deleteTarget.category}/${deleteTarget.value}) will be removed from every dropdown that uses it. Existing records keep their stored value.`
                : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={(e) => {
                e.preventDefault();
                confirmDelete();
              }}
            >
              {saving ? "Deleting…" : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
