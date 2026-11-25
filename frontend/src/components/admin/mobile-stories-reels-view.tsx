"use client";

/**
 * Mobile → Stories & Reels — media management pages (legacy viewStories /
 * viewReels parity). Campaigns-page layout: PageHeader → SectionCard with
 * ViewSwitcher (table / grid / list) → toolbar → DataTable / grid / list →
 * FormSheet create-edit → DetailSheet (reel comments) → ConfirmDialog.
 *
 * Data: /api/mobile-admin/stories*, /api/mobile-admin/reels* (server-side
 * q / start / limit pagination).
 */
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import {
  Clapperboard,
  ImageIcon,
  MessageSquare,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  Trash2,
} from "lucide-react";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PageHeader } from "@/components/shared/page-header";
import { SectionCard } from "@/components/shared/section-card";
import { EmptyState } from "@/components/shared/empty-state";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { DetailSheet } from "@/components/shared/detail-sheet";
import {
  FormSection,
  SelectField,
  TextField,
} from "@/components/shared/form-fields";
import { FormSheet } from "@/components/shared/form-sheet";
import {
  PaginationBar,
  PageSizeSelect,
  useViewPref,
  ViewSwitcher,
} from "@/components/shared/view-switcher";
import { DataTable, type DataTableColumn } from "@/components/shared/data-table";
import { formatDate } from "@/lib/format";
import { mfetch, usePagedSearch, SearchInput } from "./community/shared";

/* ─────────────────────────────── types ───────────────────────────────── */

interface LegacyUser {
  id: string;
  full_name?: string | null;
  username?: string | null;
  profile?: string | null;
}

interface AdminStory {
  id: string;
  user_id: string;
  type: number; // 0 image | 1 video
  duration: number;
  content: string;
  thumbnail: string | null;
  created_at: string | null;
  user: LegacyUser | null;
}

interface AdminReel {
  id: string;
  description: string | null;
  content: string | null;
  thumbnail: string | null;
  hashtags: string | null;
  comments_count: number;
  likes_count: number;
  views_count: number;
  created_at: string | null;
  user: LegacyUser | null;
}

interface ReelComment {
  id: string;
  description: string;
  created_at: string | null;
  user: LegacyUser | null;
}

function UserCell({ user }: { user: LegacyUser | null }) {
  const name = user?.full_name ?? "Unknown";
  return (
    <div className="flex items-center gap-2.5">
      <Avatar className="size-8">
        {user?.profile ? <AvatarFallback><img src={user.profile} alt="" className="size-8 rounded-full object-cover" /></AvatarFallback> : null}
        <AvatarFallback className="text-xs">{name.slice(0, 1).toUpperCase()}</AvatarFallback>
      </Avatar>
      <div className="min-w-0">
        <p className="truncate text-sm font-medium">{name}</p>
      </div>
    </div>
  );
}

function MediaThumb({ src, fallback }: { src?: string | null; fallback: React.ReactNode }) {
  return src ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt="" className="size-10 rounded-md object-cover" loading="lazy" />
  ) : (
    <span className="flex size-10 items-center justify-center rounded-md bg-muted text-muted-foreground">{fallback}</span>
  );
}

/* ─────────────────────── Stories sub-tab ─────────────────────────────── */

