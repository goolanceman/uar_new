"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Baby,
  Flower2,
  Heart,
  HeartHandshake,
  Loader2,
  Package,
  PawPrint,
  Pencil,
  Pill,
  Plus,
  ShieldAlert,
  Smartphone,
  Siren,
  Sprout,
  Star,
  Trash2,
  Users,
} from "lucide-react";
import { toast } from "sonner";
import { del, get, patch, post } from "@/lib/api-client";
import { cn, formatINR, titleCase } from "@/lib/utils";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Progress } from "@/components/ui/progress";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

/* ------------------------------ types & helpers ----------------------------- */

interface Campaign {
  id: string;
  title: string;
  slug?: string | null;
  tagline?: string | null;
  description: string;
  category: string;
  targetAmount: number;
  raisedAmount: number;
  status: string;
  icon: string;
  accent: string;
  helpline?: string | null;
  featured: boolean;
  beneficiaries: number;
  volunteersEngaged: number;
}

const CATEGORIES = ["AWARENESS", "SAFETY", "MEDICAL", "FOOD_DISTRIBUTION", "SANITARY_PADS", "GENERAL"];
const STATUSES = ["DRAFT", "ACTIVE", "PAUSED", "COMPLETED", "CANCELLED"];

const ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  "shield-alert": ShieldAlert,
  smartphone: Smartphone,
  "heart-handshake": HeartHandshake,
  baby: Baby,
  pill: Pill,
  "paw-print": PawPrint,
  siren: Siren,
  package: Package,
  "flower-2": Flower2,
  heart: Heart,
};
const ICON_KEYS = Object.keys(ICONS);

const ACCENT_DOT: Record<string, string> = {
  orange: "bg-orange-500",
  cyan: "bg-cyan-500",
  fuchsia: "bg-fuchsia-500",
  amber: "bg-amber-500",
  teal: "bg-teal-500",
  lime: "bg-lime-500",
  red: "bg-red-500",
  emerald: "bg-emerald-500",
  pink: "bg-pink-500",
};
const ACCENT_TEXT: Record<string, string> = {
  orange: "text-orange-600",
  cyan: "text-cyan-600",
  fuchsia: "text-fuchsia-600",
  amber: "text-amber-600",
  teal: "text-teal-600",
  lime: "text-lime-600",
  red: "text-red-600",
  emerald: "text-emerald-600",
  pink: "text-pink-600",
};
const ACCENT_KEYS = Object.keys(ACCENT_DOT);

function statusBadgeClass(status: string): string {
  switch (status) {
    case "ACTIVE":
      return "bg-emerald-100 text-emerald-700";
    case "PAUSED":
      return "bg-amber-100 text-amber-700";
    case "DRAFT":
      return "bg-zinc-100 text-zinc-600";
    case "COMPLETED":
      return "bg-teal-100 text-teal-700";
    case "CANCELLED":
      return "bg-red-100 text-red-700";
    default:
      return "bg-zinc-100 text-zinc-600";
  }
}

const emptyForm = {
  title: "",
  tagline: "",
  description: "",
  category: "GENERAL",
  targetAmount: "",
  icon: "heart",
  accent: "emerald",
  helpline: "",
  featured: false,
  status: "ACTIVE",
};

/* ---------------------------------- view ----------------------------------- */

