"use client";

/**
 * Community admin — engage-tab tab (PHP admin panel parity).
 * Extends the Community view (community-view.tsx); consumes the backend
 * admin-engage endpoints (src/routes/mobile/admin-engage.ts) via the shared
 * mfetch helper in ./shared.
 *
 * Sub-tabs (legacy screens: notification.blade.php, faqs.blade.php and
 * SettingsController::fetchAllChartData in index.blade.php):
 *  - Notifications — send a platform notification (fans out a push row per
 *    push-enabled user) and manage past ones (repeat re-fans-out, delete).
 *  - FAQs — FAQ types with nested FAQs; add/edit/delete for both levels
 *    (deleting a type also removes its FAQs, as the legacy controller did).
 *  - Activity chart — 14-day per-day signups/posts/reels/rooms/donations
 *    multi-series chart (recharts, theme chart palette).
 */

import { useCallback, useEffect, useState } from "react";
import {
  BarChart3,
  HandCoins,
  HelpCircle,
  Loader2,
  Megaphone,
  MessageSquare,
  Pencil,
  Plus,
  Repeat2,
  Send,
  Trash2,
  Users,
  Video,
} from "lucide-react";
import { toast } from "sonner";
import { mfetch, usePagedSearch, SearchInput } from "./community/shared";
import { PageHeader } from "@/components/shared/page-header";
import { FormSection, TextField } from "@/components/shared/form-fields";
import { FormSheet } from "@/components/shared/form-sheet";
import { PaginationBar, PageSizeSelect } from "@/components/shared/view-switcher";
import { formatDate } from "@/lib/format";
import { SectionCard } from "@/components/shared/section-card";
import { StatCard } from "@/components/shared/stat-card";
import { EmptyState } from "@/components/shared/empty-state";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip as ChartTooltip,
  XAxis,
  YAxis,
} from "recharts";

/* ─────────────────────────────── types ───────────────────────────────── */

interface AdminNotificationRow {
  id: number;
  title: string;
  description: string;
  created_at: string;
}

interface FaqItem {
  id: number;
  faqs_type_id: number;
  question: string;
  answer: string;
  created_at: string;
}

interface FaqTypeRow {
  id: number;
  title: string;
  created_at: string;
  faqs: FaqItem[];
}

interface ChartPayload {
  days: string[];
  series: {
    users: number[];
    posts: number[];
    reels: number[];
    rooms: number[];
    donations: number[];
  };
}

/* Theme-token palette (chart-1..5), matching dashboard-view's CHART_COLORS. */
const SERIES_COLORS = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
];

/* ─────────────────────────────── view ────────────────────────────────── */

export default function MobileNotificationsFaqsView() {
  return (
    <Tabs defaultValue="notifications" className="space-y-4">
      <TabsList className="h-auto w-full flex-wrap sm:w-auto">
        <TabsTrigger value="notifications">Notifications</TabsTrigger>
        <TabsTrigger value="faqs">FAQs</TabsTrigger>
        <TabsTrigger value="chart">Activity chart</TabsTrigger>
      </TabsList>
      <TabsContent value="notifications" className="mt-4">
        <NotificationsPanel />
      </TabsContent>
      <TabsContent value="faqs" className="mt-4">
        <FaqsPanel />
      </TabsContent>
      <TabsContent value="chart" className="mt-4">
        <ActivityChartPanel />
      </TabsContent>
    </Tabs>
  );
}

/* ─────────────────────── Notifications sub-tab ───────────────────────── */

