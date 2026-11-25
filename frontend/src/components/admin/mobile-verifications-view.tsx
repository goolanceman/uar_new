"use client";

/**
 * Community admin — Rooms & verifications tab (PHP admin panel parity).
 * Ports the legacy admin pages rooms.blade.php / roomDetails.blade.php /
 * verificationRequests.blade.php onto the backend admin-rooms endpoints:
 *
 *  - Rooms     — roomsListWeb table (photo, title, admin, members, private +
 *                join-request badges, report count); details sheet with the
 *                legacy member tables (all users / members / co-admins),
 *                updatePrivateStatus + updateJoinRequestStatus toggles and
 *                deleteThisRoom; user-rooms lookup (userRoomsOwnTable /
 *                userRoomInTable) per room admin.
 *  - Verifications — profileVerificationList queue: selfie/document links
 *                (open in a new tab), document type, claimed full name and
 *                the user's verification status, with approve / reject
 *                (approvedProfileVerification / rejectProfileVerification).
 *
 * Consumes the backend via the shared mfetch helper in ./shared.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  BadgeCheck,
  Camera,
  DoorOpen,
  ExternalLink,
  Eye,
  FileText,
  AlertTriangle,
  Flag,
  Globe,
  Lock,
  Users,
  RefreshCw,
  Search,
  ShieldX,
  Trash2,
  UserCheck,
} from "lucide-react";
import { toast } from "sonner";
import { formatDate } from "@/lib/format";
import { SectionCard } from "@/components/shared/section-card";
import { EmptyState } from "@/components/shared/empty-state";
import { DetailGrid, DetailSection, DetailSheet } from "@/components/shared/detail-sheet";
import { DataField } from "@/components/shared/data-field";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { PageHeader } from "@/components/shared/page-header";
import { StatCard } from "@/components/shared/stat-card";
import { mfetch, usePagedSearch, SearchInput } from "./community/shared";
import { PaginationBar, PageSizeSelect, useViewPref, ViewSwitcher } from "@/components/shared/view-switcher";

/* ─────────────────────────────── types ───────────────────────────────── */

/** Legacy wire shape (see legacyUser in backend compat.ts). */
interface LegacyUser {
  id: string;
  full_name: string | null;
  username: string | null;
  email: string | null;
  profile: string | null;
  is_verified: number;
  is_block: number;
}

interface AdminRoom {
  id: string;
  title: string;
  desc: string | null;
  photo: string | null;
  is_private: number;
  is_join_request_enable: number;
  total_member: number;
  member_count: number;
  report_count: number;
  created_at: string | null;
  admin: LegacyUser | null;
}

interface RoomMember {
  id: string;
  user_id: string;
  type: number;
  type_label: string;
  created_at: string | null;
  user: LegacyUser;
}

interface RoomDetails {
  room: AdminRoom;
  admin: LegacyUser | null;
  all_users: RoomMember[];
  members: RoomMember[];
  co_admins: RoomMember[];
}

interface VerifiedMember {
  id: string;
  name: string;
  username: string | null;
  email: string;
  avatar: string | null;
  is_verified: number;
  current_tier: string;
  total_points: number;
  member_since: string | null;
  created_at: string;
}

interface Verification {
  id: string;
  user_id: string;
  selfie: string;
  document: string;
  document_type: string;
  full_name: string;
  status: number; // the user's is_verified: 0 not | 1 pending | 2 verified
  created_at: string | null;
  user: LegacyUser | null;
}

