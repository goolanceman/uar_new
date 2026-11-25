"use client";

/**
 * Testimonials — admin curation for the public testimonial wall.
 *
 * Backend contract (routes/testimonials.ts — Testimonial prisma model):
 *  - GET  /api/testimonials            public wall — newest first, capped at 12
 *  - POST /api/testimonials            ADMIN — { name, role, message, rating? }
 *  - PATCH/DELETE /api/testimonials/:id ADMIN — partial update / remove
 *
 * NOTE: the Testimonial model has NO photo/approved columns — the wall shows
 * the 12 most recent entries, so "curation" means keeping that top-12 list
 * honest. This view mirrors exactly the fields the backend stores.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Info,
  MessageSquareQuote,
  MoreHorizontal,
  Pencil,
  Plus,
  RefreshCw,
  Star,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { del, get, patch, post } from "@/lib/api-client";
import { formatDate, initials, titleCase } from "@/lib/format";
import { cn } from "@/lib/utils";
import { fieldError, minLen, required } from "@/lib/validators";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { FormSheet } from "@/components/shared/form-sheet";
import {
  FieldGrid,
  FormSection,
  SelectField,
  TextField,
  TextareaField,
} from "@/components/shared/form-fields";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { DataTable, type DataTableColumn } from "@/components/shared/data-table";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/* ─────────────────────────────── types ─────────────────────────────── */

interface Testimonial {
  id: string;
  name: string;
  role: string;
  message: string;
  rating: number;
  createdAt: string;
}

type RuleErr = Record<string, string | null>;

const RATING_OPTIONS = [5, 4, 3, 2, 1].map((n) => ({
  value: String(n),
  label: `${n} star${n === 1 ? "" : "s"}`,
}));

function RatingStars({ rating, className }: { rating: number; className?: string }) {
  return (
    <span
      className={cn("inline-flex items-center gap-0.5", className)}
      aria-label={`Rated ${rating} out of 5`}
      title={`${rating} out of 5`}
    >
      {[1, 2, 3, 4, 5].map((n) => (
        <Star
          key={n}
          className={cn(
            "size-3.5",
            n <= rating ? "fill-amber-400 text-amber-400" : "text-muted-foreground/30"
          )}
          aria-hidden="true"
        />
      ))}
    </span>
  );
}

/* ─────────────────────────────── view ──────────────────────────────── */

