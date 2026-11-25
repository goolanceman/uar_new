"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import {
  AlertCircle,
  Baby,
  Check,
  Flower2,
  Heart,
  HeartHandshake,
  Package,
  PawPrint,
  Pill,
  ShieldAlert,
  Siren,
  Smartphone,
  type LucideIcon,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  LineChart,
  Line,
  AreaChart,
  Area,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from "recharts";

/* ============================================================
 * Accent system — 9 campaign accents mapped to REAL classes
 * ============================================================ */

export interface AccentClasses {
  bg50: string;
  bg100: string;
  bg500: string;
  bg600: string;
  text600: string;
  text700: string;
  border200: string;
  ring: string;
}

const ACCENT_MAP: Record<string, AccentClasses> = {
  orange: {
    bg50: "bg-orange-50",
    bg100: "bg-orange-100",
    bg500: "bg-orange-500",
    bg600: "bg-orange-600",
    text600: "text-orange-600",
    text700: "text-orange-700",
    border200: "border-orange-200",
    ring: "ring-orange-500/30",
  },
  cyan: {
    bg50: "bg-cyan-50",
    bg100: "bg-cyan-100",
    bg500: "bg-cyan-500",
    bg600: "bg-cyan-600",
    text600: "text-cyan-600",
    text700: "text-cyan-700",
    border200: "border-cyan-200",
    ring: "ring-cyan-500/30",
  },
  fuchsia: {
    bg50: "bg-fuchsia-50",
    bg100: "bg-fuchsia-100",
    bg500: "bg-fuchsia-500",
    bg600: "bg-fuchsia-600",
    text600: "text-fuchsia-600",
    text700: "text-fuchsia-700",
    border200: "border-fuchsia-200",
    ring: "ring-fuchsia-500/30",
  },
  amber: {
    bg50: "bg-amber-50",
    bg100: "bg-amber-100",
    bg500: "bg-amber-500",
    bg600: "bg-amber-600",
    text600: "text-amber-600",
    text700: "text-amber-700",
    border200: "border-amber-200",
    ring: "ring-amber-500/30",
  },
  teal: {
    bg50: "bg-teal-50",
    bg100: "bg-teal-100",
    bg500: "bg-teal-500",
    bg600: "bg-teal-600",
    text600: "text-teal-600",
    text700: "text-teal-700",
    border200: "border-teal-200",
    ring: "ring-teal-500/30",
  },
  lime: {
    bg50: "bg-lime-50",
    bg100: "bg-lime-100",
    bg500: "bg-lime-500",
    bg600: "bg-lime-600",
    text600: "text-lime-600",
    text700: "text-lime-700",
    border200: "border-lime-200",
    ring: "ring-lime-500/30",
  },
  red: {
    bg50: "bg-red-50",
    bg100: "bg-red-100",
    bg500: "bg-red-500",
    bg600: "bg-red-600",
    text600: "text-red-600",
    text700: "text-red-700",
    border200: "border-red-200",
    ring: "ring-red-500/30",
  },
  emerald: {
    bg50: "bg-emerald-50",
    bg100: "bg-emerald-100",
    bg500: "bg-emerald-500",
    bg600: "bg-emerald-600",
    text600: "text-emerald-600",
    text700: "text-emerald-700",
    border200: "border-emerald-200",
    ring: "ring-emerald-500/30",
  },
  pink: {
    bg50: "bg-pink-50",
    bg100: "bg-pink-100",
    bg500: "bg-pink-500",
    bg600: "bg-pink-600",
    text600: "text-pink-600",
    text700: "text-pink-700",
    border200: "border-pink-200",
    ring: "ring-pink-500/30",
  },
};

export function accentClasses(accent?: string | null): AccentClasses {
  return ACCENT_MAP[accent ?? ""] ?? ACCENT_MAP.emerald;
}

/* ============================================================
 * Campaign icon (schema stores lucide icon names as strings)
 * ============================================================ */

const ICON_MAP: Record<string, LucideIcon> = {
  "shield-alert": ShieldAlert,
  smartphone: Smartphone,
  "heart-handshake": HeartHandshake,
  baby: Baby,
  pill: Pill,
  "paw-print": PawPrint,
  siren: Siren,
  package: Package,
  "flower-2": Flower2,
  heart: Heart,
};

