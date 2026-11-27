"use client";

/**
 * Community — admin surface for the mobile app's community domain
 * (the legacy Laravel "chatter" charity features, now served by the generic
 * routers /api/community/admin/* — shared with the mobile app).
 *
 * Tabs:
 *  - Users     — mobile users with their charity profile (tier, points,
 *                lifetime donated, impact score) and activity counts
 *  - Posts     — CommunityPost moderation: verify / restrict / delete,
 *                with per-post report counts
 *  - Causes    — CommunityPost(type=cause) fundraising review: progress
 *                vs goal, followers, donations, verification
 *  - Reports   — CommunityReport queue: delete the reported post/comment
 *                or dismiss the report
 *  - Volunteer applications — summary + link; full approve/reject flows
 *                already live in the Volunteers section (volunteers-view.tsx)
 *
 * Transport: the generic community routers answer raw JSON (paged lists,
 * camelCase fields) to the same Bearer session the api-client attaches.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  BadgeCheck,
  Ban,
  CheckCircle2,
  Flag,
  HandHeart,
  Megaphone,
  MessageSquare,
  RefreshCw,
  Search,
  ShieldCheck,
  Trash2,
  Users,
  Clapperboard,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { get, post } from "@/lib/api-client";
import { formatDate, formatINR, formatINRCompact, titleCase } from "@/lib/format";
import { navigate } from "@/lib/router";
import { PageHeader } from "@/components/shared/page-header";
import { SectionCard } from "@/components/shared/section-card";
import { StatCard } from "@/components/shared/stat-card";
import { EmptyState } from "@/components/shared/empty-state";
import { StatusBadge } from "@/components/shared/status-badge";
import { DetailSheet } from "@/components/shared/detail-sheet";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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

/* ───────────────────────────── transport ─────────────────────────────── */

interface Paged<T> {
  items: T[];
  page: number;
  limit: number;
  total: number;
  hasMore: boolean;
}

/* ─────────────────────────────── types ───────────────────────────────── */

interface AdminUser {
  id: string;
  name: string;
  username: string | null;
  email?: string;
  avatar: string | null;
  about: string | null;
  city: string | null;
  phone?: string | null;
  role: string;
  status: string;
  isBlocked: boolean;
  isVerified: boolean;
  userType: string | null;
  volunteerStatus: string | null;
  totalPoints: number;
  lifetimeDonated: number;
  impactScore: number;
  currentTier: string;
  memberSince: string | null;
  createdAt: string;
  followingCount: number;
  followersCount: number;
  postCount: number;
  causeCount: number;
  donationCount: number;
  donationTotal: number;
}

interface PostContent {
  id: string;
  contentType: number;
  content: string;
}

interface AdminPost {
  id: string;
  desc: string | null;
  type: string;
  goalAmount: number | null;
  raisedAmount: number;
  deadline: string | null;
  isVerified: boolean;
  isEmergency: boolean;
  isRestricted: number;
  commentCount: number;
  likeCount: number;
  reportCount: number;
  donationCount: number;
  createdAt: string;
  author: { id: string; name: string | null; username: string | null; avatar: string | null } | null;
  content: PostContent[];
  category: { id: number; name: string } | null;
}

interface AdminCause extends AdminPost {
  causeFollowerCount: number;
  progressPercentage: number;
}

interface AdminReport {
  id: string;
  type: number | null; // 0 room | 1 post | 2 user | 3 reel
  reason: string;
  desc: string;
  createdAt: string;
  reporter: { id: string; name: string; username: string | null; avatar: string | null; email?: string } | null;
  post: { id: string; desc: string | null; type: string; isRestricted: number; author: { id: string; name: string; username: string | null } | null } | null;
  comment: { id: string; desc: string; author: { id: string; name: string; username: string | null } | null } | null;
  room: { id: string; title: string } | null;
  reel: { id: string; description: string | null; thumbnail: string | null } | null;
}

interface PendingApplication {
  id: string;
  fullName: string;
  email: string;
  city: string;
  createdAt: string;
}

const TIER_HEX: Record<string, string> = {
  bronze: "#CD7F32",
  silver: "#C0C0C0",
  gold: "#FFD700",
  platinum: "#E5E4E2",
  diamond: "#B9F2FF",
};

const REPORT_TYPES: Record<number, string> = { 0: "Room", 1: "Post", 2: "User", 3: "Reel" };

