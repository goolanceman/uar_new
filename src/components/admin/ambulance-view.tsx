"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Ambulance as AmbulanceIcon, CheckCheck, ChevronsRight, Clock, MapPin, Pencil,
  Phone, Plus, Radio, RadioTower, RefreshCw, Siren, Timer, Trash2, Wrench, X,
} from "lucide-react";
import {
  Bar, BarChart, CartesianGrid, Cell, Legend, Pie, PieChart, ResponsiveContainer,
  Tooltip, XAxis, YAxis,
} from "recharts";
import { toast } from "sonner";
import { del, get, patch, post } from "@/lib/api-client";
import { labelOf, useMasters } from "@/hooks/use-masters";
import { cn, timeAgo, titleCase } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card, CardContent, CardDescription, CardHeader, CardTitle,
} from "@/components/ui/card";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

// ============================== TYPES ==============================

interface RouteSegment {
  name: string;
  congestion: string;
  lengthKm: number;
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
}

interface CorridorEvent {
  id: string;
  missionId: string;
  segment: string;
  method: string;
  congestion: string;
  vehiclesAlerted: number;
  timeSavedSec: number;
  note?: string | null;
  createdAt: string;
}

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

interface CorridorStats {
  missions?: number;
  totalMissions?: number;
  vehiclesAlerted?: number;
  totalVehiclesAlerted?: number;
  timeSavedSec?: number;
  totalSavedSec?: number;
  timeSavedMin?: number;
  avgSavedSec?: number;
  bySegment?: { segment: string; savedSec: number }[];
  byMethod?: { method: string; count: number }[];
}

interface MissionForm {
  patientName: string;
  contact: string;
  emergencyType: string;
  priority: string;
  pickup: string;
  destination: string;
}

interface FleetForm {
  code: string;
  type: string;
  base: string;
  driverName: string;
  driverPhone: string;
  crew: string;
  equipment: string;
}

// ============================== CONSTANTS ==============================

const MISSION_STATUS: Record<string, { label: string; cls: string }> = {
  REQUESTED: { label: "Requested", cls: "border-amber-200 bg-amber-50 text-amber-800" },
  DISPATCHED: { label: "Dispatched", cls: "border-orange-200 bg-orange-50 text-orange-800" },
  EN_ROUTE: { label: "En route", cls: "border-teal-200 bg-teal-50 text-teal-800" },
  ARRIVED: { label: "Arrived", cls: "border-lime-200 bg-lime-50 text-lime-800" },
  COMPLETED: { label: "Completed", cls: "border-emerald-200 bg-emerald-50 text-emerald-800" },
  CANCELLED: { label: "Cancelled", cls: "border-zinc-200 bg-zinc-100 text-zinc-600" },
};

const PRIORITY_CLS: Record<string, string> = {
  CRITICAL: "border-red-600 bg-red-600 text-white animate-pulse",
  HIGH: "border-orange-200 bg-orange-100 text-orange-800",
  MEDIUM: "border-amber-200 bg-amber-50 text-amber-800",
};

const AMB_STATUS: Record<string, string> = {
  AVAILABLE: "border-lime-200 bg-lime-50 text-lime-800",
  ON_MISSION: "border-amber-200 bg-amber-50 text-amber-800",
  MAINTENANCE: "border-zinc-200 bg-zinc-100 text-zinc-600",
};

const CONGESTION_COLOR: Record<string, string> = {
  LOW: "#059669",
  MODERATE: "#d97706",
  HEAVY: "#ea580c",
  GRIDLOCK: "#dc2626",
};

const METHOD_LABEL: Record<string, string> = {
  V2X_5G: "V2X 5G",
  CELL_BROADCAST: "CELL",
  BLE_MESH: "BLE MESH",
  FM_RDS: "FM RDS",
  SIREN: "SIREN",
};

const PIE_COLORS = ["#059669", "#d97706", "#ea580c", "#dc2626", "#0d9488", "#65a30d"];

const EMPTY_MISSION_FORM: MissionForm = {
  patientName: "",
  contact: "",
  emergencyType: "CARDIAC",
  priority: "HIGH",
  pickup: "",
  destination: "",
};

const EMPTY_FLEET_FORM: FleetForm = {
  code: "",
  type: "BLS",
  base: "",
  driverName: "",
  driverPhone: "",
  crew: "",
  equipment: "",
};

function parseRoute(routeJson: string | null | undefined): RouteSegment[] {
  const fallback: RouteSegment[] = [
    { name: "Pickup road", congestion: "MODERATE", lengthKm: 1.2 },
    { name: "Main avenue", congestion: "HEAVY", lengthKm: 2.4 },
    { name: "Flyover stretch", congestion: "LOW", lengthKm: 1.8 },
    { name: "Hospital approach", congestion: "MODERATE", lengthKm: 0.9 },
  ];
  if (!routeJson) return fallback;
  try {
    const parsed = JSON.parse(routeJson) as RouteSegment[];
    if (!Array.isArray(parsed) || parsed.length === 0) return fallback;
    return parsed.slice(0, 5).map((s) => ({
      name: String(s?.name ?? "Segment"),
      congestion: String(s?.congestion ?? "MODERATE"),
      lengthKm: Number(s?.lengthKm) || 1,
    }));
  } catch {
    return fallback;
  }
}

// ============================== CORRIDOR MAP ==============================