export function CampaignIcon({
  icon,
  className,
}: {
  icon?: string | null;
  className?: string;
}) {
  const Icon = (icon && ICON_MAP[icon]) || Heart;
  return <Icon className={className} />;
}

/* ============================================================
 * Section — standard content band
 * ============================================================ */

export function Section({
  id,
  title,
  subtitle,
  children,
  className,
}: {
  id?: string;
  title?: string;
  subtitle?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section id={id} className={cn("py-12 sm:py-16", className)}>
      <div className="mx-auto w-full max-w-screen-2xl px-4 sm:px-6">
        {(title || subtitle) && (
          <div className="mb-8 max-w-2xl">
            {title && (
              <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">
                {title}
              </h2>
            )}
            {subtitle && (
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground sm:text-base">
                {subtitle}
              </p>
            )}
          </div>
        )}
        {children}
      </div>
    </section>
  );
}

/* ============================================================
 * Stat — compact KPI card
 * ============================================================ */

export function Stat({
  icon: Icon,
  value,
  label,
  accent,
  className,
}: {
  icon: LucideIcon;
  value: React.ReactNode;
  label: string;
  accent?: string | null;
  className?: string;
}) {
  const a = accentClasses(accent);
  return (
    <Card className={cn("p-4 sm:p-5", className)}>
      <div className="flex items-center gap-3">
        <div
          className={cn(
            "flex size-10 shrink-0 items-center justify-center rounded-xl",
            a.bg100,
            a.text700
          )}
        >
          <Icon className="size-5" aria-hidden />
        </div>
        <div className="min-w-0">
          <div className="truncate text-xl font-bold leading-tight sm:text-2xl">
            {value}
          </div>
          <div className="truncate text-xs text-muted-foreground">{label}</div>
        </div>
      </div>
    </Card>
  );
}

/* ============================================================
 * HelplineCard — tappable tel: card
 * ============================================================ */

export function HelplineCard({
  name,
  number,
  desc,
  accent,
  className,
}: {
  name: string;
  number: string;
  desc?: string;
  accent?: string | null;
  className?: string;
}) {
  const a = accentClasses(accent);
  return (
    <a
      href={`tel:${number}`}
      className={cn(
        "group block min-h-[44px] rounded-xl border bg-card p-4 transition-all hover:-translate-y-0.5 hover:shadow-md",
        a.border200,
        className
      )}
      aria-label={`Call ${name} on ${number}`}
    >
      <div className="flex items-center gap-3">
        <div
          className={cn(
            "flex size-9 shrink-0 items-center justify-center rounded-lg",
            a.bg100,
            a.text700
          )}
        >
          <Phone className="size-4" aria-hidden />
        </div>
        <div className="min-w-0">
          <div className={cn("text-lg font-bold leading-none", a.text700)}>
            {number}
          </div>
          <div className="mt-1 truncate text-xs font-medium">{name}</div>
          {desc && (
            <div className="mt-0.5 truncate text-[11px] text-muted-foreground">
              {desc}
            </div>
          )}
        </div>
      </div>
    </a>
  );
}

function Phone({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
    </svg>
  );
}

/* ============================================================
 * StepFlow — numbered vertical playbook
 * ============================================================ */

export function StepFlow({
  steps,
  accent,
  className,
}: {
  steps: { title: string; desc: string }[];
  accent?: string | null;
  className?: string;
}) {
  const a = accentClasses(accent);
  return (
    <ol className={cn("relative space-y-6", className)}>
      <span
        aria-hidden
        className="absolute bottom-3 left-[13px] top-3 w-0.5 rounded bg-border"
      />
      {steps.map((s, i) => (
        <li key={i} className="relative flex gap-4">
          <span
            className={cn(
              "z-10 mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white shadow-sm",
              a.bg500
            )}
          >
            {i + 1}
          </span>
          <div className="min-w-0">
            <h4 className="font-semibold leading-snug">{s.title}</h4>
            <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
              {s.desc}
            </p>
          </div>
        </li>
      ))}
    </ol>
  );
}