function TierBadge({ tier }: { tier: string }) {
  return (
    <Badge
      variant="outline"
      className="gap-1 text-[10px] font-semibold"
      style={{ color: TIER_HEX[tier] ?? TIER_HEX.bronze, borderColor: `${TIER_HEX[tier] ?? TIER_HEX.bronze}55` }}
    >
      <span aria-hidden="true" className="size-1.5 rounded-full" style={{ backgroundColor: TIER_HEX[tier] ?? TIER_HEX.bronze }} />
      {titleCase(tier)}
    </Badge>
  );
}

/* ─────────────────────────────── view ────────────────────────────────── */

export default function CommunityView() {
  const [tab, setTab] = useState<string>("users");

  // shared counts for the KPI strip
  const [totals, setTotals] = useState({ users: 0, posts: 0, causes: 0, reports: 0 });
  const [loading, setLoading] = useState(true);

  const loadTotals = useCallback(async () => {
    setLoading(true);
    try {
      const [users, posts, causes, reports] = await Promise.all([
        get<Paged<AdminUser>>("/api/community/admin/users?limit=1"),
        get<Paged<AdminPost>>("/api/community/admin/posts?limit=1"),
        get<Paged<AdminCause>>("/api/community/admin/causes?limit=1"),
        get<Paged<AdminReport>>("/api/community/admin/reports?limit=1"),
      ]);
      setTotals({
        users: users.total,
        posts: posts.total,
        causes: causes.total,
        reports: reports.total,
      });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load community stats");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadTotals();
  }, [loadTotals]);

  return (
    <div className="space-y-4 sm:space-y-6">
      <PageHeader
        title="Community"
        description="Mobile app community: members, posts, fundraising causes and moderation queue."
        icon={<Users className="size-5" aria-hidden="true" />}
        actions={
          <Button variant="outline" onClick={() => void loadTotals()} aria-label="Refresh community data">
            <RefreshCw className="size-4" aria-hidden="true" /> Refresh
          </Button>
        }
      />

      {/* KPI strip */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Members" value={totals.users} hint="Mobile community users" icon={<Users className="size-5" aria-hidden="true" />} accent="emerald" loading={loading} />
        <StatCard label="Posts" value={totals.posts} hint="All community posts" icon={<MessageSquare className="size-5" aria-hidden="true" />} accent="cyan" loading={loading} />
        <StatCard label="Fundraising causes" value={totals.causes} hint="type=cause posts" icon={<HandHeart className="size-5" aria-hidden="true" />} accent="amber" loading={loading} />
        <StatCard label="Open reports" value={totals.reports} hint="Community moderation queue" icon={<Flag className="size-5" aria-hidden="true" />} accent="pink" loading={loading} />
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="h-auto w-full flex-wrap sm:w-auto">
          <TabsTrigger value="users">Members</TabsTrigger>
          <TabsTrigger value="posts">
            Posts
            {totals.reports > 0 && (
              <Badge variant="destructive" className="ml-1.5 px-1.5 tabular-nums">
                {totals.reports}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="reels">Reels</TabsTrigger>
          <TabsTrigger value="causes">Causes</TabsTrigger>
          <TabsTrigger value="reports">Reports</TabsTrigger>
          <TabsTrigger value="volunteers">Volunteer applications</TabsTrigger>
        </TabsList>

        <TabsContent value="users" className="mt-4">
          <UsersTab />
        </TabsContent>
        <TabsContent value="posts" className="mt-4">
          <PostsTab onChanged={loadTotals} />
        </TabsContent>
        <TabsContent value="reels" className="mt-4">
          <ReelsTab />
        </TabsContent>
        <TabsContent value="causes" className="mt-4">
          <CausesTab onChanged={loadTotals} />
        </TabsContent>
        <TabsContent value="reports" className="mt-4">
          <ReportsTab onChanged={loadTotals} />
        </TabsContent>
        <TabsContent value="volunteers" className="mt-4">
          <VolunteersTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}

/* ───────────────────────────── Users tab ─────────────────────────────── */

function UsersTab() {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [tierFilter, setTierFilter] = useState("ALL");
  const [sheet, setSheet] = useState<AdminUser | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await get<Paged<AdminUser>>("/api/community/admin/users?limit=100");
      setUsers(res.items ?? []);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load members");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return users.filter((u) => {
      if (tierFilter !== "ALL" && u.currentTier !== tierFilter) return false;
      if (
        q &&
        !`${u.name ?? ""}`.toLowerCase().includes(q) &&
        !`${u.email ?? ""}`.toLowerCase().includes(q) &&
        !`${u.username ?? ""}`.toLowerCase().includes(q)
      )
        return false;
      return true;
    });
  }, [users, search, tierFilter]);

  return (
    <SectionCard
      title="Members"
      icon={<Users className="size-4" aria-hidden="true" />}
      description={loading ? "Loading members…" : `${filtered.length} of ${users.length} members`}
      bodyClassName="space-y-4"
    >
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[200px] flex-1 sm:max-w-xs">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name, email or username…"
            className="h-8 pl-8 text-sm"
            aria-label="Search members"
          />
        </div>
        <Select value={tierFilter} onValueChange={setTierFilter}>
          <SelectTrigger size="sm" className="w-[130px] text-xs" aria-label="Filter by tier">
            <SelectValue placeholder="All tiers" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All tiers</SelectItem>
            {["bronze", "silver", "gold", "platinum"].map((t) => (
              <SelectItem key={t} value={t}>{titleCase(t)}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        {tierFilter !== "ALL" && (
          <Button variant="ghost" size="sm" onClick={() => setTierFilter("ALL")}>
            <X className="size-4" /> Clear
          </Button>
        )}
      </div>

      {loading ? (
        <div className="space-y-2" aria-busy="true">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={<Users className="size-6" aria-hidden="true" />}
          title={users.length === 0 ? "No members yet" : "No members match the filters"}
          hint={users.length === 0 ? "Members appear here once the mobile app has sign-ups." : "Try clearing the search or tier filter."}
        />
      ) : (
        <div className="overflow-x-auto rounded-xl border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Member</TableHead>
                <TableHead className="hidden md:table-cell">Tier</TableHead>
                <TableHead className="text-right">Points</TableHead>
                <TableHead className="hidden text-right sm:table-cell">Lifetime</TableHead>
                <TableHead className="hidden text-right lg:table-cell">Impact</TableHead>
                <TableHead className="hidden lg:table-cell">Joined</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((u) => (
                <TableRow key={u.id} className="cursor-pointer" onClick={() => setSheet(u)}>
                  <TableCell>
                    <div className="flex items-center gap-2.5">
                      <Avatar className="size-8">
                        {u.avatar ? <AvatarFallback><img src={u.avatar} alt="" className="size-8 rounded-full object-cover" /></AvatarFallback> : null}
                        <AvatarFallback className="text-xs">{(u.name ?? "?").slice(0, 1).toUpperCase()}</AvatarFallback>
                      </Avatar>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{u.name ?? "—"}</p>
                        <p className="truncate text-[11px] text-muted-foreground">
                          {u.username ? `@${u.username}` : u.email}
                        </p>
                      </div>
                      {u.isBlocked && <Badge variant="destructive" className="ml-1 text-[10px]">Blocked</Badge>}
                    </div>
                  </TableCell>
                  <TableCell className="hidden md:table-cell">
                    <TierBadge tier={u.currentTier} />
                  </TableCell>
                  <TableCell className="text-right font-mono text-sm tabular-nums">{u.totalPoints}</TableCell>
                  <TableCell className="hidden text-right text-sm tabular-nums sm:table-cell">{formatINRCompact(u.lifetimeDonated)}</TableCell>
                  <TableCell className="hidden text-right text-sm tabular-nums lg:table-cell">{u.impactScore}</TableCell>
                  <TableCell className="hidden text-xs text-muted-foreground lg:table-cell">{formatDate(u.createdAt)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <DetailSheet
        open={!!sheet}
        onOpenChange={(o) => !o && setSheet(null)}
        eyebrow="Community member"
        title={sheet?.name ?? "Member"}
        description={sheet ? `${sheet.email}${sheet.city ? ` · ${sheet.city}` : ""}` : undefined}
        status={sheet ? <TierBadge tier={sheet.currentTier} /> : undefined}
      >
        {sheet && (
          <div className="grid gap-3 sm:grid-cols-2">
            {[
              ["Charity points", String(sheet.totalPoints)],
              ["Lifetime donated", formatINR(sheet.lifetimeDonated)],
              ["Impact score", String(sheet.impactScore)],
              ["Member since", sheet.memberSince ? formatDate(sheet.memberSince) : "—"],
              ["Donations", `${sheet.donationCount} · ${formatINR(sheet.donationTotal)}`],
              ["Posts / causes", `${sheet.postCount} / ${sheet.causeCount}`],
              ["Followers / following", `${sheet.followersCount} / ${sheet.followingCount}`],
              ["User type", sheet.userType ? titleCase(sheet.userType) : "—"],
              ["Volunteer status", sheet.volunteerStatus ? titleCase(sheet.volunteerStatus) : "—"],
              ["Account status", titleCase(sheet.status)],
              ["Phone", sheet.phone ?? "—"],
              ["About", sheet.about ?? "—"],
            ].map(([label, value]) => (
              <div key={label} className="rounded-lg border bg-muted/30 px-3 py-2">
                <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
                <p className="mt-0.5 truncate text-sm">{value}</p>
              </div>
            ))}
          </div>
        )}
      </DetailSheet>
    </SectionCard>
  );
}

/* ───────────────────────────── Posts tab ─────────────────────────────── */

function PostsTab({ onChanged }: { onChanged: () => void }) {
  const [posts, setPosts] = useState<AdminPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("ALL");
  const [deleteTarget, setDeleteTarget] = useState<AdminPost | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await get<Paged<AdminPost>>("/api/community/admin/posts?limit=100");
      setPosts(res.items ?? []);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load posts");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const moderate = async (item: AdminPost, action: string) => {
    setBusy(item.id + action);
    try {
      await post("/api/community/admin/posts/moderate", { postId: item.id, action });
      toast.success(
        action === "delete" ? "Post deleted"
          : action === "verify" ? "Post verified"
          : action === "unverify" ? "Verification removed"
          : action === "restrict" ? "Post restricted"
          : "Restriction removed"
      );
      await load();
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Action failed");
    } finally {
      setBusy(null);
    }
  };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return posts.filter((p) => {
      if (typeFilter !== "ALL" && p.type !== typeFilter) return false;
      if (q && !`${p.desc ?? ""}`.toLowerCase().includes(q) && !`${p.author?.name ?? ""}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [posts, search, typeFilter]);

  return (
    <SectionCard
      title="Posts"
      icon={<MessageSquare className="size-4" aria-hidden="true" />}
      description={loading ? "Loading posts…" : `${filtered.length} of ${posts.length} posts`}
      bodyClassName="space-y-4"
    >
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[200px] flex-1 sm:max-w-xs">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search post text or author…"
            className="h-8 pl-8 text-sm"
            aria-label="Search posts"
          />
        </div>
        <Select value={typeFilter} onValueChange={setTypeFilter}>
          <SelectTrigger size="sm" className="w-[130px] text-xs" aria-label="Filter by type">
            <SelectValue placeholder="All types" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All types</SelectItem>
            <SelectItem value="normal">Normal</SelectItem>
            <SelectItem value="cause">Cause</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {loading ? (
        <div className="space-y-2" aria-busy="true">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-14 w-full" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState icon={<MessageSquare className="size-6" aria-hidden="true" />} title="No posts" hint="Community posts from the mobile app appear here." />
      ) : (
        <ul className="divide-y rounded-xl border">
          {filtered.map((p) => (
            <li key={p.id} className="flex items-start gap-3 px-3 py-3 sm:px-4">
              <Avatar className="size-8 shrink-0">
                <AvatarFallback className="text-xs">{(p.author?.name ?? "?").slice(0, 1).toUpperCase()}</AvatarFallback>
              </Avatar>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-sm font-medium">{p.author?.name ?? "Unknown"}</span>
                  <Badge variant="outline" className="text-[10px]">{titleCase(p.type)}</Badge>
                  {p.isVerified && (
                    <Badge variant="outline" className="gap-0.5 border-emerald-500/30 bg-emerald-500/10 text-[10px] text-emerald-700 dark:text-emerald-400">
                      <BadgeCheck className="size-3" aria-hidden="true" /> Verified
                    </Badge>
                  )}
                  {p.isRestricted === 1 && (
                    <Badge variant="outline" className="gap-0.5 border-amber-500/30 bg-amber-500/10 text-[10px] text-amber-700 dark:text-amber-400">
                      <Ban className="size-3" aria-hidden="true" /> Restricted
                    </Badge>
                  )}
                  {p.isEmergency && <Badge variant="destructive" className="text-[10px]">Emergency</Badge>}
                  {p.reportCount > 0 && (
                    <Badge variant="outline" className="gap-0.5 border-red-500/30 bg-red-500/10 text-[10px] text-red-600 dark:text-red-400">
                      <Flag className="size-3" aria-hidden="true" /> {p.reportCount} report{p.reportCount === 1 ? "" : "s"}
                    </Badge>
                  )}
                </div>
                <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{p.desc ?? "—"}</p>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  {p.likeCount} likes · {p.commentCount} comments
                  {p.type === "cause" ? ` · ${formatINRCompact(p.raisedAmount)} of ${formatINRCompact(p.goalAmount ?? 0)}` : ""}
                  {" · "}
                  {formatDate(p.createdAt)}
                </p>
              </div>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="sm" aria-label={`Moderate post from ${p.author?.name ?? "user"}`} disabled={busy === p.id + "delete"}>
                    <ShieldCheck className="size-4" /> Moderate
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-48">
                  {p.isVerified ? (
                    <DropdownMenuItem onSelect={() => void moderate(p, "unverify")}>
                      <X className="size-4" /> Remove verification
                    </DropdownMenuItem>
                  ) : (
                    <DropdownMenuItem onSelect={() => void moderate(p, "verify")}>
                      <BadgeCheck className="size-4" /> Verify
                    </DropdownMenuItem>
                  )}
                  {p.isRestricted === 1 ? (
                    <DropdownMenuItem onSelect={() => void moderate(p, "unrestrict")}>
                      <CheckCircle2 className="size-4" /> Unrestrict
                    </DropdownMenuItem>
                  ) : (
                    <DropdownMenuItem onSelect={() => void moderate(p, "restrict")}>
                      <Ban className="size-4" /> Restrict
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onSelect={() => setDeleteTarget(p)}
                    className="text-red-600 focus:text-red-600 dark:text-red-400"
                  >
                    <Trash2 className="size-4" /> Delete post
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </li>
          ))}
        </ul>
      )}

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
        title="Delete post?"
        description={`This permanently removes the post (“${deleteTarget?.desc?.slice(0, 60) ?? ""}…”), its media, comments and likes. This cannot be undone.`}
        confirmLabel="Delete"
        onConfirm={async () => {
          if (deleteTarget) await moderate(deleteTarget, "delete");
          setDeleteTarget(null);
        }}
      />
    </SectionCard>
  );
}

// ── Reels — every reel with its server-side transcode state ──────────────────

interface ReelTranscode {
  mediaId: string;
  status: "pending_upload" | "uploaded" | "processing" | "ready" | "failed";
  attempts: number;
  error: string | null;
  durationMs: number | null;
  readyAt: string | null;
}

interface AdminReel {
  id: string;
  description: string | null;
  thumbnail: string | null;
  viewsCount: number;
  likesCount: number;
  commentsCount: number;
  reportsCount: number;
  createdAt: string;
  author: { id: string; name: string | null } | null;
  transcode: ReelTranscode | null;
}

const TRANSCODE_LABEL: Record<ReelTranscode["status"], string> = {
  pending_upload: "Awaiting upload",
  uploaded: "Queued",
  processing: "Optimising",
  ready: "Ready",
  failed: "Failed",
};

const TRANSCODE_TONE: Record<ReelTranscode["status"], string> = {
  pending_upload: "border-muted-foreground/30 text-muted-foreground",
  uploaded: "border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-400",
  processing: "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400",
  ready: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  failed: "border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-400",
};

const STATUS_FILTERS: { value: string; label: string }[] = [
  { value: "ALL", label: "All states" },
  { value: "processing", label: "Optimising" },
  { value: "uploaded", label: "Queued" },
  { value: "failed", label: "Failed" },
  { value: "ready", label: "Ready" },
];

const REELS_PAGE_SIZE = 20;

function ReelsTab() {
  const [reels, setReels] = useState<AdminReel[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("ALL");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: String(page),
        limit: String(REELS_PAGE_SIZE),
        ...(query ? { q: query } : {}),
        ...(status !== "ALL" ? { status } : {}),
      });
      const res = await get<Paged<AdminReel>>(`/api/community/admin/reels?${params}`);
      setReels(res.items ?? []);
      setTotal(res.total ?? 0);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load reels");
    } finally {
      setLoading(false);
    }
  }, [page, query, status]);

  useEffect(() => {
    void load();
  }, [load]);

  // Transcode state changes on the server, so the list refreshes itself
  // while anything is still being optimised.
  const hasActive = reels.some((r) => r.transcode && r.transcode.status !== "ready" && r.transcode.status !== "failed");
  useEffect(() => {
    if (!hasActive) return;
    const timer = setInterval(() => void load(), 5000);
    return () => clearInterval(timer);
  }, [hasActive, load]);

  const pages = Math.max(1, Math.ceil(total / REELS_PAGE_SIZE));

  return (
    <SectionCard
      title="Reels"
      icon={<Clapperboard className="size-4" aria-hidden="true" />}
      description={loading ? "Loading reels…" : `${total} reels`}
      bodyClassName="space-y-4"
      actions={
        <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading} aria-label="Refresh reels">
          <RefreshCw className="size-4" /> Refresh
        </Button>
      }
    >
      <div className="flex flex-wrap items-center gap-2">
        <form
          className="relative min-w-[200px] flex-1 sm:max-w-xs"
          onSubmit={(e) => {
            e.preventDefault();
            setPage(1);
            setQuery(search.trim());
          }}
        >
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search caption or author…"
            className="h-8 pl-8 text-sm"
            aria-label="Search reels"
          />
        </form>
        <Select value={status} onValueChange={(v) => { setStatus(v); setPage(1); }}>
          <SelectTrigger className="h-8 w-[150px] text-sm" aria-label="Filter by transcode state">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {STATUS_FILTERS.map((f) => (
              <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-14 w-full" />
          ))}
        </div>
      ) : reels.length === 0 ? (
        <EmptyState icon={<Clapperboard className="size-6" aria-hidden="true" />} title="No reels" hint="Reels published from the app appear here with their transcode state." />
      ) : (
        <ul className="divide-y rounded-xl border">
          {reels.map((r) => (
            <li key={r.id} className="flex items-start gap-3 px-3 py-3 sm:px-4">
              <Avatar className="size-8 shrink-0">
                <AvatarFallback className="text-xs">{(r.author?.name ?? "?").slice(0, 1).toUpperCase()}</AvatarFallback>
              </Avatar>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-sm font-medium">{r.author?.name ?? "Unknown"}</span>
                  {r.transcode ? (
                    <Badge variant="outline" className={`text-[10px] ${TRANSCODE_TONE[r.transcode.status]}`}>
                      {TRANSCODE_LABEL[r.transcode.status]}
                      {r.transcode.status === "failed" && r.transcode.attempts > 0 ? ` · ${r.transcode.attempts} tries` : ""}
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="text-[10px] text-muted-foreground">No video</Badge>
                  )}
                  {r.reportsCount > 0 && (
                    <Badge variant="outline" className="gap-0.5 border-red-500/30 bg-red-500/10 text-[10px] text-red-600 dark:text-red-400">
                      <Flag className="size-3" aria-hidden="true" /> {r.reportsCount}
                    </Badge>
                  )}
                </div>
                <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{r.description ?? "—"}</p>
                {r.transcode?.status === "failed" && r.transcode.error && (
                  <p className="mt-0.5 line-clamp-1 text-[11px] text-red-600 dark:text-red-400" title={r.transcode.error}>
                    {r.transcode.error}
                  </p>
                )}
                <p className="mt-1 text-[11px] text-muted-foreground">
                  {r.viewsCount} views · {r.likesCount} likes · {r.commentsCount} comments · {formatDate(r.createdAt)}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}

      {pages > 1 && (
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>Page {page} of {pages}</span>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1}>Previous</Button>
            <Button variant="outline" size="sm" onClick={() => setPage((p) => Math.min(pages, p + 1))} disabled={page >= pages}>Next</Button>
          </div>
        </div>
      )}
    </SectionCard>
  );
}

/* ───────────────────────────── Causes tab ────────────────────────────── */

function CausesTab({ onChanged }: { onChanged: () => void }) {
  const [causes, setCauses] = useState<AdminCause[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await get<Paged<AdminCause>>("/api/community/admin/causes?limit=100");
      setCauses(res.items ?? []);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load causes");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const moderate = async (cause: AdminCause, action: string) => {
    setBusy(cause.id);
    try {
      await post("/api/community/admin/posts/moderate", { postId: cause.id, action });
      toast.success(action === "verify" ? "Cause verified" : "Verification removed");
      await load();
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Action failed");
    } finally {
      setBusy(null);
    }
  };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return causes;
    return causes.filter(
      (c) => `${c.desc ?? ""}`.toLowerCase().includes(q) || `${c.author?.name ?? ""}`.toLowerCase().includes(q)
    );
  }, [causes, search]);

  const totals = useMemo(() => {
    const goal = causes.reduce((s, c) => s + (c.goalAmount ?? 0), 0);
    const raised = causes.reduce((s, c) => s + (c.raisedAmount ?? 0), 0);
    return { goal, raised };
  }, [causes]);

  return (
    <SectionCard
      title="Community causes"
      icon={<HandHeart className="size-4" aria-hidden="true" />}
      description={
        loading
          ? "Loading causes…"
          : `${filtered.length} of ${causes.length} causes · ${formatINRCompact(totals.raised)} raised of ${formatINRCompact(totals.goal)}`
      }
      bodyClassName="space-y-4"
    >
      <div className="relative min-w-[200px] max-w-sm">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search cause or creator…"
          className="h-8 pl-8 text-sm"
          aria-label="Search causes"
        />
      </div>

      {loading ? (
        <div className="space-y-2" aria-busy="true">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState icon={<HandHeart className="size-6" aria-hidden="true" />} title="No causes yet" hint="Fundraising causes created in the mobile app appear here." />
      ) : (
        <ul className="space-y-2">
          {filtered.map((c) => {
            const pct = Math.round(c.progressPercentage ?? 0);
            return (
              <li key={c.id} className="rounded-xl border bg-muted/20 px-3 py-3 sm:px-4">
                <div className="flex flex-wrap items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="truncate text-sm font-medium">{c.desc?.slice(0, 80) ?? "Untitled cause"}</span>
                      {c.category && <Badge variant="outline" className="text-[10px]">{c.category.name}</Badge>}
                      {c.isVerified ? (
                        <Badge variant="outline" className="gap-0.5 border-emerald-500/30 bg-emerald-500/10 text-[10px] text-emerald-700 dark:text-emerald-400">
                          <BadgeCheck className="size-3" aria-hidden="true" /> Verified
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="border-amber-500/30 bg-amber-500/10 text-[10px] text-amber-700 dark:text-amber-400">
                          Pending verification
                        </Badge>
                      )}
                    </div>
                    <p className="mt-0.5 text-[11px] text-muted-foreground">
                      by {c.author?.name ?? "Unknown"} · {c.causeFollowerCount} followers · {c.donationCount} donation{c.donationCount === 1 ? "" : "s"}
                      {c.deadline ? ` · ends ${formatDate(c.deadline)}` : ""}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <span className="text-sm font-semibold tabular-nums">
                      {formatINRCompact(c.raisedAmount)}{" "}
                      <span className="text-xs font-normal text-muted-foreground">/ {formatINRCompact(c.goalAmount ?? 0)}</span>
                    </span>
                    <Button
                      variant={c.isVerified ? "outline" : "default"}
                      size="sm"
                      disabled={busy === c.id}
                      onClick={() => void moderate(c, c.isVerified ? "unverify" : "verify")}
                    >
                      <BadgeCheck className="size-4" aria-hidden="true" />
                      {c.isVerified ? "Unverify" : "Verify"}
                    </Button>
                  </div>
                </div>
                <Progress value={pct} className="mt-2 h-2" aria-label={`${pct}% of goal raised`} />
                <p className="mt-1 text-right text-[11px] text-muted-foreground tabular-nums">{pct}%</p>
              </li>
            );
          })}
        </ul>
      )}
    </SectionCard>
  );
}

/* ───────────────────────────── Reports tab ───────────────────────────── */

function ReportsTab({ onChanged }: { onChanged: () => void }) {
  const [reports, setReports] = useState<AdminReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await get<Paged<AdminReport>>("/api/community/admin/reports?limit=100");
      setReports(res.items ?? []);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load reports");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const resolve = async (report: AdminReport, action: string) => {
    setBusy(report.id);
    try {
      await post("/api/community/admin/reports/resolve", { reportId: report.id, action });
      toast.success(action === "dismiss" ? "Report dismissed" : "Reported content removed");
      await load();
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Action failed");
    } finally {
      setBusy(null);
    }
  };

  return (
    <SectionCard
      title="Moderation queue"
      icon={<Flag className="size-4" aria-hidden="true" />}
      description={loading ? "Loading reports…" : `${reports.length} report${reports.length === 1 ? "" : "s"}`}
      bodyClassName="space-y-3"
    >
      {loading ? (
        <div className="space-y-2" aria-busy="true">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </div>
      ) : reports.length === 0 ? (
        <EmptyState icon={<Flag className="size-6" aria-hidden="true" />} title="Queue is clear" hint="Reports filed from the mobile app appear here." />
      ) : (
        reports.map((r) => {
          const target = r.post
            ? `Post: ${r.post.desc?.slice(0, 70) ?? "—"}${r.post.author ? ` — ${r.post.author.name ?? ""}` : ""}`
            : r.comment
              ? `Comment: ${r.comment.desc.slice(0, 70)}`
              : r.reel
                ? `Reel: ${r.reel.description?.slice(0, 70) ?? "—"}`
                : r.room
                  ? `Room: ${r.room.title}`
                  : "Unknown target";
          const hasDeletable = !!r.post || !!r.comment;
          return (
            <div key={r.id} className="flex flex-wrap items-start gap-3 rounded-xl border px-3 py-3 sm:px-4">
              <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-red-500/10 text-red-600 dark:text-red-400">
                <Flag className="size-4" aria-hidden="true" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <Badge variant="destructive" className="text-[10px]">{r.reason}</Badge>
                  <Badge variant="outline" className="text-[10px]">{REPORT_TYPES[r.type ?? -1] ?? "Unknown"}</Badge>
                  <span className="text-[11px] text-muted-foreground">
                    by {r.reporter?.name ?? "Unknown"} · {formatDate(r.createdAt)}
                  </span>
                </div>
                <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{r.desc}</p>
                <p className="mt-1 truncate rounded bg-muted/60 px-2 py-1 text-[11px] text-muted-foreground">{target}</p>
              </div>
              <div className="flex shrink-0 gap-2">
                {hasDeletable && (
                  <Button variant="destructive" size="sm" disabled={busy === r.id} onClick={() => void resolve(r, r.post ? "delete_post" : "delete_comment")}>
                    <Trash2 className="size-4" aria-hidden="true" /> Delete
                  </Button>
                )}
                <Button variant="outline" size="sm" disabled={busy === r.id} onClick={() => void resolve(r, "dismiss")}>
                  <X className="size-4" aria-hidden="true" /> Dismiss
                </Button>
              </div>
            </div>
          );
        })
      )}
    </SectionCard>
  );
}

/* ──────────────────────── Volunteer applications tab ─────────────────── */

function VolunteersTab() {
  const [pending, setPending] = useState<PendingApplication[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const rows = await get<PendingApplication[]>("/api/volunteer-applications?status=PENDING");
        setPending(Array.isArray(rows) ? rows : []);
      } catch {
        setPending([]);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  return (
    <SectionCard
      title="Volunteer applications"
      icon={<BadgeCheck className="size-4" aria-hidden="true" />}
      description="Approval flows live in the Volunteers section — this is a summary."
    >
      {loading ? (
        <div className="space-y-2" aria-busy="true">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </div>
      ) : pending.length === 0 ? (
        <EmptyState icon={<BadgeCheck className="size-6" aria-hidden="true" />} title="No pending applications" hint="New volunteer applications awaiting review appear here." />
      ) : (
        <ul className="space-y-2">
          {pending.slice(0, 8).map((a) => (
            <li key={a.id} className="flex items-center gap-3 rounded-lg border bg-muted/30 px-3 py-2.5">
              <Avatar className="size-8">
                <AvatarFallback className="text-xs">{(a.fullName ?? "?").slice(0, 1).toUpperCase()}</AvatarFallback>
              </Avatar>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{a.fullName}</p>
                <p className="truncate text-[11px] text-muted-foreground">
                  {a.email}
                  {a.city ? ` · ${a.city}` : ""} · applied {formatDate(a.createdAt)}
                </p>
              </div>
              <StatusBadge status="PENDING" className="shrink-0" />
            </li>
          ))}
        </ul>
      )}
      <Button variant="outline" onClick={() => navigate("/admin/volunteers")}>
        <Megaphone className="size-4" aria-hidden="true" /> Manage in Volunteers
      </Button>
    </SectionCard>
  );
}