export default function CampaignsView() {
  const [rows, setRows] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [deleteTarget, setDeleteTarget] = useState<Campaign | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await get<Campaign[] | { items?: Campaign[] }>("/api/campaigns?all=1");
      setRows(Array.isArray(data) ? data : (data.items ?? []));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load campaigns");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const openCreate = () => {
    setEditingId(null);
    setForm(emptyForm);
    setDialogOpen(true);
  };

  const openEdit = (c: Campaign) => {
    setEditingId(c.id);
    setForm({
      title: c.title,
      tagline: c.tagline ?? "",
      description: c.description,
      category: c.category,
      targetAmount: String(c.targetAmount),
      icon: c.icon,
      accent: c.accent,
      helpline: c.helpline ?? "",
      featured: c.featured,
      status: c.status,
    });
    setDialogOpen(true);
  };

  const save = async () => {
    if (!form.title.trim() || !form.description.trim() || !Number(form.targetAmount)) {
      toast.error("Title, description and a valid target amount are required");
      return;
    }
    setSaving(true);
    try {
      const body = {
        title: form.title.trim(),
        tagline: form.tagline.trim() || undefined,
        description: form.description.trim(),
        category: form.category,
        targetAmount: Number(form.targetAmount),
        icon: form.icon,
        accent: form.accent,
        helpline: form.helpline.trim() || undefined,
        featured: form.featured,
        status: form.status,
      };
      if (editingId) {
        await patch(`/api/campaigns/${editingId}`, body);
        toast.success("Campaign updated");
      } else {
        await post("/api/campaigns", body);
        toast.success("Campaign created");
      }
      setDialogOpen(false);
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to save campaign");
    } finally {
      setSaving(false);
    }
  };

  const toggleStatus = async (c: Campaign) => {
    const next = c.status === "ACTIVE" ? "PAUSED" : "ACTIVE";
    setBusyId(c.id);
    try {
      await patch(`/api/campaigns/${c.id}`, { status: next });
      toast.success(`${c.title} → ${titleCase(next)}`);
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to update status");
    } finally {
      setBusyId(null);
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setSaving(true);
    try {
      await del(`/api/campaigns/${deleteTarget.id}`);
      toast.success("Campaign deleted");
      setDeleteTarget(null);
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to delete campaign");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          {loading ? "Loading campaigns…" : `${rows.length} campaign${rows.length === 1 ? "" : "s"} · ${rows.filter((c) => c.status === "ACTIVE").length} active`}
        </p>
        <Button onClick={openCreate} aria-label="Create new campaign">
          <Plus className="size-4" /> New campaign
        </Button>
      </div>

      {loading ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-56 rounded-xl" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
            <Sprout className="size-8" aria-hidden="true" />
            <p className="font-medium text-foreground">No campaigns yet</p>
            <p>Create your first campaign to start raising funds.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {rows.map((c) => {
            const Icon = ICONS[c.icon] ?? Heart;
            const pct = c.targetAmount > 0 ? Math.min(100, Math.round((c.raisedAmount / c.targetAmount) * 100)) : 0;
            return (
              <Card key={c.id} className="flex flex-col gap-3 p-4">
                <div className="flex items-start gap-3">
                  <span className={cn("flex size-10 shrink-0 items-center justify-center rounded-xl bg-muted", ACCENT_TEXT[c.accent] ?? "text-emerald-600")}>
                    <Icon className="size-5" aria-hidden="true" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className={cn("size-2 shrink-0 rounded-full", ACCENT_DOT[c.accent] ?? "bg-emerald-500")} aria-hidden="true" />
                      {c.featured && <Star className="size-3.5 fill-amber-400 text-amber-500" aria-label="Featured campaign" />}
                      <h3 className="truncate text-sm font-semibold leading-tight">{c.title}</h3>
                    </div>
                    {c.slug && <p className="truncate font-mono text-[11px] text-muted-foreground">/{c.slug}</p>}
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-semibold text-muted-foreground">{titleCase(c.category)}</span>
                  <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-semibold", statusBadgeClass(c.status))}>{titleCase(c.status)}</span>
                </div>

                <div className="space-y-1.5">
                  <Progress value={pct} aria-label={`${c.title} funding progress`} />
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-semibold">{formatINR(c.raisedAmount)}</span>
                    <span className="text-muted-foreground">of {formatINR(c.targetAmount)} · {pct}%</span>
                  </div>
                </div>

                <div className="flex items-center gap-3 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1">
                    <Users className="size-3.5" aria-hidden="true" /> {c.beneficiaries} beneficiaries
                  </span>
                  {c.helpline && <span className="truncate">Helpline {c.helpline}</span>}
                </div>

                <div className="mt-auto flex items-center gap-1.5 border-t pt-3">
                  <Button size="sm" variant="outline" onClick={() => openEdit(c)} aria-label={`Edit ${c.title}`}>
                    <Pencil className="size-3.5" /> Edit
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => toggleStatus(c)}
                    disabled={busyId === c.id}
                    aria-label={c.status === "ACTIVE" ? `Pause ${c.title}` : `Activate ${c.title}`}
                  >
                    {busyId === c.id && <Loader2 className="size-3.5 animate-spin" />}
                    {c.status === "ACTIVE" ? "Pause" : "Activate"}
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="ml-auto text-red-600 hover:bg-red-50 hover:text-red-700"
                    aria-label={`Delete ${c.title}`}
                    onClick={() => setDeleteTarget(c)}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {/* Create / Edit dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{editingId ? "Edit campaign" : "New campaign"}</DialogTitle>
            <DialogDescription>
              {editingId ? "Update campaign details, progress is derived from donations." : "Launch a new fundraising campaign for the trust."}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="grid gap-2">
              <Label htmlFor="c-title">Title *</Label>
              <Input id="c-title" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Green Corridor Initiative" />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="c-tagline">Tagline</Label>
              <Input id="c-tagline" value={form.tagline} onChange={(e) => setForm({ ...form, tagline: e.target.value })} placeholder="One line that inspires donors" />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="c-desc">Description *</Label>
              <Textarea id="c-desc" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={3} placeholder="What does this campaign fund?" />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label>Category</Label>
                <Select value={form.category} onValueChange={(v) => setForm({ ...form, category: v })}>
                  <SelectTrigger aria-label="Campaign category"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {CATEGORIES.map((c) => (
                      <SelectItem key={c} value={c}>{titleCase(c)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="c-target">Target amount (₹) *</Label>
                <Input id="c-target" type="number" min="1" value={form.targetAmount} onChange={(e) => setForm({ ...form, targetAmount: e.target.value })} placeholder="500000" />
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label>Icon</Label>
                <Select value={form.icon} onValueChange={(v) => setForm({ ...form, icon: v })}>
                  <SelectTrigger aria-label="Campaign icon"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {ICON_KEYS.map((k) => (
                      <SelectItem key={k} value={k}>{titleCase(k.replace(/-/g, "_"))}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label>Accent</Label>
                <Select value={form.accent} onValueChange={(v) => setForm({ ...form, accent: v })}>
                  <SelectTrigger aria-label="Campaign accent colour"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {ACCENT_KEYS.map((a) => (
                      <SelectItem key={a} value={a}>
                        <span className="flex items-center gap-2">
                          <span className={cn("size-2.5 rounded-full", ACCENT_DOT[a])} aria-hidden="true" />
                          {titleCase(a)}
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor="c-helpline">Helpline</Label>
                <Input id="c-helpline" value={form.helpline} onChange={(e) => setForm({ ...form, helpline: e.target.value })} placeholder="e.g. 181" />
              </div>
              <div className="grid gap-2">
                <Label>Status</Label>
                <Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v })}>
                  <SelectTrigger aria-label="Campaign status"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {STATUSES.map((s) => (
                      <SelectItem key={s} value={s}>{titleCase(s)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="flex items-center justify-between rounded-lg border p-3">
              <div>
                <Label htmlFor="c-featured" className="text-sm">Featured campaign</Label>
                <p className="text-xs text-muted-foreground">Show prominently on the homepage</p>
              </div>
              <Switch id="c-featured" checked={form.featured} onCheckedChange={(v) => setForm({ ...form, featured: v })} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button onClick={save} disabled={saving}>{saving ? "Saving…" : editingId ? "Save changes" : "Create campaign"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirm dialog */}
      <Dialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Delete campaign?</DialogTitle>
            <DialogDescription>
              {deleteTarget ? `"${deleteTarget.title}" and its link to donations will be permanently removed. This cannot be undone.` : ""}
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
