"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Eye,
  KeyRound,
  Pencil,
  Plus,
  Search,
  ShieldCheck,
  Trash2,
  Users,
} from "lucide-react";
import { toast } from "sonner";
import { del, get, patch, post } from "@/lib/api-client";
import { useAuth } from "@/hooks/use-auth";
import { cn } from "@/lib/utils";
import { formatDateTime, initials, titleCase } from "@/lib/format";
import { PageHeader } from "@/components/shared/page-header";
import { DataField } from "@/components/shared/data-field";
import { EmptyState } from "@/components/shared/empty-state";
import { SectionCard } from "@/components/shared/section-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
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

const ROLES = ["ADMIN", "VOLUNTEER", "DONOR", "BENEFICIARY"];
const STATUSES = ["ACTIVE", "PENDING", "SUSPENDED"];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function roleTone(role: string): string {
  switch (role) {
    case "ADMIN":
      return "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400";
    case "VOLUNTEER":
      return "bg-teal-500/10 text-teal-700 dark:text-teal-400";
    case "DONOR":
      return "bg-amber-500/10 text-amber-700 dark:text-amber-400";
    case "BENEFICIARY":
      return "bg-fuchsia-500/10 text-fuchsia-700 dark:text-fuchsia-400";
    default:
      return "bg-muted text-muted-foreground";
  }
}

function statusTone(status: string): string {
  switch (status) {
    case "ACTIVE":
      return "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400";
    case "PENDING":
      return "bg-amber-500/10 text-amber-700 dark:text-amber-400";
    case "SUSPENDED":
      return "bg-red-500/10 text-red-700 dark:text-red-400";
    default:
      return "bg-muted text-muted-foreground";
  }
}

const emptyCreateForm = { name: "", email: "", password: "", role: "DONOR", city: "", phone: "" };

const emptyEditForm = {
  name: "",
  phone: "",
  city: "",
  pan: "",
  about: "",
  role: "DONOR",
  status: "ACTIVE",
  isActive: true,
  password: "",
};

/* ---------------------------------- view ----------------------------------- */

