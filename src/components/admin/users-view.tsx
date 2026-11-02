"use client";

import { useCallback, useEffect, useState } from "react";
import { KeyRound, Pencil, Plus, Search, Trash2, UserRound } from "lucide-react";
import { toast } from "sonner";
import { del, get, patch, post } from "@/lib/api-client";
import { useAuth } from "@/hooks/use-auth";
import { cn, formatDate, titleCase } from "@/lib/utils";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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

interface UserRow {
  id: string;
  name: string;
  email: string;
  role: string;
  status: string;
  phone?: string | null;
  city?: string | null;
  createdAt: string;
}

const ROLES = ["ADMIN", "VOLUNTEER", "DONOR", "BENEFICIARY"];
const STATUSES = ["ACTIVE", "PENDING", "SUSPENDED"];

function roleBadgeClass(role: string): string {
  switch (role) {
    case "ADMIN":
      return "bg-emerald-100 text-emerald-700";
    case "VOLUNTEER":
      return "bg-teal-100 text-teal-700";
    case "DONOR":
      return "bg-amber-100 text-amber-700";
    case "BENEFICIARY":
      return "bg-fuchsia-100 text-fuchsia-700";
    default:
      return "bg-zinc-100 text-zinc-600";
  }
}

function statusBadgeClass(status: string): string {
  switch (status) {
    case "ACTIVE":
      return "bg-emerald-100 text-emerald-700";
    case "PENDING":
      return "bg-amber-100 text-amber-700";
    case "SUSPENDED":
      return "bg-red-100 text-red-700";
    default:
      return "bg-zinc-100 text-zinc-600";
  }
}

const emptyForm = { name: "", email: "", password: "", role: "DONOR", city: "", phone: "" };

/* ---------------------------------- view ----------------------------------- */

