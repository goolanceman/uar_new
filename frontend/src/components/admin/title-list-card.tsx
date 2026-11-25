/**
 * TitleListCard — reusable single-column CRUD card (add / inline edit / delete)
 * used by the Masters module (document types, report reasons, interests,
 * username restrictions). Talks to the mobile-admin config endpoints via
 * the shared mfetch helper.
 */
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { Loader2, Pencil, Plus, RefreshCw, Save, Trash2, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { SectionCard } from "@/components/shared/section-card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { EmptyState } from "@/components/shared/empty-state";
import { mfetch } from "./community/shared";

interface ListItem {
  id: number | string;
  title: string;
  updated_at?: string | null;
}

export interface TitleListProps {
  title: string;
  description: string;
  icon: ReactNode;
  noun: string;
  listPath: string;
  listKey: string;
  addPath: string;
  updatePath: string;
  deletePath: string;
  /** Body key carrying the row id on update/delete (legacy param names). */
  idKey: string;
  placeholder?: string;
  emptyIcon: ReactNode;
  batchHint?: string;
  deleteHint?: string;
}

/** Add-input + inline-edit + delete rows — the shared pattern for the four
 *  legacy title-only lists (document types, report reasons, username
 *  restrictions, interests). */
export function TitleListCard({
  title,
  description,
  icon,
  noun,
  listPath,
  listKey,
  addPath,
  updatePath,
  deletePath,
  idKey,
  placeholder,
  emptyIcon,
  batchHint,
  deleteHint,
}: TitleListProps) {
  const [items, setItems] = useState<ListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [newTitle, setNewTitle] = useState("");
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<number | string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [busyId, setBusyId] = useState<number | string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ListItem | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await mfetch<Record<string, ListItem[]>>(listPath);
      setItems(res[listKey] ?? []);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : `Failed to load ${title.toLowerCase()}`);
    } finally {
      setLoading(false);
    }
  }, [listPath, listKey, title]);

  useEffect(() => {
    void load();
  }, [load]);

  const add = async () => {
    const t = newTitle.trim();
    if (!t) return;
    setAdding(true);
    try {
      await mfetch(addPath, { title: t });
      toast.success(`${noun} added`);
      setNewTitle("");
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to add");
    } finally {
      setAdding(false);
    }
  };

  const startEdit = (item: ListItem) => {
    setEditingId(item.id);
    setEditValue(item.title);
  };

  const saveEdit = async () => {
    if (editingId === null) return;
    const t = editValue.trim();
    if (!t) return;
    setBusyId(editingId);
    try {
      await mfetch(updatePath, { [idKey]: editingId, title: t });
      toast.success(`${noun} updated`);
      setEditingId(null);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to update");
    } finally {
      setBusyId(null);
    }
  };

  const remove = async (item: ListItem) => {
    setBusyId(item.id);
    try {
      await mfetch(deletePath, { [idKey]: item.id });
      toast.success(`${noun} deleted`);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to delete");
    } finally {
      setBusyId(null);
      setDeleteTarget(null);
    }
  };

  return (
    <SectionCard
      title={title}
      icon={icon}
      description={loading ? "Loading…" : `${items.length} ${items.length === 1 ? "entry" : "entries"}`}
      bodyClassName="space-y-4"
    >
      <div className="space-y-1.5">
        <div className="flex gap-2">
          <Input
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void add();
            }}
            placeholder={placeholder ?? `New ${noun.toLowerCase()}`}
            className="h-9 text-sm"
            aria-label={`New ${noun.toLowerCase()}`}
          />
          <Button size="sm" onClick={() => void add()} disabled={adding || !newTitle.trim()} aria-label={`Add ${noun.toLowerCase()}`}>
            {adding ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Plus className="size-4" aria-hidden="true" />}
            Add
          </Button>
        </div>
        {batchHint && <p className="text-xs text-muted-foreground">{batchHint}</p>}
      </div>

      {loading ? (
        <div className="space-y-2" aria-busy="true">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <EmptyState icon={emptyIcon} title={`No ${title.toLowerCase()} yet`} hint={`Added entries appear here and in the mobile app.`} />
      ) : (
        <div className="overflow-x-auto rounded-xl border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Title</TableHead>
                <TableHead className="hidden text-right sm:table-cell">Last updated</TableHead>
                <TableHead className="w-[100px] text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((item) => (
                <TableRow key={item.id}>
                  <TableCell>
                    {editingId === item.id ? (
                      <Input
                        value={editValue}
                        onChange={(e) => setEditValue(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") void saveEdit();
                          if (e.key === "Escape") setEditingId(null);
                        }}
                        className="h-8 text-sm"
                        aria-label="Edit title"
                        autoFocus
                      />
                    ) : (
                      <span className="text-sm">{item.title}</span>
                    )}
                  </TableCell>
                  <TableCell className="hidden text-right text-xs text-muted-foreground sm:table-cell">
                    {item.updated_at ? new Date(item.updated_at).toLocaleDateString() : "—"}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      {editingId === item.id ? (
                        <>
                          <Button
                            variant="outline"
                            size="icon"
                            className="size-8"
                            onClick={() => void saveEdit()}
                            disabled={busyId === item.id || !editValue.trim()}
                            aria-label="Save title"
                          >
                            {busyId === item.id ? (
                              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                            ) : (
                              <Save className="size-4" aria-hidden="true" />
                            )}
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-8"
                            onClick={() => setEditingId(null)}
                            aria-label="Cancel editing"
                          >
                            <X className="size-4" aria-hidden="true" />
                          </Button>
                        </>
                      ) : (
                        <>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-8"
                            onClick={() => startEdit(item)}
                            aria-label={`Edit ${item.title}`}
                          >
                            <Pencil className="size-4" aria-hidden="true" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-8 text-red-600 hover:text-red-600 dark:text-red-400"
                            onClick={() => setDeleteTarget(item)}
                            disabled={busyId === item.id}
                            aria-label={`Delete ${item.title}`}
                          >
                            <Trash2 className="size-4" aria-hidden="true" />
                          </Button>
                        </>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
        title={`Delete ${noun.toLowerCase()}?`}
        recordName={deleteTarget?.title ?? null}
        description={deleteHint ?? "This cannot be undone."}
        confirmLabel="Delete"
        loading={busyId !== null}
        onConfirm={() => {
          if (deleteTarget) void remove(deleteTarget);
        }}
      />
    </SectionCard>
  );
}
