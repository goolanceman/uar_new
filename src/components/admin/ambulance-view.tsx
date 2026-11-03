"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Ambulance as AmbulanceIcon,
  ArrowRight,
  Ban,
  CheckCircle2,
  Eye,
  Flag,
  MoreHorizontal,
  Pencil,
  Plus,
  Radio,
  RefreshCw,
  Route,
  Search,
  Siren,
  Trash2,
  Zap,
} from "lucide-react";
import { toast } from "sonner";
import { del, get, patch, post } from "@/lib/api-client";
import { labelOf, useMasters } from "@/hooks/use-masters";
import { formatDateTime, formatDuration, titleCase } from "@/lib/format";
import { phoneRule, required } from "@/lib/validators";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/shared/page-header";
import { SectionCard } from "@/components/shared/section-card";
import { StatCard } from "@/components/shared/stat-card";
import { DataField } from "@/components/shared/data-field";
import { EmptyState } from "@/components/shared/empty-state";
import { FormSheet } from "@/components/shared/form-sheet";
import {
  FieldGrid,
  FormSection,
  SelectField,
  TextField,
} from "@/components/shared/form-fields";
import { StatusBadge, type Tone } from "@/components/shared/status-badge";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { ExportMenu, type CsvColumn } from "@/components/shared/csv";
import { ViewSwitcher, useViewPref } from "@/components/shared/view-switcher";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
  createdAt?: string | null;
}

interface CorridorEventRow {
  id: string;
  missionId: string;
  segment: string;
  method: string;
  congestion: string;
  vehiclesAlerted: number;
  timeSavedSec: number;
  note?: string | null;
  createdAt?: string | null;
  mission?: { requestRef: string } | null;
}

interface RouteSeg {
  name: string;
  congestion: string;
  lengthKm: number;
}

interface SegForm {
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
  route: SegForm[];
}

type RuleErr = Record<string, string | undefined>;

/* ------------------------------ maps & helpers ----------------------------- */

const CONGESTION_TONE: Record<string, Tone> = {
  LOW: "success",
  MODERATE: "warning",
  HEAVY: "warning",
  GRIDLOCK: "danger",
};

const METHOD_TONE: Record<string, Tone> = {
  V2X_5G: "info",
  CELL_BROADCAST: "progress",
  BLE_MESH: "success",
  FM_RDS: "warning",
  SIREN: "danger",
};

const PRIORITY_TONE: Record<string, Tone> = {
  CRITICAL: "danger",
  HIGH: "warning",
  MEDIUM: "info",
};

const METHODS = ["V2X_5G", "CELL_BROADCAST", "BLE_MESH", "FM_RDS", "SIREN"];
const CONGESTIONS = ["LOW", "MODERATE", "HEAVY", "GRIDLOCK"];

const MISSION_FILTERS = [
  "ALL",
  "REQUESTED",
  "DISPATCHED",
  "EN_ROUTE",
  "ARRIVED",
  "COMPLETED",
  "CANCELLED",
];

const SEGMENT_POOL = [
  "Hebbal Flyover",
  "Outer Ring Road",
  "Silk Board Junction",
  "KR Puram Junction",
  "Tin Factory",
  "Marathahalli Bridge",
  "NICE Road",
  "Majestic Interchange",
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
  route: [],
};

const PRIORITY_OPTIONS = [
  { value: "CRITICAL", label: "Critical" },
  { value: "HIGH", label: "High" },
  { value: "MEDIUM", label: "Medium" },
];

const CONGESTION_OPTIONS = [
  { value: "LOW", label: "Low" },
  { value: "MODERATE", label: "Moderate" },
  { value: "HEAVY", label: "Heavy" },
  { value: "GRIDLOCK", label: "Gridlock" },
];

