"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { FolderTree, Info, Loader2, Plus, Tag, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { del, get, patch, post } from "@/lib/api-client";
import { cn, titleCase } from "@/lib/utils";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
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
  active: boolean;
}

interface CategoryInfo {
  category: string;
  count: number;
}

/* ---------------------------------- view ----------------------------------- */

export default function MastersView() {
  const [entries, setEntries] = useState<MasterEntry[]>([]);
  const [categories, setCategories] = useState<CategoryInfo[]>([]);
  const [selected, setSelected] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [newCategory, setNewCategory] = useState("");
  const [entryOpen, setEntryOpen] = useState(false);
  const [entryForm, setEntryForm] = useState({ value: "", label: "" });
  const [labelDrafts, setLabelDrafts] = useState<Record<string, string>>({});
  const [deleteTarget, setDeleteTarget] = useState<MasterEntry | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [cats, all] = await Promise.all([
        get<unknown>("/api/masters?categories=1"),
        get<MasterEntry[] | { items?: MasterEntry[] }>("/api/masters?all=1"),
      ]);

      const list: MasterEntry[] = Array.isArray(all) ? all : ((all as { items?: MasterEntry[] })?.items ?? []);
      setEntries(list);

      const counts = new Map<string, number>();
      for (const e of list) counts.set(e.category, (counts.get(e.category) ?? 0) + 1);

      const catList: CategoryInfo[] = [];
      if (Array.isArray(cats)) {
        for (const c of cats as unknown[]) {
          if (typeof c === "string") catList.push({ category: c, count: counts.get(c) ?? 0 });
          else if (c && typeof c === "object") {
            const o = c as Record<string, unknown>;
            const name = typeof o.category === "string" ? o.category : undefined;
            if (name) catList.push({ category: name, count: counts.get(name) ?? Number(o.count ?? o._count ?? 0) });
          }
        }
      }
      // include any categories found in entries but missing from the endpoint
      for (const [name, count] of counts) {
        if (!catList.some((c) => c.category === name)) catList.push({ category: name, count });
      }

      setCategories(catList);
      setSelected((prev) => (prev && catList.some((c) => c.category === prev) ? prev : catList[0]?.category ?? ""));
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
    () => entries.filter((e) => e.category === selected).sort((a, b) => a.value.localeCompare(b.value)),
    [entries, selected]
  );

  const addCategory = async () => {
    const name = newCategory.trim().toUpperCase().replace(/\s+/g, "_");
    if (!name) {
      toast.error("Enter a category name first");
      return;
    }
    setSaving(true);
    try {
      await post("/api/masters", { category: name, value: "default", label: titleCase(name) });
      toast.success(`Category ${name} created — add its entries now`);
      setNewCategory("");
      await load();
      setSelected(name);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to create category");
    } finally {
      setSaving(false);
    }
  };

  const addEntry = async () => {
    if (!entryForm.value.trim() || !entryForm.label.trim() || !selected) {
      toast.error("Value and label are required");
      return;
    }
    setSaving(true);
    try {
      await post("/api/masters", {
        category: selected,
        value: entryForm.value.trim(),
        label: entryForm.label.trim(),
      });
      toast.success(`Entry added to ${selected}`);
      setEntryOpen(false);
      setEntryForm({ value: "", label: "" });
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to add entry");
    } finally {
      setSaving(false);
    }
  };

  const saveLabel = async (entry: MasterEntry) => {
    const draft = labelDrafts[entry.id];
    if (draft === undefined || draft.trim() === "" || draft === entry.label) return;
    try {
      await patch(`/api/masters/${entry.id}`, { label: draft.trim() });
      setEntries((prev) => prev.map((e) => (e.id === entry.id ? { ...e, label: draft.trim() } : e)));
      toast.success("Label updated");
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to update label");
    }
  };

  const toggleActive = async (entry: MasterEntry, active: boolean) => {
    try {
      await patch(`/api/masters/${entry.id}`, { active });
      setEntries((prev) => prev.map((e) => (e.id === entry.id ? { ...e, active } : e)));
      toast.success(active ? "Entry activated" : "Entry deactivated");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to update entry");
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setSaving(true);
    try {
      await del(`/api/masters/${deleteTarget.id}`);
      toast.success("Entry deleted");
      setDeleteTarget(null);
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to delete entry");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <Alert>
        <Info className="size-4" aria-hidden="true" />
        <AlertTitle>Master Data Management</AlertTitle>
        <AlertDescription>Values here feed every dropdown across the site instantly — cities, skills, conditions, units and more.</AlertDescription>
      </Alert>

      <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
        {/* Category list */}
        <Card className="h-fit p-0">
          <CardHeader className="py-4">
            <CardTitle className="flex items-center gap-2 text-sm">
              <FolderTree className="size-4 text-primary" aria-hidden="true" /> Categories
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 px-3 pb-3">
            {loading ? (
              <div className="space-y-2">
                {Array.from({ length: 6 }).map((_, i) => (
                  <Skeleton key={i} className="h-9 w-full" />
                ))}
              </div>
            ) : (
              <>
                <div className="max-h-80 space-y-0.5 overflow-y-auto scrollbar-thin" role="listbox" aria-label="Master data categories">
                  {categories.map((c) => (
                    <button
                      key={c.category}
                      role="option"
                      aria-selected={selected === c.category}
                      onClick={() => setSelected(c.category)}
                      className={cn(
                        "flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-2 text-left text-sm font-medium transition",
                        selected === c.category ? "bg-primary text-primary-foreground" : "text-foreground/70 hover:bg-accent"
                      )}
                    >
                      <span className="truncate">{titleCase(c.category)}</span>
                      <span
                        className={cn(
                          "shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-semibold",
                          selected === c.category ? "bg-primary-foreground/20" : "bg-muted text-muted-foreground"
                        )}
                      >
                        {c.count}
                      </span>
                    </button>
                  ))}
                </div>
                <div className="flex gap-2 border-t pt-3">
                  <Input
                    value={newCategory}
                    onChange={(e) => setNewCategory(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && addCategory()}
                    placeholder="New category…"
                    aria-label="New category name"
                    className="h-9"
                  />
                  <Button size="icon" className="size-9 shrink-0" onClick={addCategory} disabled={saving} aria-label="Create category">
                    {saving ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
                  </Button>
                </div>
              </>
            )}
          </CardContent>
        </Card>

        {/* Entries table */}
        <Card className="p-0">
          <CardHeader className="flex-row items-center justify-between space-y-0 py-4">
            <div>
              <CardTitle className="flex items-center gap-2 text-sm">
                <Tag className="size-4 text-primary" aria-hidden="true" /> {selected ? titleCase(selected) : "Entries"}
              </CardTitle>
              <CardDescription>
                {selectedEntries.length} entr{selectedEntries.length === 1 ? "y" : "ies"} in this category
              </CardDescription>
            </div>
            <Button size="sm" onClick={() => setEntryOpen(true)} disabled={!selected} aria-label={`Add entry to ${selected}`}>
              <Plus className="size-4" /> Add entry
            </Button>
          </CardHeader>
          <CardContent className="p-0">
            {loading ? (
              <div className="space-y-2 p-4">
                {Array.from({ length: 5 }).map((_, i) => (
                  <Skeleton key={i} className="h-11 w-full" />
                ))}
              </div>
            ) : !selected ? (
              <div className="flex flex-col items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
                <FolderTree className="size-8" aria-hidden="true" />
                <p className="font-medium text-foreground">No categories yet</p>
                <p>Create your first category on the left.</p>
              </div>
            ) : selectedEntries.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
                <Tag className="size-8" aria-hidden="true" />
                <p className="font-medium text-foreground">No entries in {titleCase(selected)}</p>
                <p>Add the first entry — it will appear in every related dropdown.</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Label</TableHead>
                      <TableHead>Value</TableHead>
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
                            className="h-8 text-sm"
                          />
                        </TableCell>
                        <TableCell className="whitespace-nowrap font-mono text-xs text-muted-foreground">{entry.value}</TableCell>
                        <TableCell>
                          <Switch
                            checked={entry.active}
                            onCheckedChange={(v) => toggleActive(entry, v)}
                            aria-label={`Toggle ${entry.value} active`}
                          />
                        </TableCell>
                        <TableCell className="text-right">
                          <Button
                            size="icon"
                            variant="ghost"
                            className="text-red-600 hover:bg-red-50 hover:text-red-700"
                            aria-label={`Delete entry ${entry.value}`}
                            onClick={() => setDeleteTarget(entry)}
                          >
                            <Trash2 className="size-4" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Add entry dialog */}
      <Dialog open={entryOpen} onOpenChange={setEntryOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Add entry to {selected ? titleCase(selected) : ""}</DialogTitle>
            <DialogDescription>The value is stored internally; the label is what users see in dropdowns.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="grid gap-2">
              <Label htmlFor="m-value">Value *</Label>
              <Input
                id="m-value"
                value={entryForm.value}
                onChange={(e) => setEntryForm({ ...entryForm, value: e.target.value })}
                placeholder="e.g. WHITEFIELD"
                className="font-mono"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="m-label">Label *</Label>
              <Input
                id="m-label"
                value={entryForm.label}
                onChange={(e) => setEntryForm({ ...entryForm, label: e.target.value })}
                placeholder="e.g. Whitefield"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEntryOpen(false)}>Cancel</Button>
            <Button onClick={addEntry} disabled={saving}>{saving ? "Saving…" : "Add entry"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirm dialog */}
      <Dialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Delete entry?</DialogTitle>
            <DialogDescription>
              {deleteTarget ? `"${deleteTarget.label}" (${deleteTarget.category}) will be removed from every dropdown that uses it.` : ""}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>Cancel</Button>
            <Button variant="destructive" onClick={confirmDelete} disabled={saving}>{saving ? "Deleting…" : "Delete"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