function CorridorMap({ mission, events }: { mission: Mission; events: CorridorEvent[] }) {
  const segments = useMemo(() => parseRoute(mission.route), [mission.route]);
  const corridorLive =
    mission.corridorActive &&
    (mission.status === "DISPATCHED" || mission.status === "EN_ROUTE");

  const alerted = useMemo(() => {
    const map = new Map<string, { method: string; vehicles: number; saved: number }>();
    for (const ev of events) {
      const prev = map.get(ev.segment);
      map.set(ev.segment, {
        method: ev.method,
        vehicles: (prev?.vehicles ?? 0) + (ev.vehiclesAlerted || 0),
        saved: (prev?.saved ?? 0) + (ev.timeSavedSec || 0),
      });
    }
    return map;
  }, [events]);

  // Layout: segments laid left → right across the road
  const START_X = 20;
  const END_X = 780;
  const GAP = 6;
  const usable = END_X - START_X - GAP * (segments.length - 1);
  const totalLen = segments.reduce((s, seg) => s + Math.max(seg.lengthKm, 0.4), 0);

  const boxes = useMemo(() => {
    const out: { seg: (typeof segments)[number]; x: number; w: number }[] = [];
    let cursor = START_X;
    for (const seg of segments) {
      const w = (Math.max(seg.lengthKm, 0.4) / totalLen) * usable;
      out.push({ seg, x: cursor, w });
      cursor += w + GAP;
    }
    return out;
  }, [segments, totalLen, usable]);

  const progress = Math.min(100, Math.max(0, mission.progress || 0));
  const showAmbulance = mission.status !== "REQUESTED" && mission.status !== "CANCELLED";
  const markerX = START_X + 14 + (progress / 100) * (END_X - START_X - 28);

  return (
    <div className="overflow-x-auto rounded-lg border bg-muted/30 p-2">
      <svg
        viewBox="0 0 800 160"
        className="min-w-[640px] w-full"
        role="img"
        aria-label={`Green corridor map for ${mission.requestRef}: ${segments.length} route segments, progress ${progress}%`}
      >
        {/* pickup / destination labels */}
        <text x={20} y={18} fontSize={11} fontWeight={700} fill="#52525b">
          ▲ {mission.pickup.slice(0, 28)}
        </text>
        <text x={780} y={18} fontSize={11} fontWeight={700} fill="#52525b" textAnchor="end">
          {mission.destination.slice(0, 28)} ▲
        </text>

        {/* base road */}
        <rect x={14} y={58} width={772} height={44} rx={12} fill="#fafaf9" stroke="#e4e4e7" />
        <line x1={24} y1={80} x2={776} y2={80} stroke="#d4d4d8" strokeWidth={2} strokeDasharray="10 8" />

        {boxes.map(({ seg, x, w }, i) => {
          const info = alerted.get(seg.name);
          const isActiveSeg = corridorLive && !!info;
          const color = CONGESTION_COLOR[seg.congestion] ?? CONGESTION_COLOR.MODERATE;
          const dots = 3 + (i % 3);
          const cx = x + w / 2;
          return (
            <g key={`${seg.name}-${i}`}>
              <rect
                x={x}
                y={58}
                width={w}
                height={44}
                rx={8}
                fill={color}
                opacity={0.88}
                stroke={isActiveSeg ? "#047857" : "none"}
                strokeWidth={2}
              />
              {/* vehicle dots */}
              {Array.from({ length: dots }).map((_, j) => {
                const vx = x + (w * (j + 0.5)) / dots;
                const baseY = j % 2 === 0 ? 70 : 90;
                const alertedY = j % 2 === 0 ? 64 : 96;
                return (
                  <circle
                    key={j}
                    className="transition-all duration-700"
                    cx={vx}
                    cy={isActiveSeg ? alertedY : baseY}
                    r={3.5}
                    fill={isActiveSeg ? "#059669" : "#a1a1aa"}
                    opacity={isActiveSeg ? 0.95 : 0.8}
                  />
                );
              })}
              {/* pulse ring on alerted segments */}
              {isActiveSeg ? (
                <circle cx={cx} cy={80} r={8} fill="none" stroke="#059669" strokeWidth={2}>
                  <animate attributeName="r" values="8;26" dur="1.6s" repeatCount="indefinite" />
                  <animate attributeName="opacity" values="0.8;0" dur="1.6s" repeatCount="indefinite" />
                </circle>
              ) : null}
              {/* labels */}
              <text x={cx} y={48} fontSize={11} fontWeight={600} fill="#3f3f46" textAnchor="middle">
                {seg.name.length > 16 ? `${seg.name.slice(0, 15)}…` : seg.name}
              </text>
              <text x={cx} y={117} fontSize={9.5} fill="#a1a1aa" textAnchor="middle">
                {seg.lengthKm} km
              </text>
              {isActiveSeg ? (
                <text x={cx} y={135} fontSize={10} fontWeight={700} fill="#047857" textAnchor="middle">
                  {METHOD_LABEL[info.method] ?? info.method} · {info.vehicles} veh
                </text>
              ) : null}
            </g>
          );
        })}

        {/* ambulance marker — white cross in red rounded square */}
        {showAmbulance ? (
          <g style={{ transform: `translate(${markerX}px, 80px)`, transition: "transform 900ms linear" }}>
            <rect x={-14} y={-14} width={28} height={28} rx={8} fill="#dc2626" stroke="#ffffff" strokeWidth={2} />
            <rect x={-2.5} y={-9} width={5} height={18} rx={1.5} fill="#ffffff" />
            <rect x={-9} y={-2.5} width={18} height={5} rx={1.5} fill="#ffffff" />
          </g>
        ) : (
          <text x={34} y={85} fontSize={10} fontWeight={600} fill="#71717a">
            awaiting dispatch…
          </text>
        )}
      </svg>
    </div>
  );
}

// ============================== MAIN VIEW ==============================

