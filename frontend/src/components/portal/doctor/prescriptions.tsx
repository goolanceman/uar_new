"use client";

/**
 * Doctor portal — Prescriptions. List mine, create with dynamic item rows
 * (1-0-1 style frequency), print via the server-rendered HTML, sign drafts
 * and cancel. Dispensing is handled by the pharmacist in their own tab.
 */

import { useCallback, useEffect, useState } from "react";
import { FileDown, Pill, Plus, Printer, RefreshCw, Signature, Trash2, Users, X } from "lucide-react";
import { toast } from "sonner";
import type { SessionUser } from "@/hooks/use-auth";
import { get, patch, post } from "@/lib/api-client";
import { formatDate, formatDateTime } from "@/lib/format";
import { PageHeader } from "@/components/shared/page-header";
import { SectionCard } from "@/components/shared/section-card";
import { StatusBadge } from "@/components/shared/status-badge";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { FormSheet } from "@/components/shared/form-sheet";
import { Field, FieldGrid, TextField, TextareaField } from "@/components/shared/form-fields";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  ageSexLine,
  asArray,
  ListSkeleton,
  medTone,
  openPrint,
  QuietEmpty,
  toastError,
  useBeneficiarySearch,
  type BeneficiaryLite,
  type EncounterRow,
  type PrescriptionItemRow,
  type PrescriptionRow,
} from "./shared";
import { useRowBusy } from "@/hooks/use-row-busy";

interface ItemDraft {
  medicineName: string;
  genericName: string;
  strength: string;
  dosage: string;
  route: string;
  frequency: string;
  durationDays: string;
  quantity: string;
  instructions: string;
}

const EMPTY_ITEM: ItemDraft = {
  medicineName: "",
  genericName: "",
  strength: "",
  dosage: "",
  route: "",
  frequency: "",
  durationDays: "",
  quantity: "",
  instructions: "",
};

