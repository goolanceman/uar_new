"use client";

/**
 * FilePicker — the universal file picker + uploader reused by every admin form.
 *
 * Exports:
 *  - `FileAssetView`        view model for a file asset (mirrors the API contract)
 *  - `fileUrl(id)`          canonical public URL for a file (cacheable, <img>-safe)
 *  - `uploadFiles(files)`   raw-fetch multipart POST (api-client JSON-encodes,
 *                           so uploads must NOT go through it)
 *  - `formatBytes(bytes)`   human-readable size
 *  - `FilePickerDialog`     the picker dialog: Library tab (search + folder
 *                           filter + selectable grid) and Upload tab
 *                           (drag-and-drop / browse with client-side checks)
 *  - `FilePickButton`       one-liner trigger button + dialog state wrapper
 *
 * Usage:
 *   <FilePickButton label="Attach photos" multiple folder="distributions"
 *     accept="image/*" onPicked={(files) => setPhotos(files)} />
 *
 * Accessibility: toggle-button cards with aria-pressed, list semantics,
 * labelled controls, Esc-safe (Radix), visible focus rings, ≥44px targets.
 */

import * as React from "react";
import { toast } from "sonner";
import type { LucideIcon } from "lucide-react";
import {
  Check,
  File,
  FileArchive,
  FileAudio,
  FileImage,
  FileJson,
  FileSpreadsheet,
  FileText,
  FileVideo,
  FolderOpen,
  Loader2,
  Paperclip,
  Search,
  Upload,
  X,
} from "lucide-react";
import { get, getToken } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { EmptyState } from "@/components/shared/empty-state";

/** View model for a file asset — mirrors GET/POST /api/files responses. */
export interface FileAssetView {
  id: string;
  name: string;
  title?: string | null;
  description?: string | null;
  mime: string;
  size: number;
  folder: string;
  uploadedByName?: string | null;
  createdAt?: string;
}

interface FilesResponse {
  items?: FileAssetView[];
  total?: number;
  page?: number;
  pages?: number;
}

const PAGE_SIZE = 24;
const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10 MB — server enforces too

/** Canonical, public, cacheable URL for a stored file. Safe in <img src>. */
export function fileUrl(id: string): string {
  return `/api/files/${id}/file`;
}

/**
 * Upload one or more files via a single multipart/form-data POST with one
 * `file` field per file (+ optional `folder`). Uses raw fetch because the
 * shared api-client JSON-encodes bodies. Attaches the Bearer token when one
 * exists. Throws an Error carrying the server's message on failure.
 */
export async function uploadFiles(
  files: File[],
  folder?: string
): Promise<FileAssetView[]> {
  if (files.length === 0) return [];
  const form = new FormData();
  for (const file of files) form.append("file", file);
  if (folder) form.append("folder", folder);

  const headers: Record<string, string> = {};
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch("/api/files", {
    method: "POST",
    headers,
    body: form,
  });
  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    // empty body
  }
  if (!res.ok) {
    const msg =
      (data as { error?: string } | null)?.error ||
      `Upload failed (${res.status})`;
    throw new Error(msg);
  }
  const payload = data as { files?: FileAssetView[] };
  return payload.files ?? [];
}

/** Human-readable byte size: "0 B", "512 B", "1.4 MB", "3 GB". */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    units.length - 1
  );
  const value = bytes / 1024 ** i;
  return `${i === 0 ? Math.round(value) : Math.round(value * 10) / 10} ${units[i]}`;
}

/** Lucide icon for a mime type (non-image types — images get thumbnails). */
function fileIconFor(mime: string): LucideIcon {
  const m = (mime || "").toLowerCase();
  if (m.startsWith("video/")) return FileVideo;
  if (m.startsWith("audio/")) return FileAudio;
  if (m === "application/pdf" || m.startsWith("text/")) return FileText;
  if (m === "application/json") return FileJson;
  if (
    m.startsWith("application/zip") ||
    m.includes("compressed") ||
    m.includes("tar") ||
    m.includes("rar")
  ) {
    return FileArchive;
  }
  if (m.includes("spreadsheet") || m.includes("excel") || m.includes("csv")) {
    return FileSpreadsheet;
  }
  if (m.includes("word") || m.includes("document") || m.includes("presentation")) {
    return FileText;
  }
  return File;
}