function parseRoute(json: string | null | undefined): RouteSeg[] {
  if (!json) return [];
  try {
    const parsed = JSON.parse(json) as {
      name?: string;
      congestion?: string;
      lengthKm?: number;
    }[];
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

function collectErrors(
  ...pairs: [string, string | null][]
): RuleErr | null {
  const out: RuleErr = {};
  let any = false;
  for (const [key, err] of pairs) {
    if (err) {
      out[key] = err;
      any = true;
    }
  }
  return any ? out : null;
}

const fmtNum = (n: number | null | undefined) =>
  (n ?? 0).toLocaleString("en-IN");

/* ---------------------------------- view ----------------------------------- */

export default function AmbulanceView() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Ambulance & Green Corridor"
        description="Fleet roster, emergency missions and the V2X corridor alert log."
        icon={<AmbulanceIcon className="size-5" aria-hidden="true" />}
      />
      <Tabs defaultValue="fleet" className="space-y-4">
        <TabsList>
          <TabsTrigger value="fleet">Fleet</TabsTrigger>
          <TabsTrigger value="missions">Missions</TabsTrigger>
          <TabsTrigger value="corridor">Corridor log</TabsTrigger>
        </TabsList>
        <TabsContent value="fleet">
          <FleetTab />
        </TabsContent>
        <TabsContent value="missions">
          <MissionsTab />
        </TabsContent>
        <TabsContent value="corridor">
          <CorridorTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}

/* ================================ FLEET TAB ================================ */

const fleetCsv: CsvColumn<Ambulance>[] = [
  { header: "Code", value: (a) => a.code },
  { header: "Type", value: (a) => a.type },
  { header: "Status", value: (a) => a.status },
  { header: "Base", value: (a) => a.base },
  { header: "Driver", value: (a) => a.driverName },
  { header: "Driver phone", value: (a) => a.driverPhone ?? "" },
  { header: "Crew", value: (a) => a.crew ?? "" },
  { header: "Equipment", value: (a) => a.equipment ?? "" },
];

function FleetTab() {
  const [ambulances, setAmbulances] = useState<Ambulance[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [view, setView] = useViewPref("ambulance-fleet");

  /* form */
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Ambulance | null>(null);
  const [form, setForm] = useState<AmbForm>(EMPTY_AMB_FORM);
  const [initialForm, setInitialForm] = useState<AmbForm>(EMPTY_AMB_FORM);
  const [errors, setErrors] = useState<RuleErr>({});
  const [saving, setSaving] = useState(false);

  /* delete */
  const [deleteTarget, setDeleteTarget] = useState<Ambulance | null>(null);
  const [deleting, setDeleting] = useState(false);

  /* detail */
  const [detail, setDetail] = useState<Ambulance | null>(null);
  const [history, setHistory] = useState<Mission[] | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);

  const typeOptions = useMasters("AMBULANCE_TYPE");

  const load = useCallback(async () => {
    try {
      const rows = await get<Ambulance[]>("/api/ambulances");
      setAmbulances(Array.isArray(rows) ? rows : []);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load fleet");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return ambulances;
    return ambulances.filter((a) =>
      `${a.code} ${a.base} ${a.driverName} ${a.type}`.toLowerCase().includes(needle)
    );
  }, [ambulances, q]);

  const counts = useMemo(
    () => ({
      total: ambulances.length,
      available: ambulances.filter((a) => a.status === "AVAILABLE").length,
      onMission: ambulances.filter((a) => a.status === "ON_MISSION").length,
      maintenance: ambulances.filter((a) => a.status === "MAINTENANCE").length,
    }),
    [ambulances]
  );

  const dirty = JSON.stringify(form) !== JSON.stringify(initialForm);

  /* ------------------------------- actions -------------------------------- */

  const openCreate = () => {
    setEditing(null);
    setForm(EMPTY_AMB_FORM);
    setInitialForm(EMPTY_AMB_FORM);
    setErrors({});
    setFormOpen(true);
  };

  const openEdit = (a: Ambulance) => {
    setEditing(a);
    const f: AmbForm = {
      code: a.code ?? "",
      type: a.type ?? "BLS",
      base: a.base ?? "",
      driverName: a.driverName ?? "",
      driverPhone: a.driverPhone ?? "",
      crew: a.crew ?? "",
      equipment: a.equipment ?? "",
    };
    setForm(f);
    setInitialForm(f);
    setErrors({});
    setFormOpen(true);
  };

  const save = async () => {
    const errs = collectErrors(
      ["code", required("Ambulance code")(form.code)],
      ["base", required("Base location")(form.base)],
      ["driverName", required("Driver name")(form.driverName)],
      ["driverPhone", phoneRule(true)(form.driverPhone)]
    );
    if (errs) {
      setErrors(errs);
      return;
    }
    setErrors({});
    setSaving(true);
    try {
      const body = {
        code: form.code.trim().toUpperCase(),
        type: form.type,
        base: form.base.trim(),
        driverName: form.driverName.trim(),
        driverPhone: form.driverPhone.trim() || undefined,
        crew: form.crew.trim() || undefined,
        equipment: form.equipment.trim() || undefined,
      };
      if (editing) {
        await patch(`/api/ambulances/${editing.id}`, body);
        toast.success(`Ambulance ${body.code} updated`);
      } else {
        await post("/api/ambulances", body);
        toast.success(`Ambulance ${body.code} added to the fleet`);
      }
      setFormOpen(false);
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await del(`/api/ambulances/${deleteTarget.id}`);
      toast.success(`Ambulance ${deleteTarget.code} removed`);
      setDeleteTarget(null);
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Delete failed");
    } finally {
      setDeleting(false);
    }
  };

  const openDetail = (a: Ambulance) => {
    setDetail(a);
    setHistory(null);
    setHistoryLoading(true);
    get<Mission[]>("/api/missions")
      .then((rows) =>
        setHistory(
          (Array.isArray(rows) ? rows : []).filter((m) => m.ambulanceId === a.id)
        )
      )
      .catch(() => setHistory([]))
      .finally(() => setHistoryLoading(false));
  };

  /* ------------------------------- renders -------------------------------- */

  const actionButtons = (a: Ambulance) => (
    <>
      <Button
        size="icon"
        variant="ghost"
        className="size-11 md:size-8"
        aria-label={`View ${a.code}`}
        onClick={() => openDetail(a)}
      >
        <Eye className="size-4" />
      </Button>
      <Button
        size="icon"
        variant="ghost"
        className="size-11 md:size-8"
        aria-label={`Edit ${a.code}`}
        onClick={() => openEdit(a)}
      >
        <Pencil className="size-4" />
      </Button>
      <Button
        size="icon"
        variant="ghost"
        className="size-11 text-red-600 hover:bg-red-500/10 hover:text-red-700 md:size-8 dark:text-red-400"
        aria-label={`Delete ${a.code}`}
        onClick={() => setDeleteTarget(a)}
      >
        <Trash2 className="size-4" />
      </Button>
    </>
  );

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Fleet size"
          value={counts.total}
          accent="teal"
          icon={<AmbulanceIcon className="size-5" aria-hidden="true" />}
          loading={loading}
        />
        <StatCard
          label="Available"
          value={counts.available}
          accent="emerald"
          icon={<CheckCircle2 className="size-5" aria-hidden="true" />}
          loading={loading}
        />
        <StatCard
          label="On mission"
          value={counts.onMission}
          accent="red"
          icon={<Siren className="size-5" aria-hidden="true" />}
          loading={loading}
        />
        <StatCard
          label="Maintenance"
          value={counts.maintenance}
          accent="amber"
          icon={<Route className="size-5" aria-hidden="true" />}
          loading={loading}
        />
      </div>

      <SectionCard
        title="Fleet"
        description="Ambulances on roster — BLS, ALS, PTV and neonatal units."
        icon={<AmbulanceIcon className="size-4" aria-hidden="true" />}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search
                className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden="true"
              />
              <Input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search code, base, driver…"
                className="h-9 w-full pl-8 sm:w-48"
                aria-label="Search ambulances"
              />
            </div>
            <ViewSwitcher value={view} onChange={setView} />
            <ExportMenu
              columns={fleetCsv}
              rows={filtered}
              filename="uar-ambulance-fleet"
              disabled={filtered.length === 0}
            />
            <Button size="sm" onClick={openCreate}>
              <Plus className="size-4" aria-hidden="true" /> Ambulance
            </Button>
          </div>
        }
      >
        {loading ? (
          <div className="space-y-2" aria-busy="true">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-12 rounded-lg" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={<AmbulanceIcon className="size-8" aria-hidden="true" />}
            title={
              ambulances.length === 0
                ? "No ambulances on the roster"
                : "No ambulances match your search"
            }
            hint={
              ambulances.length === 0
                ? "Add your first ambulance so missions can be dispatched."
                : "Try a different search term."
            }
          >
            {ambulances.length === 0 && (
              <Button variant="outline" onClick={openCreate}>
                <Plus className="size-4" aria-hidden="true" /> Add ambulance
              </Button>
            )}
          </EmptyState>
        ) : view === "table" ? (
          <>
            {/* desktop table */}
            <div className="hidden overflow-x-auto rounded-lg border md:block">
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
                  {filtered.map((a) => (
                    <TableRow key={a.id}>
                      <TableCell className="font-mono font-medium">{a.code}</TableCell>
                      <TableCell>
                        <Badge
                          variant="outline"
                          className="border-teal-500/30 bg-teal-500/10 text-teal-700 dark:text-teal-400"
                        >
                          {labelOf(typeOptions.options, a.type)}
                        </Badge>
                      </TableCell>
                      <TableCell>{a.base}</TableCell>
                      <TableCell>
                        {a.driverName}
                        {a.driverPhone ? (
                          <span className="block text-xs text-muted-foreground">
                            {a.driverPhone}
                          </span>
                        ) : null}
                      </TableCell>
                      <TableCell>
                        <StatusBadge status={a.status} />
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">{actionButtons(a)}</div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            {/* mobile cards */}
            <ul className="space-y-2 md:hidden">
              {filtered.map((a) => (
                <li key={a.id} className="rounded-lg border p-3">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-sm font-semibold">{a.code}</span>
                    <StatusBadge status={a.status} className="ml-auto" />
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {labelOf(typeOptions.options, a.type)} · {a.base} · {a.driverName}
                  </p>
                  <div className="mt-2 flex gap-1">{actionButtons(a)}</div>
                </li>
              ))}
            </ul>
          </>
        ) : view === "grid" ? (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {filtered.map((a) => (
              <article key={a.id} className="flex flex-col gap-3 rounded-xl border bg-card p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex min-w-0 items-start gap-2.5">
                    <span
                      aria-hidden="true"
                      className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"
                    >
                      <AmbulanceIcon className="size-4" />
                    </span>
                    <div className="min-w-0">
                      <p className="truncate font-mono text-sm font-semibold">{a.code}</p>
                      <p className="truncate text-xs text-muted-foreground">{a.base}</p>
                    </div>
                  </div>
                  <StatusBadge status={a.status} />
                </div>
                <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                  <Badge
                    variant="outline"
                    className="border-teal-500/30 bg-teal-500/10 text-teal-700 dark:text-teal-400"
                  >
                    {labelOf(typeOptions.options, a.type)}
                  </Badge>
                  <span className="truncate">Driver · {a.driverName}</span>
                </div>
                <div className="mt-auto flex gap-1 border-t pt-3">{actionButtons(a)}</div>
              </article>
            ))}
          </div>
        ) : (
          <ul className="space-y-2" aria-label="Ambulances list">
            {filtered.map((a) => (
              <li key={a.id} className="flex items-center gap-2 rounded-lg border px-3 py-2">
                <button
                  type="button"
                  onClick={() => openDetail(a)}
                  className="flex min-w-0 flex-1 items-center gap-3 rounded-md text-left"
                  aria-label={`View ambulance ${a.code}`}
                >
                  <span
                    aria-hidden="true"
                    className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"
                  >
                    <AmbulanceIcon className="size-4" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-mono text-sm font-semibold">
                      {a.code}
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {a.base} · {a.driverName}
                    </span>
                  </span>
                  <StatusBadge status={a.status} className="shrink-0" />
                </button>
                <div className="flex shrink-0 gap-0.5">{actionButtons(a)}</div>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>

      {/* --------------------------- ambulance form --------------------------- */}
      <FormSheet
        open={formOpen}
        onOpenChange={setFormOpen}
        title={editing ? `Edit ambulance ${editing.code}` : "Add ambulance"}
        description="Roster entry for the emergency fleet."
        submitLabel={editing ? "Save changes" : "Add ambulance"}
        onSubmit={save}
        loading={saving}
        dirty={dirty}
        size="md"
      >
        <FormSection title="Unit">
          <FieldGrid>
            <TextField
              label="Code"
              required
              value={form.code}
              onChange={(v) => setForm({ ...form, code: v.toUpperCase() })}
              placeholder="KA-01-UAR-101"
              hint="Format: KA-01-UAR-101 (state-district-UAR-unit)"
              error={errors.code}
              disabled={!!editing}
              className="font-mono"
            />
            <SelectField
              label="Type"
              required
              value={form.type}
              onChange={(v) => setForm({ ...form, type: v })}
              options={typeOptions.options}
            />
          </FieldGrid>
          <TextField
            label="Base"
            required
            value={form.base}
            onChange={(v) => setForm({ ...form, base: v })}
            placeholder="Hebbal station, Bengaluru"
            error={errors.base}
          />
          <FieldGrid>
            <TextField
              label="Driver name"
              required
              value={form.driverName}
              onChange={(v) => setForm({ ...form, driverName: v })}
              placeholder="Manoj Kumar"
              error={errors.driverName}
            />
            <TextField
              label="Driver phone"
              value={form.driverPhone}
              onChange={(v) => setForm({ ...form, driverPhone: v })}
              placeholder="9876543210"
              inputMode="tel"
              error={errors.driverPhone}
            />
          </FieldGrid>
        </FormSection>
        <FormSection
          title="Crew & equipment"
          description="Comma-separated lists — kept on the roster for dispatch context."
        >
          <TextField
            label="Crew"
            value={form.crew}
            onChange={(v) => setForm({ ...form, crew: v })}
            placeholder="Paramedic: Sunita, EMT: Rahul"
            hint="Separate crew members with commas."
          />
          <TextField
            label="Equipment"
            value={form.equipment}
            onChange={(v) => setForm({ ...form, equipment: v })}
            placeholder="defibrillator, oxygen, stretcher, ventilator"
            hint="Separate items with commas."
          />
        </FormSection>
      </FormSheet>

      {/* -------------------------- ambulance detail -------------------------- */}
      <Sheet open={!!detail} onOpenChange={(o) => !o && setDetail(null)}>
        <SheetContent className="flex w-full flex-col gap-0 overflow-y-auto p-0 sm:max-w-md">
          {detail && (
            <div className="space-y-5 p-5">
              <SheetHeader className="p-0 text-left">
                <SheetTitle className="flex items-center gap-2">
                  <span className="font-mono">{detail.code}</span>
                  <StatusBadge status={detail.status} className="ml-auto" />
                </SheetTitle>
                <SheetDescription>
                  {labelOf(typeOptions.options, detail.type)} · {detail.base}
                </SheetDescription>
              </SheetHeader>

              <div className="grid grid-cols-2 gap-x-4 gap-y-4">
                <DataField label="Code" value={detail.code} mono />
                <DataField label="Type" value={labelOf(typeOptions.options, detail.type)} />
                <DataField label="Base" value={detail.base} />
                <DataField label="Status" value={<StatusBadge status={detail.status} />} />
                <DataField label="Driver" value={detail.driverName} />
                <DataField label="Driver phone" value={detail.driverPhone} mono copy />
              </div>

              <SectionCard title="Crew & equipment">
                <div className="space-y-3">
                  <DataField label="Crew" value={detail.crew} />
                  <DataField label="Equipment" value={detail.equipment} />
                </div>
              </SectionCard>

              <SectionCard
                title="Mission history"
                description="Recent missions served by this unit"
                icon={<Route className="size-4" aria-hidden="true" />}
              >
                {historyLoading ? (
                  <div className="space-y-2" aria-busy="true">
                    {[0, 1].map((i) => (
                      <Skeleton key={i} className="h-16 rounded-lg" />
                    ))}
                  </div>
                ) : !history || history.length === 0 ? (
                  <EmptyState
                    icon={<Route className="size-6" aria-hidden="true" />}
                    title="No missions yet"
                    hint="This unit hasn't been dispatched recently."
                  />
                ) : (
                  <ul
                    className="max-h-96 space-y-2 overflow-y-auto scrollbar-thin"
                    aria-label="Missions served by this ambulance"
                  >
                    {history.map((m) => (
                      <li key={m.id} className="rounded-lg border p-3">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-mono text-xs font-semibold">
                            {m.requestRef}
                          </span>
                          <StatusBadge status={m.status} className="ml-auto" />
                        </div>
                        <p className="mt-1 flex items-center gap-1 truncate text-xs">
                          {m.patientName} · {m.pickup}
                          <ArrowRight className="size-3 shrink-0" aria-hidden="true" />
                          {m.destination}
                        </p>
                        <p className="mt-0.5 text-[11px] text-muted-foreground">
                          {m.createdAt ? formatDateTime(m.createdAt) : "—"} · {m.progress}%
                        </p>
                      </li>
                    ))}
                  </ul>
                )}
              </SectionCard>
            </div>
          )}
        </SheetContent>
      </Sheet>

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
        title="Remove ambulance?"
        recordName={deleteTarget ? `${deleteTarget.code} · ${deleteTarget.base}` : null}
        description="The unit is taken off the roster permanently. Missions it served keep their history."
        confirmLabel="Delete ambulance"
        loading={deleting}
        onConfirm={remove}
      />
    </div>
  );
}

/* ============================== MISSIONS TAB =============================== */

const missionsCsv: CsvColumn<Mission>[] = [
  { header: "Request ref", value: (m) => m.requestRef },
  { header: "Patient", value: (m) => m.patientName },
  { header: "Emergency type", value: (m) => m.emergencyType },
  { header: "Priority", value: (m) => m.priority },
  { header: "Pickup", value: (m) => m.pickup },
  { header: "Destination", value: (m) => m.destination },
  { header: "Ambulance", value: (m) => m.ambulance?.code ?? "" },
  { header: "ETA (min)", value: (m) => m.etaMin ?? "" },
  { header: "Status", value: (m) => m.status },
  { header: "Vehicles alerted", value: (m) => m.vehiclesAlerted },
  { header: "Time saved (sec)", value: (m) => m.timeSavedSec },
  { header: "Created", value: (m) => m.createdAt ?? "" },
];

function MissionsTab() {
  const [missions, setMissions] = useState<Mission[]>([]);
  const [ambulances, setAmbulances] = useState<Ambulance[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("ALL");
  const [view, setView] = useViewPref("ambulance-missions");

  /* create + dispatch form */
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState<MissionForm>(EMPTY_MISSION_FORM);
  const [initialForm, setInitialForm] = useState<MissionForm>(EMPTY_MISSION_FORM);
  const [missionAmbId, setMissionAmbId] = useState("");
  const [errors, setErrors] = useState<RuleErr>({});
  const [saving, setSaving] = useState(false);

  /* dispatch existing */
  const [dispatchTarget, setDispatchTarget] = useState<Mission | null>(null);
  const [dispatchAmbId, setDispatchAmbId] = useState("");
  const [dispatchError, setDispatchError] = useState<string | null>(null);
  const [dispatching, setDispatching] = useState(false);

  /* cancel */
  const [cancelTarget, setCancelTarget] = useState<Mission | null>(null);
  const [cancelling, setCancelling] = useState(false);

  /* detail */
  const [detail, setDetail] = useState<Mission | null>(null);
  const [events, setEvents] = useState<CorridorEventRow[]>([]);
  const [eventsLoading, setEventsLoading] = useState(false);

  const emergencyOptions = useMasters("EMERGENCY_TYPE");

  const load = useCallback(async () => {
    try {
      const [mis, amb] = await Promise.all([
        get<Mission[]>("/api/missions"),
        get<Ambulance[]>("/api/ambulances"),
      ]);
      setMissions(Array.isArray(mis) ? mis : []);
      setAmbulances(Array.isArray(amb) ? amb : []);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load missions");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const filteredMissions = useMemo(
    () => (filter === "ALL" ? missions : missions.filter((m) => m.status === filter)),
    [missions, filter]
  );

  const availableAmbulances = useMemo(
    () => ambulances.filter((a) => a.status === "AVAILABLE"),
    [ambulances]
  );

  const dirty = JSON.stringify(form) !== JSON.stringify(initialForm);

  /* ------------------------------- actions -------------------------------- */

  const openCreate = () => {
    setForm(EMPTY_MISSION_FORM);
    setInitialForm(EMPTY_MISSION_FORM);
    setMissionAmbId("");
    setErrors({});
    setFormOpen(true);
  };

  const openDispatch = (m: Mission) => {
    setDispatchTarget(m);
    setDispatchAmbId("");
    setDispatchError(null);
  };

  const saveMission = async () => {
    const errs = collectErrors(
      ["patientName", required("Patient name")(form.patientName)],
      ["contact", phoneRule()(form.contact)],
      ["pickup", required("Pickup location")(form.pickup)],
      ["destination", required("Destination")(form.destination)]
    );
    if (errs) {
      setErrors(errs);
      return;
    }
    setErrors({});
    setSaving(true);
    try {
      const created = await post<{ id: string; requestRef: string }>("/api/missions", {
        patientName: form.patientName.trim(),
        contact: form.contact.trim(),
        emergencyType: form.emergencyType,
        priority: form.priority,
        pickup: form.pickup.trim(),
        destination: form.destination.trim(),
        route: form.route
          .filter((s) => s.name.trim())
          .map((s) => ({
            name: s.name.trim(),
            congestion: s.congestion,
            lengthKm: Number(s.lengthKm) || 0,
          })),
      });
      if (missionAmbId) {
        await patch(`/api/missions/${created.id}`, {
          action: "dispatch",
          ambulanceId: missionAmbId,
        });
        const amb = ambulances.find((a) => a.id === missionAmbId);
        toast.success(`${created.requestRef} created & dispatched with ${amb?.code ?? "ambulance"} — green corridor armed`);
      } else {
        toast.success(`${created.requestRef} logged — awaiting dispatch`);
      }
      setFormOpen(false);
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Create failed");
    } finally {
      setSaving(false);
    }
  };

  const dispatchExisting = async () => {
    if (!dispatchTarget) return;
    if (!dispatchAmbId) {
      setDispatchError("Select an available ambulance");
      return;
    }
    setDispatching(true);
    try {
      await patch(`/api/missions/${dispatchTarget.id}`, {
        action: "dispatch",
        ambulanceId: dispatchAmbId,
      });
      const amb = ambulances.find((a) => a.id === dispatchAmbId);
      toast.success(
        `${dispatchTarget.requestRef} dispatched with ${amb?.code ?? "ambulance"} — green corridor armed`
      );
      setDispatchTarget(null);
      setDetail(null);
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Dispatch failed");
    } finally {
      setDispatching(false);
    }
  };

  const runAction = async (m: Mission, action: "advance" | "complete") => {
    try {
      await patch(`/api/missions/${m.id}`, { action });
      toast.success(
        action === "advance"
          ? `${m.requestRef} advanced along the corridor`
          : `${m.requestRef} completed — ambulance released`
      );
      if (detail?.id === m.id) setDetail(null);
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Action failed");
    }
  };

  const cancelMission = async () => {
    if (!cancelTarget) return;
    setCancelling(true);
    try {
      await patch(`/api/missions/${cancelTarget.id}`, { action: "cancel" });
      toast.success(`${cancelTarget.requestRef} cancelled — corridor disarmed`);
      setCancelTarget(null);
      setDetail(null);
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Cancel failed");
    } finally {
      setCancelling(false);
    }
  };

  const openDetail = (m: Mission) => {
    setDetail(m);
    setEventsLoading(true);
    get<CorridorEventRow[]>(`/api/corridor-events?missionId=${m.id}`)
      .then((rows) => setEvents(Array.isArray(rows) ? rows : []))
      .catch(() => setEvents([]))
      .finally(() => setEventsLoading(false));
  };

  /* primary next-step action for a mission */
  const primaryAction = (
    m: Mission
  ): { label: string; run: () => void; className?: string } | null => {
    if (m.status === "REQUESTED")
      return { label: "Dispatch", run: () => openDispatch(m) };
    if (m.status === "DISPATCHED" || m.status === "EN_ROUTE")
      return { label: "Advance", run: () => void runAction(m, "advance"), className: "" };
    if (m.status === "ARRIVED")
      return {
        label: "Complete",
        run: () => void runAction(m, "complete"),
        className: "bg-emerald-600 text-white hover:bg-emerald-700",
      };
    return null;
  };

  const detailRoute = useMemo(() => parseRoute(detail?.route), [detail]);

  /* ------------------------------- renders -------------------------------- */

  const missionCard = (m: Mission) => {
    const primary = primaryAction(m);
    const closed = ["COMPLETED", "CANCELLED"].includes(m.status);
    return (
      <article key={m.id} className="rounded-xl border p-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-sm font-semibold">{m.requestRef}</span>
          <StatusBadge status={m.priority} tone={PRIORITY_TONE[m.priority] ?? "neutral"} />
          <StatusBadge status={m.status} />
          {m.corridorActive && (
            <Badge
              variant="outline"
              className="border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-400"
            >
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
          <Progress
            value={m.progress}
            className="h-2 flex-1 [&>div]:bg-red-500"
            aria-label={`Mission progress ${m.progress}%`}
          />
          <span className="text-xs font-medium">{m.progress}%</span>
        </div>
        <div className="mt-3 flex flex-wrap gap-1.5">
          <Button variant="outline" size="sm" onClick={() => openDetail(m)}>
            View
          </Button>
          {primary && (
            <Button
              size="sm"
              variant={primary.className ? "default" : "outline"}
              className={primary.className}
              onClick={primary.run}
            >
              {primary.label}
            </Button>
          )}
          {!closed && (
            <Button
              size="sm"
              variant="outline"
              className="text-red-600 hover:bg-red-500/10 dark:text-red-400"
              onClick={() => setCancelTarget(m)}
              aria-label={`Cancel mission ${m.requestRef}`}
            >
              <Ban className="size-3.5" aria-hidden="true" /> Cancel
            </Button>
          )}
        </div>
      </article>
    );
  };

  return (
    <div className="space-y-4">
      {/* status pill filters */}
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter missions by status">
        {MISSION_FILTERS.map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => setFilter(f)}
            aria-pressed={filter === f}
            className={cn(
              "min-h-9 rounded-full border px-3 text-xs font-semibold transition",
              filter === f
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border text-muted-foreground hover:bg-accent"
            )}
          >
            {f === "ALL" ? "All" : titleCase(f)}
          </button>
        ))}
      </div>

      <SectionCard
        title="Emergency missions"
        description="Live green-corridor runs with congestion-aware alerts."
        icon={<Siren className="size-4" aria-hidden="true" />}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <ViewSwitcher value={view} onChange={setView} options={["table", "list"]} />
            <ExportMenu
              columns={missionsCsv}
              rows={filteredMissions}
              filename="uar-missions"
              disabled={filteredMissions.length === 0}
            />
            <Button size="sm" onClick={openCreate}>
              <Siren className="size-4" aria-hidden="true" /> New mission
            </Button>
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
              <Button onClick={openCreate}>
                <Siren className="size-4" aria-hidden="true" /> New mission
              </Button>
            )}
          </EmptyState>
        ) : view === "table" ? (
          <div className="overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Request ref</TableHead>
                  <TableHead>Patient</TableHead>
                  <TableHead>Type / priority</TableHead>
                  <TableHead className="min-w-44">Route</TableHead>
                  <TableHead>Ambulance</TableHead>
                  <TableHead>ETA</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredMissions.map((m) => {
                  const primary = primaryAction(m);
                  const closed = ["COMPLETED", "CANCELLED"].includes(m.status);
                  return (
                    <TableRow key={m.id}>
                      <TableCell className="font-mono text-xs font-semibold">
                        {m.requestRef}
                      </TableCell>
                      <TableCell>
                        {m.patientName}
                        <span className="block text-xs text-muted-foreground">{m.contact}</span>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap items-center gap-1.5">
                          <Badge
                            variant="outline"
                            className="border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-400"
                          >
                            {labelOf(emergencyOptions.options, m.emergencyType)}
                          </Badge>
                          <StatusBadge
                            status={m.priority}
                            tone={PRIORITY_TONE[m.priority] ?? "neutral"}
                          />
                        </div>
                      </TableCell>
                      <TableCell className="max-w-52">
                        <span className="flex items-center gap-1 text-xs text-muted-foreground">
                          <span className="truncate">{m.pickup}</span>
                          <ArrowRight className="size-3 shrink-0" aria-hidden="true" />
                          <span className="truncate">{m.destination}</span>
                        </span>
                      </TableCell>
                      <TableCell className="whitespace-nowrap font-mono text-xs">
                        {m.ambulance ? m.ambulance.code : "—"}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-xs">
                        {m.etaMin ? `${m.etaMin} min` : "—"}
                      </TableCell>
                      <TableCell>
                        <span className="flex items-center gap-1">
                          <StatusBadge status={m.status} />
                          {m.corridorActive && (
                            <span title="Green corridor active">
                              <Zap
                                className="size-3.5 text-red-600 dark:text-red-400"
                                aria-label="Green corridor active"
                              />
                            </span>
                          )}
                        </span>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          {primary && (
                            <Button
                              size="sm"
                              variant={primary.className ? "default" : "outline"}
                              className={cn("h-8", primary.className)}
                              onClick={primary.run}
                            >
                              {primary.label}
                            </Button>
                          )}
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button
                                size="icon"
                                variant="ghost"
                                className="size-11 md:size-8"
                                aria-label={`Actions for ${m.requestRef}`}
                              >
                                <MoreHorizontal className="size-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem onSelect={() => openDetail(m)}>
                                View details
                              </DropdownMenuItem>
                              {m.status === "REQUESTED" && (
                                <DropdownMenuItem onSelect={() => openDispatch(m)}>
                                  Dispatch…
                                </DropdownMenuItem>
                              )}
                              {(m.status === "DISPATCHED" || m.status === "EN_ROUTE") && (
                                <DropdownMenuItem onSelect={() => void runAction(m, "advance")}>
                                  Advance
                                </DropdownMenuItem>
                              )}
                              {m.status === "ARRIVED" && (
                                <DropdownMenuItem onSelect={() => void runAction(m, "complete")}>
                                  Complete
                                </DropdownMenuItem>
                              )}
                              {!closed && (
                                <>
                                  <DropdownMenuSeparator />
                                  <DropdownMenuItem
                                    className="text-red-600 focus:text-red-700 dark:text-red-400"
                                    onSelect={() => setCancelTarget(m)}
                                  >
                                    Cancel mission
                                  </DropdownMenuItem>
                                </>
                              )}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        ) : (
          <div className="space-y-3" aria-label="Missions list">
            {filteredMissions.map(missionCard)}
          </div>
        )}
      </SectionCard>

      {/* ---------------------- create + dispatch sheet ---------------------- */}
      <FormSheet
        open={formOpen}
        onOpenChange={setFormOpen}
        title="New emergency mission"
        description="Log the request and optionally dispatch an ambulance — the green corridor arms on dispatch."
        submitLabel={missionAmbId ? "Create & dispatch" : "Create mission"}
        onSubmit={saveMission}
        loading={saving}
        dirty={dirty}
        size="xl"
      >
        <FormSection title="Patient">
          <FieldGrid>
            <TextField
              label="Patient name"
              required
              value={form.patientName}
              onChange={(v) => setForm({ ...form, patientName: v })}
              placeholder="Ramesh Gowda"
              error={errors.patientName}
            />
            <TextField
              label="Contact"
              required
              value={form.contact}
              onChange={(v) => setForm({ ...form, contact: v })}
              placeholder="9876543210"
              inputMode="tel"
              error={errors.contact}
            />
          </FieldGrid>
          <FieldGrid>
            <SelectField
              label="Emergency type"
              required
              value={form.emergencyType}
              onChange={(v) => setForm({ ...form, emergencyType: v })}
              options={emergencyOptions.options}
            />
            <SelectField
              label="Priority"
              required
              value={form.priority}
              onChange={(v) => setForm({ ...form, priority: v })}
              options={PRIORITY_OPTIONS}
            />
          </FieldGrid>
        </FormSection>

        <FormSection title="Route">
          <FieldGrid>
            <TextField
              label="Pickup"
              required
              value={form.pickup}
              onChange={(v) => setForm({ ...form, pickup: v })}
              placeholder="Sahakar Nagar, Bengaluru"
              error={errors.pickup}
            />
            <TextField
              label="Destination"
              required
              value={form.destination}
              onChange={(v) => setForm({ ...form, destination: v })}
              placeholder="Victoria Hospital"
              error={errors.destination}
            />
          </FieldGrid>
        </FormSection>

        <FormSection
          title="Planned route segments"
          description="Advisory — quick-add known bottlenecks or type custom segments. The corridor engine simulates live congestion on dispatch."
        >
          <div className="flex flex-wrap items-center gap-1.5">
            {SEGMENT_POOL.filter((name) => !form.route.some((s) => s.name === name)).map(
              (name) => (
                <button
                  key={name}
                  type="button"
                  onClick={() =>
                    setForm((f) => ({
                      ...f,
                      route: [...f.route, { name, congestion: "MODERATE", lengthKm: "1.5" }],
                    }))
                  }
                  aria-label={`Quick add segment ${name}`}
                  className="rounded-full border px-2.5 py-1 text-xs font-medium text-muted-foreground transition hover:bg-accent hover:text-foreground"
                >
                  <Plus className="mr-0.5 inline size-3" aria-hidden="true" /> {name}
                </button>
              )
            )}
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="ml-auto"
              onClick={() =>
                setForm((f) => ({
                  ...f,
                  route: [...f.route, { name: "", congestion: "MODERATE", lengthKm: "1" }],
                }))
              }
              aria-label="Add custom route segment"
            >
              <Plus className="size-3.5" aria-hidden="true" /> Custom segment
            </Button>
          </div>
          <div className="space-y-2">
            {form.route.map((seg, i) => (
              <div
                key={i}
                className="grid grid-cols-[1fr_104px_76px_36px] items-center gap-2 sm:grid-cols-[1fr_140px_90px_40px]"
              >
                <Input
                  value={seg.name}
                  onChange={(e) =>
                    setForm((f) => ({
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
                    setForm((f) => ({
                      ...f,
                      route: f.route.map((s, j) => (j === i ? { ...s, congestion: v } : s)),
                    }))
                  }
                >
                  <SelectTrigger aria-label={`Segment ${i + 1} congestion`}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CONGESTION_OPTIONS.map((o) => (
                      <SelectItem key={o.value} value={o.value}>
                        {o.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Input
                  type="number"
                  min={0}
                  step="0.1"
                  value={seg.lengthKm}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      route: f.route.map((s, j) =>
                        j === i ? { ...s, lengthKm: e.target.value } : s
                      ),
                    }))
                  }
                  aria-label={`Segment ${i + 1} length in kilometres`}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-9"
                  onClick={() =>
                    setForm((f) => ({ ...f, route: f.route.filter((_, j) => j !== i) }))
                  }
                  aria-label={`Remove segment ${i + 1}`}
                >
                  <Trash2 className="size-4" aria-hidden="true" />
                </Button>
              </div>
            ))}
            {form.route.length === 0 && (
              <p className="text-xs text-muted-foreground">
                No segments planned — quick-add above or let the corridor engine generate a route.
              </p>
            )}
          </div>
        </FormSection>

        <FormSection title="Dispatch">
          <SelectField
            label="Ambulance"
            value={missionAmbId}
            onChange={setMissionAmbId}
            options={availableAmbulances.map((a) => ({
              value: a.id,
              label: `${a.code} · ${a.type} · ${a.driverName}`,
            }))}
            placeholder="Leave empty — dispatch later"
            hint="Only AVAILABLE units are listed. Dispatching arms the green corridor immediately."
          />
          {availableAmbulances.length === 0 && (
            <p className="text-xs text-red-600 dark:text-red-400">
              No ambulances are currently available — the mission will be logged as REQUESTED.
            </p>
          )}
        </FormSection>
      </FormSheet>

      {/* ----------------------- dispatch existing sheet ---------------------- */}
      <FormSheet
        open={!!dispatchTarget}
        onOpenChange={(o) => {
          if (!o) {
            setDispatchTarget(null);
            setDispatchError(null);
          }
        }}
        title={`Dispatch ${dispatchTarget?.requestRef ?? ""}`}
        description={
          dispatchTarget
            ? `${dispatchTarget.patientName} · ${dispatchTarget.pickup} → ${dispatchTarget.destination}. Only AVAILABLE ambulances can be dispatched; the corridor arms automatically.`
            : undefined
        }
        submitLabel="Dispatch"
        onSubmit={dispatchExisting}
        loading={dispatching}
        size="md"
      >
        <SelectField
          label="Ambulance"
          required
          value={dispatchAmbId}
          onChange={(v) => {
            setDispatchAmbId(v);
            setDispatchError(null);
          }}
          options={availableAmbulances.map((a) => ({
            value: a.id,
            label: `${a.code} · ${a.type} · ${a.driverName}`,
          }))}
          placeholder="Select an available ambulance"
          error={dispatchError}
        />
        {availableAmbulances.length === 0 && (
          <p className="text-xs text-red-600 dark:text-red-400">
            No ambulances are currently available. Free one up by completing a mission or add a unit
            in the Fleet tab.
          </p>
        )}
      </FormSheet>

      {/* --------------------------- mission detail --------------------------- */}
      <Sheet open={!!detail} onOpenChange={(o) => !o && setDetail(null)}>
        <SheetContent className="flex w-full flex-col gap-0 overflow-y-auto p-0 sm:max-w-md">
          {detail && (
            <div className="space-y-5 p-5">
              <SheetHeader className="p-0 text-left">
                <SheetTitle className="flex items-center gap-2">
                  <span className="font-mono">{detail.requestRef}</span>
                  <StatusBadge status={detail.status} className="ml-auto" />
                </SheetTitle>
                <SheetDescription>
                  {detail.patientName} ·{" "}
                  {labelOf(emergencyOptions.options, detail.emergencyType)}
                </SheetDescription>
              </SheetHeader>

              {detail.corridorActive && (
                <div
                  role="status"
                  className="flex items-center gap-2 rounded-xl border border-red-500/40 bg-red-500/10 px-3 py-2.5 text-sm font-semibold text-red-700 dark:text-red-400"
                >
                  <Zap className="size-4 animate-pulse" aria-hidden="true" />
                  Green corridor ACTIVE
                </div>
              )}

              <div className="grid grid-cols-2 gap-x-4 gap-y-4">
                <DataField label="Patient" value={detail.patientName} />
                <DataField label="Contact" value={detail.contact} mono copy />
                <DataField
                  label="Priority"
                  value={
                    <StatusBadge
                      status={detail.priority}
                      tone={PRIORITY_TONE[detail.priority] ?? "neutral"}
                    />
                  }
                />
                <DataField
                  label="Ambulance"
                  value={
                    detail.ambulance
                      ? `${detail.ambulance.code} (${detail.ambulance.type})`
                      : "Unassigned"
                  }
                />
                <DataField label="Vehicles alerted" value={fmtNum(detail.vehiclesAlerted)} />
                <DataField label="Time saved" value={formatDuration(detail.timeSavedSec)} />
                <DataField label="ETA" value={detail.etaMin ? `${detail.etaMin} min` : "—"} />
                <DataField
                  label="Route"
                  value={`${detail.pickup} → ${detail.destination}`}
                  className="col-span-2"
                />
              </div>

              <SectionCard
                title="Route segments"
                description="Congestion along the planned corridor"
                icon={<Route className="size-4" aria-hidden="true" />}
              >
                {detailRoute.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    Route is generated when the mission is dispatched.
                  </p>
                ) : (
                  <ol className="space-y-2">
                    {detailRoute.map((seg, i) => (
                      <li key={i} className="flex items-center gap-2 rounded-lg border px-3 py-2 text-sm">
                        <span className="grid size-6 shrink-0 place-items-center rounded-full bg-muted text-[11px] font-semibold">
                          {i + 1}
                        </span>
                        <span className="min-w-0 flex-1 truncate">{seg.name}</span>
                        <span className="hidden text-xs text-muted-foreground sm:inline">
                          {seg.lengthKm} km
                        </span>
                        <StatusBadge
                          status={seg.congestion}
                          tone={CONGESTION_TONE[seg.congestion] ?? "neutral"}
                          className="shrink-0"
                        />
                      </li>
                    ))}
                  </ol>
                )}
                <div className="mt-3 flex items-center gap-3">
                  <Progress
                    value={detail.progress}
                    className="h-2 flex-1 [&>div]:bg-red-500"
                    aria-label={`Mission progress ${detail.progress}%`}
                  />
                  <span className="text-xs font-medium">{detail.progress}%</span>
                </div>
              </SectionCard>

              <SectionCard
                title="Corridor events"
                description="Alert ladder per congested segment"
                icon={<Radio className="size-4" aria-hidden="true" />}
              >
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
                  <ol className="max-h-96 space-y-2 overflow-y-auto scrollbar-thin">
                    {events.map((ev) => (
                      <li key={ev.id} className="rounded-lg border p-3">
                        <div className="flex flex-wrap items-center gap-2">
                          <StatusBadge
                            status={ev.method}
                            tone={METHOD_TONE[ev.method] ?? "neutral"}
                            className="font-mono"
                          >
                            {ev.method}
                          </StatusBadge>
                          <StatusBadge
                            status={ev.congestion}
                            tone={CONGESTION_TONE[ev.congestion] ?? "neutral"}
                          />
                          <span className="ml-auto text-xs text-muted-foreground">
                            {formatDateTime(ev.createdAt)}
                          </span>
                        </div>
                        <p className="mt-1.5 text-sm font-medium">{ev.segment}</p>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {fmtNum(ev.vehiclesAlerted)} vehicles alerted ·{" "}
                          {formatDuration(ev.timeSavedSec)} saved
                        </p>
                        {ev.note && (
                          <p className="mt-1 text-xs italic text-muted-foreground">{ev.note}</p>
                        )}
                      </li>
                    ))}
                  </ol>
                )}
              </SectionCard>

              {!["COMPLETED", "CANCELLED"].includes(detail.status) && (
                <div className="flex flex-wrap gap-2 border-t pt-4">
                  {detail.status === "REQUESTED" && (
                    <Button size="sm" onClick={() => openDispatch(detail)}>
                      <AmbulanceIcon className="size-3.5" aria-hidden="true" /> Dispatch
                    </Button>
                  )}
                  {(detail.status === "DISPATCHED" || detail.status === "EN_ROUTE") && (
                    <Button size="sm" variant="outline" onClick={() => void runAction(detail, "advance")}>
                      <ArrowRight className="size-3.5" aria-hidden="true" /> Advance
                    </Button>
                  )}
                  {detail.status === "ARRIVED" && (
                    <Button
                      size="sm"
                      className="bg-emerald-600 text-white hover:bg-emerald-700"
                      onClick={() => void runAction(detail, "complete")}
                    >
                      <Flag className="size-3.5" aria-hidden="true" /> Complete
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="outline"
                    className="ml-auto text-red-600 hover:bg-red-500/10 dark:text-red-400"
                    onClick={() => setCancelTarget(detail)}
                    aria-label={`Cancel mission ${detail.requestRef}`}
                  >
                    <Ban className="size-3.5" aria-hidden="true" /> Cancel
                  </Button>
                </div>
              )}
            </div>
          )}
        </SheetContent>
      </Sheet>

      <ConfirmDialog
        open={!!cancelTarget}
        onOpenChange={(o) => !o && setCancelTarget(null)}
        title="Cancel mission?"
        recordName={
          cancelTarget
            ? `${cancelTarget.requestRef} · ${cancelTarget.patientName} · ${cancelTarget.pickup} → ${cancelTarget.destination}`
            : null
        }
        description="The mission will be cancelled and the green corridor disarmed. Any assigned ambulance returns to AVAILABLE."
        confirmLabel="Cancel mission"
        loading={cancelling}
        onConfirm={cancelMission}
      />

      {/* live region for screen readers */}
      <span className="sr-only" aria-live="polite">
        {loading ? "Loading missions" : `${filteredMissions.length} missions shown`}
      </span>
    </div>
  );
}

/* ============================== CORRIDOR TAB =============================== */

const corridorCsv: CsvColumn<CorridorEventRow>[] = [
  { header: "Time", value: (e) => (e.createdAt ? new Date(e.createdAt).toISOString() : "") },
  { header: "Mission ref", value: (e) => e.mission?.requestRef ?? "" },
  { header: "Segment", value: (e) => e.segment },
  { header: "Method", value: (e) => e.method },
  { header: "Congestion", value: (e) => e.congestion },
  { header: "Vehicles alerted", value: (e) => e.vehiclesAlerted },
  { header: "Time saved (sec)", value: (e) => e.timeSavedSec },
];

function CorridorTab() {
  const [events, setEvents] = useState<CorridorEventRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [methodFilter, setMethodFilter] = useState("ALL");
  const [congestionFilter, setCongestionFilter] = useState("ALL");
  const [q, setQ] = useState("");
  const [view, setView] = useViewPref("ambulance-corridor");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const rows = await get<CorridorEventRow[]>("/api/corridor-events?limit=200");
      setEvents(Array.isArray(rows) ? rows : []);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load corridor events");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return events.filter((e) => {
      if (methodFilter !== "ALL" && e.method !== methodFilter) return false;
      if (congestionFilter !== "ALL" && e.congestion !== congestionFilter) return false;
      if (needle) {
        const hay = `${e.segment} ${e.mission?.requestRef ?? ""} ${e.note ?? ""}`.toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      return true;
    });
  }, [events, methodFilter, congestionFilter, q]);

  const totals = useMemo(
    () => ({
      vehicles: filtered.reduce((s, e) => s + (e.vehiclesAlerted ?? 0), 0),
      saved: filtered.reduce((s, e) => s + (e.timeSavedSec ?? 0), 0),
    }),
    [filtered]
  );

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard
          label="Events logged"
          value={filtered.length}
          accent="teal"
          icon={<Radio className="size-5" aria-hidden="true" />}
          loading={loading}
          hint="Newest 200 shown"
        />
        <StatCard
          label="Vehicles alerted"
          value={fmtNum(totals.vehicles)}
          accent="amber"
          icon={<Siren className="size-5" aria-hidden="true" />}
          loading={loading}
          hint="Across filtered events"
        />
        <StatCard
          label="Time saved"
          value={formatDuration(totals.saved)}
          accent="lime"
          icon={<Zap className="size-5" aria-hidden="true" />}
          loading={loading}
          hint="Corridor clearance benefit"
        />
      </div>

      <SectionCard
        title="Corridor alert log"
        description="Every green-corridor alert across all missions — V2X, cell broadcast, mesh, FM and siren."
        icon={<Radio className="size-4" aria-hidden="true" />}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <ViewSwitcher value={view} onChange={setView} options={["table", "list"]} />
            <ExportMenu
              columns={corridorCsv}
              rows={filtered}
              filename="uar-corridor-events"
              disabled={filtered.length === 0}
            />
          </div>
        }
      >
        {/* filters */}
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <Select value={methodFilter} onValueChange={setMethodFilter}>
            <SelectTrigger className="w-full sm:w-44" aria-label="Filter by alert method">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All methods</SelectItem>
              {METHODS.map((m) => (
                <SelectItem key={m} value={m}>
                  {m}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={congestionFilter} onValueChange={setCongestionFilter}>
            <SelectTrigger className="w-full sm:w-40" aria-label="Filter by congestion">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All congestion</SelectItem>
              {CONGESTIONS.map((c) => (
                <SelectItem key={c} value={c}>
                  {titleCase(c)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="relative min-w-40 flex-1">
            <Search
              className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden="true"
            />
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search segment or mission ref…"
              className="h-9 pl-8"
              aria-label="Search corridor events"
            />
          </div>
        </div>

        {loading ? (
          <div className="space-y-2" aria-busy="true">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-11 rounded-lg" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={<Radio className="size-8" aria-hidden="true" />}
            title={events.length === 0 ? "No corridor events yet" : "No events match the filters"}
            hint={
              events.length === 0
                ? "Events are recorded when missions are dispatched along congested segments."
                : "Try clearing the method or congestion filters."
            }
          >
            {(events.length > 0 || q) && (
              <Button
                variant="outline"
                onClick={() => {
                  setMethodFilter("ALL");
                  setCongestionFilter("ALL");
                  setQ("");
                }}
              >
                <RefreshCw className="size-4" aria-hidden="true" /> Reset filters
              </Button>
            )}
          </EmptyState>
        ) : view === "table" ? (
          <div className="overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Time</TableHead>
                  <TableHead>Mission</TableHead>
                  <TableHead>Segment</TableHead>
                  <TableHead>Method</TableHead>
                  <TableHead>Congestion</TableHead>
                  <TableHead className="text-right">Vehicles</TableHead>
                  <TableHead className="text-right">Saved</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((e) => (
                  <TableRow key={e.id}>
                    <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                      {formatDateTime(e.createdAt)}
                    </TableCell>
                    <TableCell className="font-mono text-xs font-semibold">
                      {e.mission?.requestRef ?? "—"}
                    </TableCell>
                    <TableCell className="max-w-44 truncate text-sm">{e.segment}</TableCell>
                    <TableCell>
                      <StatusBadge
                        status={e.method}
                        tone={METHOD_TONE[e.method] ?? "neutral"}
                        className="font-mono text-[11px]"
                      >
                        {e.method}
                      </StatusBadge>
                    </TableCell>
                    <TableCell>
                      <StatusBadge
                        status={e.congestion}
                        tone={CONGESTION_TONE[e.congestion] ?? "neutral"}
                      />
                    </TableCell>
                    <TableCell className="text-right font-medium">{fmtNum(e.vehiclesAlerted)}</TableCell>
                    <TableCell className="text-right font-medium">
                      {formatDuration(e.timeSavedSec)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        ) : (
          <ul className="max-h-[36rem] space-y-2 overflow-y-auto scrollbar-thin" aria-label="Corridor events list">
            {filtered.map((e) => (
              <li key={e.id} className="flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{e.segment}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    <span className="font-mono">{e.mission?.requestRef ?? "—"}</span> ·{" "}
                    {formatDateTime(e.createdAt)} · {fmtNum(e.vehiclesAlerted)} vehicles alerted
                    {e.note ? ` · ${e.note}` : ""}
                  </p>
                </div>
                <div className="flex shrink-0 flex-wrap items-center justify-end gap-1">
                  <StatusBadge
                    status={e.method}
                    tone={METHOD_TONE[e.method] ?? "neutral"}
                    className="font-mono text-[11px]"
                  >
                    {e.method}
                  </StatusBadge>
                  <StatusBadge
                    status={e.congestion}
                    tone={CONGESTION_TONE[e.congestion] ?? "neutral"}
                  />
                  <span className="rounded-md bg-muted px-2 py-0.5 text-[11px] font-semibold">
                    {formatDuration(e.timeSavedSec)} saved
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>
    </div>
  );
}
