"use client";

import { useCallback, useEffect, useState } from "react";
import { BadgeCheck, CalendarClock, Check, Mail, MapPin, Phone, Plus, UserCheck, X } from "lucide-react";
import { toast } from "sonner";
import { get, patch, post } from "@/lib/api-client";
import { cn, formatDate, titleCase } from "@/lib/utils";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
  createdAt: string;
}

interface ActiveVolunteer {
  id: string;
  assignedArea?: string | null;
  skills?: string | null;
  status: string;
  user?: { name?: string; email?: string } | null;
  name?: string;
  email?: string;
}

interface Task {
  id: string;
  title: string;
  type: string;
  priority: string;
  location?: string | null;
  scheduledDate: string;
  status: string;
  volunteer?: { user?: { name?: string } | null } | null;
  volunteerName?: string;
}

interface VolunteerOption {
  id: string;
  user?: { name?: string; email?: string } | null;
  name?: string;
}

const TASK_TYPES = ["DISTRIBUTION", "KIT_SCAN", "INVENTORY", "EVENT", "RESCUE", "AMBULANCE"];
const TASK_PRIORITIES = ["LOW", "MEDIUM", "HIGH"];
const TASK_STATUSES = ["ASSIGNED", "IN_PROGRESS", "COMPLETED", "CANCELLED"];

function parseSkills(s?: string | null): string[] {
  if (!s) return [];
  try {
    const parsed = JSON.parse(s);
    if (Array.isArray(parsed)) return parsed.filter((x) => typeof x === "string" && x);
  } catch {
    // plain comma-separated string
  }
  return s.split(",").map((x) => x.trim()).filter(Boolean);
}

function appStatusBadge(status: string): string {
  switch (status) {
    case "PENDING":
      return "bg-amber-100 text-amber-700";
    case "APPROVED":
      return "bg-emerald-100 text-emerald-700";
    case "REJECTED":
      return "bg-red-100 text-red-700";
    default:
      return "bg-zinc-100 text-zinc-600";
  }
}

function priorityBadgeClass(priority: string): string {
  switch (priority) {
    case "HIGH":
      return "bg-red-100 text-red-700";
    case "MEDIUM":
      return "bg-amber-100 text-amber-700";
    default:
      return "bg-zinc-100 text-zinc-600";
  }
}

/* ------------------------------- applications ------------------------------- */

