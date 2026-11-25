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
  Flag,
  Globe,
  Lock,
  Pencil,
  Plus,
  AlertTriangle,
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
import { DetailSheet } from "@/components/shared/detail-sheet";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
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
import { mfetch, usePagedSearch, SearchInput } from "./community/shared";
import { PaginationBar, PageSizeSelect, useViewPref, ViewSwitcher } from "@/components/shared/view-switcher";
import {
  FormSection,
  SwitchField,
  TextField,
} from "@/components/shared/form-fields";
import { FormSheet } from "@/components/shared/form-sheet";
import { PageHeader } from "@/components/shared/page-header";
import { StatCard } from "@/components/shared/stat-card";

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


export default function MobileRoomsView() {
  const { search, setSearch, query, page, setPage, limit, setLimit, start } = usePagedSearch(20);
  const [rooms, setRooms] = useState<AdminRoom[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);

  const [details, setDetails] = useState<RoomDetails | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [detailsLoading, setDetailsLoading] = useState(false);

  const [toggleBusy, setToggleBusy] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<AdminRoom | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<AdminRoom | null>(null);
  const [form, setForm] = useState({ title: "", desc: "", interest_ids: "", photo: "", is_private: 0, is_join_request_enable: 0 });
  const [view, setView] = useViewPref("mobile-rooms", "table");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ start: String(start), limit: String(limit) });
      if (query) params.set("q", query);
      const res = await mfetch<{ rooms: AdminRoom[]; total_count: number }>(
        `/api/mobile-admin/rooms?${params.toString()}`
      );
      setRooms(res.rooms ?? []);
      setTotal(res.total_count ?? 0);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load rooms");
    } finally {
      setLoading(false);
    }
  }, [start, limit, query]);

  const openCreate = () => {
    setEditTarget(null);
    setForm({ title: "", desc: "", interest_ids: "", photo: "", is_private: 0, is_join_request_enable: 0 });
    setFormOpen(true);
  };

  const openEdit = (room: AdminRoom) => {
    setEditTarget(room);
    setForm({
      title: room.title,
      desc: room.desc ?? "",
      interest_ids: (room as unknown as { interest_ids?: string | null }).interest_ids ?? "",
      photo: "",
      is_private: room.is_private,
      is_join_request_enable: room.is_join_request_enable,
    });
    setFormOpen(true);
  };

  const save = async () => {
    try {
      if (editTarget) {
        await mfetch("/api/mobile-admin/rooms/update", { room_id: editTarget.id, ...form });
        toast.success("Room updated");
      } else {
        await mfetch("/api/mobile-admin/rooms/create", form);
        toast.success("Room created");
      }
      setFormOpen(false);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Save failed");
    }
  };

  useEffect(() => {
    void load();
  }, [load]);

  const openDetails = async (room: AdminRoom) => {
    setDetailsOpen(true);
    setDetailsLoading(true);
    setDetails({ room, admin: room.admin, all_users: [], members: [], co_admins: [] });
    try {
      const res = await mfetch<RoomDetails>(`/api/mobile-admin/rooms/details?id=${encodeURIComponent(room.id)}`);
      setDetails(res);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load room details");
      setDetailsOpen(false);
    } finally {
      setDetailsLoading(false);
    }
  };

  const toggle = async (room: AdminRoom, field: "is_private" | "is_join_request_enable") => {
    const next = field === "is_private" ? (room.is_private === 1 ? 0 : 1) : room.is_join_request_enable === 1 ? 0 : 1;
    setToggleBusy(room.id + field);
    try {
      await mfetch(
        field === "is_private"
          ? "/api/mobile-admin/rooms/private-status"
          : "/api/mobile-admin/rooms/join-request-status",
        { id: room.id, [field]: next },
      );
      toast.success(field === "is_private"
        ? `Room is now ${next === 1 ? "private" : "public"}`
        : `Join requests ${next === 1 ? "enabled" : "disabled"}`);
      setRooms((prev) => prev.map((r) => (r.id === room.id ? { ...r, [field]: next } : r)));
      setDetails((prev) => (prev && prev.room.id === room.id ? { ...prev, room: { ...prev.room, [field]: next } } : prev));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Action failed");
    } finally {
      setToggleBusy(null);
    }
  };

  const deleteRoom = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      // Backend exposes DELETE /community/admin/rooms with a POST alias —
      // mfetch only speaks GET/POST, so the alias is used here.
      await mfetch("/api/mobile-admin/rooms", { room_id: deleteTarget.id });
      toast.success("Room deleted");
      setDeleteTarget(null);
      setDetailsOpen(false);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to delete room");
    } finally {
      setDeleting(false);
    }
  };


  return (
    <div className="space-y-4 sm:space-y-6">
      <PageHeader
        title="Rooms"
        description="Mobile audio rooms — ownership, membership, privacy and moderation."
        icon={<DoorOpen className="size-5" aria-hidden="true" />}
        actions={
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => void load()} aria-label="Refresh rooms">
              <RefreshCw className="size-4" aria-hidden="true" /> Refresh
            </Button>
            <Button onClick={openCreate} aria-label="Create new room">
              <Plus className="size-4" /> New room
            </Button>
          </div>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Total rooms" value={String(total)} icon={<DoorOpen className="size-5" aria-hidden="true" />} accent="emerald" hint="All mobile rooms" loading={loading} />
        <StatCard label="Private rooms" value={String(rooms.filter((r) => r.is_private === 1).length)} icon={<Lock className="size-5" aria-hidden="true" />} accent="amber" hint="Invite-only spaces" loading={loading} />
        <StatCard label="Open reports" value={String(rooms.reduce((a, r) => a + (r.report_count ?? 0), 0))} icon={<AlertTriangle className="size-5" aria-hidden="true" />} accent="pink" hint="Awaiting moderation" loading={loading} />
        <StatCard label="Total members" value={String(rooms.reduce((a, r) => a + (r.member_count ?? 0), 0))} icon={<Users className="size-5" aria-hidden="true" />} accent="cyan" hint="Across all rooms" loading={loading} />
      </div>

      <SectionCard
        title="Room directory"
        icon={<DoorOpen className="size-4" aria-hidden="true" />}
        description={loading ? "Loading rooms…" : `${total} room${total === 1 ? "" : "s"}`}
        bodyClassName="space-y-4"
        actions={<ViewSwitcher value={view} onChange={setView} />}
    >
      <div className="flex flex-wrap items-center gap-2">
        <SearchInput value={search} onChange={setSearch} placeholder="Search room or admin…" label="Search rooms" />
        <Button size="sm" onClick={openCreate}>New room</Button>
        <Button variant="outline" size="sm" onClick={() => void load()} aria-label="Refresh rooms">
          <RefreshCw className="size-4" aria-hidden="true" /> Refresh
        </Button>
      </div>

      {loading ? (
        <div className="space-y-2" aria-busy="true">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-14 w-full" />
          ))}
        </div>
      ) : total === 0 ? (
        <EmptyState
          icon={<DoorOpen className="size-6" aria-hidden="true" />}
          title={rooms.length === 0 ? "No rooms yet" : "No rooms match the search"}
          hint={rooms.length === 0 ? "Rooms created in the mobile app appear here." : "Try clearing the search."}
        />
      ) : view === "grid" ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {rooms.map((r) => (
            <article key={r.id} className="flex flex-col gap-3 rounded-xl border bg-card p-4">
              <div className="flex items-start gap-3">
                {r.photo ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={r.photo} alt="" className="size-10 rounded-lg object-cover" loading="lazy" />
                ) : (
                  <span className="flex size-10 items-center justify-center rounded-xl bg-muted"><DoorOpen className="size-5" aria-hidden="true" /></span>
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{r.title}</p>
                  <p className="truncate text-xs text-muted-foreground">{r.admin?.full_name || r.admin?.username || "—"}</p>
                </div>
              </div>
              <p className="line-clamp-2 text-xs text-muted-foreground">{r.desc}</p>
              <div className="flex flex-wrap gap-1">
                <Badge variant="outline">{r.member_count} members</Badge>
                {r.is_private === 1 && <Badge variant="secondary">Private</Badge>}
                {(r.report_count ?? 0) > 0 && <Badge variant="destructive">{r.report_count} reports</Badge>}
              </div>
              <div className="flex justify-end gap-2">
                <Button size="sm" variant="outline" onClick={() => openDetails(r)}>Details</Button>
                <Button size="sm" variant="destructive" onClick={() => setDeleteTarget(r)}>Delete</Button>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Room</TableHead>
                <TableHead className="hidden md:table-cell">Admin</TableHead>
                <TableHead className="text-right">Members</TableHead>
                <TableHead className="hidden sm:table-cell">Privacy</TableHead>
                <TableHead className="hidden sm:table-cell">Join request</TableHead>
                <TableHead className="hidden text-right lg:table-cell">Reports</TableHead>
                <TableHead className="hidden text-right lg:table-cell">Created</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rooms.map((r) => (
                <TableRow key={r.id}>
                  <TableCell>
                    <div className="flex items-center gap-2.5">
                      <Avatar className="size-9 rounded-lg">
                        {r.photo ? <AvatarFallback className="rounded-lg"><img src={r.photo} alt="" className="size-9 rounded-lg object-cover" /></AvatarFallback> : null}
                        <AvatarFallback className="rounded-lg text-xs">{(r.title ?? "?").slice(0, 1).toUpperCase()}</AvatarFallback>
                      </Avatar>
                      <div className="min-w-0">
                        <p className="max-w-[220px] truncate text-sm font-medium">{r.title}</p>
                        <p className="max-w-[220px] truncate text-[11px] text-muted-foreground">{r.desc ?? "—"}</p>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className="hidden md:table-cell">
                    <div className="flex items-center gap-2">
                      <MemberAvatar user={r.admin} />
                      <div className="min-w-0">
                        <p className="truncate text-sm">{r.admin?.full_name ?? "—"}</p>
                        {r.admin?.username && <p className="truncate text-[11px] text-muted-foreground">@{r.admin.username}</p>}
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className="text-right font-mono text-sm tabular-nums">{r.member_count}</TableCell>
                  <TableCell className="hidden sm:table-cell">
                    {r.is_private === 1 ? (
                      <Badge variant="outline" className="gap-1 border-violet-500/30 bg-violet-500/10 text-[10px] text-violet-700 dark:text-violet-400">
                        <Lock className="size-3" aria-hidden="true" /> Private
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="gap-1 text-[10px] text-muted-foreground">
                        <Globe className="size-3" aria-hidden="true" /> Public
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className="hidden sm:table-cell">
                    {r.is_join_request_enable === 1 ? (
                      <Badge variant="outline" className="gap-1 border-amber-500/30 bg-amber-500/10 text-[10px] text-amber-700 dark:text-amber-400">
                        <UserCheck className="size-3" aria-hidden="true" /> Approval required
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="text-[10px] text-muted-foreground">Open to join</Badge>
                    )}
                  </TableCell>
                  <TableCell className="hidden text-right lg:table-cell">
                    {r.report_count > 0 ? (
                      <Badge variant="outline" className="gap-1 border-red-500/30 bg-red-500/10 text-[10px] text-red-600 dark:text-red-400">
                        <Flag className="size-3" aria-hidden="true" /> {r.report_count}
                      </Badge>
                    ) : (
                      <span className="text-xs text-muted-foreground">0</span>
                    )}
                  </TableCell>
                  <TableCell className="hidden text-xs text-muted-foreground lg:table-cell">{r.created_at ? formatDate(r.created_at) : "—"}</TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1.5">
                      <Button variant="outline" size="sm" onClick={() => void openDetails(r)} aria-label={`View room ${r.title}`}>
                        <Eye className="size-4" aria-hidden="true" /> Details
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-red-600 hover:text-red-600 dark:text-red-400"
                        onClick={() => setDeleteTarget(r)}
                        aria-label={`Delete room ${r.title}`}
                      >
                        <Trash2 className="size-4" aria-hidden="true" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Details sheet — roomDetails.blade.php parity */}
      <DetailSheet
        open={detailsOpen}
        onOpenChange={setDetailsOpen}
        eyebrow="Community room"
        title={details?.room.title ?? "Room"}
        description={details?.room.desc ?? undefined}
        status={
          details ? (
            <span className="flex items-center gap-1.5">
              {details.room.is_private === 1 ? (
                <Badge variant="outline" className="gap-1 border-violet-500/30 bg-violet-500/10 text-[10px] text-violet-700 dark:text-violet-400">
                  <Lock className="size-3" aria-hidden="true" /> Private
                </Badge>
              ) : (
                <Badge variant="outline" className="gap-1 text-[10px] text-muted-foreground">
                  <Globe className="size-3" aria-hidden="true" /> Public
                </Badge>
              )}
              {details.room.report_count > 0 && (
                <Badge variant="outline" className="gap-1 border-red-500/30 bg-red-500/10 text-[10px] text-red-600 dark:text-red-400">
                  <Flag className="size-3" aria-hidden="true" /> {details.room.report_count} report{details.room.report_count === 1 ? "" : "s"}
                </Badge>
              )}
            </span>
          ) : undefined
        }
        footer={
          details && (
            <Button
              variant="destructive"
              disabled={deleting}
              onClick={() => setDeleteTarget(details.room)}
            >
              <Trash2 className="size-4" aria-hidden="true" /> Delete room
            </Button>
          )
        }
      >
        {details && (
          <div className="space-y-6">
            {/* Room info + toggles */}
            <div className="grid gap-3 sm:grid-cols-2">
              {[
                ["Admin", details.admin?.full_name ?? "—"],
                ["Members (live)", String(details.room.member_count)],
                ["Total member counter", String(details.room.total_member)],
                ["Created", details.room.created_at ? formatDate(details.room.created_at) : "—"],
              ].map(([label, value]) => (
                <div key={label} className="rounded-lg border bg-muted/30 px-3 py-2">
                  <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
                  <p className="mt-0.5 truncate text-sm">{value}</p>
                </div>
              ))}
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2.5">
                <div className="min-w-0">
                  <p className="text-sm font-medium">Private room</p>
                  <p className="text-[11px] text-muted-foreground">Hidden from public discovery</p>
                </div>
                <Switch
                  checked={details.room.is_private === 1}
                  disabled={toggleBusy === details.room.id + "is_private"}
                  onCheckedChange={() => void toggle(details.room, "is_private")}
                  aria-label="Toggle private room"
                />
              </div>
              <div className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2.5">
                <div className="min-w-0">
                  <p className="text-sm font-medium">Join requests</p>
                  <p className="text-[11px] text-muted-foreground">Require admin approval to join</p>
                </div>
                <Switch
                  checked={details.room.is_join_request_enable === 1}
                  disabled={toggleBusy === details.room.id + "is_join_request_enable"}
                  onCheckedChange={() => void toggle(details.room, "is_join_request_enable")}
                  aria-label="Toggle join requests"
                />
              </div>
            </div>

            {/* Member tables — allRoomUsersListTableWeb / roomMembersListTableWeb / roomCoAdminTableWeb */}
            {detailsLoading ? (
              <div className="space-y-2" aria-busy="true">
                <Skeleton className="h-8 w-full" />
                <Skeleton className="h-8 w-full" />
                <Skeleton className="h-8 w-full" />
              </div>
            ) : (
              <>
                <MemberTable title="All users" icon={<UserCheck className="size-4" aria-hidden="true" />} members={details.all_users} />
                <MemberTable title="Members" icon={<UserCheck className="size-4" aria-hidden="true" />} members={details.members} />
                <MemberTable title="Co-admins" icon={<BadgeCheck className="size-4" aria-hidden="true" />} members={details.co_admins} emptyHint="No co-admins in this room." />
              </>
            )}
          </div>
        )}
      </DetailSheet>

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
        title="Delete room?"
        recordName={deleteTarget?.title}
        description="This permanently removes the room, its member list, its linked group conversation and every report filed against it. This cannot be undone."
        confirmLabel="Delete room"
        loading={deleting}
        onConfirm={deleteRoom}
      />

        {!loading && total > 0 ? (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <PaginationBar page={page} pages={Math.max(1, Math.ceil(total / limit))} total={total} onPage={setPage} itemLabel="rooms" />
            <PageSizeSelect value={limit} onChange={setLimit} />
          </div>
        ) : null}

      <FormSheet
        open={formOpen}
        onOpenChange={setFormOpen}
        title={editTarget ? "Edit room" : "New room"}
        description={
          editTarget ? "Update the room details and access settings." : "Creates the room under your admin account."
        }
        onSubmit={save}
        submitLabel={editTarget ? "Save changes" : "Create room"}
        dirty={formOpen}
      >
        <FormSection title="Room">
          <TextField
            label="Title"
            value={form.title}
            onChange={(v) => setForm({ ...form, title: v })}
          />
          <TextField
            label="Description"
            value={form.desc}
            onChange={(v) => setForm({ ...form, desc: v })}
          />
          <TextField
            label="Interest IDs (comma separated)"
            value={form.interest_ids}
            onChange={(v) => setForm({ ...form, interest_ids: v })}
            placeholder="1,2"
          />
          {!editTarget && (
            <TextField
              label="Photo URL"
              value={form.photo}
              onChange={(v) => setForm({ ...form, photo: v })}
              placeholder="https://…"
            />
          )}
        </FormSection>
        <FormSection title="Access">
          <SwitchField
            label="Private room"
            checked={form.is_private === 1}
            onChange={(v) => setForm({ ...form, is_private: v ? 1 : 0 })}
          />
          <SwitchField
            label="Require join approval"
            checked={form.is_join_request_enable === 1}
            onChange={(v) => setForm({ ...form, is_join_request_enable: v ? 1 : 0 })}
          />
        </FormSection>
      </FormSheet>
    </SectionCard>
    </div>
  );
}

function MemberTable({
  title,
  icon,
  members,
  emptyHint = "No members yet.",
}: {
  title: string;
  icon: React.ReactNode;
  members: RoomMember[];
  emptyHint?: string;
}) {
  return (
    <div>
      <div className="mb-2 flex items-center gap-2">
        <span className="text-muted-foreground">{icon}</span>
        <h3 className="text-sm font-semibold tracking-tight">
          {title} <span className="font-normal text-muted-foreground">({members.length})</span>
        </h3>
      </div>
      {members.length === 0 ? (
        <p className="rounded-lg border border-dashed px-3 py-2 text-xs text-muted-foreground">{emptyHint}</p>
      ) : (
        <div className="overflow-hidden rounded-xl border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>User</TableHead>
                <TableHead>Role</TableHead>
                <TableHead className="hidden text-right sm:table-cell">Joined</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {members.map((m) => (
                <TableRow key={m.id}>
                  <TableCell>
                    <div className="flex items-center gap-2.5">
                      <MemberAvatar user={m.user} />
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">
                          {m.user?.full_name ?? "—"}
                          {m.user?.is_block === 1 && <Badge variant="destructive" className="ml-1.5 text-[10px]">Blocked</Badge>}
                        </p>
                        <p className="truncate text-[11px] text-muted-foreground">{m.user?.username ? `@${m.user.username}` : m.user?.email ?? ""}</p>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>
                    <MemberTypeBadge label={m.type_label} />
                  </TableCell>
                  <TableCell className="hidden text-xs text-muted-foreground sm:table-cell text-right">
                    {m.created_at ? formatDate(m.created_at) : "—"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}

/* ──────────────────────── Verifications sub-tab ──────────────────────── */

