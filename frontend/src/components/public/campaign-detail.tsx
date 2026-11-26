"use client";

import * as React from "react";
import { useCallback, useEffect, useState } from "react";
import { Link, navigate } from "@/lib/router";
import { useAuth } from "@/hooks/use-auth";
import { get, post } from "@/lib/api-client";
import { parseGallery } from "@/lib/campaign-image";
import { cn, formatNumber, timeAgo, titleCase } from "@/lib/utils";
import { formatINR, formatINRCompact } from "@/lib/format";
import { toast } from "sonner";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { FormSheet } from "@/components/shared/form-sheet";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Section,
  StepFlow,
  ChartBox,
  EmptyState,
  CheckItem,
  CampaignIcon,
} from "@/components/public/shared";
import { LiveCorridorDemo } from "@/components/public/green-corridor";
import {
  CAMPAIGN_CONTENT,
  DONOR_FAQS,
  IMPACT_BULLETS,
  accentSoft,
} from "@/components/public/campaign-data";
import {
  ArrowLeft,
  ArrowRight,
  Ban,
  BookOpenCheck,
  CalendarDays,
  ChartNoAxesCombined,
  Check,
  CheckCircle2,
  ChevronDown,
  CircleHelp,
  Clock,
  Dog,
  ExternalLink,
  Heart,
  HeartPulse,
  Landmark,
  Link2,
  ListChecks,
  MapPin,
  MessageCircleHeart,
  Phone,
  Pill,
  Radio,
  ScanLine,
  ShieldCheck,
  Share2,
  Siren,
  Sparkles,
  Syringe,
  Target,
  Users,
  Wrench,
  X,
  ZoomIn,
} from "lucide-react";
import Lightbox from "yet-another-react-lightbox";
import Zoom from "yet-another-react-lightbox/plugins/zoom";
import Thumbnails from "yet-another-react-lightbox/plugins/thumbnails";
import Counter from "yet-another-react-lightbox/plugins/counter";
import "yet-another-react-lightbox/styles.css";
import "yet-another-react-lightbox/plugins/thumbnails.css";
import "yet-another-react-lightbox/plugins/counter.css";

/* ------------------------------------------------------------------ */
/* Live data types                                                     */
/* ------------------------------------------------------------------ */

interface LiveCampaign {
  id: string;
  title: string;
  slug?: string | null;
  tagline?: string | null;
  description?: string | null;
  targetAmount: number;
  raisedAmount: number;
  beneficiaries: number;
  volunteersEngaged: number;
  helpline?: string | null;
  icon?: string | null;
  accent?: string | null;
  status?: string | null;
  gallery?: string | null;
  images?: string | null;
  coverImage?: string | null;
  supporterCount?: number;
  minDonation?: number | null;
  taxEligible?: boolean | null;
  urgent?: boolean | null;
  urgencyLevel?: string | null;
  urgencyReason?: string | null;
  urgentUntil?: string | null;
}

/** Parses the JSON-array `gallery` column; returns [] on anything else. */
/** Whole days until an ISO deadline (ceil); null when unknown. */
function daysUntilIso(date?: string | null): number | null {
  if (!date) return null;
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return null;
  return Math.ceil((d.getTime() - Date.now()) / 86_400_000);
}

interface Cause {
  id: string;
  code: string;
  patientName: string;
  age: number;
  city: string;
  condition: string;
  monthlyCost: number;
  durationMonths: number;
  story: string;
  status: string;
  raised: number;
}

interface Animal {
  id: string;
  name: string;
  species: string;
  breed?: string | null;
  ageMonths: number;
  gender: string;
  story: string;
  healthStatus?: string | null;
  vaccinated: boolean;
  sterilized: boolean;
  location: string;
  status: string;
  monthlyFood: number;
}

interface PublicDonation {
  id: string;
  donorName: string;
  amount: number;
  isAnonymous?: boolean;
  type?: string;
  createdAt?: string;
  campaign?: { title?: string } | null;
}

/* ------------------------------------------------------------------ */
/* Status badge colours (dark-safe)                                    */
/* ------------------------------------------------------------------ */

const CAUSE_STATUS: Record<string, string> = {
  SEEKING: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
  PARTIAL: "bg-orange-500/15 text-orange-600 dark:text-orange-400",
  ADOPTED: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
  PAUSED: "bg-muted text-muted-foreground",
};

const ANIMAL_STATUS: Record<string, string> = {
  AVAILABLE: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
  FOSTERED: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
  ADOPTED: "bg-muted text-muted-foreground",
  CRITICAL: "bg-red-500/15 text-red-600 dark:text-red-400",
};

const SPECIES_BADGE: Record<string, string> = {
  DOG: "bg-lime-500/15 text-lime-600 dark:text-lime-400",
  CAT: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
  COW: "bg-orange-500/15 text-orange-600 dark:text-orange-400",
  BIRD: "bg-cyan-500/15 text-cyan-600 dark:text-cyan-400",
  OTHER: "bg-muted text-muted-foreground",
};

/* ================================================================== */
/* Collapsible block — secondary/reference content stays tucked away   */
/* so the page leads with what matters: story, live numbers, donate.   */
/* ================================================================== */

function CollapsibleBlock({
  title,
  subtitle,
  icon: Icon,
  defaultOpen = false,
  className,
  children,
}: {
  title: string;
  subtitle?: string;
  icon?: React.ElementType;
  defaultOpen?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      className={cn(
        "group rounded-2xl border bg-card p-4 shadow-sm transition-colors sm:p-5",
        "hover:border-foreground/20",
        "data-[state=open]:border-emerald-500/30 data-[state=open]:bg-emerald-500/[0.05]",
        className
      )}
    >
      <CollapsibleTrigger asChild>
        <button
          type="button"
          className="flex w-full items-center justify-between gap-3 text-left"
          aria-expanded={open}
        >
          <div className="flex min-w-0 items-center gap-3">
            {Icon && (
              <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-background text-muted-foreground ring-1 ring-border transition-colors group-data-[state=open]:text-emerald-600 group-data-[state=open]:ring-emerald-600/30 dark:group-data-[state=open]:text-emerald-400">
                <Icon className="size-4" aria-hidden />
              </span>
            )}
            <div className="min-w-0">
              <h3 className="text-lg font-bold tracking-tight">
                {title}
              </h3>
              {subtitle && (
                <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground sm:text-sm">
                  {subtitle}
                </p>
              )}
            </div>
          </div>
          <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-background ring-1 ring-border transition-colors group-data-[state=open]:bg-emerald-600 group-data-[state=open]:ring-emerald-600">
            <ChevronDown
              className={cn(
                "size-3.5 text-muted-foreground transition-transform duration-200 group-data-[state=open]:text-white",
                open && "rotate-180"
              )}
              aria-hidden
            />
          </span>
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent className="overflow-hidden data-[state=closed]:animate-none">
        <div className="pt-4">{children}</div>
      </CollapsibleContent>
    </Collapsible>
  );
}

/* ================================================================== */
/* Gallery — big cover photo + scrollable thumbnail strip + zoom lightbox */
/* ================================================================== */

function CampaignGallery({
  photos,
  title,
  icon,
  accentChip,
}: {
  photos: string[];
  title: string;
  icon: string;
  accentChip: string;
}) {
  const [index, setIndex] = useState(0);
  const [open, setOpen] = useState(false);

  if (photos.length === 0) {
    return (
      <div
        className={cn(
          "flex aspect-[4/3] w-full items-center justify-center rounded-2xl sm:aspect-video",
          accentChip
        )}
      >
        <CampaignIcon icon={icon} className="size-16 opacity-50" />
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={() => {
          setIndex(0);
          setOpen(true);
        }}
        className="group relative block aspect-[4/3] w-full overflow-hidden rounded-2xl border sm:aspect-video"
      >
        <img
          src={photos[0]}
          alt={title}
          className="size-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
        />
        <span className="absolute bottom-3 right-3 inline-flex items-center gap-1.5 rounded-full bg-black/60 px-3 py-1.5 text-xs font-semibold text-white backdrop-blur transition group-hover:bg-black/75">
          <ZoomIn className="size-3.5" aria-hidden /> View {photos.length > 1 ? `all ${photos.length} photos` : "full size"}
        </span>
      </button>

      {photos.length > 1 && (
        <div
          className="flex gap-2 overflow-x-auto pb-1 [scrollbar-width:thin] [&::-webkit-scrollbar]:h-1.5"
          role="group"
          aria-label="Gallery thumbnails"
        >
          {photos.map((src, i) => (
            <button
              key={src + i}
              type="button"
              onClick={() => {
                setIndex(i);
                setOpen(true);
              }}
              className={cn(
                "size-16 shrink-0 overflow-hidden rounded-lg border-2 transition sm:size-20",
                i === 0 ? "border-foreground/20" : "border-transparent hover:border-foreground/20"
              )}
            >
              <img src={src} alt={`${title} photo ${i + 1}`} className="size-full object-cover" loading="lazy" />
            </button>
          ))}
        </div>
      )}

      <Lightbox
        open={open}
        close={() => setOpen(false)}
        index={index}
        slides={photos.map((src) => ({ src }))}
        plugins={[Zoom, Thumbnails, Counter]}
        zoom={{ maxZoomPixelRatio: 3, scrollToZoom: true }}
        thumbnails={{ position: "bottom", border: 0 }}
        counter={{ container: { style: { top: 0, bottom: "auto" } } }}
        styles={{ container: { backgroundColor: "rgba(0,0,0,.92)" } }}
      />
    </div>
  );
}

/* ================================================================== */
/* Public camps tab — live + upcoming + recently completed camps       */
/* ================================================================== */

interface PublicCamp {
  id: string;
  code: string;
  title: string;
  description?: string | null;
  campDate: string;
  startTime?: string | null;
  endTime?: string | null;
  venue: string;
  city?: string | null;
  capacity: number;
  services?: string | null;
  status: string;
  counts?: { registrations: number; checkedIn: number; completed: number };
}

function campServices(v?: string | null): string[] {
  if (!v) return [];
  try {
    const arr = JSON.parse(v);
    return Array.isArray(arr) ? arr.map(String).filter(Boolean) : [];
  } catch {
    return [];
  }
}

function CampStatusPill({ status }: { status: string }) {
  if (status === "LIVE")
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/15 px-2.5 py-1 text-xs font-bold text-emerald-700 ring-1 ring-emerald-500/30 dark:text-emerald-400">
        <span className="relative flex size-2">
          <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-500 opacity-75" />
          <span className="relative inline-flex size-2 rounded-full bg-emerald-600" />
        </span>
        Happening now
      </span>
    );
  if (status === "SCHEDULED")
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-teal-500/15 px-2.5 py-1 text-xs font-bold text-teal-700 ring-1 ring-teal-500/30 dark:text-teal-400">
        <CalendarDays className="size-3" aria-hidden /> Upcoming
      </span>
    );
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-muted px-2.5 py-1 text-xs font-bold text-muted-foreground ring-1 ring-border">
      <CheckCircle2 className="size-3" aria-hidden /> Completed
    </span>
  );
}