export default function UsersView() {
  const { user } = useAuth();
  const [rows, setRows] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [q, setQ] = useState("");
  const [role, setRole] = useState("ALL");
  const [status, setStatus] = useState("ALL");

  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [editTarget, setEditTarget] = useState<UserRow | null>(null);
  const [editForm, setEditForm] = useState({ role: "DONOR", status: "ACTIVE", phone: "", city: "", password: "" });
  const [deleteTarget, setDeleteTarget] = useState<UserRow | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (q.trim()) params.set("q", q.trim());
      if (role !== "ALL") params.set("role", role);
      if (status !== "ALL") params.set("status", status);
      const data = await get<UserRow[] | { items?: UserRow[] }>(`/api/users?${params.toString()}`);
      setRows(Array.isArray(data) ? data : (data.items ?? []));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load users");
    } finally {
      setLoading(false);
    }
  }, [q, role, status]);

  useEffect(() => {
    const t = setTimeout(load, q ? 400 : 0);
    return () => clearTimeout(t);
  }, [load, q]);

  const createUser = async () => {
    if (!form.name.trim() || !form.email.trim() || !form.password) {
      toast.error("Name, email and password are required");
      return;
    }
    setSaving(true);
    try {
      await post("/api/users", {
        name: form.name.trim(),
        email: form.email.trim(),
        password: form.password,
        role: form.role,
        city: form.city.trim() || undefined,
        phone: form.phone.trim() || undefined,
      });
      toast.success(`User ${form.name.trim()} created`);
      setCreateOpen(false);
      setForm(emptyForm);
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to create user");
    } finally {
      setSaving(false);
    }
  };

  const saveEdit = async () => {
    if (!editTarget) return;
    setSaving(true);
    try {
      const body: Record<string, unknown> = {
        role: editForm.role,
        status: editForm.status,
        phone: editForm.phone.trim() || undefined,
        city: editForm.city.trim() || undefined,
      };
      if (editForm.password) body.password = editForm.password;
      await patch(`/api/users/${editTarget.id}`, body);
      toast.success(`${editTarget.name} updated`);
      setEditTarget(null);
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to update user");
    } finally {
      setSaving(false);
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setSaving(true);
    try {
      await del(`/api/users/${deleteTarget.id}`);
      toast.success("User deleted");
      setDeleteTarget(null);
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to delete user");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name or email…" className="pl-9" aria-label="Search users" />
        </div>
        <div className="flex gap-2">
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
          <Button onClick={() => setCreateOpen(true)} aria-label="Create new user">
            <Plus className="size-4" /> New user
          </Button>
        </div>
      </div>

      {/* Table */}
      <Card className="py-0">
        <CardContent className="p-0">
          {loading ? (
            <div className="space-y-2 p-4">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-11 w-full" />
              ))}
            </div>
          ) : rows.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
              <UserRound className="size-8" aria-hidden="true" />
              <p className="font-medium text-foreground">No users found</p>
              <p>Adjust the filters or create a new user.</p>
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
                  {rows.map((u) => {
                    const self = user?.id === u.id;
                    return (
                      <TableRow key={u.id}>
                        <TableCell>
                          <div className="flex items-center gap-2.5">
                            <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary" aria-hidden="true">
                              {u.name.charAt(0).toUpperCase()}
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
                          <span className={cn("whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold", roleBadgeClass(u.role))}>{titleCase(u.role)}</span>
                        </TableCell>
                        <TableCell>
                          <span className={cn("whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold", statusBadgeClass(u.status))}>{titleCase(u.status)}</span>
                        </TableCell>
                        <TableCell className="hidden md:table-cell">{u.city || "—"}</TableCell>
                        <TableCell className="hidden lg:table-cell">{u.phone || "—"}</TableCell>
                        <TableCell className="hidden whitespace-nowrap text-sm sm:table-cell">{formatDate(u.createdAt)}</TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-1">
                            <Button
                              size="icon"
                              variant="ghost"
                              aria-label={`Edit user ${u.name}`}
                              onClick={() => {
                                setEditTarget(u);
                                setEditForm({ role: u.role, status: u.status, phone: u.phone ?? "", city: u.city ?? "", password: "" });
                              }}
                            >
                              <Pencil className="size-4" />
                            </Button>
                            <Button
                              size="icon"
                              variant="ghost"
                              className="text-red-600 hover:bg-red-50 hover:text-red-700"
                              aria-label={self ? "You cannot delete your own account" : `Delete user ${u.name}`}
                              disabled={self}
                              onClick={() => setDeleteTarget(u)}
                            >
                              <Trash2 className="size-4" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Create dialog */}
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
                <Input id="u-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Full name" />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="u-email">Email *</Label>
                <Input id="u-email" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="user@example.org" />
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor="u-password">Password *</Label>
                <Input id="u-password" type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} placeholder="Min 8 characters" />
              </div>
              <div className="grid gap-2">
                <Label>Role</Label>
                <Select value={form.role} onValueChange={(v) => setForm({ ...form, role: v })}>
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
                <Input id="u-city" value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} placeholder="Bengaluru" />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="u-phone">Phone</Label>
                <Input id="u-phone" type="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="+91…" />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button onClick={createUser} disabled={saving}>{saving ? "Creating…" : "Create user"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit dialog */}
      <Dialog open={!!editTarget} onOpenChange={(o) => !o && setEditTarget(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Edit user</DialogTitle>
            <DialogDescription>{editTarget ? `${editTarget.name} · ${editTarget.email}` : ""}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
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
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor="u-edit-phone">Phone</Label>
                <Input id="u-edit-phone" type="tel" value={editForm.phone} onChange={(e) => setEditForm({ ...editForm, phone: e.target.value })} />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="u-edit-city">City</Label>
                <Input id="u-edit-city" value={editForm.city} onChange={(e) => setEditForm({ ...editForm, city: e.target.value })} />
              </div>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="u-edit-pass">Reset password</Label>
              <div className="relative">
                <KeyRound className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                <Input
                  id="u-edit-pass"
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

      {/* Delete confirm dialog */}
      <Dialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Delete user?</DialogTitle>
            <DialogDescription>
              {deleteTarget ? `${deleteTarget.name} (${deleteTarget.email}) will be permanently removed. This cannot be undone.` : ""}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>Cancel</Button>
            <Button variant="destructive" onClick={confirmDelete} disabled={saving}>{saving ? "Deleting…" : "Delete"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