function NotificationsPanel() {
  const [rows, setRows] = useState<AdminNotificationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [sending, setSending] = useState(false);
  const [busy, setBusy] = useState<number | null>(null);
  const [repeatTarget, setRepeatTarget] = useState<AdminNotificationRow | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<AdminNotificationRow | null>(null);

  const { search, setSearch, query, page, setPage, limit, setLimit, start } = usePagedSearch(20);
  const [total, setTotal] = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ start: String(start), limit: String(limit) });
      if (query) params.set("q", query);
      const res = await mfetch<{ notifications: AdminNotificationRow[]; total_count: number }>(
        `/api/mobile-admin/notifications?${params.toString()}`
      );
      setRows(res.notifications ?? []);
      setTotal(res.total_count ?? 0);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load notifications");
    } finally {
      setLoading(false);
    }
  }, [start, limit, query]);

  useEffect(() => {
    void load();
  }, [load]);

  const send = async () => {
    if (!title.trim() || !description.trim()) {
      toast.error("Title and description are required");
      return;
    }
    setSending(true);
    try {
      await mfetch("/api/mobile-admin/notifications/send", {
        title: title.trim(),
        description: description.trim(),
      });
      toast.success("Notification sent to all push-enabled users");
      setTitle("");
      setDescription("");
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to send notification");
    } finally {
      setSending(false);
    }
  };

  const repeat = async (row: AdminNotificationRow) => {
    setBusy(row.id);
    try {
      await mfetch("/api/mobile-admin/notifications/repeat", { notification_id: row.id });
      toast.success("Notification re-sent");
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to repeat notification");
    } finally {
      setBusy(null);
    }
  };

  const remove = async (row: AdminNotificationRow) => {
    setBusy(row.id);
    try {
      await mfetch("/api/mobile-admin/notifications/delete", {
        notification_id: row.id,
      });
      toast.success("Notification deleted");
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to delete notification");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-4">
      <SectionCard
        title="Send platform notification"
        icon={<Megaphone className="size-4" aria-hidden="true" />}
        description="Delivered to every app user with push notifications enabled."
        bodyClassName="space-y-3"
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="notification-title" className="text-xs">Title</Label>
            <Input
              id="notification-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Scheduled maintenance"
              maxLength={100}
              className="h-8 text-sm"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="notification-description" className="text-xs">Description</Label>
            <Textarea
              id="notification-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Message body shown in the app's notifications list"
              rows={3}
              className="min-h-[64px] text-sm"
            />
          </div>
        </div>
        <div>
          <Button size="sm" disabled={sending} onClick={() => void send()}>
            {sending ? (
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            ) : (
              <Send className="size-4" aria-hidden="true" />
            )}
            {sending ? "Sending…" : "Send notification"}
          </Button>
        </div>
      </SectionCard>

      <SectionCard
        title="Past notifications"
        icon={<MessageSquare className="size-4" aria-hidden="true" />}
        description={loading ? "Loading…" : `${total} notification${total === 1 ? "" : "s"}`}
        bodyClassName="space-y-3"
      >
        <SearchInput value={search} onChange={setSearch} placeholder="Search notifications…" label="Search notifications" />

        {loading ? (
          <div className="space-y-2" aria-busy="true">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        ) : total === 0 ? (
          <EmptyState
            icon={<Megaphone className="size-6" aria-hidden="true" />}
            title="No notifications yet"
            hint="Notifications sent from this screen appear here."
          />
        ) : (
          <div className="overflow-x-auto rounded-xl border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[220px]">Title</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead className="hidden text-right sm:table-cell">Date</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((n) => (
                  <TableRow key={n.id}>
                    <TableCell className="max-w-[220px] truncate text-sm font-medium">{n.title}</TableCell>
                    <TableCell className="max-w-md">
                      <span className="line-clamp-2 text-xs text-muted-foreground">{n.description}</span>
                    </TableCell>
                    <TableCell className="hidden text-right text-xs text-muted-foreground sm:table-cell">
                      {formatDate(n.created_at)}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1.5">
                        <Button
                          variant="outline"
                          size="sm"
                          aria-label={`Repeat notification ${n.title}`}
                          disabled={busy === n.id}
                          onClick={() => setRepeatTarget(n)}
                        >
                          <Repeat2 className="size-4" aria-hidden="true" /> Repeat
                        </Button>
                        <Button
                          variant="destructive"
                          size="sm"
                          aria-label={`Delete notification ${n.title}`}
                          disabled={busy === n.id}
                          onClick={() => setDeleteTarget(n)}
                        >
                          <Trash2 className="size-4" aria-hidden="true" /> Delete
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          
        {!loading && total > 0 ? (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <PaginationBar page={page} pages={Math.max(1, Math.ceil(total / limit))} total={total} onPage={setPage} itemLabel="notifications" />
            <PageSizeSelect value={limit} onChange={setLimit} />
          </div>
        ) : null}
</div>
        )}
      </SectionCard>

      <ConfirmDialog
        open={!!repeatTarget}
        onOpenChange={(o) => !o && setRepeatTarget(null)}
        title="Repeat notification?"
        recordName={repeatTarget?.title ?? null}
        description="Re-sends this notification as a new push to every user with push notifications enabled."
        confirmLabel="Send again"
        onConfirm={async () => {
          if (repeatTarget) await repeat(repeatTarget);
          setRepeatTarget(null);
        }}
      />

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
        title="Delete notification?"
        recordName={deleteTarget?.title ?? null}
        description="This permanently removes the notification from the history. Pushes already delivered are not affected. This cannot be undone."
        confirmLabel="Delete"
        onConfirm={async () => {
          if (deleteTarget) await remove(deleteTarget);
          setDeleteTarget(null);
        }}
      />
    </div>
  );
}

/* ─────────────────────────── FAQs sub-tab ────────────────────────────── */

function FaqsPanel() {
  const [types, setTypes] = useState<FaqTypeRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [newTypeTitle, setNewTypeTitle] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  // dialogs: null = closed; {type} = edit type; {type, faq?} = FAQ form
  const [typeDialog, setTypeDialog] = useState<{ type: FaqTypeRow | null; title: string } | null>(null);
  const [faqDialog, setFaqDialog] = useState<{ typeId: number; faq: FaqItem | null; question: string; answer: string } | null>(null);
  const [deleteTypeTarget, setDeleteTypeTarget] = useState<FaqTypeRow | null>(null);
  const [deleteFaqTarget, setDeleteFaqTarget] = useState<FaqItem | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await mfetch<{ faqs: FaqTypeRow[] }>("/api/mobile-admin/faqs");
      setTypes(res.faqs ?? []);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load FAQs");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const addType = async () => {
    if (!newTypeTitle.trim()) {
      toast.error("Type title is required");
      return;
    }
    setBusy("add-type");
    try {
      await mfetch("/api/mobile-admin/faqs/types/add", { title: newTypeTitle.trim() });
      toast.success("FAQ type added");
      setNewTypeTitle("");
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to add FAQ type");
    } finally {
      setBusy(null);
    }
  };

  const saveType = async () => {
    if (!typeDialog || !typeDialog.title.trim()) {
      toast.error("Type title is required");
      return;
    }
    setBusy("save-type");
    try {
      if (typeDialog.type) {
        await mfetch("/api/mobile-admin/faqs/types/update", {
          faqsType_id: typeDialog.type.id,
          title: typeDialog.title.trim(),
        });
        toast.success("FAQ type updated");
      } else {
        await mfetch("/api/mobile-admin/faqs/types/add", { title: typeDialog.title.trim() });
        toast.success("FAQ type added");
      }
      setTypeDialog(null);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to save FAQ type");
    } finally {
      setBusy(null);
    }
  };

  const deleteType = async (t: FaqTypeRow) => {
    setBusy(`del-type-${t.id}`);
    try {
      await mfetch("/api/mobile-admin/faqs/types/delete", { faqsType_id: t.id });
      toast.success("FAQ type deleted");
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to delete FAQ type");
    } finally {
      setBusy(null);
    }
  };

  const saveFaq = async () => {
    if (!faqDialog || !faqDialog.question.trim() || !faqDialog.answer.trim()) {
      toast.error("Question and answer are required");
      return;
    }
    setBusy("save-faq");
    try {
      if (faqDialog.faq) {
        await mfetch("/api/mobile-admin/faqs/faqs/update", {
          FAQs_id: faqDialog.faq.id,
          faqs_type_id: faqDialog.typeId,
          question: faqDialog.question.trim(),
          answer: faqDialog.answer.trim(),
        });
        toast.success("FAQ updated");
      } else {
        await mfetch("/api/mobile-admin/faqs/add", {
          faqs_type_id: faqDialog.typeId,
          question: faqDialog.question.trim(),
          answer: faqDialog.answer.trim(),
        });
        toast.success("FAQ added");
      }
      setFaqDialog(null);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to save FAQ");
    } finally {
      setBusy(null);
    }
  };

  const deleteFaq = async (f: FaqItem) => {
    setBusy(`del-faq-${f.id}`);
    try {
      await mfetch("/api/mobile-admin/faqs/faqs/delete", { faqs_id: f.id });
      toast.success("FAQ deleted");
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to delete FAQ");
    } finally {
      setBusy(null);
    }
  };

  const totalFaqs = types.reduce((s, t) => s + t.faqs.length, 0);

  return (
    <div className="space-y-4">
      <SectionCard
        title="FAQ types"
        icon={<HelpCircle className="size-4" aria-hidden="true" />}
        description={loading ? "Loading FAQs…" : `${types.length} type${types.length === 1 ? "" : "s"} · ${totalFaqs} FAQ${totalFaqs === 1 ? "" : "s"}`}
        bodyClassName="space-y-4"
      >
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void addType();
          }}
        >
          <div className="min-w-[200px] flex-1 space-y-1.5 sm:max-w-xs">
            <Label htmlFor="faq-type-title" className="text-xs">New type title</Label>
            <Input
              id="faq-type-title"
              value={newTypeTitle}
              onChange={(e) => setNewTypeTitle(e.target.value)}
              placeholder="e.g. Getting started"
              maxLength={55}
              className="h-8 text-sm"
            />
          </div>
          <Button type="submit" size="sm" disabled={busy === "add-type"}>
            <Plus className="size-4" aria-hidden="true" /> Add type
          </Button>
        </form>

        {loading ? (
          <div className="space-y-2" aria-busy="true">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-20 w-full" />
            ))}
          </div>
        ) : types.length === 0 ? (
          <EmptyState
            icon={<HelpCircle className="size-6" aria-hidden="true" />}
            title="No FAQ types yet"
            hint="Create a type above, then add questions under it."
          />
        ) : (
          <div className="space-y-3">
            {types.map((t) => (
              <div key={t.id} className="rounded-xl border bg-muted/20">
                <div className="flex flex-wrap items-center gap-2 border-b px-3 py-2.5">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{t.title}</p>
                    <p className="text-[11px] text-muted-foreground">
                      {t.faqs.length} FAQ{t.faqs.length === 1 ? "" : "s"}
                    </p>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    aria-label={`Add FAQ to ${t.title}`}
                    onClick={() => setFaqDialog({ typeId: t.id, faq: null, question: "", answer: "" })}
                  >
                    <Plus className="size-4" aria-hidden="true" /> FAQ
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    aria-label={`Edit type ${t.title}`}
                    disabled={busy === `del-type-${t.id}`}
                    onClick={() => setTypeDialog({ type: t, title: t.title })}
                  >
                    <Pencil className="size-4" aria-hidden="true" /> Edit
                  </Button>
                  <Button
                    variant="destructive"
                    size="sm"
                    aria-label={`Delete type ${t.title}`}
                    disabled={busy === `del-type-${t.id}`}
                    onClick={() => setDeleteTypeTarget(t)}
                  >
                    <Trash2 className="size-4" aria-hidden="true" /> Delete
                  </Button>
                </div>
                {t.faqs.length === 0 ? (
                  <p className="px-3 py-3 text-xs text-muted-foreground">No FAQs in this type yet.</p>
                ) : (
                  <ul className="divide-y">
                    {t.faqs.map((f) => (
                      <li key={f.id} className="flex items-start gap-3 px-3 py-2.5">
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium">{f.question}</p>
                          <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{f.answer}</p>
                        </div>
                        <div className="flex shrink-0 gap-1.5">
                          <Button
                            variant="ghost"
                            size="sm"
                            aria-label={`Edit FAQ ${f.question}`}
                            onClick={() => setFaqDialog({ typeId: t.id, faq: f, question: f.question, answer: f.answer })}
                          >
                            <Pencil className="size-4" aria-hidden="true" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-red-600 hover:text-red-600 dark:text-red-400"
                            aria-label={`Delete FAQ ${f.question}`}
                            disabled={busy === `del-faq-${f.id}`}
                            onClick={() => setDeleteFaqTarget(f)}
                          >
                            <Trash2 className="size-4" aria-hidden="true" />
                          </Button>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </div>
        )}
      </SectionCard>

      {/* Add / edit type */}
      <FormSheet
        open={!!typeDialog}
        onOpenChange={(o) => !o && setTypeDialog(null)}
        title={typeDialog?.type ? "Edit FAQ type" : "Add FAQ type"}
        description="FAQ types group the questions shown on the mobile app."
        onSubmit={() => {
          void saveType();
          return Promise.resolve();
        }}
        submitLabel="Save"
        loading={busy === "save-type"}
        size="sm"
      >
        <TextField
          label="Title"
          value={typeDialog?.title ?? ""}
          onChange={(v) => typeDialog && setTypeDialog({ ...typeDialog, title: v })}
          maxLength={55}
        />
      </FormSheet>

      {/* Add / edit FAQ */}
      <FormSheet
        open={!!faqDialog}
        onOpenChange={(o) => !o && setFaqDialog(null)}
        title={faqDialog?.faq ? "Edit FAQ" : "Add FAQ"}
        description="Questions and answers render in the mobile app's FAQ screen."
        onSubmit={() => {
          void saveFaq();
          return Promise.resolve();
        }}
        submitLabel="Save"
        loading={busy === "save-faq"}
      >
        <FormSection title="FAQ">
          <TextField
            label="Question"
            value={faqDialog?.question ?? ""}
            onChange={(v) => faqDialog && setFaqDialog({ ...faqDialog, question: v })}
          />
          <TextField
            label="Answer"
            value={faqDialog?.answer ?? ""}
            onChange={(v) => faqDialog && setFaqDialog({ ...faqDialog, answer: v })}
          />
        </FormSection>
      </FormSheet>

      <ConfirmDialog
        open={!!deleteTypeTarget}
        onOpenChange={(o) => !o && setDeleteTypeTarget(null)}
        title="Delete FAQ type?"
        recordName={deleteTypeTarget?.title ?? null}
        description={`This also deletes all ${deleteTypeTarget?.faqs.length ?? 0} FAQ${(deleteTypeTarget?.faqs.length ?? 0) === 1 ? "" : "s"} under this type. This cannot be undone.`}
        confirmLabel="Delete type"
        onConfirm={async () => {
          if (deleteTypeTarget) await deleteType(deleteTypeTarget);
          setDeleteTypeTarget(null);
        }}
      />

      <ConfirmDialog
        open={!!deleteFaqTarget}
        onOpenChange={(o) => !o && setDeleteFaqTarget(null)}
        title="Delete FAQ?"
        recordName={deleteFaqTarget?.question ?? null}
        description="This permanently removes the question and answer. This cannot be undone."
        confirmLabel="Delete"
        onConfirm={async () => {
          if (deleteFaqTarget) await deleteFaq(deleteFaqTarget);
          setDeleteFaqTarget(null);
        }}
      />
    </div>
  );
}

/* ────────────────────── Activity chart sub-tab ───────────────────────── */

const CHART_SERIES = [
  { key: "users", label: "Members", color: SERIES_COLORS[0] },
  { key: "posts", label: "Posts", color: SERIES_COLORS[1] },
  { key: "reels", label: "Reels", color: SERIES_COLORS[2] },
  { key: "rooms", label: "Rooms", color: SERIES_COLORS[3] },
  { key: "donations", label: "Donations", color: SERIES_COLORS[4] },
] as const;

function dayLabel(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

function ActivityChartPanel() {
  const [payload, setPayload] = useState<ChartPayload | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await mfetch<ChartPayload>("/api/mobile-admin/chart");
      setPayload(res);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load chart data");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const data = (payload?.days ?? []).map((d, i) => {
    const s = payload?.series;
    return {
      day: d,
      label: dayLabel(d),
      users: s?.users[i] ?? 0,
      posts: s?.posts[i] ?? 0,
      reels: s?.reels[i] ?? 0,
      rooms: s?.rooms[i] ?? 0,
      donations: s?.donations[i] ?? 0,
    };
  });

  const totals = {
    users: payload?.series.users.reduce((a, b) => a + b, 0) ?? 0,
    posts: payload?.series.posts.reduce((a, b) => a + b, 0) ?? 0,
    reels: payload?.series.reels.reduce((a, b) => a + b, 0) ?? 0,
    rooms: payload?.series.rooms.reduce((a, b) => a + b, 0) ?? 0,
    donations: payload?.series.donations.reduce((a, b) => a + b, 0) ?? 0,
  };

  const hasAny = Object.values(totals).some((v) => v > 0);

  return (
    <div className="space-y-4 sm:space-y-6">
      <PageHeader
        title="Notifications & FAQs"
        description="Platform-wide mobile notifications, FAQ management and 14-day engagement activity."
        icon={<Megaphone className="size-5" aria-hidden="true" />}
      />

      {/* 14-day KPI strip */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <StatCard label="Members" value={totals.users} hint="Sign-ups · 14 days" icon={<Users className="size-5" aria-hidden="true" />} accent="emerald" loading={loading} />
        <StatCard label="Posts" value={totals.posts} hint="Community posts · 14 days" icon={<MessageSquare className="size-5" aria-hidden="true" />} accent="cyan" loading={loading} />
        <StatCard label="Reels" value={totals.reels} hint="Reels created · 14 days" icon={<Video className="size-5" aria-hidden="true" />} accent="amber" loading={loading} />
        <StatCard label="Rooms" value={totals.rooms} hint="Rooms created · 14 days" icon={<Megaphone className="size-5" aria-hidden="true" />} accent="pink" loading={loading} />
        <StatCard label="Donations" value={totals.donations} hint="Completed · 14 days" icon={<HandCoins className="size-5" aria-hidden="true" />} accent="teal" loading={loading} />
      </div>

      <SectionCard
        title="Community activity"
        icon={<BarChart3 className="size-4" aria-hidden="true" />}
        description={payload ? `Per-day counts · last ${payload.days.length} days` : "Loading…"}
        actions={
          <Button size="sm" variant="ghost" onClick={() => void load()} aria-label="Refresh chart">
            <Repeat2 className="size-3.5" aria-hidden="true" /> Refresh
          </Button>
        }
        bodyClassName="space-y-3"
      >
        {loading ? (
          <Skeleton className="h-72 w-full" aria-busy="true" />
        ) : !hasAny ? (
          <EmptyState
            icon={<BarChart3 className="size-6" aria-hidden="true" />}
            title="No activity in the last 14 days"
            hint="Sign-ups, posts, reels, rooms and completed donations will chart here."
          />
        ) : (
          <>
            <div className="h-72 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                  <XAxis
                    dataKey="label"
                    tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
                    tickLine={false}
                    axisLine={false}
                  />
                  <YAxis
                    allowDecimals={false}
                    tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
                    tickLine={false}
                    axisLine={false}
                    width={32}
                  />
                  <ChartTooltip
                    formatter={(v, name) => [String(v), String(name)]}
                    labelFormatter={(label) => String(label)}
                  />
                  {CHART_SERIES.map((s) => (
                    <Line
                      key={s.key}
                      type="monotone"
                      dataKey={s.key}
                      name={s.label}
                      stroke={s.color}
                      strokeWidth={2}
                      dot={false}
                      activeDot={{ r: 3 }}
                    />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </div>
            <div className="flex flex-wrap justify-center gap-x-4 gap-y-1.5">
              {CHART_SERIES.map((s) => (
                <span key={s.key} className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                  <span className="size-2 rounded-full" style={{ backgroundColor: s.color }} aria-hidden="true" />
                  {s.label}
                </span>
              ))}
            </div>
          </>
        )}
      </SectionCard>
    </div>
  );
}