function PublicCampCard({ camp, isLive }: { camp: PublicCamp; isLive: boolean }) {
  const { user } = useAuth();
  const d = new Date(camp.campDate);
  const day = d.getDate();
  const month = d.toLocaleString("en-IN", { month: "short" });
  const weekday = d.toLocaleString("en-IN", { weekday: "long" });
  const services = campServices(camp.services);
  const registered = camp.counts?.registrations ?? 0;
  const pct = camp.capacity > 0 ? Math.min(100, Math.round((registered / camp.capacity) * 100)) : 0;

  const registerTarget = !user
    ? "/login"
    : user.role === "BENEFICIARY"
      ? "/beneficiary/health"
      : "/admin/health";
  const registerLabel = !user
    ? "Sign in to register"
    : user.role === "BENEFICIARY"
      ? "Register yourself"
      : "Open camp desk";

  return (
    <Card
      className={cn(
        "overflow-hidden p-0 transition hover:shadow-md",
        isLive && "ring-2 ring-emerald-500/40"
      )}
    >
      {/* Visual header — camp photo strip */}
      <div className="relative h-28 w-full overflow-hidden bg-muted">
        <img
          src="https://images.unsplash.com/photo-1532619675605-1ede6c2ed2b0?w=1200&q=80&auto=format&fit=crop"
          alt=""
          loading="lazy"
          className="size-full object-cover"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-black/20 to-transparent" />
        <div className="absolute inset-x-3 bottom-2 flex items-end justify-between gap-2">
          <span className="rounded-lg bg-white/90 px-2 py-1 text-center shadow-sm dark:bg-black/70">
            <span className="block text-lg font-extrabold leading-none text-foreground">{day}</span>
            <span className="block text-[10px] font-bold uppercase tracking-wide text-muted-foreground">{month}</span>
          </span>
          <CampStatusPill status={camp.status} />
        </div>
      </div>

      <div className="space-y-3 p-4">
        <div>
          <h4 className="truncate text-sm font-bold sm:text-base">{camp.title}</h4>
          <p className="text-xs text-muted-foreground">{weekday} · {camp.venue}</p>
        </div>

        <div className="space-y-1.5 text-xs text-muted-foreground">
          <p className="flex items-center gap-1.5">
            <Clock className="size-3.5 shrink-0" aria-hidden /> {camp.startTime ?? "09:00"} – {camp.endTime ?? "17:00"}
          </p>
          <p className="flex items-center gap-1.5">
            <MapPin className="size-3.5 shrink-0" aria-hidden /> {camp.city ?? "Bengaluru"}
          </p>
          <p className="flex items-center gap-1.5">
            <Users className="size-3.5 shrink-0" aria-hidden /> {formatNumber(registered)} of {formatNumber(camp.capacity)} slots registered
          </p>
        </div>
        <Progress value={pct} className="h-1.5" aria-label={`${pct}% registered`} />

        {services.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {services.slice(0, 4).map((s) => (
              <span key={s} className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold text-muted-foreground">{s}</span>
            ))}
            {services.length > 4 && (
              <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold text-muted-foreground">+{services.length - 4} more</span>
            )}
          </div>
        )}

        {camp.status !== "COMPLETED" ? (
          <Button
            size="sm"
            className={cn("h-10 w-full", isLive && "bg-emerald-600 hover:bg-emerald-700")}
            onClick={() => navigate(registerTarget)}
          >
            {registerLabel}
          </Button>
        ) : (
          <div className="rounded-lg bg-muted/60 p-2 text-center text-xs text-muted-foreground">
            {formatNumber(camp.counts?.completed ?? 0)} {((camp.counts?.completed ?? 0) === 1) ? "beneficiary" : "beneficiaries"} served
          </div>
        )}
      </div>
    </Card>
  );
}