/* ============================================================
 * EmptyState — friendly zero-data block
 * ============================================================ */

export function EmptyState({
  icon: Icon = AlertCircle,
  title,
  hint,
  action,
  className,
}: {
  icon?: LucideIcon;
  title: string;
  hint?: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center rounded-xl border border-dashed bg-muted/30 px-6 py-12 text-center",
        className
      )}
    >
      <div className="flex size-12 items-center justify-center rounded-full bg-muted">
        <Icon className="size-6 text-muted-foreground" aria-hidden />
      </div>
      <p className="mt-3 font-medium">{title}</p>
      {hint && (
        <p className="mt-1 max-w-sm text-sm text-muted-foreground">{hint}</p>
      )}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

/* ============================================================
 * ChartBox — recharts wrapper (bar | pie | line | area)
 * ============================================================ */

export const CHART_COLORS = [
  "#10b981",
  "#f97316",
  "#06b6d4",
  "#d946ef",
  "#f59e0b",
  "#14b8a6",
  "#84cc16",
  "#ef4444",
  "#ec4899",
  "#78716c",
];

export interface ChartSpec {
  title: string;
  desc?: string;
  type: "bar" | "pie" | "line" | "area";
  data: Record<string, unknown>[];
  xKey?: string;
  nameKey: string;
  valueKey: string;
  colors?: string[];
}

function ChartTip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: { name?: string | number; value?: number | string; color?: string }[];
  label?: string | number;
}) {
  if (!active || !payload || payload.length === 0) return null;
  return (
    <div className="rounded-lg border bg-popover px-3 py-2 text-xs shadow-md">
      {label != null && label !== "" && (
        <p className="font-semibold text-popover-foreground">{label}</p>
      )}
      {payload.map((p, i) => (
        <p
          key={i}
          className="font-medium"
          style={{ color: p.color ?? "currentColor" }}
        >
          {p.name}:{" "}
          {typeof p.value === "number"
            ? p.value.toLocaleString("en-IN")
            : String(p.value ?? "")}
        </p>
      ))}
    </div>
  );
}

const AXIS_TICK = { fontSize: 11, fill: "#71717a" };

