"use client";

/**
 * Volunteers — round-5: DataTable for applications and the roster (fill
 * height, skeleton rows, built-in pagination), full-screen DetailSheet with
 * profile, skills, availability, area, status, tasks, distributions
 * participated and the linked application, lg FormSheet for edits, polished
 * approvals workflow (review note → ConfirmDialog → copyable temp creds),
 * status chips + clear filters and CSV exports.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  BadgeCheck,
  CalendarClock,
  Check,
  ClipboardList,
  MapPin,
  Pencil,
  Package,
  Plus,
  Search,
  UserCheck,
  Users,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { get, patch, post } from "@/lib/api-client";
import { useMasters } from "@/hooks/use-masters";
import { formatDate, formatDateTime, formatINR, initials, titleCase } from "@/lib/format";
import { required } from "@/lib/validators";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/shared/page-header";
import { DataField } from "@/components/shared/data-field";
import { EmptyState } from "@/components/shared/empty-state";
import { FormSheet } from "@/components/shared/form-sheet";
import {
  DetailGrid,
  DetailSection,
  DetailSheet,
} from "@/components/shared/detail-sheet";
import {
  FieldGrid,
  FormSection,
  SelectField,
  TextField,
  TextareaField,
} from "@/components/shared/form-fields";
import { StatusBadge } from "@/components/shared/status-badge";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { ExportMenu, type CsvColumn } from "@/components/shared/csv";
import {
  DataTable,
  type DataTableColumn,
} from "@/components/shared/data-table";
import {
  PaginationBar,
  ViewSwitcher,
  useViewPref,
  type DataViewMode,
} from "@/components/shared/view-switcher";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/* ---------------------------------- types ---------------------------------- */

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
  user?: {
    name?: string;
    email?: string;
    phone?: string;
    city?: string;
    status?: string;
  } | null;
}

interface TaskRow {
  id: string;
  volunteerId: string;
  title: string;
  description?: string | null;
  type: string;
  priority: string;
  status: string;
  location?: string | null;
  scheduledDate: string;
}

interface AttendanceRow {
  id: string;
  date: string;
  checkIn?: string | null;
  checkOut?: string | null;
  hours?: number | null;
  location?: string | null;
  notes?: string | null;
}

interface DistributionRow {
  id: string;
  type: string;
  quantity: number;
  value?: number | null;
  location?: string | null;
  distributedAt: string;
  beneficiary?: { name: string } | null;
}

interface VolunteerDetail extends VolunteerRow {
  tasks?: TaskRow[];
  attendances?: AttendanceRow[];
  stats?: {
    tasksAssigned: number;
    tasksCompleted: number;
    daysPresent: number;
    totalHours: number;
  };
}

interface EditForm {
  skills: string;
  availability: string;
  assignedArea: string;
  emergencyContact: string;
  idProof: string;
  status: string;
}

interface TaskForm {
  title: string;
  type: string;
  priority: string;
  location: string;
  scheduledDate: string;
}

interface AttForm {
  date: string;
  checkIn: string;
  checkOut: string;
  hours: string;
  location: string;
  notes: string;
}

type RuleErr = Record<string, string | undefined>;

/* ------------------------------ helpers & bits ------------------------------ */

const VOL_STATUS_OPTIONS = [
  { value: "PENDING", label: "Pending" },
  { value: "ACTIVE", label: "Active" },
  { value: "INACTIVE", label: "Inactive" },
  { value: "SUSPENDED", label: "Suspended" },
];

const PRIORITY_OPTIONS = [
  { value: "LOW", label: "Low" },
  { value: "MEDIUM", label: "Medium" },
  { value: "HIGH", label: "High" },
];

const PRIORITY_TONE: Record<string, "danger" | "warning" | "neutral"> = {
  HIGH: "danger",
  MEDIUM: "warning",
  LOW: "neutral",
};

const APP_FILTERS = ["PENDING", "APPROVED", "REJECTED", "ALL"];
const VOL_FILTERS = ["ALL", "PENDING", "ACTIVE", "INACTIVE", "SUSPENDED"];

function parseList(s?: string | null): string[] {
  if (!s) return [];
  try {
    const parsed = JSON.parse(s);
    if (Array.isArray(parsed)) return parsed.filter((x) => typeof x === "string" && x);
  } catch {
    // plain comma-separated string
  }
  return s
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
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

function fmtTime(iso?: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: false });
}

function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-full bg-teal-500/10 px-2 py-0.5 text-[11px] font-medium text-teal-700 dark:text-teal-400">
      {children}
    </span>
  );
}

function StatTile({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-lg border bg-muted/30 px-3 py-2.5">
      <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p className="mt-0.5 text-lg font-bold leading-tight tabular-nums">{value ?? "—"}</p>
    </div>
  );
}

