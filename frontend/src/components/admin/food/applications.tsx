"use client";

/**
 * Food Security — Applications tab.
 * Admin review queue for public food assistance applications: approve (creates
 * the persistent beneficiary identity), request information, reject with a
 * mandatory explanation. Decisions are human-only by design.
 */

import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, ClipboardPlus, Eye, XCircle } from "lucide-react";
import { toast } from "sonner";
import { get, patch } from "@/lib/api-client";
import { formatDate, formatDateTime } from "@/lib/format";
import { DataTable } from "@/components/shared/data-table";
import { EmptyState } from "@/components/shared/empty-state";
import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { TextareaField } from "@/components/shared/form-fields";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { asArray, type FoodApplication, type TabProps } from "./shared";

const URGENCY_TONE: Record<string, string> = {
  CRITICAL: "destructive", HIGH: "orange", MEDIUM: "amber", LOW: "neutral",
};

export default function ApplicationsTab({ revision, isAdmin }: TabProps) {
  const [rows, setRows] = useState<FoodApplication[]>([]);
  const [loading, setLoading] = useState(true);
  const [review, setReview] = useState<FoodApplication | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setRows(asArray<FoodApplication>(await get("/api/food/applications")));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load applications");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load, revision]);

  const decide = async (status: "IN_REVIEW" | "APPROVED" | "REJECTED" | "FULFILLED") => {
    if (!review) return;
    if (status === "REJECTED" && !note.trim()) {
      toast.error("Explain the decision — the applicant will read this note");
      return;
    }
    setBusy(true);
    try {
      await patch(`/api/food/applications/${review.id}`, { status, reviewNote: note || undefined });
      toast.success(`Application ${status.toLowerCase()}`);
      setReview(null);
      setNote("");
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Review failed");
    } finally {
      setBusy(false);
    }
  };

  const openReview = (a: FoodApplication) => {
    setReview(a);
    setNote(a.reviewNote ?? "");
  };

  return (
    <div className="space-y-4">
      <DataTable
        columns={[
          { key: "ref", header: "Reference", mono: true, className: "w-36" },
          { key: "name", header: "Applicant" },
          { key: "household", header: "Household", align: "center", hideBelow: "md" },
          { key: "urgency", header: "Urgency", hideBelow: "sm" },
          { key: "city", header: "City", hideBelow: "lg" },
          { key: "date", header: "Submitted", hideBelow: "md" },
          { key: "status", header: "Status" },
          { key: "actions", header: "" },
        ]}
        rows={rows}
        rowKey={(r) => r.id}
        loading={loading}
        height="auto"
        onRowClick={openReview}
        empty={
          <EmptyState
            icon={<ClipboardPlus className="size-8" />}
            title="No food assistance applications"
            hint="Public applications from /food-assistance/apply land here for review."
          />
        }
      >
        {(row, col) => {
          if (col.key === "ref") return <span className="font-mono text-xs">{row.refCode ?? "—"}</span>;
          if (col.key === "name")
            return (
              <div className="min-w-0">
                <p className="truncate font-medium">{row.name}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {row.source === "EMERGENCY" ? "Emergency · " : ""}{row.preferredContact ?? "PHONE"} contact
                </p>
              </div>
            );
          if (col.key === "household")
            return <span className="text-sm tabular-nums">{row.familyMembers ?? "?"}{row.childrenCount ? ` (${row.childrenCount} children)` : ""}{row.seniorCount ? ` (${row.seniorCount} seniors)` : ""}</span>;
          if (col.key === "urgency") return <StatusBadge status={row.urgency} />;
          if (col.key === "city") return <span className="text-sm">{row.city ?? "—"}</span>;
          if (col.key === "date") return <span className="text-xs">{formatDate(row.createdAt)}</span>;
          if (col.key === "status") return <StatusBadge status={row.status} />;
          if (col.key === "actions")
            return (
              <Button variant="outline" size="sm" onClick={() => openReview(row)} disabled={!isAdmin}>
                <Eye className="size-4" /> Review
              </Button>
            );
          return null;
        }}
      </DataTable>

      <Dialog open={!!review} onOpenChange={(o) => !o && setReview(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{review?.refCode} — {review?.name}</DialogTitle>
            <DialogDescription>
              {review && `Submitted ${formatDateTime(review.createdAt)} · urgency ${review.urgency.toLowerCase()} · source ${review.source?.toLowerCase() ?? "self"}`}
            </DialogDescription>
          </DialogHeader>
          {review && (
            <div className="space-y-3">
              <dl className="grid grid-cols-2 gap-2 rounded-lg border bg-muted/30 p-3 text-sm">
                <div><dt className="text-xs text-muted-foreground">Phone</dt><dd className="font-medium">{review.phone ?? "—"}</dd></div>
                <div><dt className="text-xs text-muted-foreground">City / PIN</dt><dd className="font-medium">{review.city ?? "—"} {review.pincode ?? ""}</dd></div>
                <div><dt className="text-xs text-muted-foreground">Household</dt><dd className="font-medium">{review.familyMembers ?? "?"} members · {review.childrenCount ?? 0} children · {review.seniorCount ?? 0} seniors</dd></div>
                <div><dt className="text-xs text-muted-foreground">Dietary needs</dt><dd className="font-medium">{review.dietary ?? "—"}</dd></div>
                <div className="col-span-2"><dt className="text-xs text-muted-foreground">Assistance needed</dt><dd>{review.details}</dd></div>
              </dl>
              {review.beneficiary && (
                <p className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 p-2 text-sm text-emerald-700 dark:text-emerald-400">
                  Linked beneficiary: {review.beneficiary.code} — {review.beneficiary.name}
                </p>
              )}
              <TextareaField
                label="Review note (shared with the applicant on rejection)"
                value={note}
                onChange={setNote}
                placeholder="Approved for the monthly ration programme — the coordinator will call within 2 working days."
              />
            </div>
          )}
          <DialogFooter className="flex-wrap gap-2">
            {review?.status === "PENDING" && (
              <Button variant="outline" onClick={() => decide("IN_REVIEW")} disabled={busy}>Mark in review</Button>
            )}
            <Button variant="destructive" onClick={() => decide("REJECTED")} disabled={busy}>
              <XCircle className="size-4" /> Reject
            </Button>
            <Button onClick={() => decide("APPROVED")} disabled={busy || !isAdmin}>
              <CheckCircle2 className="size-4" /> Approve
            </Button>
            {review?.status === "APPROVED" && (
              <Button variant="outline" onClick={() => decide("FULFILLED")} disabled={busy}>Mark fulfilled</Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
