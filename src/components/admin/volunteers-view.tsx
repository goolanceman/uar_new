"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  BadgeCheck,
  CalendarClock,
  Check,
  ClipboardList,
  Eye,
  MapPin,
  Mail,
  Phone,
  Search,
  UserCheck,
  Users,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { get, patch } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { formatDate, formatDateTime, initials, titleCase } from "@/lib/format";
import { PageHeader } from "@/components/shared/page-header";
import { DataField } from "@/components/shared/data-field";
import { EmptyState } from "@/components/shared/empty-state";
import { SectionCard } from "@/components/shared/section-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

/* ------------------------------ types & helpers ----------------------------- */

interface Application {
  id: string;
  userId?: string | null;
  fullName: string;
  email: string;
  phone: string;
  city: string;
  occupation?: string | null;
  skills?: string | null;
  availability?: string | null;
  motivation: string;
  status: string;
  reviewNote?: string | null;
  reviewedAt?: string | null;
  tempCreds?: string | null;
  createdAt: string;
}

interface TempCreds {
  email?: string;
  password?: string;
  fullName?: string;
}

interface VolunteerRow {
  id: string;
  userId: string;
  skills?: string | null;
  availability?: string | null;
  assignedArea?: string | null;
  emergencyContact?: string | null;
  idProof?: string | null;
  status: string;
  joinedAt: string;
  user?: { name?: string; email?: string; phone?: string; city?: string } | null;
}

interface TaskRow {
  id: string;
  volunteerId: string;
  title: string;
  type: string;
  priority: string;
  status: string;
  location?: string | null;
  scheduledDate: string;
}

function parseList(s?: string | null): string[] {
  if (!s) return [];
  try {
    const parsed = JSON.parse(s);
    if (Array.isArray(parsed)) return parsed.filter((x) => typeof x === "string" && x);
  } catch {
    // plain comma-separated string
  }
  return s.split(",").map((x) => x.trim()).filter(Boolean);
}

function parseTempCreds(s?: string | null): TempCreds | null {
  if (!s) return null;
  try {
    const parsed = JSON.parse(s) as TempCreds;
    if (parsed && (parsed.email || parsed.password)) return parsed;
  } catch {
    // not JSON
  }
  return null;
}

function appStatusTone(status: string): string {
  switch (status) {
    case "APPROVED":
    case "ACTIVE":
      return "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400";
    case "PENDING":
      return "bg-amber-500/10 text-amber-700 dark:text-amber-400";
    case "REJECTED":
    case "SUSPENDED":
      return "bg-red-500/10 text-red-700 dark:text-red-400";
    default:
      return "bg-muted text-muted-foreground";
  }
}

function priorityTone(priority: string): string {
  switch (priority) {
    case "HIGH":
      return "bg-red-500/10 text-red-700 dark:text-red-400";
    case "MEDIUM":
      return "bg-amber-500/10 text-amber-700 dark:text-amber-400";
    default:
      return "bg-muted text-muted-foreground";
  }
}

function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-full bg-teal-500/10 px-2 py-0.5 text-[11px] font-medium text-teal-700 dark:text-teal-400">
      {children}
    </span>
  );
}

/* ------------------------------ applications tab ---------------------------- */

