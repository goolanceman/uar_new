"use client";

/**
 * File Manager — admin library over /api/files (round-6).
 *
 * List-page standard: PageHeader + 4 StatCards, SectionCard toolbar
 * (300ms-debounced search, folder filter, mime filter, ViewSwitcher,
 * CSV export, Upload), DataTable table view with thumbnails + actions
 * dropdown, responsive grid view, preview Dialog (inline image or icon +
 * metadata for non-images), FormSheet for upload (drag-and-drop, multiple
 * files, implicit folder creation) and edit, ConfirmDialog for deletes.
 *
 * Upload uses raw fetch + FormData (NOT api-client post, which JSON-encodes)
 * with the Bearer token from localStorage when present.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CalendarClock,
  Copy,
  Download,
  ExternalLink,
  File,
  FileArchive,
  FileAudio,
  FileSpreadsheet,
  FileText,
  FileVideo,
  Files,
  FolderOpen,
  HardDrive,
  Image as ImageIcon,
  MoreHorizontal,
  Pencil,
  RefreshCw,
  Search,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { del, get, getToken, patch } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { formatDateTime, timeAgo } from "@/lib/format";
import { PageHeader } from "@/components/shared/page-header";
import { StatCard } from "@/components/shared/stat-card";
import { SectionCard } from "@/components/shared/section-card";
import { EmptyState } from "@/components/shared/empty-state";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { FormSheet } from "@/components/shared/form-sheet";
import { DataField } from "@/components/shared/data-field";
import {
  FieldGrid,
  TextareaField,
  TextField,
} from "@/components/shared/form-fields";
import { CsvColumn, ExportMenu } from "@/components/shared/csv";
import { useViewPref, ViewSwitcher } from "@/components/shared/view-switcher";
import {
  DataTable,
  type DataTableColumn,
} from "@/components/shared/data-table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

/* ---------------------------------- types ---------------------------------- */

interface FileAsset {
  id: string;
  name: string;
  title?: string | null;
  description?: string | null;
  mime: string;
  size: number;
  folder: string;
  uploadedByName?: string | null;
  createdAt: string;
}

interface FilesResponse {
  items: FileAsset[];
  total: number;
  page: number;
  pages: number;
  stats?: { count: number; totalBytes: number };
}

interface EditForm {
  title: string;
  description: string;
  folder: string;
}

const EMPTY_EDIT: EditForm = { title: "", description: "", folder: "general" };

/* --------------------------------- helpers --------------------------------- */

/** File URL contract: always /api/files/{id}/file (download flag for saves). */
function fileUrl(f: FileAsset): string {
  return `/api/files/${f.id}/file`;
}

function isImage(mime: string): boolean {
  return (mime ?? "").toLowerCase().startsWith("image/");
}

function typeLabel(mime: string): string {
  const m = (mime ?? "").toLowerCase();
  if (m === "application/pdf") return "PDF";
  if (m.startsWith("image/")) return "Image";
  if (m.startsWith("video/")) return "Video";
  if (m.startsWith("audio/")) return "Audio";
  if (m.includes("zip") || m.includes("compressed") || m.includes("tar")) return "Archive";
  if (m.includes("spreadsheet") || m.includes("excel") || m.includes("csv")) return "Spreadsheet";
  if (m.includes("word") || m.includes("document")) return "Document";
  if (m.includes("json") || m.includes("xml")) return "Data";
  if (m.startsWith("text/")) return "Text";
  return "File";
}

/** Rendered type icon for non-image previews (grid cards, dialogs, lists). */
function fileTypeIcon(mime: string, className: string): React.ReactNode {
  const m = (mime ?? "").toLowerCase();
  if (m.startsWith("image/")) return <ImageIcon className={className} aria-hidden="true" />;
  if (m.startsWith("video/")) return <FileVideo className={className} aria-hidden="true" />;
  if (m.startsWith("audio/")) return <FileAudio className={className} aria-hidden="true" />;
  if (m.includes("zip") || m.includes("compressed") || m.includes("tar"))
    return <FileArchive className={className} aria-hidden="true" />;
  if (m.includes("spreadsheet") || m.includes("excel") || m.includes("csv"))
    return <FileSpreadsheet className={className} aria-hidden="true" />;
  if (m.startsWith("text/") || m.includes("pdf") || m.includes("word") || m.includes("document"))
    return <FileText className={className} aria-hidden="true" />;
  return <File className={className} aria-hidden="true" />;
}

