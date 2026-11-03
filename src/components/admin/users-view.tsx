"use client";

/**
 * Users & Roles — admin directory with inline role management.
 * Table/grid/list views, add/edit FormSheets, donor stats, linked
 * volunteer/beneficiary summary and security block on the detail sheet.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CalendarClock,
  Eye,
  HeartHandshake,
  KeyRound,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Trash2,
  UserRound,
  Users,
} from "lucide-react";
import { toast } from "sonner";
import { del, get, patch, post } from "@/lib/api-client";
import { useAuth } from "@/hooks/use-auth";
import { formatDateTime, initials, titleCase } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  emailRule,
  minLen,
  panRule,
  phoneRule,
  required,
} from "@/lib/validators";
import { PageHeader } from "@/components/shared/page-header";
import { DataField } from "@/components/shared/data-field";
import { EmptyState } from "@/components/shared/empty-state";
import { SectionCard } from "@/components/shared/section-card";
import { FormSheet } from "@/components/shared/form-sheet";
import {
  FieldGrid,
  FormSection,
  SelectField,
  SwitchField,
  TextField,
  TextareaField,
} from "@/components/shared/form-fields";
import { StatusBadge } from "@/components/shared/status-badge";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { ExportMenu, type CsvColumn } from "@/components/shared/csv";
import {
  PageSizeSelect,
  PaginationBar,
  ViewSwitcher,
  useViewPref,
  type DataViewMode,
} from "@/components/shared/view-switcher";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
  createdAt: string;
  updatedAt?: string;
}

interface DonationLite {
  id: string;
  donorId?: string | null;
  amount: number;
  paymentStatus: string;
}

interface VolunteerLite {
  id: string;
  userId: string;
  status: string;
  assignedArea?: string | null;
  joinedAt: string;
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

/* --------------------------------- form state ------------------------------- */

interface CreateForm {
  name: string;
  email: string;
  password: string;
  role: string;
  city: string;
  phone: string;
}

interface EditForm {
  name: string;
  email: string;
  phone: string;
  city: string;
  pan: string;
  about: string;
  role: string;
  status: string;
  isActive: boolean;
  password: string;
}

const emptyCreateForm: CreateForm = {
  name: "",
  email: "",
  password: "",
  role: "DONOR",
  city: "",
  phone: "",
};

const emptyEditForm: EditForm = {
  name: "",
  email: "",
  phone: "",
  city: "",
  pan: "",
  about: "",
  role: "DONOR",
  status: "ACTIVE",
  isActive: true,
  password: "",
};