export default function DoctorPrescriptions({ user }: { user: SessionUser }) {
  const [rows, setRows] = useState<PrescriptionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // create-sheet state
  const [sheetOpen, setSheetOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [diagnosis, setDiagnosis] = useState("");
  const [followUpDate, setFollowUpDate] = useState("");
  const [items, setItems] = useState<ItemDraft[]>([{ ...EMPTY_ITEM }]);
  const [encounterOptions, setEncounterOptions] = useState<Array<{ value: string; label: string }>>([]);
  const [encounterId, setEncounterId] = useState("");

  // beneficiary picker inside the sheet
  const search = useBeneficiarySearch();
  const [picked, setPicked] = useState<BeneficiaryLite | null>(null);

  // sign / cancel flows
  const [signTarget, setSignTarget] = useState<PrescriptionRow | null>(null);
  const { busyId, setBusyId } = useRowBusy();

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // The server scopes the list by role; there is no doctorId=mine filter,
      // so the doctor sees the full prescription pipeline (newest first).
      const data = await get<unknown>("/api/prescriptions");
      setRows(asArray<PrescriptionRow>(data));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load prescriptions");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Load the picked patient's encounters for the optional encounter link.
  useEffect(() => {
    setEncounterId("");
    setEncounterOptions([]);
    if (!picked) return;
    let alive = true;
    get<unknown>(`/api/encounters?beneficiaryId=${picked.id}`)
      .then((data) => {
        if (!alive) return;
        const list = asArray<EncounterRow>(data).slice(0, 10);
        setEncounterOptions(
          list.map((e) => ({
            value: e.id,
            label: `${formatDate(e.createdAt)} · ${(e.diagnosis || e.chiefComplaint || "Consultation").slice(0, 40)}`,
          }))
        );
      })
      .catch(() => {
        if (alive) setEncounterOptions([]);
      });
    return () => {
      alive = false;
    };
  }, [picked]);

  const openSheet = () => {
    setDiagnosis("");
    setFollowUpDate("");
    setItems([{ ...EMPTY_ITEM }]);
    setPicked(null);
    search.setQ("");
    setSheetOpen(true);
  };

  const setItem = (i: number, key: keyof ItemDraft, v: string) => {
    setItems((prev) => prev.map((it, idx) => (idx === i ? { ...it, [key]: v } : it)));
  };

  const save = async () => {
    if (!picked) {
      toast.error("Pick a patient first");
      return;
    }
    const valid = items.filter((it) => it.medicineName.trim() && Number(it.quantity) > 0);
    if (valid.length === 0) {
      toast.error("Add at least one medicine with a quantity");
      return;
    }
    setSaving(true);
    try {
      await post("/api/prescriptions", {
        beneficiaryId: picked.id,
        encounterId: encounterId || undefined,
        diagnosis: diagnosis.trim() || undefined,
        followUpDate: followUpDate || undefined,
        items: valid.map((it) => ({
          medicineName: it.medicineName.trim(),
          genericName: it.genericName.trim() || undefined,
          strength: it.strength.trim() || undefined,
          dosage: it.dosage.trim() || undefined,
          route: it.route || undefined,
          frequency: it.frequency.trim() || undefined,
          durationDays: it.durationDays ? Number(it.durationDays) : undefined,
          quantity: Number(it.quantity),
          instructions: it.instructions.trim() || undefined,
        })),
      });
      toast.success("Prescription draft saved — sign it to send it to the pharmacy");
      setSheetOpen(false);
      await load();
    } catch (e) {
      toastError(e, "Could not save the prescription");
    } finally {
      setSaving(false);
    }
  };

  const sign = async () => {
    if (!signTarget) return;
    setBusyId(signTarget.id);
    try {
      await post(`/api/prescriptions/${signTarget.id}/sign`);
      toast.success("Prescription signed — the pharmacist can now dispense");
      setSignTarget(null);
      await load();
    } catch (e) {
      toastError(e, "Could not sign the prescription");
    } finally {
      setBusyId(null);
    }
  };

  const cancel = async (p: PrescriptionRow) => {
    setBusyId(p.id);
    try {
      await patch(`/api/prescriptions/${p.id}`, {
        status: "CANCELLED",
        cancelReason: "Cancelled by the prescribing doctor",
      });
      toast.success("Prescription cancelled");
      await load();
    } catch (e) {
      toastError(e, "Could not cancel the prescription");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Prescriptions"
        description="Draft, sign and print prescriptions — signed copies reach the dispensing counter."
        icon={<Pill className="size-5" />}
        actions={
          <>
            <Button variant="outline" size="sm" className="min-h-11 gap-1.5 sm:min-h-9" onClick={load} aria-label="Refresh prescriptions">
              <RefreshCw className="size-4" aria-hidden="true" />
              Refresh
            </Button>
            <Button size="sm" className="min-h-11 gap-1.5 sm:min-h-9" onClick={openSheet}>
              <Plus className="size-4" aria-hidden="true" />
              New prescription
            </Button>
          </>
        }
      />

      <SectionCard title="My prescriptions" description="Newest first — drafts stay editable until signed" icon={<Pill className="size-5" />}>
        {loading ? (
          <ListSkeleton rows={4} />
        ) : rows.length === 0 ? (
          <QuietEmpty
            icon={<Pill className="size-5" />}
            title="No prescriptions yet"
            error={error}
          >
            <Button className="min-h-11 gap-1.5" onClick={openSheet}>
              <Plus className="size-4" aria-hidden="true" />
              Write the first one
            </Button>
          </QuietEmpty>
        ) : (
          <ul className="max-h-[32rem] divide-y overflow-y-auto scrollbar-thin">
            {rows.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 py-3 first:pt-0 last:pb-0">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">
                    {p.beneficiary?.name ?? "Patient"}
                    {p.items?.length ? ` · ${p.items.length} medicine${p.items.length === 1 ? "" : "s"}` : ""}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {p.code ? `${p.code} · ` : ""}
                    {p.createdAt ? formatDateTime(p.createdAt) : ""}
                    {p.diagnosis ? ` · ${p.diagnosis}` : ""}
                  </p>
                </div>
                <StatusBadge status={p.status} tone={medTone(p.status)} />
                <div className="flex w-full items-center gap-2 sm:w-auto">
                  {p.status === "DRAFT" && (
                    <>
                      <Button
                        size="sm"
                        className="min-h-11 flex-1 gap-1.5 sm:min-h-9 sm:flex-none"
                        disabled={busyId !== null}
                        onClick={() => setSignTarget(p)}
                      >
                        <Signature className="size-4" aria-hidden="true" />
                        Sign
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="min-h-11 sm:min-h-9"
                        disabled={busyId !== null}
                        onClick={() => void cancel(p)}
                        aria-label={`Cancel prescription for ${p.beneficiary?.name ?? "patient"}`}
                      >
                        <X className="size-4" aria-hidden="true" />
                        <span className="sr-only sm:not-sr-only sm:text-xs">Cancel</span>
                      </Button>
                    </>
                  )}
                  {p.status !== "DRAFT" && p.status !== "CANCELLED" && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="min-h-11 gap-1.5 sm:min-h-9"
                      onClick={() => openPrint(`/api/prescriptions/${p.id}/print`)}
                      aria-label="Print prescription"
                    >
                      <Printer className="size-4" aria-hidden="true" />
                      Print
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>

      {/* Create FormSheet */}
      <FormSheet
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        title="New prescription"
        description="Draft the medicines — you review and sign before it reaches the pharmacy."
        size="lg"
        submitLabel="Save draft"
        onSubmit={save}
        loading={saving}
        dirty={!!picked || diagnosis !== "" || items.some((i) => i.medicineName !== "")}
      >
        {/* Beneficiary picker */}
        <section className="flex flex-col gap-3">
          <h3 className="border-b pb-2 text-sm font-semibold">Patient</h3>
          {picked ? (
            <div className="flex items-center gap-3 rounded-lg border bg-muted/40 p-3">
              <Users className="size-4 shrink-0 text-primary" aria-hidden="true" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{picked.name}</p>
                <p className="truncate text-xs text-muted-foreground">{ageSexLine(picked)}</p>
              </div>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className="size-11"
                onClick={() => setPicked(null)}
                aria-label="Change patient"
              >
                <X className="size-4" />
              </Button>
            </div>
          ) : (
            <>
              <Input
                type="search"
                value={search.q}
                onChange={(e) => search.setQ(e.target.value)}
                placeholder="Search patient by name, phone or code…"
                aria-label="Search patients"
                className="h-11"
              />
              {search.results.length > 0 && (
                <ul className="max-h-56 divide-y overflow-y-auto rounded-lg border scrollbar-thin">
                  {search.results.map((b) => (
                    <li key={b.id}>
                      <button
                        type="button"
                        onClick={() => setPicked(b)}
                        className="flex w-full min-h-11 items-center gap-2 px-3 py-2.5 text-left text-sm transition hover:bg-accent"
                      >
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-medium">{b.name}</span>
                          <span className="block truncate text-xs text-muted-foreground">{ageSexLine(b)}</span>
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {search.q.trim().length >= 2 && !search.loading && search.results.length === 0 && (
                <p className="text-xs text-muted-foreground">No patients match — check the spelling or phone number.</p>
              )}
            </>
          )}
        </section>

        <FieldGrid>
          <TextareaField
            label="Diagnosis"
            value={diagnosis}
            onChange={setDiagnosis}
            placeholder="e.g. Type 2 diabetes, uncontrolled"
          />
          <TextField
            label="Follow-up date"
            type="date"
            value={followUpDate}
            onChange={setFollowUpDate}
          />
        </FieldGrid>

        {/* Dynamic medicine rows */}
        <section className="flex flex-col gap-3">
          <div className="flex items-center justify-between border-b pb-2">
            <h3 className="text-sm font-semibold">Medicines</h3>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="min-h-11 gap-1 sm:min-h-9"
              onClick={() => setItems((prev) => [...prev, { ...EMPTY_ITEM }])}
            >
              <Plus className="size-4" aria-hidden="true" />
              Add medicine
            </Button>
          </div>
          {items.map((it, i) => (
            <fieldset key={i} className="rounded-xl border p-4" aria-label={`Medicine ${i + 1}`}>
              <div className="mb-2 flex items-center justify-between">
                <legend className="px-1 text-xs font-semibold text-muted-foreground">Medicine {i + 1}</legend>
                {items.length > 1 && (
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    className="size-11 text-destructive hover:text-destructive"
                    onClick={() => setItems((prev) => prev.filter((_, idx) => idx !== i))}
                    aria-label={`Remove medicine ${i + 1}`}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                )}
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <TextField label="Medicine name" required value={it.medicineName} onChange={(v) => setItem(i, "medicineName", v)} placeholder="e.g. Metformin" />
                <TextField label="Generic name" value={it.genericName} onChange={(v) => setItem(i, "genericName", v)} placeholder="e.g. Metformin HCl" />
                <TextField label="Strength" value={it.strength} onChange={(v) => setItem(i, "strength", v)} placeholder="e.g. 500 mg" />
                <TextField label="Dosage" value={it.dosage} onChange={(v) => setItem(i, "dosage", v)} placeholder="e.g. 1 tablet" />
                <TextField label="Frequency" value={it.frequency} onChange={(v) => setItem(i, "frequency", v)} placeholder="1-0-1" hint="Morning-Afternoon-Night" />
                <TextField label="Duration (days)" type="number" inputMode="numeric" value={it.durationDays} onChange={(v) => setItem(i, "durationDays", v)} placeholder="30" />
                <TextField label="Quantity" type="number" inputMode="numeric" required value={it.quantity} onChange={(v) => setItem(i, "quantity", v)} placeholder="60" />
                <TextField label="Route" value={it.route} onChange={(v) => setItem(i, "route", v)} placeholder="Oral" />
                <TextField label="Instructions" className="sm:col-span-2" value={it.instructions} onChange={(v) => setItem(i, "instructions", v)} placeholder="After food…" />
              </div>
            </fieldset>
          ))}
        </section>

        {encounterOptions.length > 0 && (
          <Field
            label="Link an encounter (optional)"
            hint="Recent consultations — pick one to attach the prescription, or leave it standalone."
          >
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setEncounterId("")}
                aria-pressed={encounterId === ""}
                className={`min-h-11 rounded-full border px-3.5 py-1.5 text-xs font-medium ${encounterId === "" ? "border-primary bg-primary text-primary-foreground" : "bg-card hover:bg-accent"}`}
              >
                No link
              </button>
              {encounterOptions.map((o) => (
                <button
                  key={o.value}
                  type="button"
                  onClick={() => setEncounterId(o.value)}
                  aria-pressed={encounterId === o.value}
                  className={`min-h-11 max-w-full truncate rounded-full border px-3.5 py-1.5 text-xs font-medium ${encounterId === o.value ? "border-primary bg-primary text-primary-foreground" : "bg-card hover:bg-accent"}`}
                >
                  {o.label}
                </button>
              ))}
            </div>
          </Field>
        )}

        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <FileDown className="size-3.5 shrink-0" aria-hidden="true" />
          After signing, use Print on the list to open the print-ready prescription.
        </p>
      </FormSheet>

      {/* Sign confirmation */}
      <ConfirmDialog
        open={!!signTarget}
        onOpenChange={(o) => !o && setSignTarget(null)}
        title="Sign this prescription?"
        recordName={signTarget ? `${signTarget.beneficiary?.name ?? "Patient"} · ${signTarget.items?.length ?? 0} medicine(s)` : undefined}
        description="Signing locks the prescription and makes it available to the pharmacist for dispensing. Drafts can no longer be edited afterwards."
        confirmLabel="Sign prescription"
        loading={busyId === signTarget?.id}
        onConfirm={sign}
      />
    </div>
  );
}
