"use client";

/**
 * Food Security — Check-in Desk tab (distribution operations).
 * Scan/lookup a beneficiary → verify allocation → check in → confirm the
 * handover with quantities + acknowledgement. Also lists the live queue and
 * handles no-shows. Duplicate handovers are blocked by the backend.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { CheckCircle2, PackageSearch, ScanLine, Search, UserPlus, UserRoundX, XCircle } from "lucide-react";
import { toast } from "sonner";
import { get, post, patch } from "@/lib/api-client";
import { formatDate, formatDateTime } from "@/lib/format";
import { SectionCard } from "@/components/shared/section-card";
import { EmptyState } from "@/components/shared/empty-state";
import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FieldGrid, TextField, SelectField, TextareaField } from "@/components/shared/form-fields";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { asArray, ACK_METHODS, NO_SHOW_REASONS, type FoodEvent, type FoodRegistration } from "./shared";

interface LookupResult {
  checkedIn: boolean;
  alreadyCheckedIn?: boolean;
  registration: FoodRegistration & {
    beneficiary: { code: string; name: string; familyMembers?: number };
    event: { code: string; title: string; venue: string };
  };
  packageSnapshot: Array<{ name: string; qty: number; unit?: string }> | null;
}

export default function DeskTab({ revision, isAdmin, registrationsOnly }: { revision: number; isAdmin: boolean; onNavigate?: (t: string) => void; registrationsOnly?: boolean }) {
  const [events, setEvents] = useState<FoodEvent[]>([]);
  const [eventId, setEventId] = useState("");
  const [queue, setQueue] = useState<FoodRegistration[]>([]);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [found, setFound] = useState<LookupResult | null>(null);
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [ack, setAck] = useState({ unitsDelivered: "1", ackMethod: "DIGITAL", ackRef: "" });
  const [walkinOpen, setWalkinOpen] = useState(false);
  const [walkin, setWalkin] = useState({ name: "", phone: "", householdSize: "1", unitsAllocated: "1" });
  const inputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    const evts = asArray<FoodEvent>(await get("/api/food/events").catch(() => []));
    setEvents(evts);
    const operational = evts.filter((e) => !["DRAFT", "APPROVED", "CANCELLED", "CLOSED"].includes(e.status));
    if (!eventId && operational.length) setEventId(operational[0].id);
    if (eventId) {
      try {
        setQueue(asArray<FoodRegistration>(await get(`/api/food/registrations?eventId=${eventId}`)));
      } catch {
        setQueue([]);
      }
    } else setQueue([]);
  }, [eventId, revision]);

  useEffect(() => {
    load();
  }, [load]);

  const lookup = async (search?: string) => {
    const q = (search ?? code).trim();
    if (!q) return;
    setBusy(true);
    try {
      const res = await post<LookupResult | { needsDisambiguation: true }>("/api/food/checkin", {
        action: "lookup",
        code: q,
        eventId: eventId || undefined,
      });
      if ("needsDisambiguation" in res) {
        toast.error("Multiple matches — enter the full registration or beneficiary code");
        return;
      }
      setFound(res);
      if (!res.alreadyCheckedIn) toast.success(`${res.registration.beneficiary.name} checked in`);
      setCheckoutOpen(true);
      setCode("");
      inputRef.current?.focus();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Lookup failed");
    } finally {
      setBusy(false);
    }
  };

  const checkout = async () => {
    if (!found) return;
    setBusy(true);
    try {
      const units = Number(ack.unitsDelivered);
      const res = await post<{ handedOver: boolean; registration: FoodRegistration }>("/api/food/checkin", {
        action: "checkout",
        code: found.registration.code,
        unitsDelivered: Number.isFinite(units) ? units : found.registration.unitsAllocated,
        ackMethod: ack.ackMethod,
        ackRef: ack.ackRef || undefined,
      });
      toast.success(
        res.registration.status === "DISTRIBUTED"
          ? `Handover complete — ${units} unit(s) to ${found.registration.beneficiary.name}`
          : "Handover recorded"
      );
      setCheckoutOpen(false);
      setFound(null);
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Handover failed");
    } finally {
      setBusy(false);
    }
  };

  const markNoShow = async (reg: FoodRegistration) => {
    try {
      await patch(`/api/food/registrations/${reg.id}`, { status: "NO_SHOW", reason: "NO_SHOW" });
      toast.success("Marked as no-show — stock reconciles at event close");
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to update");
    }
  };

  // Walk-in: creates the beneficiary identity + registration, then opens the
  // handover dialog so the desk can serve them immediately.
  const registerWalkin = async () => {
    if (!eventId || !walkin.name.trim() || walkin.name.trim().length < 3) {
      toast.error("Enter the walk-in's name first");
      return;
    }
    setBusy(true);
    try {
      const res = await post<{ existing?: boolean; registration: { code: string }; message?: string }>(
        `/api/food/events/${eventId}/walkin`,
        {
          name: walkin.name.trim(),
          phone: walkin.phone.trim() || undefined,
          householdSize: Number(walkin.householdSize) || 1,
          unitsAllocated: Number(walkin.unitsAllocated) || 1,
        }
      );
      if (res.existing) {
        toast.info(res.message ?? "Already registered — checking them in");
      } else {
        toast.success(`Walk-in registered — ${res.registration.code}`);
      }
      setWalkinOpen(false);
      setWalkin({ name: "", phone: "", householdSize: "1", unitsAllocated: "1" });
      await load();
      // flow straight into check-in + handover
      const lookup = await post<LookupResult>("/api/food/checkin", {
        action: "lookup",
        code: res.registration.code,
        eventId: eventId,
      });
      setFound(lookup);
      setAck({ unitsDelivered: String(lookup.registration.unitsAllocated), ackMethod: "ASSISTED", ackRef: "" });
      setCheckoutOpen(true);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Walk-in registration failed");
    } finally {
      setBusy(false);
    }
  };

  const openRegs = queue.filter((r) => ["REGISTERED", "APPROVED", "CONFIRMED", "CHECKED_IN"].includes(r.status));
  const selected = events.find((e) => e.id === eventId);

  return (
    <div className="space-y-4">
      <SectionCard
        title={registrationsOnly ? "Registration desk" : "Distribution check-in desk"}
        description={
          registrationsOnly
            ? "Allocate beneficiaries to events, approve registrations and record no-shows."
            : "Scan the beneficiary QR (or type registration/beneficiary code, or phone number), verify and hand over."
        }
        icon={<ScanLine className="size-4" />}
        actions={
          <div className="flex items-center gap-2">
            <select
              aria-label="Distribution event"
              className="h-9 rounded-md border bg-background px-2 text-sm"
              value={eventId}
              onChange={(e) => setEventId(e.target.value)}
            >
              <option value="">Select event…</option>
              {events.map((e) => (
                <option key={e.id} value={e.id}>{e.code} — {e.title}</option>
              ))}
            </select>
          </div>
        }
      >
        {!registrationsOnly && (
          <form
            className="flex flex-wrap items-end gap-2 px-5"
            onSubmit={(e) => {
              e.preventDefault();
              lookup();
            }}
          >
            <div className="min-w-56 flex-1">
              <TextField label="QR / registration code / phone" value={code} onChange={setCode} placeholder="UAR-FREG-00001 or 9876543210" />
            </div>
            <Button type="submit" disabled={busy || !eventId}>
              <Search className="size-4" /> {busy ? "Checking…" : "Check in"}
            </Button>
            {isAdmin && (
              <Button type="button" variant="outline" onClick={() => setWalkinOpen(true)} disabled={!eventId}>
                <UserPlus className="size-4" /> Walk-in
              </Button>
            )}
          </form>
        )}

        {selected && (
          <p className="px-5 pt-3 text-xs text-muted-foreground">
            {selected.venue}{selected.city ? `, ${selected.city}` : ""} · {formatDate(selected.eventDate)} · {openRegs.length} in queue
          </p>
        )}

        <div className="px-5 pb-5 pt-2">
          {!eventId ? (
            <EmptyState icon={<ScanLine className="size-8" />} title="Pick a distribution event" hint="Select an event to see its queue." className="border-0" />
          ) : openRegs.length === 0 ? (
            <EmptyState icon={<PackageSearch className="size-8" />} title="Queue is clear" hint="Registrations for this event will appear here." className="border-0" />
          ) : (
            <ul className="divide-y rounded-lg border">
              {openRegs.map((r) => (
                <li key={r.id} className="flex flex-wrap items-center gap-2 p-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">
                      {r.beneficiary?.name} <span className="font-mono text-xs text-muted-foreground">{r.code}</span>
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {r.unitsAllocated} unit(s){r.checkIn ? ` · checked in ${formatDateTime(r.checkIn.checkedInAt)}` : ""}
                      {r.beneficiary?.phone ? ` · ${r.beneficiary.phone}` : ""}
                    </p>
                  </div>
                  <StatusBadge status={r.status} />
                  {!registrationsOnly && isAdmin && r.status !== "CHECKED_IN" && (
                    <Button size="sm" variant="outline" onClick={() => lookup(r.code)}>
                      <ScanLine className="size-4" /> Check in
                    </Button>
                  )}
                  {registrationsOnly && isAdmin && r.status === "REGISTERED" && (
                    <Button size="sm" onClick={async () => {
                      try {
                        await patch(`/api/food/registrations/${r.id}`, { status: "APPROVED" });
                        toast.success("Registration approved");
                        load();
                      } catch (e) {
                        toast.error(e instanceof Error ? e.message : "Failed");
                      }
                    }}>
                      Approve
                    </Button>
                  )}
                  {isAdmin && !["CHECKED_IN", "DISTRIBUTED"].includes(r.status) && (
                    <Button size="sm" variant="ghost" onClick={() => markNoShow(r)}>
                      <UserRoundX className="size-4" /> No-show
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </SectionCard>

      {/* walk-in registration dialog */}
      <Dialog open={walkinOpen} onOpenChange={setWalkinOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <UserPlus className="size-5 text-emerald-600" /> Emergency walk-in
            </DialogTitle>
            <DialogDescription>
              Creates the beneficiary profile and registers them for this distribution in one step — nobody is turned away for not being in the system. Phone is optional.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <FieldGrid>
              <TextField label="Full name" required value={walkin.name} onChange={(v) => setWalkin((w) => ({ ...w, name: v }))} />
              <TextField label="Mobile (optional)" inputMode="tel" value={walkin.phone} onChange={(v) => setWalkin((w) => ({ ...w, phone: v }))} />
            </FieldGrid>
            <FieldGrid>
              <TextField label="Household size" inputMode="numeric" value={walkin.householdSize} onChange={(v) => setWalkin((w) => ({ ...w, householdSize: v }))} />
              <TextField label="Units to allocate" inputMode="numeric" value={walkin.unitsAllocated} onChange={(v) => setWalkin((w) => ({ ...w, unitsAllocated: v }))} />
            </FieldGrid>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setWalkinOpen(false)}>
              <XCircle className="size-4" /> Cancel
            </Button>
            <Button onClick={registerWalkin} disabled={busy}>
              <UserPlus className="size-4" /> Register & check in
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* handover confirmation dialog */}
      <Dialog open={checkoutOpen} onOpenChange={setCheckoutOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CheckCircle2 className="size-5 text-emerald-600" /> Confirm handover
            </DialogTitle>
            <DialogDescription>
              {found && (
                <>
                  {found.registration.beneficiary.name} · {found.registration.beneficiary.code} ·{" "}
                  {found.registration.event.title} — {found.registration.unitsAllocated} unit(s) allocated
                  {found.alreadyCheckedIn ? " · already checked in" : ""}
                </>
              )}
            </DialogDescription>
          </DialogHeader>
          {found && (
            <div className="space-y-4">
              <ul className="rounded-lg border bg-muted/30 p-3 text-sm">
                {(found.packageSnapshot ?? [{ name: "Package", qty: 1 }]).map((i, idx) => (
                  <li key={idx} className="flex justify-between py-0.5">
                    <span>{i.name}</span>
                    <span className="tabular-nums text-muted-foreground">{i.qty}{i.unit ? ` ${i.unit}` : ""}</span>
                  </li>
                ))}
              </ul>
              <FieldGrid>
                <TextField label="Units handed over" inputMode="numeric" value={ack.unitsDelivered} onChange={(v) => setAck((a) => ({ ...a, unitsDelivered: v }))} />
                <SelectField label="Acknowledgement" value={ack.ackMethod} onChange={(v) => setAck((a) => ({ ...a, ackMethod: v }))} options={ACK_METHODS} />
              </FieldGrid>
              <TextField label="OTP / witness reference (optional)" value={ack.ackRef} onChange={(v) => setAck((a) => ({ ...a, ackRef: v }))} />
              <p className="text-xs text-muted-foreground">
                Photography is never required for receiving food. Assisted acknowledgement records the staff member operating the desk.
              </p>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setCheckoutOpen(false)}>
              <XCircle className="size-4" /> Cancel
            </Button>
            <Button onClick={checkout} disabled={busy}>
              <CheckCircle2 className="size-4" /> Confirm handover
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
