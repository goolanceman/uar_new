"use client";

import { useCallback, useEffect, useState } from "react";
import { Download, Pencil, Plus, ReceiptText, Search, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { del, get, patch, post } from "@/lib/api-client";
import { cn, formatINR, formatDate, titleCase } from "@/lib/utils";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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

interface DonationRow {
  id: string;
  receiptNumber: string;
  donorName: string;
  donorEmail: string;
  amount: number;
  type: string;
  paymentMethod: string;
  paymentStatus: string;
  createdAt: string;
  message?: string | null;
  campaignId?: string | null;
  campaign?: { id: string; title: string } | null;
}

interface CampaignLite {
  id: string;
  title: string;
}

const PAYMENT_STATUSES = ["PENDING", "COMPLETED", "FAILED", "REFUNDED"];
const DONATION_TYPES = ["ONE_TIME", "RECURRING"];
const PAYMENT_METHODS = ["UPI", "RAZORPAY", "STRIPE", "CASH", "BANK_TRANSFER"];

function statusBadgeClass(status: string): string {
  switch (status) {
    case "COMPLETED":
      return "bg-emerald-100 text-emerald-700";
    case "PENDING":
      return "bg-amber-100 text-amber-700";
    case "FAILED":
      return "bg-red-100 text-red-700";
    case "REFUNDED":
      return "bg-zinc-100 text-zinc-600";
    default:
      return "bg-zinc-100 text-zinc-600";
  }
}

function downloadCsv(filename: string, rows: (string | number)[][]) {
  const csv = rows
    .map((r) => r.map((c) => `"${String(c ?? "").replace(/"/g, '""')}"`).join(","))
    .join("\n");
  const blob = new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/* ---------------------------------- view ----------------------------------- */

const emptyForm = {
  donorName: "",
  donorEmail: "",
  amount: "",
  campaignId: "",
  type: "ONE_TIME",
  paymentMethod: "UPI",
  message: "",
};

export default function DonationsView() {
  const [rows, setRows] = useState<DonationRow[]>([]);
  const [campaigns, setCampaigns] = useState<CampaignLite[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("ALL");
  const [saving, setSaving] = useState(false);

  // dialogs
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [editTarget, setEditTarget] = useState<DonationRow | null>(null);
  const [editAmount, setEditAmount] = useState("");
  const [editStatus, setEditStatus] = useState("PENDING");
  const [deleteTarget, setDeleteTarget] = useState<DonationRow | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit: "200" });
      if (q.trim()) params.set("q", q.trim());
      if (status !== "ALL") params.set("status", status);
      const data = await get<DonationRow[] | { items?: DonationRow[] }>(`/api/donations?${params.toString()}`);
      setRows(Array.isArray(data) ? data : (data.items ?? []));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load donations");
    } finally {
      setLoading(false);
    }
  }, [q, status]);

  useEffect(() => {
    const t = setTimeout(load, q ? 400 : 0);
    return () => clearTimeout(t);
  }, [load, q]);

  useEffect(() => {
    get<CampaignLite[] | { items?: CampaignLite[] }>("/api/campaigns")
      .then((d) => setCampaigns(Array.isArray(d) ? d : (d.items ?? [])))
      .catch(() => setCampaigns([]));
  }, []);

  const campaignTitle = (d: DonationRow) => d.campaign?.title ?? campaigns.find((c) => c.id === d.campaignId)?.title ?? "General";

  const exportCsv = () => {
    const out: (string | number)[][] = [
      ["Receipt", "Donor", "Email", "Campaign", "Amount", "Type", "Payment Method", "Payment Status", "Date"],
      ...rows.map((d) => [
        d.receiptNumber,
        d.donorName,
        d.donorEmail,
        campaignTitle(d),
        d.amount,
        d.type,
        d.paymentMethod,
        d.paymentStatus,
        formatDate(d.createdAt),
      ]),
    ];
    downloadCsv(`uar-donations-${new Date().toISOString().slice(0, 10)}.csv`, out);
    toast.success(`Exported ${rows.length} donation${rows.length === 1 ? "" : "s"} to CSV`);
  };

  const createDonation = async () => {
    if (!form.donorName.trim() || !form.donorEmail.trim() || !Number(form.amount)) {
      toast.error("Donor name, email and a valid amount are required");
      return;
    }
    setSaving(true);
    try {
      await post("/api/donations", {
        donorName: form.donorName.trim(),
        donorEmail: form.donorEmail.trim(),
        amount: Number(form.amount),
        type: form.type,
        paymentMethod: form.paymentMethod,
        campaignId: form.campaignId || undefined,
        message: form.message.trim() || undefined,
      });
      toast.success("Donation recorded");
      setCreateOpen(false);
      setForm(emptyForm);
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to record donation");
    } finally {
      setSaving(false);
    }
  };

  const saveEdit = async () => {
    if (!editTarget) return;
    setSaving(true);
    try {
      const body: Record<string, unknown> = { paymentStatus: editStatus };
      if (Number(editAmount) > 0) body.amount = Number(editAmount);
      await patch(`/api/donations/${editTarget.id}`, body);
      toast.success(`Receipt ${editTarget.receiptNumber} updated`);
      setEditTarget(null);
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to update donation");
    } finally {
      setSaving(false);
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setSaving(true);
    try {
      await del(`/api/donations/${deleteTarget.id}`);
      toast.success("Donation deleted");
      setDeleteTarget(null);
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to delete donation");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search donor, email or receipt…"
            className="pl-9"
            aria-label="Search donations"
          />
        </div>
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="w-full sm:w-44" aria-label="Filter by payment status">
            <SelectValue placeholder="All statuses" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All statuses</SelectItem>
            {PAYMENT_STATUSES.map((s) => (
              <SelectItem key={s} value={s}>{titleCase(s)}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="flex gap-2">
          <Button variant="outline" onClick={exportCsv} disabled={rows.length === 0} aria-label="Export donations to CSV">
            <Download className="size-4" /> CSV
          </Button>
          <Button onClick={() => setCreateOpen(true)} aria-label="Record new donation">
            <Plus className="size-4" /> Record donation
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
              <ReceiptText className="size-8" aria-hidden="true" />
              <p className="font-medium text-foreground">No donations found</p>
              <p>Try a different search or record your first donation.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Receipt</TableHead>
                    <TableHead>Donor</TableHead>
                    <TableHead className="hidden md:table-cell">Campaign</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead className="hidden lg:table-cell">Method</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="hidden sm:table-cell">Date</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((d) => (
                    <TableRow key={d.id}>
                      <TableCell className="whitespace-nowrap font-mono text-xs">{d.receiptNumber}</TableCell>
                      <TableCell>
                        <p className="font-medium">{d.donorName}</p>
                        <p className="text-xs text-muted-foreground">{d.donorEmail}</p>
                      </TableCell>
                      <TableCell className="hidden max-w-40 truncate md:table-cell">{campaignTitle(d)}</TableCell>
                      <TableCell className="whitespace-nowrap text-right font-semibold">{formatINR(d.amount)}</TableCell>
                      <TableCell>
                        {d.type === "RECURRING" ? (
                          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-700">Monthly</span>
                        ) : (
                          <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] font-semibold text-zinc-600">One-time</span>
                        )}
                      </TableCell>
                      <TableCell className="hidden whitespace-nowrap lg:table-cell">{titleCase(d.paymentMethod)}</TableCell>
                      <TableCell>
                        <span className={cn("whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold", statusBadgeClass(d.paymentStatus))}>
                          {titleCase(d.paymentStatus)}
                        </span>
                      </TableCell>
                      <TableCell className="hidden whitespace-nowrap text-sm sm:table-cell">{formatDate(d.createdAt)}</TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          <Button
                            size="icon"
                            variant="ghost"
                            aria-label={`Edit donation ${d.receiptNumber}`}
                            onClick={() => {
                              setEditTarget(d);
                              setEditAmount(String(d.amount));
                              setEditStatus(d.paymentStatus);
                            }}
                          >
                            <Pencil className="size-4" />
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="text-red-600 hover:bg-red-50 hover:text-red-700"
                            aria-label={`Delete donation ${d.receiptNumber}`}
                            onClick={() => setDeleteTarget(d)}
                          >
                            <Trash2 className="size-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Record donation dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Record donation</DialogTitle>
            <DialogDescription>Log an offline or manual contribution. A receipt number is generated automatically.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="grid gap-2">
              <Label htmlFor="d-name">Donor name *</Label>
              <Input id="d-name" value={form.donorName} onChange={(e) => setForm({ ...form, donorName: e.target.value })} placeholder="Full name" />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="d-email">Donor email *</Label>
              <Input id="d-email" type="email" value={form.donorEmail} onChange={(e) => setForm({ ...form, donorEmail: e.target.value })} placeholder="donor@example.org" />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor="d-amount">Amount (₹) *</Label>
                <Input id="d-amount" type="number" min="1" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} placeholder="5000" />
              </div>
              <div className="grid gap-2">
                <Label>Campaign</Label>
                <Select value={form.campaignId || "none"} onValueChange={(v) => setForm({ ...form, campaignId: v === "none" ? "" : v })}>
                  <SelectTrigger aria-label="Select campaign">
                    <SelectValue placeholder="General donation" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">General donation</SelectItem>
                    {campaigns.map((c) => (
                      <SelectItem key={c.id} value={c.id}>{c.title}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label>Type</Label>
                <Select value={form.type} onValueChange={(v) => setForm({ ...form, type: v })}>
                  <SelectTrigger aria-label="Donation type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {DONATION_TYPES.map((t) => (
                      <SelectItem key={t} value={t}>{t === "RECURRING" ? "Monthly" : "One-time"}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label>Payment method</Label>
                <Select value={form.paymentMethod} onValueChange={(v) => setForm({ ...form, paymentMethod: v })}>
                  <SelectTrigger aria-label="Payment method">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PAYMENT_METHODS.map((m) => (
                      <SelectItem key={m} value={m}>{titleCase(m)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="d-message">Message</Label>
              <Textarea id="d-message" value={form.message} onChange={(e) => setForm({ ...form, message: e.target.value })} placeholder="Optional note from the donor" rows={2} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button onClick={createDonation} disabled={saving}>
              {saving ? "Saving…" : "Record donation"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit dialog */}
      <Dialog open={!!editTarget} onOpenChange={(o) => !o && setEditTarget(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Edit donation</DialogTitle>
            <DialogDescription>{editTarget ? `Receipt ${editTarget.receiptNumber} · ${editTarget.donorName}` : ""}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="grid gap-2">
              <Label htmlFor="d-edit-amount">Amount (₹)</Label>
              <Input id="d-edit-amount" type="number" min="1" value={editAmount} onChange={(e) => setEditAmount(e.target.value)} />
            </div>
            <div className="grid gap-2">
              <Label>Payment status</Label>
              <Select value={editStatus} onValueChange={setEditStatus}>
                <SelectTrigger aria-label="Payment status">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PAYMENT_STATUSES.map((s) => (
                    <SelectItem key={s} value={s}>{titleCase(s)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
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
            <DialogTitle>Delete donation?</DialogTitle>
            <DialogDescription>
              {deleteTarget ? `Receipt ${deleteTarget.receiptNumber} from ${deleteTarget.donorName} (${formatINR(deleteTarget.amount)}) will be permanently removed. This cannot be undone.` : ""}
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