/** Client-side accept check (before the server enforces it). */
function fileMatchesAccept(file: File, accept?: string): boolean {
  const list = (accept ?? "").trim().toLowerCase();
  if (!list) return true;
  const tokens = list.split(",").map((t) => t.trim()).filter(Boolean);
  if (tokens.length === 0) return true;
  const type = file.type.toLowerCase();
  const name = file.name.toLowerCase();
  return tokens.some((t) => {
    if (t.startsWith(".")) return name.endsWith(t);
    if (t.endsWith("/*")) return type.startsWith(t.slice(0, -1));
    return type === t;
  });
}

export interface FilePickerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Allow multiple selection (default: single). */
  multiple?: boolean;
  /** Forwarded to the hidden file input, e.g. "image/*" or ".pdf,image/png". */
  accept?: string;
  /** Folder new uploads land in. */
  folder?: string;
  title?: string;
  onPicked: (files: FileAssetView[]) => void;
}

export function FilePickerDialog({
  open,
  onOpenChange,
  multiple = false,
  accept,
  folder,
  title,
  onPicked,
}: FilePickerDialogProps) {
  const [tab, setTab] = React.useState<"library" | "upload">("library");
  const [items, setItems] = React.useState<FileAssetView[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [loadingMore, setLoadingMore] = React.useState(false);
  const [page, setPage] = React.useState(1);
  const [pages, setPages] = React.useState(1);
  const [total, setTotal] = React.useState(0);
  const [query, setQuery] = React.useState("");
  const [qDebounced, setQDebounced] = React.useState("");
  const [folderFilter, setFolderFilter] = React.useState("all");
  const [selected, setSelected] = React.useState<FileAssetView[]>([]);
  const [staged, setStaged] = React.useState<File[]>([]);
  const [uploading, setUploading] = React.useState(false);
  const [dragOver, setDragOver] = React.useState(false);
  const inputRef = React.useRef<HTMLInputElement | null>(null);
  const reqRef = React.useRef(0);

  // Debounced search (300ms).
  React.useEffect(() => {
    const t = window.setTimeout(() => setQDebounced(query.trim()), 300);
    return () => window.clearTimeout(t);
  }, [query]);

  const fetchLibrary = React.useCallback(
    async (nextPage: number, mode: "replace" | "append") => {
      const reqId = ++reqRef.current;
      if (mode === "replace") setLoading(true);
      else setLoadingMore(true);
      try {
        const params = new URLSearchParams({
          page: String(nextPage),
          limit: String(PAGE_SIZE),
        });
        if (qDebounced) params.set("q", qDebounced);
        const data = await get<FilesResponse | FileAssetView[]>(
          `/api/files?${params.toString()}`
        );
        if (reqId !== reqRef.current) return; // stale response
        const incoming = Array.isArray(data)
          ? data
          : (data.items ?? []);
        const totalPages = Array.isArray(data) ? 1 : (data.pages ?? 1);
        const totalItems = Array.isArray(data)
          ? incoming.length
          : (data.total ?? incoming.length);
        const currentPage = Array.isArray(data) ? 1 : (data.page ?? nextPage);
        setItems((prev) =>
          mode === "replace"
            ? incoming
            : [...prev, ...incoming.filter((f) => !prev.some((p) => p.id === f.id))]
        );
        setPage(currentPage);
        setPages(Math.max(1, totalPages));
        setTotal(totalItems);
      } catch (err) {
        if (reqId !== reqRef.current) return;
        toast.error(err instanceof Error ? err.message : "Failed to load files");
      } finally {
        if (reqId === reqRef.current) {
          setLoading(false);
          setLoadingMore(false);
        }
      }
    },
    [qDebounced]
  );

  // Reset transient state on close so the next open starts fresh (avoids a
  // stale double-fetch that resetting on open would cause).
  React.useEffect(() => {
    if (open) return;
    reqRef.current += 1; // invalidate any in-flight request
    setTab("library");
    setQuery("");
    setQDebounced("");
    setFolderFilter("all");
    setSelected([]);
    setStaged([]);
    setItems([]);
    setPage(1);
    setPages(1);
    setTotal(0);
    setLoading(false);
    setLoadingMore(false);
    setUploading(false);
    setDragOver(false);
  }, [open]);

  // (Re)load the library whenever the dialog opens or the query changes.
  React.useEffect(() => {
    if (!open) return;
    void fetchLibrary(1, "replace");
  }, [open, qDebounced, fetchLibrary]);

  // Folders seen in the loaded data, for the filter dropdown.
  const folders = React.useMemo(
    () =>
      Array.from(new Set(items.map((f) => f.folder).filter(Boolean))).sort(
        (a, b) => a.localeCompare(b)
      ),
    [items]
  );
  const filtered = React.useMemo(
    () =>
      folderFilter === "all"
        ? items
        : items.filter((f) => f.folder === folderFilter),
    [items, folderFilter]
  );
  const hasFilters = qDebounced !== "" || folderFilter !== "all";
  const remaining = Math.max(0, total - items.length);

  const toggleSelected = (file: FileAssetView) => {
    setSelected((prev) => {
      const exists = prev.some((f) => f.id === file.id);
      if (multiple) {
        return exists ? prev.filter((f) => f.id !== file.id) : [...prev, file];
      }
      return exists ? [] : [file];
    });
  };

  // Validate + stage files chosen via browse or drop. Client-side checks
  // (type via accept, 10 MB cap) — the server enforces the same rules.
  const stageFiles = (incoming: File[]) => {
    const valid: File[] = [];
    const rejected: string[] = [];
    for (const file of incoming) {
      if (file.size > MAX_FILE_BYTES) {
        rejected.push(`"${file.name}" is over the 10 MB limit`);
      } else if (!fileMatchesAccept(file, accept)) {
        rejected.push(`"${file.name}" is not an accepted file type`);
      } else if (!multiple && valid.length >= 1) {
        rejected.push(`"${file.name}" skipped (single file only)`);
      } else {
        valid.push(file);
      }
    }
    if (rejected.length > 0) {
      toast.error(`${rejected.length} file(s) rejected`, {
        description: rejected.slice(0, 3).join(" · "),
      });
    }
    if (valid.length > 0) {
      setStaged((prev) =>
        multiple ? [...prev, ...valid] : [valid[0]]
      );
    }
  };

  const runUpload = async () => {
    if (staged.length === 0 || uploading) return;
    setUploading(true);
    try {
      const uploaded = await uploadFiles(staged, folder);
      toast.success(
        uploaded.length === 1 ? "File uploaded" : `${uploaded.length} files uploaded`
      );
      // Uploaded files appear in the library and get auto-selected.
      setItems((prev) => [...uploaded, ...prev]);
      setTotal((t) => t + uploaded.length);
      setSelected((prev) => {
        if (!multiple) return uploaded[0] ? [uploaded[0]] : prev;
        const ids = new Set(prev.map((f) => f.id));
        return [...prev, ...uploaded.filter((f) => !ids.has(f.id))];
      });
      setStaged([]);
      setTab("library");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  const confirmPick = () => {
    if (selected.length === 0) return;
    onPicked(selected);
    onOpenChange(false);
  };

  const renderGrid = () => {
    if (loading && items.length === 0) {
      return (
        <div
          role="list"
          aria-label="Files"
          aria-busy="true"
          className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4"
        >
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="rounded-lg border p-2">
              <Skeleton className="aspect-square w-full rounded-md" />
              <Skeleton className="mt-2 h-3 w-3/4" />
              <Skeleton className="mt-1.5 h-3 w-1/2" />
            </div>
          ))}
        </div>
      );
    }
    if (filtered.length === 0) {
      return (
        <EmptyState
          icon={<FolderOpen className="size-5" aria-hidden="true" />}
          title="No files yet"
          hint={
            hasFilters
              ? "No files match your search or folder filter."
              : "Switch to Upload to add your first file."
          }
          className="mt-3"
        >
          {hasFilters ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                setQuery("");
                setFolderFilter("all");
              }}
            >
              Clear filters
            </Button>
          ) : (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setTab("upload")}
            >
              <Upload className="size-4" aria-hidden="true" />
              Upload a file
            </Button>
          )}
        </EmptyState>
      );
    }
    return (
      <>
        <div
          role="list"
          aria-label="Files"
          aria-busy={loading}
          className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4"
        >
          {filtered.map((file) => {
            const isSelected = selected.some((s) => s.id === file.id);
            const Icon = fileIconFor(file.mime);
            const isImage = file.mime.startsWith("image/");
            return (
              <div role="listitem" key={file.id}>
                <button
                  type="button"
                  onClick={() => toggleSelected(file)}
                  aria-pressed={isSelected}
                  aria-label={`${file.name}, ${formatBytes(file.size)}, folder ${file.folder}${isSelected ? ", selected" : ""}`}
                  className={cn(
                    "relative flex min-h-11 w-full flex-col rounded-lg border p-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    isSelected
                      ? "border-primary bg-primary/10 ring-2 ring-primary"
                      : "border bg-card hover:bg-accent/60"
                  )}
                >
                  <span
                    aria-hidden="true"
                    className="flex aspect-square w-full items-center justify-center overflow-hidden rounded-md bg-muted"
                  >
                    {isImage ? (
                      <img
                        src={fileUrl(file.id)}
                        alt=""
                        loading="lazy"
                        className="size-full object-cover"
                      />
                    ) : (
                      <Icon className="size-8 text-muted-foreground" />
                    )}
                  </span>
                  <span className="mt-1.5 w-full truncate text-xs font-medium text-foreground">
                    {file.title || file.name}
                  </span>
                  <span className="w-full truncate text-[10px] text-muted-foreground">
                    {formatBytes(file.size)} · {file.folder}
                  </span>
                  {isSelected ? (
                    <span
                      aria-hidden="true"
                      className="absolute right-1.5 top-1.5 flex size-5 items-center justify-center rounded-full bg-primary text-primary-foreground"
                    >
                      <Check className="size-3" />
                    </span>
                  ) : null}
                </button>
              </div>
            );
          })}
        </div>
        {page < pages ? (
          <div className="mt-4 flex justify-center">
            <Button
              type="button"
              variant="outline"
              className="h-11 min-w-44"
              disabled={loadingMore}
              onClick={() => void fetchLibrary(page + 1, "append")}
            >
              {loadingMore ? (
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              ) : null}
              {loadingMore
                ? "Loading…"
                : remaining > 0
                  ? `Load more (${remaining} left)`
                  : "Load more"}
            </Button>
          </div>
        ) : null}
      </>
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[85vh] max-h-[85vh] w-full flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl md:max-w-3xl">
        <DialogHeader className="gap-1 border-b px-5 py-4 text-left">
          <DialogTitle className="flex items-center gap-2 text-base font-semibold">
            <Paperclip className="size-4 text-muted-foreground" aria-hidden="true" />
            {title ?? "Choose files"}
          </DialogTitle>
          <DialogDescription className="text-xs">
            Browse the library or upload something new.{" "}
            {multiple ? "Select one or more files." : "Select a file."}
          </DialogDescription>
        </DialogHeader>

        <Tabs
          value={tab}
          onValueChange={(v) => setTab(v === "upload" ? "upload" : "library")}
          className="flex min-h-0 flex-1 flex-col gap-0"
        >
          <div className="border-b px-5 py-3">
            <TabsList aria-label="File picker sections">
              <TabsTrigger value="library">
                <FolderOpen className="size-4" aria-hidden="true" />
                Library
              </TabsTrigger>
              <TabsTrigger value="upload">
                <Upload className="size-4" aria-hidden="true" />
                Upload
              </TabsTrigger>
            </TabsList>
          </div>

          <TabsContent
            value="library"
            className="min-h-0 flex-1 overflow-y-auto px-5 py-4"
          >
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <div className="relative flex-1">
                <Search
                  aria-hidden="true"
                  className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
                />
                <Input
                  type="search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search files…"
                  aria-label="Search files"
                  className="h-11 pl-9"
                />
              </div>
              <Select value={folderFilter} onValueChange={setFolderFilter}>
                <SelectTrigger
                  aria-label="Filter by folder"
                  className="h-11 w-full sm:w-44"
                >
                  <SelectValue placeholder="All folders" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All folders</SelectItem>
                  {folders.map((f) => (
                    <SelectItem key={f} value={f}>
                      {f}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <p className="mt-3 text-xs text-muted-foreground" aria-live="polite">
              {loading && items.length === 0
                ? "Loading files…"
                : `${total} file${total === 1 ? "" : "s"}${
                    folderFilter !== "all" ? ` in ${folderFilter}` : ""
                  }`}
            </p>

            {renderGrid()}
          </TabsContent>

          <TabsContent
            value="upload"
            className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-5 py-4"
          >
            <input
              ref={inputRef}
              type="file"
              className="sr-only"
              tabIndex={-1}
              aria-hidden="true"
              accept={accept}
              multiple={multiple}
              onChange={(e) => {
                stageFiles(Array.from(e.target.files ?? []));
                e.target.value = "";
              }}
            />

            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragOver(false);
                stageFiles(Array.from(e.dataTransfer.files));
              }}
              aria-label="Choose files to upload — click to browse or drop files here"
              className={cn(
                "flex min-h-40 w-full flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-4 py-8 text-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                dragOver
                  ? "border-primary bg-primary/10"
                  : "border bg-muted/30 hover:bg-muted/50"
              )}
            >
              <span
                aria-hidden="true"
                className="flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground"
              >
                <Upload className="size-5" />
              </span>
              <span className="text-sm font-medium text-foreground">
                Drop files here or click to browse
              </span>
              <span className="text-xs text-muted-foreground">
                Up to 10 MB per file{accept ? ` · accepted: ${accept}` : ""}
                {folder ? ` · uploads to “${folder}”` : ""}
              </span>
            </button>

            {staged.length > 0 ? (
              <div role="list" aria-label="Files ready to upload" className="space-y-2">
                {staged.map((file, i) => {
                  const StagedIcon = fileIconFor(file.type);
                  return (
                    <div
                      role="listitem"
                      key={`${file.name}-${file.size}-${i}`}
                      className="flex items-center gap-3 rounded-lg border bg-card px-3 py-1.5"
                    >
                      <StagedIcon
                        aria-hidden="true"
                        className="size-4 shrink-0 text-muted-foreground"
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-foreground">
                          {file.name}
                        </span>
                        <span className="block text-xs text-muted-foreground">
                          {formatBytes(file.size)}
                        </span>
                      </span>
                      <button
                        type="button"
                        onClick={() =>
                          setStaged((prev) => prev.filter((_, idx) => idx !== i))
                        }
                        aria-label={`Remove ${file.name} from upload list`}
                        className="flex size-11 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        <X className="size-4" aria-hidden="true" />
                      </button>
                    </div>
                  );
                })}
              </div>
            ) : null}

            <Button
              type="button"
              className="h-11 w-full sm:w-auto sm:self-end"
              disabled={staged.length === 0 || uploading}
              onClick={() => void runUpload()}
            >
              {uploading ? (
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              ) : (
                <Upload className="size-4" aria-hidden="true" />
              )}
              {uploading
                ? "Uploading…"
                : staged.length === 1
                  ? "Upload 1 file"
                  : `Upload ${staged.length} files`}
            </Button>
          </TabsContent>
        </Tabs>

        <DialogFooter className="flex-row items-center justify-between gap-3 border-t px-5 py-3">
          <span className="text-xs text-muted-foreground" aria-live="polite">
            {selected.length === 0
              ? "Nothing selected"
              : `${selected.length} selected`}
          </span>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              className="h-11"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              className="h-11"
              disabled={selected.length === 0}
              onClick={confirmPick}
            >
              <Check className="size-4" aria-hidden="true" />
              {selected.length > 1 ? `Use ${selected.length} files` : "Use file"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export interface FilePickButtonProps {
  label?: string;
  multiple?: boolean;
  accept?: string;
  folder?: string;
  onPicked: (files: FileAssetView[]) => void;
  variant?: React.ComponentProps<typeof Button>["variant"];
  size?: React.ComponentProps<typeof Button>["size"];
  className?: string;
}

/** One-liner integration: trigger Button + FilePickerDialog state wrapper. */
export function FilePickButton({
  label,
  multiple = false,
  accept,
  folder,
  onPicked,
  variant = "outline",
  size = "default",
  className,
}: FilePickButtonProps) {
  const [open, setOpen] = React.useState(false);
  return (
    <>
      <Button
        type="button"
        variant={variant}
        size={size}
        className={className}
        onClick={() => setOpen(true)}
      >
        <Paperclip className="size-4" aria-hidden="true" />
        {label ?? (multiple ? "Choose files" : "Choose file")}
      </Button>
      <FilePickerDialog
        open={open}
        onOpenChange={setOpen}
        multiple={multiple}
        accept={accept}
        folder={folder}
        onPicked={onPicked}
      />
    </>
  );
}
