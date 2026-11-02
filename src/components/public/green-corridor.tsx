"use client";

import * as React from "react";
import { useEffect, useRef, useState } from "react";
import { Link } from "@/lib/router";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Section, HelplineCard } from "@/components/public/shared";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from "recharts";
import {
  Ambulance,
  ArrowDown,
  ArrowRight,
  Bluetooth,
  Car,
  Gauge,
  Heart,
  Play,
  Phone,
  Radio,
  RotateCcw,
  Siren,
  Timer,
  Volume2,
  Waves,
} from "lucide-react";

/* ================================================================== */
/* LiveCorridorDemo — pure client-side simulation (no API)             */
/* ================================================================== */

type Congestion = "LOW" | "MODERATE" | "HEAVY" | "GRIDLOCK";

interface Segment {
  name: string;
  km: number;
}

const SEGMENTS: Segment[] = [
  { name: "Hebbal Flyover", km: 3.1 },
  { name: "ORR · Nagawara", km: 2.6 },
  { name: "Silk Board Jn", km: 2.2 },
  { name: "KR Puram Jn", km: 2.8 },
  { name: "Tin Factory", km: 2.4 },
];

interface CongestionMeta {
  label: string;
  color: string;
  chip: string;
  method: string;
  methodBadge: string;
  saved: [number, number];
}

const META: Record<Congestion, CongestionMeta> = {
  LOW: {
    label: "Low",
    color: "#10b981",
    chip: "bg-emerald-100 text-emerald-700",
    method: "FM RDS",
    methodBadge: "bg-zinc-800 text-white",
    saved: [2, 4],
  },
  MODERATE: {
    label: "Moderate",
    color: "#f59e0b",
    chip: "bg-amber-100 text-amber-700",
    method: "BLE Mesh",
    methodBadge: "bg-teal-600 text-white",
    saved: [5, 10],
  },
  HEAVY: {
    label: "Heavy",
    color: "#f97316",
    chip: "bg-orange-100 text-orange-700",
    method: "Cell Broadcast",
    methodBadge: "bg-orange-600 text-white",
    saved: [15, 25],
  },
  GRIDLOCK: {
    label: "Gridlock",
    color: "#ef4444",
    chip: "bg-red-100 text-red-700",
    method: "V2X 5G + BLE",
    methodBadge: "bg-red-600 text-white",
    saved: [30, 45],
  },
};

const TOTAL_KM = SEGMENTS.reduce((n, s) => n + s.km, 0);

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function randInt(min: number, max: number): number {
  return min + Math.floor(Math.random() * (max - min + 1));
}

function pickCongestion(): Congestion {
  const r = Math.random();
  if (r < 0.25) return "LOW";
  if (r < 0.55) return "MODERATE";
  if (r < 0.85) return "HEAVY";
  return "GRIDLOCK";
}

interface LogEntry {
  id: number;
  segment: string;
  method: string;
  vehicles: number;
  saved: number;
  congestion: Congestion;
}