export default function AmbulanceView() {
  const [tab, setTab] = useState("live");

  // live ops
  const [missions, setMissions] = useState<Mission[]>([]);
  const [events, setEvents] = useState<CorridorEvent[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loadingMissions, setLoadingMissions] = useState(true);
  const [newOpen, setNewOpen] = useState(false);
  const [missionForm, setMissionForm] = useState<MissionForm>(EMPTY_MISSION_FORM);
  const [savingMission, setSavingMission] = useState(false);
  const [dispatchOpen, setDispatchOpen] = useState(false);
  const [dispatchMission, setDispatchMission] = useState<Mission | null>(null);
  const [availableAmbulances, setAvailableAmbulances] = useState<Ambulance[]>([]);
  const [dispatchAmbulanceId, setDispatchAmbulanceId] = useState("");
  const [dispatching, setDispatching] = useState(false);

  // fleet
  const [ambulances, setAmbulances] = useState<Ambulance[]>([]);
  const [loadingFleet, setLoadingFleet] = useState(true);
  const [fleetOpen, setFleetOpen] = useState(false);
  const [editingAmbulance, setEditingAmbulance] = useState<Ambulance | null>(null);
  const [fleetForm, setFleetForm] = useState<FleetForm>(EMPTY_FLEET_FORM);
  const [savingFleet, setSavingFleet] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Ambulance | null>(null);

  // analytics
  const [stats, setStats] = useState<CorridorStats>({});
  const [loadingStats, setLoadingStats] = useState(false);

  const emergencyTypeOptions = useMasters("EMERGENCY_TYPE");
  const ambTypeOptions = useMasters("AMBULANCE_TYPE");

  const selected = useMemo(
    () => missions.find((m) => m.id === selectedId) ?? null,
    [missions, selectedId]
  );

  // ---------- data loading ----------
  const loadMissions = useCallback(async () => {
    try {
      const data = await get<Mission[]>("/api/missions");
      setMissions(Array.isArray(data) ? data : []);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load missions");
    } finally {
      setLoadingMissions(false);
    }
  }, []);

  const loadAmbulances = useCallback(async () => {
    try {
      const data = await get<Ambulance[]>("/api/ambulances");
      setAmbulances(Array.isArray(data) ? data : []);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load fleet");
    } finally {
      setLoadingFleet(false);
    }
  }, []);

  const loadEvents = useCallback(async (missionId: string) => {
    try {
      const data = await get<CorridorEvent[]>(
        `/api/corridor-events?missionId=${encodeURIComponent(missionId)}`
      );
      setEvents(Array.isArray(data) ? data : []);
    } catch {
      setEvents([]);
    }
  }, []);

  useEffect(() => {
    loadMissions();
    loadAmbulances();
  }, [loadMissions, loadAmbulances]);

  // poll selected mission + events every 5s while on Live Ops
  useEffect(() => {
    if (tab !== "live") return;
    const id = setInterval(() => {
      loadMissions();
      if (selectedId) loadEvents(selectedId);
    }, 5000);
    return () => clearInterval(id);
  }, [tab, selectedId, loadMissions, loadEvents]);

  const loadStats = useCallback(async () => {
    setLoadingStats(true);
    try {
      const s = await get<CorridorStats>("/api/corridor-stats");
      setStats(s ?? {});
    } catch {
      // derive from missions if the stats endpoint is unavailable
      const usable = missions.filter((m) => m.status !== "CANCELLED");
      const vehicles = usable.reduce((s, m) => s + (m.vehiclesAlerted || 0), 0);
      const saved = usable.reduce((s, m) => s + (m.timeSavedSec || 0), 0);
      setStats({
        missions: usable.length,
        vehiclesAlerted: vehicles,
        timeSavedSec: saved,
        avgSavedSec: usable.length ? Math.round(saved / usable.length) : 0,
        bySegment: [],
        byMethod: [],
      });
    } finally {
      setLoadingStats(false);
    }
  }, [missions]);

  useEffect(() => {
    if (tab === "analytics") loadStats();
  }, [tab, loadStats]);

  // ---------- live ops actions ----------
  const selectMission = (id: string | null) => {
    setSelectedId(id);
    setEvents([]);
    if (id) loadEvents(id);
  };

  const createMission = async () => {
    if (!missionForm.patientName.trim() || !missionForm.pickup.trim() || !missionForm.destination.trim()) {
      toast.error("Patient, pickup and destination are required");
      return;
    }
    setSavingMission(true);
    try {
      const created = await post<Mission>("/api/missions", {
        ...missionForm,
        patientName: missionForm.patientName.trim(),
        contact: missionForm.contact.trim(),
        pickup: missionForm.pickup.trim(),
        destination: missionForm.destination.trim(),
      });
      toast.success(`Emergency logged as ${created?.requestRef ?? "new mission"}`);
      setNewOpen(false);
      setMissionForm(EMPTY_MISSION_FORM);
      await loadMissions();
      if (created?.id) selectMission(created.id);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to log emergency");
    } finally {
      setSavingMission(false);
    }
  };

  const openDispatch = async (m: Mission) => {
    setDispatchMission(m);
    setDispatchAmbulanceId("");
    setAvailableAmbulances([]);
    setDispatchOpen(true);
    try {
      const list = await get<Ambulance[]>("/api/ambulances?status=AVAILABLE");
      setAvailableAmbulances(Array.isArray(list) ? list : []);
    } catch {
      toast.error("Failed to load available ambulances");
    }
  };

  const confirmDispatch = async () => {
    if (!dispatchMission || !dispatchAmbulanceId) {
      toast.error("Select an ambulance to dispatch");
      return;
    }
    setDispatching(true);
    try {
      await patch(`/api/missions/${dispatchMission.id}`, {
        action: "dispatch",
        ambulanceId: dispatchAmbulanceId,
      });
      toast.success(`${dispatchMission.requestRef} dispatched — green corridor armed`);
      setDispatchOpen(false);
      await loadMissions();
      await loadAmbulances();
      if (dispatchMission.id === selectedId) loadEvents(dispatchMission.id);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Dispatch failed");
    } finally {
      setDispatching(false);
    }
  };

  const missionAction = async (m: Mission, action: "advance" | "complete" | "cancel") => {
    try {
      await patch(`/api/missions/${m.id}`, { action });
      toast.success(
        `${m.requestRef} ${action === "advance" ? "advanced" : action === "complete" ? "completed" : "cancelled"}`
      );
      await loadMissions();
      await loadAmbulances();
      if (m.id === selectedId) loadEvents(m.id);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Action failed");
    }
  };

  // ---------- fleet actions ----------
  const openCreateAmbulance = () => {
    setEditingAmbulance(null);
    setFleetForm(EMPTY_FLEET_FORM);
    setFleetOpen(true);
  };

  const openEditAmbulance = (a: Ambulance) => {
    setEditingAmbulance(a);
    setFleetForm({
      code: a.code ?? "",
      type: a.type ?? "BLS",
      base: a.base ?? "",
      driverName: a.driverName ?? "",
      driverPhone: a.driverPhone ?? "",
      crew: a.crew ?? "",
      equipment: a.equipment ?? "",
    });
    setFleetOpen(true);
  };

  const saveAmbulance = async () => {
    if (!fleetForm.code.trim() || !fleetForm.driverName.trim() || !fleetForm.base.trim()) {
      toast.error("Code, base and driver name are required");
      return;
    }
    setSavingFleet(true);
    try {
      const body = {
        code: fleetForm.code.trim().toUpperCase(),
        type: fleetForm.type,
        base: fleetForm.base.trim(),
        driverName: fleetForm.driverName.trim(),
        driverPhone: fleetForm.driverPhone.trim(),
        crew: fleetForm.crew.trim(),
        equipment: fleetForm.equipment.trim(),
      };
      if (editingAmbulance) {
        await patch(`/api/ambulances/${editingAmbulance.id}`, body);
        toast.success(`Ambulance ${body.code} updated`);
      } else {
        await post("/api/ambulances", body);
        toast.success(`Ambulance ${body.code} added to fleet`);
      }
      setFleetOpen(false);
      loadAmbulances();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSavingFleet(false);
    }
  };

  const setAmbulanceStatus = async (a: Ambulance, status: string) => {
    try {
      await patch(`/api/ambulances/${a.id}`, { status });
      toast.success(`${a.code} → ${titleCase(status).toLowerCase()}`);
      loadAmbulances();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Update failed");
    }
  };

  const removeAmbulance = async () => {
    if (!deleteTarget) return;
    try {
      await del(`/api/ambulances/${deleteTarget.id}`);
      toast.success(`${deleteTarget.code} removed from fleet`);
      setDeleteTarget(null);
      loadAmbulances();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Delete failed");
    }
  };

  // ---------- derived ----------
  const activeMissions = missions.filter(
    (m) => !["COMPLETED", "CANCELLED"].includes(m.status)
  );

  const analytics = useMemo(() => {
    const missionCount = stats.missions ?? stats.totalMissions ?? 0;
    const vehicles = stats.vehiclesAlerted ?? stats.totalVehiclesAlerted ?? 0;
    const savedSec = stats.timeSavedSec ?? stats.totalSavedSec ?? 0;
    return {
      missions: missionCount,
      vehicles,
      savedMin: stats.timeSavedMin ?? Math.round(savedSec / 60),
      avg: stats.avgSavedSec ?? (missionCount ? Math.round(savedSec / missionCount) : 0),
      bySegment: stats.bySegment ?? [],
      byMethod: stats.byMethod ?? [],
    };
  }, [stats]);

  const sortedEvents = useMemo(
    () =>
      [...events].sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      ),
    [events]
  );

  return (
    <div className="space-y-4">
      <Tabs value={tab} onValueChange={setTab}>
        <div className="flex flex-wrap items-center gap-2">
          <TabsList>
            <TabsTrigger value="live">
              <span className="flex items-center gap-1.5">
                <span className="relative flex size-2">
                  <span className="absolute inline-flex size-2 animate-ping rounded-full bg-red-500 opacity-75" />
                  <span className="relative inline-flex size-2 rounded-full bg-red-600" />
                </span>
                Live Ops
              </span>
            </TabsTrigger>
            <TabsTrigger value="fleet">Fleet</TabsTrigger>
            <TabsTrigger value="analytics">Corridor Analytics</TabsTrigger>
          </TabsList>
          <Badge variant="outline" className="border-red-200 bg-red-50 text-red-800">
            GREEN CORRIDOR OPS
          </Badge>
          <Badge variant="outline" className="hidden sm:inline-flex">
            {activeMissions.length} active mission{activeMissions.length === 1 ? "" : "s"}
          </Badge>
        </div>

        {/* ================= LIVE OPS ================= */}
        <TabsContent value="live" className="mt-4">
          <div className="grid gap-4 lg:grid-cols-[minmax(320px,400px)_1fr]">
            {/* ---- left: new emergency + mission board ---- */}
            <div className="space-y-3">
              <div className="flex gap-2">
                <Button
                  className="flex-1"
                  onClick={() => setNewOpen(true)}
                  aria-label="Log new emergency"
                >
                  <Siren className="size-4" /> New emergency
                </Button>
                <Button
                  variant="outline"
                  size="icon"
                  onClick={loadMissions}
                  aria-label="Refresh missions"
                >
                  <RefreshCw className="size-4" />
                </Button>
              </div>

              {loadingMissions ? (
                <div className="space-y-3">
                  {[0, 1, 2].map((i) => (
                    <Skeleton key={i} className="h-36 rounded-xl" />
                  ))}
                </div>
              ) : missions.length === 0 ? (
                <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed py-10 text-center">
                  <AmbulanceIcon className="size-8 text-muted-foreground/50" />
                  <p className="text-sm font-medium">No missions yet</p>
                  <p className="max-w-xs text-xs text-muted-foreground">
                    Log an emergency to dispatch an ambulance and raise a green corridor.
                  </p>
                </div>
              ) : (
                <div className="max-h-[calc(100vh-220px)] space-y-3 overflow-y-auto pr-1 scrollbar-thin">
                  {missions.map((m) => {
                    const st = MISSION_STATUS[m.status] ?? MISSION_STATUS.REQUESTED;
                    return (
                      <div
                        key={m.id}
                        role="button"
                        tabIndex={0}
                        aria-pressed={selectedId === m.id}
                        onClick={() => selectMission(selectedId === m.id ? null : m.id)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            selectMission(selectedId === m.id ? null : m.id);
                          }
                        }}
                        className={cn(
                          "cursor-pointer rounded-xl border bg-card p-3 transition hover:border-primary/50",
                          selectedId === m.id ? "border-primary ring-2 ring-primary/25" : "border-border"
                        )}
                      >
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="font-mono text-xs text-muted-foreground">{m.requestRef}</span>
                          <Badge
                            variant="outline"
                            className={cn("px-1.5 text-[10px]", PRIORITY_CLS[m.priority] ?? "")}
                          >
                            {m.priority}
                          </Badge>
                          <Badge variant="outline" className={cn("ml-auto", st.cls)}>
                            {st.label}
                          </Badge>
                        </div>

                        <p className="mt-1.5 font-semibold leading-tight">{m.patientName}</p>
                        <p className="text-xs text-muted-foreground">
                          {labelOf(emergencyTypeOptions.options, m.emergencyType)} · {m.contact}
                        </p>

                        <p className="mt-1.5 flex items-center gap-1 truncate text-xs">
                          <MapPin className="size-3.5 shrink-0 text-red-600" />
                          <span className="truncate">{m.pickup}</span>
                          <span className="text-muted-foreground">→</span>
                          <span className="truncate">{m.destination}</span>
                        </p>

                        <Progress
                          value={m.progress}
                          className="mt-2 h-1.5"
                          aria-label={`Mission ${m.requestRef} progress ${m.progress}%`}
                        />

                        <p className="mt-1.5 flex items-center gap-3 text-xs text-muted-foreground">
                          <span className="flex items-center gap-1">
                            <RadioTower className="size-3.5" /> {m.vehiclesAlerted} vehicles
                          </span>
                          <span className="flex items-center gap-1">
                            <Timer className="size-3.5" /> {Math.round((m.timeSavedSec || 0) / 60)} min saved
                          </span>
                          {m.corridorActive ? (
                            <span className="flex items-center gap-1 font-medium text-emerald-700">
                              corridor on
                            </span>
                          ) : null}
                        </p>

                        {["REQUESTED", "DISPATCHED", "EN_ROUTE", "ARRIVED"].includes(m.status) ? (
                          <div
                            className="mt-2 flex flex-wrap gap-1.5 border-t pt-2"
                            onClick={(e) => e.stopPropagation()}
                            onKeyDown={(e) => e.stopPropagation()}
                          >
                            {m.status === "REQUESTED" ? (
                              <Button
                                size="sm"
                                onClick={() => openDispatch(m)}
                                aria-label={`Dispatch ambulance for ${m.requestRef}`}
                              >
                                <AmbulanceIcon className="size-3.5" /> Dispatch
                              </Button>
                            ) : null}
                            {m.status === "DISPATCHED" || m.status === "EN_ROUTE" ? (
                              <>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => missionAction(m, "advance")}
                                  aria-label={`Advance ${m.requestRef}`}
                                >
                                  <ChevronsRight className="size-3.5" /> Advance
                                </Button>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => missionAction(m, "complete")}
                                  aria-label={`Complete ${m.requestRef}`}
                                >
                                  <CheckCheck className="size-3.5" /> Complete
                                </Button>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="text-red-600 hover:bg-red-50 hover:text-red-700"
                                  onClick={() => missionAction(m, "cancel")}
                                  aria-label={`Cancel ${m.requestRef}`}
                                >
                                  <X className="size-3.5" /> Cancel
                                </Button>
                              </>
                            ) : null}
                            {m.status === "ARRIVED" ? (
                              <Button
                                size="sm"
                                onClick={() => missionAction(m, "complete")}
                                aria-label={`Complete ${m.requestRef}`}
                              >
                                <CheckCheck className="size-3.5" /> Complete
                              </Button>
                            ) : null}
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* ---- right: live corridor visualization ---- */}
            <div className="space-y-4">
              {!selected ? (
                <Card>
                  <CardContent className="flex flex-col items-center justify-center gap-2 py-16 text-center">
                    <RadioTower className="size-10 text-muted-foreground/40" />
                    <p className="text-sm font-medium">Select a mission to view the live corridor</p>
                    <p className="max-w-sm text-xs text-muted-foreground">
                      The corridor map polls every 5 seconds — segment congestion, alerted vehicles
                      and the ambulance position update in real time.
                    </p>
                  </CardContent>
                </Card>
              ) : (
                <Card>
                  <CardHeader className="pb-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <CardTitle className="text-base">
                        <span className="font-mono">{selected.requestRef}</span> · {selected.patientName}
                      </CardTitle>
                      <Badge
                        variant="outline"
                        className={cn((MISSION_STATUS[selected.status] ?? MISSION_STATUS.REQUESTED).cls)}
                      >
                        {(MISSION_STATUS[selected.status] ?? MISSION_STATUS.REQUESTED).label}
                      </Badge>
                      {selected.corridorActive &&
                      ["DISPATCHED", "EN_ROUTE"].includes(selected.status) ? (
                        <Badge className="animate-pulse bg-emerald-600 hover:bg-emerald-600">
                          CORRIDOR ACTIVE
                        </Badge>
                      ) : (
                        <Badge variant="outline">STANDBY</Badge>
                      )}
                    </div>
                    <CardDescription className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                      <span>{labelOf(emergencyTypeOptions.options, selected.emergencyType)}</span>
                      <span className="flex items-center gap-1">
                        <MapPin className="size-3.5" /> {selected.pickup} → {selected.destination}
                      </span>
                      <span className="flex items-center gap-1">
                        <Phone className="size-3.5" /> {selected.contact}
                      </span>
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {/* KPI chips */}
                    <div className="flex flex-wrap gap-2">
                      <Badge variant="outline" className="gap-1 border-zinc-200 py-1">
                        <RadioTower className="size-3.5 text-emerald-700" />
                        {selected.vehiclesAlerted} vehicles alerted
                      </Badge>
                      <Badge variant="outline" className="gap-1 border-zinc-200 py-1">
                        <Timer className="size-3.5 text-teal-700" />
                        {Math.round((selected.timeSavedSec || 0) / 60)} min saved
                      </Badge>
                      <Badge variant="outline" className="gap-1 border-zinc-200 py-1">
                        <Clock className="size-3.5 text-amber-700" />
                        {selected.etaMin ? `${selected.etaMin} min ETA` : "ETA —"}
                      </Badge>
                      <Badge variant="outline" className="gap-1 border-zinc-200 py-1">
                        {selected.progress}% complete
                      </Badge>
                    </div>

                    <CorridorMap mission={selected} events={events} />

                    {/* event log */}
                    <div>
                      <p className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        <Radio className="size-3.5" /> Corridor event log
                      </p>
                      {sortedEvents.length === 0 ? (
                        <p className="rounded-lg border border-dashed py-4 text-center text-xs text-muted-foreground">
                          No corridor events yet — events fire when vehicles are alerted per segment.
                        </p>
                      ) : (
                        <ul className="max-h-44 space-y-1.5 overflow-y-auto pr-1 scrollbar-thin">
                          {sortedEvents.map((ev) => (
                            <li
                              key={ev.id}
                              className="flex flex-wrap items-center gap-x-2 gap-y-0.5 rounded-lg border px-2.5 py-1.5 text-xs"
                            >
                              <span
                                className="size-2 shrink-0 rounded-full"
                                style={{ backgroundColor: CONGESTION_COLOR[ev.congestion] ?? "#d97706" }}
                                aria-hidden="true"
                              />
                              <span className="font-medium">{ev.segment}</span>
                              <Badge variant="outline" className="px-1 py-0 text-[10px] text-emerald-800">
                                {METHOD_LABEL[ev.method] ?? ev.method}
                              </Badge>
                              <span className="text-muted-foreground">
                                {ev.vehiclesAlerted} vehicles · +{ev.timeSavedSec}s
                              </span>
                              <span className="ml-auto text-muted-foreground">
                                {timeAgo(ev.createdAt)}
                              </span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  </CardContent>
                </Card>
              )}
            </div>
          </div>
        </TabsContent>

        {/* ================= FLEET ================= */}
        <TabsContent value="fleet" className="mt-4 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline" className="border-lime-200 bg-lime-50 text-lime-800">
              {ambulances.filter((a) => a.status === "AVAILABLE").length} available
            </Badge>
            <Badge variant="outline" className="border-amber-200 bg-amber-50 text-amber-800">
              {ambulances.filter((a) => a.status === "ON_MISSION").length} on mission
            </Badge>
            <Badge variant="outline" className="border-zinc-200 bg-zinc-100 text-zinc-600">
              {ambulances.filter((a) => a.status === "MAINTENANCE").length} maintenance
            </Badge>
            <div className="ml-auto flex gap-2">
              <Button variant="outline" size="icon" onClick={loadAmbulances} aria-label="Refresh fleet">
                <RefreshCw className="size-4" />
              </Button>
              <Button onClick={openCreateAmbulance}>
                <Plus className="size-4" /> Add ambulance
              </Button>
            </div>
          </div>

          {loadingFleet ? (
            <Skeleton className="h-72 rounded-lg" />
          ) : ambulances.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed py-12 text-center">
              <AmbulanceIcon className="size-8 text-muted-foreground/50" />
              <p className="text-sm font-medium">No ambulances in fleet</p>
              <p className="max-w-sm text-xs text-muted-foreground">
                Add your first ambulance to start dispatching green corridor missions.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Code</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Base</TableHead>
                    <TableHead>Driver</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Equipment</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {ambulances.map((a) => (
                    <TableRow key={a.id}>
                      <TableCell className="font-mono text-xs font-semibold">{a.code}</TableCell>
                      <TableCell>
                        <Badge variant="outline">{labelOf(ambTypeOptions.options, a.type)}</Badge>
                      </TableCell>
                      <TableCell>{a.base}</TableCell>
                      <TableCell>
                        <span className="block font-medium">{a.driverName}</span>
                        {a.driverPhone ? (
                          <span className="text-xs text-muted-foreground">{a.driverPhone}</span>
                        ) : null}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className={cn("whitespace-nowrap", AMB_STATUS[a.status] ?? "")}>
                          {titleCase(a.status)}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex max-w-48 flex-wrap gap-1">
                          {(a.equipment ?? "")
                            .split(",")
                            .map((s) => s.trim())
                            .filter(Boolean)
                            .slice(0, 4)
                            .map((eq) => (
                              <Badge key={eq} variant="outline" className="px-1.5 text-[10px]">
                                {eq}
                              </Badge>
                            ))}
                          {(a.equipment ?? "").trim() ? null : (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1.5">
                          {a.status === "AVAILABLE" ? (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => setAmbulanceStatus(a, "MAINTENANCE")}
                              aria-label={`Set ${a.code} to maintenance`}
                            >
                              <Wrench className="size-3.5" /> Maintenance
                            </Button>
                          ) : a.status === "MAINTENANCE" ? (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => setAmbulanceStatus(a, "AVAILABLE")}
                              aria-label={`Set ${a.code} available`}
                            >
                              <CheckCheck className="size-3.5" /> Available
                            </Button>
                          ) : null}
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => openEditAmbulance(a)}
                            aria-label={`Edit ${a.code}`}
                          >
                            <Pencil className="size-3.5" />
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            className="text-red-600 hover:bg-red-50 hover:text-red-700"
                            onClick={() => setDeleteTarget(a)}
                            aria-label={`Delete ${a.code}`}
                          >
                            <Trash2 className="size-3.5" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </TabsContent>

        {/* ================= ANALYTICS ================= */}
        <TabsContent value="analytics" className="mt-4 space-y-4">
          {loadingStats ? (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {[0, 1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-24 rounded-xl" />
              ))}
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Card>
                <CardContent className="p-4">
                  <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Siren className="size-3.5" /> Missions
                  </p>
                  <p className="mt-1 text-2xl font-bold">{analytics.missions}</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-4">
                  <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <RadioTower className="size-3.5" /> Vehicles alerted
                  </p>
                  <p className="mt-1 text-2xl font-bold text-emerald-700">{analytics.vehicles}</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-4">
                  <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Timer className="size-3.5" /> Time saved
                  </p>
                  <p className="mt-1 text-2xl font-bold text-teal-700">{analytics.savedMin} min</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-4">
                  <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Clock className="size-3.5" /> Avg saved / mission
                  </p>
                  <p className="mt-1 text-2xl font-bold">{analytics.avg}s</p>
                </CardContent>
              </Card>
            </div>
          )}

          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Seconds saved by corridor segment</CardTitle>
                <CardDescription>Where the green corridor buys the most time</CardDescription>
              </CardHeader>
              <CardContent>
                {analytics.bySegment.length === 0 ? (
                  <p className="rounded-lg border border-dashed py-10 text-center text-xs text-muted-foreground">
                    No segment data yet — segment stats appear as corridor events fire.
                  </p>
                ) : (
                  <div className="h-64">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={analytics.bySegment} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e4e4e7" />
                        <XAxis dataKey="segment" tick={{ fontSize: 11 }} stroke="#a1a1aa" />
                        <YAxis tick={{ fontSize: 11 }} stroke="#a1a1aa" />
                        <Tooltip cursor={{ fill: "rgba(5,150,105,0.06)" }} />
                        <Bar dataKey="savedSec" name="Seconds saved" fill="#059669" radius={[6, 6, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Alerts by broadcast method</CardTitle>
                <CardDescription>V2X 5G, cell broadcast, BLE mesh, FM RDS and siren</CardDescription>
              </CardHeader>
              <CardContent>
                {analytics.byMethod.length === 0 ? (
                  <p className="rounded-lg border border-dashed py-10 text-center text-xs text-muted-foreground">
                    No method data yet — method stats appear as corridor events fire.
                  </p>
                ) : (
                  <div className="h-64">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={analytics.byMethod}
                          dataKey="count"
                          nameKey="method"
                          innerRadius={50}
                          outerRadius={85}
                          paddingAngle={3}
                        >
                          {analytics.byMethod.map((entry, i) => (
                            <Cell key={entry.method} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                          ))}
                        </Pie>
                        <Tooltip />
                        <Legend
                          formatter={(value: string) => METHOD_LABEL[value] ?? value}
                          wrapperStyle={{ fontSize: 12 }}
                        />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          <p className="flex items-center justify-center gap-2 rounded-lg border border-dashed py-3 text-center text-xs text-muted-foreground">
            <Radio className="size-3.5 text-emerald-700" />
            BLE mesh works when towers fail — dense vehicle-to-vehicle relay keeps corridors alive
            during network outages.
          </p>
        </TabsContent>
      </Tabs>

      {/* ============ NEW EMERGENCY DIALOG ============ */}
      <Dialog open={newOpen} onOpenChange={setNewOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Siren className="size-4 text-red-600" /> Log new emergency
            </DialogTitle>
            <DialogDescription>
              An ambulance dispatch request — the corridor is armed once dispatched.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor="m-patient">Patient name *</Label>
                <Input
                  id="m-patient"
                  value={missionForm.patientName}
                  onChange={(e) => setMissionForm({ ...missionForm, patientName: e.target.value })}
                  placeholder="Ravi Kumar"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="m-contact">Contact *</Label>
                <Input
                  id="m-contact"
                  value={missionForm.contact}
                  onChange={(e) => setMissionForm({ ...missionForm, contact: e.target.value })}
                  placeholder="+91 98xxxxxxx"
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
                    <SelectValue placeholder="Select type" />
                  </SelectTrigger>
                  <SelectContent>
                    {emergencyTypeOptions.options.map((o) => (
                      <SelectItem key={o.value} value={o.value}>
                        {o.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label>Priority</Label>
                <Select
                  value={missionForm.priority}
                  onValueChange={(v) => setMissionForm({ ...missionForm, priority: v })}
                >
                  <SelectTrigger aria-label="Priority">
                    <SelectValue placeholder="Select priority" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="CRITICAL">Critical</SelectItem>
                    <SelectItem value="HIGH">High</SelectItem>
                    <SelectItem value="MEDIUM">Medium</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="m-pickup">Pickup point *</Label>
              <Input
                id="m-pickup"
                value={missionForm.pickup}
                onChange={(e) => setMissionForm({ ...missionForm, pickup: e.target.value })}
                placeholder="Jayanagar 4th Block"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="m-destination">Destination hospital *</Label>
              <Input
                id="m-destination"
                value={missionForm.destination}
                onChange={(e) => setMissionForm({ ...missionForm, destination: e.target.value })}
                placeholder="Victoria Hospital"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setNewOpen(false)}>
              Cancel
            </Button>
            <Button onClick={createMission} disabled={savingMission}>
              {savingMission ? "Logging…" : "Log emergency"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ============ DISPATCH DIALOG ============ */}
      <Dialog open={dispatchOpen} onOpenChange={setDispatchOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              Dispatch — <span className="font-mono">{dispatchMission?.requestRef}</span>
            </DialogTitle>
            <DialogDescription>
              {dispatchMission?.pickup} → {dispatchMission?.destination}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <Label>Ambulance (available now)</Label>
            {availableAmbulances.length === 0 ? (
              <p className="rounded-lg border border-dashed py-6 text-center text-xs text-muted-foreground">
                No ambulances available right now — free one up in the Fleet tab.
              </p>
            ) : (
              <Select value={dispatchAmbulanceId || undefined} onValueChange={setDispatchAmbulanceId}>
                <SelectTrigger aria-label="Select ambulance">
                  <SelectValue placeholder="Select ambulance" />
                </SelectTrigger>
                <SelectContent>
                  {availableAmbulances.map((a) => (
                    <SelectItem key={a.id} value={a.id}>
                      {a.code} · {a.type} — {a.base} ({a.driverName})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDispatchOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={confirmDispatch}
              disabled={dispatching || !dispatchAmbulanceId}
              aria-label="Confirm dispatch"
            >
              {dispatching ? "Dispatching…" : "Dispatch"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ============ AMBULANCE CREATE / EDIT DIALOG ============ */}
      <Dialog open={fleetOpen} onOpenChange={setFleetOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {editingAmbulance ? `Edit ${editingAmbulance.code}` : "Add ambulance"}
            </DialogTitle>
            <DialogDescription>Fleet vehicle registered for green corridor duty.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor="a-code">Code *</Label>
                <Input
                  id="a-code"
                  value={fleetForm.code}
                  onChange={(e) => setFleetForm({ ...fleetForm, code: e.target.value })}
                  placeholder="UAR-AMB-01"
                />
              </div>
              <div className="grid gap-2">
                <Label>Type</Label>
                <Select value={fleetForm.type} onValueChange={(v) => setFleetForm({ ...fleetForm, type: v })}>
                  <SelectTrigger aria-label="Ambulance type">
                    <SelectValue placeholder="Select type" />
                  </SelectTrigger>
                  <SelectContent>
                    {ambTypeOptions.options.map((o) => (
                      <SelectItem key={o.value} value={o.value}>
                        {o.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="a-base">Base station *</Label>
              <Input
                id="a-base"
                value={fleetForm.base}
                onChange={(e) => setFleetForm({ ...fleetForm, base: e.target.value })}
                placeholder="Wilson Garden depot"
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor="a-driver">Driver name *</Label>
                <Input
                  id="a-driver"
                  value={fleetForm.driverName}
                  onChange={(e) => setFleetForm({ ...fleetForm, driverName: e.target.value })}
                  placeholder="Manoj H S"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="a-phone">Driver phone</Label>
                <Input
                  id="a-phone"
                  value={fleetForm.driverPhone}
                  onChange={(e) => setFleetForm({ ...fleetForm, driverPhone: e.target.value })}
                  placeholder="+91 98xxxxxxx"
                />
              </div>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="a-crew">Crew</Label>
              <Input
                id="a-crew"
                value={fleetForm.crew}
                onChange={(e) => setFleetForm({ ...fleetForm, crew: e.target.value })}
                placeholder="Paramedic: Sunil, Nurse: Asha"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="a-equipment">Equipment (comma separated)</Label>
              <Input
                id="a-equipment"
                value={fleetForm.equipment}
                onChange={(e) => setFleetForm({ ...fleetForm, equipment: e.target.value })}
                placeholder="Defibrillator, Oxygen, Ventilator"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setFleetOpen(false)}>
              Cancel
            </Button>
            <Button onClick={saveAmbulance} disabled={savingFleet}>
              {savingFleet ? "Saving…" : editingAmbulance ? "Save changes" : "Add ambulance"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ============ AMBULANCE DELETE CONFIRM ============ */}
      <Dialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Remove {deleteTarget?.code}?</DialogTitle>
            <DialogDescription>
              This permanently removes the ambulance from the fleet.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>
              Keep
            </Button>
            <Button variant="destructive" onClick={removeAmbulance}>
              Remove
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