function ApplicationsTab() {
  const [apps, setApps] = useState<Application[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState("PENDING");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rejectTarget, setRejectTarget] = useState<Application | null>(null);
  const [reviewNote, setReviewNote] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const qs = tab === "ALL" ? "" : `status=${tab}`;
      const data = await get<Application[] | { items?: Application[] }>(`/api/volunteer-applications?${qs}`);
      const list = Array.isArray(data) ? data : (data.items ?? []);
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
  }, [tab]);

  useEffect(() => {
    load();
  }, [load]);

  const approve = async (app: Application) => {
    setBusyId(app.id);
    try {
      await patch(`/api/volunteer-applications/${app.id}`, { status: "APPROVED" });
      toast.success("Volunteer approved — portal unlocked");
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to approve application");
    } finally {
      setBusyId(null);
    }
  };

  const reject = async () => {
    if (!rejectTarget) return;
    setBusyId(rejectTarget.id);
    try {
      await patch(`/api/volunteer-applications/${rejectTarget.id}`, {
        status: "REJECTED",
        reviewNote: reviewNote.trim() || undefined,
      });
      toast.success("Application rejected");
      setRejectTarget(null);
      setReviewNote("");
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to reject application");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-4">
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="h-auto w-full flex-wrap justify-start sm:w-auto">
          {["PENDING", "APPROVED", "REJECTED", "ALL"].map((t) => (
            <TabsTrigger key={t} value={t} className="px-3">
              {titleCase(t)}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      {loading ? (
        <div className="grid gap-4 lg:grid-cols-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-52 rounded-xl" />
          ))}
        </div>
      ) : apps.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
            <UserCheck className="size-8" aria-hidden="true" />
            <p className="font-medium text-foreground">No {tab === "ALL" ? "" : tab.toLowerCase()} applications</p>
            <p>New volunteer applications from the public site will appear here.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {apps.map((a) => {
            const skills = parseSkills(a.skills);
            return (
              <Card key={a.id} className="flex flex-col gap-3 p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h3 className="truncate text-sm font-semibold">{a.fullName}</h3>
                    <p className="text-xs text-muted-foreground">{a.occupation ? `${a.occupation} · ` : ""}{a.city}</p>
                  </div>
                  <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold", appStatusBadge(a.status))}>
                    {titleCase(a.status)}
                  </span>
                </div>

                <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1"><Mail className="size-3.5" aria-hidden="true" /> {a.email}</span>
                  <span className="flex items-center gap-1"><Phone className="size-3.5" aria-hidden="true" /> {a.phone}</span>
                  <span className="flex items-center gap-1"><MapPin className="size-3.5" aria-hidden="true" /> {a.city}</span>
                  {a.availability && (
                    <span className="flex items-center gap-1"><CalendarClock className="size-3.5" aria-hidden="true" /> {a.availability}</span>
                  )}
                </div>

                {skills.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {skills.map((s) => (
                      <span key={s} className="rounded-full bg-teal-50 px-2 py-0.5 text-[11px] font-medium text-teal-700">{s}</span>
                    ))}
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

                {a.status === "PENDING" && (
                  <div className="mt-auto flex gap-2 border-t pt-3">
                    <Button size="sm" onClick={() => approve(a)} disabled={busyId === a.id} aria-label={`Approve ${a.fullName}`}>
                      <Check className="size-4" /> Approve
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="text-red-600 hover:bg-red-50 hover:text-red-700"
                      onClick={() => {
                        setRejectTarget(a);
                        setReviewNote("");
                      }}
                      aria-label={`Reject ${a.fullName}`}
                    >
                      <X className="size-4" /> Reject
                    </Button>
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}

      {/* Reject dialog */}
      <Dialog open={!!rejectTarget} onOpenChange={(o) => !o && setRejectTarget(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Reject application</DialogTitle>
            <DialogDescription>{rejectTarget ? `${rejectTarget.fullName} will not receive portal access.` : ""}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <Label htmlFor="va-note">Review note</Label>
            <Textarea
              id="va-note"
              value={reviewNote}
              onChange={(e) => setReviewNote(e.target.value)}
              placeholder="Why is this application rejected? Shared with the applicant."
              rows={3}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejectTarget(null)}>Cancel</Button>
            <Button variant="destructive" onClick={reject} disabled={busyId === rejectTarget?.id}>
              {busyId === rejectTarget?.id ? "Rejecting…" : "Reject application"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/* ------------------------------ active volunteers ---------------------------- */

function ActiveVolunteersTab() {
  const [vols, setVols] = useState<ActiveVolunteer[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    get<ActiveVolunteer[] | { items?: ActiveVolunteer[] }>("/api/volunteers?status=ACTIVE")
      .then((d) => setVols(Array.isArray(d) ? d : (d.items ?? [])))
      .catch((e) => toast.error(e instanceof Error ? e.message : "Failed to load volunteers"))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-36 rounded-xl" />
        ))}
      </div>
    );
  }

  if (vols.length === 0) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
          <BadgeCheck className="size-8" aria-hidden="true" />
          <p className="font-medium text-foreground">No active volunteers</p>
          <p>Approve applications to unlock the volunteer portal.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {vols.map((v) => {
        const name = v.user?.name ?? v.name ?? "Volunteer";
        const email = v.user?.email ?? v.email ?? "";
        const skills = parseSkills(v.skills);
        return (
          <Card key={v.id} className="flex flex-col gap-2.5 p-4">
            <div className="flex items-center gap-2.5">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary" aria-hidden="true">
                {name.charAt(0).toUpperCase()}
              </span>
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold">{name}</p>
                <p className="truncate text-xs text-muted-foreground">{email}</p>
              </div>
            </div>
            {v.assignedArea && (
              <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <MapPin className="size-3.5" aria-hidden="true" /> {v.assignedArea}
              </p>
            )}
            {skills.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {skills.map((s) => (
                  <span key={s} className="rounded-full bg-teal-50 px-2 py-0.5 text-[11px] font-medium text-teal-700">{s}</span>
                ))}
              </div>
            )}
          </Card>
        );
      })}
    </div>
  );
}

/* ----------------------------------- tasks ---------------------------------- */

const emptyTaskForm = {
  title: "",
  type: "DISTRIBUTION",
  priority: "MEDIUM",
  location: "",
  scheduledDate: "",
  volunteerId: "",
};

function TasksTab() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [volunteers, setVolunteers] = useState<VolunteerOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(emptyTaskForm);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [t, v] = await Promise.all([
        get<Task[] | { items?: Task[] }>("/api/volunteer-tasks"),
        get<VolunteerOption[] | { items?: VolunteerOption[] }>("/api/volunteers?status=ACTIVE"),
      ]);
      setTasks(Array.isArray(t) ? t : (t.items ?? []));
      setVolunteers(Array.isArray(v) ? v : (v.items ?? []));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load tasks");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const volName = (v: VolunteerOption) => v.user?.name ?? v.name ?? v.id;

  const assignTask = async () => {
    if (!form.title.trim() || !form.volunteerId || !form.scheduledDate) {
      toast.error("Title, volunteer and scheduled date are required");
      return;
    }
    setSaving(true);
    try {
      await post("/api/volunteer-tasks", {
        title: form.title.trim(),
        type: form.type,
        priority: form.priority,
        location: form.location.trim() || undefined,
        scheduledDate: new Date(form.scheduledDate).toISOString(),
        volunteerId: form.volunteerId,
      });
      toast.success("Task assigned");
      setOpen(false);
      setForm(emptyTaskForm);
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to assign task");
    } finally {
      setSaving(false);
    }
  };

  const setTaskStatus = async (task: Task, status: string) => {
    try {
      await patch(`/api/volunteer-tasks/${task.id}`, { status });
      toast.success(`Task marked ${titleCase(status)}`);
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to update task");
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">{loading ? "Loading tasks…" : `${tasks.length} task${tasks.length === 1 ? "" : "s"}`}</p>
        <Button onClick={() => setOpen(true)} aria-label="Assign new task">
          <Plus className="size-4" /> Assign task
        </Button>
      </div>

      <Card className="py-0">
        <CardContent className="p-0">
          {loading ? (
            <div className="space-y-2 p-4">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-11 w-full" />
              ))}
            </div>
          ) : tasks.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
              <CalendarClock className="size-8" aria-hidden="true" />
              <p className="font-medium text-foreground">No tasks yet</p>
              <p>Assign distribution, kit-scan or rescue tasks to active volunteers.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Task</TableHead>
                    <TableHead>Volunteer</TableHead>
                    <TableHead className="hidden md:table-cell">Type</TableHead>
                    <TableHead>Priority</TableHead>
                    <TableHead className="hidden sm:table-cell">Scheduled</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {tasks.map((t) => (
                    <TableRow key={t.id}>
                      <TableCell>
                        <p className="font-medium">{t.title}</p>
                        {t.location && <p className="text-xs text-muted-foreground">{t.location}</p>}
                      </TableCell>
                      <TableCell className="whitespace-nowrap">{t.volunteer?.user?.name ?? t.volunteerName ?? "—"}</TableCell>
                      <TableCell className="hidden md:table-cell">{titleCase(t.type)}</TableCell>
                      <TableCell>
                        <span className={cn("whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold", priorityBadgeClass(t.priority))}>
                          {titleCase(t.priority)}
                        </span>
                      </TableCell>
                      <TableCell className="hidden whitespace-nowrap text-sm sm:table-cell">{formatDate(t.scheduledDate)}</TableCell>
                      <TableCell>
                        <Select value={t.status} onValueChange={(v) => setTaskStatus(t, v)}>
                          <SelectTrigger className="h-8 w-36 text-xs" aria-label={`Status for task ${t.title}`}>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {TASK_STATUSES.map((s) => (
                              <SelectItem key={s} value={s}>{titleCase(s)}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Assign task dialog */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Assign task</DialogTitle>
            <DialogDescription>Create and assign a task to an active volunteer.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="grid gap-2">
              <Label htmlFor="t-title">Title *</Label>
              <Input id="t-title" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Weekend food distribution — Indiranagar" />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label>Type</Label>
                <Select value={form.type} onValueChange={(v) => setForm({ ...form, type: v })}>
                  <SelectTrigger aria-label="Task type"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {TASK_TYPES.map((t) => (
                      <SelectItem key={t} value={t}>{titleCase(t)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label>Priority</Label>
                <Select value={form.priority} onValueChange={(v) => setForm({ ...form, priority: v })}>
                  <SelectTrigger aria-label="Task priority"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {TASK_PRIORITIES.map((p) => (
                      <SelectItem key={p} value={p}>{titleCase(p)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="t-location">Location</Label>
              <Input id="t-location" value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} placeholder="Meet at community hall, 5th cross" />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor="t-date">Scheduled date *</Label>
                <Input id="t-date" type="date" value={form.scheduledDate} onChange={(e) => setForm({ ...form, scheduledDate: e.target.value })} />
              </div>
              <div className="grid gap-2">
                <Label>Volunteer *</Label>
                <Select value={form.volunteerId || "none"} onValueChange={(v) => setForm({ ...form, volunteerId: v === "none" ? "" : v })}>
                  <SelectTrigger aria-label="Assign to volunteer">
                    <SelectValue placeholder="Select volunteer" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none" disabled>Select volunteer</SelectItem>
                    {volunteers.map((v) => (
                      <SelectItem key={v.id} value={v.id}>{volName(v)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={assignTask} disabled={saving}>{saving ? "Assigning…" : "Assign task"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/* ---------------------------------- view ----------------------------------- */

export default function VolunteersView() {
  return (
    <Tabs defaultValue="applications" className="space-y-4">
      <TabsList>
        <TabsTrigger value="applications">Applications</TabsTrigger>
        <TabsTrigger value="active">Active volunteers</TabsTrigger>
        <TabsTrigger value="tasks">Tasks</TabsTrigger>
      </TabsList>
      <TabsContent value="applications">
        <ApplicationsTab />
      </TabsContent>
      <TabsContent value="active">
        <ActiveVolunteersTab />
      </TabsContent>
      <TabsContent value="tasks">
        <TasksTab />
      </TabsContent>
    </Tabs>
  );
}