export default function TestimonialsView() {
  const [rows, setRows] = useState<Testimonial[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);

  /* form state */
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Testimonial | null>(null);
  const [name, setName] = useState("");
  const [role, setRole] = useState("");
  const [message, setMessage] = useState("");
  const [rating, setRating] = useState("5");
  const [errors, setErrors] = useState<RuleErr>({});
  const [saving, setSaving] = useState(false);

  const [deleteTarget, setDeleteTarget] = useState<Testimonial | null>(null);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const data = await get<Testimonial[]>("/api/testimonials");
      setRows(Array.isArray(data) ? data : []);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Failed to load testimonials");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load, revision]);

  const openCreate = () => {
    setEditing(null);
    setName("");
    setRole("");
    setMessage("");
    setRating("5");
    setErrors({});
    setFormOpen(true);
  };

  const openEdit = (t: Testimonial) => {
    setEditing(t);
    setName(t.name);
    setRole(t.role);
    setMessage(t.message);
    setRating(String(t.rating));
    setErrors({});
    setFormOpen(true);
  };

  const save = async () => {
    const errs: RuleErr = {
      name: fieldError(name, [required("Name"), minLen(2, "Name")]),
      role: fieldError(role, [required("Role / city"), minLen(2, "Role / city")]),
      message: fieldError(message, [required("Message"), minLen(10, "Message")]),
    };
    setErrors(errs);
    if (Object.values(errs).some(Boolean)) return;

    setSaving(true);
    try {
      const payload = { name: name.trim(), role: role.trim(), message: message.trim(), rating: Number(rating) };
      if (editing) {
        await patch(`/api/testimonials/${editing.id}`, payload);
        toast.success("Testimonial updated");
      } else {
        await post("/api/testimonials", payload);
        toast.success("Testimonial added to the wall");
      }
      setFormOpen(false);
      setRevision((r) => r + 1);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to save testimonial");
    } finally {
      setSaving(false);
    }
  };

  const runDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await del(`/api/testimonials/${deleteTarget.id}`);
      toast.success("Testimonial removed");
      setDeleteTarget(null);
      setRevision((r) => r + 1);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to delete testimonial");
    } finally {
      setDeleting(false);
    }
  };

  const csvRows = useMemo(() => rows.length, [rows]);

  const columns: DataTableColumn<Testimonial>[] = [
    {
      key: "name",
      header: "Person",
      accessor: (t) => (
        <div className="flex items-center gap-2.5">
          <Avatar className="size-8">
            <AvatarFallback className="bg-primary/10 text-xs font-semibold text-primary">
              {initials(t.name)}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0">
            <p className="truncate font-medium">{t.name}</p>
            <p className="truncate text-xs text-muted-foreground">{t.role}</p>
          </div>
        </div>
      ),
    },
    {
      key: "message",
      header: "Message",
      accessor: (t) => (
        <p className="line-clamp-2 max-w-md text-sm text-muted-foreground">{t.message}</p>
      ),
    },
    {
      key: "rating",
      header: "Rating",
      hideBelow: "md",
      accessor: (t) => <RatingStars rating={t.rating} />,
    },
    {
      key: "created",
      header: "Added",
      hideBelow: "sm",
      accessor: (t) => (
        <span className="whitespace-nowrap text-xs text-muted-foreground">
          {formatDate(t.createdAt)}
        </span>
      ),
    },
    {
      key: "actions",
      header: "Actions",
      align: "right",
      className: "w-12",
      accessor: (t) => (
        <div className="flex justify-end" onClick={(e) => e.stopPropagation()}>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="size-8"
                aria-label={`Actions for testimonial from ${t.name}`}
              >
                <MoreHorizontal className="size-4" aria-hidden="true" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-40">
              <DropdownMenuItem onClick={() => openEdit(t)}>
                <Pencil className="size-4" aria-hidden="true" /> Edit
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="text-red-600 focus:text-red-600 dark:text-red-400 dark:focus:text-red-400"
                onClick={() => setDeleteTarget(t)}
              >
                <Trash2 className="size-4" aria-hidden="true" /> Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-4 sm:space-y-6">
      <PageHeader
        title="Testimonials"
        description="Curate the public testimonial wall — the 12 most recent entries appear on the home page."
        icon={<MessageSquareQuote className="size-5" aria-hidden="true" />}
        actions={
          <>
            <Button
              variant="outline"
              onClick={() => setRevision((r) => r + 1)}
              aria-label="Refresh testimonials"
            >
              <RefreshCw className="size-4" aria-hidden="true" /> Refresh
            </Button>
            <Button onClick={openCreate}>
              <Plus className="size-4" aria-hidden="true" /> Add testimonial
            </Button>
          </>
        }
      />

      {loadError ? (
        <div
          role="alert"
          className="flex flex-wrap items-center gap-2 rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive"
        >
          <Info className="size-4" aria-hidden="true" /> {loadError}
          <Button variant="outline" size="sm" className="ml-auto" onClick={() => setRevision((r) => r + 1)}>
            Retry
          </Button>
        </div>
      ) : (
        <>
          <p className="text-xs text-muted-foreground" aria-live="polite">
            {loading ? "Loading…" : `${csvRows} testimonial${csvRows === 1 ? "" : "s"}`}
          </p>
          <DataTable
            columns={columns}
            rows={rows}
            rowKey={(t) => t.id}
            loading={loading}
            skeletonRows={5}
            height="fill"
            fillOffset={300}
            itemLabel="testimonials"
            empty={
              <EmptyState
                icon={<MessageSquareQuote className="size-8" aria-hidden="true" />}
                title="No testimonials yet"
                hint="Add a supporter quote with a name, role/city, message and star rating — it appears on the public home page wall immediately."
              >
                <Button variant="outline" onClick={openCreate}>
                  <Plus className="size-4" aria-hidden="true" /> Add the first testimonial
                </Button>
              </EmptyState>
            }
          />
        </>
      )}

      {/* ------------------------ create / edit FormSheet ------------------------ */}
      <FormSheet
        open={formOpen}
        onOpenChange={(o) => {
          if (!o) setFormOpen(false);
        }}
        title={editing ? "Edit testimonial" : "Add testimonial"}
        description="Shown on the public home page wall — keep quotes real and attributed."
        size="sm"
        submitLabel={editing ? "Save changes" : "Add testimonial"}
        loading={saving}
        dirty
        onSubmit={save}
        badge={
          editing ? (
            <Badge variant="outline" className="text-[10px] text-muted-foreground">
              {titleCase(editing.name)}
            </Badge>
          ) : null
        }
      >
        <FormSection title="Attribution" description="Who said it, and how to describe them.">
          <FieldGrid>
            <TextField
              label="Name"
              required
              value={name}
              onChange={(v) => {
                setName(v);
                setErrors((e) => ({ ...e, name: null }));
              }}
              placeholder="e.g. Meena R."
              error={errors.name}
            />
            <TextField
              label="Role / city"
              required
              value={role}
              onChange={(v) => {
                setRole(v);
                setErrors((e) => ({ ...e, role: null }));
              }}
              placeholder="e.g. Monthly donor, Bengaluru"
              error={errors.role}
            />
          </FieldGrid>
        </FormSection>

        <FormSection title="Quote & rating">
          <TextareaField
            label="Message"
            required
            value={message}
            onChange={(v) => {
              setMessage(v);
              setErrors((e) => ({ ...e, message: null }));
            }}
            placeholder="The quote that appears on the wall…"
            rows={4}
            error={errors.message}
          />
          <SelectField
            label="Rating"
            value={rating}
            onChange={setRating}
            options={RATING_OPTIONS}
          />
          <div className="rounded-lg border bg-muted/30 px-3 py-2.5">
            <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              Preview
            </p>
            <RatingStars rating={Number(rating) || 0} className="mt-1" />
          </div>
        </FormSection>
      </FormSheet>

      {/* ------------------------------ delete confirm ------------------------- */}
      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(o) => {
          if (!o) setDeleteTarget(null);
        }}
        title="Delete this testimonial?"
        recordName={deleteTarget ? `${deleteTarget.name} · ${deleteTarget.role}` : null}
        description="The quote is removed from the public wall immediately. This cannot be undone."
        confirmLabel="Delete testimonial"
        loading={deleting}
        onConfirm={runDelete}
      />
    </div>
  );
}