function collectErrors(...pairs: [string, string | null][]): RuleErr | null {
  const out: RuleErr = {};
  let any = false;
  for (const [key, err] of pairs) {
    if (err) {
      out[key] = err;
      any = true;
    }
  }
  return any ? out : null;
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

/* ============================ APPLICATIONS TAB ============================= */

function ApplicationsTab() {
  const [apps, setApps] = useState<Application[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("PENDING");
  const [viewTarget, setViewTarget] = useState<Application | null>(null);

  /* approve flow: FormSheet (note) → ConfirmDialog */
  const [approveTarget, setApproveTarget] = useState<Application | null>(null);
  const [approvePending, setApprovePending] = useState<Application | null>(null);
  const [approveNote, setApproveNote] = useState("");
  const [approving, setApproving] = useState(false);

  /* reject flow: FormSheet (note) → ConfirmDialog */
  const [rejectTarget, setRejectTarget] = useState<Application | null>(null);
  const [rejectPending, setRejectPending] = useState<Application | null>(null);
  const [rejectNote, setRejectNote] = useState("");
  const [rejecting, setRejecting] = useState(false);

  const [approvedCreds, setApprovedCreds] = useState<TempCreds | null>(null);

  /* table pagination */
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const qs = filter === "ALL" ? "" : `status=${filter}`;
      const data = await get<Application[] | { items?: Application[] }>(
        `/api/volunteer-applications?${qs}`
      );
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

  useEffect(() => {
    setPage(1);
  }, [filter, pageSize]);

  const pages = Math.max(1, Math.ceil(apps.length / pageSize));
  const pageSafe = Math.min(page, pages);
  const paged = useMemo(
    () => apps.slice((pageSafe - 1) * pageSize, pageSafe * pageSize),
    [apps, pageSafe, pageSize]
  );

  const runApprove = async () => {
    if (!approvePending?.id) return;
    setApproving(true);
    try {
      const res = await patch<{ application?: Application }>(
        `/api/volunteer-applications/${approvePending.id}`,
        { status: "APPROVED", reviewNote: approveNote.trim() || undefined }
      );
      toast.success("Volunteer approved — portal unlocked");
      const creds = parseTempCreds(res?.application?.tempCreds ?? approvePending.tempCreds);
      setApprovedCreds(creds);
      setApprovePending(null);
      setApproveTarget(null);
      setApproveNote("");
      setViewTarget(null);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to approve application");
    } finally {
      setApproving(false);
    }
  };

  const runReject = async () => {
    if (!rejectPending?.id) return;
    setRejecting(true);
    try {
      await patch(`/api/volunteer-applications/${rejectPending.id}`, {
        status: "REJECTED",
        reviewNote: rejectNote.trim() || undefined,
      });
      toast.success("Application rejected");
      setRejectPending(null);
      setRejectTarget(null);
      setRejectNote("");
      setViewTarget(null);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to reject application");
    } finally {
      setRejecting(false);
    }
  };

  const busy = approving || rejecting;

  const appActions = (a: Application) => (
    <div className="flex justify-end gap-1.5" onClick={(e) => e.stopPropagation()}>
      {a.status === "PENDING" ? (
        <>
          <Button
            size="sm"
            className="min-h-9"
            onClick={() => {
              setApproveTarget(a);
              setApproveNote("");
            }}
            aria-label={`Approve ${a.fullName}`}
          >
            <Check className="size-4" /> Approve
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="min-h-9 text-red-600 hover:bg-red-500/10 hover:text-red-700 dark:text-red-400"
            onClick={() => {
              setRejectTarget(a);
              setRejectNote("");
            }}
            aria-label={`Reject ${a.fullName}`}
          >
            <X className="size-4" /> Reject
          </Button>
        </>
      ) : (
        <Button
          size="sm"
          variant="outline"
          className="min-h-9"
          onClick={() => setViewTarget(a)}
          aria-label={`View application from ${a.fullName}`}
        >
          View
        </Button>
      )}
    </div>
  );

  const appCsv: CsvColumn<Application>[] = useMemo(
    () => [
      { header: "Name", value: (a) => a.fullName },
      { header: "Email", value: (a) => a.email },
      { header: "Phone", value: (a) => a.phone },
      { header: "City", value: (a) => a.city },
      { header: "Occupation", value: (a) => a.occupation ?? "" },
      { header: "Skills", value: (a) => parseList(a.skills).join("; ") },
      { header: "Availability", value: (a) => a.availability ?? "" },
      { header: "Status", value: (a) => a.status },
      { header: "Applied", value: (a) => a.createdAt },
      { header: "Review note", value: (a) => a.reviewNote ?? "" },
    ],
    []
  );

  const columns: DataTableColumn<Application>[] = [
    { key: "name", header: "Applicant" },
    { key: "contact", header: "Contact", hideBelow: "md" },
    { key: "city", header: "City", hideBelow: "sm" },
    { key: "availability", header: "Availability", hideBelow: "lg" },
    { key: "skills", header: "Skills", hideBelow: "lg" },
    { key: "status", header: "Status" },
    { key: "applied", header: "Applied", hideBelow: "md" },
    { key: "actions", header: "", align: "right", className: "w-44" },
  ];

  return (
    <div className="space-y-4">
      {/* status filter */}
      <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Filter applications by status">
        {APP_FILTERS.map((t) => (
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

      <DataTable
        columns={columns}
        rows={paged}
        rowKey={(a) => a.id}
        loading={loading}
        skeletonRows={6}
        height="fill"
        fillOffset={300}
        onRowClick={(a) => setViewTarget(a)}
        page={pageSafe}
        pages={pages}
        total={apps.length}
        pageSize={pageSize}
        onPage={setPage}
        onPageSize={setPageSize}
        itemLabel="applications"
        empty={
          <EmptyState
            icon={<UserCheck className="size-6" aria-hidden="true" />}
            title={`No ${filter === "ALL" ? "" : `${filter.toLowerCase()} `}applications`}
            hint="New volunteer applications from the public site will appear here for review."
          />
        }
      >
        {(a, col) => {
          switch (col.key) {
            case "name":
              return (
                <div className="flex items-center gap-2.5">
                  <Avatar className="size-8">
                    <AvatarFallback className="bg-primary/10 text-xs font-semibold text-primary">
                      {initials(a.fullName)}
                    </AvatarFallback>
                  </Avatar>
                  <div className="min-w-0">
                    <p className="truncate font-medium">{a.fullName}</p>
                    {a.occupation ? (
                      <p className="truncate text-xs text-muted-foreground">{a.occupation}</p>
                    ) : null}
                  </div>
                </div>
              );
            case "contact":
              return (
                <div className="min-w-0">
                  <p className="truncate text-xs text-muted-foreground">{a.email}</p>
                  <p className="truncate font-mono text-xs text-muted-foreground">{a.phone}</p>
                </div>
              );
            case "city":
              return <span className="text-sm">{a.city || "—"}</span>;
            case "availability":
              return <span className="text-sm text-muted-foreground">{a.availability || "—"}</span>;
            case "skills": {
              const skills = parseList(a.skills);
              return skills.length > 0 ? (
                <div className="flex max-w-56 flex-wrap gap-1">
                  {skills.slice(0, 3).map((s) => (
                    <Chip key={s}>{s}</Chip>
                  ))}
                  {skills.length > 3 && (
                    <span className="text-[11px] text-muted-foreground">+{skills.length - 3}</span>
                  )}
                </div>
              ) : (
                <span className="text-xs text-muted-foreground">—</span>
              );
            }
            case "status":
              return <StatusBadge status={a.status} />;
            case "applied":
              return <span className="whitespace-nowrap text-xs text-muted-foreground">{formatDate(a.createdAt)}</span>;
            case "actions":
              return appActions(a);
            default:
              return null;
          }
        }}
      </DataTable>

      <div className="flex justify-end">
        <ExportMenu
          columns={appCsv}
          rows={apps}
          filename={`uar-volunteer-applications-${filter.toLowerCase()}`}
          disabled={apps.length === 0}
        />
      </div>

      {/* Application detail sheet */}
      <DetailSheet
        open={!!viewTarget}
        onOpenChange={(o) => !o && setViewTarget(null)}
        eyebrow="Volunteer application"
        title={viewTarget?.fullName ?? "Application"}
        description={
          viewTarget
            ? `${viewTarget.occupation ? `${viewTarget.occupation} · ` : ""}${viewTarget.city || "No city"} · applied ${formatDateTime(viewTarget.createdAt)}`
            : ""
        }
        status={viewTarget ? <StatusBadge status={viewTarget.status} /> : undefined}
        footer={
          viewTarget && viewTarget.status === "PENDING" ? (
            <>
              <p className="text-xs text-muted-foreground">
                Approving creates a VOLUNTEER account with temporary credentials.
              </p>
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  onClick={() => {
                    setApproveTarget(viewTarget);
                    setApproveNote("");
                  }}
                  aria-label={`Approve ${viewTarget.fullName}`}
                >
                  <Check className="size-4" /> Approve
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="text-red-600 hover:bg-red-500/10 hover:text-red-700 dark:text-red-400"
                  onClick={() => {
                    setRejectTarget(viewTarget);
                    setRejectNote("");
                  }}
                  aria-label={`Reject ${viewTarget.fullName}`}
                >
                  <X className="size-4" /> Reject
                </Button>
              </div>
            </>
          ) : undefined
        }
      >
        {viewTarget ? (
          <>
            <DetailSection title="Applicant" description="Identity and contact details from the public form.">
              <DetailGrid cols={2}>
                <DataField label="Full name" value={viewTarget.fullName} />
                <DataField label="Email" value={viewTarget.email} copy />
                <DataField label="Phone" value={viewTarget.phone} copy mono />
                <DataField label="City" value={viewTarget.city} />
                <DataField label="Occupation" value={viewTarget.occupation} />
                <DataField label="Linked user ID" value={viewTarget.userId} mono />
                <DataField label="Applied" value={formatDateTime(viewTarget.createdAt)} />
                <DataField
                  label="Reviewed at"
                  value={viewTarget.reviewedAt ? formatDateTime(viewTarget.reviewedAt) : "Not reviewed"}
                />
              </DetailGrid>
            </DetailSection>

            <DetailSection title="Skills & availability" description="What the applicant offers and when.">
              <div className="space-y-3">
                <div>
                  <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                    Skills
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {parseList(viewTarget.skills).length > 0
                      ? parseList(viewTarget.skills).map((s) => <Chip key={s}>{s}</Chip>)
                      : <span className="text-sm text-muted-foreground">—</span>}
                  </div>
                </div>
                <div>
                  <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                    Availability
                  </p>
                  <p className="text-sm">{viewTarget.availability || "—"}</p>
                </div>
              </div>
            </DetailSection>

            <DetailSection title="Motivation" description="Why the applicant wants to join.">
              <blockquote className="rounded-md border-l-2 border-primary/40 bg-muted/40 px-3 py-2 text-sm italic text-muted-foreground">
                “{viewTarget.motivation}”
              </blockquote>
            </DetailSection>

            {viewTarget.reviewNote ? (
              <DetailSection title="Review" description="Note recorded during review.">
                <p className="rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground">
                  {viewTarget.reviewNote}
                </p>
              </DetailSection>
            ) : null}
          </>
        ) : null}
      </DetailSheet>

      {/* Approve: review-note FormSheet */}
      <FormSheet
        open={!!approveTarget}
        onOpenChange={(o) => {
          if (!o && !approving) {
            setApproveTarget(null);
            setApproveNote("");
          }
        }}
        title={`Approve ${approveTarget?.fullName ?? "volunteer"}`}
        description="A VOLUNTEER account is created with temporary credentials, shown immediately after approval."
        submitLabel="Review & approve"
        onSubmit={() => setApprovePending(approveTarget)}
        size="sm"
      >
        <div className="rounded-lg border bg-muted/30 p-3">
          <DetailGrid cols={2}>
            <DataField label="Name" value={approveTarget?.fullName} />
            <DataField label="Email" value={approveTarget?.email} />
            <DataField label="Phone" value={approveTarget?.phone} />
            <DataField label="City" value={approveTarget?.city} />
          </DetailGrid>
        </div>
        <TextareaField
          label="Review note (optional)"
          value={approveNote}
          onChange={setApproveNote}
          placeholder="Visible to the applicant in their portal"
          rows={3}
        />
      </FormSheet>

      {/* Reject: review-note FormSheet */}
      <FormSheet
        open={!!rejectTarget}
        onOpenChange={(o) => {
          if (!o && !rejecting) {
            setRejectTarget(null);
            setRejectNote("");
          }
        }}
        title={`Reject application from ${rejectTarget?.fullName ?? "volunteer"}`}
        description="The applicant will not receive portal access. A short reason helps them reapply."
        submitLabel="Continue"
        onSubmit={() => setRejectPending(rejectTarget)}
        size="sm"
      >
        <TextareaField
          label="Review note (optional)"
          value={rejectNote}
          onChange={setRejectNote}
          placeholder="Why is this application rejected? Shared with the applicant."
          rows={3}
        />
      </FormSheet>

      {/* Approve confirm */}
      <ConfirmDialog
        open={!!approvePending}
        onOpenChange={(o) => !o && setApprovePending(null)}
        title="Approve volunteer?"
        recordName={approvePending ? `${approvePending.fullName} · ${approvePending.email}` : null}
        description="The linked account becomes a VOLUNTEER with portal access. Temporary credentials will be shown right after approval — copy them to share."
        confirmLabel="Approve & create account"
        cancelLabel="Go back"
        loading={approving}
        onConfirm={runApprove}
      />

      {/* Reject confirm */}
      <ConfirmDialog
        open={!!rejectPending}
        onOpenChange={(o) => !o && setRejectPending(null)}
        title="Reject application?"
        recordName={rejectPending ? `${rejectPending.fullName} · ${rejectPending.email}` : null}
        description="The application is marked REJECTED and no portal access is granted. This cannot be undone from here."
        confirmLabel="Reject application"
        cancelLabel="Go back"
        loading={rejecting}
        onConfirm={runReject}
      />

      {/* Temp credentials dialog */}
      <Dialog open={!!approvedCreds} onOpenChange={(o) => !o && setApprovedCreds(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <BadgeCheck className="size-4 text-primary" aria-hidden="true" /> Volunteer approved
            </DialogTitle>
            <DialogDescription>
              Share these temporary credentials with {approvedCreds?.fullName ?? "the volunteer"} —
              they should change the password after first sign-in.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="grid gap-2 rounded-lg border p-3">
              <DataField label="Login email" value={approvedCreds?.email ?? ""} mono copy />
              <DataField label="Temporary password" value={approvedCreds?.password ?? ""} mono copy />
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

/* ============================= VOLUNTEERS TAB ============================== */

const volunteerCsv: CsvColumn<VolunteerRow>[] = [
  { header: "Name", value: (v) => v.user?.name ?? "" },
  { header: "Email", value: (v) => v.user?.email ?? "" },
  { header: "Phone", value: (v) => v.user?.phone ?? "" },
  { header: "City", value: (v) => v.user?.city ?? "" },
  { header: "Status", value: (v) => v.status },
  { header: "Assigned area", value: (v) => v.assignedArea ?? "" },
  { header: "Skills", value: (v) => parseList(v.skills).join("; ") },
  { header: "Availability", value: (v) => parseList(v.availability).join("; ") },
  { header: "Emergency contact", value: (v) => v.emergencyContact ?? "" },
  { header: "ID proof", value: (v) => v.idProof ?? "" },
  { header: "Joined", value: (v) => v.joinedAt },
];

const EMPTY_TASK_FORM: TaskForm = {
  title: "",
  type: "DISTRIBUTION",
  priority: "MEDIUM",
  location: "",
  scheduledDate: "",
};

const EMPTY_ATT_FORM: AttForm = {
  date: "",
  checkIn: "",
  checkOut: "",
  hours: "",
  location: "",
  notes: "",
};

function VolunteersTab() {
  const [vols, setVols] = useState<VolunteerRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState("ALL");
  const [view, setView] = useViewPref("volunteers");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  /* edit sheet */
  const [editOpen, setEditOpen] = useState(false);
  const [editing, setEditing] = useState<VolunteerRow | null>(null);
  const [form, setForm] = useState<EditForm>({
    skills: "",
    availability: "",
    assignedArea: "",
    emergencyContact: "",
    idProof: "",
    status: "ACTIVE",
  });
  const [initialForm, setInitialForm] = useState<EditForm>(form);
  const [errors, setErrors] = useState<RuleErr>({});
  const [saving, setSaving] = useState(false);

  /* status quick actions */
  const [statusTarget, setStatusTarget] = useState<{
    vol: VolunteerRow;
    next: "ACTIVE" | "SUSPENDED";
  } | null>(null);
  const [runningStatus, setRunningStatus] = useState(false);

  /* detail sheet */
  const [detail, setDetail] = useState<VolunteerDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [attRows, setAttRows] = useState<AttendanceRow[] | null>(null);
  const [attLoading, setAttLoading] = useState(false);
  const [distRows, setDistRows] = useState<DistributionRow[] | null>(null);
  const [appLink, setAppLink] = useState<Application | null>(null);

  /* assign task sheet */
  const [taskOpen, setTaskOpen] = useState(false);
  const [taskForm, setTaskForm] = useState<TaskForm>(EMPTY_TASK_FORM);
  const [taskInitial, setTaskInitial] = useState<TaskForm>(EMPTY_TASK_FORM);
  const [taskErrors, setTaskErrors] = useState<RuleErr>({});
  const [savingTask, setSavingTask] = useState(false);

  /* record attendance sheet */
  const [attOpen, setAttOpen] = useState(false);
  const [attForm, setAttForm] = useState<AttForm>(EMPTY_ATT_FORM);
  const [attInitial, setAttInitial] = useState<AttForm>(EMPTY_ATT_FORM);
  const [attErrors, setAttErrors] = useState<RuleErr>({});
  const [savingAtt, setSavingAtt] = useState(false);

  const taskTypeOptions = useMasters("TASK_TYPE");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const v = await get<VolunteerRow[] | { items?: VolunteerRow[] }>("/api/volunteers");
      setVols(Array.isArray(v) ? v : (v.items ?? []));
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
    return vols.filter((v) => {
      if (filter !== "ALL" && v.status !== filter) return false;
      if (!needle) return true;
      const hay =
        `${v.user?.name ?? ""} ${v.user?.email ?? ""} ${v.assignedArea ?? ""}`.toLowerCase();
      return hay.includes(needle);
    });
  }, [vols, q, filter]);

  const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
  useEffect(() => {
    setPage(1);
  }, [q, filter, pageSize]);
  const pageSafe = Math.min(page, pages);
  const paged = useMemo(
    () => filtered.slice((pageSafe - 1) * pageSize, pageSafe * pageSize),
    [filtered, pageSafe, pageSize]
  );

  const hasFilters = filter !== "ALL" || q.trim() !== "";

  const clearFilters = () => {
    setQ("");
    setFilter("ALL");
  };

  const volName = (v: VolunteerRow | VolunteerDetail) => v.user?.name ?? "Volunteer";

  const loadAttendance = useCallback(async (volId: string) => {
    setAttLoading(true);
    try {
      const rows = await get<AttendanceRow[] | { items?: AttendanceRow[] }>(
        `/api/volunteer-attendances?volunteerId=${encodeURIComponent(volId)}`
      );
      setAttRows(Array.isArray(rows) ? rows : (rows.items ?? []));
    } catch {
      setAttRows([]);
    } finally {
      setAttLoading(false);
    }
  }, []);

  const refreshDetail = useCallback(async (volId: string) => {
    try {
      const d = await get<VolunteerDetail>(`/api/volunteers/${volId}`);
      setDetail(d);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to refresh volunteer");
    }
  }, []);

  const openDetail = (v: VolunteerRow) => {
    setDetail({ ...v });
    setDetailLoading(true);
    setAttRows(null);
    setDistRows(null);
    setAppLink(null);
    loadAttendance(v.id);
    get<VolunteerDetail>(`/api/volunteers/${v.id}`)
      .then((d) => setDetail(d))
      .catch(() => toast.error("Failed to load volunteer profile"))
      .finally(() => setDetailLoading(false));
    // distributions participated (shared pool, filtered client-side)
    get<DistributionRow[] | { items?: DistributionRow[] }>("/api/distributions?limit=200")
      .then((data) => {
        const list = Array.isArray(data) ? data : (data.items ?? []);
        setDistRows(list.filter((d) => (d as unknown as { volunteerId?: string }).volunteerId === v.id));
      })
      .catch(() => setDistRows([]));
    // linked volunteer application, matched by email
    if (v.user?.email) {
      get<Application[] | { items?: Application[] }>("/api/volunteer-applications")
        .then((data) => {
          const list = Array.isArray(data) ? data : (data.items ?? []);
          setAppLink(list.find((a) => a.email.toLowerCase() === (v.user?.email ?? "").toLowerCase()) ?? null);
        })
        .catch(() => setAppLink(null));
    }
  };

  /* -------------------------------- edit ---------------------------------- */

  const openEdit = (v: VolunteerRow) => {
    setEditing(v);
    const f: EditForm = {
      skills: parseList(v.skills).join(", "),
      availability: parseList(v.availability).join(", "),
      assignedArea: v.assignedArea ?? "",
      emergencyContact: v.emergencyContact ?? "",
      idProof: v.idProof ?? "",
      status: v.status,
    };
    setForm(f);
    setInitialForm(f);
    setErrors({});
    setEditOpen(true);
  };

  const saveEdit = async () => {
    if (!editing) return;
    setSaving(true);
    try {
      await patch(`/api/volunteers/${editing.id}`, {
        skills: form.skills.trim() || null,
        availability: form.availability.trim() || null,
        assignedArea: form.assignedArea.trim() || null,
        emergencyContact: form.emergencyContact.trim() || null,
        idProof: form.idProof.trim() || null,
        status: form.status,
      });
      toast.success(
        form.status !== editing.status
          ? `${volName(editing)} → ${titleCase(form.status)} (mirrored to the linked account)`
          : `${volName(editing)} updated`
      );
      setEditOpen(false);
      await load();
      if (detail?.id === editing.id) await refreshDetail(editing.id);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  /* ---------------------------- status actions ----------------------------- */

  const runStatusChange = async () => {
    if (!statusTarget) return;
    setRunningStatus(true);
    try {
      await patch(`/api/volunteers/${statusTarget.vol.id}`, { status: statusTarget.next });
      toast.success(
        `${volName(statusTarget.vol)} → ${titleCase(statusTarget.next)} (mirrored to the linked account)`
      );
      setStatusTarget(null);
      await load();
      if (detail?.id === statusTarget.vol.id) await refreshDetail(statusTarget.vol.id);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to update volunteer");
    } finally {
      setRunningStatus(false);
    }
  };

  /* ------------------------------ assign task ------------------------------ */

  const openTaskForm = () => {
    setTaskForm(EMPTY_TASK_FORM);
    setTaskInitial(EMPTY_TASK_FORM);
    setTaskErrors({});
    setTaskOpen(true);
  };

  const saveTask = async () => {
    if (!detail) return;
    const errs = collectErrors(
      ["title", required("Task title")(taskForm.title)],
      ["scheduledDate", required("Scheduled date")(taskForm.scheduledDate)]
    );
    if (errs) {
      setTaskErrors(errs);
      return;
    }
    setTaskErrors({});
    setSavingTask(true);
    try {
      await post("/api/volunteer-tasks", {
        volunteerId: detail.id,
        title: taskForm.title.trim(),
        type: taskForm.type,
        priority: taskForm.priority,
        location: taskForm.location.trim() || undefined,
        scheduledDate: taskForm.scheduledDate,
      });
      toast.success(`Task assigned to ${volName(detail)}`);
      setTaskOpen(false);
      setTaskForm(EMPTY_TASK_FORM);
      setTaskInitial(EMPTY_TASK_FORM);
      await refreshDetail(detail.id);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to assign task");
    } finally {
      setSavingTask(false);
    }
  };

  /* --------------------------- record attendance --------------------------- */

  const openAttForm = () => {
    setAttForm(EMPTY_ATT_FORM);
    setAttInitial(EMPTY_ATT_FORM);
    setAttErrors({});
    setAttOpen(true);
  };

  const saveAtt = async () => {
    if (!detail) return;
    const hoursNum = attForm.hours.trim() === "" ? null : Number(attForm.hours);
    const errs = collectErrors(
      ["date", required("Date")(attForm.date)],
      [
        "hours",
        attForm.hours.trim() === ""
          ? null
          : hoursNum === null || !Number.isFinite(hoursNum) || hoursNum < 0 || hoursNum > 24
            ? "Hours must be between 0 and 24"
            : null,
      ],
      [
        "checkOut",
        attForm.date && attForm.checkIn && attForm.checkOut && attForm.checkOut <= attForm.checkIn
          ? "Check-out must be after check-in"
          : null,
      ]
    );
    if (errs) {
      setAttErrors(errs);
      return;
    }
    setAttErrors({});
    setSavingAtt(true);
    try {
      const body: Record<string, unknown> = {
        volunteerId: detail.id,
        date: attForm.date,
      };
      if (attForm.checkIn) body.checkIn = `${attForm.date}T${attForm.checkIn}:00`;
      if (attForm.checkOut) body.checkOut = `${attForm.date}T${attForm.checkOut}:00`;
      if (hoursNum !== null) body.hours = hoursNum;
      if (attForm.location.trim()) body.location = attForm.location.trim();
      if (attForm.notes.trim()) body.notes = attForm.notes.trim();
      await post("/api/volunteer-attendances", body);
      toast.success("Attendance recorded");
      setAttOpen(false);
      setAttForm(EMPTY_ATT_FORM);
      setAttInitial(EMPTY_ATT_FORM);
      await loadAttendance(detail.id);
      await refreshDetail(detail.id);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to record attendance");
    } finally {
      setSavingAtt(false);
    }
  };

  /* -------------------------------- renders -------------------------------- */

  const quickStatusButton = (v: VolunteerRow) =>
    v.status === "ACTIVE" ? (
      <Button
        size="sm"
        variant="outline"
        className="min-h-9 text-red-600 hover:bg-red-500/10 hover:text-red-700 dark:text-red-400"
        disabled={runningStatus}
        onClick={(e) => {
          e.stopPropagation();
          setStatusTarget({ vol: v, next: "SUSPENDED" });
        }}
        aria-label={`Suspend volunteer ${volName(v)}`}
      >
        Suspend
      </Button>
    ) : (
      <Button
        size="sm"
        variant="outline"
        className="min-h-9"
        disabled={runningStatus}
        onClick={(e) => {
          e.stopPropagation();
          setStatusTarget({ vol: v, next: "ACTIVE" });
        }}
        aria-label={`Activate volunteer ${volName(v)}`}
      >
        Activate
      </Button>
    );

  const rowButtons = (v: VolunteerRow) => (
    <>
      <Button
        size="icon"
        variant="ghost"
        className="size-11 md:size-8"
        aria-label={`View volunteer ${volName(v)}`}
        onClick={(e) => {
          e.stopPropagation();
          openDetail(v);
        }}
      >
        <UserCheck className="size-4" />
      </Button>
      <Button
        size="icon"
        variant="ghost"
        className="size-11 md:size-8"
        aria-label={`Edit volunteer ${volName(v)}`}
        onClick={(e) => {
          e.stopPropagation();
          openEdit(v);
        }}
      >
        <Pencil className="size-4" />
      </Button>
      {quickStatusButton(v)}
    </>
  );

  /* ------------------------------- table columns ----------------------------- */

  const columns: DataTableColumn<VolunteerRow>[] = [
    { key: "name", header: "Volunteer" },
    { key: "status", header: "Status" },
    { key: "area", header: "Assigned area", hideBelow: "lg" },
    { key: "skills", header: "Skills", hideBelow: "lg" },
    { key: "joined", header: "Joined", hideBelow: "sm" },
    { key: "actions", header: "", align: "right", className: "w-40" },
  ];

  return (
    <div className="space-y-4">
      {/* toolbar */}
      <div className="flex flex-col gap-3 rounded-xl border bg-card p-4">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative w-full sm:w-64">
            <Search
              className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden="true"
            />
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search name, email, area…"
              className="pl-8"
              aria-label="Search volunteers"
            />
          </div>
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter volunteers by status">
            {VOL_FILTERS.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setFilter(t)}
                aria-pressed={filter === t}
                className={cn(
                  "min-h-9 rounded-full border px-3 text-xs font-semibold transition",
                  filter === t
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border text-muted-foreground hover:bg-accent"
                )}
              >
                {t === "ALL" ? "All" : titleCase(t)}
              </button>
            ))}
          </div>
          {hasFilters && (
            <Button variant="ghost" size="sm" className="min-h-9" onClick={clearFilters} aria-label="Clear filters">
              Clear
            </Button>
          )}
          <div className="flex flex-wrap items-center gap-2 sm:ml-auto">
            <span className="text-xs text-muted-foreground" aria-live="polite">
              {loading ? "Loading…" : `${filtered.length} volunteer${filtered.length === 1 ? "" : "s"}`}
            </span>
            <ViewSwitcher value={view} onChange={setView} options={["table", "grid", "list"]} />
            <ExportMenu
              columns={volunteerCsv}
              rows={filtered}
              filename="uar-volunteers"
              disabled={filtered.length === 0}
            />
          </div>
        </div>
      </div>

      {view === "table" ? (
        <DataTable
          columns={columns}
          rows={paged}
          rowKey={(v) => v.id}
          loading={loading}
          skeletonRows={8}
          height="fill"
          fillOffset={330}
          onRowClick={openDetail}
          page={pageSafe}
          pages={pages}
          total={filtered.length}
          pageSize={pageSize}
          onPage={setPage}
          onPageSize={setPageSize}
          itemLabel="volunteers"
          empty={
            <EmptyState
              icon={<Users className="size-6" aria-hidden="true" />}
              title="No volunteers found"
              hint="Approve applications in the first tab to onboard volunteers, or clear the search/status filters."
            >
              {hasFilters && (
                <Button size="sm" variant="outline" onClick={clearFilters}>
                  Clear filters
                </Button>
              )}
            </EmptyState>
          }
        >
          {(v, col) => {
            switch (col.key) {
              case "name":
                return (
                  <div className="flex items-center gap-2.5">
                    <span
                      aria-hidden="true"
                      className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary"
                    >
                      {initials(volName(v))}
                    </span>
                    <div className="min-w-0">
                      <p className="truncate font-medium">{volName(v)}</p>
                      <p className="truncate text-xs text-muted-foreground">{v.user?.email ?? "—"}</p>
                    </div>
                  </div>
                );
              case "status":
                return <StatusBadge status={v.status} />;
              case "area":
                return <span className="text-sm">{v.assignedArea || "—"}</span>;
              case "skills": {
                const skills = parseList(v.skills);
                return skills.length > 0 ? (
                  <div className="flex flex-wrap gap-1">
                    {skills.slice(0, 3).map((s) => (
                      <Chip key={s}>{s}</Chip>
                    ))}
                    {skills.length > 3 && (
                      <span className="text-[11px] text-muted-foreground">+{skills.length - 3}</span>
                    )}
                  </div>
                ) : (
                  <span className="text-xs text-muted-foreground">—</span>
                );
              }
              case "joined":
                return <span className="whitespace-nowrap text-sm">{formatDate(v.joinedAt)}</span>;
              case "actions":
                return (
                  <div className="flex justify-end gap-1">
                    {rowButtons(v)}
                  </div>
                );
              default:
                return null;
            }
          }}
        </DataTable>
      ) : view === "grid" ? (
        <>
          {loading ? (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3" aria-busy="true">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-44 rounded-xl" />
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <EmptyState
              icon={<Users className="size-6" aria-hidden="true" />}
              title="No volunteers found"
              hint="Approve applications in the first tab to onboard volunteers, or clear the search/status filters."
            />
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {paged.map((v) => (
                <article
                  key={v.id}
                  className="card-hover flex cursor-pointer flex-col gap-3 rounded-xl border bg-card p-4"
                  onClick={() => openDetail(v)}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-2.5">
                      <Avatar className="size-9">
                        <AvatarFallback className="bg-primary/10 text-xs font-semibold text-primary">
                          {initials(volName(v))}
                        </AvatarFallback>
                      </Avatar>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold">{volName(v)}</p>
                        <p className="truncate text-xs text-muted-foreground">{v.user?.email ?? "—"}</p>
                      </div>
                    </div>
                    <StatusBadge status={v.status} className="shrink-0" />
                  </div>
                  {v.assignedArea && (
                    <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <MapPin className="size-3.5" aria-hidden="true" /> {v.assignedArea}
                    </p>
                  )}
                  {parseList(v.skills).length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {parseList(v.skills).slice(0, 3).map((s) => (
                        <Chip key={s}>{s}</Chip>
                      ))}
                    </div>
                  )}
                  <div className="mt-auto flex flex-wrap items-center gap-1 border-t pt-3">
                    {rowButtons(v)}
                  </div>
                </article>
              ))}
            </div>
          )}
        </>
      ) : (
        <>
          {loading ? (
            <div className="space-y-2" aria-busy="true">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full rounded-lg" />
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <EmptyState
              icon={<Users className="size-6" aria-hidden="true" />}
              title="No volunteers found"
              hint="Approve applications in the first tab to onboard volunteers, or clear the search/status filters."
            />
          ) : (
            <ul className="max-h-96 space-y-2 overflow-y-auto scrollbar-thin" aria-label="Volunteers list">
              {paged.map((v) => (
                <li key={v.id} className="flex items-center gap-2 rounded-lg border px-3 py-2">
                  <button
                    type="button"
                    onClick={() => openDetail(v)}
                    className="flex min-w-0 flex-1 items-center gap-3 rounded-md text-left"
                    aria-label={`View volunteer ${volName(v)}`}
                  >
                    <span
                      aria-hidden="true"
                      className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary"
                    >
                      {initials(volName(v))}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold">{volName(v)}</span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {v.assignedArea ? `${v.assignedArea} · ` : ""}
                        {v.user?.email ?? "—"}
                      </span>
                    </span>
                    <StatusBadge status={v.status} className="shrink-0" />
                  </button>
                  <div className="flex shrink-0 gap-0.5">{rowButtons(v)}</div>
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      {/* pagination for grid/list (table paginates inside DataTable) */}
      {view !== "table" && !loading && filtered.length > 0 ? (
        <PaginationBar
          page={pageSafe}
          pages={pages}
          total={filtered.length}
          onPage={setPage}
          itemLabel="volunteers"
        />
      ) : null}

      {/* ------------------------------ edit sheet ------------------------------ */}
      <FormSheet
        open={editOpen}
        onOpenChange={(o) => {
          if (!o && !saving) setEditOpen(false);
        }}
        title={`Edit ${editing ? volName(editing) : "volunteer"}`}
        description="Profile fields stored on the volunteer record."
        submitLabel="Save changes"
        onSubmit={saveEdit}
        loading={saving}
        dirty={JSON.stringify(form) !== JSON.stringify(initialForm)}
        size="lg"
      >
        <FormSection title="Status" description="Roster state — mirrors to the linked account.">
          <FieldGrid>
            <SelectField
              label="Volunteer status"
              required
              value={form.status}
              onChange={(v) => setForm({ ...form, status: v })}
              options={VOL_STATUS_OPTIONS}
              hint="Mirrors to the linked account (sign-in access follows this status)."
            />
            <TextField
              label="Assigned area"
              value={form.assignedArea}
              onChange={(v) => setForm({ ...form, assignedArea: v })}
              placeholder="Yelahanka zone, Bengaluru"
            />
          </FieldGrid>
        </FormSection>
        <FormSection
          title="Skills & availability"
          description="Comma-separated lists, e.g. First aid, Teaching, Driving."
        >
          <FieldGrid>
            <TextField
              label="Skills"
              value={form.skills}
              onChange={(v) => setForm({ ...form, skills: v })}
              placeholder="First aid, Teaching, Driving"
              hint="Separate skills with commas."
            />
            <TextField
              label="Availability"
              value={form.availability}
              onChange={(v) => setForm({ ...form, availability: v })}
              placeholder="Weekends, Weekday evenings"
              hint="Separate slots with commas."
            />
          </FieldGrid>
        </FormSection>
        <FormSection title="Emergency & identity" description="On-ground contact and ID reference.">
          <FieldGrid>
            <TextField
              label="Emergency contact"
              value={form.emergencyContact}
              onChange={(v) => setForm({ ...form, emergencyContact: v })}
              placeholder="Sunita — +91 98xxxxxx01"
            />
            <TextField
              label="ID proof"
              value={form.idProof}
              onChange={(v) => setForm({ ...form, idProof: v })}
              placeholder="Aadhaar last 4 / DL number"
            />
          </FieldGrid>
        </FormSection>
      </FormSheet>

      {/* ---------------------------- status confirm ---------------------------- */}
      <ConfirmDialog
        open={!!statusTarget}
        onOpenChange={(o) => !o && setStatusTarget(null)}
        title={
          statusTarget?.next === "SUSPENDED" ? "Suspend volunteer?" : "Activate volunteer?"
        }
        recordName={
          statusTarget ? `${volName(statusTarget.vol)} · ${statusTarget.vol.user?.email ?? ""}` : null
        }
        description={
          statusTarget?.next === "SUSPENDED"
            ? "Sign-in will be blocked immediately and the linked account marked suspended."
            : "The linked account will be re-enabled and the volunteer can sign in again."
        }
        confirmLabel={statusTarget?.next === "SUSPENDED" ? "Suspend" : "Activate"}
        loading={runningStatus}
        onConfirm={runStatusChange}
      />

      {/* ---------------------------- detail sheet ------------------------------ */}
      <DetailSheet
        open={!!detail}
        onOpenChange={(o) => !o && setDetail(null)}
        eyebrow="Volunteer"
        title={detail ? volName(detail) : "Volunteer"}
        description={
          detail
            ? `${detail.user?.email ?? ""} · joined ${formatDate(detail.joinedAt)}${detail.assignedArea ? ` · ${detail.assignedArea}` : ""}`
            : "Loading…"
        }
        status={detail ? <StatusBadge status={detail.status} /> : undefined}
        actions={
          detail ? (
            <>
              <Button
                size="sm"
                variant="outline"
                onClick={() => openEdit(detail)}
                aria-label="Edit volunteer profile"
              >
                <Pencil className="size-3.5" aria-hidden="true" /> Edit
              </Button>
              {quickStatusButton(detail)}
            </>
          ) : undefined
        }
      >
        {!detail ? (
          <div className="space-y-3" aria-busy="true">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {[0, 1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-16 rounded-lg" />
              ))}
            </div>
            <Skeleton className="h-40 rounded-xl" />
          </div>
        ) : (
          <>
            {/* engagement strip */}
            <DetailSection title="Engagement" description="Tasks and attendance summary.">
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <StatTile
                  label="Tasks assigned"
                  value={detail.stats ? detail.stats.tasksAssigned : "—"}
                />
                <StatTile
                  label="Completed"
                  value={detail.stats ? detail.stats.tasksCompleted : "—"}
                />
                <StatTile
                  label="Days present"
                  value={detail.stats ? detail.stats.daysPresent : "—"}
                />
                <StatTile
                  label="Total hours"
                  value={detail.stats ? `${detail.stats.totalHours} h` : "—"}
                />
              </div>
            </DetailSection>

            <DetailSection title="Profile" description="Identity and roster fields.">
              <DetailGrid cols={2}>
                <DataField label="Full name" value={detail.user?.name} />
                <DataField label="Email" value={detail.user?.email} copy />
                <DataField label="Phone" value={detail.user?.phone} copy mono />
                <DataField label="City" value={detail.user?.city} />
                <DataField
                  label="Account status"
                  value={detail.user?.status ? <StatusBadge status={detail.user.status} /> : ""}
                />
                <DataField
                  label="Volunteer status"
                  value={<StatusBadge status={detail.status} />}
                />
                <DataField label="Assigned area" value={detail.assignedArea} />
                <DataField label="Emergency contact" value={detail.emergencyContact} copy />
                <DataField label="ID proof" value={detail.idProof} />
                <DataField label="Joined" value={formatDate(detail.joinedAt)} />
              </DetailGrid>
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <div>
                  <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                    Skills
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {parseList(detail.skills).length > 0
                      ? parseList(detail.skills).map((s) => <Chip key={s}>{s}</Chip>)
                      : <span className="text-sm text-muted-foreground">—</span>}
                  </div>
                </div>
                <div>
                  <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                    Availability
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {parseList(detail.availability).length > 0
                      ? parseList(detail.availability).map((s) => (
                          <Chip key={s}>{titleCase(s)}</Chip>
                        ))
                      : <span className="text-sm text-muted-foreground">—</span>}
                  </div>
                </div>
              </div>
            </DetailSection>

            {/* tasks */}
            <DetailSection
              title="Tasks"
              description="All tasks linked to this volunteer."
              actions={
                <Button size="sm" onClick={openTaskForm}>
                  <Plus className="size-4" aria-hidden="true" /> Assign task
                </Button>
              }
            >
              {!detail.tasks ? (
                <div className="space-y-2" aria-busy="true">
                  {[0, 1].map((i) => (
                    <Skeleton key={i} className="h-16 rounded-lg" />
                  ))}
                </div>
              ) : detail.tasks.length === 0 ? (
                <EmptyState
                  icon={<ClipboardList className="size-6" aria-hidden="true" />}
                  title="No tasks yet"
                  hint="Assign the first task — it will appear in the volunteer's portal."
                />
              ) : (
                <ul
                  className="max-h-96 space-y-2 overflow-y-auto scrollbar-thin"
                  aria-label="Volunteer tasks"
                >
                  {detail.tasks.map((t) => (
                    <li key={t.id} className="rounded-lg border p-3">
                      <div className="flex items-start justify-between gap-2">
                        <p className="min-w-0 truncate text-sm font-medium">{t.title}</p>
                        <StatusBadge
                          status={t.priority}
                          tone={PRIORITY_TONE[t.priority] ?? "neutral"}
                          className="shrink-0"
                        />
                      </div>
                      <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                        <span className="flex items-center gap-1">
                          <CalendarClock className="size-3" aria-hidden="true" />{" "}
                          {formatDateTime(t.scheduledDate)}
                        </span>
                        {t.location && (
                          <span className="flex items-center gap-1">
                            <MapPin className="size-3" aria-hidden="true" /> {t.location}
                          </span>
                        )}
                        <span>{titleCase(t.type)}</span>
                      </p>
                      <div className="mt-1.5">
                        <StatusBadge status={t.status} />
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </DetailSection>

            {/* distributions participated */}
            <DetailSection
              title="Distributions participated"
              description="Aid hand-outs recorded against this volunteer."
            >
              {distRows === null ? (
                <div className="space-y-2" aria-busy="true">
                  {[0, 1].map((i) => (
                    <Skeleton key={i} className="h-12 rounded-lg" />
                  ))}
                </div>
              ) : distRows.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No distributions recorded for this volunteer yet.
                </p>
              ) : (
                <ul
                  className="max-h-80 space-y-1.5 overflow-y-auto scrollbar-thin"
                  aria-label="Distributions participated"
                >
                  {distRows.map((d) => (
                    <li key={d.id} className="flex items-center gap-3 rounded-lg border px-3 py-2 text-sm">
                      <Package className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium">
                          {titleCase(d.type)}
                          {d.beneficiary?.name ? ` → ${d.beneficiary.name}` : ""}
                        </span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {d.location || "No location"} · {formatDateTime(d.distributedAt)}
                        </span>
                      </span>
                      <span className="shrink-0 text-right text-xs tabular-nums">
                        <span className="block font-medium">×{d.quantity}</span>
                        {d.value ? (
                          <span className="block text-muted-foreground">{formatINR(d.value)}</span>
                        ) : null}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </DetailSection>

            {/* attendance */}
            <DetailSection
              title="Attendance"
              description="Recorded days, check-ins and hours."
              actions={
                <Button size="sm" variant="outline" onClick={openAttForm}>
                  <Plus className="size-4" aria-hidden="true" /> Record
                </Button>
              }
            >
              {attLoading || attRows === null ? (
                <div className="space-y-2" aria-busy="true">
                  {[0, 1, 2].map((i) => (
                    <Skeleton key={i} className="h-10 rounded-lg" />
                  ))}
                </div>
              ) : attRows.length === 0 ? (
                <p className="text-sm text-muted-foreground">No attendance recorded yet.</p>
              ) : (
                <div className="max-h-80 overflow-y-auto rounded-lg border scrollbar-thin">
                  <table className="w-full text-sm">
                    <thead className="sticky top-0 bg-card">
                      <tr className="border-b text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                        <th scope="col" className="px-3 py-2 font-semibold">Date</th>
                        <th scope="col" className="px-3 py-2 font-semibold">In</th>
                        <th scope="col" className="px-3 py-2 font-semibold">Out</th>
                        <th scope="col" className="px-3 py-2 text-right font-semibold">Hours</th>
                        <th scope="col" className="hidden px-3 py-2 font-semibold sm:table-cell">Location</th>
                      </tr>
                    </thead>
                    <tbody>
                      {attRows.map((r) => (
                        <tr key={r.id} className="border-b last:border-b-0">
                          <td className="whitespace-nowrap px-3 py-2">{formatDate(r.date)}</td>
                          <td className="px-3 py-2 font-mono text-xs">{fmtTime(r.checkIn)}</td>
                          <td className="px-3 py-2 font-mono text-xs">{fmtTime(r.checkOut)}</td>
                          <td className="px-3 py-2 text-right font-medium tabular-nums">
                            {r.hours !== null && r.hours !== undefined ? r.hours : "—"}
                          </td>
                          <td className="hidden max-w-40 truncate px-3 py-2 sm:table-cell">
                            {r.location || "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </DetailSection>

            {/* application link */}
            <DetailSection
              title="Application"
              description="The volunteer application this roster entry came from."
            >
              {appLink === null ? (
                <p className="text-sm text-muted-foreground">
                  No matching application on file — this volunteer may have been onboarded directly.
                </p>
              ) : (
                <DetailGrid cols={2}>
                  <DataField label="Applied as" value={appLink.fullName} />
                  <DataField label="Application status" value={<StatusBadge status={appLink.status} />} />
                  <DataField label="Applied on" value={formatDateTime(appLink.createdAt)} />
                  <DataField
                    label="Reviewed at"
                    value={appLink.reviewedAt ? formatDateTime(appLink.reviewedAt) : "Not reviewed"}
                  />
                  <DataField label="Review note" value={appLink.reviewNote} className="sm:col-span-2" />
                  <DataField label="Motivation" value={appLink.motivation} className="sm:col-span-2" />
                </DetailGrid>
              )}
            </DetailSection>
          </>
        )}
      </DetailSheet>

      {/* --------------------------- assign task sheet --------------------------- */}
      <FormSheet
        open={taskOpen}
        onOpenChange={(o) => {
          if (!o && !savingTask) setTaskOpen(false);
        }}
        title={`Assign task — ${detail ? volName(detail) : "volunteer"}`}
        submitLabel="Assign task"
        onSubmit={saveTask}
        loading={savingTask}
        dirty={JSON.stringify(taskForm) !== JSON.stringify(taskInitial)}
        size="md"
      >
        <TextField
          label="Task title"
          required
          value={taskForm.title}
          onChange={(v) => setTaskForm({ ...taskForm, title: v })}
          placeholder="Weekend ration drive — Yelahanka"
          error={taskErrors.title}
        />
        <FieldGrid>
          <SelectField
            label="Type"
            required
            value={taskForm.type}
            onChange={(v) => setTaskForm({ ...taskForm, type: v })}
            options={taskTypeOptions.options}
          />
          <SelectField
            label="Priority"
            required
            value={taskForm.priority}
            onChange={(v) => setTaskForm({ ...taskForm, priority: v })}
            options={PRIORITY_OPTIONS}
          />
        </FieldGrid>
        <TextField
          label="Location"
          value={taskForm.location}
          onChange={(v) => setTaskForm({ ...taskForm, location: v })}
          placeholder="Community hall, Sahakar Nagar"
        />
        <TextField
          label="Scheduled date"
          required
          type="date"
          value={taskForm.scheduledDate}
          onChange={(v) => setTaskForm({ ...taskForm, scheduledDate: v })}
          error={taskErrors.scheduledDate}
        />
      </FormSheet>

      {/* ------------------------ record attendance sheet ------------------------ */}
      <FormSheet
        open={attOpen}
        onOpenChange={(o) => {
          if (!o && !savingAtt) setAttOpen(false);
        }}
        title="Record attendance"
        description="One row per volunteer per date — saving the same date again updates that day."
        submitLabel="Save attendance"
        onSubmit={saveAtt}
        loading={savingAtt}
        dirty={JSON.stringify(attForm) !== JSON.stringify(attInitial)}
        size="md"
      >
        <FieldGrid>
          <TextField
            label="Date"
            required
            type="date"
            value={attForm.date}
            onChange={(v) => setAttForm({ ...attForm, date: v })}
            error={attErrors.date}
          />
          <TextField
            label="Hours"
            type="number"
            min="0"
            max="24"
            step="0.5"
            value={attForm.hours}
            onChange={(v) => setAttForm({ ...attForm, hours: v })}
            placeholder="0–24"
            error={attErrors.hours}
          />
        </FieldGrid>
        <FieldGrid>
          <TextField
            label="Check-in"
            type="time"
            value={attForm.checkIn}
            onChange={(v) => setAttForm({ ...attForm, checkIn: v })}
          />
          <TextField
            label="Check-out"
            type="time"
            value={attForm.checkOut}
            onChange={(v) => setAttForm({ ...attForm, checkOut: v })}
            error={attErrors.checkOut}
          />
        </FieldGrid>
        <TextField
          label="Location"
          value={attForm.location}
          onChange={(v) => setAttForm({ ...attForm, location: v })}
          placeholder="Distribution centre, Hebbal"
        />
        <TextareaField
          label="Notes"
          value={attForm.notes}
          onChange={(v) => setAttForm({ ...attForm, notes: v })}
          placeholder="Optional context for the day"
          rows={2}
        />
      </FormSheet>
    </div>
  );
}
