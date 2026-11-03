"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Ambulance as AmbulanceIcon,
  ArrowRight,
  Ban,
  CheckCircle2,
  Flag,
  Pencil,
  Plus,
  RefreshCw,
  Route,
  Siren,
  Trash2,
  Zap,
} from "lucide-react";
import { toast } from "sonner";
import { del, get, patch, post } from "@/lib/api-client";
import { labelOf, useMasters } from "@/hooks/use-masters";
import { formatDateTime, formatDuration, titleCase } from "@/lib/format";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/shared/page-header";
import { SectionCard } from "@/components/shared/section-card";
import { StatCard } from "@/components/shared/stat-card";
import { DataField } from "@/components/shared/data-field";
import { EmptyState } from "@/components/shared/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

/* ---------------------------------- types ---------------------------------- */

interface Ambulance {
  id: string;
  code: string;
  type: string;
  status: string;
  base: string;
  driverName: string;
  driverPhone?: string | null;
  crew?: string | null;
  equipment?: string | null;
}

interface MissionAmbulanceLite {
  code: string;
  type: string;
  driverName: string;
}

interface Mission {
  id: string;
  requestRef: string;
  patientName: string;
  contact: string;
  emergencyType: string;
  priority: string;
  pickup: string;
  destination: string;
  ambulanceId?: string | null;
  status: string;
  progress: number;
  route?: string | null;
  corridorActive: boolean;
  vehiclesAlerted: number;
  timeSavedSec: number;
  etaMin?: number | null;
  ambulance?: MissionAmbulanceLite | null;
  createdAt?: string;
}

interface CorridorEvent {
  id: string;
  segment: string;
  method: string;
  congestion: string;
  vehiclesAlerted: number;
  timeSavedSec: number;
  note?: string | null;
  createdAt?: string;
}

interface RouteSegment {
  name: string;
  congestion: string;
  lengthKm: string;
}

interface AmbForm {
  code: string;
  type: string;
  base: string;
  driverName: string;
  driverPhone: string;
  crew: string;
  equipment: string;
}

interface MissionForm {
  patientName: string;
  contact: string;
  emergencyType: string;
  priority: string;
  pickup: string;
  destination: string;
  route: RouteSegment[];
}

/* ------------------------------- chip styles ------------------------------- */

const AMB_STATUS: Record<string, string> = {
  AVAILABLE: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  ON_MISSION: "border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-400",
  MAINTENANCE: "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400",
};

const MISSION_STATUS: Record<string, string> = {
  REQUESTED: "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400",
  DISPATCHED: "border-cyan-500/30 bg-cyan-500/10 text-cyan-700 dark:text-cyan-400",
  EN_ROUTE: "border-teal-500/30 bg-teal-500/10 text-teal-700 dark:text-teal-400",
  ARRIVED: "border-lime-500/30 bg-lime-500/10 text-lime-700 dark:text-lime-400",
  COMPLETED: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  CANCELLED: "border-zinc-500/30 bg-zinc-500/10 text-zinc-600 dark:text-zinc-400",
};

const PRIORITY: Record<string, string> = {
  CRITICAL: "border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-400 animate-pulse",
  HIGH: "border-orange-500/30 bg-orange-500/10 text-orange-700 dark:text-orange-400",
  MEDIUM: "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400",
};

const CONGESTION: Record<string, string> = {
  LOW: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  MODERATE: "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400",
  HEAVY: "border-orange-500/30 bg-orange-500/10 text-orange-700 dark:text-orange-400",
  GRIDLOCK: "border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-400",
};

const METHOD: Record<string, string> = {
  V2X_5G: "border-cyan-500/30 bg-cyan-500/10 text-cyan-700 dark:text-cyan-400",
  CELL_BROADCAST: "border-teal-500/30 bg-teal-500/10 text-teal-700 dark:text-teal-400",
  BLE_MESH: "border-lime-500/30 bg-lime-500/10 text-lime-700 dark:text-lime-400",
  FM_RDS: "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400",
  SIREN: "border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-400",
};

const MISSION_FILTERS = ["ALL", "REQUESTED", "DISPATCHED", "EN_ROUTE", "ARRIVED", "COMPLETED", "CANCELLED"];

const SEGMENT_POOL = [
  "Hebbal Flyover",
  "Outer Ring Road",
  "Silk Board Junction",
  "KR Puram Junction",
];

const EMPTY_AMB_FORM: AmbForm = {
  code: "",
  type: "BLS",
  base: "",
  driverName: "",
  driverPhone: "",
  crew: "",
  equipment: "",
};

const EMPTY_MISSION_FORM: MissionForm = {
  patientName: "",
  contact: "",
  emergencyType: "CARDIAC",
  priority: "HIGH",
  pickup: "",
  destination: "",
  route: SEGMENT_POOL.map((name) => ({ name, congestion: "MODERATE", lengthKm: "1.5" })),
};