function StoriesSubTab() {
  const { search, setSearch, query, page, setPage, limit, setLimit, start } = usePagedSearch(20);
  const [view, setView] = useViewPref("mobile-stories", "table");
  const [stories, setStories] = useState<AdminStory[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [deleteTarget, setDeleteTarget] = useState<AdminStory | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<AdminStory | null>(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ content: "", thumbnail: "", type: 0, duration: 5 });
  const [formSnapshot, setFormSnapshot] = useState(JSON.stringify(form));

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ start: String(start), limit: String(limit) });
      if (query) params.set("q", query);
      const res = await mfetch<{ stories: AdminStory[]; total_count: number }>(
        `/api/mobile-admin/stories?${params.toString()}`
      );
      setStories(res.stories ?? []);
      setTotal(res.total_count ?? 0);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load stories");
    } finally {
      setLoading(false);
    }
  }, [start, limit, query]);

  useEffect(() => {
    void load();
  }, [load]);

  const remove = async (story: AdminStory) => {
    setBusy(story.id);
    try {
      // DELETE /mobile-admin/stories also exists; mfetch speaks GET/POST so
      // the dashboard uses its POST alias (same handler server-side).
      await mfetch("/api/mobile-admin/stories/delete", { story_id: story.id });
      toast.success("Story deleted");
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to delete story");
    } finally {
      setBusy(null);
      setDeleteTarget(null);
    }
  };

  const openCreate = () => {
    setEditTarget(null);
    setForm({ content: "", thumbnail: "", type: 0, duration: 5 });
    setFormSnapshot(JSON.stringify(form));
    setFormOpen(true);
  };

  const openEdit = (s: AdminStory) => {
    setEditTarget(s);
    setForm({ content: s.content, thumbnail: s.thumbnail ?? "", type: s.type, duration: s.duration });
    setFormSnapshot(JSON.stringify({ content: s.content, thumbnail: s.thumbnail ?? "", type: s.type, duration: s.duration }));
    setFormOpen(true);
  };

  const save = async () => {
    setSaving(true);
    try {
      if (editTarget) {
        await mfetch("/api/mobile-admin/stories/update", { story_id: editTarget.id, ...form });
        toast.success("Story updated");
      } else {
        await mfetch("/api/mobile-admin/stories/create", form);
        toast.success("Story created");
      }
      setFormOpen(false);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const formDirty = formOpen && JSON.stringify(form) !== formSnapshot;
  const pages = Math.max(1, Math.ceil(total / limit));

  const storyColumns: DataTableColumn<AdminStory>[] = [
    { key: "story", header: "Story" },
    { key: "member", header: "Member" },
    { key: "kind", header: "Type" },
    { key: "created", header: "Created" },
    { key: "actions", header: "Actions" },
  ];

  const renderStoryCell = (s: AdminStory, col: DataTableColumn<AdminStory>) => {
    switch (col.key) {
      case "story":
        return <MediaThumb src={s.thumbnail || s.content} fallback={<ImageIcon className="size-4" aria-hidden="true" />} />;
      case "member":
        return <UserCell user={s.user} />;
      case "kind":
        return <Badge variant="outline">{s.type === 1 ? "Video" : "Image"}</Badge>;
      case "created":
        return <span className="text-xs text-muted-foreground">{formatDate(s.created_at)}</span>;
      case "actions":
        return (
          <div className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
            <Button variant="ghost" size="sm" aria-label="Edit story" onClick={() => openEdit(s)}>
              <Pencil className="size-4" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="text-red-600 hover:text-red-600 dark:text-red-400"
              aria-label="Delete story"
              disabled={busy === s.id}
              onClick={() => setDeleteTarget(s)}
            >
              <Trash2 className="size-4" />
            </Button>
          </div>
        );
      default:
        return null;
    }
  };

  return (
    <>
      <SectionCard
        title="Stories"
        icon={<ImageIcon className="size-4" aria-hidden="true" />}
        description={loading ? "Loading stories…" : `${total} stor${total === 1 ? "y" : "ies"}${query ? ` matching “${query}”` : ""}`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <ViewSwitcher value={view} onChange={setView} />
            <Button size="sm" onClick={openCreate}>New story</Button>
            <Button variant="outline" size="sm" onClick={() => void load()} aria-label="Refresh stories">
              <RefreshCw className="size-4" aria-hidden="true" /> Refresh
            </Button>
          </div>
        }
        bodyClassName="space-y-4"
      >
        <SearchInput value={search} onChange={setSearch} placeholder="Search by member name…" label="Search stories" />

        {loading ? (
          <div className="space-y-2" aria-busy="true">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        ) : total === 0 ? (
          <EmptyState
            title={query ? "No stories match the search" : "No stories yet"}
            hint="Stories posted from the mobile app appear here."
          />
        ) : view === "table" ? (
          <DataTable
            columns={storyColumns}
            rows={stories}
            rowKey={(s) => s.id}
            loading={loading}
            skeletonRows={8}
            onRowClick={openEdit}
            page={page}
            pages={pages}
            total={total}
            pageSize={limit}
            onPage={setPage}
            onPageSize={setLimit}
            itemLabel="stories"
            empty={<EmptyState title="No stories" hint="Stories posted from the mobile app appear here." />}
          >
            {renderStoryCell}
          </DataTable>
        ) : view === "list" ? (
          <ul className="divide-y rounded-xl border bg-card">
            {stories.map((s) => (
              <li key={s.id}>
                <button type="button" onClick={() => openEdit(s)} className="flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-accent sm:px-4">
                  <MediaThumb src={s.thumbnail || s.content} fallback={<ImageIcon className="size-4" aria-hidden="true" />} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{s.user?.full_name ?? "Unknown"}</p>
                    <p className="truncate text-xs text-muted-foreground">{s.type === 1 ? "Video" : "Image"} · {s.duration}s · {formatDate(s.created_at)}</p>
                  </div>
                  <div onClick={(e) => e.stopPropagation()}>
                    <Button size="sm" variant="ghost" onClick={() => setDeleteTarget(s)}><Trash2 className="size-4" /></Button>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
            {stories.map((s) => (
              <div key={s.id} className="overflow-hidden rounded-xl border">
                <div className="relative aspect-[9/14] bg-muted">
                  {s.thumbnail ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={s.thumbnail} alt="" className="h-full w-full object-cover" loading="lazy" />
                  ) : (
                    <span className="flex h-full items-center justify-center"><ImageIcon className="size-8 text-muted-foreground" aria-hidden="true" /></span>
                  )}
                  <span className="absolute right-1.5 top-1.5">
                    <Badge variant="outline" className="gap-1 bg-background/80 text-[10px]">
                      {s.type === 1 ? <Play className="size-2.5" aria-hidden="true" /> : <ImageIcon className="size-2.5" aria-hidden="true" />}
                      {s.type === 1 ? "Video" : "Image"}
                    </Badge>
                  </span>
                </div>
                <div className="flex items-center justify-between gap-2 p-2">
                  <p className="truncate text-xs text-muted-foreground">{s.user?.full_name ?? "Unknown"}</p>
                  <Button size="sm" variant="ghost" onClick={() => setDeleteTarget(s)}><Trash2 className="size-4" /></Button>
                </div>
              </div>
            ))}
          </div>
        )}

        {view !== "table" && !loading && total > 0 ? (
          <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-3">
            <PaginationBar page={page} pages={pages} total={total} onPage={setPage} itemLabel="stories" />
            <PageSizeSelect value={limit} onChange={setLimit} />
          </div>
        ) : null}
      </SectionCard>

      {/* Stories create / edit slide-over */}
      <FormSheet
        open={formOpen}
        onOpenChange={setFormOpen}
        title={editTarget ? "Edit story" : "New story"}
        description={
          editTarget ? "Update the story media and metadata." : "Creates the story under your admin account."
        }
        onSubmit={save}
        submitLabel={editTarget ? "Save changes" : "Create story"}
        loading={saving}
        dirty={formDirty}
      >
        <FormSection title="Media">
          <TextField
            label="Media URL"
            value={form.content}
            onChange={(v) => setForm({ ...form, content: v })}
            placeholder="https://…"
          />
          <TextField
            label="Thumbnail URL"
            value={form.thumbnail}
            onChange={(v) => setForm({ ...form, thumbnail: v })}
            placeholder="https://…"
          />
        </FormSection>
        <FormSection title="Metadata">
          <SelectField
            label="Type"
            value={String(form.type)}
            onChange={(v) => setForm({ ...form, type: Number(v) })}
            options={[
              { value: "0", label: "Image" },
              { value: "1", label: "Video" },
            ]}
          />
          <TextField
            label="Duration (seconds)"
            type="number"
            value={String(form.duration)}
            onChange={(v) => setForm({ ...form, duration: Number(v) || 0 })}
          />
        </FormSection>
      </FormSheet>

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
        title="Delete story?"
        description="This permanently removes the story and its media. This cannot be undone."
        recordName={deleteTarget ? `Story by ${deleteTarget.user?.full_name ?? "Unknown"} · ${deleteTarget.created_at ? formatDate(deleteTarget.created_at) : ""}` : null}
        confirmLabel="Delete"
        onConfirm={() => {
          if (deleteTarget) return remove(deleteTarget);
          return Promise.resolve();
        }}
      />
    </>
  );
}

/* ──────────────────────── Reels sub-tab ──────────────────────────────── */

function ReelsSubTab() {
  const { search, setSearch, query, page, setPage, limit, setLimit, start } = usePagedSearch(20);
  const [view, setView] = useViewPref("mobile-reels", "table");
  const [reels, setReels] = useState<AdminReel[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<AdminReel | null>(null);
  // comments slide-over
  const [commentsFor, setCommentsFor] = useState<AdminReel | null>(null);
  const [comments, setComments] = useState<ReelComment[]>([]);
  const [commentsLoading, setCommentsLoading] = useState(false);
  const [commentBusy, setCommentBusy] = useState<string | null>(null);
  // create / edit
  const [formOpen, setFormOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<AdminReel | null>(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ content: "", thumbnail: "", description: "", hashtags: "", music_id: "" });
  const [formSnapshot, setFormSnapshot] = useState(JSON.stringify(form));

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ start: String(start), limit: String(limit) });
      if (query) params.set("q", query);
      const res = await mfetch<{ reels: AdminReel[]; total_count: number }>(
        `/api/mobile-admin/reels?${params.toString()}`
      );
      setReels(res.reels ?? []);
      setTotal(res.total_count ?? 0);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load reels");
    } finally {
      setLoading(false);
    }
  }, [start, limit, query]);

  useEffect(() => {
    void load();
  }, [load]);

  const loadComments = async (reelId: string) => {
    setCommentsLoading(true);
    try {
      const res = await mfetch<{ comments: ReelComment[] }>(
        `/api/mobile-admin/reels/comments?reel_id=${encodeURIComponent(reelId)}`
      );
      setComments(res.comments ?? []);
    } catch {
      setComments([]);
    } finally {
      setCommentsLoading(false);
    }
  };

  const openComments = (reel: AdminReel) => {
    setCommentsFor(reel);
    void loadComments(reel.id);
  };

  const deleteComment = async (comment: ReelComment) => {
    if (!commentsFor) return;
    setCommentBusy(comment.id);
    try {
      await mfetch("/api/mobile-admin/reels/comments/delete", { comment_id: comment.id });
      setComments((prev) => prev.filter((c) => c.id !== comment.id));
      setReels((prev) =>
        prev.map((r) => (r.id === commentsFor.id ? { ...r, comments_count: Math.max(0, r.comments_count - 1) } : r))
      );
      toast.success("Comment deleted");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to delete comment");
    } finally {
      setCommentBusy(null);
    }
  };

  const remove = async (reel: AdminReel) => {
    setBusy(reel.id);
    try {
      await mfetch("/api/mobile-admin/reels/delete", { reel_id: reel.id });
      toast.success("Reel deleted");
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to delete reel");
    } finally {
      setBusy(null);
      setDeleteTarget(null);
    }
  };

  const openCreate = () => {
    setEditTarget(null);
    setForm({ content: "", thumbnail: "", description: "", hashtags: "", music_id: "" });
    setFormSnapshot(JSON.stringify(form));
    setFormOpen(true);
  };

  const openEdit = (r: AdminReel) => {
    setEditTarget(r);
    setForm({ content: r.content ?? "", thumbnail: r.thumbnail ?? "", description: r.description ?? "", hashtags: r.hashtags ?? "", music_id: "" });
    setFormSnapshot(JSON.stringify({ content: r.content ?? "", thumbnail: r.thumbnail ?? "", description: r.description ?? "", hashtags: r.hashtags ?? "", music_id: "" }));
    setFormOpen(true);
  };

  const save = async () => {
    setSaving(true);
    try {
      if (editTarget) {
        await mfetch("/api/mobile-admin/reels/update", { reel_id: editTarget.id, ...form });
        toast.success("Reel updated");
      } else {
        await mfetch("/api/mobile-admin/reels/create", form);
        toast.success("Reel created");
      }
      setFormOpen(false);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const formDirty = formOpen && JSON.stringify(form) !== formSnapshot;
  const pages = Math.max(1, Math.ceil(total / limit));

  const reelColumns: DataTableColumn<AdminReel>[] = [
    { key: "reel", header: "Reel" },
    { key: "member", header: "Member" },
    { key: "engagement", header: "Engagement" },
    { key: "created", header: "Created" },
    { key: "actions", header: "Actions" },
  ];

  const renderReelCell = (r: AdminReel, col: DataTableColumn<AdminReel>) => {
    switch (col.key) {
      case "reel":
        return <MediaThumb src={r.thumbnail} fallback={<Play className="size-4" aria-hidden="true" />} />;
      case "member":
        return <UserCell user={r.user} />;
      case "engagement":
        return <span className="text-xs text-muted-foreground">{r.likes_count} likes · {r.comments_count} comments · {r.views_count} views</span>;
      case "created":
        return <span className="text-xs text-muted-foreground">{formatDate(r.created_at)}</span>;
      case "actions":
        return (
          <div className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
            <Button variant="ghost" size="sm" aria-label="View comments" onClick={() => openComments(r)}>
              <MessageSquare className="size-4" />
            </Button>
            <Button variant="ghost" size="sm" aria-label="Edit reel" onClick={() => openEdit(r)}>
              <Pencil className="size-4" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="text-red-600 hover:text-red-600 dark:text-red-400"
              aria-label="Delete reel"
              onClick={() => setDeleteTarget(r)}
            >
              <Trash2 className="size-4" />
            </Button>
          </div>
        );
      default:
        return null;
    }
  };

  return (
    <>
      <SectionCard
        title="Reels"
        icon={<Play className="size-4" aria-hidden="true" />}
        description={loading ? "Loading reels…" : `${total} reel${total === 1 ? "" : "s"}${query ? ` matching “${query}”` : ""}`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <ViewSwitcher value={view} onChange={setView} />
            <Button size="sm" onClick={openCreate}>New reel</Button>
            <Button variant="outline" size="sm" onClick={() => void load()} aria-label="Refresh reels">
              <RefreshCw className="size-4" aria-hidden="true" /> Refresh
            </Button>
          </div>
        }
        bodyClassName="space-y-4"
      >
        <SearchInput value={search} onChange={setSearch} placeholder="Search description, hashtag or member…" label="Search reels" />

        {loading ? (
          <div className="space-y-2" aria-busy="true">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-14 w-full" />
            ))}
          </div>
        ) : total === 0 ? (
          <EmptyState
            title={query ? "No reels match the search" : "No reels yet"}
            hint="Reels posted from the mobile app appear here."
          />
        ) : view === "table" ? (
          <DataTable
            columns={reelColumns}
            rows={reels}
            rowKey={(r) => r.id}
            loading={loading}
            skeletonRows={8}
            onRowClick={openEdit}
            page={page}
            pages={pages}
            total={total}
            pageSize={limit}
            onPage={setPage}
            onPageSize={setLimit}
            itemLabel="reels"
            empty={<EmptyState title="No reels" hint="Reels posted from the mobile app appear here." />}
          >
            {renderReelCell}
          </DataTable>
        ) : view === "list" ? (
          <ul className="divide-y rounded-xl border bg-card">
            {reels.map((r) => (
              <li key={r.id}>
                <button type="button" onClick={() => openEdit(r)} className="flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-accent sm:px-4">
                  <MediaThumb src={r.thumbnail} fallback={<Play className="size-4" aria-hidden="true" />} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{r.description || "(no caption)"}</p>
                    <p className="truncate text-xs text-muted-foreground">{r.user?.full_name ?? "Unknown"} · {r.likes_count} likes · {r.views_count} views</p>
                  </div>
                  <div onClick={(e) => e.stopPropagation()}>
                    <Button size="sm" variant="ghost" onClick={() => openComments(r)}><MessageSquare className="size-4" /></Button>
                    <Button size="sm" variant="ghost" onClick={() => setDeleteTarget(r)}><Trash2 className="size-4" /></Button>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {reels.map((r) => (
              <article key={r.id} className="flex flex-col gap-3 rounded-xl border bg-card p-4">
                <MediaThumb src={r.thumbnail} fallback={<Play className="size-8 text-muted-foreground" aria-hidden="true" />} />
                <div>
                  <p className="truncate text-sm font-medium">{r.description || "(no caption)"}</p>
                  <p className="truncate text-xs text-muted-foreground">{r.user?.full_name ?? "Unknown"} · {r.likes_count} likes · {r.views_count} views</p>
                </div>
                <div className="flex justify-end gap-2">
                  <Button size="sm" variant="outline" onClick={() => openComments(r)}><MessageSquare className="size-4" /> Comments</Button>
                  <Button size="sm" variant="outline" onClick={() => openEdit(r)}><Pencil className="size-4" /> Edit</Button>
                  <Button size="sm" variant="destructive" onClick={() => setDeleteTarget(r)}><Trash2 className="size-4" /></Button>
                </div>
              </article>
            ))}
          </div>
        )}

        {view !== "table" && !loading && total > 0 ? (
          <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-3">
            <PaginationBar page={page} pages={pages} total={total} onPage={setPage} itemLabel="reels" />
            <PageSizeSelect value={limit} onChange={setLimit} />
          </div>
        ) : null}
      </SectionCard>

      {/* Reels create / edit slide-over */}
      <FormSheet
        open={formOpen}
        onOpenChange={setFormOpen}
        title={editTarget ? "Edit reel" : "New reel"}
        description={
          editTarget ? "Update the reel video and metadata." : "Creates the reel under your admin account."
        }
        onSubmit={save}
        submitLabel={editTarget ? "Save changes" : "Create reel"}
        loading={saving}
        dirty={formDirty}
      >
        <FormSection title="Video">
          <TextField
            label="Video URL"
            value={form.content}
            onChange={(v) => setForm({ ...form, content: v })}
            placeholder="https://…mp4"
          />
          <TextField
            label="Thumbnail URL"
            value={form.thumbnail}
            onChange={(v) => setForm({ ...form, thumbnail: v })}
            placeholder="https://…"
          />
        </FormSection>
        <FormSection title="Metadata">
          <TextField
            label="Description"
            value={form.description}
            onChange={(v) => setForm({ ...form, description: v })}
          />
          <TextField
            label="Hashtags"
            value={form.hashtags}
            onChange={(v) => setForm({ ...form, hashtags: v })}
            placeholder="#kindness,#impact"
          />
          <TextField
            label="Music ID"
            type="number"
            value={form.music_id}
            onChange={(v) => setForm({ ...form, music_id: v })}
            placeholder="optional"
          />
        </FormSection>
      </FormSheet>

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
        title="Delete reel?"
        description="This permanently removes the reel, its comments and likes. This cannot be undone."
        recordName={deleteTarget ? `Reel by ${deleteTarget.user?.full_name ?? "Unknown"}` : null}
        confirmLabel="Delete"
        onConfirm={() => {
          if (deleteTarget) return remove(deleteTarget);
          return Promise.resolve();
        }}
      />

      {/* Reel comments slide-over */}
      <DetailSheet
        open={!!commentsFor}
        onOpenChange={(o) => !o && setCommentsFor(null)}
        eyebrow="Mobile reels"
        title={`Comments · ${commentsFor?.description?.slice(0, 40) ?? ""}`}
        description={commentsFor ? `${commentsFor.comments_count} comments · by ${commentsFor.user?.full_name ?? "Unknown"}` : ""}
      >
        {commentsLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : comments.length === 0 ? (
          <EmptyState title="No comments" hint="No one has commented on this reel yet." />
        ) : (
          <ul className="space-y-2">
            {comments.map((c) => (
              <li key={c.id} className="flex items-start justify-between gap-3 rounded-xl border px-3 py-2.5">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{c.user?.full_name ?? "Unknown"}</p>
                  <p className="text-sm text-muted-foreground">{c.description}</p>
                  <p className="text-[11px] text-muted-foreground">{c.created_at ? formatDate(c.created_at) : ""}</p>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="size-8 p-0 text-red-600 hover:text-red-600 dark:text-red-400"
                  aria-label="Delete comment"
                  disabled={commentBusy === c.id}
                  onClick={() => void deleteComment(c)}
                >
                  <Trash2 className="size-4" aria-hidden="true" />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </DetailSheet>
    </>
  );
}

/* ──────────────────────────────── page ───────────────────────────────── */

export default function MobileStoriesReelsView() {
  return (
    <div className="space-y-4 sm:space-y-6">
      <PageHeader
        title="Stories & Reels"
        description="Mobile story and reel management — media, captions, moderation and lifecycle."
        icon={<Clapperboard className="size-5" aria-hidden="true" />}
      />

      <Tabs defaultValue="stories">
        <TabsList>
          <TabsTrigger value="stories">Stories</TabsTrigger>
          <TabsTrigger value="reels">Reels</TabsTrigger>
        </TabsList>
        <TabsContent value="stories" className="mt-4">
          <StoriesSubTab />
        </TabsContent>
        <TabsContent value="reels" className="mt-4">
          <ReelsSubTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