/** Human-readable byte size for the storage KPI and per-file rows. */
function formatBytes(n: number | null | undefined): string {
  const b = Number(n ?? 0);
  if (!Number.isFinite(b) || b <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(units.length - 1, Math.floor(Math.log(b) / Math.log(1024)));
  const v = b / 1024 ** i;
  return `${i === 0 || v >= 100 ? Math.round(v) : v.toFixed(1)} ${units[i]}`;
}

/** Advisory accept list for the file input — the server is authoritative. */
const ACCEPTED_TYPES = [
  "image/*",
  "application/pdf",
  "text/plain",
  "text/csv",
  "text/markdown",
  "application/json",
  "application/xml",
  "application/zip",
  "application/x-zip-compressed",
  "application/gzip",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "audio/*",
  "video/*",
].join(",");

/** Client-side guard on clearly unsafe executables (server still validates). */
const BLOCKED_EXT = /\.(exe|bat|cmd|sh|msi|apk|dll|scr|com|jar)$/i;

const MIME_OPTIONS = [
  { value: "all", label: "All types" },
  { value: "image", label: "Images" },
  { value: "application", label: "Documents" },
  { value: "video", label: "Media" },
];

const CSV_COLUMNS: CsvColumn<FileAsset>[] = [
  { header: "Name", value: (f) => f.name },
  { header: "Title", value: (f) => f.title ?? "" },
  { header: "Description", value: (f) => f.description ?? "" },
  { header: "Folder", value: (f) => f.folder },
  { header: "Type", value: (f) => typeLabel(f.mime) },
  { header: "MIME", value: (f) => f.mime },
  { header: "Size (bytes)", value: (f) => f.size },
  { header: "Uploaded by", value: (f) => f.uploadedByName ?? "" },
  { header: "Uploaded at", value: (f) => f.createdAt },
];

/* ------------------------------- small pieces ------------------------------ */

/** Thumbnail: inline image for image/*, muted type-icon square otherwise. */
function FileThumb({ file, className }: { file: FileAsset; className?: string }) {
  if (isImage(file.mime)) {
    return (
      <img
        src={fileUrl(file)}
        alt={file.title || file.name}
        loading="lazy"
        className={cn(
          "size-10 shrink-0 rounded-lg border bg-muted/40 object-cover",
          className
        )}
      />
    );
  }
  const iconEl = fileTypeIcon(file.mime, "size-4");
  return (
    <span
      aria-hidden="true"
      className={cn(
        "flex size-10 shrink-0 items-center justify-center rounded-lg border bg-muted/50 text-muted-foreground",
        className
      )}
    >
      {iconEl}
    </span>
  );
}

/* ----------------------------------- view ---------------------------------- */

export default function FilesView() {
  const [items, setItems] = useState<FileAsset[]>([]);
  const [loading, setLoading] = useState(true);
  const [total, setTotal] = useState(0);
  const [pages, setPages] = useState(1);
  const [stats, setStats] = useState<{ count: number; totalBytes: number } | null>(null);

  /* toolbar (server-side filtering via q/folder/mime params) */
  const [query, setQuery] = useState("");
  const [appliedQuery, setAppliedQuery] = useState("");
  const [folderFilter, setFolderFilter] = useState("ALL");
  const [mimeFilter, setMimeFilter] = useState("all");
  const [view, setView] = useViewPref("files", "table");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  /* folders seen while browsing — feeds the filter + hints */
  const [knownFolders, setKnownFolders] = useState<Set<string>>(new Set());

  /* upload sheet */
  const [uploadOpen, setUploadOpen] = useState(false);
  const [pending, setPending] = useState<File[]>([]);
  const [upFolder, setUpFolder] = useState("general");
  const [upTitle, setUpTitle] = useState("");
  const [upDescription, setUpDescription] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  /* edit sheet */
  const [editTarget, setEditTarget] = useState<FileAsset | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [editForm, setEditForm] = useState<EditForm>(EMPTY_EDIT);
  const [editSnapshot, setEditSnapshot] = useState<string>(JSON.stringify(EMPTY_EDIT));
  const [saving, setSaving] = useState(false);

  /* delete + preview */
  const [deleteTarget, setDeleteTarget] = useState<FileAsset | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [previewFile, setPreviewFile] = useState<FileAsset | null>(null);

  const pageSafe = Math.min(page, pages);

  /* ------------------------------- data load ------------------------------- */

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (appliedQuery.trim()) params.set("q", appliedQuery.trim());
      if (folderFilter !== "ALL") params.set("folder", folderFilter);
      if (mimeFilter !== "all") params.set("mime", mimeFilter);
      params.set("page", String(pageSafe));
      params.set("limit", String(pageSize));
      const data = await get<FilesResponse>(`/api/files?${params.toString()}`);
      const loaded = Array.isArray(data?.items) ? data.items : [];
      setItems(loaded);
      setTotal(typeof data?.total === "number" ? data.total : loaded.length);
      setPages(Math.max(1, typeof data?.pages === "number" ? data.pages : 1));
      if (data?.stats && typeof data.stats.count === "number") {
        setStats({ count: data.stats.count, totalBytes: data.stats.totalBytes ?? 0 });
      }
      setKnownFolders((prev) => {
        const next = new Set(prev);
        for (const it of loaded) if (it.folder) next.add(it.folder);
        return next;
      });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load files");
    } finally {
      setLoading(false);
    }
  }, [appliedQuery, folderFilter, mimeFilter, pageSafe, pageSize]);

  useEffect(() => {
    load();
  }, [load]);

  /* debounce search input → applied filter (300ms) */
  useEffect(() => {
    const t = window.setTimeout(() => {
      setAppliedQuery(query);
      setPage(1);
    }, 300);
    return () => window.clearTimeout(t);
  }, [query]);

  /* folder filter options: "general" + every folder seen in loaded data */
  const folderOptions = useMemo(() => {
    const set = new Set<string>(["general"]);
    knownFolders.forEach((f) => set.add(f));
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [knownFolders]);

  const hasFilters =
    appliedQuery.trim() !== "" || folderFilter !== "ALL" || mimeFilter !== "all";

  const clearFilters = () => {
    setQuery("");
    setAppliedQuery("");
    setFolderFilter("ALL");
    setMimeFilter("all");
    setPage(1);
  };

  /* ------------------------------ file actions ----------------------------- */

  const copyUrl = async (f: FileAsset) => {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}${fileUrl(f)}`);
      toast.success("File URL copied to clipboard");
    } catch {
      toast.error("Could not copy the URL");
    }
  };

  const downloadFile = (f: FileAsset) => {
    const a = document.createElement("a");
    a.href = `${fileUrl(f)}?download=1`;
    a.download = f.name;
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  const openInNewTab = (f: FileAsset) => {
    window.open(fileUrl(f), "_blank", "noopener,noreferrer");
  };

  /* ------------------------------- upload flow ----------------------------- */

  const addFiles = (list: FileList | null) => {
    if (!list || list.length === 0) return;
    const all = Array.from(list);
    const blocked = all.filter((f) => BLOCKED_EXT.test(f.name));
    const ok = all.filter((f) => !BLOCKED_EXT.test(f.name));
    if (blocked.length > 0) {
      toast.error(
        `Skipped ${blocked.length} file${blocked.length === 1 ? "" : "s"} — executable files are not allowed`
      );
    }
    if (ok.length > 0) setPending((prev) => [...prev, ...ok]);
  };

  const resetUploadForm = () => {
    setPending([]);
    setUpFolder("general");
    setUpTitle("");
    setUpDescription("");
    setDragOver(false);
  };

  const uploadDirty =
    pending.length > 0 ||
    upTitle.trim() !== "" ||
    upDescription.trim() !== "" ||
    upFolder.trim() !== "general";

  const upload = async () => {
    if (pending.length === 0) {
      toast.error("Choose at least one file to upload");
      return;
    }
    if (!upFolder.trim()) {
      toast.error("Folder name is required");
      return;
    }
    setUploading(true);
    try {
      const fd = new FormData();
      pending.forEach((f) => fd.append("file", f));
      fd.append("folder", upFolder.trim());
      if (upTitle.trim()) fd.append("title", upTitle.trim());
      if (upDescription.trim()) fd.append("description", upDescription.trim());

      // Multipart upload — raw fetch (api-client post JSON-encodes the body).
      const token = getToken();
      const headers: Record<string, string> = {};
      if (token) headers.Authorization = `Bearer ${token}`;
      const res = await fetch("/api/files", {
        method: "POST",
        headers,
        body: fd,
      });
      const data = (await res.json().catch(() => null)) as {
        files?: FileAsset[];
        error?: string;
      } | null;
      if (!res.ok) {
        throw new Error(data?.error || `Upload failed (${res.status})`);
      }
      const n = Array.isArray(data?.files) ? data.files.length : pending.length;
      toast.success(`${n} file${n === 1 ? "" : "s"} uploaded`);
      setUploadOpen(false);
      resetUploadForm();
      setPage(1);
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  /* -------------------------------- edit flow ------------------------------ */

  const openEdit = (f: FileAsset) => {
    setEditTarget(f);
    const form: EditForm = {
      title: f.title ?? "",
      description: f.description ?? "",
      folder: f.folder || "general",
    };
    setEditForm(form);
    setEditSnapshot(JSON.stringify(form));
    setEditOpen(true);
  };

  const editDirty = editOpen && JSON.stringify(editForm) !== editSnapshot;

  const saveEdit = async () => {
    if (!editTarget) return;
    if (!editForm.folder.trim()) {
      toast.error("Folder name is required");
      return;
    }
    setSaving(true);
    try {
      await patch(`/api/files/${editTarget.id}`, {
        title: editForm.title.trim() || undefined,
        description: editForm.description.trim() || undefined,
        folder: editForm.folder.trim(),
      });
      toast.success(`${editTarget.name} updated`);
      setEditOpen(false);
      setEditTarget(null);
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  /* ------------------------------- delete flow ----------------------------- */

  const remove = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await del(`/api/files/${deleteTarget.id}`);
      toast.success(`${deleteTarget.name} deleted`);
      setDeleteTarget(null);
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Delete failed");
    } finally {
      setDeleting(false);
    }
  };

  /* ------------------------------ actions menus ---------------------------- */

  const rowMenu = (f: FileAsset) => (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="size-11 md:size-8"
          aria-label={`Actions for ${f.name}`}
          onClick={(e) => e.stopPropagation()}
        >
          <MoreHorizontal className="size-4" aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="w-48"
        onClick={(e) => e.stopPropagation()}
      >
        <DropdownMenuItem onSelect={() => void copyUrl(f)}>
          <Copy className="size-4" aria-hidden="true" /> Copy URL
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => setPreviewFile(f)}>
          <ExternalLink className="size-4" aria-hidden="true" /> Open / preview
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => downloadFile(f)}>
          <Download className="size-4" aria-hidden="true" /> Download
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => openEdit(f)}>
          <Pencil className="size-4" aria-hidden="true" /> Edit
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() => setDeleteTarget(f)}
          className="text-red-600 focus:text-red-600 dark:text-red-400"
        >
          <Trash2 className="size-4" aria-hidden="true" /> Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );

  /** Quick icon actions for grid cards (preview is the card itself). */
  const quickActions = (f: FileAsset) => (
    <>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="size-11 md:size-8"
        aria-label={`Copy URL for ${f.name}`}
        onClick={() => void copyUrl(f)}
      >
        <Copy className="size-4" aria-hidden="true" />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="size-11 md:size-8"
        aria-label={`Download ${f.name}`}
        onClick={() => downloadFile(f)}
      >
        <Download className="size-4" aria-hidden="true" />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="size-11 md:size-8"
        aria-label={`Edit ${f.name}`}
        onClick={() => openEdit(f)}
      >
        <Pencil className="size-4" aria-hidden="true" />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="size-11 text-red-600 hover:bg-red-500/10 hover:text-red-700 md:size-8 dark:text-red-400"
        aria-label={`Delete ${f.name}`}
        onClick={() => setDeleteTarget(f)}
      >
        <Trash2 className="size-4" aria-hidden="true" />
      </Button>
    </>
  );

  /* ------------------------------- table columns ---------------------------- */

  const columns: DataTableColumn<FileAsset>[] = [
    { key: "file", header: "File" },
    { key: "folder", header: "Folder", hideBelow: "sm" },
    { key: "type", header: "Type", hideBelow: "md" },
    { key: "size", header: "Size", align: "right", mono: true },
    { key: "by", header: "Uploaded by", hideBelow: "lg" },
    { key: "date", header: "Uploaded", hideBelow: "md" },
    { key: "actions", header: "", align: "right", className: "w-12" },
  ];

  /* --------------------------------- stats --------------------------------- */

  const totalFiles = stats?.count ?? total;
  const storageBytes = stats?.totalBytes ?? items.reduce((s, f) => s + (f.size || 0), 0);
  const imageCount = items.filter((f) => isImage(f.mime)).length;
  const weekCount = items.filter((f) => {
    const t = new Date(f.createdAt).getTime();
    return Number.isFinite(t) && Date.now() - t < 7 * 24 * 60 * 60 * 1000;
  }).length;

  const emptyNode = hasFilters ? (
    <EmptyState
      icon={<Search className="size-8" aria-hidden="true" />}
      title="No files match the filters"
      hint="Try a different search term, folder or type filter."
    >
      <Button variant="outline" onClick={clearFilters}>
        Reset filters
      </Button>
    </EmptyState>
  ) : (
    <EmptyState
      icon={<FolderOpen className="size-8" aria-hidden="true" />}
      title="No files yet"
      hint="Upload your first file to build the shared library — images, documents and media all live here."
    >
      <Button onClick={() => setUploadOpen(true)}>
        <Upload className="size-4" aria-hidden="true" /> Upload your first file
      </Button>
    </EmptyState>
  );

  /* --------------------------------- render -------------------------------- */

  return (
    <div className="space-y-6">
      <PageHeader
        title="File Manager"
        description="Shared library of images, documents and media across programmes."
        icon={<FolderOpen className="size-5" aria-hidden="true" />}
        actions={
          <Button variant="outline" onClick={load} aria-label="Refresh files">
            <RefreshCw className="size-4" aria-hidden="true" /> Refresh
          </Button>
        }
      />

      {/* stats */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Total files"
          value={totalFiles}
          accent="emerald"
          icon={<Files className="size-5" aria-hidden="true" />}
          loading={loading}
        />
        <StatCard
          label="Storage used"
          value={formatBytes(storageBytes)}
          accent="teal"
          icon={<HardDrive className="size-5" aria-hidden="true" />}
          loading={loading}
        />
        <StatCard
          label="Images"
          value={imageCount}
          accent="cyan"
          icon={<ImageIcon className="size-5" aria-hidden="true" />}
          loading={loading}
          hint="in current view"
        />
        <StatCard
          label="Uploads this week"
          value={weekCount}
          accent="amber"
          icon={<CalendarClock className="size-5" aria-hidden="true" />}
          loading={loading}
          hint="in current view"
        />
      </div>

      {/* toolbar */}
      <SectionCard
        title="Browse files"
        description="Search, filter and export the library."
        icon={<Search className="size-4.5" aria-hidden="true" />}
      >
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative w-full sm:w-56">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden="true"
            />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search file name, title…"
              aria-label="Search files"
              className="pl-9"
            />
          </div>
          <Select
            value={folderFilter}
            onValueChange={(v) => {
              setFolderFilter(v);
              setPage(1);
            }}
          >
            <SelectTrigger className="w-full sm:w-44" aria-label="Filter by folder">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All folders</SelectItem>
              {folderOptions.map((f) => (
                <SelectItem key={f} value={f}>
                  {f}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={mimeFilter}
            onValueChange={(v) => {
              setMimeFilter(v);
              setPage(1);
            }}
          >
            <SelectTrigger className="w-full sm:w-36" aria-label="Filter by type">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {MIME_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {hasFilters && (
            <Button
              variant="ghost"
              size="sm"
              className="min-h-9"
              onClick={clearFilters}
              aria-label="Clear filters"
            >
              Clear
            </Button>
          )}
          <div className="flex flex-wrap items-center gap-2 sm:ml-auto">
            <ViewSwitcher
              value={view}
              onChange={setView}
              options={["table", "grid"]}
            />
            <ExportMenu
              columns={CSV_COLUMNS}
              rows={items}
              filename="uar-files"
              disabled={loading || items.length === 0}
            />
            <Button size="sm" className="min-h-9" onClick={() => setUploadOpen(true)}>
              <Upload className="size-4" aria-hidden="true" /> Upload files
            </Button>
          </div>
        </div>
      </SectionCard>

      {/* table view */}
      {view === "table" ? (
        <DataTable
          columns={columns}
          rows={items}
          rowKey={(f) => f.id}
          loading={loading}
          skeletonRows={8}
          height="fill"
          fillOffset={380}
          onRowClick={setPreviewFile}
          page={pageSafe}
          pages={pages}
          total={total}
          pageSize={pageSize}
          onPage={setPage}
          onPageSize={(n) => {
            setPageSize(n);
            setPage(1);
          }}
          itemLabel="files"
          empty={emptyNode}
        >
          {(f, col) => {
            switch (col.key) {
              case "file":
                return (
                  <div className="flex min-w-0 items-center gap-3">
                    <FileThumb file={f} />
                    <div className="min-w-0">
                      <p className="truncate font-medium">{f.name}</p>
                      {f.title?.trim() ? (
                        <p className="truncate text-xs text-muted-foreground">{f.title}</p>
                      ) : null}
                    </div>
                  </div>
                );
              case "folder":
                return (
                  <Badge variant="secondary" className="max-w-32 truncate font-normal">
                    {f.folder}
                  </Badge>
                );
              case "type":
                return <span className="text-sm">{typeLabel(f.mime)}</span>;
              case "size":
                return <span>{formatBytes(f.size)}</span>;
              case "by":
                return (
                  <span className="block max-w-36 truncate text-sm text-muted-foreground">
                    {f.uploadedByName || "—"}
                  </span>
                );
              case "date":
                return (
                  <span
                    title={formatDateTime(f.createdAt)}
                    className="text-muted-foreground"
                  >
                    {timeAgo(f.createdAt)}
                  </span>
                );
              case "actions":
                return <div className="flex justify-end">{rowMenu(f)}</div>;
              default:
                return null;
            }
          }}
        </DataTable>
      ) : null}

      {/* grid view */}
      {view === "grid" ? (
        loading ? (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3" aria-busy="true">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-60 rounded-xl" />
            ))}
          </div>
        ) : items.length === 0 ? (
          emptyNode
        ) : (
          <>
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {items.map((f) => (
                  <div
                    key={f.id}
                    className="flex flex-col gap-2 rounded-xl border bg-card p-3 shadow-sm transition hover:shadow-md"
                  >
                    <button
                      type="button"
                      onClick={() => setPreviewFile(f)}
                      aria-label={`Preview ${f.name}`}
                      className="overflow-hidden rounded-lg border bg-muted/30 focus-visible:outline-2 focus-visible:outline-primary"
                    >
                      <span className="flex h-36 w-full items-center justify-center">
                        {isImage(f.mime) ? (
                          <img
                            src={fileUrl(f)}
                            alt={f.title || f.name}
                            loading="lazy"
                            className="size-full object-cover"
                          />
                        ) : (
                          fileTypeIcon(f.mime, "size-10 text-muted-foreground")
                        )}
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setPreviewFile(f)}
                      aria-label={`Preview ${f.name}`}
                      className="min-w-0 text-left focus-visible:outline-2 focus-visible:outline-primary"
                    >
                      <p className="truncate text-sm font-medium">{f.name}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {f.title?.trim() ? f.title : typeLabel(f.mime)}
                      </p>
                    </button>
                    <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                      <span className="tabular-nums">
                        {formatBytes(f.size)} · {timeAgo(f.createdAt)}
                      </span>
                      <Badge variant="secondary" className="max-w-28 truncate font-normal">
                        {f.folder}
                      </Badge>
                    </div>
                    <div className="mt-auto flex items-center gap-0.5 border-t pt-2">
                      {quickActions(f)}
                    </div>
                  </div>
              ))}
            </div>
            {pages > 1 ? (
              <div className="flex justify-center">
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="min-h-9"
                    disabled={pageSafe <= 1}
                    onClick={() => setPage(pageSafe - 1)}
                    aria-label="Previous page"
                  >
                    Previous
                  </Button>
                  <span className="text-xs text-muted-foreground tabular-nums">
                    Page {pageSafe} of {pages} · {total} files
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    className="min-h-9"
                    disabled={pageSafe >= pages}
                    onClick={() => setPage(pageSafe + 1)}
                    aria-label="Next page"
                  >
                    Next
                  </Button>
                </div>
              </div>
            ) : null}
          </>
        )
      ) : null}

      {/* ============================== PREVIEW DIALOG ============================ */}
      <Dialog open={!!previewFile} onOpenChange={(o) => !o && setPreviewFile(null)}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex min-w-0 items-center gap-2.5 pr-6">
              {previewFile ? <FileThumb file={previewFile} /> : null}
              <span className="min-w-0 truncate">{previewFile?.name ?? "File"}</span>
            </DialogTitle>
            <DialogDescription>
              {previewFile
                ? `${typeLabel(previewFile.mime)} · ${formatBytes(previewFile.size)} · ${previewFile.folder}`
                : ""}
            </DialogDescription>
          </DialogHeader>
          {previewFile ? (
            <>
              {isImage(previewFile.mime) ? (
                <img
                  src={fileUrl(previewFile)}
                  alt={previewFile.title || previewFile.name}
                  className="max-h-[50vh] w-full rounded-lg border bg-muted/40 object-contain"
                />
              ) : (
                <div className="flex h-40 items-center justify-center rounded-lg border bg-muted/40">
                  {fileTypeIcon(previewFile.mime, "size-12 text-muted-foreground")}
                </div>
              )}

              {previewFile.description?.trim() ? (
                <p className="text-sm leading-relaxed text-muted-foreground">
                  {previewFile.description}
                </p>
              ) : null}

              <div className="grid gap-3 sm:grid-cols-2">
                <DataField label="Folder" value={previewFile.folder} />
                <DataField
                  label="Type"
                  value={`${typeLabel(previewFile.mime)} · ${previewFile.mime}`}
                />
                <DataField label="Size" value={formatBytes(previewFile.size)} mono />
                <DataField label="Uploaded by" value={previewFile.uploadedByName ?? ""} />
                <DataField
                  label="Uploaded at"
                  value={formatDateTime(previewFile.createdAt)}
                />
                {previewFile.title?.trim() ? (
                  <DataField label="Title" value={previewFile.title} />
                ) : null}
              </div>

              <DialogFooter className="flex-wrap gap-2 sm:justify-start">
                <Button variant="outline" size="sm" className="min-h-9" onClick={() => void copyUrl(previewFile)}>
                  <Copy className="size-4" aria-hidden="true" /> Copy URL
                </Button>
                <Button variant="outline" size="sm" className="min-h-9" onClick={() => openInNewTab(previewFile)}>
                  <ExternalLink className="size-4" aria-hidden="true" /> Open in new tab
                </Button>
                <Button variant="outline" size="sm" className="min-h-9" onClick={() => downloadFile(previewFile)}>
                  <Download className="size-4" aria-hidden="true" /> Download
                </Button>
                <Button
                  size="sm"
                  className="min-h-9"
                  onClick={() => {
                    const target = previewFile;
                    setPreviewFile(null);
                    openEdit(target);
                  }}
                >
                  <Pencil className="size-4" aria-hidden="true" /> Edit
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="min-h-9 text-red-600 hover:bg-red-500/10 hover:text-red-700 dark:text-red-400"
                  onClick={() => {
                    const target = previewFile;
                    setPreviewFile(null);
                    setDeleteTarget(target);
                  }}
                >
                  <Trash2 className="size-4" aria-hidden="true" /> Delete
                </Button>
              </DialogFooter>
            </>
          ) : null}
        </DialogContent>
      </Dialog>

      {/* ============================== UPLOAD FORMSHEET ========================== */}
      <FormSheet
        open={uploadOpen}
        onOpenChange={(o) => {
          if (!o && !uploading) {
            setUploadOpen(false);
            resetUploadForm();
          }
        }}
        title="Upload files"
        description="Add one or more files to the shared library. New folders are created automatically."
        onSubmit={upload}
        submitLabel="Upload"
        loading={uploading}
        dirty={uploadDirty}
        size="md"
      >
        <div className="flex flex-col gap-5">
          {/* drop zone + hidden multi-file input */}
          <div
            role="button"
            tabIndex={0}
            aria-label="Choose files or drag and drop here"
            onClick={() => fileInputRef.current?.click()}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                fileInputRef.current?.click();
              }
            }}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              addFiles(e.dataTransfer.files);
            }}
            className={cn(
              "flex min-h-36 cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-4 py-6 text-center outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
              dragOver
                ? "border-primary bg-primary/5"
                : "border-muted-foreground/30 hover:border-primary/50 hover:bg-muted/40"
            )}
          >
            <Upload
              className={cn("size-6", dragOver ? "text-primary" : "text-muted-foreground")}
              aria-hidden="true"
            />
            <p className="text-sm font-medium">
              {dragOver ? "Drop files to add them" : "Drag & drop files here"}
            </p>
            <p className="text-xs text-muted-foreground">
              or click to browse — multiple files supported
            </p>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept={ACCEPTED_TYPES}
            className="hidden"
            aria-hidden="true"
            tabIndex={-1}
            onChange={(e) => {
              addFiles(e.target.files);
              e.target.value = "";
            }}
          />

          {pending.length > 0 && (
            <ul className="space-y-1.5" aria-label="Selected files">
              {pending.map((f, idx) => (
                  <li
                    key={`${f.name}-${idx}`}
                    className="flex items-center gap-2 rounded-lg border bg-muted/30 px-2.5 py-2"
                  >
                    {fileTypeIcon(f.type, "size-4 shrink-0 text-muted-foreground")}
                    <span className="min-w-0 flex-1 truncate text-sm">{f.name}</span>
                    <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                      {formatBytes(f.size)}
                    </span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="size-9 shrink-0 text-muted-foreground hover:text-foreground sm:size-7"
                      aria-label={`Remove ${f.name}`}
                      onClick={() => setPending((prev) => prev.filter((_, i) => i !== idx))}
                    >
                      <X className="size-3.5" aria-hidden="true" />
                    </Button>
                  </li>
              ))}
            </ul>
          )}

          <FieldGrid>
            <TextField
              label="Folder"
              required
              value={upFolder}
              onChange={setUpFolder}
              placeholder="general"
              hint={
                folderOptions.length > 1
                  ? `Existing: ${folderOptions.join(", ")} — type a new name to create one`
                  : "Type a new folder name to create one"
              }
            />
            <TextField
              label="Title (optional)"
              value={upTitle}
              onChange={setUpTitle}
              placeholder="e.g. Food drive photos"
            />
          </FieldGrid>
          <TextareaField
            label="Description (optional)"
            value={upDescription}
            onChange={setUpDescription}
            placeholder="What are these files for?"
            rows={3}
          />
        </div>
      </FormSheet>

      {/* =============================== EDIT FORMSHEET =========================== */}
      <FormSheet
        open={editOpen}
        onOpenChange={(o) => {
          if (!o && !saving) {
            setEditOpen(false);
            setEditTarget(null);
          }
        }}
        title={editTarget?.name ?? "Edit file"}
        description="Update the title, description or folder. A new folder name is created automatically."
        onSubmit={saveEdit}
        submitLabel="Save changes"
        loading={saving}
        dirty={editDirty}
        size="sm"
        badge={
          editTarget ? (
            <Badge variant="secondary" className="font-normal">
              {editTarget.folder}
            </Badge>
          ) : undefined
        }
      >
        <FieldGrid>
          <TextField
            label="Title"
            value={editForm.title}
            onChange={(v) => setEditForm((f) => ({ ...f, title: v }))}
            placeholder="Display title"
          />
          <TextField
            label="Folder"
            required
            value={editForm.folder}
            onChange={(v) => setEditForm((f) => ({ ...f, folder: v }))}
            hint={
              folderOptions.length > 1
                ? `Existing: ${folderOptions.join(", ")} — type a new name to move it`
                : "Type a new folder name to move the file"
            }
          />
        </FieldGrid>
        <TextareaField
          label="Description"
          value={editForm.description}
          onChange={(v) => setEditForm((f) => ({ ...f, description: v }))}
          placeholder="Optional notes about this file"
          rows={3}
        />
      </FormSheet>

      {/* ============================== DELETE CONFIRM ============================ */}
      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
        title="Delete file"
        recordName={deleteTarget?.name ?? null}
        description="This permanently removes the file from the library. Links or pages using it will lose the asset."
        confirmLabel="Delete file"
        loading={deleting}
        onConfirm={remove}
      />
    </div>
  );
}
