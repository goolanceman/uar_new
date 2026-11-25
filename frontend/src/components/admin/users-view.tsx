"use client";

/**
 * Users & Roles — full user management (round 6).
 *
 * Toolbar: search + role filter + status filter + ViewSwitcher (table/grid/
 * list) + CSV export + "Add user". DataTable rows show identity, role badge,
 * status badge, phone, city, joined date and a live active-toggle; row click
 * opens a tabbed DetailSheet (Profile · Security · Activity · Related ·
 * Danger zone). Security holds the features enable/disable switches, role &
 * status controls and the one-time RESET PASSWORD flow ("Uar@<rand6>" shown
 * once in a copyable banner, same pattern as volunteer temp creds). Creating
 * a user also generates a temp password and shows it once.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CalendarClock,
  Check,
  ClipboardList,
  Copy,
  Eye,
  HandHeart,
  Image as ImageIcon,
  KeyRound,
  Link2,
  Pencil,
  Plus,
  RefreshCw,
  ScrollText,
  Search,
  ShieldAlert,
  Trash2,
  TriangleAlert,
  Users,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { del, get, patch, post } from "@/lib/api-client";
import { useAuth } from "@/hooks/use-auth";
import { formatDate, formatDateTime, formatINR, initials, titleCase } from "@/lib/format";
import { cn, timeAgo } from "@/lib/utils";
import {
  emailRule,
  fieldError,
  panRule,
  phoneRule,
  required,
} from "@/lib/validators";
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
  Field,
  FieldGrid,
  FormSection,
  SelectField,
  SwitchField,
  TextField,
  TextareaField,
} from "@/components/shared/form-fields";
import { FilePickButton, fileUrl } from "@/components/shared/file-picker";
import { StatusBadge, type Tone } from "@/components/shared/status-badge";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { ExportMenu, type CsvColumn } from "@/components/shared/csv";
import {
  PaginationBar,
  ViewSwitcher,
  useViewPref,
  type DataViewMode,
} from "@/components/shared/view-switcher";
import {
  DataTable,
  type DataTableColumn,
} from "@/components/shared/data-table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

/* ------------------------------ types & constants --------------------------- */

interface UserRow {
  id: string;
  name: string;
  email: string;
  role: string;
  status: string;
  isActive?: boolean;
  phone?: string | null;
  city?: string | null;
  pan?: string | null;
  about?: string | null;
  avatar?: string | null;
  createdAt: string;
  updatedAt?: string;
}

interface ActivityLogLite {
  id: string;
  action: string;
  entityType: string;
  entityId?: string | null;
  details?: string | null;
  actorName?: string | null;
  createdAt: string;
}

interface DonationLite {
  id: string;
  receiptNumber?: string | null;
  amount: number;
  category: string;
  paymentStatus: string;
  createdAt: string;
  campaign?: { title?: string | null } | null;
}

interface VolunteerLite {
  id: string;
  userId: string;
  status: string;
  assignedArea?: string | null;
  joinedAt: string;
}

interface TaskLite {
  id: string;
  volunteerId: string;
  title: string;
  type: string;
  status: string;
  priority: string;
  location?: string | null;
  scheduledDate: string;
}

interface BeneficiaryLite {
  id: string;
  userId?: string | null;
  name: string;
  category: string;
  caseStatus?: string;
  city?: string | null;
}

const ROLES = ["ADMIN", "VOLUNTEER", "DONOR", "BENEFICIARY"] as const;
const STATUSES = ["ACTIVE", "PENDING", "SUSPENDED"] as const;

/** What each role can reach — surfaced in the user detail Profile tab. */
const ROLE_ACCESS: Record<string, string[]> = {
  ADMIN: [
    "Admin console (every module)",
    "Donations, donors & 80G receipts",
    "Campaigns, causes & certificates",
    "Distributions, inventory & kits",
    "Volunteers, tasks & attendance",
    "Users, roles & settings",
  ],
  VOLUNTEER: [
    "Volunteer portal dashboard",
    "My tasks (start & complete)",
    "Record distributions",
    "Scan kit QR codes",
    "Check inventory stock",
    "My profile & analytics",
  ],
  DONOR: [
    "Donor portal dashboard",
    "Donate & payment history",
    "Support causes & medicine pledges",
    "Sponsor shelter animals",
    "Download 80G receipts",
    "My profile & analytics",
  ],
  BENEFICIARY: [
    "Help centre (request support)",
    "Track my requests",
    "My profile & analytics",
  ],
};

const ROLE_TONE: Record<string, Tone> = {
  ADMIN: "purple",
  VOLUNTEER: "progress",
  DONOR: "success",
  BENEFICIARY: "danger",
};

function RoleBadge({ role }: { role: string }) {
  return (
    <StatusBadge status={role} tone={ROLE_TONE[role] ?? "neutral"}>
      {titleCase(role)}
    </StatusBadge>
  );
}

/* ------------------------------ temp credentials ---------------------------- */

/** "Uar@<rand6>" — same spirit as the volunteer-application temp creds. */
function makeTempPassword(): string {
  const chars = "ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
  let out = "";
  for (let i = 0; i < 6; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return `Uar@${out}`;
}

interface TempCreds {
  name: string;
  email: string;
  password: string;
}

/** One-time copyable banner — the password is never retrievable again. */
function TempCredBanner({
  creds,
  title,
  onDismiss,
}: {
  creds: TempCreds;
  title: string;
  onDismiss: () => void;
}) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(creds.password);
      } else {
        const el = document.createElement("textarea");
        el.value = creds.password;
        el.style.position = "fixed";
        el.style.opacity = "0";
        document.body.appendChild(el);
        el.select();
        document.execCommand("copy");
        document.body.removeChild(el);
      }
      setCopied(true);
      toast.success("Password copied");
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      toast.error("Could not copy");
    }
  };

  return (
    <div
      className="flex flex-wrap items-start gap-3 rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-4 py-3"
      role="status"
    >
      <KeyRound className="mt-0.5 size-4 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-emerald-800 dark:text-emerald-300">{title}</p>
        <p className="mt-0.5 text-xs text-emerald-800/80 dark:text-emerald-300/80">
          {creds.name} · {creds.email} — share it securely; it will not be shown again.
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <code className="rounded-md border border-emerald-500/30 bg-background/60 px-2.5 py-1 font-mono text-sm font-semibold tracking-wide text-emerald-900 dark:text-emerald-200">
            {creds.password}
          </code>
          <Button
            size="sm"
            variant="outline"
            className="min-h-9 border-emerald-500/40 text-emerald-700 hover:bg-emerald-500/10 dark:text-emerald-300"
            onClick={copy}
            aria-label="Copy temporary password"
          >
            {copied ? (
              <Check className="size-4" aria-hidden="true" />
            ) : (
              <Copy className="size-4" aria-hidden="true" />
            )}
            {copied ? "Copied" : "Copy password"}
          </Button>
        </div>
      </div>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss password banner"
        className="rounded-md p-1.5 text-emerald-700/70 transition-colors hover:bg-emerald-500/15 hover:text-emerald-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:text-emerald-300/70"
      >
        <X className="size-4" aria-hidden="true" />
      </button>
    </div>
  );
}

/* --------------------------------- form state ------------------------------- */