export function LiveCorridorDemo() {
  const [phase, setPhase] = useState<"idle" | "running" | "done">("idle");
  const [cong, setCong] = useState<Congestion[]>(SEGMENTS.map(() => "LOW"));
  const [revealed, setRevealed] = useState<boolean[]>(SEGMENTS.map(() => false));
  const [cars, setCars] = useState<number[]>(SEGMENTS.map(() => 4));
  const [alerted, setAlerted] = useState<boolean[]>(SEGMENTS.map(() => false));
  const [pulse, setPulse] = useState(-1);
  const [ambX, setAmbX] = useState(1);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [savedSec, setSavedSec] = useState(0);
  const [alertedTotal, setAlertedTotal] = useState(0);
  const [method, setMethod] = useState<string>("—");
  const cancelled = useRef(false);
  const logId = useRef(0);

  useEffect(() => {
    return () => {
      cancelled.current = true;
    };
  }, []);

  const reset = () => {
    cancelled.current = true;
    setPhase("idle");
    setCong(SEGMENTS.map(() => "LOW"));
    setRevealed(SEGMENTS.map(() => false));
    setCars(SEGMENTS.map(() => 4));
    setAlerted(SEGMENTS.map(() => false));
    setPulse(-1);
    setAmbX(1);
    setLog([]);
    setSavedSec(0);
    setAlertedTotal(0);
    setMethod("—");
    // allow a fresh run on next tick
    setTimeout(() => {
      cancelled.current = false;
    }, 0);
  };

  const run = async () => {
    if (phase === "running") return;
    cancelled.current = false;

    // Generate today's traffic
    const nextCong: Congestion[] = SEGMENTS.map(() => pickCongestion());
    const nextCars: number[] = SEGMENTS.map(() => randInt(3, 6));

    setPhase("running");
    setCong(nextCong);
    setCars(nextCars);
    setRevealed(SEGMENTS.map(() => false));
    setAlerted(SEGMENTS.map(() => false));
    setLog([]);
    setSavedSec(0);
    setAlertedTotal(0);
    setMethod("Scanning traffic…");
    setPulse(-1);
    setAmbX(1);

    await sleep(700);
    if (cancelled.current) return;
    setRevealed(SEGMENTS.map(() => true));

    await sleep(600);
    if (cancelled.current) return;

    let totalSaved = 0;
    let totalAlerted = 0;

    for (let i = 0; i < SEGMENTS.length; i++) {
      // Ambulance rolls into the segment
      setAmbX(i * 20 + 1);
      await sleep(150);
      if (cancelled.current) return;

      // Corridor alert fires for this segment
      const meta = META[nextCong[i]];
      const vehicles = nextCars[i] + randInt(1, 3);
      const saved = randInt(meta.saved[0], meta.saved[1]);
      totalSaved += saved;
      totalAlerted += vehicles;

      setAlerted((prev) => prev.map((v, idx) => idx === i || v));
      setPulse(i);
      setMethod(meta.method);
      setSavedSec(totalSaved);
      setAlertedTotal(totalAlerted);
      setLog((prev) => [
        {
          id: ++logId.current,
          segment: SEGMENTS[i].name,
          method: meta.method,
          vehicles,
          saved,
          congestion: nextCong[i],
        },
        ...prev,
      ]);

      await sleep(650); // cars react & shift
      if (cancelled.current) return;
      setPulse(-1);

      // Cross the segment
      setAmbX(i * 20 + 19);
      await sleep(1800);
      if (cancelled.current) return;
    }

    setMethod("Mission complete");
    setPhase("done");
    toast.success(
      `Corridor run complete — ${totalSaved}s saved, ${totalAlerted} vehicles alerted across ${SEGMENTS.length} segments.`
    );
  };

  const totalDistance = Math.round(((ambX - 1) / 98) * TOTAL_KM * 10) / 10;

  return (
    <Card className="overflow-hidden p-0">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b bg-muted/40 px-4 py-3 sm:px-5">
        <div className="flex items-center gap-2">
          <span className="flex size-8 items-center justify-center rounded-lg bg-red-100 text-red-700">
            <Ambulance className="size-4" aria-hidden />
          </span>
          <div>
            <p className="text-sm font-bold leading-tight">Live corridor simulation</p>
            <p className="text-[11px] text-muted-foreground">
              Hebbal → Tin Factory · {TOTAL_KM} km · randomised traffic
            </p>
          </div>
        </div>
        <Badge className={cn("border-0", method === "—" ? "bg-zinc-200 text-zinc-600" : method === "Mission complete" ? "bg-emerald-600 text-white" : "bg-red-600 text-white")}>
          <Radio className="mr-1 size-3" aria-hidden />
          {method}
        </Badge>
      </div>

      {/* Segment labels + congestion chips */}
      <div className="grid grid-cols-5 gap-1 px-3 pt-3 sm:px-5">
        {SEGMENTS.map((s, i) => (
          <div key={s.name} className="text-center">
            <p className="truncate text-[10px] font-semibold text-muted-foreground sm:text-xs">
              {s.name}
            </p>
            <span
              className={cn(
                "mt-1 inline-block rounded-full px-1.5 py-0.5 text-[9px] font-bold sm:text-[10px]",
                revealed[i] ? META[cong[i]].chip : "bg-muted text-muted-foreground"
              )}
            >
              {revealed[i] ? META[cong[i]].label : "—"}
            </span>
          </div>
        ))}
      </div>

      {/* Road */}
      <div className="px-3 pt-2 sm:px-5">
        <div className="relative h-32 overflow-hidden rounded-xl bg-zinc-300 sm:h-36" role="img" aria-label="Road simulation with an ambulance crossing five segments">
          {/* Asphalt + lanes */}
          <div className="absolute inset-x-0 top-6 bottom-6 bg-zinc-500" />
          <div className="absolute inset-x-0 top-[calc(50%+1px)] border-t-2 border-dashed border-white/70" aria-hidden />

          {/* Congestion tints */}
          {SEGMENTS.map((s, i) => (
            <div
              key={s.name}
              className="absolute top-6 bottom-6 transition-colors duration-700"
              style={{
                left: `${i * 20}%`,
                width: "20%",
                backgroundColor: revealed[i] ? META[cong[i]].color : "transparent",
                opacity: revealed[i] ? 0.35 : 0,
              }}
            />
          ))}

          {/* Segment dividers */}
          {[20, 40, 60, 80].map((p) => (
            <div
              key={p}
              aria-hidden
              className="absolute top-4 bottom-4 w-px bg-white/40"
              style={{ left: `${p}%` }}
            />
          ))}

          {/* Pulse ring at alerting segment */}
          {pulse >= 0 && (
            <span
              aria-hidden
              className="absolute top-1/2 size-10 -translate-x-1/2 -translate-y-1/2 animate-ping rounded-full border-4 border-white/80 bg-white/30"
              style={{ left: `${pulse * 20 + 10}%` }}
            />
          )}

          {/* Cars */}
          {SEGMENTS.map((s, i) =>
            Array.from({ length: cars[i] }).map((_, j) => {
              const pos = i * 20 + ((j + 0.8) / (cars[i] + 0.6)) * 20;
              const isAlerted = alerted[i];
              return (
                <span
                  key={`${i}-${j}`}
                  className={cn(
                    "absolute flex size-5 -translate-x-1/2 items-center justify-center rounded-full transition-all duration-700 sm:size-6",
                    isAlerted ? "bg-emerald-500 text-white shadow-md" : "bg-zinc-400 text-zinc-600"
                  )}
                  style={{
                    left: `${pos}%`,
                    top: isAlerted ? "4px" : j % 2 === 0 ? "38%" : "62%",
                  }}
                >
                  <Car className="size-3" aria-hidden />
                </span>
              );
            })
          )}

          {/* Ambulance */}
          <span
            className="absolute top-1/2 z-10 flex size-9 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-lg bg-white text-red-600 shadow-lg transition-[left] duration-[1800ms] ease-linear sm:size-10"
            style={{ left: `${ambX}%` }}
            aria-label="Ambulance"
          >
            <Ambulance className="size-5" aria-hidden />
            <span className="absolute inset-0 rounded-lg ring-2 ring-red-500/60" aria-hidden />
          </span>

          {/* Coverage note */}
          <div className="absolute bottom-1 right-2 text-[10px] font-medium text-white/90">
            2 km ahead broadcast · 4-layer mesh
          </div>
        </div>
      </div>

      {/* Counters */}
      <div className="grid grid-cols-2 gap-3 px-3 pt-4 sm:grid-cols-4 sm:px-5">
        <div className="rounded-lg border bg-card p-3">
          <p className="flex items-center gap-1 text-[11px] font-medium text-muted-foreground">
            <Timer className="size-3.5" aria-hidden /> Time saved
          </p>
          <p className="text-lg font-bold text-emerald-700">{savedSec}s</p>
        </div>
        <div className="rounded-lg border bg-card p-3">
          <p className="flex items-center gap-1 text-[11px] font-medium text-muted-foreground">
            <Waves className="size-3.5" aria-hidden /> Vehicles alerted
          </p>
          <p className="text-lg font-bold">{alertedTotal}</p>
        </div>
        <div className="rounded-lg border bg-card p-3">
          <p className="flex items-center gap-1 text-[11px] font-medium text-muted-foreground">
            <Gauge className="size-3.5" aria-hidden /> Distance
          </p>
          <p className="text-lg font-bold">{totalDistance} km</p>
        </div>
        <div className="rounded-lg border bg-card p-3">
          <p className="flex items-center gap-1 text-[11px] font-medium text-muted-foreground">
            <Radio className="size-3.5" aria-hidden /> Alert method
          </p>
          <p className="truncate text-sm font-bold">{method}</p>
        </div>
      </div>

      {/* Controls */}
      <div className="flex flex-wrap items-center gap-2 px-3 pt-4 sm:px-5">
        <Button
          onClick={run}
          disabled={phase === "running"}
          className="bg-red-600 text-white hover:bg-red-700"
        >
          <Play className="size-4" aria-hidden />
          {phase === "running" ? "Mission running…" : phase === "done" ? "Run again" : "Run mission"}
        </Button>
        <Button variant="outline" onClick={reset} disabled={phase === "running"}>
          <RotateCcw className="size-4" aria-hidden /> Reset
        </Button>
        <p className="text-xs text-muted-foreground">
          GRIDLOCK → V2X 5G + BLE · HEAVY → Cell broadcast · MODERATE → BLE mesh · LOW → FM RDS
        </p>
      </div>

      {/* Event log */}
      <div className="px-3 pb-4 pt-4 sm:px-5">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Per-segment event log
        </p>
        <div className="mt-2 max-h-48 overflow-y-auto rounded-lg border scrollbar-thin">
          {log.length === 0 ? (
            <p className="px-3 py-4 text-center text-xs text-muted-foreground">
              No corridor events yet — press “Run mission”.
            </p>
          ) : (
            <ul className="divide-y">
              {log.map((e) => (
                <li key={e.id} className="flex items-center gap-2 px-3 py-2 text-xs">
                  <span className={cn("rounded px-1.5 py-0.5 text-[10px] font-bold", META[e.congestion].chip)}>
                    {META[e.congestion].label}
                  </span>
                  <span className="min-w-0 flex-1 truncate font-medium">{e.segment}</span>
                  <span className="hidden font-semibold text-zinc-600 sm:inline">{e.method}</span>
                  <span className="text-muted-foreground">{e.vehicles} veh</span>
                  <span className="font-bold text-emerald-700">−{e.saved}s</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </Card>
  );
}

/* ================================================================== */
/* GreenCorridorPage                                                   */
/* ================================================================== */

const MESH_LAYERS = [
  {
    n: 1,
    icon: Radio,
    title: "V2X 5G + Cell Broadcast",
    reach: "2 km ahead",
    desc: "The ambulance's route is broadcast to connected cars and nav apps over 5G/4G V2X and cell broadcast. Highest capacity layer — reroutes modern fleets before they ever see the siren.",
  },
  {
    n: 2,
    icon: Bluetooth,
    title: "Roadside Units + BLE Mesh",
    reach: "800 m hops",
    desc: "₹500 Bluetooth beacons on poles pass the alert hop-by-hop with NO internet, no SIM, no tower. Built for dead zones, tunnels and flood days when networks fail.",
  },
  {
    n: 3,
    icon: Radio,
    title: "FM-RDS Break-in",
    reach: "5 km radius",
    desc: "Legacy cars and radios receive a break-in alert on the FM band. Old technology, near-universal reach — no smart car required.",
  },
  {
    n: 4,
    icon: Volume2,
    title: "Smart Adaptive Siren",
    reach: "Last resort",
    desc: "A siren that adapts pattern and direction by congestion, with junction approach-lights. Replaces panic-blare with a structured sound corridor.",
  },
];

const HOTSPOTS = [
  { jn: "Hebbal Flyover", peak: "Gridlock (morning peak)", layer: "V2X 5G + Cell broadcast" },
  { jn: "ORR · Nagawara", peak: "Heavy all day", layer: "V2X 5G + BLE mesh" },
  { jn: "Silk Board Junction", peak: "Gridlock (evening peak)", layer: "Cell broadcast + BLE" },
  { jn: "KR Puram Junction", peak: "Heavy · bridge dead zones", layer: "BLE mesh (offline-proof)" },
  { jn: "Tin Factory", peak: "Moderate", layer: "FM-RDS + adaptive siren" },
];

export function GreenCorridorPage() {
  return (
    <>
      {/* Hero */}
      <section className="bg-red-600 text-white">
        <div className="mx-auto w-full max-w-6xl px-4 py-12 sm:px-6 sm:py-16">
          <Badge className="border-0 bg-white/15 text-white">
            <Siren className="mr-1 size-3" aria-hidden /> Programme · green-corridor
          </Badge>
          <h1 className="mt-4 max-w-3xl text-3xl font-extrabold tracking-tight sm:text-4xl lg:text-5xl">
            AI Green Corridor — ambulances that clear their own path
          </h1>
          <p className="mt-4 max-w-2xl text-sm leading-relaxed text-white/90 sm:text-base">
            City ambulances average 11 km/h in traffic while cardiac survival drops 10–15% every
            minute. Our four-layer alert mesh reorganises the road itself — 40–60% faster
            missions, audited to the second.
          </p>
          <div className="mt-6 flex flex-wrap gap-2.5">
            {[
              { k: "11 km/h", v: "avg ambulance speed in traffic" },
              { k: "10–15%/min", v: "cardiac survival lost to delay" },
              { k: "40–60%", v: "faster with the corridor" },
            ].map((s) => (
              <span
                key={s.k}
                className="rounded-full bg-white/15 px-3.5 py-1.5 text-xs font-semibold ring-1 ring-white/25"
              >
                {s.k} <span className="font-normal text-white/80">· {s.v}</span>
              </span>
            ))}
          </div>
          <div className="mt-8 flex flex-wrap gap-3">
            <Button size="lg" className="border-0 bg-white text-red-700 hover:bg-white/90" asChild>
              <a href="tel:108">
                <Phone className="size-5" aria-hidden /> Call 108
              </a>
            </Button>
            <Button
              size="lg"
              variant="outline"
              className="border-white bg-transparent text-white hover:bg-white/10"
              asChild
            >
              <a href="tel:112">Emergency 112</a>
            </Button>
            <Button
              size="lg"
              variant="outline"
              className="border-white bg-transparent text-white hover:bg-white/10"
              asChild
            >
              <Link href="/donate?campaign=green-corridor">
                <Heart className="size-5" aria-hidden /> Fund a corridor
              </Link>
            </Button>
          </div>
        </div>
      </section>

      {/* Live demo */}
      <Section
        title="Run a live mission"
        subtitle="Randomised Bengaluru traffic, five segments, one ambulance. Watch which layer fires at each junction — and count the seconds."
        className="pb-0"
      >
        <LiveCorridorDemo />
      </Section>

      {/* 4-layer mesh */}
      <Section
        title="The 4-layer alert mesh"
        subtitle="No single technology covers India's mixed traffic. Four independent layers do — each one catches what the others miss."
        className="pt-12"
      >
        <div className="flex flex-col items-stretch gap-3 lg:flex-row">
          {MESH_LAYERS.map((l, i) => (
            <React.Fragment key={l.n}>
              <Card className="flex-1 p-5">
                <div className="flex items-center gap-3">
                  <span className="flex size-10 items-center justify-center rounded-xl bg-red-100 text-red-700">
                    <l.icon className="size-5" aria-hidden />
                  </span>
                  <div>
                    <p className="text-[11px] font-bold uppercase tracking-wide text-red-600">
                      Layer {l.n}
                    </p>
                    <Badge variant="outline" className="mt-0.5 border-red-200 text-[10px] text-red-700">
                      {l.reach}
                    </Badge>
                  </div>
                </div>
                <h3 className="mt-3 font-semibold leading-snug">{l.title}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{l.desc}</p>
              </Card>
              {i < MESH_LAYERS.length - 1 && (
                <div
                  aria-hidden
                  className="flex items-center justify-center text-red-400 lg:flex-col"
                >
                  <ArrowRight className="hidden size-5 lg:block" />
                  <ArrowDown className="size-5 lg:hidden" />
                </div>
              )}
            </React.Fragment>
          ))}
        </div>

        {/* Why Bluetooth matters */}
        <Card className="mt-6 border-teal-200 bg-teal-50/60 p-6">
          <div className="flex items-start gap-4">
            <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-teal-100 text-teal-700">
              <Bluetooth className="size-6" aria-hidden />
            </span>
            <div>
              <h3 className="font-semibold text-teal-900">Why Bluetooth matters</h3>
              <ul className="mt-3 grid gap-2 text-sm leading-relaxed text-teal-900/80 sm:grid-cols-2">
                <li>• Works with no internet, no SIM, no tower — exactly when floods and storms cut networks.</li>
                <li>• A beacon costs ~₹500; a city corridor needs dozens, not crores.</li>
                <li>• Messages hop car-to-car and beacon-to-beacon, bending around obstacles.</li>
                <li>• No tracking, no personal data — just &ldquo;ambulance coming, clear left lane&rdquo;.</li>
              </ul>
            </div>
          </div>
        </Card>
      </Section>

      {/* Hotspot table */}
      <Section
        title="Bengaluru hotspot map"
        subtitle="Where minutes die — and which layer we prioritise at each junction."
        className="bg-muted/40"
      >
        <Card className="overflow-hidden p-0">
          <div className="grid grid-cols-3 gap-2 border-b bg-muted/60 px-4 py-2.5 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
            <span>Junction</span>
            <span>Peak congestion</span>
            <span>Primary alert layer</span>
          </div>
          {HOTSPOTS.map((h) => (
            <div
              key={h.jn}
              className="grid grid-cols-3 gap-2 border-b px-4 py-3 text-xs last:border-0 sm:text-sm"
            >
              <span className="font-semibold">{h.jn}</span>
              <span className="text-muted-foreground">{h.peak}</span>
              <span className="font-medium text-red-700">{h.layer}</span>
            </div>
          ))}
        </Card>
      </Section>

      {/* Impact chart */}
      <Section
        title="Measured impact"
        subtitle="Sample route timings from corridor pilots — the advantage compounds with congestion."
      >
        <div className="grid gap-4 lg:grid-cols-2">
          <CorridorLineChart />
          <div className="grid grid-cols-2 gap-3">
            {[
              { k: "25 min", v: "median time saved per cross-city mission" },
              { k: "1,800+", v: "vehicles alerted in pilot week" },
              { k: "₹500", v: "per roadside BLE beacon" },
              { k: "100%", v: "of corridor events logged & auditable" },
            ].map((s) => (
              <Card key={s.k} className="p-4">
                <p className="text-xl font-extrabold text-red-700">{s.k}</p>
                <p className="mt-1 text-xs leading-snug text-muted-foreground">{s.v}</p>
              </Card>
            ))}
          </div>
        </div>
      </Section>

      {/* Emergency cards */}
      <Section title="Emergency? Numbers first." className="bg-muted/40">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <HelplineCard name="Ambulance (GVK EMRI)" number="108" desc="Free emergency response" accent="red" />
          <HelplineCard name="Police & Fire" number="112" desc="Any emergency, 24×7" accent="orange" />
          <HelplineCard name="UAR Corridor Desk" number="112" desc="Junction-blocker reports" accent="emerald" />
        </div>
      </Section>
    </>
  );
}

/* Bespoke 2-series line chart (shared ChartBox is single-series) */
function CorridorLineChart() {
  const data = [
    { congestion: "Light", without: 22, with: 17 },
    { congestion: "Moderate", without: 34, with: 25 },
    { congestion: "Heavy", without: 48, with: 33 },
    { congestion: "Gridlock", without: 65, with: 42 },
  ];

  return (
    <Card className="p-5">
      <h3 className="font-semibold leading-snug">Journey minutes: with vs without corridor</h3>
      <p className="mt-1 text-xs text-muted-foreground">
        The corridor&rsquo;s edge grows as traffic worsens — gridlock runs save ~23 minutes.
      </p>
      <div className="mt-4 h-56 sm:h-72">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: -8 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e4e4e7" />
            <XAxis
              dataKey="congestion"
              tick={{ fontSize: 11, fill: "#71717a" }}
              interval={0}
              tickLine={false}
              axisLine={{ stroke: "#e4e4e7" }}
            />
            <YAxis
              tick={{ fontSize: 11, fill: "#71717a" }}
              width={40}
              tickLine={false}
              axisLine={false}
            />
            <Tooltip
              contentStyle={{ fontSize: 12, borderRadius: 8 }}
              formatter={(value) => `${String(value)} min`}
            />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <Line
              type="monotone"
              dataKey="without"
              name="Without corridor"
              stroke="#ef4444"
              strokeWidth={2.5}
              dot={{ r: 3 }}
            />
            <Line
              type="monotone"
              dataKey="with"
              name="With corridor"
              stroke="#10b981"
              strokeWidth={2.5}
              dot={{ r: 3 }}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </Card>
  );
}