function parseRoute(json: string | null | undefined): { name: string; congestion: string; lengthKm: number }[] {
  if (!json) return [];
  try {
    const parsed = JSON.parse(json) as { name?: string; congestion?: string; lengthKm?: number }[];
    return Array.isArray(parsed)
      ? parsed.map((s) => ({
          name: String(s?.name ?? "Segment"),
          congestion: String(s?.congestion ?? "MODERATE"),
          lengthKm: Number(s?.lengthKm ?? 0),
        }))
      : [];
  } catch {
    return [];
  }
}

/* ---------------------------------- view ----------------------------------- */

export default function AmbulanceView() {
  const [ambulances, setAmbulances] = useState<Ambulance[]>([]);
  const [missions, setMissions] = useState<Mission[]>([]);
  const [loading, setLoading] = useState(true);
  const [missionFilter, setMissionFilter] = useState("ALL");

  /* fleet dialogs */
  const [ambDialog, setAmbDialog] = useState(false);
  const [editingAmb, setEditingAmb] = useState<Ambulance | null>(null);
  const [ambForm, setAmbForm] = useState<AmbForm>(EMPTY_AMB_FORM);
  const [savingAmb, setSavingAmb] = useState(false);
  const [deleteAmb, setDeleteAmb] = useState<Ambulance | null>(null);

  /* mission dialogs */
  const [missionDialog, setMissionDialog] = useState(false);
  const [missionForm, setMissionForm] = useState<MissionForm>(EMPTY_MISSION_FORM);
  const [savingMission, setSavingMission] = useState(false);
  const [dispatchTarget, setDispatchTarget] = useState<Mission | null>(null);
  const [dispatchAmbId, setDispatchAmbId] = useState("");
  const [dispatching, setDispatching] = useState(false);
  const [pendingAction, setPendingAction] = useState<{ mission: Mission; action: "advance" | "complete" | "cancel" } | null>(null);
  const [runningAction, setRunningAction] = useState(false);

  /* mission detail sheet */
  const [sheet, setSheet] = useState<Mission | null>(null);
  const [events, setEvents] = useState<CorridorEvent[]>([]);
  const [eventsLoading, setEventsLoading] = useState(false);

  const typeOptions = useMasters("AMBULANCE_TYPE");
  const emergencyOptions = useMasters("EMERGENCY_TYPE");

  const load = useCallback(async () => {
    try {
      const [amb, mis] = await Promise.all([get<Ambulance[]>("/api/ambulances"), get<Mission[]>("/api/missions")]);
      setAmbulances(Array.isArray(amb) ? amb : []);
      setMissions(Array.isArray(mis) ? mis : []);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load fleet data");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const fleetCounts = useMemo(
    () => ({
      available: ambulances.filter((a) => a.status === "AVAILABLE").length,
      onMission: ambulances.filter((a) => a.status === "ON_MISSION").length,
      maintenance: ambulances.filter((a) => a.status === "MAINTENANCE").length,
    }),
    [ambulances]
  );

  const filteredMissions = useMemo(
    () => (missionFilter === "ALL" ? missions : missions.filter((m) => m.status === missionFilter)),
    [missions, missionFilter]
  );

  const activeMissions = missions.filter((m) =>
    ["REQUESTED", "DISPATCHED", "EN_ROUTE", "ARRIVED"].includes(m.status)
  ).length;

  /* ------------------------------ fleet actions ----------------------------- */

  const openAmbCreate = () => {
    setEditingAmb(null);
    setAmbForm(EMPTY_AMB_FORM);
    setAmbDialog(true);
  };

  const openAmbEdit = (a: Ambulance) => {
    setEditingAmb(a);
    setAmbForm({
      code: a.code ?? "",
      type: a.type ?? "BLS",
      base: a.base ?? "",
      driverName: a.driverName ?? "",
      driverPhone: a.driverPhone ?? "",
      crew: a.crew ?? "",
      equipment: a.equipment ?? "",
    });
    setAmbDialog(true);
  };

  const saveAmb = async () => {
    if (!ambForm.code.trim()) return toast.error("Ambulance code is required");
    if (!ambForm.base.trim()) return toast.error("Base location is required");
    if (!ambForm.driverName.trim()) return toast.error("Driver name is required");
    setSavingAmb(true);
    try {
      const body = {
        code: ambForm.code.trim().toUpperCase(),
        type: ambForm.type,
        base: ambForm.base.trim(),
        driverName: ambForm.driverName.trim(),
        driverPhone: ambForm.driverPhone.trim() || undefined,
        crew: ambForm.crew.trim() || undefined,
        equipment: ambForm.equipment.trim() || undefined,
      };
      if (editingAmb) {
        await patch(`/api/ambulances/${editingAmb.id}`, body);
        toast.success(`Ambulance ${body.code} updated`);
      } else {
        await post("/api/ambulances", body);
        toast.success(`Ambulance ${body.code} added to the fleet`);
      }
      setAmbDialog(false);
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSavingAmb(false);
    }
  };

  const removeAmb = async () => {
    if (!deleteAmb) return;
    try {
      await del(`/api/ambulances/${deleteAmb.id}`);
      toast.success(`Ambulance ${deleteAmb.code} removed`);
      setDeleteAmb(null);
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Delete failed");
    }
  };

  /* ----------------------------- mission actions ---------------------------- */

  const openMissionCreate = () => {
    setMissionForm(EMPTY_MISSION_FORM);
    setMissionDialog(true);
  };

  const saveMission = async () => {
    if (!missionForm.patientName.trim()) return toast.error("Patient name is required");
    if (!missionForm.contact.trim()) return toast.error("Contact number is required");
    if (!missionForm.pickup.trim()) return toast.error("Pickup location is required");
    if (!missionForm.destination.trim()) return toast.error("Destination is required");
    setSavingMission(true);
    try {
      await post("/api/missions", {
        patientName: missionForm.patientName.trim(),
        contact: missionForm.contact.trim(),
        emergencyType: missionForm.emergencyType,
        priority: missionForm.priority,
        pickup: missionForm.pickup.trim(),
        destination: missionForm.destination.trim(),
        route: missionForm.route
          .filter((s) => s.name.trim())
          .map((s) => ({ name: s.name.trim(), congestion: s.congestion, lengthKm: Number(s.lengthKm) || 0 })),
      });
      toast.success("Emergency mission created — awaiting dispatch");
      setMissionDialog(false);
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Create failed");
    } finally {
      setSavingMission(false);
    }
  };

  const dispatch = async () => {
    if (!dispatchTarget) return;
    if (!dispatchAmbId) {
      toast.error("Select an available ambulance");
      return;
    }
    setDispatching(true);
    try {
      await patch(`/api/missions/${dispatchTarget.id}`, { action: "dispatch", ambulanceId: dispatchAmbId });
      const amb = ambulances.find((a) => a.id === dispatchAmbId);
      toast.success(`${dispatchTarget.requestRef} dispatched with ${amb?.code ?? "ambulance"} — green corridor armed`);
      setDispatchTarget(null);
      setDispatchAmbId("");
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Dispatch failed");
    } finally {
      setDispatching(false);
    }
  };

  const runMissionAction = async () => {
    if (!pendingAction) return;
    setRunningAction(true);
    try {
      await patch(`/api/missions/${pendingAction.mission.id}`, { action: pendingAction.action });
      const msg =
        pendingAction.action === "advance"
          ? `${pendingAction.mission.requestRef} advanced along the corridor`
          : pendingAction.action === "complete"
            ? `${pendingAction.mission.requestRef} completed — ambulance released`
            : `${pendingAction.mission.requestRef} cancelled`;
      toast.success(msg);
      setPendingAction(null);
      setSheet(null);
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Action failed");
    } finally {
      setRunningAction(false);
    }
  };

  /* ------------------------------- sheet events ------------------------------ */

  const openSheet = (m: Mission) => {
    setSheet(m);
    setEventsLoading(true);
    get<CorridorEvent[]>(`/api/corridor-events?missionId=${m.id}`)
      .then((rows) => setEvents(Array.isArray(rows) ? rows : []))
      .catch(() => setEvents([]))
      .finally(() => setEventsLoading(false));
  };

  const sheetRoute = useMemo(() => parseRoute(sheet?.route), [sheet]);

  /* --------------------------------- render -------------------------------- */

  return (
    <div className="space-y-6">
      <PageHeader
        title="Ambulance & Green Corridor"
        description="Fleet management and V2X green-corridor emergency missions."
        icon={<AmbulanceIcon className="size-5" aria-hidden="true" />}
        actions={
          <>
            <Button variant="outline" onClick={load} aria-label="Refresh fleet and missions">
              <RefreshCw className="size-4" aria-hidden="true" /> Refresh
            </Button>
            <Button variant="outline" onClick={openAmbCreate}>
              <Plus className="size-4" aria-hidden="true" /> Ambulance
            </Button>
            <Button onClick={openMissionCreate}>
              <Siren className="size-4" aria-hidden="true" /> New mission
            </Button>
          </>
        }
      />

      {/* fleet stats */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Available" value={fleetCounts.available} accent="emerald" icon={<CheckCircle2 className="size-5" aria-hidden="true" />} loading={loading} />
        <StatCard label="On mission" value={fleetCounts.onMission} accent="red" icon={<Siren className="size-5" aria-hidden="true" />} loading={loading} />
        <StatCard label="Maintenance" value={fleetCounts.maintenance} accent="amber" icon={<AmbulanceIcon className="size-5" aria-hidden="true" />} loading={loading} />
        <StatCard label="Active missions" value={activeMissions} accent="cyan" icon={<Route className="size-5" aria-hidden="true" />} loading={loading} hint="Requested → arrived" />
      </div>

      {/* ============================ FLEET TABLE ============================ */}
      <SectionCard
        title="Fleet"
        description="Ambulances on roster — BLS, ALS, PTV and neonatal units."
        icon={<AmbulanceIcon className="size-4" aria-hidden="true" />}
      >
        {loading ? (
          <div className="space-y-2" aria-busy="true">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-12 rounded-lg" />
            ))}
          </div>
        ) : ambulances.length === 0 ? (
          <EmptyState
            icon={<AmbulanceIcon className="size-8" aria-hidden="true" />}
            title="No ambulances on the roster"
            hint="Add your first ambulance so missions can be dispatched."
          >
            <Button variant="outline" onClick={openAmbCreate}>
              <Plus className="size-4" aria-hidden="true" /> Add ambulance
            </Button>
          </EmptyState>
        ) : (
          <>
            {/* mobile cards */}
            <ul className="space-y-2 sm:hidden">
              {ambulances.map((a) => (
                <li key={a.id} className="rounded-lg border p-3">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-sm font-semibold">{a.code}</span>
                    <Badge variant="outline" className="border-teal-500/30 bg-teal-500/10 text-teal-700 dark:text-teal-400">
                      {a.type}
                    </Badge>
                    <Badge variant="outline" className={cn("ml-auto", AMB_STATUS[a.status] ?? "")}>
                      {titleCase(a.status)}
                    </Badge>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {a.base} · {a.driverName}
                  </p>
                  <div className="mt-2 flex gap-1.5">
                    <Button variant="outline" size="sm" onClick={() => openAmbEdit(a)} aria-label={`Edit ${a.code}`}>
                      <Pencil className="size-3.5" aria-hidden="true" /> Edit
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="ml-auto text-red-600 hover:bg-red-500/10 dark:text-red-400"
                      onClick={() => setDeleteAmb(a)}
                      aria-label={`Delete ${a.code}`}
                    >
                      <Trash2 className="size-3.5" aria-hidden="true" />
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
            {/* desktop table */}
            <div className="hidden overflow-x-auto rounded-lg border sm:block">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Code</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Base</TableHead>
                    <TableHead>Driver</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {ambulances.map((a) => (
                    <TableRow key={a.id}>
                      <TableCell className="font-mono font-medium">{a.code}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className="border-teal-500/30 bg-teal-500/10 text-teal-700 dark:text-teal-400">
                          {labelOf(typeOptions.options, a.type)}
                        </Badge>
                      </TableCell>
                      <TableCell>{a.base}</TableCell>
                      <TableCell>
                        {a.driverName}
                        {a.driverPhone ? <span className="block text-xs text-muted-foreground">{a.driverPhone}</span> : null}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className={cn(AMB_STATUS[a.status] ?? "")}>
                          {titleCase(a.status)}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1.5">
                          <Button variant="outline" size="sm" onClick={() => openAmbEdit(a)} aria-label={`Edit ${a.code}`}>
                            <Pencil className="size-3.5" aria-hidden="true" />
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            className="text-red-600 hover:bg-red-500/10 dark:text-red-400"
                            onClick={() => setDeleteAmb(a)}
                            aria-label={`Delete ${a.code}`}
                          >
                            <Trash2 className="size-3.5" aria-hidden="true" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </>
        )}
      </SectionCard>

      {/* ============================= MISSIONS ============================= */}
      <SectionCard
        title="Emergency missions"
        description="Live green-corridor runs with congestion-aware alerts."
        icon={<Siren className="size-4" aria-hidden="true" />}
        actions={
          <div className="flex flex-wrap gap-1.5">
            {MISSION_FILTERS.map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => setMissionFilter(f)}
                aria-pressed={missionFilter === f}
                className={cn(
                  "rounded-full border px-2.5 py-1 text-xs font-medium transition",
                  missionFilter === f
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border text-muted-foreground hover:bg-accent"
                )}
              >
                {f === "ALL" ? "All" : titleCase(f)}
              </button>
            ))}
          </div>
        }
      >
        {loading ? (
          <div className="space-y-2" aria-busy="true">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-24 rounded-xl" />
            ))}
          </div>
        ) : filteredMissions.length === 0 ? (
          <EmptyState
            icon={<Route className="size-8" aria-hidden="true" />}
            title={missions.length === 0 ? "No missions yet" : "No missions match this filter"}
            hint={
              missions.length === 0
                ? "Create a mission when an emergency request arrives, then dispatch the nearest ambulance."
                : "Try another status filter."
            }
          >
            {missions.length === 0 && (
              <Button onClick={openMissionCreate}>
                <Siren className="size-4" aria-hidden="true" /> New mission
              </Button>
            )}
          </EmptyState>
        ) : (
          <ul className="space-y-3">
            {filteredMissions.map((m) => (
              <li key={m.id} className="rounded-xl border p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-sm font-semibold">{m.requestRef}</span>
                  <Badge variant="outline" className={cn(PRIORITY[m.priority] ?? PRIORITY.MEDIUM)}>
                    {titleCase(m.priority)}
                  </Badge>
                  <Badge variant="outline" className={cn(MISSION_STATUS[m.status] ?? "")}>
                    {titleCase(m.status)}
                  </Badge>
                  {m.corridorActive && (
                    <Badge variant="outline" className="border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-400">
                      <Zap className="size-3" aria-hidden="true" /> Corridor active
                    </Badge>
                  )}
                  <span className="ml-auto text-xs text-muted-foreground">
                    {m.ambulance ? `${m.ambulance.code} · ${m.ambulance.driverName}` : "Unassigned"}
                  </span>
                </div>
                <p className="mt-2 text-sm font-medium">
                  {m.patientName} · {labelOf(emergencyOptions.options, m.emergencyType)}
                </p>
                <p className="mt-0.5 flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
                  {m.pickup} <ArrowRight className="inline size-3" aria-hidden="true" /> {m.destination}
                </p>
                <div className="mt-3 flex items-center gap-3">
                  <Progress value={m.progress} className="h-2 flex-1 [&>div]:bg-red-500" aria-label={`Mission progress ${m.progress}%`} />
                  <span className="text-xs font-medium">{m.progress}%</span>
                </div>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  <Button variant="outline" size="sm" onClick={() => openSheet(m)} aria-label={`View ${m.requestRef}`}>
                    View
                  </Button>
                  {m.status === "REQUESTED" && (
                    <Button size="sm" onClick={() => { setDispatchTarget(m); setDispatchAmbId(""); }}>
                      <AmbulanceIcon className="size-3.5" aria-hidden="true" /> Dispatch
                    </Button>
                  )}
                  {(m.status === "DISPATCHED" || m.status === "EN_ROUTE") && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setPendingAction({ mission: m, action: "advance" })}
                      aria-label={`Advance ${m.requestRef}`}
                    >
                      <ArrowRight className="size-3.5" aria-hidden="true" /> Advance
                    </Button>
                  )}
                  {m.status === "ARRIVED" && (
                    <Button
                      size="sm"
                      className="bg-emerald-600 text-white hover:bg-emerald-700"
                      onClick={() => setPendingAction({ mission: m, action: "complete" })}
                      aria-label={`Complete ${m.requestRef}`}
                    >
                      <CheckCircle2 className="size-3.5" aria-hidden="true" /> Complete
                    </Button>
                  )}
                  {!["COMPLETED", "CANCELLED"].includes(m.status) && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="text-red-600 hover:bg-red-500/10 dark:text-red-400"
                      onClick={() => setPendingAction({ mission: m, action: "cancel" })}
                      aria-label={`Cancel ${m.requestRef}`}
                    >
                      <Ban className="size-3.5" aria-hidden="true" /> Cancel
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>

      {/* ============================ MISSION SHEET ============================ */}
      <Sheet open={!!sheet} onOpenChange={(o) => !o && setSheet(null)}>
        <SheetContent side="right" className="w-full overflow-y-auto p-0 sm:max-w-md">
          {sheet && (
            <div className="space-y-5 p-5">
              <SheetHeader className="p-0 text-left">
                <SheetTitle className="flex items-center gap-2">
                  <span className="font-mono">{sheet.requestRef}</span>
                  <Badge variant="outline" className={cn("ml-auto", MISSION_STATUS[sheet.status] ?? "")}>
                    {titleCase(sheet.status)}
                  </Badge>
                </SheetTitle>
                <SheetDescription>
                  {sheet.patientName} · {labelOf(emergencyOptions.options, sheet.emergencyType)}
                </SheetDescription>
              </SheetHeader>

              {sheet.corridorActive && (
                <div
                  role="status"
                  className="flex items-center gap-2 rounded-xl border border-red-500/40 bg-red-500/10 px-3 py-2.5 text-sm font-semibold text-red-700 dark:text-red-400"
                >
                  <Zap className="size-4 animate-pulse" aria-hidden="true" />
                  Green corridor ACTIVE
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <DataField label="Patient" value={sheet.patientName} />
                <DataField label="Contact" value={sheet.contact} mono />
                <DataField
                  label="Emergency"
                  value={
                    <Badge variant="outline" className="border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-400">
                      {labelOf(emergencyOptions.options, sheet.emergencyType)}
                    </Badge>
                  }
                />
                <DataField
                  label="Priority"
                  value={
                    <Badge variant="outline" className={cn(PRIORITY[sheet.priority] ?? "")}>
                      {titleCase(sheet.priority)}
                    </Badge>
                  }
                />
                <DataField label="Vehicles alerted" value={(sheet.vehiclesAlerted ?? 0).toLocaleString("en-IN")} />
                <DataField label="Time saved" value={formatDuration(sheet.timeSavedSec)} />
                <DataField label="Ambulance" value={sheet.ambulance ? `${sheet.ambulance.code} (${sheet.ambulance.type})` : "Unassigned"} />
                <DataField label="ETA" value={sheet.etaMin ? `${sheet.etaMin} min` : "—"} />
              </div>

              <SectionCard title="Route" description={`${sheet.pickup} → ${sheet.destination}`}>
                {sheetRoute.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Route is generated when the mission is dispatched.</p>
                ) : (
                  <ol className="space-y-2">
                    {sheetRoute.map((seg, i) => (
                      <li key={i} className="flex items-center gap-2 rounded-lg border px-3 py-2 text-sm">
                        <span className="grid size-6 shrink-0 place-items-center rounded-full bg-muted text-[11px] font-semibold">
                          {i + 1}
                        </span>
                        <span className="min-w-0 flex-1 truncate">{seg.name}</span>
                        <span className="hidden text-xs text-muted-foreground sm:inline">{seg.lengthKm} km</span>
                        <Badge variant="outline" className={cn("shrink-0", CONGESTION[seg.congestion] ?? "")}>
                          {titleCase(seg.congestion)}
                        </Badge>
                      </li>
                    ))}
                  </ol>
                )}
                <div className="mt-3 flex items-center gap-3">
                  <Progress value={sheet.progress} className="h-2 flex-1 [&>div]:bg-red-500" aria-label="Mission progress" />
                  <span className="text-xs font-medium">{sheet.progress}%</span>
                </div>
              </SectionCard>

              <SectionCard title="Corridor events" description="Alert ladder per congested segment">
                {eventsLoading ? (
                  <div className="space-y-2" aria-busy="true">
                    {[0, 1].map((i) => (
                      <Skeleton key={i} className="h-14 rounded-lg" />
                    ))}
                  </div>
                ) : events.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    No corridor events — they are recorded when the mission is dispatched.
                  </p>
                ) : (
                  <ol className="space-y-2">
                    {events.map((ev) => (
                      <li key={ev.id} className="rounded-lg border p-3">
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge variant="outline" className={cn("font-mono", METHOD[ev.method] ?? "")}>
                            {ev.method}
                          </Badge>
                          <Badge variant="outline" className={cn(CONGESTION[ev.congestion] ?? "")}>
                            {titleCase(ev.congestion)}
                          </Badge>
                          <span className="ml-auto text-xs text-muted-foreground">
                            {formatDateTime(ev.createdAt)}
                          </span>
                        </div>
                        <p className="mt-1.5 text-sm font-medium">{ev.segment}</p>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {ev.vehiclesAlerted.toLocaleString("en-IN")} vehicles alerted ·{" "}
                          {formatDuration(ev.timeSavedSec)} saved
                        </p>
                        {ev.note && <p className="mt-1 text-xs italic text-muted-foreground">{ev.note}</p>}
                      </li>
                    ))}
                  </ol>
                )}
              </SectionCard>

              {!["COMPLETED", "CANCELLED"].includes(sheet.status) && (
                <div className="flex flex-wrap gap-2 border-t pt-4">
                  {sheet.status === "REQUESTED" && (
                    <Button size="sm" onClick={() => { setDispatchTarget(sheet); setDispatchAmbId(""); }}>
                      <AmbulanceIcon className="size-3.5" aria-hidden="true" /> Dispatch
                    </Button>
                  )}
                  {(sheet.status === "DISPATCHED" || sheet.status === "EN_ROUTE") && (
                    <Button size="sm" variant="outline" onClick={() => setPendingAction({ mission: sheet, action: "advance" })}>
                      <ArrowRight className="size-3.5" aria-hidden="true" /> Advance
                    </Button>
                  )}
                  {sheet.status === "ARRIVED" && (
                    <Button
                      size="sm"
                      className="bg-emerald-600 text-white hover:bg-emerald-700"
                      onClick={() => setPendingAction({ mission: sheet, action: "complete" })}
                    >
                      <Flag className="size-3.5" aria-hidden="true" /> Complete
                    </Button>
                  )}
                </div>
              )}
            </div>
          )}
        </SheetContent>
      </Sheet>

      {/* ============================ DISPATCH DIALOG =========================== */}
      <Dialog open={!!dispatchTarget} onOpenChange={(o) => !o && setDispatchTarget(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Dispatch {dispatchTarget?.requestRef}</DialogTitle>
            <DialogDescription>
              {dispatchTarget?.patientName} · {dispatchTarget?.pickup} → {dispatchTarget?.destination}. Only
              AVAILABLE ambulances can be dispatched; the corridor arms automatically.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <Label>Ambulance</Label>
            <Select value={dispatchAmbId} onValueChange={setDispatchAmbId}>
              <SelectTrigger aria-label="Select ambulance">
                <SelectValue placeholder="Select an available ambulance" />
              </SelectTrigger>
              <SelectContent>
                {ambulances
                  .filter((a) => a.status === "AVAILABLE")
                  .map((a) => (
                    <SelectItem key={a.id} value={a.id}>
                      {a.code} · {a.type} · {a.driverName}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
            {ambulances.filter((a) => a.status === "AVAILABLE").length === 0 && (
              <p className="text-xs text-red-600 dark:text-red-400">No ambulances are currently available.</p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDispatchTarget(null)}>
              Cancel
            </Button>
            <Button onClick={dispatch} disabled={dispatching || !dispatchAmbId}>
              {dispatching ? "Dispatching…" : "Dispatch"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ============================= NEW MISSION ============================= */}
      <Dialog open={missionDialog} onOpenChange={setMissionDialog}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>New emergency mission</DialogTitle>
            <DialogDescription>
              Log the request. Route segments are advisory — the corridor engine simulates live
              congestion when the mission is dispatched.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor="ms-patient">Patient name *</Label>
                <Input
                  id="ms-patient"
                  value={missionForm.patientName}
                  onChange={(e) => setMissionForm({ ...missionForm, patientName: e.target.value })}
                  placeholder="Ramesh Gowda"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="ms-contact">Contact *</Label>
                <Input
                  id="ms-contact"
                  value={missionForm.contact}
                  onChange={(e) => setMissionForm({ ...missionForm, contact: e.target.value })}
                  placeholder="+91 98xxxxxx90"
                />
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label>Emergency type</Label>
                <Select
                  value={missionForm.emergencyType}
                  onValueChange={(v) => setMissionForm({ ...missionForm, emergencyType: v })}
                >
                  <SelectTrigger aria-label="Emergency type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {emergencyOptions.options.map((o) => (
                      <SelectItem key={o.value} value={o.value}>
                        {o.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label>Priority</Label>
                <Select value={missionForm.priority} onValueChange={(v) => setMissionForm({ ...missionForm, priority: v })}>
                  <SelectTrigger aria-label="Priority">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="CRITICAL">Critical</SelectItem>
                    <SelectItem value="HIGH">High</SelectItem>
                    <SelectItem value="MEDIUM">Medium</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor="ms-pickup">Pickup *</Label>
                <Input
                  id="ms-pickup"
                  value={missionForm.pickup}
                  onChange={(e) => setMissionForm({ ...missionForm, pickup: e.target.value })}
                  placeholder="Sahakar Nagar, Bengaluru"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="ms-dest">Destination *</Label>
                <Input
                  id="ms-dest"
                  value={missionForm.destination}
                  onChange={(e) => setMissionForm({ ...missionForm, destination: e.target.value })}
                  placeholder="Victoria Hospital"
                />
              </div>
            </div>

            <div className="grid gap-2">
              <div className="flex items-center justify-between">
                <Label>Planned route segments</Label>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    setMissionForm((f) => ({
                      ...f,
                      route: [...f.route, { name: "", congestion: "MODERATE", lengthKm: "1" }],
                    }))
                  }
                  aria-label="Add route segment"
                >
                  <Plus className="size-3.5" aria-hidden="true" /> Add segment
                </Button>
              </div>
              <div className="space-y-2">
                {missionForm.route.map((seg, i) => (
                  <div key={i} className="grid grid-cols-[1fr_112px_72px_36px] items-center gap-2">
                    <Input
                      value={seg.name}
                      onChange={(e) =>
                        setMissionForm((f) => ({
                          ...f,
                          route: f.route.map((s, j) => (j === i ? { ...s, name: e.target.value } : s)),
                        }))
                      }
                      placeholder="Segment name"
                      aria-label={`Segment ${i + 1} name`}
                    />
                    <Select
                      value={seg.congestion}
                      onValueChange={(v) =>
                        setMissionForm((f) => ({
                          ...f,
                          route: f.route.map((s, j) => (j === i ? { ...s, congestion: v } : s)),
                        }))
                      }
                    >
                      <SelectTrigger aria-label={`Segment ${i + 1} congestion`}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="LOW">Low</SelectItem>
                        <SelectItem value="MODERATE">Moderate</SelectItem>
                        <SelectItem value="HEAVY">Heavy</SelectItem>
                        <SelectItem value="GRIDLOCK">Gridlock</SelectItem>
                      </SelectContent>
                    </Select>
                    <Input
                      type="number"
                      min={0}
                      step="0.1"
                      value={seg.lengthKm}
                      onChange={(e) =>
                        setMissionForm((f) => ({
                          ...f,
                          route: f.route.map((s, j) => (j === i ? { ...s, lengthKm: e.target.value } : s)),
                        }))
                      }
                      aria-label={`Segment ${i + 1} length (km)`}
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => setMissionForm((f) => ({ ...f, route: f.route.filter((_, j) => j !== i) }))}
                      aria-label={`Remove segment ${i + 1}`}
                      disabled={missionForm.route.length <= 1}
                    >
                      <Trash2 className="size-4" aria-hidden="true" />
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setMissionDialog(false)}>
              Cancel
            </Button>
            <Button onClick={saveMission} disabled={savingMission}>
              {savingMission ? "Creating…" : "Create mission"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* =========================== AMBULANCE DIALOG =========================== */}
      <Dialog open={ambDialog} onOpenChange={setAmbDialog}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{editingAmb ? `Edit ${editingAmb.code}` : "Add ambulance"}</DialogTitle>
            <DialogDescription>Roster entry for the emergency fleet.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor="amb-code">Code *</Label>
                <Input
                  id="amb-code"
                  value={ambForm.code}
                  onChange={(e) => setAmbForm({ ...ambForm, code: e.target.value.toUpperCase() })}
                  placeholder="KA-01-ARB-108"
                  className="font-mono"
                  disabled={!!editingAmb}
                />
              </div>
              <div className="grid gap-2">
                <Label>Type</Label>
                <Select value={ambForm.type} onValueChange={(v) => setAmbForm({ ...ambForm, type: v })}>
                  <SelectTrigger aria-label="Ambulance type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {typeOptions.options.map((o) => (
                      <SelectItem key={o.value} value={o.value}>
                        {o.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="amb-base">Base *</Label>
              <Input
                id="amb-base"
                value={ambForm.base}
                onChange={(e) => setAmbForm({ ...ambForm, base: e.target.value })}
                placeholder="Hebbal station"
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor="amb-driver">Driver name *</Label>
                <Input
                  id="amb-driver"
                  value={ambForm.driverName}
                  onChange={(e) => setAmbForm({ ...ambForm, driverName: e.target.value })}
                  placeholder="Manoj Kumar"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="amb-phone">Driver phone</Label>
                <Input
                  id="amb-phone"
                  value={ambForm.driverPhone}
                  onChange={(e) => setAmbForm({ ...ambForm, driverPhone: e.target.value })}
                  placeholder="+91 98xxxxxx00"
                />
              </div>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="amb-crew">Crew</Label>
              <Input
                id="amb-crew"
                value={ambForm.crew}
                onChange={(e) => setAmbForm({ ...ambForm, crew: e.target.value })}
                placeholder="Paramedic: Sunita; EMT: Rahul"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="amb-equip">Equipment</Label>
              <Input
                id="amb-equip"
                value={ambForm.equipment}
                onChange={(e) => setAmbForm({ ...ambForm, equipment: e.target.value })}
                placeholder="defibrillator, oxygen, stretcher, ventilator"
              />
              <p className="text-xs text-muted-foreground">Separate items with commas.</p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAmbDialog(false)}>
              Cancel
            </Button>
            <Button onClick={saveAmb} disabled={savingAmb}>
              {savingAmb ? "Saving…" : editingAmb ? "Save changes" : "Add ambulance"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ====================== AMBULANCE DELETE CONFIRM ======================= */}
      <AlertDialog open={!!deleteAmb} onOpenChange={(o) => !o && setDeleteAmb(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove ambulance {deleteAmb?.code}?</AlertDialogTitle>
            <AlertDialogDescription>
              The unit is taken off the roster permanently. Missions it served keep their history.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep ambulance</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 text-white hover:bg-red-700"
              onClick={(e) => {
                e.preventDefault();
                removeAmb();
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ======================= MISSION ACTION CONFIRM ======================== */}
      <AlertDialog open={!!pendingAction} onOpenChange={(o) => !o && setPendingAction(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {pendingAction?.action === "advance"
                ? "Advance mission?"
                : pendingAction?.action === "complete"
                  ? "Complete mission?"
                  : "Cancel mission?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {pendingAction?.action === "advance" &&
                `${pendingAction.mission.requestRef} moves one step closer to the hospital (progress +25%).`}
              {pendingAction?.action === "complete" &&
                `${pendingAction.mission.requestRef} will be closed and the ambulance returned to AVAILABLE.`}
              {pendingAction?.action === "cancel" &&
                `${pendingAction.mission.requestRef} will be cancelled and the green corridor disarmed.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Go back</AlertDialogCancel>
            <AlertDialogAction
              className={cn(
                pendingAction?.action === "cancel" ? "bg-red-600 text-white hover:bg-red-700" : "bg-primary text-primary-foreground hover:bg-primary/90"
              )}
              onClick={(e) => {
                e.preventDefault();
                runMissionAction();
              }}
            >
              {runningAction
                ? "Working…"
                : pendingAction?.action === "advance"
                  ? "Advance"
                  : pendingAction?.action === "complete"
                    ? "Complete"
                    : "Cancel mission"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