const VERIFICATION_STATUS: Record<number, { label: string; className: string }> = {
  0: { label: "Not verified", className: "border-muted-foreground/30 bg-muted/40 text-muted-foreground" },
  1: { label: "Pending", className: "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400" },
  2: { label: "Verified", className: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400" },
};

function MemberTypeBadge({ label }: { label: string }) {
  const cls =
    label === "Admin"
      ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
      : label === "Co-Admin"
        ? "border-cyan-500/30 bg-cyan-500/10 text-cyan-700 dark:text-cyan-400"
        : "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400";
  return <Badge variant="outline" className={`text-[10px] ${cls}`}>{label}</Badge>;
}

function memberInitial(u: LegacyUser | null): string {
  return (u?.full_name ?? u?.username ?? "?").slice(0, 1).toUpperCase();
}

function MemberAvatar({ user }: { user: LegacyUser | null }) {
  return (
    <Avatar className="size-8">
      {user?.profile ? <AvatarFallback><img src={user.profile} alt="" className="size-8 rounded-full object-cover" /></AvatarFallback> : null}
      <AvatarFallback className="text-xs">{memberInitial(user)}</AvatarFallback>
    </Avatar>
  );
}

/* ─────────────────────────────── view ────────────────────────────────── */


export default function MobileVerificationsView() {
  const { search, setSearch, query, page, setPage, limit, setLimit, start } = usePagedSearch(20);
  const [view, setView] = useViewPref("mobile-verifications", "table");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [rows, setRows] = useState<Verification[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [approveTarget, setApproveTarget] = useState<Verification | null>(null);
  const [reviewTarget, setReviewTarget] = useState<Verification | null>(null);
  const [memberTab, setMemberTab] = useState<"requests" | "verified">("requests");
  const [members, setMembers] = useState<VerifiedMember[]>([]);
  const [membersTotal, setMembersTotal] = useState(0);
  const [membersLoading, setMembersLoading] = useState(false);
  const [rejectTarget, setRejectTarget] = useState<Verification | null>(null);
  const [acting, setActing] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await mfetch<{ verifications: Verification[]; total_count: number }>(
        (() => {
          const params = new URLSearchParams({ start: String(start), limit: String(limit) });
          if (query) params.set("q", query);
          if (statusFilter !== "ALL") params.set("status", statusFilter.toLowerCase());
          return `/api/mobile-admin/verifications?${params.toString()}`;
        })(),
      );
      setRows(res.verifications ?? []);
      setTotal(res.total_count ?? 0);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load verification requests");
    } finally {
      setLoading(false);
    }
  }, []);

  const loadMembers = useCallback(async () => {
    setMembersLoading(true);
    try {
      const params = new URLSearchParams({ start: String(start), limit: String(limit) });
      if (query) params.set("q", query);
      const res = await mfetch<{ members: VerifiedMember[]; total_count: number }>(
        `/api/mobile-admin/verifications/members?${params.toString()}`
      );
      setMembers(res.members ?? []);
      setMembersTotal(res.total_count ?? 0);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load verified members");
    } finally {
      setMembersLoading(false);
    }
  }, [start, limit, query]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (memberTab === "verified") void loadMembers();
  }, [memberTab, loadMembers]);

  const revokeVerification = async (m: VerifiedMember) => {
    try {
      const token = typeof window !== "undefined" ? localStorage.getItem("uar_token") : null;
      await fetch(`/api/users/${m.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ isVerified: 0 }),
      });
      toast.success("Verification revoked");
      await loadMembers();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Revoke failed");
    }
  };

  const resolve = async (v: Verification, action: "approve" | "reject") => {
    setBusy(v.id + action);
    try {
      await mfetch(`/api/mobile-admin/verifications/${action}`, { user_id: v.user_id });
      toast.success(action === "approve" ? "Profile verified" : "Verification rejected");
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Action failed");
    } finally {
      setBusy(null);
    }
  };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (v) =>
        `${v.full_name ?? ""}`.toLowerCase().includes(q) ||
        `${v.user?.full_name ?? ""}`.toLowerCase().includes(q) ||
        `${v.user?.username ?? ""}`.toLowerCase().includes(q) ||
        `${v.document_type ?? ""}`.toLowerCase().includes(q),
    );
  }, [start, limit, query, statusFilter]);

  return (
    <div className="space-y-4 sm:space-y-6">
      <PageHeader
        title="Verifications"
        description="Identity verification requests submitted from the mobile app."
        icon={<BadgeCheck className="size-5" aria-hidden="true" />}
        actions={
          <Button variant="outline" onClick={() => void load()} aria-label="Refresh">
            <RefreshCw className="size-4" aria-hidden="true" /> Refresh
          </Button>
        }
      />

      <Tabs value={memberTab} onValueChange={(v) => setMemberTab(v as "requests" | "verified")}>
        <TabsList>
          <TabsTrigger value="requests">Requests</TabsTrigger>
          <TabsTrigger value="verified">Verified members</TabsTrigger>
        </TabsList>
      </Tabs>

      {memberTab === "verified" ? (
        <SectionCard
          title="Verified members"
          icon={<Users className="size-4" aria-hidden="true" />}
          description={membersLoading ? "Loading…" : `${membersTotal} verified member${membersTotal === 1 ? "" : "s"}`}
          bodyClassName="space-y-4"
        >
          {membersLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
            </div>
          ) : members.length === 0 ? (
            <EmptyState title="No verified members" hint="Approve a verification request to add members here." />
          ) : (
            <ul className="divide-y rounded-xl border bg-card">
              {members.map((m) => (
                <li key={m.id} className="flex items-center gap-3 px-3 py-2.5">
                  {m.avatar ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={m.avatar} alt="" className="size-9 rounded-full object-cover" loading="lazy" />
                  ) : (
                    <span className="flex size-9 items-center justify-center rounded-full bg-muted"><Users className="size-4" aria-hidden="true" /></span>
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{m.name}</p>
                    <p className="truncate text-xs text-muted-foreground">@{m.username ?? "—"} · {m.email}</p>
                  </div>
                  <Badge variant="default" className="shrink-0">{m.current_tier}</Badge>
                  <span className="hidden text-xs text-muted-foreground sm:block">{m.total_points} pts</span>
                  <Button size="sm" variant="outline" onClick={() => void revokeVerification(m)}>
                    Revoke
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>
      ) : (
      <>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          <StatCard label="Total requests" value={String(total)} icon={<BadgeCheck className="size-5" aria-hidden="true" />} accent="emerald" hint="All submissions" loading={loading} />
        <StatCard label="Pending review" value={String(rows.filter((v) => (v.user as unknown as { is_verified?: number })?.is_verified === 1).length)} icon={<AlertTriangle className="size-5" aria-hidden="true" />} accent="amber" hint="Awaiting action" loading={loading} />
        <StatCard label="Verified members" value={String(rows.filter((v) => (v.user as unknown as { is_verified?: number })?.is_verified === 2).length)} icon={<Users className="size-5" aria-hidden="true" />} accent="cyan" hint="Approved via request" loading={loading} />
      </div>

      <SectionCard
        title="Verification queue"
        icon={<BadgeCheck className="size-4" aria-hidden="true" />}
        description={loading ? "Loading requests…" : `${total} requests`}
        bodyClassName="space-y-4"
      >
      <div className="flex flex-wrap items-center gap-2">
        <SearchInput
          value={search}
          onChange={setSearch}
          placeholder="Search name, username or document type…"
          label="Search verification requests"
        />
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="h-9 rounded-md border bg-background px-3 text-sm"
          aria-label="Filter by status"
        >
          <option value="ALL">All statuses</option>
          <option value="not_verified">Not verified</option>
          <option value="pending">Pending</option>
          <option value="verified">Verified</option>
        </select>
        <Button variant="outline" size="sm" onClick={() => void load()} aria-label="Refresh verification requests">
          <RefreshCw className="size-4" aria-hidden="true" /> Refresh
        </Button>
      </div>

      {loading ? (
        <div className="space-y-2" aria-busy="true">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-20 w-full" />
          ))}
        </div>
      ) : total === 0 ? (
        <EmptyState
          icon={<BadgeCheck className="size-6" aria-hidden="true" />}
          title={total === 0 ? "Queue is clear" : "No requests match the search"}
          hint={total === 0 ? "Verification requests filed from the mobile app appear here." : "Try clearing the search."}
        />
      ) : view === "grid" ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {rows.map((v) => (
            <article key={v.id} className="flex flex-col gap-3 rounded-xl border bg-card p-4">
              <div className="flex items-center gap-3">
                {v.selfie ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={v.selfie} alt="" className="size-10 rounded-full object-cover" loading="lazy" />
                ) : (
                  <span className="flex size-10 items-center justify-center rounded-full bg-muted"><BadgeCheck className="size-5" aria-hidden="true" /></span>
                )}
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{v.full_name || v.user?.full_name || "—"}</p>
                  <p className="truncate text-xs text-muted-foreground">{v.document_type}</p>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="outline" onClick={() => setReviewTarget(v)}>Review</Button>
                <Button size="sm" variant="outline" onClick={() => setApproveTarget(v)}>Approve</Button>
                <Button size="sm" variant="destructive" onClick={() => setRejectTarget(v)}>Reject</Button>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <ul className="space-y-2">
          {rows.map((v) => {
            const status = VERIFICATION_STATUS[v.status] ?? VERIFICATION_STATUS[0];
            return (
              <li key={v.id} className="flex flex-wrap items-start gap-3 rounded-xl border px-3 py-3 sm:px-4">
                <MemberAvatar user={v.user} />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-sm font-medium">{v.user?.full_name ?? v.full_name}</span>
                    {v.user?.username && <span className="text-[11px] text-muted-foreground">@{v.user.username}</span>}
                    <Badge variant="outline" className={`text-[10px] ${status.className}`}>{status.label}</Badge>
                    <Badge variant="outline" className="gap-1 text-[10px]">
                      <FileText className="size-3" aria-hidden="true" /> {v.document_type}
                    </Badge>
                  </div>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    Claimed name: <span className="font-medium text-foreground">{v.full_name || "—"}</span>
                    {v.created_at ? ` · requested ${formatDate(v.created_at)}` : ""}
                  </p>
                  <div className="mt-1.5 flex flex-wrap gap-2">
                    {v.selfie && (
                      <a
                        href={v.selfie}
                        target="_blank"
                        rel="noreferrer"
                        className="flex items-center gap-1.5 rounded-lg border bg-muted/40 px-2 py-1.5 text-[11px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                      >
                        <span className="grid size-7 place-items-center overflow-hidden rounded">
                          <img src={v.selfie} alt="Selfie thumbnail" className="size-7 object-cover" />
                        </span>
                        <Camera className="size-3.5" aria-hidden="true" /> Selfie
                        <ExternalLink className="size-3" aria-hidden="true" />
                      </a>
                    )}
                    {v.document && (
                      <a
                        href={v.document}
                        target="_blank"
                        rel="noreferrer"
                        className="flex items-center gap-1.5 rounded-lg border bg-muted/40 px-2 py-1.5 text-[11px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                      >
                        <span className="grid size-7 place-items-center overflow-hidden rounded">
                          <img src={v.document} alt="Document thumbnail" className="size-7 object-cover" />
                        </span>
                        <FileText className="size-3.5" aria-hidden="true" /> Document
                        <ExternalLink className="size-3" aria-hidden="true" />
                      </a>
                    )}
                  </div>
                </div>
                <div className="flex shrink-0 gap-2">
                  <Button
                    variant="default"
                    size="sm"
                    disabled={busy === v.id + "approve"}
                    onClick={() => setApproveTarget(v)}
                  >
                    <BadgeCheck className="size-4" aria-hidden="true" /> Approve
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="text-red-600 hover:text-red-600 dark:text-red-400"
                    disabled={busy === v.id + "reject"}
                    onClick={() => setRejectTarget(v)}
                  >
                    <ShieldX className="size-4" aria-hidden="true" /> Reject
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {/* Review slide-over */}
      <DetailSheet
        open={!!reviewTarget}
        onOpenChange={(o) => !o && setReviewTarget(null)}
        eyebrow="Mobile verifications"
        title={reviewTarget?.full_name || reviewTarget?.user?.full_name || "Verification request"}
        description={reviewTarget ? `${reviewTarget.document_type} · filed ${formatDate(reviewTarget.created_at)}` : ""}
        status={
          reviewTarget ? (
            <Badge variant={reviewTarget.user?.is_verified === 2 ? "default" : "secondary"}>
              {reviewTarget.user?.is_verified === 2 ? "Verified" : "Pending"}
            </Badge>
          ) : undefined
        }
        actions={
          reviewTarget ? (
            <div className="flex gap-2">
              <Button
                size="sm"
                onClick={() => {
                  const t = reviewTarget;
                  setReviewTarget(null);
                  setApproveTarget(t);
                }}
              >
                Approve
              </Button>
              <Button
                size="sm"
                variant="destructive"
                onClick={() => {
                  const t = reviewTarget;
                  setReviewTarget(null);
                  setRejectTarget(t);
                }}
              >
                Reject
              </Button>
            </div>
          ) : undefined
        }
      >
        {reviewTarget ? (
          <div className="space-y-6">
            <DetailSection title="Submission">
              <DetailGrid>
                <DataField label="Claimed name" value={reviewTarget.full_name || "—"} />
                <DataField label="Member" value={reviewTarget.user?.full_name || reviewTarget.user?.username || "—"} />
                <DataField label="Email" value={reviewTarget.user?.email || "—"} />
                <DataField label="Document type" value={reviewTarget.document_type} />
                <DataField label="Filed" value={formatDate(reviewTarget.created_at)} />
              </DetailGrid>
            </DetailSection>
            <DetailSection title="Documents">
              <div className="grid gap-3 sm:grid-cols-2">
                <a href={reviewTarget.selfie} target="_blank" rel="noreferrer" className="overflow-hidden rounded-lg border">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={reviewTarget.selfie} alt="Selfie" className="h-40 w-full object-cover" loading="lazy" />
                  <span className="block p-2 text-xs text-muted-foreground">Selfie</span>
                </a>
                <a href={reviewTarget.document} target="_blank" rel="noreferrer" className="overflow-hidden rounded-lg border">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={reviewTarget.document} alt="Document" className="h-40 w-full object-cover" loading="lazy" />
                  <span className="block p-2 text-xs text-muted-foreground">Document</span>
                </a>
              </div>
            </DetailSection>
          </div>
        ) : null}
      </DetailSheet>

      <ConfirmDialog
        open={!!approveTarget}
        onOpenChange={(o) => !o && setApproveTarget(null)}
        title="Approve verification?"
        recordName={approveTarget ? `${approveTarget.full_name} (${approveTarget.user?.full_name ?? "unknown user"})` : null}
        description="Marks the profile as verified and removes the request from the queue. This cannot be undone."
        confirmLabel="Approve"
        loading={acting}
        onConfirm={async () => {
          if (approveTarget) {
            setActing(true);
            await resolve(approveTarget, "approve");
            setActing(false);
          }
          setApproveTarget(null);
        }}
      />
      <ConfirmDialog
        open={!!rejectTarget}
        onOpenChange={(o) => !o && setRejectTarget(null)}
        title="Reject verification?"
        recordName={rejectTarget ? `${rejectTarget.full_name} (${rejectTarget.user?.full_name ?? "unknown user"})` : null}
        description="Resets the profile to unverified and removes the request from the queue. The user can submit a new request. This cannot be undone."
        confirmLabel="Reject"
        loading={acting}
        onConfirm={async () => {
          if (rejectTarget) {
            setActing(true);
            await resolve(rejectTarget, "reject");
            setActing(false);
          }
          setRejectTarget(null);
        }}
      />
        {!loading && total > 0 ? (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <PaginationBar page={page} pages={Math.max(1, Math.ceil(total / limit))} total={total} onPage={setPage} itemLabel="requests" />
            <PageSizeSelect value={limit} onChange={setLimit} />
          </div>
        ) : null}

    </SectionCard>
        </>
      )}
    </div>
  );
}