interface CreateForm {
  name: string;
  email: string;
  role: string;
  phone: string;
  city: string;
  about: string;
}

interface EditForm {
  name: string;
  email: string;
  phone: string;
  city: string;
  pan: string;
  about: string;
  avatar: string;
  role: string;
  status: string;
  isActive: boolean;
}

const emptyCreateForm: CreateForm = {
  name: "",
  email: "",
  role: "DONOR",
  phone: "",
  city: "",
  about: "",
};

const emptyEditForm: EditForm = {
  name: "",
  email: "",
  phone: "",
  city: "",
  pan: "",
  about: "",
  avatar: "",
  role: "DONOR",
  status: "ACTIVE",
  isActive: true,
};

function formFromRow(u: UserRow): EditForm {
  return {
    name: u.name ?? "",
    email: u.email ?? "",
    phone: u.phone ?? "",
    city: u.city ?? "",
    pan: u.pan ?? "",
    about: u.about ?? "",
    avatar: u.avatar ?? "",
    role: u.role ?? "DONOR",
    status: u.status ?? "ACTIVE",
    isActive: u.isActive ?? u.status === "ACTIVE",
  };
}

/* ----------------------------------- view ----------------------------------- */

export default function UsersView() {
  const { user } = useAuth();

  const [rows, setRows] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // toolbar
  const [q, setQ] = useState("");
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState("ALL");
  const [statusFilter, setStatusFilter] = useState("ALL");

  // pagination + view mode
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [mode, setMode] = useViewPref("users");

  // create / edit
  const [createOpen, setCreateOpen] = useState(false);
  const [createForm, setCreateForm] = useState<CreateForm>({ ...emptyCreateForm });
  const [editOpen, setEditOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<UserRow | null>(null);
  const [editForm, setEditForm] = useState<EditForm>({ ...emptyEditForm });
  const [editSnapshot, setEditSnapshot] = useState<string>(JSON.stringify(emptyEditForm));

  // one-time temp password banner (create + reset password)
  const [tempCreds, setTempCreds] = useState<TempCreds | null>(null);
  const [resetCreds, setResetCreds] = useState<TempCreds | null>(null);

  // detail sheet + tabs
  const [viewOpen, setViewOpen] = useState(false);
  const [viewTarget, setViewTarget] = useState<UserRow | null>(null);
  const [viewLogs, setViewLogs] = useState<ActivityLogLite[] | null>(null);
  const [logsLoading, setLogsLoading] = useState(false);

  // security tab local state
  const [secRole, setSecRole] = useState("DONOR");
  const [secStatus, setSecStatus] = useState("ACTIVE");
  const [secActive, setSecActive] = useState(true);

  // related tab
  const [relatedDonations, setRelatedDonations] = useState<DonationLite[] | null>(null);
  const [relatedVolunteer, setRelatedVolunteer] = useState<VolunteerLite | null>(null);
  const [relatedTasks, setRelatedTasks] = useState<TaskLite[] | null>(null);
  const [relatedBeneficiary, setRelatedBeneficiary] = useState<BeneficiaryLite | null>(null);
  const [relatedLoading, setRelatedLoading] = useState(false);

  // confirms
  const [roleChange, setRoleChange] = useState<{ target: UserRow; role: string } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<UserRow | null>(null);

  const adminCount = useMemo(() => rows.filter((r) => r.role === "ADMIN").length, [rows]);
  const isSelf = (u: UserRow) => u.id === user?.id;
  const isLastAdmin = (u: UserRow) => u.role === "ADMIN" && adminCount <= 1;

  /* -------------------------------- loading -------------------------------- */

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await get<UserRow[] | { items?: UserRow[] }>("/api/users");
      setRows(Array.isArray(data) ? data : (data.items ?? []));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load users");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const t = setTimeout(() => setSearch(q), 300);
    return () => clearTimeout(t);
  }, [q]);

  // Keep the open detail sheet in sync after list reloads (role/status flips).
  const viewId = viewTarget?.id;
  useEffect(() => {
    if (!viewId) return;
    const fresh = rows.find((r) => r.id === viewId);
    if (fresh) setViewTarget((prev) => (prev && prev.id === fresh.id ? fresh : prev));
  }, [rows, viewId]);

  // Reset the Security tab state whenever the detail target changes.
  useEffect(() => {
    setResetCreds(null);
    if (viewTarget) {
      setSecRole(viewTarget.role);
      setSecStatus(viewTarget.status);
      setSecActive(viewTarget.isActive ?? viewTarget.status === "ACTIVE");
    }
  }, [viewTarget]);

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return rows.filter((u) => {
      if (roleFilter !== "ALL" && u.role !== roleFilter) return false;
      if (statusFilter !== "ALL" && u.status !== statusFilter) return false;
      if (
        needle &&
        !`${u.name} ${u.email} ${u.phone ?? ""} ${u.city ?? ""}`.toLowerCase().includes(needle)
      )
        return false;
      return true;
    });
  }, [rows, search, roleFilter, statusFilter]);

  const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
  useEffect(() => {
    setPage(1);
  }, [search, roleFilter, statusFilter, pageSize]);
  const paged = useMemo(
    () => filtered.slice((page - 1) * pageSize, page * pageSize),
    [filtered, page, pageSize]
  );

  const hasFilters = roleFilter !== "ALL" || statusFilter !== "ALL" || search.trim() !== "";

  const clearFilters = () => {
    setQ("");
    setRoleFilter("ALL");
    setStatusFilter("ALL");
  };

  /* -------------------------------- create ---------------------------------- */

  const createDirty =
    createOpen && JSON.stringify(createForm) !== JSON.stringify(emptyCreateForm);

  const submitCreate = async () => {
    const errors: string[] = [];
    const nameErr = required("Name")(createForm.name);
    if (nameErr) errors.push(nameErr);
    const emailErr = emailRule()(createForm.email);
    if (emailErr) errors.push(emailErr);
    const phoneErr = fieldError(createForm.phone, [phoneRule(true)]);
    if (phoneErr) errors.push(phoneErr);
    if (errors.length) {
      toast.error(errors[0]);
      return;
    }
    setSaving(true);
    const tempPassword = makeTempPassword();
    try {
      await post("/api/users", {
        name: createForm.name.trim(),
        email: createForm.email.trim().toLowerCase(),
        password: tempPassword,
        role: createForm.role,
        city: createForm.city.trim() || undefined,
        phone: createForm.phone.trim() || undefined,
        about: createForm.about.trim() || undefined,
      });
      toast.success(`User ${createForm.name.trim()} created`);
      setCreateOpen(false);
      setCreateForm({ ...emptyCreateForm });
      setTempCreds({
        name: createForm.name.trim(),
        email: createForm.email.trim().toLowerCase(),
        password: tempPassword,
      });
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to create user");
    } finally {
      setSaving(false);
    }
  };

  /* --------------------------------- edit ----------------------------------- */

  const openEdit = (u: UserRow) => {
    setEditTarget(u);
    const next = formFromRow(u);
    setEditForm(next);
    setEditSnapshot(JSON.stringify(next));
    setEditOpen(true);
  };

  const editDirty = editOpen && JSON.stringify(editForm) !== editSnapshot;

  const submitEdit = () => {
    if (!editTarget) return;
    const errors: string[] = [];
    const nameErr = required("Name")(editForm.name);
    if (nameErr) errors.push(nameErr);
    const emailErr = emailRule()(editForm.email);
    if (emailErr) errors.push(emailErr);
    const panErr = panRule(true)(editForm.pan);
    if (panErr) errors.push(panErr);
    const phoneErr = fieldError(editForm.phone, [phoneRule(true)]);
    if (phoneErr) errors.push(phoneErr);
    if (errors.length) {
      toast.error(errors[0]);
      return;
    }
    if (editForm.role !== editTarget.role) {
      setRoleChange({ target: editTarget, role: editForm.role });
      return;
    }
    void doSaveEdit();
  };

  const doSaveEdit = async () => {
    if (!editTarget) return;
    setSaving(true);
    try {
      await patch(`/api/users/${editTarget.id}`, {
        name: editForm.name.trim(),
        email: editForm.email.trim().toLowerCase(),
        phone: editForm.phone.trim() || null,
        city: editForm.city.trim() || null,
        pan: editForm.pan.trim() ? editForm.pan.trim().toUpperCase() : null,
        about: editForm.about.trim() || null,
        avatar: editForm.avatar.trim() || null,
        role: editForm.role,
        status: editForm.status,
        isActive: editForm.isActive,
      });
      toast.success(`${editForm.name.trim()} updated`);
      setEditOpen(false);
      setEditTarget(null);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to update user");
    } finally {
      setSaving(false);
    }
  };

  /* ---------------------------- inline role change --------------------------- */

  const confirmRoleChange = async () => {
    if (!roleChange) return;
    const { target, role } = roleChange;
    if (target.id === user?.id) {
      toast.error("You cannot change your own role");
      setRoleChange(null);
      return;
    }
    if (target.role === "ADMIN" && adminCount <= 1 && role !== "ADMIN") {
      toast.error("You cannot change the role of the only administrator");
      setRoleChange(null);
      return;
    }
    setSaving(true);
    try {
      await patch(`/api/users/${target.id}`, { role });
      toast.success(`${target.name} is now ${titleCase(role)}`);
      setRoleChange(null);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to change role");
    } finally {
      setSaving(false);
    }
  };

  /* --------------------------- table active toggle --------------------------- */

  const toggleActive = async (u: UserRow, next: boolean) => {
    if (!next && isSelf(u)) {
      toast.error("You cannot deactivate your own account");
      return;
    }
    if (!next && isLastAdmin(u)) {
      toast.error("You cannot deactivate the only administrator account");
      return;
    }
    try {
      await patch(`/api/users/${u.id}`, { isActive: next });
      toast.success(next ? `${u.name} can sign in again` : `${u.name} — sign-in disabled`);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to update account");
    }
  };

  /* ------------------------------ detail sheet ------------------------------- */

  const openView = (u: UserRow) => {
    setViewTarget(u);
    setViewOpen(true);
    setViewLogs(null);
    setRelatedDonations(null);
    setRelatedVolunteer(null);
    setRelatedTasks(null);
    setRelatedBeneficiary(null);

    // Audit trail straight from the extended user endpoint.
    setLogsLoading(true);
    get<{ user?: UserRow; activityLogs?: ActivityLogLite[] }>(`/api/users/${u.id}`)
      .then((data) => {
        setViewLogs(Array.isArray(data?.activityLogs) ? data.activityLogs : []);
      })
      .catch(() => {
        setViewLogs([]);
        // Non-fatal: the row we already hold still powers the other tabs.
      })
      .finally(() => setLogsLoading(false));

    // Role-aware related records.
    if (u.role === "DONOR") {
      setRelatedLoading(true);
      get<DonationLite[] | { items?: DonationLite[] }>(
        `/api/donations?q=${encodeURIComponent(u.email)}&limit=100`
      )
        .then((data) => {
          const list = Array.isArray(data) ? data : (data.items ?? []);
          setRelatedDonations(list);
        })
        .catch(() => setRelatedDonations([]))
        .finally(() => setRelatedLoading(false));
    }

    if (u.role === "VOLUNTEER") {
      setRelatedLoading(true);
      get<VolunteerLite[]>("/api/volunteers")
        .then(async (list) => {
          const v = Array.isArray(list) ? list.find((x) => x.userId === u.id) : undefined;
          setRelatedVolunteer(v ?? null);
          if (v) {
            const tasks = await get<TaskLite[]>("/api/volunteer-tasks").catch(() => []);
            setRelatedTasks(
              (Array.isArray(tasks) ? tasks : []).filter((t) => t.volunteerId === v.id)
            );
          } else {
            setRelatedTasks([]);
          }
        })
        .catch(() => {
          setRelatedVolunteer(null);
          setRelatedTasks([]);
        })
        .finally(() => setRelatedLoading(false));
    }

    if (u.role === "BENEFICIARY") {
      setRelatedLoading(true);
      get<BeneficiaryLite[]>("/api/beneficiaries")
        .then((list) => {
          const b = Array.isArray(list) ? list.find((x) => x.userId === u.id) : undefined;
          setRelatedBeneficiary(b ?? null);
        })
        .catch(() => setRelatedBeneficiary(null))
        .finally(() => setRelatedLoading(false));
    }
  };

  /* --------------------------- security tab actions -------------------------- */

  const guardStatusChange = (u: UserRow, nextStatus: string): string | null => {
    if (u.id === user?.id && nextStatus !== "ACTIVE")
      return "You cannot suspend or deactivate your own account";
    if (u.role === "ADMIN" && adminCount <= 1 && nextStatus !== "ACTIVE")
      return "You cannot suspend the only administrator account";
    return null;
  };

  const applyStatus = async (u: UserRow, nextStatus: string) => {
    const guard = guardStatusChange(u, nextStatus);
    if (guard) {
      toast.error(guard);
      setSecStatus(u.status);
      return;
    }
    if (nextStatus === u.status) return;
    setSaving(true);
    try {
      await patch(`/api/users/${u.id}`, { status: nextStatus });
      toast.success(`${u.name} — status set to ${titleCase(nextStatus)}`);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to update status");
      setSecStatus(u.status);
    } finally {
      setSaving(false);
    }
  };

  const applyActive = async (u: UserRow, next: boolean) => {
    if (!next && u.id === user?.id) {
      toast.error("You cannot deactivate your own account");
      setSecActive(true);
      return;
    }
    if (!next && isLastAdmin(u)) {
      toast.error("You cannot deactivate the only administrator account");
      setSecActive(true);
      return;
    }
    setSecActive(next);
    try {
      await patch(`/api/users/${u.id}`, { isActive: next });
      toast.success(
        next ? `Sign-in enabled for ${u.name}` : `Sign-in disabled for ${u.name}`
      );
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to update account");
      setSecActive(!next);
    }
  };

  const resetPassword = async (u: UserRow) => {
    const tempPassword = makeTempPassword();
    setSaving(true);
    try {
      await patch(`/api/users/${u.id}`, { password: tempPassword });
      setResetCreds({ name: u.name, email: u.email, password: tempPassword });
      toast.success("Temporary password generated — copy it now");
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to reset password");
    } finally {
      setSaving(false);
    }
  };

  /* --------------------------------- delete ---------------------------------- */

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setSaving(true);
    try {
      await del(`/api/users/${deleteTarget.id}`);
      toast.success("User deleted");
      setDeleteTarget(null);
      if (viewTarget?.id === deleteTarget.id) {
        setViewOpen(false);
        setViewTarget(null);
      }
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to delete user");
    } finally {
      setSaving(false);
    }
  };

  /* --------------------------------- actions UI ------------------------------ */

  const rowActions = (u: UserRow, withLabels = false) => {
    const self = isSelf(u);
    const lastAdmin = isLastAdmin(u);
    return (
      <div
        className={cn(
          "items-center",
          withLabels ? "flex flex-wrap gap-2" : "flex justify-end gap-1"
        )}
      >
        <Button
          size={withLabels ? "sm" : "icon"}
          variant="ghost"
          className={withLabels ? "" : "size-11 md:size-9"}
          aria-label={`View user ${u.name}`}
          onClick={(e) => {
            e.stopPropagation();
            openView(u);
          }}
        >
          <Eye className="size-4" />
          {withLabels && <span>View</span>}
        </Button>
        <Button
          size={withLabels ? "sm" : "icon"}
          variant="ghost"
          className={withLabels ? "" : "size-11 md:size-9"}
          aria-label={`Edit user ${u.name}`}
          onClick={(e) => {
            e.stopPropagation();
            openEdit(u);
          }}
        >
          <Pencil className="size-4" />
          {withLabels && <span>Edit</span>}
        </Button>
        <Button
          size={withLabels ? "sm" : "icon"}
          variant="ghost"
          className={cn(
            "text-red-600 hover:bg-red-500/10 hover:text-red-700 dark:text-red-400",
            !withLabels && "size-11 md:size-9"
          )}
          aria-label={
            self
              ? "You cannot delete your own account"
              : lastAdmin
                ? "You cannot delete the only administrator"
                : `Delete user ${u.name}`
          }
          disabled={self || lastAdmin}
          onClick={(e) => {
            e.stopPropagation();
            setDeleteTarget(u);
          }}
        >
          <Trash2 className="size-4" />
          {withLabels && <span>Delete</span>}
        </Button>
      </div>
    );
  };

  /* ---------------------------------- CSV ------------------------------------ */

  const csvColumns: CsvColumn<UserRow>[] = useMemo(
    () => [
      { header: "Name", value: (u) => u.name },
      { header: "Email", value: (u) => u.email },
      { header: "Role", value: (u) => titleCase(u.role) },
      { header: "Status", value: (u) => titleCase(u.status) },
      { header: "Active", value: (u) => (u.isActive ? "Yes" : "No") },
      { header: "Phone", value: (u) => u.phone ?? "" },
      { header: "City", value: (u) => u.city ?? "" },
      { header: "PAN", value: (u) => u.pan ?? "" },
      { header: "Joined", value: (u) => formatDateTime(u.createdAt) },
    ],
    []
  );

  /* ------------------------------- table columns ----------------------------- */

  const columns: DataTableColumn<UserRow>[] = [
    { key: "user", header: "User" },
    { key: "role", header: "Role" },
    { key: "status", header: "Status" },
    { key: "phone", header: "Phone", mono: true, hideBelow: "lg" },
    { key: "city", header: "City", hideBelow: "md" },
    { key: "joined", header: "Joined", hideBelow: "sm" },
    { key: "active", header: "Active" },
    { key: "actions", header: "", align: "right", className: "w-28" },
  ];

  /* --------------------------------- render ---------------------------------- */

  return (
    <div className="space-y-4 sm:space-y-6">
      <PageHeader
        title="Users & Roles"
        description="Manage accounts, roles and access across the trust."
        icon={<Users className="size-5" aria-hidden="true" />}
        actions={
          <Button variant="outline" onClick={() => load()} aria-label="Refresh list">
            <RefreshCw className="size-4" /> <span className="hidden sm:inline">Refresh</span>
          </Button>
        }
      />

      {tempCreds && (
        <TempCredBanner
          creds={tempCreds}
          title="Temporary password created"
          onDismiss={() => setTempCreds(null)}
        />
      )}

      {/* Toolbar */}
      <div className="flex flex-col gap-3 rounded-xl border bg-card p-4 lg:flex-row lg:items-center">
        <div className="relative flex-1">
          <Search
            className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search name, email, phone or city…"
            className="pl-9"
            aria-label="Search users"
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Select value={roleFilter} onValueChange={setRoleFilter}>
            <SelectTrigger className="w-full sm:w-40" aria-label="Filter by role">
              <SelectValue placeholder="All roles" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All roles</SelectItem>
              {ROLES.map((r) => (
                <SelectItem key={r} value={r}>
                  {titleCase(r)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-full sm:w-40" aria-label="Filter by status">
              <SelectValue placeholder="All statuses" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All statuses</SelectItem>
              {STATUSES.map((s) => (
                <SelectItem key={s} value={s}>
                  {titleCase(s)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {hasFilters && (
            <Button variant="ghost" size="sm" onClick={clearFilters} aria-label="Clear filters">
              Clear
            </Button>
          )}
          <ViewSwitcher value={mode} onChange={(m: DataViewMode) => setMode(m)} />
          <ExportMenu
            columns={csvColumns}
            rows={filtered}
            filename="uar-users"
            disabled={filtered.length === 0}
          />
          <Button onClick={() => setCreateOpen(true)} aria-label="Add user">
            <Plus className="size-4" /> Add user
          </Button>
        </div>
        <p className="text-xs text-muted-foreground lg:ml-auto" aria-live="polite">
          {loading ? "Loading…" : `${filtered.length} of ${rows.length} users`}
        </p>
      </div>

      {/* Table view */}
      {mode === "table" ? (
        <DataTable
          columns={columns}
          rows={paged}
          rowKey={(u) => u.id}
          loading={loading}
          skeletonRows={8}
          height="fill"
          fillOffset={300}
          onRowClick={openView}
          page={page}
          pages={pages}
          total={filtered.length}
          pageSize={pageSize}
          onPage={setPage}
          onPageSize={setPageSize}
          itemLabel="users"
          empty={
            <EmptyState
              icon={<Users className="size-6" aria-hidden="true" />}
              title="No users found"
              hint="Adjust the filters or create a new account."
            >
              {hasFilters ? (
                <Button size="sm" variant="outline" onClick={clearFilters}>
                  Clear filters
                </Button>
              ) : (
                <Button size="sm" onClick={() => setCreateOpen(true)}>
                  <Plus className="size-4" /> Add user
                </Button>
              )}
            </EmptyState>
          }
        >
          {(u, col) => {
            switch (col.key) {
              case "user":
                return (
                  <div className="flex items-center gap-2.5">
                    <span
                      className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary"
                      aria-hidden="true"
                    >
                      {initials(u.name)}
                    </span>
                    <div className="min-w-0">
                      <p className="truncate font-medium">
                        {u.name}
                        {isSelf(u) && (
                          <span className="ml-1.5 rounded bg-muted px-1 py-0.5 text-[10px] font-semibold text-muted-foreground">
                            You
                          </span>
                        )}
                      </p>
                      <p className="truncate text-xs text-muted-foreground">{u.email}</p>
                    </div>
                  </div>
                );
              case "role":
                return <RoleBadge role={u.role} />;
              case "status":
                return <StatusBadge status={u.status} />;
              case "phone":
                return <span className="text-sm">{u.phone || "—"}</span>;
              case "city":
                return <span className="text-sm">{u.city || "—"}</span>;
              case "joined":
                return (
                  <span className="whitespace-nowrap text-sm">{formatDate(u.createdAt)}</span>
                );
              case "active":
                return (
                  <div onClick={(e) => e.stopPropagation()}>
                    <Switch
                      checked={u.isActive ?? u.status === "ACTIVE"}
                      onCheckedChange={(v) => void toggleActive(u, v)}
                      disabled={saving}
                      aria-label={
                        u.isActive
                          ? `Disable sign-in for ${u.name}`
                          : `Enable sign-in for ${u.name}`
                      }
                    />
                  </div>
                );
              case "actions":
                return <div onClick={(e) => e.stopPropagation()}>{rowActions(u)}</div>;
              default:
                return null;
            }
          }}
        </DataTable>
      ) : null}

      {/* Grid view */}
      {mode === "grid" ? (
        <div>
          {loading ? (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-40 rounded-xl" />
              ))}
            </div>
          ) : paged.length === 0 ? (
            <EmptyState
              icon={<Users className="size-6" aria-hidden="true" />}
              title="No users found"
              hint="Adjust the filters or create a new account."
            />
          ) : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {paged.map((u) => (
                <article
                  key={u.id}
                  className="card-hover flex cursor-pointer flex-col gap-3 rounded-xl border bg-card p-4"
                  onClick={() => openView(u)}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex min-w-0 items-start gap-2.5">
                      <span
                        className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary"
                        aria-hidden="true"
                      >
                        {initials(u.name)}
                      </span>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold">
                          {u.name}
                          {isSelf(u) && (
                            <span className="ml-1.5 rounded bg-muted px-1 py-0.5 text-[10px] font-semibold text-muted-foreground">
                              You
                            </span>
                          )}
                        </p>
                        <p className="truncate text-xs text-muted-foreground">{u.email}</p>
                      </div>
                    </div>
                    <div onClick={(e) => e.stopPropagation()}>{rowActions(u)}</div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <RoleBadge role={u.role} />
                    <StatusBadge status={u.status} />
                    <div
                      className="ml-auto"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <Switch
                        checked={u.isActive ?? u.status === "ACTIVE"}
                        onCheckedChange={(v) => void toggleActive(u, v)}
                        disabled={saving}
                        aria-label={
                          u.isActive
                            ? `Disable sign-in for ${u.name}`
                            : `Enable sign-in for ${u.name}`
                        }
                      />
                    </div>
                  </div>
                  <p className="mt-auto text-xs text-muted-foreground">
                    {u.city ? `${u.city} · ` : ""}Joined {formatDate(u.createdAt)}
                  </p>
                </article>
              ))}
            </div>
          )}
        </div>
      ) : null}

      {/* List view */}
      {mode === "list" ? (
        <div className="rounded-xl border bg-card p-2">
          {loading ? (
            <div className="space-y-2 p-2">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : paged.length === 0 ? (
            <EmptyState
              icon={<Users className="size-6" aria-hidden="true" />}
              title="No users found"
              hint="Adjust the filters or create a new account."
            />
          ) : (
            <ul
              className="max-h-96 divide-y overflow-y-auto scrollbar-thin"
              aria-label="Users list"
            >
              {paged.map((u) => (
                <li key={u.id}>
                  <div
                    role="button"
                    tabIndex={0}
                    aria-label={`View user ${u.name}`}
                    className="flex w-full cursor-pointer items-center gap-3 rounded-lg px-2 py-2.5 text-left transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    onClick={() => openView(u)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        openView(u);
                      }
                    }}
                  >
                    <span
                      className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary"
                      aria-hidden="true"
                    >
                      {initials(u.name)}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">
                        {u.name}
                        {isSelf(u) && (
                          <span className="ml-1.5 rounded bg-muted px-1 py-0.5 text-[10px] font-semibold text-muted-foreground">
                            You
                          </span>
                        )}
                      </span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {u.email} · {u.city || "—"} · {formatDate(u.createdAt)}
                      </span>
                    </span>
                    <span className="hidden shrink-0 gap-1.5 sm:flex">
                      <RoleBadge role={u.role} />
                      <StatusBadge status={u.status} />
                    </span>
                    <span
                      className="shrink-0"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <Switch
                        checked={u.isActive ?? u.status === "ACTIVE"}
                        onCheckedChange={(v) => void toggleActive(u, v)}
                        disabled={saving}
                        aria-label={
                          u.isActive
                            ? `Disable sign-in for ${u.name}`
                            : `Enable sign-in for ${u.name}`
                        }
                      />
                    </span>
                    <span className="shrink-0" onClick={(e) => e.stopPropagation()}>
                      {rowActions(u)}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}

      {/* Pagination for grid/list modes (table mode paginates inside DataTable) */}
      {mode !== "table" ? (
        <PaginationBar
          page={page}
          pages={pages}
          total={filtered.length}
          onPage={setPage}
          itemLabel="users"
        />
      ) : null}

      {/* ------------------------------ Create sheet ---------------------------- */}
      <FormSheet
        open={createOpen}
        onOpenChange={(o) => {
          if (!o && !saving) setCreateOpen(false);
        }}
        title="Add user"
        description="Creates the account with a temporary password — you'll copy it once, right after saving."
        onSubmit={submitCreate}
        submitLabel="Create user"
        loading={saving}
        dirty={createDirty}
        size="lg"
      >
        <FormSection title="Account" description="Sign-in identity — the user can change the password later.">
          <FieldGrid>
            <TextField
              label="Full name"
              required
              value={createForm.name}
              onChange={(v) => setCreateForm({ ...createForm, name: v })}
              placeholder="e.g. Ananya Rao"
            />
            <TextField
              label="Email"
              required
              inputMode="email"
              value={createForm.email}
              onChange={(v) => setCreateForm({ ...createForm, email: v })}
              placeholder="user@example.org"
            />
            <SelectField
              label="Role"
              required
              value={createForm.role as (typeof ROLES)[number]}
              onChange={(v) => setCreateForm({ ...createForm, role: v })}
              options={ROLES.map((r) => ({ value: r, label: titleCase(r) }))}
            />
          </FieldGrid>
        </FormSection>
        <FormSection title="Profile" description="Optional contact details.">
          <FieldGrid>
            <TextField
              label="Phone"
              inputMode="tel"
              value={createForm.phone}
              onChange={(v) => setCreateForm({ ...createForm, phone: v })}
              placeholder="9876543210"
            />
            <TextField
              label="City"
              value={createForm.city}
              onChange={(v) => setCreateForm({ ...createForm, city: v })}
              placeholder="e.g. Bengaluru"
            />
          </FieldGrid>
          <TextareaField
            label="About"
            value={createForm.about}
            onChange={(v) => setCreateForm({ ...createForm, about: v })}
            placeholder="Short bio or context (optional)"
            rows={2}
          />
        </FormSection>
      </FormSheet>

      {/* ------------------------------- Edit sheet ----------------------------- */}
      <FormSheet
        open={editOpen}
        onOpenChange={(o) => {
          if (!o && !saving) {
            setEditOpen(false);
            setEditTarget(null);
          }
        }}
        title={editTarget ? `Edit user — ${editTarget.name}` : "Edit user"}
        description={editTarget ? `${editTarget.email} · ${titleCase(editTarget.role)}` : ""}
        onSubmit={submitEdit}
        submitLabel="Save changes"
        loading={saving}
        dirty={editDirty}
        size="lg"
      >
        <FormSection title="Profile" description="Identity and contact details.">
          <FieldGrid>
            <TextField
              label="Full name"
              required
              value={editForm.name}
              onChange={(v) => setEditForm({ ...editForm, name: v })}
            />
            <TextField
              label="Email"
              required
              inputMode="email"
              value={editForm.email}
              onChange={(v) => setEditForm({ ...editForm, email: v })}
              hint="Changing the email affects how this user signs in. Duplicates are rejected."
            />
            <TextField
              label="Phone"
              inputMode="tel"
              value={editForm.phone}
              onChange={(v) => setEditForm({ ...editForm, phone: v })}
            />
            <TextField
              label="City"
              value={editForm.city}
              onChange={(v) => setEditForm({ ...editForm, city: v })}
            />
            <TextField
              label="PAN"
              value={editForm.pan}
              onChange={(v) => setEditForm({ ...editForm, pan: v.toUpperCase() })}
              placeholder="ABCDE1234F"
              hint="Optional — used on 80G receipts for this donor."
            />
          </FieldGrid>
          <Field label="Avatar URL" hint="Paste an image URL or choose one from the file library." className="sm:col-span-2">
            <div className="flex gap-2">
              <div className="group relative size-14 shrink-0 overflow-hidden rounded-lg border bg-muted/30">
                {editForm.avatar ? (
                  <img
                    src={editForm.avatar}
                    alt="Avatar preview"
                    loading="lazy"
                    className="size-full object-cover"
                  />
                ) : (
                  <span className="flex size-full items-center justify-center text-muted-foreground">
                    <ImageIcon className="size-5" aria-hidden="true" />
                  </span>
                )}
                {editForm.avatar && (
                  <button
                    type="button"
                    aria-label="Clear avatar"
                    title="Clear"
                    onClick={() => setEditForm({ ...editForm, avatar: "" })}
                    className="absolute right-0 top-0 rounded-full bg-background/80 p-0.5 text-foreground opacity-100 transition hover:bg-background focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:opacity-0 md:group-hover:opacity-100"
                  >
                    <X className="size-3" aria-hidden="true" />
                  </button>
                )}
              </div>
              <Input
                value={editForm.avatar}
                onChange={(e) => setEditForm({ ...editForm, avatar: e.target.value })}
                placeholder="https://… or pick from library"
                aria-label="Avatar URL"
                className="flex-1"
              />
              <FilePickButton
                size="sm"
                variant="outline"
                label="Choose from library"
                accept="image/*"
                folder="avatars"
                className="shrink-0"
                onPicked={(files) => {
                  const f = files[0];
                  if (f) setEditForm({ ...editForm, avatar: fileUrl(f.id) });
                }}
              />
            </div>
          </Field>
          <TextareaField
            label="About"
            value={editForm.about}
            onChange={(v) => setEditForm({ ...editForm, about: v })}
            placeholder="Short bio or context"
            rows={2}
          />
        </FormSection>

        <FormSection title="Access" description="Role, status and sign-in control.">
          <FieldGrid>
            <SelectField
              label="Role"
              required
              value={editForm.role as (typeof ROLES)[number]}
              onChange={(v) => setEditForm({ ...editForm, role: v })}
              options={ROLES.map((r) => ({ value: r, label: titleCase(r) }))}
            />
            <SelectField
              label="Status"
              required
              value={editForm.status as (typeof STATUSES)[number]}
              onChange={(v) => setEditForm({ ...editForm, status: v })}
              options={STATUSES.map((s) => ({ value: s, label: titleCase(s) }))}
              hint="SUSPENDED immediately blocks sign-in for this account."
            />
            <SwitchField
              label="Account active"
              hint="Inactive accounts cannot sign in."
              checked={editForm.isActive}
              onChange={(v) => setEditForm({ ...editForm, isActive: v })}
            />
          </FieldGrid>
        </FormSection>
      </FormSheet>

      <DetailSheet
        open={viewOpen}
        onOpenChange={(o) => {
          if (!o) {
            setViewOpen(false);
            setViewTarget(null);
          }
        }}
        eyebrow="Users & Roles"
        title={viewTarget?.name ?? "User"}
        description={viewTarget ? `${viewTarget.email} · ${titleCase(viewTarget.role)}` : ""}
        status={viewTarget ? <StatusBadge status={viewTarget.status} /> : undefined}
        actions={
          viewTarget ? (
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setViewOpen(false);
                openEdit(viewTarget);
              }}
              aria-label="Edit this user"
            >
              <Pencil className="size-4" /> Edit
            </Button>
          ) : undefined
        }
      >
        {viewTarget ? (
          <Tabs defaultValue="profile" className="gap-5">
            <TabsList className="h-auto w-full flex-wrap justify-start">
              <TabsTrigger value="profile">Profile</TabsTrigger>
              <TabsTrigger value="security">Security</TabsTrigger>
              <TabsTrigger value="activity">Activity</TabsTrigger>
              <TabsTrigger value="related">Related</TabsTrigger>
              <TabsTrigger
                value="danger"
                className="text-red-600 data-[state=active]:text-red-700 dark:text-red-400"
              >
                Danger zone
              </TabsTrigger>
            </TabsList>

            {/* ------------------------------ Profile tab --------------------------- */}
            <TabsContent value="profile" className="space-y-6">
              {viewTarget.status === "SUSPENDED" ? (
                <div
                  className="flex items-start gap-2.5 rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-800 dark:text-amber-300"
                  role="alert"
                >
                  <ShieldAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                  <div>
                    <p className="font-semibold">This account is suspended</p>
                    <p className="mt-0.5 text-xs leading-relaxed">
                      Sign-in is blocked while the status is SUSPENDED. Restore access from the
                      Security tab.
                    </p>
                  </div>
                </div>
              ) : null}

              <DetailSection title="Account" description="Core identity and access fields.">
                <DetailGrid cols={2}>
                  <DataField label="Name" value={viewTarget.name} />
                  <DataField label="Email" value={viewTarget.email} copy />
                  <DataField label="Role" value={<RoleBadge role={viewTarget.role} />} />
                  <DataField label="Status" value={<StatusBadge status={viewTarget.status} />} />
                  <DataField label="Active (sign-in)" value={viewTarget.isActive ? "Yes" : "No"} />
                  <DataField label="User ID" value={viewTarget.id} mono copy />
                </DetailGrid>
              </DetailSection>

              <DetailSection title="Profile" description="Every field held on the account.">
                <DetailGrid cols={2}>
                  <DataField label="Phone" value={viewTarget.phone} copy mono />
                  <DataField label="City" value={viewTarget.city} />
                  <DataField label="PAN" value={viewTarget.pan} mono copy />
                  <DataField
                    label="Avatar"
                    value={viewTarget.avatar ? "Set" : "Not set (initials are shown)"}
                  />
                  <DataField label="About" value={viewTarget.about} className="sm:col-span-2" />
                  <DataField
                    label="Joined"
                    icon={<CalendarClock className="size-3" aria-hidden="true" />}
                    value={formatDateTime(viewTarget.createdAt)}
                  />
                  {viewTarget.updatedAt ? (
                    <DataField label="Last updated" value={formatDateTime(viewTarget.updatedAt)} />
                  ) : null}
                </DetailGrid>
              </DetailSection>

              <DetailSection
                title="Portal access for this role"
                description={`What ${titleCase(viewTarget.role)} accounts can reach. Change the role from the Security tab.`}
                actions={
                  <RoleBadge role={viewTarget.role} />
                }
              >
                <ul className="grid gap-1.5 text-sm sm:grid-cols-2" aria-label="Module access for this role">
                  {ROLE_ACCESS[viewTarget.role]?.map((m) => (
                    <li
                      key={m}
                      className="flex items-center gap-2 rounded-md border bg-muted/30 px-3 py-2"
                    >
                      <Check className="size-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
                      {m}
                    </li>
                  )) ?? null}
                </ul>
                <p className="text-xs text-muted-foreground">
                  Feature availability is role-based. Disable sign-in entirely from the Security
                  tab — per-module toggles live in Settings.
                </p>
              </DetailSection>
            </TabsContent>

            {/* ----------------------------- Security tab -------------------------- */}
            <TabsContent value="security" className="space-y-6">
              <DetailSection
                title="Access controls"
                description="Role, status and sign-in switches — changes apply immediately."
              >
                <div className="grid gap-4 sm:grid-cols-2">
                  <SelectField
                    label="Role"
                    value={secRole as (typeof ROLES)[number]}
                    onChange={(v) => {
                      if (v === viewTarget.role) return;
                      setRoleChange({ target: viewTarget, role: v });
                    }}
                    options={ROLES.map((r) => ({ value: r, label: titleCase(r) }))}
                    hint="Role changes ask for confirmation and update portal access."
                    disabled={saving}
                  />
                  <SelectField
                    label="Status"
                    value={secStatus as (typeof STATUSES)[number]}
                    onChange={(v) => void applyStatus(viewTarget, v)}
                    options={STATUSES.map((s) => ({ value: s, label: titleCase(s) }))}
                    hint="SUSPENDED blocks sign-in; PENDING is used for awaiting-approval volunteers."
                    disabled={saving}
                  />
                  <SwitchField
                    label="Allow sign-in (isActive)"
                    hint="Off = login disabled. The person keeps their data but cannot access any portal."
                    checked={secActive}
                    onChange={(v) => void applyActive(viewTarget, v)}
                    disabled={saving}
                  />
                  <SwitchField
                    label="Suspend account"
                    hint="On = status becomes SUSPENDED (staff-issued block). Off returns the status to ACTIVE."
                    checked={secStatus === "SUSPENDED"}
                    onChange={(v) => void applyStatus(viewTarget, v ? "SUSPENDED" : "ACTIVE")}
                    disabled={saving}
                  />
                </div>
              </DetailSection>

              <DetailSection
                title="Reset password"
                description="Generates a temporary password (Uar@<random>) — shown once, then copy and share it securely."
              >
                {resetCreds && (
                  <TempCredBanner
                    creds={resetCreds}
                    title="Temporary password"
                    onDismiss={() => setResetCreds(null)}
                  />
                )}
                <div className="flex flex-wrap items-center gap-3">
                  <Button
                    variant="outline"
                    onClick={() => void resetPassword(viewTarget)}
                    disabled={saving}
                    aria-label={`Reset password for ${viewTarget.name}`}
                  >
                    <KeyRound className="size-4" aria-hidden="true" /> Reset password
                  </Button>
                  <p className="text-xs text-muted-foreground">
                    The next sign-in uses the temporary password; the user should change it after
                    signing in.
                  </p>
                </div>
              </DetailSection>
            </TabsContent>

            {/* ----------------------------- Activity tab -------------------------- */}
            <TabsContent value="activity" className="space-y-4">
              <DetailSection
                title="Recent activity"
                description="Latest audit-trail entries attributed to this account (newest first)."
              >
                {logsLoading ? (
                  <div className="space-y-2">
                    {Array.from({ length: 5 }).map((_, i) => (
                      <Skeleton key={i} className="h-12 w-full" />
                    ))}
                  </div>
                ) : !viewLogs || viewLogs.length === 0 ? (
                  <EmptyState
                    icon={<ScrollText className="size-6" aria-hidden="true" />}
                    title="No logged activity yet"
                    hint="Actions this user performs in their portal will appear here."
                  />
                ) : (
                  <ul
                    className="flex max-h-96 flex-col divide-y overflow-y-auto scrollbar-thin"
                    aria-label="User activity log"
                  >
                    {viewLogs.map((log) => (
                      <li key={log.id} className="flex items-center gap-3 py-2.5">
                        <span
                          className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"
                          aria-hidden="true"
                        >
                          <ScrollText className="size-4" />
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium">
                            {titleCase(log.action) || log.action}
                          </p>
                          <p className="truncate text-xs text-muted-foreground">
                            {titleCase(log.entityType)}
                            {log.details ? ` · ${log.details}` : ""}
                          </p>
                        </div>
                        <span className="shrink-0 text-xs text-muted-foreground">
                          {timeAgo(log.createdAt)}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </DetailSection>
            </TabsContent>

            {/* ----------------------------- Related tab --------------------------- */}
            <TabsContent value="related" className="space-y-6">
              {viewTarget.role === "DONOR" && (
                <DetailSection
                  title="Donations"
                  description="Gifts matched by this donor's email (latest 100 records)."
                >
                  {relatedLoading ? (
                    <div className="space-y-2">
                      {Array.from({ length: 4 }).map((_, i) => (
                        <Skeleton key={i} className="h-12 w-full" />
                      ))}
                    </div>
                  ) : !relatedDonations || relatedDonations.length === 0 ? (
                    <EmptyState
                      icon={<Link2 className="size-6" aria-hidden="true" />}
                      title="No donations found"
                      hint="Donations carrying this email (or linked user id) will be listed here."
                    />
                  ) : (
                    <>
                      <DetailGrid cols={2}>
                        <DataField
                          label="Completed total"
                          value={formatINR(
                            relatedDonations
                              .filter((d) => d.paymentStatus === "COMPLETED")
                              .reduce((acc, d) => acc + (Number(d.amount) || 0), 0)
                          )}
                        />
                        <DataField label="Records found" value={String(relatedDonations.length)} />
                      </DetailGrid>
                      <ul
                        className="flex max-h-72 flex-col divide-y overflow-y-auto scrollbar-thin"
                        aria-label="Related donations"
                      >
                        {relatedDonations.map((d) => (
                          <li key={d.id} className="flex items-center gap-3 py-2.5">
                            <span
                              className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                              aria-hidden="true"
                            >
                              <Link2 className="size-4" />
                            </span>
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-sm font-medium">
                                {formatINR(Number(d.amount) || 0)} · {titleCase(d.category)}
                              </p>
                              <p className="truncate text-xs text-muted-foreground">
                                {d.receiptNumber ?? "—"}
                                {d.campaign?.title ? ` · ${d.campaign.title}` : ""} ·{" "}
                                {formatDate(d.createdAt)}
                              </p>
                            </div>
                            <StatusBadge status={d.paymentStatus} className="shrink-0" />
                          </li>
                        ))}
                      </ul>
                    </>
                  )}
                </DetailSection>
              )}

              {viewTarget.role === "VOLUNTEER" && (
                <DetailSection
                  title="Volunteer record"
                  description="Linked volunteer profile and assigned tasks."
                >
                  {relatedLoading ? (
                    <div className="space-y-2">
                      <Skeleton className="h-20 w-full" />
                      <Skeleton className="h-24 w-full" />
                    </div>
                  ) : !relatedVolunteer ? (
                    <EmptyState
                      icon={<Link2 className="size-6" aria-hidden="true" />}
                      title="No linked volunteer profile yet"
                      hint="A volunteer profile is created when an admin approves their application."
                    />
                  ) : (
                    <>
                      <DetailGrid cols={2}>
                        <DataField label="Volunteer ID" value={relatedVolunteer.id} mono copy />
                        <DataField
                          label="Status"
                          value={<StatusBadge status={relatedVolunteer.status} />}
                        />
                        <DataField label="Assigned area" value={relatedVolunteer.assignedArea} />
                        <DataField label="Joined" value={formatDate(relatedVolunteer.joinedAt)} />
                      </DetailGrid>
                      <p className="text-xs text-muted-foreground">
                        Manage skills, availability and approvals in{" "}
                        <span className="font-medium text-foreground">Volunteers</span> (People
                        section).
                      </p>
                      {relatedTasks === null ? null : relatedTasks.length === 0 ? (
                        <EmptyState
                          icon={<ClipboardList className="size-6" aria-hidden="true" />}
                          title="No tasks assigned yet"
                          hint="Assign tasks from the Volunteers module."
                        />
                      ) : (
                        <ul
                          className="flex max-h-72 flex-col divide-y overflow-y-auto scrollbar-thin"
                          aria-label="Related volunteer tasks"
                        >
                          {relatedTasks.map((t) => (
                            <li key={t.id} className="flex items-center gap-3 py-2.5">
                              <span
                                className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-teal-500/10 text-teal-600 dark:text-teal-400"
                                aria-hidden="true"
                              >
                                <ClipboardList className="size-4" />
                              </span>
                              <div className="min-w-0 flex-1">
                                <p className="truncate text-sm font-medium">{t.title}</p>
                                <p className="truncate text-xs text-muted-foreground">
                                  {titleCase(t.type)} · {formatDateTime(t.scheduledDate)}
                                </p>
                              </div>
                              <StatusBadge status={t.status} className="shrink-0" />
                            </li>
                          ))}
                        </ul>
                      )}
                    </>
                  )}
                </DetailSection>
              )}

              {viewTarget.role === "BENEFICIARY" && (
                <DetailSection
                  title="Beneficiary case"
                  description="Linked welfare case for this account."
                >
                  {relatedLoading ? (
                    <Skeleton className="h-20 w-full" />
                  ) : !relatedBeneficiary ? (
                    <EmptyState
                      icon={<HandHeart className="size-6" aria-hidden="true" />}
                      title="No linked case yet"
                      hint="Link a beneficiary case from the Beneficiaries module."
                    />
                  ) : (
                    <DetailGrid cols={2}>
                      <DataField label="Case name" value={relatedBeneficiary.name} />
                      <DataField
                        label="Category"
                        value={titleCase(relatedBeneficiary.category)}
                      />
                      <DataField
                        label="Case status"
                        value={
                          <StatusBadge status={relatedBeneficiary.caseStatus ?? "INTAKE"} />
                        }
                      />
                      <DataField label="City" value={relatedBeneficiary.city} />
                    </DetailGrid>
                  )}
                </DetailSection>
              )}

              {viewTarget.role === "ADMIN" && (
                <DetailSection
                  title="Admin account"
                  description="Administrators hold full console access — activity is in the Activity tab."
                >
                  <DetailGrid cols={2}>
                    <DataField
                      label="Logged actions"
                      value={`${viewLogs?.length ?? 0} (latest 30 entries)`}
                    />
                    <DataField label="Role" value={<RoleBadge role={viewTarget.role} />} />
                  </DetailGrid>
                </DetailSection>
              )}
            </TabsContent>

            {/* ---------------------------- Danger zone tab ------------------------ */}
            <TabsContent value="danger">
              <div className="rounded-xl border border-red-500/40 bg-red-500/5 p-5">
                <div className="flex items-start gap-2.5">
                  <TriangleAlert
                    className="mt-0.5 size-4 shrink-0 text-red-600 dark:text-red-400"
                    aria-hidden="true"
                  />
                  <div>
                    <p className="text-sm font-semibold text-red-800 dark:text-red-300">
                      Delete this user
                    </p>
                    <p className="mt-0.5 text-xs leading-relaxed text-red-800/80 dark:text-red-300/80">
                      Permanently removes {viewTarget.name} ({viewTarget.email}). Their donations
                      and audit logs are kept but become unlinked; any volunteer profile is
                      removed. This cannot be undone.
                    </p>
                  </div>
                </div>
                <div className="mt-4 flex flex-wrap items-center gap-3">
                  <Button
                    variant="destructive"
                    disabled={isSelf(viewTarget) || isLastAdmin(viewTarget)}
                    onClick={() => setDeleteTarget(viewTarget)}
                    aria-label={`Delete user ${viewTarget.name}`}
                  >
                    <Trash2 className="size-4" aria-hidden="true" /> Delete user
                  </Button>
                  {isSelf(viewTarget) ? (
                    <p className="text-xs font-medium text-red-700 dark:text-red-400">
                      You cannot delete your own account.
                    </p>
                  ) : isLastAdmin(viewTarget) ? (
                    <p className="text-xs font-medium text-red-700 dark:text-red-400">
                      The only administrator cannot be deleted.
                    </p>
                  ) : null}
                </div>
              </div>
            </TabsContent>
          </Tabs>
        ) : null}
      </DetailSheet>

      {/* ------------------------- Role change confirm -------------------------- */}
      <ConfirmDialog
        open={!!roleChange}
        onOpenChange={(o) => !o && setRoleChange(null)}
        title="Confirm role change"
        confirmLabel="Change role"
        recordName={
          roleChange
            ? `${roleChange.target.name} · ${titleCase(roleChange.target.role)} → ${titleCase(roleChange.role)}`
            : ""
        }
        description={
          roleChange && roleChange.target.id === user?.id
            ? "You are changing your own role — this changes your portal access immediately."
            : "This changes portal access and permissions immediately."
        }
        loading={saving}
        onConfirm={confirmRoleChange}
      />

      {/* ----------------------------- Delete confirm --------------------------- */}
      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
        title="Delete user?"
        confirmLabel="Delete user"
        recordName={deleteTarget ? `${deleteTarget.name} (${deleteTarget.email})` : ""}
        description="The account will be permanently removed. Their donations and logs stay but become unlinked. This cannot be undone."
        loading={saving}
        onConfirm={confirmDelete}
      />
    </div>
  );
}
