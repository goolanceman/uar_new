"use client";

/**
 * Mobile → Feed — post management page (legacy viewPosts parity).
 *
 * Layout follows the Campaigns page pattern exactly:
 *   PageHeader (Refresh + New post) → KPI strip → SectionCard with
 *   ViewSwitcher (table / grid / list) → toolbar (search + filters + chips +
 *   result count) → DataTable / card grid / list → FormSheet create-edit →
 *   DetailSheet → ConfirmDialog.
 *
 * Data: /api/mobile-admin/feed (server-side q / type / start / limit).
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  AlertTriangle,
  BadgeCheck,
  EyeOff,
  MessageSquare,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  X,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PageHeader } from "@/components/shared/page-header";
import { SectionCard } from "@/components/shared/section-card";
import { StatCard } from "@/components/shared/stat-card";
import { EmptyState } from "@/components/shared/empty-state";
import { DetailGrid, DetailSection, DetailSheet } from "@/components/shared/detail-sheet";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import {
  PaginationBar,
  PageSizeSelect,
  useViewPref,
  ViewSwitcher,
  type DataViewMode,
} from "@/components/shared/view-switcher";
import { DataTable, type DataTableColumn } from "@/components/shared/data-table";
import { DataField } from "@/components/shared/data-field";
import {
  FormSection,
  SwitchField,
  TextField,
} from "@/components/shared/form-fields";
import { FormSheet } from "@/components/shared/form-sheet";
import { mfetch, usePagedSearch, SearchInput } from "./community/shared";

interface PostContent {
  id: string;
  content: string;
  content_type: number;
  thumbnail?: string | null;
}

interface AdminPost {
  id: string;
  user_id: string;
  desc: string | null;
  type: string;
  goal_amount: number | null;
  raised_amount: number;
  deadline: string | null;
  is_verified: boolean;
  is_emergency: boolean;
  is_restricted: number;
  tags: string | null;
  interest_ids: string | null;
  comment_count: number;
  like_count: number;
  report_count: number;
  created_at: string;
  user: { id: string; full_name: string | null; username: string | null; profile: string | null } | null;
  content: PostContent[];
}


const TYPES = ["normal", "cause"];

function formatDate(iso: string | null | undefined) {
  return iso ? new Date(iso).toLocaleDateString(undefined, { dateStyle: "medium" }) : "—";
}

export default function MobileFeedView() {
  const { search, setSearch, query, page, setPage, limit, setLimit, start } = usePagedSearch(20);
  const [posts, setPosts] = useState<AdminPost[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [typeFilter, setTypeFilter] = useState("ALL");
  const [stateFilter, setStateFilter] = useState("ALL"); // ALL | restricted | reported
  const [view, setView] = useViewPref("mobile-feed", "table");
  const [busy, setBusy] = useState<string | null>(null);

  // detail sheet
  const [detail, setDetail] = useState<AdminPost | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  // create / edit (FormSheet)
  const [formOpen, setFormOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<AdminPost | null>(null);
  const [form, setForm] = useState({ desc: "", tags: "", interest_ids: "", media: "", is_restricted: 0 });
  const [formSnapshot, setFormSnapshot] = useState(JSON.stringify(form));
  const [saving, setSaving] = useState(false);

  const [deleteTarget, setDeleteTarget] = useState<AdminPost | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        start: String(start),
        limit: String(limit),
        ...(query ? { q: query } : {}),
        ...(typeFilter !== "ALL" ? { type: typeFilter } : {}),
      });
      const res = await mfetch<{ posts: AdminPost[]; total_count: number }>(
        `/api/mobile-admin/feed?${params.toString()}`
      );
      setPosts(res.posts ?? []);
      setTotal(res.total_count ?? 0);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load posts");
    } finally {
      setLoading(false);
    }
  }, [start, limit, query, typeFilter]);

  useEffect(() => {
    void load();
  }, [load]);

  const openDetail = async (p: AdminPost) => {
    setDetail(p);
    if (p.comment_count > 0) {
      setDetailLoading(true);
      try {
        const res = await mfetch<{ comments: unknown[]; total_count?: number }>(
          `/api/mobile-admin/posts/comments?post_id=${encodeURIComponent(p.id)}`
        );
        setDetail({ ...p, comment_count: (res.comments?.length ?? 0) as number });
      } catch {
        /* keep the row counts */
      } finally {
        setDetailLoading(false);
      }
    }
  };

  const moderate = async (post: AdminPost, action: string) => {
    setBusy(post.id + action);
    try {
      await mfetch("/api/mobile-admin/feed/moderate", { post_id: post.id, action });
      toast.success(`Post ${action}d`);
      setDetail(null);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Action failed");
    } finally {
      setBusy(null);
    }
  };

  // ── create / edit ──
  const openCreate = () => {
    setEditTarget(null);
    setForm({ desc: "", tags: "", interest_ids: "", media: "", is_restricted: 0 });
    setFormSnapshot(JSON.stringify(form));
    setFormOpen(true);
  };

  const openEdit = (p: AdminPost) => {
    setEditTarget(p);
    setForm({
      desc: p.desc ?? "",
      tags: p.tags ?? "",
      interest_ids: p.interest_ids ?? "",
      media: "",
      is_restricted: p.is_restricted,
    });
    setFormSnapshot(JSON.stringify({ desc: p.desc ?? "", tags: p.tags ?? "", interest_ids: p.interest_ids ?? "", media: "", is_restricted: p.is_restricted }));
    setFormOpen(true);
  };

  const save = async () => {
    setSaving(true);
    try {
      if (editTarget) {
        await mfetch("/api/mobile-admin/feed/update", {
          post_id: editTarget.id,
          desc: form.desc,
          tags: form.tags,
          interest_ids: form.interest_ids,
          is_restricted: form.is_restricted,
        });
        toast.success("Post updated");
      } else {
        await mfetch("/api/mobile-admin/feed", {
          desc: form.desc,
          tags: form.tags,
          interest_ids: form.interest_ids,
          media: form.media.split(",").map((s) => s.trim()).filter(Boolean),
        });
        toast.success("Post created");
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

  // ── derived ──
  const stats = useMemo(() => {
    // KPIs come from the unfiltered current page result set totals
    const restricted = posts.filter((p) => p.is_restricted === 1).length;
    const reported = posts.reduce((acc, p) => acc + (p.report_count ?? 0), 0);
    return { total, restricted, reported, causes: posts.filter((p) => p.type === "cause").length };
  }, [posts, total]);

  const filterChips = [
    ...(typeFilter !== "ALL" ? [{ key: "type", label: typeFilter, clear: () => setTypeFilter("ALL") }] : []),
    ...(stateFilter !== "ALL" ? [{ key: "state", label: stateFilter, clear: () => setStateFilter("ALL") }] : []),
    ...(query ? [{ key: "q", label: `“${query}”`, clear: () => setSearch("") }] : []),
  ];

  const filtered = useMemo(() => {
    return posts.filter((p) => {
      if (stateFilter === "restricted" && p.is_restricted !== 1) return false;
      if (stateFilter === "reported" && (p.report_count ?? 0) === 0) return false;
      return true;
    });
  }, [posts, stateFilter]);

  const pages = Math.max(1, Math.ceil(total / limit));
  const safePage = Math.min(page, pages);

  const emptyNode = (
    <EmptyState
      title={query || stateFilter !== "ALL" || typeFilter !== "ALL" ? "No posts match the filters" : "No posts yet"}
      hint="Posts created from the mobile app appear here."
    />
  );

  // ── table columns ──
  const columns: DataTableColumn<AdminPost>[] = [
    { key: "post", header: "Post" },
    { key: "author", header: "Author" },
    { key: "type", header: "Type" },
    { key: "engagement", header: "Engagement" },
    { key: "state", header: "State" },
    { key: "created_at", header: "Created" },
    { key: "actions", header: "Actions" },
  ];

  const renderCell = (p: AdminPost, col: DataTableColumn<AdminPost>) => {
    switch (col.key) {
      case "post": {
        const cover = p.content?.[0];
        return (
          <div className="flex items-center gap-3">
            {cover?.content ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={cover.content} alt="" className="size-10 rounded-md object-cover" loading="lazy" />
            ) : (
              <span className="flex size-10 items-center justify-center rounded-md bg-muted text-[10px] text-muted-foreground">
                {p.content?.length ?? 0} media
              </span>
            )}
            <div className="max-w-md">
              <div className="line-clamp-1 font-medium">{p.desc || "(no text)"}</div>
              {p.tags && <div className="text-xs text-muted-foreground">{p.tags}</div>}
            </div>
          </div>
        );
      }
      case "author":
        return p.user?.full_name || p.user?.username || "—";
      case "type":
        return <Badge variant="outline">{p.type}</Badge>;
      case "engagement":
        return (
          <span className="text-xs text-muted-foreground">
            {p.like_count ?? 0} likes · {p.comment_count ?? 0} comments
          </span>
        );
      case "state":
        return (
          <div className="flex flex-wrap gap-1">
            {p.is_verified && <Badge variant="default"><BadgeCheck className="mr-1 inline size-3" />Verified</Badge>}
            {p.is_emergency && <Badge variant="destructive">Emergency</Badge>}
            {p.is_restricted === 1 && <Badge variant="secondary"><EyeOff className="mr-1 inline size-3" />Restricted</Badge>}
            {(p.report_count ?? 0) > 0 && <Badge variant="outline" className="gap-1"><AlertTriangle className="size-3" />{p.report_count}</Badge>}
            {!p.is_verified && (p.report_count ?? 0) === 0 && p.is_restricted !== 1 && <span className="text-muted-foreground">—</span>}
          </div>
        );
      case "created_at":
        return <span className="text-xs text-muted-foreground">{formatDate(p.created_at)}</span>;
      case "actions":
        return (
          <div className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
            <Button variant="ghost" size="sm" aria-label="Edit post" onClick={() => openEdit(p)}>
              <Pencil className="size-4" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              aria-label={p.is_restricted === 1 ? "Unrestrict post" : "Restrict post"}
              disabled={busy === p.id + "restrict"}
              onClick={() => void moderate(p, p.is_restricted === 1 ? "unrestrict" : "restrict")}
            >
              <EyeOff className="size-4" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              aria-label={p.is_verified ? "Unverify post" : "Verify post"}
              disabled={busy === p.id + "verify"}
              onClick={() => void moderate(p, p.is_verified ? "unverify" : "verify")}
            >
              <BadgeCheck className="size-4" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="text-red-600 hover:text-red-600 dark:text-red-400"
              aria-label="Delete post"
              disabled={busy === p.id + "delete"}
              onClick={() => setDeleteTarget(p)}
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
    <div className="space-y-4 sm:space-y-6">
      <PageHeader
        title="Feed"
        description="Mobile feed posts — media, engagement, restriction and verification control."
        icon={<MessageSquare className="size-5" aria-hidden="true" />}
        actions={
          <>
            <Button variant="outline" onClick={() => void load()} aria-label="Refresh feed">
              <RefreshCw className="size-4" aria-hidden="true" /> Refresh
            </Button>
            <Button onClick={openCreate} aria-label="Create new post">
              <Plus className="size-4" /> New post
            </Button>
          </>
        }
      />

      {/* KPI strip */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Total posts" value={String(stats.total)} icon={<MessageSquare className="size-5" aria-hidden="true" />} accent="emerald" hint="All feed posts" loading={loading} />
        <StatCard label="Restricted" value={String(stats.restricted)} icon={<EyeOff className="size-5" aria-hidden="true" />} accent="amber" hint="Hidden from the feed" loading={loading} />
        <StatCard label="Open reports" value={String(stats.reported)} icon={<AlertTriangle className="size-5" aria-hidden="true" />} accent="pink" hint="Awaiting moderation" loading={loading} />
        <StatCard label="Fundraiser posts" value={String(stats.causes)} icon={<BadgeCheck className="size-5" aria-hidden="true" />} accent="cyan" hint="type = cause" loading={loading} />
      </div>

      <SectionCard
        title="Post directory"
        icon={<MessageSquare className="size-4" aria-hidden="true" />}
        description={loading ? "Loading posts…" : `${filtered.length} of ${total} posts`}
        bodyClassName="space-y-4"
        actions={<ViewSwitcher value={view} onChange={setView} />}
      >
        {/* Toolbar */}
        <div className="flex flex-wrap items-center gap-2">
          <SearchInput value={search} onChange={setSearch} placeholder="Search post text or author…" label="Search posts" />
          <Select value={typeFilter} onValueChange={setTypeFilter}>
            <SelectTrigger size="sm" className="w-[130px] text-xs" aria-label="Filter by type">
              <SelectValue placeholder="All types" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All types</SelectItem>
              {TYPES.map((t) => (
                <SelectItem key={t} value={t}>{t}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={stateFilter} onValueChange={setStateFilter}>
            <SelectTrigger size="sm" className="w-[140px] text-xs" aria-label="Filter by state">
              <SelectValue placeholder="Any state" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">Any state</SelectItem>
              <SelectItem value="restricted">Restricted</SelectItem>
              <SelectItem value="reported">Reported</SelectItem>
            </SelectContent>
          </Select>

          {filterChips.map((chip) => (
            <Badge key={chip.key} variant="outline" className="gap-1 pr-1 text-xs font-medium">
              {chip.label}
              <button
                type="button"
                aria-label={`Clear ${chip.label} filter`}
                onClick={chip.clear}
                className="rounded-full p-0.5 transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <X className="size-3" aria-hidden="true" />
              </button>
            </Badge>
          ))}

          {filterChips.length > 0 ? (
            <Button
              variant="ghost"
              size="sm"
              aria-label="Clear all filters"
              onClick={() => {
                setSearch("");
                setTypeFilter("ALL");
                setStateFilter("ALL");
              }}
            >
              <X className="size-4" /> Clear all
            </Button>
          ) : null}

          <span className="ml-auto text-xs tabular-nums text-muted-foreground" aria-live="polite">
            {loading ? "Loading…" : `${filtered.length} result${filtered.length === 1 ? "" : "s"}`}
          </span>
        </div>

        {view === "table" ? (
          <DataTable
            columns={columns}
            rows={filtered}
            rowKey={(p) => p.id}
            loading={loading}
            skeletonRows={8}
            height="fill"
            fillOffset={520}
            onRowClick={openDetail}
            page={safePage}
            pages={pages}
            total={total}
            pageSize={limit}
            onPage={setPage}
            onPageSize={setLimit}
            itemLabel="posts"
            empty={emptyNode}
          >
            {renderCell}
          </DataTable>
        ) : loading ? (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3" aria-busy="true">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-40 w-full" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          emptyNode
        ) : view === "list" ? (
          <ul className="divide-y rounded-xl border bg-card">
            {filtered.map((p) => {
              const cover = p.content?.[0];
              return (
                <li key={p.id}>
                  <button
                    type="button"
                    onClick={() => openDetail(p)}
                    aria-label={`Open post by ${p.user?.full_name ?? "user"}`}
                    className="flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-accent focus-visible:outline-2 focus-visible:outline-primary sm:px-4"
                  >
                    {cover?.content ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={cover.content} alt="" className="size-9 shrink-0 rounded-lg object-cover" loading="lazy" />
                    ) : (
                      <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted">
                        <MessageSquare className="size-4" aria-hidden="true" />
                      </span>
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{p.desc || "(no text)"}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {p.user?.full_name || p.user?.username || "—"} · {formatDate(p.created_at)}
                      </p>
                    </div>
                    <div className="hidden shrink-0 text-right sm:block">
                      <p className="text-sm font-semibold">{p.like_count ?? 0} likes</p>
                      <p className="text-[11px] text-muted-foreground">{p.comment_count ?? 0} comments</p>
                    </div>
                    <Badge variant="outline" className="shrink-0">{p.type}</Badge>
                  </button>
                </li>
              );
            })}
          </ul>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {filtered.map((p) => {
              const cover = p.content?.[0];
              return (
                <article
                  key={p.id}
                  onClick={() => openDetail(p)}
                  className="flex cursor-pointer flex-col gap-3 rounded-xl border bg-card p-4 transition-colors hover:bg-accent/40"
                >
                  <div className="flex items-start gap-3">
                    {cover?.content ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={cover.content} alt="" className="size-10 rounded-lg object-cover" loading="lazy" />
                    ) : (
                      <span className="flex size-10 items-center justify-center rounded-xl bg-muted">
                        <MessageSquare className="size-5" aria-hidden="true" />
                      </span>
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{p.desc || "(no text)"}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {p.user?.full_name || p.user?.username || "—"} · {formatDate(p.created_at)}
                      </p>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    <Badge variant="outline">{p.type}</Badge>
                    {p.is_verified && <Badge variant="default">Verified</Badge>}
                    {p.is_restricted === 1 && <Badge variant="secondary">Restricted</Badge>}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {p.like_count ?? 0} likes · {p.comment_count ?? 0} comments
                    {(p.report_count ?? 0) > 0 ? ` · ${p.report_count} reports` : ""}
                  </div>
                </article>
              );
            })}
          </div>
        )}

        {/* grid / list pager */}
        {view !== "table" && !loading && filtered.length > 0 ? (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <PaginationBar page={safePage} pages={pages} total={total} onPage={setPage} itemLabel="posts" />
            <PageSizeSelect value={limit} onChange={setLimit} />
          </div>
        ) : null}
      </SectionCard>

      {/* Detail sheet */}
      <DetailSheet
        open={detail !== null}
        onOpenChange={(o) => {
          if (!o) setDetail(null);
        }}
        eyebrow="Mobile feed"
        title={detail?.desc?.slice(0, 60) || "Post"}
        description={detail ? `${detail.user?.full_name || detail.user?.username || "—"} · ${formatDate(detail.created_at)}` : ""}
        status={
          detail ? (
            <div className="flex gap-1">
              <Badge variant="outline">{detail.type}</Badge>
              {detail.is_restricted === 1 && <Badge variant="secondary">Restricted</Badge>}
            </div>
          ) : undefined
        }
        actions={
          detail ? (
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={() => openEdit(detail)}>
                <Pencil className="size-4" /> Edit
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => void moderate(detail, detail.is_verified ? "unverify" : "verify")}
              >
                <BadgeCheck className="size-4" /> {detail.is_verified ? "Unverify" : "Verify"}
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => void moderate(detail, detail.is_restricted === 1 ? "unrestrict" : "restrict")}
              >
                <EyeOff className="size-4" /> {detail.is_restricted === 1 ? "Unrestrict" : "Restrict"}
              </Button>
              <Button size="sm" variant="destructive" onClick={() => setDeleteTarget(detail)}>
                <Trash2 className="size-4" /> Delete
              </Button>
            </div>
          ) : undefined
        }
      >
        {detail ? (
          <Tabs defaultValue="content" className="gap-5">
            <TabsList>
              <TabsTrigger value="content">Content</TabsTrigger>
              <TabsTrigger value="media">Media</TabsTrigger>
            </TabsList>
            <TabsContent value="content" className="space-y-6">
              <DetailSection title="Post">
                <DetailGrid>
                  <DataField label="Text" value={detail.desc || "(no text)"} />
                  <DataField label="Author" value={detail.user?.full_name || detail.user?.username || "—"} />
                  <DataField label="Type" value={detail.type} />
                  <DataField label="Likes / Comments" value={`${detail.like_count ?? 0} / ${detail.comment_count ?? 0}`} />
                  <DataField label="Reports" value={String(detail.report_count ?? 0)} />
                  <DataField label="Created" value={formatDate(detail.created_at)} />
                </DetailGrid>
              </DetailSection>
            </TabsContent>
            <TabsContent value="media" className="space-y-4">
              {(detail.content?.length ?? 0) === 0 ? (
                <p className="text-sm text-muted-foreground">No media attached.</p>
              ) : (
                <div className="grid gap-3 sm:grid-cols-2">
                  {detail.content!.map((c) => (
                    <a
                      key={c.id}
                      href={c.content}
                      target="_blank"
                      rel="noreferrer"
                      className="group relative block overflow-hidden rounded-lg border"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={c.thumbnail || c.content}
                        alt=""
                        className="h-36 w-full object-cover transition-transform group-hover:scale-[1.02]"
                        loading="lazy"
                      />
                      <span className="absolute bottom-1 right-1 rounded bg-black/60 px-1.5 py-0.5 text-[10px] text-white">
                        {c.content_type === 1 ? "video" : c.content_type === 2 ? "audio" : "image"}
                      </span>
                    </a>
                  ))}
                </div>
              )}
            </TabsContent>
          </Tabs>
        ) : null}
      </DetailSheet>

      {/* Create / edit FormSheet */}
      <FormSheet
        open={formOpen}
        onOpenChange={setFormOpen}
        title={editTarget ? "Edit post" : "New post"}
        description={
          editTarget
            ? "Update the post text, tags, interests and visibility."
            : "Creates the post under your admin account."
        }
        onSubmit={save}
        submitLabel={editTarget ? "Save changes" : "Create post"}
        loading={saving}
        dirty={formDirty}
      >
        <FormSection title="Content">
          <TextField
            label="Description"
            value={form.desc}
            onChange={(v) => setForm({ ...form, desc: v })}
          />
          <TextField
            label="Tags"
            value={form.tags}
            onChange={(v) => setForm({ ...form, tags: v })}
            placeholder="news,update"
          />
          <TextField
            label="Interest IDs (comma separated)"
            value={form.interest_ids}
            onChange={(v) => setForm({ ...form, interest_ids: v })}
            placeholder="1,2"
          />
          {!editTarget && (
            <TextField
              label="Media URLs (comma separated)"
              value={form.media}
              onChange={(v) => setForm({ ...form, media: v })}
              placeholder="https://…,https://…"
            />
          )}
        </FormSection>
        {editTarget && (
          <FormSection title="Visibility">
            <SwitchField
              label="Restricted (hidden from the feed)"
              checked={form.is_restricted === 1}
              onChange={(v) => setForm({ ...form, is_restricted: v ? 1 : 0 })}
            />
          </FormSection>
        )}
      </FormSheet>

      {/* Delete confirm */}
      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
        title="Delete this post?"
        description="The post, its media, likes and comments will be permanently removed."
        confirmLabel="Delete"
        onConfirm={() => {
          if (deleteTarget) void moderate(deleteTarget, "delete");
        }}
      />
    </div>
  );
}