function ApplicationsTab() {
  const [apps, setApps] = useState<Application[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("PENDING");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [viewTarget, setViewTarget] = useState<Application | null>(null);
  const [approveTarget, setApproveTarget] = useState<Application | null>(null);
  const [rejectTarget, setRejectTarget] = useState<Application | null>(null);
  const [reviewNote, setReviewNote] = useState("");
  const [approvedCreds, setApprovedCreds] = useState<TempCreds | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const qs = filter === "ALL" ? "" : `status=${filter}`;
      const data = await get<Application[] | { items?: Application[] }>(`/api/volunteer-applications?${qs}`);
      const list = (Array.isArray(data) ? data : (data.items ?? [])).slice();
      list.sort((a, b) => {
        const rank = (s: string) => (s === "PENDING" ? 0 : 1);
        if (rank(a.status) !== rank(b.status)) return rank(a.status) - rank(b.status);
        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      });
      setApps(list);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load applications");
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    load();
  }, [load]);

  const approve = async () => {
    if (!approveTarget?.id) return;
    setBusyId(approveTarget.id);
    try {
      const res = await patch<{ application?: Application }>(
        `/api/volunteer-applications/${approveTarget.id}`,
        { status: "APPROVED", reviewNote: reviewNote.trim() || undefined }
      );
      toast.success("Volunteer approved — portal unlocked");
      const creds = parseTempCreds(res?.application?.tempCreds ?? approveTarget.tempCreds);
      setApprovedCreds(creds);
      setApproveTarget(null);
      setReviewNote("");
      setViewTarget(null);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to approve application");
    } finally {
      setBusyId(null);
    }
  };

  const reject = async () => {
    if (!rejectTarget?.id) return;
    setBusyId(rejectTarget.id);
    try {
      await patch(`/api/volunteer-applications/${rejectTarget.id}`, {
        status: "REJECTED",
        reviewNote: reviewNote.trim() || undefined,
      });
      toast.success("Application rejected");
      setRejectTarget(null);
      setReviewNote("");
      setViewTarget(null);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to reject application");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-4">
      {/* status filter */}
      <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Filter applications by status">
        {["PENDING", "APPROVED", "REJECTED", "ALL"].map((t) => (
          <button
            key={t}
            onClick={() => setFilter(t)}
            aria-pressed={filter === t}
            className={cn(
              "min-h-9 rounded-full border px-3 text-xs font-semibold transition",
              filter === t
                ? "border-primary bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-accent"
            )}
          >
            {titleCase(t)}
          </button>
        ))}
        <span className="ml-auto text-xs text-muted-foreground" aria-live="polite">
          {loading ? "Loading…" : `${apps.length} application${apps.length === 1 ? "" : "s"}`}
        </span>
      </div>

      {loading ? (
        <div className="grid gap-4 lg:grid-cols-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-52 rounded-xl" />
          ))}
        </div>
      ) : apps.length === 0 ? (
        <EmptyState
          icon={<UserCheck className="size-6" aria-hidden="true" />}
          title={`No ${filter === "ALL" ? "" : filter.toLowerCase()} applications`}
          hint="New volunteer applications from the public site will appear here for review."
        />
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {apps.map((a) => {
            const skills = parseList(a.skills);
            return (
              <article key={a.id} className="flex flex-col gap-3 rounded-xl border bg-card p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex min-w-0 items-start gap-2.5">
                    <Avatar className="size-9">
                      <AvatarFallback className="bg-primary/10 text-xs font-semibold text-primary">
                        {initials(a.fullName)}
                      </AvatarFallback>
                    </Avatar>
                    <div className="min-w-0">
                      <h3 className="truncate text-sm font-semibold">{a.fullName}</h3>
                      <p className="truncate text-xs text-muted-foreground">
                        {a.occupation ? `${a.occupation} · ` : ""}{a.city}
                      </p>
                    </div>
                  </div>
                  <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold", appStatusTone(a.status))}>
                    {titleCase(a.status)}
                  </span>
                </div>

                <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                  <span className="flex min-w-0 items-center gap-1"><Mail className="size-3.5 shrink-0" aria-hidden="true" /> <span className="truncate">{a.email}</span></span>
                  <span className="flex items-center gap-1"><Phone className="size-3.5 shrink-0" aria-hidden="true" /> {a.phone}</span>
                  {a.availability && (
                    <span className="flex items-center gap-1"><CalendarClock className="size-3.5 shrink-0" aria-hidden="true" /> {a.availability}</span>
                  )}
                </div>

                {skills.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {skills.map((s) => <Chip key={s}>{s}</Chip>)}
                  </div>
                )}

                <blockquote className="border-l-2 border-primary/40 pl-3 text-xs italic text-muted-foreground">
                  “{a.motivation}”
                </blockquote>

                {a.reviewNote && (
                  <p className="rounded-md bg-muted px-2.5 py-1.5 text-xs text-muted-foreground">
                    <span className="font-semibold text-foreground">Review note:</span> {a.reviewNote}
                  </p>
                )}

                <div className="mt-auto flex flex-wrap items-center gap-2 border-t pt-3">
                  <Button size="sm" variant="ghost" onClick={() => setViewTarget(a)} aria-label={`View application from ${a.fullName}`}>
                    <Eye className="size-4" /> View
                  </Button>
                  {a.status === "PENDING" && (
                    <>
                      <Button size="sm" onClick={() => { setApproveTarget(a); setReviewNote(""); }} disabled={busyId === a.id} aria-label={`Approve ${a.fullName}`}>
                        <Check className="size-4" /> Approve
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="text-red-600 hover:bg-red-500/10 hover:text-red-700"
                        onClick={() => { setRejectTarget(a); setReviewNote(""); }}
                        aria-label={`Reject ${a.fullName}`}
                      >
                        <X className="size-4" /> Reject
                      </Button>
                    </>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      )}

      {/* Application detail sheet */}
      <Sheet open={!!viewTarget} onOpenChange={(o) => !o && setViewTarget(null)}>
        <SheetContent className="flex w-full flex-col gap-0 overflow-y-auto sm:max-w-lg">
          <SheetHeader className="text-left">
            <SheetTitle className="flex items-center gap-2">
              <UserCheck className="size-4 text-primary" aria-hidden="true" />
              {viewTarget?.fullName ?? "Application"}
            </SheetTitle>
            <SheetDescription>
              {viewTarget ? `${titleCase(viewTarget.status)} · applied ${formatDateTime(viewTarget.createdAt)}` : ""}
            </SheetDescription>
          </SheetHeader>
          {viewTarget && (
            <div className="flex-1 space-y-4 px-4 pb-6">
              <SectionCard title="Applicant" icon={<UserCheck className="size-4" aria-hidden="true" />}>
                <div className="grid grid-cols-2 gap-x-4 gap-y-4">
                  <DataField label="Full name" value={viewTarget.fullName} />
                  <DataField label="Email" value={viewTarget.email} copy />
                  <DataField label="Phone" value={viewTarget.phone} copy />
                  <DataField label="City" value={viewTarget.city} />
                  <DataField label="Occupation" value={viewTarget.occupation} />
                  <DataField label="Linked user ID" value={viewTarget.userId} mono />
                  <DataField label="Availability" value={viewTarget.availability} />
                  <DataField label="Reviewed at" value={viewTarget.reviewedAt ? formatDateTime(viewTarget.reviewedAt) : "Not reviewed"} />
                </div>
                <div className="mt-4 space-y-2">
                  <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Skills</p>
                  <div className="flex flex-wrap gap-1.5">
                    {parseList(viewTarget.skills).length > 0
                      ? parseList(viewTarget.skills).map((s) => <Chip key={s}>{s}</Chip>)
                      : <span className="text-sm text-muted-foreground">—</span>}
                  </div>
                </div>
                <p className="mt-4 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Motivation</p>
                <blockquote className="mt-1 rounded-md border-l-2 border-primary/40 bg-muted/40 px-3 py-2 text-xs italic text-muted-foreground">
                  “{viewTarget.motivation}”
                </blockquote>
                {viewTarget.reviewNote && (
                  <p className="mt-4 rounded-md bg-muted px-2.5 py-1.5 text-xs text-muted-foreground">
                    <span className="font-semibold text-foreground">Review note:</span> {viewTarget.reviewNote}
                  </p>
                )}
              </SectionCard>
              {viewTarget.status === "PENDING" && (
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" onClick={() => { setApproveTarget(viewTarget); setReviewNote(""); }} aria-label={`Approve ${viewTarget.fullName}`}>
                    <Check className="size-4" /> Approve
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="text-red-600 hover:bg-red-500/10 hover:text-red-700"
                    onClick={() => { setRejectTarget(viewTarget); setReviewNote(""); }}
                    aria-label={`Reject ${viewTarget.fullName}`}
                  >
                    <X className="size-4" /> Reject
                  </Button>
                </div>
              )}
            </div>
          )}
        </SheetContent>
      </Sheet>

      {/* Approve confirm */}
      <AlertDialog open={!!approveTarget} onOpenChange={(o) => !o && setApproveTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Approve volunteer?</AlertDialogTitle>
            <AlertDialogDescription>
              {approveTarget
                ? `${approveTarget.fullName} will get portal access as a VOLUNTEER${parseTempCreds(approveTarget.tempCreds) ? " and their temporary credentials will be shown after approval" : ""}.`
                : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="grid gap-2">
            <Label htmlFor="app-note-a">Review note (optional)</Label>
            <Textarea
              id="app-note-a"
              value={reviewNote}
              onChange={(e) => setReviewNote(e.target.value)}
              placeholder="Visible to the applicant in their portal"
              rows={2}
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                approve();
              }}
            >
              {busyId === approveTarget?.id ? "Approving…" : "Approve"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Reject confirm */}
      <AlertDialog open={!!rejectTarget} onOpenChange={(o) => !o && setRejectTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reject application?</AlertDialogTitle>
            <AlertDialogDescription>
              {rejectTarget ? `${rejectTarget.fullName} will not receive portal access.` : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="grid gap-2">
            <Label htmlFor="app-note-r">Review note (optional)</Label>
            <Textarea
              id="app-note-r"
              value={reviewNote}
              onChange={(e) => setReviewNote(e.target.value)}
              placeholder="Why is this application rejected? Shared with the applicant."
              rows={2}
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={(e) => {
                e.preventDefault();
                reject();
              }}
            >
              {busyId === rejectTarget?.id ? "Rejecting…" : "Reject application"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Temp credentials dialog */}
      <Dialog open={!!approvedCreds} onOpenChange={(o) => !o && setApprovedCreds(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <BadgeCheck className="size-4 text-primary" aria-hidden="true" /> Volunteer approved
            </DialogTitle>
            <DialogDescription>
              Share these temporary credentials with {approvedCreds?.fullName ?? "the volunteer"} — they should change the password after first sign-in.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="grid gap-2 rounded-lg border p-3">
              <DataField label="Login email" value={approvedCreds?.email ?? "—"} mono copy />
              <DataField label="Temporary password" value={approvedCreds?.password ?? "—"} mono copy />
            </div>
            <p className="text-xs text-muted-foreground">
              Credentials are shown once from the application record — copy them now.
            </p>
          </div>
          <DialogFooter>
            <Button onClick={() => setApprovedCreds(null)}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/* ------------------------------- volunteers tab ----------------------------- */

function VolunteersTab() {
  const [vols, setVols] = useState<VolunteerRow[]>([]);
  const [tasks, setTasks] = useState<TaskRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [viewTarget, setViewTarget] = useState<VolunteerRow | null>(null);
  const [viewTasks, setViewTasks] = useState<TaskRow[] | null>(null);
  const [attendanceCount, setAttendanceCount] = useState<number | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [v, t] = await Promise.all([
        get<VolunteerRow[] | { items?: VolunteerRow[] }>("/api/volunteers"),
        get<TaskRow[] | { items?: TaskRow[] }>("/api/volunteer-tasks?limit=500").catch(() => [] as TaskRow[]),
      ]);
      setVols(Array.isArray(v) ? v : (v.items ?? []));
      setTasks(Array.isArray(t) ? t : ((t as { items?: TaskRow[] })?.items ?? []));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load volunteers");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return vols;
    return vols.filter((v) => {
      const hay = `${v.user?.name ?? ""} ${v.user?.email ?? ""} ${v.assignedArea ?? ""}`.toLowerCase();
      return hay.includes(needle);
    });
  }, [vols, q]);

  const openView = (v: VolunteerRow) => {
    setViewTarget(v);
    setViewTasks(tasks.filter((t) => t.volunteerId === v.id));
    setAttendanceCount(null);
    get<unknown>("/api/volunteer-attendances?volunteerId=" + encodeURIComponent(v.id))
      .then((d) => {
        if (Array.isArray(d)) setAttendanceCount(d.length);
        else if (d && typeof d === "object" && Array.isArray((d as { items?: unknown[] }).items)) {
          setAttendanceCount(((d as { items: unknown[] }).items).length);
        } else setAttendanceCount(null);
      })
      .catch(() => setAttendanceCount(null));
  };

  const setVolunteerStatus = async (v: VolunteerRow, next: "ACTIVE" | "SUSPENDED" | "INACTIVE") => {
    setBusyId(v.id);
    try {
      await patch(`/api/volunteers/${v.id}`, { status: next });
      toast.success(`${v.user?.name ?? "Volunteer"} → ${titleCase(next)}`);
    } catch {
      // Volunteers API has no PATCH today — fall back to the linked user account
      const map: Record<string, { status?: string; isActive: boolean }> = {
        ACTIVE: { status: "ACTIVE", isActive: true },
        SUSPENDED: { status: "SUSPENDED", isActive: false },
        INACTIVE: { isActive: false },
      };
      try {
        await patch(`/api/users/${v.userId}`, map[next]);
        toast.success(`${v.user?.name ?? "Volunteer"} account → ${next === "INACTIVE" ? "Inactive" : titleCase(next)}`);
      } catch (e2) {
        toast.error(e2 instanceof Error ? e2.message : "Failed to update volunteer");
        setBusyId(null);
        return;
      }
    }
    setBusyId(null);
    setViewTarget((prev) => (prev && prev.id === v.id ? { ...prev, status: next } : prev));
    await load();
  };

  const volName = (v: VolunteerRow) => v.user?.name ?? "Volunteer";

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, email or area…" className="pl-9" aria-label="Search volunteers" />
        </div>
        <span className="text-xs text-muted-foreground" aria-live="polite">
          {loading ? "Loading…" : `${filtered.length} volunteer${filtered.length === 1 ? "" : "s"}`}
        </span>
      </div>

      {/* Desktop table */}
      <div className="hidden rounded-xl border bg-card md:block">
        {loading ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-11 w-full" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="p-6">
            <EmptyState
              icon={<Users className="size-6" aria-hidden="true" />}
              title="No volunteers found"
              hint="Approve applications in the first tab to onboard volunteers."
            />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Volunteer</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="hidden lg:table-cell">Assigned area</TableHead>
                  <TableHead className="hidden xl:table-cell">Skills</TableHead>
                  <TableHead className="hidden sm:table-cell">Joined</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((v) => (
                  <TableRow key={v.id}>
                    <TableCell>
                      <div className="flex items-center gap-2.5">
                        <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary" aria-hidden="true">
                          {initials(volName(v))}
                        </span>
                        <div className="min-w-0">
                          <p className="truncate font-medium">{volName(v)}</p>
                          <p className="truncate text-xs text-muted-foreground">{v.user?.email ?? "—"}</p>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <span className={cn("whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold", appStatusTone(v.status))}>
                        {titleCase(v.status)}
                      </span>
                    </TableCell>
                    <TableCell className="hidden lg:table-cell">{v.assignedArea || "—"}</TableCell>
                    <TableCell className="hidden max-w-48 xl:table-cell">
                      <div className="flex flex-wrap gap-1">
                        {parseList(v.skills).slice(0, 3).map((s) => <Chip key={s}>{s}</Chip>)}
                        {parseList(v.skills).length > 3 && <span className="text-[11px] text-muted-foreground">+{parseList(v.skills).length - 3}</span>}
                      </div>
                    </TableCell>
                    <TableCell className="hidden whitespace-nowrap text-sm sm:table-cell">{formatDate(v.joinedAt)}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button
                          size="icon"
                          variant="ghost"
                          className="size-11 md:size-9"
                          aria-label={`View volunteer ${volName(v)}`}
                          onClick={() => openView(v)}
                        >
                          <Eye className="size-4" />
                        </Button>
                        {v.status !== "ACTIVE" && (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={busyId === v.id}
                            aria-label={`Activate volunteer ${volName(v)}`}
                            onClick={() => setVolunteerStatus(v, "ACTIVE")}
                          >
                            Activate
                          </Button>
                        )}
                        {v.status === "ACTIVE" && (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={busyId === v.id}
                            aria-label={`Suspend volunteer ${volName(v)}`}
                            onClick={() => setVolunteerStatus(v, "SUSPENDED")}
                          >
                            Suspend
                          </Button>
                        )}
                        {v.status !== "INACTIVE" && (
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={busyId === v.id}
                            aria-label={`Deactivate volunteer ${volName(v)}`}
                            onClick={() => setVolunteerStatus(v, "INACTIVE")}
                          >
                            Deactivate
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>

      {/* Mobile cards */}
      <div className="space-y-3 md:hidden">
        {loading ? (
          Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-28 rounded-xl" />)
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={<Users className="size-6" aria-hidden="true" />}
            title="No volunteers found"
            hint="Approve applications in the first tab to onboard volunteers."
          />
        ) : (
          filtered.map((v) => (
            <article key={v.id} className="space-y-2.5 rounded-xl border bg-card p-4">
              <div className="flex items-start justify-between gap-2">
                <div className="flex min-w-0 items-center gap-2.5">
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary" aria-hidden="true">
                    {initials(volName(v))}
                  </span>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold">{volName(v)}</p>
                    <p className="truncate text-xs text-muted-foreground">{v.user?.email ?? "—"}</p>
                  </div>
                </div>
                <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold", appStatusTone(v.status))}>
                  {titleCase(v.status)}
                </span>
              </div>
              {v.assignedArea && (
                <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <MapPin className="size-3.5" aria-hidden="true" /> {v.assignedArea}
                </p>
              )}
              <div className="flex flex-wrap gap-2 border-t pt-2">
                <Button size="sm" variant="outline" onClick={() => openView(v)} aria-label={`View volunteer ${volName(v)}`}>
                  <Eye className="size-4" /> View
                </Button>
                {v.status === "ACTIVE" ? (
                  <Button size="sm" variant="outline" disabled={busyId === v.id} onClick={() => setVolunteerStatus(v, "SUSPENDED")} aria-label={`Suspend volunteer ${volName(v)}`}>
                    Suspend
                  </Button>
                ) : (
                  <Button size="sm" variant="outline" disabled={busyId === v.id} onClick={() => setVolunteerStatus(v, "ACTIVE")} aria-label={`Activate volunteer ${volName(v)}`}>
                    Activate
                  </Button>
                )}
              </div>
            </article>
          ))
        )}
      </div>

      {/* Volunteer detail sheet */}
      <Sheet open={!!viewTarget} onOpenChange={(o) => !o && setViewTarget(null)}>
        <SheetContent className="flex w-full flex-col gap-0 overflow-y-auto sm:max-w-lg">
          <SheetHeader className="text-left">
            <SheetTitle className="flex items-center gap-2">
              <Users className="size-4 text-primary" aria-hidden="true" />
              {viewTarget ? volName(viewTarget) : "Volunteer"}
            </SheetTitle>
            <SheetDescription>
              {viewTarget ? `${viewTarget.user?.email ?? ""} · ${titleCase(viewTarget.status)}` : ""}
            </SheetDescription>
          </SheetHeader>
          {viewTarget && (
            <div className="flex-1 space-y-4 px-4 pb-6">
              <SectionCard title="Profile" icon={<UserCheck className="size-4" aria-hidden="true" />}>
                <div className="grid grid-cols-2 gap-x-4 gap-y-4">
                  <DataField label="Status" value={<span className={cn("rounded-full px-2 py-0.5 text-[11px] font-semibold", appStatusTone(viewTarget.status))}>{titleCase(viewTarget.status)}</span>} />
                  <DataField label="Volunteer ID" value={viewTarget.id} mono copy />
                  <DataField label="Assigned area" value={viewTarget.assignedArea} />
                  <DataField label="Emergency contact" value={viewTarget.emergencyContact} copy />
                  <DataField label="Phone" value={viewTarget.user?.phone} />
                  <DataField label="City" value={viewTarget.user?.city} />
                  <DataField label="Joined" value={formatDate(viewTarget.joinedAt)} />
                  <DataField label="Attendance records" value={attendanceCount === null ? "—" : String(attendanceCount)} />
                </div>
                <div className="mt-4 grid gap-3">
                  <div>
                    <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Skills</p>
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      {parseList(viewTarget.skills).length > 0
                        ? parseList(viewTarget.skills).map((s) => <Chip key={s}>{s}</Chip>)
                        : <span className="text-sm text-muted-foreground">—</span>}
                    </div>
                  </div>
                  <div>
                    <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Availability</p>
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      {parseList(viewTarget.availability).length > 0
                        ? parseList(viewTarget.availability).map((s) => <Chip key={s}>{titleCase(s)}</Chip>)
                        : <span className="text-sm text-muted-foreground">—</span>}
                    </div>
                  </div>
                </div>
              </SectionCard>

              <SectionCard
                title="Assigned tasks"
                description="All tasks linked to this volunteer"
                icon={<ClipboardList className="size-4" aria-hidden="true" />}
              >
                {viewTasks === null ? (
                  <Skeleton className="h-20 w-full" />
                ) : viewTasks.length === 0 ? (
                  <EmptyState
                    icon={<ClipboardList className="size-6" aria-hidden="true" />}
                    title="No tasks yet"
                    hint="Assign tasks from the admin tasks API — they will appear here."
                  />
                ) : (
                  <ul className="max-h-60 space-y-2 overflow-y-auto scrollbar-thin" aria-label="Volunteer tasks">
                    {viewTasks.map((t) => (
                      <li key={t.id} className="rounded-lg border p-3">
                        <div className="flex items-start justify-between gap-2">
                          <p className="min-w-0 truncate text-sm font-medium">{t.title}</p>
                          <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold", priorityTone(t.priority))}>
                            {titleCase(t.priority)}
                          </span>
                        </div>
                        <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                          <span className="flex items-center gap-1"><CalendarClock className="size-3" aria-hidden="true" /> {formatDateTime(t.scheduledDate)}</span>
                          {t.location && <span className="flex items-center gap-1"><MapPin className="size-3" aria-hidden="true" /> {t.location}</span>}
                          <span>{titleCase(t.type)}</span>
                          <span className="font-semibold">{titleCase(t.status)}</span>
                        </p>
                      </li>
                    ))}
                  </ul>
                )}
              </SectionCard>

              <div className="flex flex-wrap gap-2">
                {viewTarget.status !== "ACTIVE" && (
                  <Button size="sm" disabled={busyId === viewTarget.id} onClick={() => setVolunteerStatus(viewTarget, "ACTIVE")} aria-label="Activate volunteer">
                    <Check className="size-4" /> Activate
                  </Button>
                )}
                {viewTarget.status === "ACTIVE" && (
                  <Button size="sm" variant="outline" disabled={busyId === viewTarget.id} onClick={() => setVolunteerStatus(viewTarget, "SUSPENDED")} aria-label="Suspend volunteer">
                    Suspend
                  </Button>
                )}
                {viewTarget.status !== "INACTIVE" && (
                  <Button size="sm" variant="ghost" disabled={busyId === viewTarget.id} onClick={() => setVolunteerStatus(viewTarget, "INACTIVE")} aria-label="Deactivate volunteer">
                    Deactivate
                  </Button>
                )}
              </div>
            </div>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}

/* ----------------------------------- view ----------------------------------- */

export default function VolunteersView() {
  return (
    <div className="space-y-4 sm:space-y-6">
      <PageHeader
        title="Volunteers"
        description="Review applications, manage the active roster and track engagement."
        icon={<BadgeCheck className="size-5" aria-hidden="true" />}
      />
      <Tabs defaultValue="applications" className="space-y-4">
        <TabsList>
          <TabsTrigger value="applications">Applications</TabsTrigger>
          <TabsTrigger value="volunteers">Volunteers</TabsTrigger>
        </TabsList>
        <TabsContent value="applications">
          <ApplicationsTab />
        </TabsContent>
        <TabsContent value="volunteers">
          <VolunteersTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