export function ChartBox(spec: ChartSpec & { className?: string }) {
  const { title, desc, type, data, xKey, nameKey, valueKey, colors, className } =
    spec;
  const palette = colors && colors.length > 0 ? colors : CHART_COLORS;
  const x = xKey ?? nameKey;
  const gradId = `grad-${valueKey.replace(/[^a-zA-Z0-9]/g, "")}-${type}`;

  return (
    <Card className={cn("p-5", className)}>
      <h3 className="font-semibold leading-snug">{title}</h3>
      {desc && <p className="mt-1 text-xs text-muted-foreground">{desc}</p>}
      <div className="mt-4 h-56 sm:h-72">
        <ResponsiveContainer width="100%" height="100%">
          {type === "pie" ? (
            <PieChart>
              <Pie
                data={data}
                dataKey={valueKey}
                nameKey={nameKey}
                innerRadius="45%"
                outerRadius="72%"
                paddingAngle={2}
              >
                {data.map((_, i) => (
                  <Cell key={i} fill={palette[i % palette.length]} />
                ))}
              </Pie>
              <Tooltip content={<ChartTip />} />
              <Legend wrapperStyle={{ fontSize: 12 }} iconSize={9} />
            </PieChart>
          ) : type === "line" ? (
            <LineChart
              data={data}
              margin={{ top: 8, right: 12, bottom: 0, left: -8 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="#e4e4e7" />
              <XAxis
                dataKey={x}
                tick={AXIS_TICK}
                interval={0}
                tickLine={false}
                axisLine={{ stroke: "#e4e4e7" }}
              />
              <YAxis
                tick={AXIS_TICK}
                width={44}
                tickLine={false}
                axisLine={false}
              />
              <Tooltip content={<ChartTip />} />
              <Line
                type="monotone"
                dataKey={valueKey}
                name={title}
                stroke={palette[0]}
                strokeWidth={2.5}
                dot={{ r: 3, fill: palette[0] }}
                activeDot={{ r: 5 }}
              />
            </LineChart>
          ) : type === "area" ? (
            <AreaChart
              data={data}
              margin={{ top: 8, right: 12, bottom: 0, left: -8 }}
            >
              <defs>
                <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={palette[0]} stopOpacity={0.35} />
                  <stop offset="100%" stopColor={palette[0]} stopOpacity={0.03} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#e4e4e7" />
              <XAxis
                dataKey={x}
                tick={AXIS_TICK}
                interval={0}
                tickLine={false}
                axisLine={{ stroke: "#e4e4e7" }}
              />
              <YAxis
                tick={AXIS_TICK}
                width={44}
                tickLine={false}
                axisLine={false}
              />
              <Tooltip content={<ChartTip />} />
              <Area
                type="monotone"
                dataKey={valueKey}
                name={title}
                stroke={palette[0]}
                strokeWidth={2.5}
                fill={`url(#${gradId})`}
              />
            </AreaChart>
          ) : (
            <BarChart
              data={data}
              margin={{ top: 8, right: 12, bottom: 0, left: -8 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="#e4e4e7" vertical={false} />
              <XAxis
                dataKey={x}
                tick={AXIS_TICK}
                interval={0}
                tickLine={false}
                axisLine={{ stroke: "#e4e4e7" }}
              />
              <YAxis
                tick={AXIS_TICK}
                width={44}
                tickLine={false}
                axisLine={false}
              />
              <Tooltip cursor={{ fill: "rgba(0,0,0,0.04)" }} content={<ChartTip />} />
              <Bar dataKey={valueKey} name={title} radius={[6, 6, 0, 0]} maxBarSize={44}>
                {data.map((_, i) => (
                  <Cell key={i} fill={palette[i % palette.length]} />
                ))}
              </Bar>
            </BarChart>
          )}
        </ResponsiveContainer>
      </div>
    </Card>
  );
}

/* ============================================================
 * Small shared helpers
 * ============================================================ */

/** Fire the global "open Angel assistant" event. */
export function askAngel() {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("open-assistant"));
  }
}

/** Defensively normalise unknown /api/stats payloads into flat numbers. */
export interface PublicStats {
  raised: number;
  donations: number;
  beneficiaries: number;
  volunteers: number;
  campaigns: number;
}

export function pickStats(raw: unknown): PublicStats {
  const s = (Array.isArray(raw) ? raw[0] : raw) as
    | Record<string, unknown>
    | undefined;
  const totals = (s?.totals ?? s ?? {}) as Record<string, unknown>;
  const num = (src: Record<string, unknown>, ...keys: string[]): number => {
    for (const k of keys) {
      const v = src[k];
      if (typeof v === "number" && Number.isFinite(v)) return v;
      if (typeof v === "string" && v !== "" && Number.isFinite(Number(v)))
        return Number(v);
    }
    return 0;
  };
  return {
    raised: num(s as Record<string, unknown>, "totalRaised", "raisedAmount", "raised", "totalDonationAmount") || num(totals, "raised", "totalRaised", "totalDonationAmount"),
    donations: num(s as Record<string, unknown>, "totalDonations", "donationCount", "donations") || num(totals, "donations", "totalDonations"),
    beneficiaries: num(s as Record<string, unknown>, "totalBeneficiaries", "beneficiaries") || num(totals, "beneficiaries", "totalBeneficiaries"),
    volunteers: num(s as Record<string, unknown>, "totalVolunteers", "activeVolunteers", "volunteers") || num(totals, "volunteers", "activeVolunteers"),
    campaigns: num(s as Record<string, unknown>, "totalCampaigns", "activeCampaigns", "campaigns") || num(totals, "campaigns", "activeCampaigns"),
  };
}

/** Checked list item used across checklist UIs. */
export function CheckItem({ done, children }: { done: boolean; children: React.ReactNode }) {
  return (
    <span className="flex items-start gap-2 text-sm">
      <span
        className={cn(
          "mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full",
          done ? "bg-emerald-500 text-white" : "border border-input bg-background"
        )}
      >
        {done && <Check className="size-3" aria-hidden />}
      </span>
      <span className={cn("leading-relaxed", done && "text-muted-foreground")}>
        {children}
      </span>
    </span>
  );
}