function PublicCampsTab({ campaignId }: { campaignId: string }) {
  const [camps, setCamps] = useState<PublicCamp[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<"ALL" | "LIVE" | "UPCOMING" | "COMPLETED">("ALL");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const d = await get<{ items: PublicCamp[] }>(`/api/medical-camps?campaignId=${campaignId}&withCounts=1&limit=50`);
      setCamps(Array.isArray(d) ? d : d.items ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load camps");
    } finally {
      setLoading(false);
    }
  }, [campaignId]);

  useEffect(() => {
    void load();
  }, [load]);

  const live = camps.filter((c) => c.status === "LIVE");
  const upcoming = camps
    .filter((c) => c.status === "SCHEDULED")
    .sort((a, b) => new Date(a.campDate).getTime() - new Date(b.campDate).getTime());
  const completed = camps
    .filter((c) => c.status === "COMPLETED")
    .sort((a, b) => new Date(b.campDate).getTime() - new Date(a.campDate).getTime());
  const filtered =
    filter === "LIVE" ? live : filter === "UPCOMING" ? upcoming : filter === "COMPLETED" ? completed : camps;

  if (loading) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-72 rounded-2xl" />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <EmptyState
        icon={Radio}
        title="Couldn't load camps"
        hint={error + " — check your connection and try again."}
        action={
          <Button size="sm" variant="outline" onClick={() => void load()}>
            Retry
          </Button>
        }
      />
    );
  }

  if (camps.length === 0) {
    return (
      <EmptyState
        icon={HeartPulse}
        title="No camps scheduled right now"
        hint="New free health camps are announced here first — check back soon, or follow UAR for the next announcement."
      />
    );
  }

  const chip = (active: boolean) =>
    cn(
      "min-h-[36px] rounded-full px-3 py-1.5 text-xs font-semibold ring-1 transition",
      active ? "bg-emerald-600 text-white ring-emerald-600" : "bg-background text-muted-foreground ring-border hover:bg-accent"
    );

  return (
    <div className="space-y-6">
      {/* Filters — find the right camp fast */}
      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Filter camps by status">
        <span className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Find a camp:</span>
        {(["ALL", "LIVE", "UPCOMING", "COMPLETED"] as const).map((f) => (
          <button key={f} type="button" className={chip(filter === f)} aria-pressed={filter === f} onClick={() => setFilter(f)}>
            {f === "ALL" ? "All" : f === "LIVE" ? `Live (${live.length})` : f === "UPCOMING" ? `Upcoming (${upcoming.length})` : `Completed (${completed.length})`}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <EmptyState icon={CalendarDays} title="Nothing here yet" hint="Try another filter — new camps are announced regularly." />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {filtered.map((c) => (
            <PublicCampCard key={c.id} camp={c} isLive={c.status === "LIVE"} />
          ))}
        </div>
      )}

      {completed.length > 0 && filter === "ALL" && (
        <div className="rounded-2xl border bg-muted/30 p-4">
          <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-muted-foreground">
            <CheckCircle2 className="size-3.5" aria-hidden /> Recently served
          </p>
          <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
            {completed.slice(0, 3).map((c) => (
              <li key={c.id} className="flex flex-wrap items-center justify-between gap-2">
                <span className="min-w-0 truncate font-medium text-foreground">{c.title}</span>
                <span className="text-xs">{formatNumber(c.counts?.completed ?? 0)} beneficiaries · {timeAgo(c.campDate)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        Walk-ins welcome at every camp — bring a photo ID if you have one. Emergencies: call <a href="tel:108" className="font-bold text-emerald-700 dark:text-emerald-400">108</a> / <a href="tel:112" className="font-bold text-emerald-700 dark:text-emerald-400">112</a>.
      </p>
    </div>
  );
}

/* ================================================================== */
/* Main page                                                          */
/* ================================================================== */

export function CampaignDetailPage({ slug }: { slug: string }) {
  const content = CAMPAIGN_CONTENT[slug];
  const [live, setLive] = useState<LiveCampaign | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    get<LiveCampaign[]>("/api/campaigns")
      .then((d) => {
        if (!alive) return;
        const list = Array.isArray(d) ? d : [];
        setLive(list.find((c) => c.slug === slug) ?? null);
      })
      .catch(() => alive && setLive(null))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [slug]);

  if (!content) {
    return (
      <Section>
        <EmptyState
          icon={BookOpenCheck}
          title="Programme not found"
          hint={`We couldn't find “${slug}”. It may have been renamed — browse all programmes instead.`}
          action={
            <Button asChild>
              <Link href="/campaigns">Browse programmes</Link>
            </Button>
          }
        />
      </Section>
    );
  }

  const a = accentSoft(content.accent);
  const accent = content.accent;
  const pct =
    live && live.targetAmount > 0
      ? Math.min(100, Math.round((live.raisedAmount / live.targetAmount) * 100))
      : 0;

  const shareCampaign = async () => {
    const url = `${window.location.origin}${window.location.pathname}#/campaigns/${content.slug}`;
    const payload = {
      title: content.title,
      text: `${content.title} — United Angel Reach. ${content.heroTag}`,
      url,
    };
    try {
      if (typeof navigator.share === "function") {
        await navigator.share(payload);
        return;
      }
      throw new Error("no-share");
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      try {
        await navigator.clipboard.writeText(url);
        toast.success("Link copied — share it with anyone");
      } catch {
        toast.error("Couldn't share — copy the URL from the address bar");
      }
    }
  };

  // Urgency banner data — every value comes from the backend (auto-expired
  // appeals already read as urgent=false server-side).
  const urgentLeft = live?.urgent ? daysUntilIso(live.urgentUntil) : null;
  const urgencyLevel = live?.urgencyLevel ? titleCase(live.urgencyLevel) : "Urgent";

  return (
    <div className="pb-4">
      {/* ================= TITLE BAR ================= */}
      <section className={cn("text-white", a.solid)}>
        <div className="mx-auto w-full max-w-screen-2xl px-4 py-6 sm:px-6 sm:py-8">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex min-w-0 items-center gap-4">
              <span className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-white/15 backdrop-blur sm:size-14">
                <CampaignIcon icon={content.icon} className="size-6 sm:size-7" />
              </span>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2.5">
                  <h1 className="text-xl font-extrabold tracking-tight sm:text-3xl">
                    {content.title}
                  </h1>
                  {live?.urgent === true && (
                    <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-white px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-red-600 shadow-sm">
                      <span className="relative flex size-2" aria-hidden>
                        <span className="absolute inline-flex size-full animate-ping rounded-full bg-red-500 opacity-75" />
                        <span className="relative inline-flex size-2 rounded-full bg-red-600" />
                      </span>
                      Urgent appeal
                    </span>
                  )}
                </div>
                <p className="mt-1 text-sm font-medium text-white/85 sm:text-base">
                  {content.heroTag}
                </p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {content.helpline && (
                <a
                  href={`tel:${content.helpline}`}
                  className="inline-flex min-h-[40px] items-center gap-2 rounded-full bg-white/15 px-3.5 py-2 text-xs font-semibold ring-1 ring-white/25 transition hover:bg-white/25 sm:text-sm"
                >
                  <Phone className="size-4" aria-hidden />
                  24×7: {content.helpline}
                </a>
              )}
              <Button
                variant="ghost"
                className="h-10 text-white hover:bg-white/10"
                onClick={() => {
                  const ev = new CustomEvent("open-assistant");
                  window.dispatchEvent(ev);
                }}
              >
                <Sparkles className="size-4" aria-hidden /> Ask Angel
              </Button>
            </div>
          </div>
        </div>
      </section>

      {/* ================= URGENCY BANNER ================= */}
      {live?.urgent === true && (
        <Section className="pb-0 pt-4 sm:pt-5">
          <div
            className="flex flex-col gap-2 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 sm:flex-row sm:items-start sm:gap-3"
            role="status"
          >
            <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-red-500/15">
              <Siren className="size-5 text-red-600 dark:text-red-400" aria-hidden />
            </span>
            <div className="min-w-0 flex-1">
              <p className="flex flex-wrap items-center gap-2 text-sm font-bold text-red-600 dark:text-red-400">
                Urgent appeal
                <span className="rounded-full bg-red-500/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide">
                  {urgencyLevel}
                </span>
                {urgentLeft !== null && (
                  <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-muted-foreground">
                    <Clock className="size-3" aria-hidden />
                    {urgentLeft <= 0
                      ? "Final hours"
                      : `Closes in ${urgentLeft} ${urgentLeft === 1 ? "day" : "days"}`}
                  </span>
                )}
              </p>
              {live.urgencyReason ? (
                <p className="mt-1 text-sm text-foreground">{live.urgencyReason}</p>
              ) : null}
            </div>
            <Button
              size="sm"
              className="shrink-0 bg-red-600 text-white hover:bg-red-700"
              onClick={() => navigate(`/donate?campaign=${content.slug}`)}
            >
              <Heart className="size-4" aria-hidden /> Donate now
            </Button>
          </div>
        </Section>
      )}

      {/* ================= GALLERY + DONATE CARD ================= */}
      <Section className="py-4 sm:py-5">
        <div className="grid gap-5 lg:grid-cols-[1.6fr_1fr] lg:items-start">
          {/* Left: photo gallery */}
          <CampaignGallery
            photos={(() => {
              const gallery = parseGallery(live?.gallery);
              if (gallery.length > 0) return gallery;
              const single = live?.coverImage?.trim() || live?.images?.trim();
              return single ? [single] : [];
            })()}
            title={content.title}
            icon={content.icon}
            accentChip={a.chip}
          />

          {/* Right: sticky donate card */}
          <Card className="top-20 p-5 lg:sticky">
            {loading ? (
              <div className="space-y-3">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-2 w-full" />
                <Skeleton className="h-16 w-full" />
              </div>
            ) : live ? (
              <>
                <div className="flex items-baseline gap-2">
                  <span className="text-2xl font-extrabold">{formatINR(live.raisedAmount)}</span>
                </div>
                <p className="text-sm text-muted-foreground">
                  raised of {formatINR(live.targetAmount)} goal
                </p>
                <Progress value={pct} className="mt-3 h-2.5" aria-label={`${pct}% raised`} />
                <div className="mt-1.5 flex items-center justify-between text-xs text-muted-foreground">
                  <span className="font-semibold text-foreground">{pct}% funded</span>
                  {typeof live.supporterCount === "number" && (
                    <span className="inline-flex items-center gap-1">
                      <Users className="size-3.5" aria-hidden />
                      {formatNumber(live.supporterCount)} supporters
                    </span>
                  )}
                </div>

                <div className="mt-4 flex flex-col gap-2">
                  <Button
                    size="lg"
                    className={cn("h-12 w-full text-white", a.solid)}
                    onClick={() => navigate(`/donate?campaign=${content.slug}`)}
                  >
                    <Heart className="size-5" aria-hidden /> Donate now
                  </Button>
                  <div className="grid grid-cols-2 gap-2">
                    <Button variant="outline" onClick={shareCampaign}>
                      <Share2 className="size-4" aria-hidden /> Share
                    </Button>
                    <Button variant="outline" asChild>
                      <Link href="/volunteer">Volunteer</Link>
                    </Button>
                  </div>
                  {live.minDonation ? (
                    <p className="text-center text-[11px] text-muted-foreground">
                      Minimum online gift {formatINR(live.minDonation)}
                    </p>
                  ) : null}
                </div>

                <Separator className="my-4" />

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <p className="text-lg font-bold">{formatNumber(live.beneficiaries)}</p>
                    <p className="text-xs text-muted-foreground">Beneficiaries</p>
                  </div>
                  <div>
                    <p className="text-lg font-bold">{formatNumber(live.volunteersEngaged)}</p>
                    <p className="text-xs text-muted-foreground">Volunteers engaged</p>
                  </div>
                </div>

                {live.taxEligible !== false && (
                  <p className="mt-4 flex items-center gap-1.5 rounded-lg bg-emerald-500/10 px-3 py-2 text-xs font-medium text-emerald-700 dark:text-emerald-400">
                    <Landmark className="size-3.5 shrink-0" aria-hidden /> 80G tax-eligible — receipt emailed instantly
                  </p>
                )}
                <p className="mt-2 flex items-center gap-1.5 text-[11px] text-muted-foreground">
                  <ShieldCheck className="size-3.5 shrink-0" aria-hidden /> Verified programme · audited fund trail
                </p>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">
                Live numbers are syncing. The editorial content below is always current.
              </p>
            )}
          </Card>
        </div>
      </Section>

      {/* ================= LIVE BOARDS (always visible — no tab hunting) ================= */}
      {slug === "medicine-adoption" && (
        <Section className="py-4 sm:py-5">
          <MedicineAdoptionEmbed />
        </Section>
      )}
      {slug === "animal-welfare" && (
        <Section className="py-4 sm:py-5">
          <AnimalWelfareEmbed />
        </Section>
      )}
      {slug === "green-corridor" && (
        <Section className="py-4 sm:py-5">
          <div>
            <h2 className="text-lg font-bold tracking-tight">Live corridor demo</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Run a simulated Hebbal → Tin Factory mission. Watch the four-layer mesh clear the
              road in real time.
            </p>
            <div className="mt-4">
              <LiveCorridorDemo />
            </div>
          </div>
        </Section>
      )}

      {/* ================= TABS: Story / Impact / FAQ ================= */}
      <Section className="py-4 sm:py-5">
        <Tabs defaultValue="camps">
          <TabsList className="h-11 w-full justify-start overflow-x-auto overflow-y-hidden sm:h-10 sm:justify-center">
            <TabsTrigger
              value="camps"
              className="min-h-[40px] px-4 data-[state=active]:bg-emerald-600 data-[state=active]:text-white dark:data-[state=active]:text-white"
            >
              <Radio className="mr-1.5 size-3.5" aria-hidden /> Camps
            </TabsTrigger>
            <TabsTrigger
              value="story"
              className="min-h-[40px] px-4 data-[state=active]:bg-emerald-600 data-[state=active]:text-white dark:data-[state=active]:text-white"
            >
              Story
            </TabsTrigger>
            <TabsTrigger
              value="impact"
              className="min-h-[40px] px-4 data-[state=active]:bg-emerald-600 data-[state=active]:text-white dark:data-[state=active]:text-white"
            >
              Impact
            </TabsTrigger>
            <TabsTrigger
              value="faq"
              className="min-h-[40px] px-4 data-[state=active]:bg-emerald-600 data-[state=active]:text-white dark:data-[state=active]:text-white"
            >
              FAQ
            </TabsTrigger>
          </TabsList>

          {/* ---------- CAMPS (live + upcoming, public) ---------- */}
          <TabsContent value="camps" className="space-y-4 pt-4">
            {loading ? (
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {[0, 1, 2].map((i) => (
                  <Skeleton key={i} className="h-72 rounded-2xl" />
                ))}
              </div>
            ) : live ? (
              <PublicCampsTab campaignId={live.id} />
            ) : (
              <EmptyState
                icon={Radio}
                title="Camps load with the programme data"
                hint="Couldn't reach the camp schedule right now — please refresh."
              />
            )}
          </TabsContent>

          {/* ---------- STORY ---------- */}
          <TabsContent value="story" className="space-y-5 pt-4">
            <div className="grid gap-6 lg:grid-cols-[1.5fr_1fr]">
              <div className="space-y-4">
                {content.overview.map((p, i) => (
                  <p key={i} className="text-sm leading-relaxed text-muted-foreground sm:text-base">
                    {p}
                  </p>
                ))}
              </div>
              <div className="grid grid-cols-2 gap-3 self-start">
                {content.keyFacts.map((f, i) => (
                  <Card
                    key={i}
                    className={cn("col-span-1 p-4", i === 0 && "col-span-2")}
                  >
                    <p className={cn("text-2xl font-extrabold tracking-tight", a.text)}>
                      {f.value}
                      <span className="text-sm font-bold">{f.suffix}</span>
                    </p>
                    <p className="mt-1 text-xs leading-snug text-muted-foreground">{f.label}</p>
                  </Card>
                ))}
              </div>
            </div>

            <CollapsibleBlock
          title="The data"
          subtitle="Real India-context datasets behind this programme."
          icon={ChartNoAxesCombined}
          defaultOpen={false}
        >
          <div className={cn("grid gap-4", content.charts.length > 1 && "lg:grid-cols-2")}>
            {content.charts.map((ch, i) => (
              <ChartBox
                key={i}
                title={ch.title}
                desc={ch.desc}
                type={ch.type}
                data={ch.data}
                xKey={ch.xKey}
                nameKey={ch.nameKey}
                valueKey={ch.valueKey}
                colors={ch.colors}
              />
            ))}
          </div>
        </CollapsibleBlock>

            <CollapsibleBlock
          title="Why this matters"
          subtitle="The case for this programme, in plain terms."
          icon={Target}
          defaultOpen={false}
        >
          <div className="grid gap-3 sm:grid-cols-2">
            {content.whyItMatters.map((w, i) => (
              <Card key={i} className="flex gap-3 p-4">
                <span
                  className={cn(
                    "mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full",
                    a.chip,
                    a.text
                  )}
                >
                  <Check className="size-4" aria-hidden />
                </span>
                <p className="text-sm leading-relaxed text-muted-foreground">{w}</p>
              </Card>
            ))}
          </div>
        </CollapsibleBlock>

            <CollapsibleBlock
          title="The playbook"
          subtitle="What actually works — step by step, exactly as our field volunteers teach it."
          icon={BookOpenCheck}
          defaultOpen={false}
        >
          <div className="mx-auto max-w-3xl">
            <StepFlow steps={content.playbook} accent={accent} />
          </div>
        </CollapsibleBlock>

            <CollapsibleBlock
          title="Do this, not that"
          subtitle="Field-tested guidance from our volunteers."
          icon={ListChecks}
          defaultOpen={false}
        >
          <div className="grid gap-4 md:grid-cols-2">
            <Card className="border-emerald-500/25 bg-emerald-500/10 p-5">
              <h3 className="flex items-center gap-2 font-semibold text-emerald-700 dark:text-emerald-400">
                <CheckCircle2 className="size-5" aria-hidden /> Do
              </h3>
              <ul className="mt-4 space-y-3">
                {content.dosDonts.dos.map((d, i) => (
                  <li key={i}>
                    <CheckItem done={false}>{d}</CheckItem>
                  </li>
                ))}
              </ul>
            </Card>
            <Card className="border-red-500/25 bg-red-500/10 p-5">
              <h3 className="flex items-center gap-2 font-semibold text-red-700 dark:text-red-400">
                <Ban className="size-5" aria-hidden /> Don&rsquo;t
              </h3>
              <ul className="mt-4 space-y-3">
                {content.dosDonts.donts.map((d, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm leading-relaxed">
                    <X className="mt-0.5 size-4 shrink-0 text-red-600 dark:text-red-400" aria-hidden />
                    <span>{d}</span>
                  </li>
                ))}
              </ul>
            </Card>
          </div>
        </CollapsibleBlock>

            <CollapsibleBlock
          title="Myths vs facts"
          subtitle="Clearing up common misconceptions, one by one."
          icon={CircleHelp}
          defaultOpen={false}
        >
          <Accordion type="single" collapsible className="mx-auto max-w-3xl">
            {content.mythsFacts.map((m, i) => (
              <AccordionItem key={i} value={`myth-${i}`}>
                <AccordionTrigger className="text-left text-sm sm:text-base">
                  <span className="flex items-start gap-2">
                    <Badge className="mt-0.5 shrink-0 border-0 bg-red-500/15 text-[10px] uppercase text-red-600 dark:text-red-400">
                      Myth
                    </Badge>
                    {m.myth}
                  </span>
                </AccordionTrigger>
                <AccordionContent className="text-sm leading-relaxed text-muted-foreground">
                  <span className="flex items-start gap-2">
                    <Badge className="mt-0.5 shrink-0 border-0 bg-emerald-500/15 text-[10px] uppercase text-emerald-600 dark:text-emerald-400">
                      Fact
                    </Badge>
                    {m.fact}
                  </span>
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </CollapsibleBlock>

            <CollapsibleBlock
          title="Official links & further reading"
          subtitle="Verified government and institutional resources for this programme."
          icon={Link2}
          defaultOpen={false}
        >
          <div className="flex flex-wrap gap-2">
            {content.links.map((l) => (
              <a
                key={l.href}
                href={l.href}
                target="_blank"
                rel="noopener noreferrer"
                className={cn(
                  "inline-flex min-h-[40px] items-center gap-1.5 rounded-full border bg-card px-3.5 py-2 text-xs font-semibold transition hover:shadow-sm",
                  a.border,
                  a.text
                )}
              >
                {l.label}
                <ExternalLink className="size-3.5" aria-hidden />
              </a>
            ))}
          </div>
        </CollapsibleBlock>

            <ToolkitSection accent={accent} toolkit={content.toolkit} />
          </TabsContent>

          {/* ---------- IMPACT ---------- */}
          <TabsContent value="impact" className="space-y-6 pt-4">
            {/* Live stats */}
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              {loading ? (
                Array.from({ length: 4 }).map((_, i) => (
                  <Skeleton key={i} className="h-[74px] rounded-xl" />
                ))
              ) : live ? (
                <>
                  {[
                    { label: "Raised so far", value: formatINRCompact(live.raisedAmount) },
                    { label: "Of target", value: formatINRCompact(live.targetAmount) },
                    { label: "Beneficiaries", value: formatNumber(live.beneficiaries) },
                    { label: "Volunteers engaged", value: formatNumber(live.volunteersEngaged) },
                  ].map((s) => (
                    <Card key={s.label} className="p-4 sm:p-5">
                      <p className={cn("text-xl font-extrabold tracking-tight sm:text-2xl", a.text)}>
                        {s.value}
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">{s.label}</p>
                    </Card>
                  ))}
                </>
              ) : (
                <p className="col-span-2 text-sm text-muted-foreground lg:col-span-4">
                  Live programme numbers are syncing — the outcome bullets below describe how
                  every rupee converts into field action.
                </p>
              )}
            </div>

            {/* Outcome bullets */}
            <div className="rounded-xl border bg-muted/40 p-5">
              <h3 className="font-semibold">How your gift converts into action</h3>
              <ul className="mt-3 space-y-2.5">
                {(IMPACT_BULLETS[content.slug] ?? []).map((b, i) => (
                  <li key={i} className="flex items-start gap-2.5 text-sm leading-relaxed text-muted-foreground">
                    <CheckCircle2
                      className={cn("mt-0.5 size-4 shrink-0", a.text)}
                      aria-hidden
                    />
                    {b}
                  </li>
                ))}
              </ul>
              <Button
                className={cn("mt-4 text-white", a.solid)}
                onClick={() => navigate(`/donate?campaign=${content.slug}`)}
              >
                <Heart className="size-4" aria-hidden /> Fund this programme
              </Button>
            </div>

            {/* Recent support wall */}
            <SupportWall slug={slug} campaignTitle={live?.title ?? null} accent={accent} />
          </TabsContent>

          {/* ---------- FAQ ---------- */}
          <TabsContent value="faq" className="pt-4">
            <Accordion type="single" collapsible className="mx-auto max-w-3xl">
              {DONOR_FAQS.map((f, i) => (
                <AccordionItem key={`donor-${i}`} value={`donor-faq-${i}`}>
                  <AccordionTrigger className="text-left text-sm sm:text-base">
                    {f.q}
                  </AccordionTrigger>
                  <AccordionContent className="text-sm leading-relaxed text-muted-foreground">
                    {f.a}
                  </AccordionContent>
                </AccordionItem>
              ))}
              {content.faqs.map((f, i) => (
                <AccordionItem key={`faq-${i}`} value={`faq-${i}`}>
                  <AccordionTrigger className="text-left text-sm sm:text-base">
                    {f.q}
                  </AccordionTrigger>
                  <AccordionContent className="text-sm leading-relaxed text-muted-foreground">
                    {f.a}
                  </AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
          </TabsContent>
        </Tabs>
      </Section>

      {/* ================= STICKY DONATE CTA ================= */}
      <div
        className="sticky bottom-4 z-30 mx-auto w-full max-w-screen-2xl px-4 sm:px-6"
        style={{ marginTop: "-1rem" }}
      >
        <div className="flex items-center justify-between gap-3 rounded-2xl border bg-background/90 p-3 shadow-lg backdrop-blur sm:px-4">
          <div className="min-w-0">
            <p className="truncate text-sm font-bold leading-tight">{content.title}</p>
            <p className="text-xs text-muted-foreground">
              {live ? (
                <>
                  <span className="font-semibold text-foreground">
                    {formatINRCompact(live.raisedAmount)}
                  </span>{" "}
                  raised · {pct}%
                </>
              ) : (
                "Every rupee QR-traced to a doorstep"
              )}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="min-h-[44px]"
              onClick={shareCampaign}
              aria-label="Share this programme"
            >
              <Share2 className="size-4" aria-hidden />
              <span className="hidden sm:inline">Share</span>
            </Button>
            <Button
              size="sm"
              className="min-h-[44px] bg-emerald-600 hover:bg-emerald-700"
              onClick={() => navigate(`/donate?campaign=${content.slug}`)}
            >
              <Heart className="size-4" aria-hidden /> Donate
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ================================================================== */
/* Recent support wall (public donations feed, campaign-filtered)       */
/* ================================================================== */

function SupportWall({
  slug,
  campaignTitle,
  accent,
}: {
  slug: string;
  campaignTitle: string | null;
  accent: string;
}) {
  const a = accentSoft(accent);
  const [donations, setDonations] = useState<PublicDonation[] | null>(null);

  useEffect(() => {
    let alive = true;
    get<PublicDonation[]>("/api/donations?public=1")
      .then((d) => alive && setDonations(Array.isArray(d) ? d : []))
      .catch(() => alive && setDonations([]));
    return () => {
      alive = false;
    };
  }, []);

  const wall = React.useMemo(() => {
    if (donations === null) return null;
    if (!campaignTitle) return donations.slice(0, 6);
    const own = donations.filter((d) => d.campaign?.title === campaignTitle);
    return own.length > 0 ? own : [];
  }, [donations, campaignTitle]);

  return (
    <div>
      <h3 className="flex items-center gap-2 text-xl font-bold tracking-tight">
        <MessageCircleHeart className="size-5 text-muted-foreground" aria-hidden /> Recent
        support
      </h3>
      {wall === null ? (
        <div className="mt-4 space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-12 rounded-lg" />
          ))}
        </div>
      ) : wall.length === 0 ? (
        <EmptyState
          icon={Heart}
          title="Be the first to support this programme"
          hint="Every gift appears here — anonymously if you prefer — with its QR-traced outcome."
          className="mt-4"
          action={
            <Button className={cn("text-white", a.solid)} onClick={() => navigate(`/donate?campaign=${slug}`)}>
              <Heart className="size-4" aria-hidden /> Donate now
            </Button>
          }
        />
      ) : (
        <ul className="mt-4 grid gap-2 sm:grid-cols-2">
          {wall.map((d) => (
            <li
              key={d.id}
              className="flex items-center gap-3 rounded-lg border bg-card p-3"
            >
              <span
                className={cn(
                  "flex size-9 shrink-0 items-center justify-center rounded-full text-xs font-bold",
                  a.chip,
                  a.text
                )}
              >
                {(d.isAnonymous ? "A" : d.donorName?.[0] ?? "?").toUpperCase()}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold">
                  {d.isAnonymous ? "Anonymous" : d.donorName}
                  {d.type === "RECURRING" && (
                    <Badge variant="outline" className="ml-1.5 px-1 py-0 text-[9px]">
                      monthly
                    </Badge>
                  )}
                </span>
                <span className="block text-[11px] text-muted-foreground">
                  {timeAgo(d.createdAt)}
                  {d.campaign?.title ? ` · ${d.campaign.title}` : ""}
                </span>
              </span>
              <span className={cn("shrink-0 text-sm font-bold", a.text)}>
                {formatINR(d.amount)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* ================================================================== */
/* Toolkit — interactive checklists with progress                      */
/* ================================================================== */

function ToolkitSection({
  accent,
  toolkit,
}: {
  accent: string;
  toolkit: { title: string; items: string[] }[];
}) {
  const a = accentSoft(accent);
  const [checked, setChecked] = useState<Set<string>>(new Set());

  const total = toolkit.reduce((n, g) => n + g.items.length, 0);
  const done = checked.size;

  const toggle = (key: string) => {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  return (
    <CollapsibleBlock
      title="Your toolkit"
        subtitle="Tick items off as you secure your home, family or workplace. Progress is saved as you go."
        icon={Wrench}
        defaultOpen={false}
      >
      <div className="mb-5 flex items-center gap-3">
        <Progress
          value={total ? (done / total) * 100 : 0}
          className="h-2.5 max-w-xs"
          aria-label={`${done} of ${total} checklist items done`}
        />
        <span className="text-sm font-semibold text-muted-foreground">
          {done}/{total}
        </span>
      </div>
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {toolkit.map((g, gi) => {
          const groupDone = g.items.filter((_, ii) => checked.has(`${gi}-${ii}`)).length;
          return (
            <Card key={gi} className="flex flex-col p-5">
              <div className="flex items-center justify-between gap-2">
                <h3 className="font-semibold leading-snug">{g.title}</h3>
                <Badge variant="outline" className={cn("shrink-0", a.border, a.text)}>
                  {groupDone}/{g.items.length}
                </Badge>
              </div>
              <ul className="mt-4 space-y-3">
                {g.items.map((item, ii) => {
                  const key = `${gi}-${ii}`;
                  return (
                    <li key={key}>
                      <label className="flex cursor-pointer items-start gap-2.5">
                        <Checkbox
                          checked={checked.has(key)}
                          onCheckedChange={() => toggle(key)}
                          className="mt-0.5"
                          aria-label={item}
                        />
                        <span
                          className={cn(
                            "text-sm leading-relaxed",
                            checked.has(key) && "text-muted-foreground line-through"
                          )}
                        >
                          {item}
                        </span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            </Card>
          );
        })}
      </div>
    </CollapsibleBlock>
  );
}

/* ================================================================== */
/* Special embed: medicine-adoption → /api/causes                      */
/* ================================================================== */

function MedicineAdoptionEmbed() {
  const [causes, setCauses] = useState<Cause[] | null>(null);
  const [adopting, setAdopting] = useState<Cause | null>(null);
  const [filter, setFilter] = useState("ALL");
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 24;

  const load = useCallback(async () => {
    try {
      const d = await get<Cause[]>("/api/causes");
      setCauses(Array.isArray(d) ? d : []);
    } catch {
      setCauses([]);
    }
  }, []);

  useEffect(() => {
    const t = setTimeout(load, 0);
    return () => clearTimeout(t);
  }, [load]);

  const counts = React.useMemo(() => {
    const list = causes ?? [];
    return {
      ALL: list.length,
      SEEKING: list.filter((c) => c.status === "SEEKING").length,
      PARTIAL: list.filter((c) => c.status === "PARTIAL").length,
      ADOPTED: list.filter((c) => c.status === "ADOPTED").length,
      PAUSED: list.filter((c) => c.status === "PAUSED").length,
    };
  }, [causes]);

  // Most in-need first: SEEKING before PARTIAL before closed-out statuses,
  // lowest % raised within each group.
  const filtered = React.useMemo(() => {
    const rank: Record<string, number> = { SEEKING: 0, PARTIAL: 1, ADOPTED: 2, PAUSED: 3 };
    let list = [...(causes ?? [])];
    if (filter !== "ALL") list = list.filter((c) => c.status === filter);
    return list.sort((a, b) => {
      const ra = rank[a.status] ?? 9;
      const rb = rank[b.status] ?? 9;
      if (ra !== rb) return ra - rb;
      const na = a.monthlyCost * a.durationMonths;
      const nb = b.monthlyCost * b.durationMonths;
      const pa = na > 0 ? a.raised / na : 1;
      const pb = nb > 0 ? b.raised / nb : 1;
      return pa - pb;
    });
  }, [causes, filter]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const paged = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  const CARD_TINT: Record<string, string> = {
    SEEKING: "border-amber-400/50 bg-amber-50 dark:border-amber-500/30 dark:bg-amber-950/20",
    PARTIAL: "border-sky-400/50 bg-sky-50 dark:border-sky-500/30 dark:bg-sky-950/20",
    ADOPTED: "border-emerald-400/50 bg-emerald-50 dark:border-emerald-500/30 dark:bg-emerald-950/20",
    PAUSED: "border-border bg-muted/40 opacity-80",
  };
  const AVATAR_TINT: Record<string, string> = {
    SEEKING: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
    PARTIAL: "bg-sky-500/15 text-sky-700 dark:text-sky-400",
    ADOPTED: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
    PAUSED: "bg-muted text-muted-foreground",
  };
  const STATUS_LABEL: Record<string, string> = {
    SEEKING: "Seeking",
    PARTIAL: "Partial",
    ADOPTED: "Adopted",
    PAUSED: "Paused",
  };

  const filters = [
    { v: "ALL", label: "All", count: counts.ALL, active: "bg-foreground text-background" },
    { v: "SEEKING", label: "Seeking", count: counts.SEEKING, active: "bg-amber-500 text-white" },
    { v: "PARTIAL", label: "Partial", count: counts.PARTIAL, active: "bg-sky-500 text-white" },
    { v: "ADOPTED", label: "Adopted", count: counts.ADOPTED, active: "bg-emerald-600 text-white" },
    { v: "PAUSED", label: "Paused", count: counts.PAUSED, active: "bg-muted text-foreground" },
  ];

  return (
    <div>
      <h2 className="text-lg font-bold tracking-tight">Patients waiting for adoption</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Pharmacist-verified prescriptions, Jan Aushadhi pricing, QR&rsquo;d doorstep delivery.
        Adopt fully or share a pledge.
      </p>

      {/* Status filters double as live counts */}
      <div className="mt-4 flex flex-wrap items-center gap-2" role="group" aria-label="Filter patients by status">
        {filters.map((f) => (
          <button
            key={f.v}
            onClick={() => {
              setFilter(f.v);
              setPage(1);
            }}
            aria-pressed={filter === f.v}
            className={cn(
              "inline-flex min-h-[32px] items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold transition",
              filter === f.v ? f.active : "bg-muted text-muted-foreground hover:bg-accent hover:text-foreground"
            )}
          >
            {f.label}
            <span
              className={cn(
                "rounded-full px-1.5 py-px text-[10px] font-bold",
                filter === f.v ? "bg-white/25" : "bg-background"
              )}
            >
              {f.count}
            </span>
          </button>
        ))}
      </div>

      {causes === null ? (
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 2xl:grid-cols-8">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-52 rounded-xl" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={HeartPulse}
          title={filter === "ALL" ? "No open causes right now" : `No ${STATUS_LABEL[filter.toLowerCase()] ?? filter.toLowerCase()} patients`}
          hint="New verified causes appear within a week — or donate to the general medicine fund."
          className="mt-4"
          action={
            <Button asChild className="bg-teal-600 hover:bg-teal-700">
              <Link href="/donate?campaign=medicine-adoption">Fund medicines generally</Link>
            </Button>
          }
        />
      ) : (
        <>
          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 2xl:grid-cols-8">
            {paged.map((cause) => {
              const needed = cause.monthlyCost * cause.durationMonths;
              const pct = needed > 0 ? Math.min(100, Math.round((cause.raised / needed) * 100)) : 0;
              const urgent = cause.status === "SEEKING" && pct < 25;
              const initials = cause.patientName
                .split(" ")
                .map((w) => w[0])
                .slice(0, 2)
                .join("")
                .toUpperCase();
              return (
                <Card
                  key={cause.id}
                  className={cn(
                    "flex flex-col gap-2 p-3 transition-all hover:-translate-y-0.5 hover:shadow-md",
                    CARD_TINT[cause.status] ?? ""
                  )}
                >
                  <div className="flex items-center justify-between gap-1">
                    <span
                      className={cn(
                        "flex size-8 shrink-0 items-center justify-center rounded-full text-[11px] font-bold",
                        AVATAR_TINT[cause.status] ?? ""
                      )}
                      aria-hidden
                    >
                      {initials}
                    </span>
                    <span className="flex items-center gap-1">
                      {urgent && (
                        <Badge className="border-0 bg-red-500 px-1 py-0 text-[9px] font-bold text-white">
                          URGENT
                        </Badge>
                      )}
                      <Badge
                        className={cn(
                          "border-0 px-1.5 text-[9px] hover:opacity-90",
                          CAUSE_STATUS[cause.status] ?? "bg-muted text-muted-foreground"
                        )}
                      >
                        {STATUS_LABEL[cause.status] ?? titleCase(cause.status)}
                      </Badge>
                    </span>
                  </div>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold">{cause.patientName}</p>
                    <p className="truncate text-[11px] text-muted-foreground">
                      {cause.age} yrs · {titleCase(cause.condition)} · {cause.city}
                    </p>
                  </div>
                  <div className="mt-auto">
                    <p className="leading-none">
                      <span className="text-base font-bold text-teal-600 dark:text-teal-400">
                        {formatINR(cause.monthlyCost)}
                      </span>
                      <span className="text-[10px] text-muted-foreground">/mo × {cause.durationMonths}m</span>
                    </p>
                    <Progress value={pct} className="mt-1.5 h-1.5" aria-label={`${pct}% raised`} />
                    <p className="mt-1 text-[10px] text-muted-foreground">
                      {pct}% funded
                    </p>
                  </div>
                  <Button
                    size="sm"
                    className="h-8 w-full bg-teal-600 text-white hover:bg-teal-700"
                    onClick={() => setAdopting(cause)}
                    disabled={cause.status === "ADOPTED" || cause.status === "PAUSED"}
                  >
                    {cause.status === "ADOPTED" ? (
                      <><Check className="size-3.5" aria-hidden /> Adopted</>
                    ) : cause.status === "PAUSED" ? (
                      "Paused"
                    ) : (
                      <><Heart className="size-3.5" aria-hidden /> Adopt</>
                    )}
                  </Button>
                </Card>
              );
            })}
          </div>

          {totalPages > 1 && (
            <Pagination className="mt-5">
              <PaginationContent>
                <PaginationItem>
                  <PaginationPrevious
                    href="#"
                    aria-disabled={currentPage === 1}
                    className={currentPage === 1 ? "pointer-events-none opacity-40" : undefined}
                    onClick={(e) => {
                      e.preventDefault();
                      if (currentPage > 1) setPage(currentPage - 1);
                    }}
                  />
                </PaginationItem>
                {Array.from({ length: totalPages }, (_, i) => i + 1).map((n) => (
                  <PaginationItem key={n}>
                    <PaginationLink
                      href="#"
                      isActive={n === currentPage}
                      onClick={(e) => {
                        e.preventDefault();
                        setPage(n);
                      }}
                    >
                      {n}
                    </PaginationLink>
                  </PaginationItem>
                ))}
                <PaginationItem>
                  <PaginationNext
                    href="#"
                    aria-disabled={currentPage === totalPages}
                    className={currentPage === totalPages ? "pointer-events-none opacity-40" : undefined}
                    onClick={(e) => {
                      e.preventDefault();
                      if (currentPage < totalPages) setPage(currentPage + 1);
                    }}
                  />
                </PaginationItem>
              </PaginationContent>
            </Pagination>
          )}
        </>
      )}

      <AdoptDialog cause={adopting} onClose={() => setAdopting(null)} onDone={load} />
    </div>
  );
}

function AdoptDialog({
  cause,
  onClose,
  onDone,
}: {
  cause: Cause | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const [step, setStep] = useState(1);
  const [percent, setPercent] = useState<number>(100);
  const [custom, setCustom] = useState("");
  const [months, setMonths] = useState("6");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const reduceMotion = useReducedMotion();

  useEffect(() => {
    if (cause) {
      setStep(1);
      setPercent(100);
      setCustom("");
      setMonths("6");
      setName("");
      setBusy(false);
    }
  }, [cause]);

  const amount =
    custom.trim() !== ""
      ? Number(custom) || 0
      : Math.round(((cause?.monthlyCost ?? 0) * percent) / 100);
  const monthsN = Number(months) || 6;
  const total = amount * monthsN;

  const goNext = () => {
    if (step === 2 && (!Number.isFinite(amount) || amount < 1)) {
      toast.error("Enter a monthly amount of at least ₹1");
      return;
    }
    setStep((v) => Math.min(3, v + 1));
  };

  const submit = async () => {
    if (!cause) return;
    if (!name.trim()) {
      toast.error("Please enter your name");
      return;
    }
    setBusy(true);
    try {
      await post(`/api/causes/${cause.id}/pledges`, {
        amountPerMonth: amount,
        months: monthsN,
        donorName: name.trim(),
      });
      onDone();
      setStep(4);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not create pledge");
    } finally {
      setBusy(false);
    }
  };

  const STEPS = [
    { n: 1, label: "How it works" },
    { n: 2, label: "Your pledge" },
    { n: 3, label: "Confirm" },
  ];

  const HOW = [
    {
      icon: Heart,
      title: "You pledge a monthly amount",
      desc: "Adopt the full regimen or share it — every partial pledge is welcome.",
    },
    {
      icon: Pill,
      title: "We verify and dispense",
      desc: "Pharmacist-verified prescription, filled at Jan Aushadhi Kendras at generic prices.",
    },
    {
      icon: ScanLine,
      title: "You see proof every refill",
      desc: "The dispensed prescription and pharmacy bill are shared with you each cycle.",
    },
    {
      icon: Landmark,
      title: "80G receipt, instantly",
      desc: "Every rupee is tax-deductible; the receipt is emailed on confirmation.",
    },
  ];

  if (!cause) {
    return (
      <FormSheet open={false} onOpenChange={onClose} title="Adopt a patient" size="half" />
    );
  }

  const closed = cause.status === "ADOPTED" || cause.status === "PAUSED";

  return (
    <FormSheet
      open
      onOpenChange={(o) => !o && onClose()}
      title={`Adopt ${cause.patientName}'s medicines`}
      description={`${cause.age} yrs · ${titleCase(cause.condition)} · ${cause.city} · needs medicines for ${cause.durationMonths} months`}
      size="half"
      badge={
        <Badge
          className={cn(
            "border-0 text-[10px] hover:opacity-90",
            CAUSE_STATUS[cause.status] ?? "bg-muted text-muted-foreground"
          )}
        >
          {cause.status === "SEEKING" ? "Seeking a donor" : titleCase(cause.status)}
        </Badge>
      }
      footer={
        step === 4 ? (
          <div className="flex w-full justify-end">
            <Button className="bg-teal-600 hover:bg-teal-700" onClick={onClose}>
              Done
            </Button>
          </div>
        ) : (
          <>
            <p className="hidden text-xs text-muted-foreground sm:block">
              Step {step} of 3 — {STEPS[step - 1].label}
            </p>
            <div className="flex shrink-0 items-center gap-2">
              {step > 1 && (
                <Button type="button" variant="ghost" onClick={() => setStep(step - 1)} disabled={busy}>
                  <ArrowLeft className="size-4" aria-hidden /> Back
                </Button>
              )}
              {step < 3 ? (
                <Button type="button" onClick={goNext} className="bg-teal-600 hover:bg-teal-700" disabled={closed}>
                  {step === 1 ? "Choose amount" : "Continue"}
                  <ArrowRight className="size-4" aria-hidden />
                </Button>
              ) : (
                <Button type="button" onClick={submit} disabled={busy} className="bg-teal-600 hover:bg-teal-700">
                  <Heart className="size-4" aria-hidden />
                  {busy ? "Pledging…" : "Confirm adoption"}
                </Button>
              )}
            </div>
          </>
        )
      }
    >
      {/* Patient banner */}
      <div className="-mx-6 -mt-5 flex items-center gap-3 bg-teal-600 px-6 py-4 text-white">
        <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-white/15 text-sm font-bold ring-1 ring-white/25">
          {cause.patientName
            .split(" ")
            .map((w) => w[0])
            .slice(0, 2)
            .join("")
            .toUpperCase()}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-bold">{cause.patientName}</p>
          <p className="truncate text-xs text-white/80">
            {cause.age} yrs · {titleCase(cause.condition)} · {cause.city}
          </p>
        </div>
        <div className="shrink-0 text-right">
          <p className="text-lg font-extrabold leading-none">{formatINR(cause.monthlyCost)}</p>
          <p className="text-[10px] text-white/75">per month</p>
        </div>
      </div>

      {step < 4 ? (
        <>
          {/* Stepper */}
          <nav aria-label="Adoption steps">
            <div className="flex items-center gap-1">
              {STEPS.map((st, i) => {
                const done = step > st.n;
                const active = step === st.n;
                return (
                  <React.Fragment key={st.n}>
                    {i > 0 && (
                      <span
                        className={cn(
                          "h-px flex-1 transition-colors",
                          done ? "bg-teal-500" : "bg-border"
                        )}
                      />
                    )}
                    <span
                      className={cn(
                        "flex items-center gap-1.5 text-xs",
                        active ? "font-semibold text-foreground" : "text-muted-foreground"
                      )}
                    >
                      <span
                        className={cn(
                          "flex size-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold transition",
                          done
                            ? "bg-teal-600 text-white"
                            : active
                              ? "bg-teal-500/15 text-teal-600 ring-2 ring-teal-500/40 dark:text-teal-400"
                              : "bg-muted text-muted-foreground"
                        )}
                      >
                        {done ? <Check className="size-3.5" aria-hidden /> : st.n}
                      </span>
                      <span className="hidden sm:inline">{st.label}</span>
                    </span>
                  </React.Fragment>
                );
              })}
            </div>
          </nav>

          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={step}
              initial={reduceMotion ? false : { opacity: 0, x: 24 }}
              animate={{ opacity: 1, x: 0 }}
              exit={reduceMotion ? undefined : { opacity: 0, x: -24 }}
              transition={{ duration: 0.2 }}
            >
              {/* ---------------- STEP 1: how it works ---------------- */}
              {step === 1 && (
                <ul className="space-y-3">
                  {HOW.map((h) => (
                    <li key={h.title} className="flex items-start gap-3">
                      <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-teal-500/10 text-teal-600 dark:text-teal-400">
                        <h.icon className="size-4.5" aria-hidden />
                      </span>
                      <div>
                        <p className="text-sm font-semibold">{h.title}</p>
                        <p className="text-xs leading-relaxed text-muted-foreground">{h.desc}</p>
                      </div>
                    </li>
                  ))}
                </ul>
              )}

              {/* ---------------- STEP 2: pledge ---------------- */}
              {step === 2 && (
                <div className="space-y-4">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Monthly coverage
                    </p>
                    <div className="mt-2 grid grid-cols-4 gap-2">
                      {[25, 50, 75, 100].map((p) => (
                        <button
                          key={p}
                          type="button"
                          onClick={() => {
                            setPercent(p);
                            setCustom("");
                          }}
                          aria-pressed={percent === p && custom.trim() === ""}
                          className={cn(
                            "rounded-xl border p-2.5 text-center transition",
                            percent === p && custom.trim() === ""
                              ? "border-teal-500 bg-teal-500/10 ring-2 ring-teal-500/30"
                              : "hover:border-teal-500/40"
                          )}
                        >
                          <span className="block text-xs font-semibold">
                            {p === 100 ? "Full" : `${p}%`}
                          </span>
                          <span className="block text-xs font-bold text-teal-600 dark:text-teal-400">
                            {formatINR(Math.round((cause.monthlyCost * p) / 100))}
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="adopt-custom">Or enter a custom monthly amount (₹)</Label>
                    <Input
                      id="adopt-custom"
                      type="number"
                      min={1}
                      placeholder={`e.g. ${Math.round(cause.monthlyCost / 2)}`}
                      value={custom}
                      onChange={(e) => setCustom(e.target.value)}
                    />
                  </div>

                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Commitment
                    </p>
                    <div className="mt-2 grid grid-cols-3 gap-2">
                      {["3", "6", "12"].map((m) => (
                        <button
                          key={m}
                          type="button"
                          onClick={() => setMonths(m)}
                          aria-pressed={months === m}
                          className={cn(
                            "rounded-xl border py-2 text-sm font-semibold transition",
                            months === m
                              ? "border-teal-500 bg-teal-500/10 text-teal-600 ring-2 ring-teal-500/30 dark:text-teal-400"
                              : "hover:border-teal-500/40"
                          )}
                        >
                          {m} months
                        </button>
                      ))}
                    </div>
                  </div>

                  {amount >= 1 && (
                    <div className="flex items-center justify-between rounded-xl bg-teal-500/10 px-4 py-3 text-sm">
                      <span className="text-muted-foreground">
                        {formatINR(amount)}/mo × {monthsN} months
                      </span>
                      <span className="font-extrabold text-teal-700 dark:text-teal-400">
                        {formatINR(total)} total
                      </span>
                    </div>
                  )}
                </div>
              )}

              {/* ---------------- STEP 3: confirm ---------------- */}
              {step === 3 && (
                <div className="space-y-4">
                  <div className="space-y-1.5">
                    <Label htmlFor="adopt-name">Your name</Label>
                    <Input
                      id="adopt-name"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="As you'd like to be known"
                    />
                  </div>

                  <div className="rounded-xl border bg-muted/40 p-4 text-sm">
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Pledge summary
                    </p>
                    <dl className="mt-2 space-y-1.5">
                      <div className="flex justify-between gap-2">
                        <dt className="text-muted-foreground">Monthly</dt>
                        <dd className="font-semibold">{formatINR(amount)}</dd>
                      </div>
                      <div className="flex justify-between gap-2">
                        <dt className="text-muted-foreground">Duration</dt>
                        <dd className="font-semibold">{monthsN} months</dd>
                      </div>
                      <div className="flex justify-between gap-2 border-t pt-1.5">
                        <dt className="font-semibold">Total</dt>
                        <dd className="font-extrabold text-teal-700 dark:text-teal-400">
                          {formatINR(total)}
                        </dd>
                      </div>
                    </dl>
                  </div>
                  <p className="text-[11px] leading-relaxed text-muted-foreground">
                    No payment now — our team will call within 48 hours to set up the recurring
                    transfer. Cancel anytime.
                  </p>
                </div>
              )}
            </motion.div>
          </AnimatePresence>
        </>
      ) : (
        /* ---------------- SUCCESS ---------------- */
        <div className="flex flex-col items-center py-8 text-center">
          <motion.span
            initial={reduceMotion ? false : { scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ type: "spring", stiffness: 260, damping: 18, delay: 0.1 }}
            className="flex size-16 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
          >
            <CheckCircle2 className="size-9" aria-hidden />
          </motion.span>
          <h3 className="mt-4 text-lg font-bold">Adoption pledged</h3>
          <p className="mt-1 max-w-sm text-sm leading-relaxed text-muted-foreground">
            Thank you — {name.trim() || "your pledge"} is supporting{" "}
            <span className="font-semibold text-foreground">{cause.patientName}</span> with{" "}
            {formatINR(amount)}/mo for {monthsN} months
            {total > 0 ? ` (${formatINR(total)} total)` : ""}. Our team will call you within 48
            hours.
          </p>
        </div>
      )}
    </FormSheet>
  );
}

function AnimalWelfareEmbed() {
  const [animals, setAnimals] = useState<Animal[] | null>(null);
  const [sponsoring, setSponsoring] = useState<Animal | null>(null);
  const [filter, setFilter] = useState("ALL");
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 24;

  const load = useCallback(async () => {
    try {
      const d = await get<Animal[]>("/api/animals");
      setAnimals(Array.isArray(d) ? d : []);
    } catch {
      setAnimals([]);
    }
  }, []);

  useEffect(() => {
    const t = setTimeout(load, 0);
    return () => clearTimeout(t);
  }, [load]);

  const ageLabel = (m: number) => {
    const y = Math.floor(m / 12);
    const rest = m % 12;
    if (y <= 0) return `${rest} mo`;
    return rest ? `${y}y ${rest}m` : `${y} yrs`;
  };

  const speciesIcon = (species: string) => {
    if (species === "DOG") return <Dog className="size-4" aria-hidden />;
    return <PawGlyph className="size-4" />;
  };

  const counts = React.useMemo(() => {
    const list = animals ?? [];
    return {
      ALL: list.length,
      AVAILABLE: list.filter((a) => a.status === "AVAILABLE").length,
      FOSTERED: list.filter((a) => a.status === "FOSTERED").length,
      ADOPTED: list.filter((a) => a.status === "ADOPTED").length,
      CRITICAL: list.filter((a) => a.status === "CRITICAL").length,
    };
  }, [animals]);

  // Critical cases first, then animals still seeking a sponsor.
  const filtered = React.useMemo(() => {
    const rank: Record<string, number> = { CRITICAL: 0, AVAILABLE: 1, FOSTERED: 2, ADOPTED: 3 };
    let list = [...(animals ?? [])];
    if (filter !== "ALL") list = list.filter((a) => a.status === filter);
    return list.sort((a, b) => (rank[a.status] ?? 9) - (rank[b.status] ?? 9));
  }, [animals, filter]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const paged = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  const CARD_TINT: Record<string, string> = {
    AVAILABLE: "border-cyan-400/50 bg-cyan-50 dark:border-cyan-500/30 dark:bg-cyan-950/20",
    FOSTERED: "border-amber-400/50 bg-amber-50 dark:border-amber-500/30 dark:bg-amber-950/20",
    ADOPTED: "border-emerald-400/50 bg-emerald-50 dark:border-emerald-500/30 dark:bg-emerald-950/20",
    CRITICAL: "border-red-400/60 bg-red-50 dark:border-red-500/30 dark:bg-red-950/20",
  };
  const AVATAR_TINT: Record<string, string> = {
    AVAILABLE: "bg-cyan-500/15 text-cyan-700 dark:text-cyan-400",
    FOSTERED: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
    ADOPTED: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
    CRITICAL: "bg-red-500/15 text-red-700 dark:text-red-400",
  };
  const STATUS_LABEL: Record<string, string> = {
    AVAILABLE: "Seeking",
    FOSTERED: "Fostered",
    ADOPTED: "Adopted",
    CRITICAL: "Critical",
  };

  const filters = [
    { v: "ALL", label: "All", count: counts.ALL, active: "bg-foreground text-background" },
    { v: "AVAILABLE", label: "Seeking", count: counts.AVAILABLE, active: "bg-cyan-600 text-white" },
    { v: "CRITICAL", label: "Critical", count: counts.CRITICAL, active: "bg-red-600 text-white" },
    { v: "FOSTERED", label: "Fostered", count: counts.FOSTERED, active: "bg-amber-500 text-white" },
    { v: "ADOPTED", label: "Adopted", count: counts.ADOPTED, active: "bg-emerald-600 text-white" },
  ];

  return (
    <div>
      <h2 className="text-lg font-bold tracking-tight">Animals ready for sponsorship &amp; adoption</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Vaccinated, sterilised, and fed by trained volunteers. Sponsor food monthly or open your
        home.
      </p>

      <div className="mt-4 flex flex-wrap items-center gap-2" role="group" aria-label="Filter animals by status">
        {filters.map((f) => (
          <button
            key={f.v}
            onClick={() => {
              setFilter(f.v);
              setPage(1);
            }}
            aria-pressed={filter === f.v}
            className={cn(
              "inline-flex min-h-[32px] items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold transition",
              filter === f.v ? f.active : "bg-muted text-muted-foreground hover:bg-accent hover:text-foreground"
            )}
          >
            {f.label}
            <span
              className={cn(
                "rounded-full px-1.5 py-px text-[10px] font-bold",
                filter === f.v ? "bg-white/25" : "bg-background"
              )}
            >
              {f.count}
            </span>
          </button>
        ))}
      </div>

      {animals === null ? (
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 2xl:grid-cols-8">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-52 rounded-xl" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={Dog}
          title="No animals listed right now"
          hint="Our rescue partners are updating the board. Sponsor the general food fund meanwhile."
          className="mt-4"
          action={
            <Button asChild className="bg-lime-600 hover:bg-lime-700">
              <Link href="/donate?campaign=animal-welfare">Fund animal food</Link>
            </Button>
          }
        />
      ) : (
        <>
          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 2xl:grid-cols-8">
            {paged.map((an) => (
              <Card
                key={an.id}
                className={cn(
                  "flex flex-col gap-2 p-3 transition-all hover:-translate-y-0.5 hover:shadow-md",
                  CARD_TINT[an.status] ?? ""
                )}
              >
                <div className="flex items-center justify-between gap-1">
                  <span
                    className={cn(
                      "flex size-8 shrink-0 items-center justify-center rounded-full",
                      AVATAR_TINT[an.status] ?? ""
                    )}
                    aria-hidden
                  >
                    {speciesIcon(an.species)}
                  </span>
                  <span className="flex items-center gap-1">
                    {an.status === "CRITICAL" && (
                      <Badge className="border-0 bg-red-500 px-1 py-0 text-[9px] font-bold text-white">
                        URGENT
                      </Badge>
                    )}
                    <Badge
                      className={cn(
                        "border-0 px-1.5 text-[9px] hover:opacity-90",
                        ANIMAL_STATUS[an.status] ?? "bg-muted text-muted-foreground"
                      )}
                    >
                      {STATUS_LABEL[an.status] ?? titleCase(an.status)}
                    </Badge>
                  </span>
                </div>
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold">{an.name}</p>
                  <p className="truncate text-[11px] text-muted-foreground">
                    {ageLabel(an.ageMonths)} · {titleCase(an.gender)} · {an.location}
                  </p>
                </div>
                <div className="flex flex-wrap gap-1">
                  {an.vaccinated && (
                    <Badge variant="outline" className="gap-1 px-1.5 py-0 text-[9px]">
                      <Syringe className="size-2.5" aria-hidden /> Vaccinated
                    </Badge>
                  )}
                  {an.sterilized && (
                    <Badge variant="outline" className="gap-1 px-1.5 py-0 text-[9px]">
                      <Check className="size-2.5" aria-hidden /> Sterilised
                    </Badge>
                  )}
                </div>
                <div className="mt-auto">
                  <p className="leading-none">
                    <span className="text-base font-bold text-lime-600 dark:text-lime-400">
                      {formatINR(an.monthlyFood)}
                    </span>
                    <span className="text-[10px] text-muted-foreground">/mo food</span>
                  </p>
                </div>
                <Button
                  size="sm"
                  className="h-8 w-full bg-lime-600 text-white hover:bg-lime-700"
                  onClick={() => setSponsoring(an)}
                  disabled={an.status === "ADOPTED"}
                >
                  {an.status === "ADOPTED" ? (
                    <><Check className="size-3.5" aria-hidden /> Adopted</>
                  ) : (
                    <><Heart className="size-3.5" aria-hidden /> Sponsor food</>
                  )}
                </Button>
              </Card>
            ))}
          </div>

          {totalPages > 1 && (
            <Pagination className="mt-5">
              <PaginationContent>
                <PaginationItem>
                  <PaginationPrevious
                    href="#"
                    aria-disabled={currentPage === 1}
                    className={currentPage === 1 ? "pointer-events-none opacity-40" : undefined}
                    onClick={(e) => {
                      e.preventDefault();
                      if (currentPage > 1) setPage(currentPage - 1);
                    }}
                  />
                </PaginationItem>
                {Array.from({ length: totalPages }, (_, i) => i + 1).map((n) => (
                  <PaginationItem key={n}>
                    <PaginationLink
                      href="#"
                      isActive={n === currentPage}
                      onClick={(e) => {
                        e.preventDefault();
                        setPage(n);
                      }}
                    >
                      {n}
                    </PaginationLink>
                  </PaginationItem>
                ))}
                <PaginationItem>
                  <PaginationNext
                    href="#"
                    aria-disabled={currentPage === totalPages}
                    className={currentPage === totalPages ? "pointer-events-none opacity-40" : undefined}
                    onClick={(e) => {
                      e.preventDefault();
                      if (currentPage < totalPages) setPage(currentPage + 1);
                    }}
                  />
                </PaginationItem>
              </PaginationContent>
            </Pagination>
          )}
        </>
      )}

      <SponsorDialog animal={sponsoring} onClose={() => setSponsoring(null)} onDone={load} />
    </div>
  );
}

function speciesIconSafe(species: string) {
  if (species === "DOG") return <Dog className="size-5" aria-hidden />;
  return <PawGlyph className="size-5" />;
}

function PawGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden>
      <ellipse cx="6" cy="9" rx="2" ry="2.6" />
      <ellipse cx="18" cy="9" rx="2" ry="2.6" />
      <ellipse cx="10" cy="5.5" rx="2" ry="2.6" />
      <ellipse cx="14" cy="5.5" rx="2" ry="2.6" />
      <path d="M12 11c-3.5 0-6.5 3.2-6.5 6 0 1.8 1.4 3 3.2 3 1.2 0 2.1-.5 3.3-.5s2.1.5 3.3.5c1.8 0 3.2-1.2 3.2-3 0-2.8-3-6-6.5-6z" />
    </svg>
  );
}

function SponsorDialog({
  animal,
  onClose,
  onDone,
}: {
  animal: Animal | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const [step, setStep] = useState(1);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const reduceMotion = useReducedMotion();

  useEffect(() => {
    if (animal) {
      setStep(1);
      setName("");
      setBusy(false);
    }
  }, [animal]);

  const submit = async () => {
    if (!animal) return;
    if (!name.trim()) {
      toast.error("Please enter your name");
      return;
    }
    setBusy(true);
    try {
      await post("/api/animals/pledges", {
        animalId: animal.id,
        kind: "FOOD",
        amount: animal.monthlyFood,
        frequency: "MONTHLY",
        donorName: name.trim(),
      });
      onDone();
      setStep(3);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not create sponsorship");
    } finally {
      setBusy(false);
    }
  };

  const STEPS = [
    { n: 1, label: "How it works" },
    { n: 2, label: "Confirm" },
  ];

  if (!animal) {
    return <FormSheet open={false} onOpenChange={onClose} title="Sponsor food" size="half" />;
  }

  return (
    <FormSheet
      open
      onOpenChange={(o) => !o && onClose()}
      title={`Sponsor food for ${animal.name}`}
      description={`${titleCase(animal.species)} · ${animal.location}`}
      size="half"
      badge={
        <Badge
          className={cn(
            "border-0 text-[10px] hover:opacity-90",
            ANIMAL_STATUS[animal.status] ?? "bg-muted text-muted-foreground"
          )}
        >
          {titleCase(animal.status)}
        </Badge>
      }
      footer={
        step === 3 ? (
          <div className="flex w-full justify-end">
            <Button className="bg-lime-600 hover:bg-lime-700" onClick={onClose}>
              Done
            </Button>
          </div>
        ) : (
          <>
            <p className="hidden text-xs text-muted-foreground sm:block">
              Step {step} of 2 — {STEPS[step - 1].label}
            </p>
            <div className="flex shrink-0 items-center gap-2">
              {step > 1 && (
                <Button type="button" variant="ghost" onClick={() => setStep(step - 1)} disabled={busy}>
                  <ArrowLeft className="size-4" aria-hidden /> Back
                </Button>
              )}
              {step < 2 ? (
                <Button type="button" onClick={() => setStep(2)} className="bg-lime-600 hover:bg-lime-700">
                  Continue <ArrowRight className="size-4" aria-hidden />
                </Button>
              ) : (
                <Button type="button" onClick={submit} disabled={busy} className="bg-lime-600 hover:bg-lime-700">
                  <Heart className="size-4" aria-hidden />
                  {busy ? "Sponsoring…" : "Confirm sponsorship"}
                </Button>
              )}
            </div>
          </>
        )
      }
    >
      {/* Animal banner */}
      <div className="-mx-6 -mt-5 flex items-center gap-3 bg-lime-600 px-6 py-4 text-white">
        <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-white/15 ring-1 ring-white/25">
          {speciesIconSafe(animal.species)}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-bold">{animal.name}</p>
          <p className="truncate text-xs text-white/80">
            {titleCase(animal.species)} · {animal.location}
          </p>
        </div>
        <div className="shrink-0 text-right">
          <p className="text-lg font-extrabold leading-none">{formatINR(animal.monthlyFood)}</p>
          <p className="text-[10px] text-white/75">per month</p>
        </div>
      </div>

      {step < 3 ? (
        <>
          {/* Stepper */}
          <nav aria-label="Sponsorship steps">
            <div className="flex items-center gap-1">
              {STEPS.map((st, i) => {
                const done = step > st.n;
                const active = step === st.n;
                return (
                  <React.Fragment key={st.n}>
                    {i > 0 && (
                      <span
                        className={cn(
                          "h-px flex-1 transition-colors",
                          done ? "bg-lime-500" : "bg-border"
                        )}
                      />
                    )}
                    <span
                      className={cn(
                        "flex items-center gap-1.5 text-xs",
                        active ? "font-semibold text-foreground" : "text-muted-foreground"
                      )}
                    >
                      <span
                        className={cn(
                          "flex size-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold transition",
                          done
                            ? "bg-lime-600 text-white"
                            : active
                              ? "bg-lime-500/15 text-lime-600 ring-2 ring-lime-500/40 dark:text-lime-400"
                              : "bg-muted text-muted-foreground"
                        )}
                      >
                        {done ? <Check className="size-3.5" aria-hidden /> : st.n}
                      </span>
                      <span className="hidden sm:inline">{st.label}</span>
                    </span>
                  </React.Fragment>
                );
              })}
            </div>
          </nav>

          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={step}
              initial={reduceMotion ? false : { opacity: 0, x: 24 }}
              animate={{ opacity: 1, x: 0 }}
              exit={reduceMotion ? undefined : { opacity: 0, x: -24 }}
              transition={{ duration: 0.2 }}
            >
              {step === 1 && (
                <ul className="space-y-3">
                  {[
                    {
                      icon: Heart,
                      title: "You sponsor food, monthly",
                      desc: `${formatINR(animal.monthlyFood)}/mo covers this animal's verified diet.`,
                    },
                    {
                      icon: Dog,
                      title: "Volunteers feed & log",
                      desc: "Trained volunteers buy from verified suppliers and log every feeding.",
                    },
                    {
                      icon: Landmark,
                      title: "80G receipt, instantly",
                      desc: "Monthly sponsors receive photo updates; every pledge is receipted.",
                    },
                  ].map((h) => (
                    <li key={h.title} className="flex items-start gap-3">
                      <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-lime-500/10 text-lime-600 dark:text-lime-400">
                        <h.icon className="size-4.5" aria-hidden />
                      </span>
                      <div>
                        <p className="text-sm font-semibold">{h.title}</p>
                        <p className="text-xs leading-relaxed text-muted-foreground">{h.desc}</p>
                      </div>
                    </li>
                  ))}
                </ul>
              )}

              {step === 2 && (
                <div className="space-y-4">
                  <div className="space-y-1.5">
                    <Label htmlFor="sponsor-name">Your name</Label>
                    <Input
                      id="sponsor-name"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="As you'd like to be known"
                    />
                  </div>

                  <div className="rounded-xl border bg-muted/40 p-4 text-sm">
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Sponsorship summary
                    </p>
                    <dl className="mt-2 space-y-1.5">
                      <div className="flex justify-between gap-2">
                        <dt className="text-muted-foreground">Animal</dt>
                        <dd className="truncate font-semibold">{animal.name}</dd>
                      </div>
                      <div className="flex justify-between gap-2">
                        <dt className="text-muted-foreground">Monthly food</dt>
                        <dd className="font-semibold">{formatINR(animal.monthlyFood)}</dd>
                      </div>
                      <div className="flex justify-between gap-2 border-t pt-1.5">
                        <dt className="font-semibold">Billed monthly</dt>
                        <dd className="font-extrabold text-lime-700 dark:text-lime-400">
                          Cancel anytime
                        </dd>
                      </div>
                    </dl>
                  </div>
                </div>
              )}
            </motion.div>
          </AnimatePresence>
        </>
      ) : (
        /* ---------------- SUCCESS ---------------- */
        <div className="flex flex-col items-center py-8 text-center">
          <motion.span
            initial={reduceMotion ? false : { scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ type: "spring", stiffness: 260, damping: 18, delay: 0.1 }}
            className="flex size-16 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
          >
            <CheckCircle2 className="size-9" aria-hidden />
          </motion.span>
          <h3 className="mt-4 text-lg font-bold">Food sponsored</h3>
          <p className="mt-1 max-w-sm text-sm leading-relaxed text-muted-foreground">
            Thank you — you&rsquo;re feeding{" "}
            <span className="font-semibold text-foreground">{animal.name}</span> this month (
            {formatINR(animal.monthlyFood)}). Photo updates every month.
          </p>
        </div>
      )}
    </FormSheet>
  );
}