export default function UsersView() {
  const { user } = useAuth();
  const [rows, setRows] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [q, setQ] = useState("");
  const [search, setSearch] = useState("");
  const [role, setRole] = useState("ALL");
  const [status, setStatus] = useState("ALL");

  const [createOpen, setCreateOpen] = useState(false);
  const [createForm, setCreateForm] = useState({ ...emptyCreateForm });
  const [editTarget, setEditTarget] = useState<UserRow | null>(null);
  const [editForm, setEditForm] = useState({ ...emptyEditForm });
  const [roleConfirmOpen, setRoleConfirmOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<UserRow | null>(null);
  const [viewTarget, setViewTarget] = useState<UserRow | null>(null);
  const [donorStats, setDonorStats] = useState<{ count: number; sum: number } | null>(null);

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
    const t = setTimeout(() => setSearch(q), 350);
    return () => clearTimeout(t);
  }, [q]);

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return rows.filter((u) => {
      if (role !== "ALL" && u.role !== role) return false;
      if (status !== "ALL" && u.status !== status) return false;
      if (needle && !`${u.name} ${u.email} ${u.phone ?? ""} ${u.city ?? ""}`.toLowerCase().includes(needle)) return false;
      return true;
    });
  }, [rows, search, role, status]);

  /* -------------------------------- actions ------------------------------- */

  const createUser = async () => {
    if (!createForm.name.trim() || !createForm.email.trim() || !createForm.password) {
      toast.error("Name, email and password are required");
      return;
    }
    if (!EMAIL_RE.test(createForm.email.trim())) {
      toast.error("Enter a valid email address");
      return;
    }
    if (createForm.password.length < 8) {
      toast.error("Password must be at least 8 characters");
      return;
    }
    setSaving(true);
    try {
      await post("/api/users", {
        name: createForm.name.trim(),
        email: createForm.email.trim(),
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

  const openEdit = (u: UserRow) => {
    setEditTarget(u);
    setEditForm({
      name: u.name ?? "",
      phone: u.phone ?? "",
      city: u.city ?? "",
      pan: u.pan ?? "",
      about: u.about ?? "",
      role: u.role ?? "DONOR",
      status: u.status ?? "ACTIVE",
      isActive: u.isActive ?? u.status === "ACTIVE",
      password: "",
    });
  };

  const saveEdit = () => {
    if (!editTarget?.id) {
      toast.error("No user selected — close the dialog and try again");
      return;
    }
    if (!editForm.name.trim()) {
      toast.error("Name cannot be empty");
      return;
    }
    if (editForm.password && editForm.password.length < 8) {
      toast.error("Password must be at least 8 characters");
      return;
    }
    if (editForm.role !== editTarget.role) {
      setRoleConfirmOpen(true);
      return;
    }
    doSaveEdit();
  };

  const doSaveEdit = async () => {
    if (!editTarget?.id) return;
    setRoleConfirmOpen(false);
    setSaving(true);
    try {
      await patch(`/api/users/${editTarget.id}`, {
        name: editForm.name.trim(),
        phone: editForm.phone.trim() || null,
        city: editForm.city.trim() || null,
        pan: editForm.pan.trim().toUpperCase() || null,
        about: editForm.about.trim() || null,
        role: editForm.role,
        status: editForm.status,
        isActive: editForm.isActive,
        ...(editForm.password ? { password: editForm.password } : {}),
      });
      toast.success(`${editForm.name.trim()} updated`);
      setEditTarget(null);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to update user");
    } finally {
      setSaving(false);
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    if (deleteTarget.id === user?.id) {
      toast.error("You cannot delete your own account");
      setDeleteTarget(null);
      return;
    }
    setSaving(true);
    try {
      await del(`/api/users/${deleteTarget.id}`);
      toast.success("User deleted");
      setDeleteTarget(null);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to delete user");
    } finally {
      setSaving(false);
    }
  };

  const openView = (u: UserRow) => {
    setViewTarget(u);
    setDonorStats(null);
    if (u.role === "DONOR") {
      get<DonationLite[] | { items?: DonationLite[] }>("/api/donations?limit=500")
        .then((data) => {
          const list = Array.isArray(data) ? data : (data.items ?? []);
          const mine = list.filter((d) => d.donorId === u.id && d.paymentStatus === "COMPLETED");
          setDonorStats({
            count: mine.length,
            sum: mine.reduce((acc, d) => acc + (Number(d.amount) || 0), 0),
          });
        })
        .catch(() => setDonorStats(null));
    }
  };

  const rowActions = (u: UserRow, withLabels = false) => {
    const self = u.id === user?.id;
    return (
      <div className={cn("items-center", withLabels ? "flex flex-wrap gap-2" : "flex justify-end gap-1")}>
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
          className={cn(withLabels ? "text-red-600 hover:bg-red-500/10 hover:text-red-700" : "size-11 md:size-9 text-red-600 hover:bg-red-500/10 hover:text-red-700")}
          aria-label={self ? "You cannot delete your own account" : `Delete user ${u.name}`}
          disabled={self}
          onClick={() => setDeleteTarget(u)}
        >
          <Trash2 className="size-4" />
          {withLabels && <span>Delete</span>}
        </Button>
      </div>
    );
  };

  /* --------------------------------- render -------------------------------- */

  return (
    <div className="space-y-4 sm:space-y-6">
      <PageHeader
        title="Users & Roles"
        description="Manage accounts, roles and access across the trust."
        icon={<Users className="size-5" aria-hidden="true" />}
        actions={
          <Button onClick={() => setCreateOpen(true)} aria-label="Create new user">
            <Plus className="size-4" /> New user
          </Button>
        }
      />

      {/* Filters */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, email, phone or city…" className="pl-9" aria-label="Search users" />
        </div>
        <div className="flex flex-wrap gap-2">
          <Select value={role} onValueChange={setRole}>
            <SelectTrigger className="w-full sm:w-40" aria-label="Filter by role">
              <SelectValue placeholder="All roles" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All roles</SelectItem>
              {ROLES.map((r) => (
                <SelectItem key={r} value={r}>{titleCase(r)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger className="w-full sm:w-40" aria-label="Filter by status">
              <SelectValue placeholder="All statuses" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All statuses</SelectItem>
              {STATUSES.map((s) => (
                <SelectItem key={s} value={s}>{titleCase(s)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <span className="ml-auto self-center text-xs text-muted-foreground" aria-live="polite">
            {loading ? "Loading…" : `${filtered.length} of ${rows.length} users`}
          </span>
        </div>
      </div>

      {/* Desktop table */}
      <div className="hidden rounded-xl border bg-card md:block">
        {loading ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-11 w-full" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="p-6">
            <EmptyState
              icon={<Users className="size-6" aria-hidden="true" />}
              title="No users found"
              hint="Adjust the filters or create a new account."
            >
              <Button size="sm" variant="outline" onClick={() => { setQ(""); setRole("ALL"); setStatus("ALL"); }}>
                Clear filters
              </Button>
            </EmptyState>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>User</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="hidden md:table-cell">City</TableHead>
                  <TableHead className="hidden lg:table-cell">Phone</TableHead>
                  <TableHead className="hidden sm:table-cell">Joined</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((u) => {
                  const self = u.id === user?.id;
                  return (
                    <TableRow key={u.id}>
                      <TableCell>
                        <div className="flex items-center gap-2.5">
                          <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary" aria-hidden="true">
                            {initials(u.name)}
                          </span>
                          <div className="min-w-0">
                            <p className="truncate font-medium">
                              {u.name}
                              {self && <span className="ml-1.5 rounded bg-muted px-1 py-0.5 text-[10px] font-semibold text-muted-foreground">You</span>}
                            </p>
                            <p className="truncate text-xs text-muted-foreground">{u.email}</p>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <span className={cn("whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold", roleTone(u.role))}>{titleCase(u.role)}</span>
                      </TableCell>
                      <TableCell>
                        <span className={cn("whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold", statusTone(u.status))}>{titleCase(u.status)}</span>
                      </TableCell>
                      <TableCell className="hidden md:table-cell">{u.city || "—"}</TableCell>
                      <TableCell className="hidden lg:table-cell">{u.phone || "—"}</TableCell>
                      <TableCell className="hidden whitespace-nowrap text-sm sm:table-cell">{formatDateTime(u.createdAt)}</TableCell>
                      <TableCell className="text-right">{rowActions(u)}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </div>

      {/* Mobile stacked cards */}
      <div className="space-y-3 md:hidden">
        {loading ? (
          Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-32 rounded-xl" />)
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={<Users className="size-6" aria-hidden="true" />}
            title="No users found"
            hint="Adjust the filters or create a new account."
          />
        ) : (
          filtered.map((u) => {
            const self = u.id === user?.id;
            return (
              <article key={u.id} className="space-y-2.5 rounded-xl border bg-card p-4">
                <div className="flex items-start gap-2.5">
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary" aria-hidden="true">
                    {initials(u.name)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">
                      {u.name}
                      {self && <span className="ml-1.5 rounded bg-muted px-1 py-0.5 text-[10px] font-semibold text-muted-foreground">You</span>}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">{u.email}</p>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-semibold", roleTone(u.role))}>{titleCase(u.role)}</span>
                  <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-semibold", statusTone(u.status))}>{titleCase(u.status)}</span>
                  {u.city && <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-semibold text-muted-foreground">{u.city}</span>}
                </div>
                <p className="text-xs text-muted-foreground">Joined {formatDateTime(u.createdAt)}</p>
                <div className="border-t pt-2">{rowActions(u, true)}</div>
              </article>
            );
          })
        )}
      </div>

      {/* ------------------------------ View sheet ---------------------------- */}
      <Sheet open={!!viewTarget} onOpenChange={(o) => !o && setViewTarget(null)}>
        <SheetContent className="flex w-full flex-col gap-0 overflow-y-auto sm:max-w-lg">
          <SheetHeader className="text-left">
            <SheetTitle className="flex items-center gap-2">
              <ShieldCheck className="size-4 text-primary" aria-hidden="true" />
              {viewTarget?.name ?? "User"}
            </SheetTitle>
            <SheetDescription>{viewTarget ? `${viewTarget.email} · ${titleCase(viewTarget.role)}` : ""}</SheetDescription>
          </SheetHeader>
          {viewTarget && (
            <div className="flex-1 space-y-4 px-4 pb-6">
              <SectionCard title="Account" icon={<ShieldCheck className="size-4" aria-hidden="true" />}>
                <div className="grid grid-cols-2 gap-x-4 gap-y-4">
                  <DataField label="Name" value={viewTarget.name} />
                  <DataField label="Email" value={viewTarget.email} copy />
                  <DataField label="Role" value={<span className={cn("rounded-full px-2 py-0.5 text-[11px] font-semibold", roleTone(viewTarget.role))}>{titleCase(viewTarget.role)}</span>} />
                  <DataField label="Status" value={<span className={cn("rounded-full px-2 py-0.5 text-[11px] font-semibold", statusTone(viewTarget.status))}>{titleCase(viewTarget.status)}</span>} />
                  <DataField label="Active" value={viewTarget.isActive ? "Yes" : "No"} />
                  <DataField label="User ID" value={viewTarget.id} mono copy />
                </div>
              </SectionCard>

              <SectionCard title="Profile" icon={<Users className="size-4" aria-hidden="true" />}>
                <div className="grid grid-cols-2 gap-x-4 gap-y-4">
                  <DataField label="Phone" value={viewTarget.phone} copy />
                  <DataField label="City" value={viewTarget.city} />
                  <DataField label="PAN" value={viewTarget.pan} mono copy />
                  <DataField label="Joined" value={formatDateTime(viewTarget.createdAt)} />
                  {viewTarget.updatedAt && <DataField label="Updated" value={formatDateTime(viewTarget.updatedAt)} />}
                </div>
                {viewTarget.about && (
                  <p className="mt-4 whitespace-pre-line rounded-md bg-muted/40 px-3 py-2 text-xs leading-relaxed text-muted-foreground">
                    {viewTarget.about}
                  </p>
                )}
              </SectionCard>

              {viewTarget.role === "DONOR" && (
                <SectionCard title="Giving history" icon={<KeyRound className="size-4" aria-hidden="true" />}>
                  {donorStats === null ? (
                    <Skeleton className="h-12 w-full" />
                  ) : (
                    <div className="grid grid-cols-2 gap-x-4 gap-y-4">
                      <DataField label="Completed donations" value={String(donorStats.count)} />
                      <DataField label="Total given" value={donorStats.count > 0 ? `₹${donorStats.sum.toLocaleString("en-IN")}` : "—"} />
                    </div>
                  )}
                </SectionCard>
              )}

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
          )}
        </SheetContent>
      </Sheet>

      {/* ----------------------------- Create dialog -------------------------- */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Create user</DialogTitle>
            <DialogDescription>Add an admin, volunteer, donor or beneficiary account.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor="u-name">Name *</Label>
                <Input id="u-name" value={createForm.name} onChange={(e) => setCreateForm({ ...createForm, name: e.target.value })} placeholder="Full name" />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="u-email">Email *</Label>
                <Input id="u-email" type="email" value={createForm.email} onChange={(e) => setCreateForm({ ...createForm, email: e.target.value })} placeholder="user@example.org" />
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor="u-password">Password *</Label>
                <Input id="u-password" type="password" value={createForm.password} onChange={(e) => setCreateForm({ ...createForm, password: e.target.value })} placeholder="Min 8 characters" />
              </div>
              <div className="grid gap-2">
                <Label>Role</Label>
                <Select value={createForm.role} onValueChange={(v) => setCreateForm({ ...createForm, role: v })}>
                  <SelectTrigger aria-label="User role"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {ROLES.map((r) => (
                      <SelectItem key={r} value={r}>{titleCase(r)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor="u-city">City</Label>
                <Input id="u-city" value={createForm.city} onChange={(e) => setCreateForm({ ...createForm, city: e.target.value })} placeholder="Bengaluru" />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="u-phone">Phone</Label>
                <Input id="u-phone" type="tel" value={createForm.phone} onChange={(e) => setCreateForm({ ...createForm, phone: e.target.value })} placeholder="+91…" />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button onClick={createUser} disabled={saving}>{saving ? "Creating…" : "Create user"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ------------------------------ Edit dialog --------------------------- */}
      <Dialog open={!!editTarget} onOpenChange={(o) => !o && setEditTarget(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Edit user</DialogTitle>
            <DialogDescription>{editTarget ? `${editTarget.name} · ${editTarget.email}` : ""}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor="ue-name">Name *</Label>
                <Input id="ue-name" value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="ue-phone">Phone</Label>
                <Input id="ue-phone" type="tel" value={editForm.phone} onChange={(e) => setEditForm({ ...editForm, phone: e.target.value })} />
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor="ue-city">City</Label>
                <Input id="ue-city" value={editForm.city} onChange={(e) => setEditForm({ ...editForm, city: e.target.value })} />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="ue-pan">PAN</Label>
                <Input id="ue-pan" value={editForm.pan} onChange={(e) => setEditForm({ ...editForm, pan: e.target.value.toUpperCase() })} className="font-mono uppercase" placeholder="ABCDE1234F" />
              </div>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="ue-about">About</Label>
              <Textarea id="ue-about" value={editForm.about} onChange={(e) => setEditForm({ ...editForm, about: e.target.value })} rows={2} placeholder="Short bio or context" />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label>Role</Label>
                <Select value={editForm.role} onValueChange={(v) => setEditForm({ ...editForm, role: v })}>
                  <SelectTrigger aria-label="User role"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {ROLES.map((r) => (
                      <SelectItem key={r} value={r}>{titleCase(r)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label>Status</Label>
                <Select value={editForm.status} onValueChange={(v) => setEditForm({ ...editForm, status: v })}>
                  <SelectTrigger aria-label="User status"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {STATUSES.map((s) => (
                      <SelectItem key={s} value={s}>{titleCase(s)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="flex items-center justify-between rounded-lg border p-3">
              <div>
                <Label htmlFor="ue-active" className="text-sm">Account active</Label>
                <p className="text-xs text-muted-foreground">Inactive accounts cannot sign in</p>
              </div>
              <Switch id="ue-active" checked={editForm.isActive} onCheckedChange={(v) => setEditForm({ ...editForm, isActive: v })} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="ue-pass">Reset password</Label>
              <div className="relative">
                <KeyRound className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                <Input
                  id="ue-pass"
                  type="password"
                  className="pl-9"
                  value={editForm.password}
                  onChange={(e) => setEditForm({ ...editForm, password: e.target.value })}
                  placeholder="Leave blank to keep current password"
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditTarget(null)}>Cancel</Button>
            <Button onClick={saveEdit} disabled={saving}>{saving ? "Saving…" : "Save changes"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ---------------------- Role change confirm --------------------------- */}
      <AlertDialog open={roleConfirmOpen} onOpenChange={setRoleConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirm role change</AlertDialogTitle>
            <AlertDialogDescription>
              {editTarget
                ? `You are changing ${editTarget.name}'s role from ${titleCase(editTarget.role)} to ${titleCase(editForm.role)}. This changes portal access and permissions immediately.`
                : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                doSaveEdit();
              }}
            >
              {saving ? "Saving…" : "Change role"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ---------------------------- Delete confirm -------------------------- */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete user?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget
                ? `${deleteTarget.name} (${deleteTarget.email}) will be permanently removed. Their donations and logs stay but become unlinked. This cannot be undone.`
                : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={(e) => {
                e.preventDefault();
                confirmDelete();
              }}
            >
              {saving ? "Deleting…" : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