function formFromRow(u: UserRow): EditForm {
  return {
    name: u.name ?? "",
    email: u.email ?? "",
    phone: u.phone ?? "",
    city: u.city ?? "",
    pan: u.pan ?? "",
    about: u.about ?? "",
    role: u.role ?? "DONOR",
    status: u.status ?? "ACTIVE",
    isActive: u.isActive ?? u.status === "ACTIVE",
    password: "",
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

  // inline role change confirm (table cell select)
  const [roleChange, setRoleChange] = useState<{ target: UserRow; role: string } | null>(null);

  // delete
  const [deleteTarget, setDeleteTarget] = useState<UserRow | null>(null);

  // detail sheet + linked data
  const [viewTarget, setViewTarget] = useState<UserRow | null>(null);
  const [donorStats, setDonorStats] = useState<
    { count: number; sum: number } | "unavailable" | null
  >(null);
  const [linkedVolunteer, setLinkedVolunteer] = useState<VolunteerLite | null>(null);
  const [linkedBeneficiary, setLinkedBeneficiary] = useState<BeneficiaryLite | null>(null);

  const adminCount = useMemo(() => rows.filter((r) => r.role === "ADMIN").length, [rows]);

  /* -------------------------------- loading -------------------------------- */

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await get<UserRow[] | { items?: UserRow[] }>("/api/users?limit=500");
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

  /* -------------------------------- create ---------------------------------- */

  const submitCreate = async () => {
    const errors: string[] = [];
    const nameErr = required("Name")(createForm.name);
    if (nameErr) errors.push(nameErr);
    const emailErr = emailRule()(createForm.email);
    if (emailErr) errors.push(emailErr);
    const passErr = minLen(6, "Password")(createForm.password);
    if (passErr) errors.push(passErr);
    if (errors.length) {
      toast.error(errors[0]);
      return;
    }
    setSaving(true);
    try {
      await post("/api/users", {
        name: createForm.name.trim(),
        email: createForm.email.trim().toLowerCase(),
        password: createForm.password,
        role: createForm.role,
        city: createForm.city.trim() || undefined,
        phone: createForm.phone.trim() || undefined,
      });
      toast.success(`User ${createForm.name.trim()} created`);
      setCreateOpen(false);
      setCreateForm({ ...emptyCreateForm });
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
        role: editForm.role,
        status: editForm.status,
        isActive: editForm.isActive,
        ...(editForm.password ? { password: editForm.password } : {}),
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

  const submitEdit = () => {
    if (!editTarget) return;
    const errors: string[] = [];
    const nameErr = required("Name")(editForm.name);
    if (nameErr) errors.push(nameErr);
    const emailErr = emailRule()(editForm.email);
    if (emailErr) errors.push(emailErr);
    const panErr = panRule(true)(editForm.pan);
    if (panErr) errors.push(panErr);
    const phoneErr = phoneRule(true)(editForm.phone);
    if (phoneErr) errors.push(phoneErr);
    if (editForm.password) {
      const passErr = minLen(6, "New password")(editForm.password);
      if (passErr) errors.push(passErr);
    }
    if (errors.length) {
      toast.error(errors[0]);
      return;
    }
    if (editForm.role !== editTarget.role) {
      // confirm via the shared role-change dialog
      setRoleChange({ target: editTarget, role: editForm.role });
      return;
    }
    void doSaveEdit();
  };

  /* ---------------------------- inline role change --------------------------- */

  const confirmRoleChange = async () => {
    if (!roleChange) return;
    const { target, role } = roleChange;
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

  /* --------------------------------- delete ---------------------------------- */

  const isSelf = (u: UserRow) => u.id === user?.id;
  const isLastAdmin = (u: UserRow) => u.role === "ADMIN" && adminCount <= 1;

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    if (isSelf(deleteTarget)) {
      toast.error("You cannot delete your own account");
      setDeleteTarget(null);
      return;
    }
    if (isLastAdmin(deleteTarget)) {
      toast.error("You cannot delete the only administrator account");
      setDeleteTarget(null);
      return;
    }
    setSaving(true);
    try {
      await del(`/api/users/${deleteTarget.id}`);
      toast.success("User deleted");
      setDeleteTarget(null);
      setViewTarget((v) => (v && v.id === deleteTarget.id ? null : v));
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to delete user");
    } finally {
      setSaving(false);
    }
  };

  /* ------------------------------ detail sheet ------------------------------- */

  const openView = (u: UserRow) => {
    setViewTarget(u);
    setDonorStats(null);
    setLinkedVolunteer(null);
    setLinkedBeneficiary(null);

    if (u.role === "DONOR") {
      // Aggregation is capped at the latest 500 donations (API limit) — close
      // enough for a summary badge, not an audited statement.
      get<DonationLite[] | { items?: DonationLite[] }>("/api/donations?limit=500")
        .then((data) => {
          const list = Array.isArray(data) ? data : (data.items ?? []);
          const mine = list.filter(
            (d) => d.donorId === u.id && d.paymentStatus === "COMPLETED"
          );
          setDonorStats({
            count: mine.length,
            sum: mine.reduce((acc, d) => acc + (Number(d.amount) || 0), 0),
          });
        })
        .catch(() => setDonorStats("unavailable"));
    }

    if (u.role === "VOLUNTEER") {
      get<VolunteerLite[]>("/api/volunteers")
        .then((list) => {
          const v = Array.isArray(list) ? list.find((x) => x.userId === u.id) : undefined;
          setLinkedVolunteer(v ?? null);
        })
        .catch(() => setLinkedVolunteer(null));
    }

    if (u.role === "BENEFICIARY") {
      get<BeneficiaryLite[]>("/api/beneficiaries")
        .then((list) => {
          const b = Array.isArray(list) ? list.find((x) => x.userId === u.id) : undefined;
          setLinkedBeneficiary(b ?? null);
        })
        .catch(() => setLinkedBeneficiary(null));
    }
  };

  /* --------------------------------- actions UI ------------------------------ */

  const inlineRoleSelect = (u: UserRow) => (
    <Select
      value={u.role}
      onValueChange={(v) => {
        if (v === u.role) return;
        setRoleChange({ target: u, role: v });
      }}
    >
      <SelectTrigger
        className="h-8 w-36 text-xs"
        aria-label={`Change role for ${u.name}`}
        onClick={(e) => e.stopPropagation()}
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent onClick={(e) => e.stopPropagation()}>
        {ROLES.map((r) => (
          <SelectItem key={r} value={r}>
            {titleCase(r)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );

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
          onClick={() => openView(u)}
        >
          <Eye className="size-4" />
          {withLabels && <span>View</span>}
        </Button>
        <Button
          size={withLabels ? "sm" : "icon"}
          variant="ghost"
          className={withLabels ? "" : "size-11 md:size-9"}
          aria-label={`Edit user ${u.name}`}
          onClick={() => openEdit(u)}
        >
          <Pencil className="size-4" />
          {withLabels && <span>Edit</span>}
        </Button>
        <Button
          size={withLabels ? "sm" : "icon"}
          variant="ghost"
          className={cn(
            "text-red-600 hover:bg-red-500/10 hover:text-red-700",
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
          onClick={() => setDeleteTarget(u)}
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

  /* --------------------------------- render ---------------------------------- */

  return (
    <div className="space-y-4 sm:space-y-6">
      <PageHeader
        title="Users & Roles"
        description="Manage accounts, roles and access across the trust."
        icon={<Users className="size-5" aria-hidden="true" />}
        actions={
          <>
            <Button variant="outline" onClick={() => load()} aria-label="Refresh list">
              <RefreshCw className="size-4" /> <span className="hidden sm:inline">Refresh</span>
            </Button>
            <Button onClick={() => setCreateOpen(true)} aria-label="Create new user">
              <Plus className="size-4" /> New user
            </Button>
          </>
        }
      />

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
          <ViewSwitcher value={mode} onChange={(m: DataViewMode) => setMode(m)} />
          <ExportMenu
            columns={csvColumns}
            rows={filtered}
            filename="uar-users"
            disabled={filtered.length === 0}
          />
        </div>
        <p className="text-xs text-muted-foreground lg:ml-auto" aria-live="polite">
          {loading ? "Loading…" : `${filtered.length} of ${rows.length} users`}
        </p>
      </div>

      {/* Table view */}
      {mode === "table" ? (
        <div className="rounded-xl border bg-card">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>User</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="hidden md:table-cell">City</TableHead>
                  <TableHead className="hidden lg:table-cell">Phone</TableHead>
                  <TableHead className="hidden sm:table-cell">PAN</TableHead>
                  <TableHead className="hidden sm:table-cell">Joined</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading
                  ? Array.from({ length: 6 }).map((_, i) => (
                      <TableRow key={i}>
                        {Array.from({ length: 8 }).map((__, j) => (
                          <TableCell key={j}>
                            <Skeleton className="h-5 w-full" />
                          </TableCell>
                        ))}
                      </TableRow>
                    ))
                  : paged.map((u) => {
                      const self = isSelf(u);
                      return (
                        <TableRow
                          key={u.id}
                          className="cursor-pointer"
                          onClick={() => openView(u)}
                        >
                          <TableCell>
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
                                  {self && (
                                    <span className="ml-1.5 rounded bg-muted px-1 py-0.5 text-[10px] font-semibold text-muted-foreground">
                                      You
                                    </span>
                                  )}
                                </p>
                                <p className="truncate text-xs text-muted-foreground">{u.email}</p>
                              </div>
                            </div>
                          </TableCell>
                          <TableCell onClick={(e) => e.stopPropagation()}>
                            {inlineRoleSelect(u)}
                          </TableCell>
                          <TableCell>
                            <StatusBadge status={u.status} />
                          </TableCell>
                          <TableCell className="hidden text-sm md:table-cell">
                            {u.city || "—"}
                          </TableCell>
                          <TableCell className="hidden text-sm lg:table-cell">
                            {u.phone || "—"}
                          </TableCell>
                          <TableCell className="hidden font-mono text-xs sm:table-cell">
                            {u.pan || "—"}
                          </TableCell>
                          <TableCell className="hidden whitespace-nowrap text-sm sm:table-cell">
                            {formatDateTime(u.createdAt)}
                          </TableCell>
                          <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                            {rowActions(u)}
                          </TableCell>
                        </TableRow>
                      );
                    })}
              </TableBody>
            </Table>
          </div>
          {!loading && paged.length === 0 ? (
            <div className="p-6">
              <EmptyState
                icon={<Users className="size-6" aria-hidden="true" />}
                title="No users found"
                hint="Adjust the filters or create a new account."
              >
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setQ("");
                    setRoleFilter("ALL");
                    setStatusFilter("ALL");
                  }}
                >
                  Clear filters
                </Button>
              </EmptyState>
            </div>
          ) : null}
        </div>
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
              {paged.map((u) => {
                const self = isSelf(u);
                return (
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
                            {self && (
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
                      {inlineRoleSelect(u)}
                      <StatusBadge status={u.status} />
                    </div>
                    <p className="mt-auto text-xs text-muted-foreground">
                      {u.city ? `${u.city} · ` : ""}Joined {formatDateTime(u.createdAt)}
                    </p>
                  </article>
                );
              })}
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
              {paged.map((u) => {
                const self = isSelf(u);
                return (
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
                          {self && (
                            <span className="ml-1.5 rounded bg-muted px-1 py-0.5 text-[10px] font-semibold text-muted-foreground">
                              You
                            </span>
                          )}
                        </span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {u.email} · {titleCase(u.role)} · {u.city || "—"}
                        </span>
                      </span>
                      <span className="hidden shrink-0 sm:block">
                        <StatusBadge status={u.status} />
                      </span>
                      <span className="shrink-0" onClick={(e) => e.stopPropagation()}>
                        {rowActions(u)}
                      </span>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      ) : null}

      {/* Pagination */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <PaginationBar
          page={page}
          pages={pages}
          total={filtered.length}
          onPage={setPage}
          itemLabel="users"
        />
        <PageSizeSelect value={pageSize} onChange={setPageSize} />
      </div>

      {/* ------------------------------ Create sheet ---------------------------- */}
      <FormSheet
        open={createOpen}
        onOpenChange={setCreateOpen}
        title="Create user"
        description="Add an admin, volunteer, donor or beneficiary account."
        onSubmit={submitCreate}
        submitLabel="Create user"
        loading={saving}
        size="md"
        dirty={
          JSON.stringify(createForm) !== JSON.stringify(emptyCreateForm)
        }
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
            <TextField
              label="Password"
              required
              type="password"
              value={createForm.password}
              onChange={(v) => setCreateForm({ ...createForm, password: v })}
              placeholder="Min 6 characters"
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
              label="City"
              value={createForm.city}
              onChange={(v) => setCreateForm({ ...createForm, city: v })}
              placeholder="e.g. Bengaluru"
            />
            <TextField
              label="Phone"
              inputMode="tel"
              value={createForm.phone}
              onChange={(v) => setCreateForm({ ...createForm, phone: v })}
              placeholder="9876543210"
            />
          </FieldGrid>
        </FormSection>
      </FormSheet>

      {/* ------------------------------- Edit sheet ----------------------------- */}
      <FormSheet
        open={editOpen}
        onOpenChange={(o) => {
          setEditOpen(o);
          if (!o) setEditTarget(null);
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
              hint="Changing the email affects how this user signs in."
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
              hint="Used on 80G receipts for this donor."
            />
          </FieldGrid>
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
            />
            <SwitchField
              label="Account active"
              hint="Inactive accounts cannot sign in."
              checked={editForm.isActive}
              onChange={(v) => setEditForm({ ...editForm, isActive: v })}
            />
            <TextField
              label="New password"
              type="password"
              value={editForm.password}
              onChange={(v) => setEditForm({ ...editForm, password: v })}
              placeholder="Leave blank to keep current password"
              hint="Minimum 6 characters if set."
            />
          </FieldGrid>
        </FormSection>
      </FormSheet>

      {/* ------------------------------ Detail sheet ----------------------------- */}
      <Sheet open={!!viewTarget} onOpenChange={(o) => !o && setViewTarget(null)}>
        <SheetContent className="flex w-full flex-col gap-0 overflow-y-auto sm:max-w-xl">
          <SheetHeader className="text-left">
            <SheetTitle className="flex items-center gap-2">
              <ShieldCheck className="size-4 text-primary" aria-hidden="true" />
              {viewTarget?.name ?? "User"}
            </SheetTitle>
            <SheetDescription>
              {viewTarget ? `${viewTarget.email} · ${titleCase(viewTarget.role)}` : ""}
            </SheetDescription>
          </SheetHeader>
          {viewTarget ? (
            <div className="flex-1 space-y-4 px-4 pb-6">
              <SectionCard title="Account" icon={<ShieldCheck className="size-4" aria-hidden="true" />}>
                <div className="grid grid-cols-1 gap-x-4 gap-y-4 sm:grid-cols-2">
                  <DataField label="Name" value={viewTarget.name} />
                  <DataField label="Email" value={viewTarget.email} copy />
                  <DataField label="Role" value={titleCase(viewTarget.role)} />
                  <DataField
                    label="Status"
                    value={<StatusBadge status={viewTarget.status} />}
                  />
                  <DataField label="Active" value={viewTarget.isActive ? "Yes" : "No"} />
                  <DataField label="User ID" value={viewTarget.id} mono copy />
                </div>
              </SectionCard>

              <SectionCard title="Profile" icon={<UserRound className="size-4" aria-hidden="true" />}>
                <div className="grid grid-cols-1 gap-x-4 gap-y-4 sm:grid-cols-2">
                  <DataField label="Phone" value={viewTarget.phone} copy />
                  <DataField label="City" value={viewTarget.city} />
                  <DataField label="PAN" value={viewTarget.pan} mono copy />
                  <DataField label="Joined" value={formatDateTime(viewTarget.createdAt)} />
                  {viewTarget.updatedAt ? (
                    <DataField label="Updated" value={formatDateTime(viewTarget.updatedAt)} />
                  ) : null}
                </div>
                {viewTarget.about ? (
                  <p className="mt-4 whitespace-pre-line rounded-md bg-muted/40 px-3 py-2 text-xs leading-relaxed text-muted-foreground">
                    {viewTarget.about}
                  </p>
                ) : null}
              </SectionCard>

              {viewTarget.role === "DONOR" ? (
                <SectionCard
                  title="Giving history"
                  icon={<HeartHandshake className="size-4" aria-hidden="true" />}
                  description="Completed donations linked to this account (latest 500 records)."
                >
                  {donorStats === null ? (
                    <Skeleton className="h-12 w-full" />
                  ) : donorStats === "unavailable" ? (
                    <p className="text-sm text-muted-foreground">
                      Donation stats are unavailable right now — try again later.
                    </p>
                  ) : (
                    <div className="grid grid-cols-1 gap-x-4 gap-y-4 sm:grid-cols-2">
                      <DataField label="Completed donations" value={String(donorStats.count)} />
                      <DataField
                        label="Total given"
                        value={
                          donorStats.count > 0
                            ? `₹${donorStats.sum.toLocaleString("en-IN")}`
                            : ""
                        }
                      />
                    </div>
                  )}
                </SectionCard>
              ) : null}

              {viewTarget.role === "VOLUNTEER" ? (
                <SectionCard
                  title="Volunteer record"
                  icon={<UserRound className="size-4" aria-hidden="true" />}
                >
                  {linkedVolunteer === null ? (
                    <p className="text-sm text-muted-foreground">No linked volunteer profile yet.</p>
                  ) : (
                    <div className="grid grid-cols-1 gap-x-4 gap-y-4 sm:grid-cols-2">
                      <DataField label="Volunteer ID" value={linkedVolunteer.id} mono copy />
                      <DataField label="Status" value={<StatusBadge status={linkedVolunteer.status} />} />
                      <DataField label="Assigned area" value={linkedVolunteer.assignedArea} />
                      <DataField label="Joined" value={formatDateTime(linkedVolunteer.joinedAt)} />
                    </div>
                  )}
                </SectionCard>
              ) : null}

              {viewTarget.role === "BENEFICIARY" ? (
                <SectionCard
                  title="Linked case"
                  icon={<HeartHandshake className="size-4" aria-hidden="true" />}
                >
                  {linkedBeneficiary === null ? (
                    <p className="text-sm text-muted-foreground">No linked beneficiary case yet.</p>
                  ) : (
                    <div className="grid grid-cols-1 gap-x-4 gap-y-4 sm:grid-cols-2">
                      <DataField label="Case name" value={linkedBeneficiary.name} />
                      <DataField label="Category" value={titleCase(linkedBeneficiary.category)} />
                      <DataField
                        label="Case status"
                        value={<StatusBadge status={linkedBeneficiary.caseStatus ?? "INTAKE"} />}
                      />
                      <DataField label="City" value={linkedBeneficiary.city} />
                    </div>
                  )}
                </SectionCard>
              ) : null}

              <SectionCard
                title="Security"
                icon={<KeyRound className="size-4" aria-hidden="true" />}
              >
                <div className="grid grid-cols-1 gap-x-4 gap-y-4 sm:grid-cols-2">
                  <DataField label="Last login" value="Not tracked" />
                  <DataField
                    label="Account created"
                    icon={<CalendarClock className="size-3.5" aria-hidden="true" />}
                    value={formatDateTime(viewTarget.createdAt)}
                  />
                </div>
                <p className="mt-3 text-xs text-muted-foreground">
                  Login timestamps are not recorded — account creation is shown as the
                  security anchor.
                </p>
              </SectionCard>

              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setViewTarget(null);
                    openEdit(viewTarget);
                  }}
                  aria-label="Edit this user"
                >
                  <Pencil className="size-4" /> Edit user
                </Button>
              </div>
            </div>
          ) : null}
        </SheetContent>
      </Sheet>

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
