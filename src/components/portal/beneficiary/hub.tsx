"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Baby,
  HandHeart,
  HeartHandshake,
  LifeBuoy,
  Package,
  PackageOpen,
  PawPrint,
  Phone,
  Pill,
  Send,
  Shield,
  ShieldAlert,
  Siren,
  Trash2,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { toast } from "sonner";
import { useMasters, labelOf } from "@/hooks/use-masters";
import type { SessionUser } from "@/hooks/use-auth";
import { get, post } from "@/lib/api-client";
import { navigate } from "@/lib/router";
import { formatDate, titleCase } from "@/lib/format";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/shared/page-header";
import { SectionCard } from "@/components/shared/section-card";
import { EmptyState } from "@/components/shared/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";

/* Official helplines — numbers per CONVENTIONS.md */
const HELPLINES: { num: string; label: string; desc: string }[] = [
  { num: "112", label: "Emergency", desc: "Police · Fire · National" },
  { num: "108", label: "Ambulance", desc: "Free emergency response" },
  { num: "1098", label: "Child safety", desc: "CHILDLINE 24×7" },
  { num: "181", label: "Women safety", desc: "Sakhi / Abhayam support" },
];

const URGENCIES = [
  { value: "LOW", label: "Can wait a few days" },
  { value: "MEDIUM", label: "Within this week" },
  { value: "HIGH", label: "Urgent — this affects us now" },
  { value: "CRITICAL", label: "Critical — need help today" },
] as const;

interface SavedRequest {
  id: string;
  category: string;
  categoryLabel: string;
  urgency: string;
  message: string;
  phone?: string;
  createdAt: string;
}

interface BeneficiaryRow {
  id: string;
  name: string;
  category: string;
  urgencyLevel: string;
  familyMembers?: number;
  city?: string | null;
  userId?: string | null;
  email?: string | null;
}

interface Distribution {
  id: string;
  type: string;
  quantity: number;
  beneficiaryId?: string | null;
  location?: string | null;
  distributedAt: string;
}

const PROGRAMMES: {
  key: string;
  title: string;
  desc: string;
  icon: LucideIcon;
  iconClass: string;
  borderClass: string;
}[] = [
  {
    key: "ration",
    title: "Ration kits",
    desc: "Monthly groceries for families in distress — QR-tracked from our store to your door.",
    icon: Package,
    iconClass: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
    borderClass: "hover:border-emerald-500/40",
  },
  {
    key: "medicine",
    title: "Adopt-a-Medicine",
    desc: "Donors fund monthly medicines for BP, diabetes and cardiac patients — you never skip a dose.",
    icon: Pill,
    iconClass: "bg-teal-500/15 text-teal-700 dark:text-teal-400",
    borderClass: "hover:border-teal-500/40",
  },
  {
    key: "women",
    title: "Women safety",
    desc: "Sakhi desks, self-defence drives and the 181 Abhayam network across Bengaluru.",
    icon: Shield,
    iconClass: "bg-fuchsia-500/15 text-fuchsia-700 dark:text-fuchsia-400",
    borderClass: "hover:border-fuchsia-500/40",
  },
  {
    key: "child",
    title: "Child safety",
    desc: "CHILDLINE outreach, school awareness and safe-space programmes for children.",
    icon: Baby,
    iconClass: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
    borderClass: "hover:border-amber-500/40",
  },
  {
    key: "animals",
    title: "Animal welfare",
    desc: "Rescue, vaccination and sterilisation drives for street animals with our shelter partners.",
    icon: PawPrint,
    iconClass: "bg-lime-500/15 text-lime-700 dark:text-lime-400",
    borderClass: "hover:border-lime-500/40",
  },
  {
    key: "green-corridor",
    title: "Green corridor",
    desc: "Ambulances with smart traffic corridors reach hospitals minutes faster in emergencies.",
    icon: Siren,
    iconClass: "bg-red-500/15 text-red-700 dark:text-red-400",
    borderClass: "hover:border-red-500/40",
  },
  {
    key: "anti-drug",
    title: "Anti-drug outreach",
    desc: "Confidential de-addiction counselling, 14446 referrals and community awareness.",
    icon: ShieldAlert,
    iconClass: "bg-orange-500/15 text-orange-700 dark:text-orange-400",
    borderClass: "hover:border-orange-500/40",
  },
];

function storageKey(userId: string) {
  return `uar-beneficiary-requests-${userId}`;
}

function loadRequests(userId: string): SavedRequest[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(storageKey(userId));
    const parsed = raw ? (JSON.parse(raw) as SavedRequest[]) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveRequests(userId: string, list: SavedRequest[]) {
  try {
    window.localStorage.setItem(storageKey(userId), JSON.stringify(list.slice(0, 10)));
  } catch {
    // storage full/blocked — non-fatal
  }
}

export default function BeneficiaryHub({ user }: { user: SessionUser }) {
  const { options: categoryOptions } = useMasters("BENEFICIARY_CATEGORY");

  const [category, setCategory] = useState("");
  const [urgency, setUrgency] = useState("MEDIUM");
  const [message, setMessage] = useState("");
  const [phone, setPhone] = useState(user.phone ?? "");
  const [submitting, setSubmitting] = useState(false);

  const [requests, setRequests] = useState<SavedRequest[]>([]);
  const [caseRow, setCaseRow] = useState<BeneficiaryRow | null>(null);
  const [received, setReceived] = useState<Distribution[]>([]);
  const [loadingCase, setLoadingCase] = useState(true);

  useEffect(() => {
    setRequests(loadRequests(user.id));
  }, [user.id]);

  const loadCase = useCallback(async () => {
    setLoadingCase(true);
    try {
      const rows = await get<unknown>("/api/beneficiaries?mine=1").catch(() => []);
      const list = Array.isArray(rows) ? (rows as BeneficiaryRow[]) : [];
      const mine =
        list.find((r) => r.userId === user.id) ??
        list.find(
          (r) => r.email && user.email && r.email.toLowerCase() === user.email.toLowerCase()
        ) ??
        null;
      setCaseRow(mine);
      if (mine) {
        const dists = await get<unknown>("/api/distributions?limit=200").catch(() => []);
        const list2 = Array.isArray(dists) ? (dists as Distribution[]) : [];
        setReceived(list2.filter((d) => d.beneficiaryId === mine.id).slice(0, 10));
      }
    } finally {
      setLoadingCase(false);
    }
  }, [user.id, user.email]);

  useEffect(() => {
    loadCase();
  }, [loadCase]);

  const submit = async () => {
    if (!category) {
      toast.error("Pick the kind of help you need");
      return;
    }
    if (message.trim().length < 10) {
      toast.error("Please describe your need in at least 10 characters");
      return;
    }
    const categoryLabel = labelOf(categoryOptions, category);
    setSubmitting(true);
    try {
      const created = await post<{ id?: string }>("/api/contact-queries", {
        name: user.name,
        email: user.email,
        phone: phone.trim() || user.phone || undefined,
        subject: `Help request — ${categoryLabel} (${titleCase(urgency)})`,
        message: `[${categoryLabel} · urgency ${titleCase(urgency)}] ${message.trim()}`,
      });
      const entry: SavedRequest = {
        id: created?.id ?? `${Date.now()}`,
        category,
        categoryLabel,
        urgency,
        message: message.trim(),
        phone: phone.trim() || undefined,
        createdAt: new Date().toISOString(),
      };
      const next = [entry, ...requests];
      setRequests(next);
      saveRequests(user.id, next);
      toast.success(
        "Request received — our case team will call you within 48 hours. Keep your phone nearby."
      );
      setCategory("");
      setUrgency("MEDIUM");
      setMessage("");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not send your request");
    } finally {
      setSubmitting(false);
    }
  };

  const removeRequest = (id: string) => {
    const next = requests.filter((r) => r.id !== id);
    setRequests(next);
    saveRequests(user.id, next);
  };

  return (
    <div className="space-y-6">
      {/* Welcome */}
      <PageHeader
        title={`Namaste, ${user.name.split(" ")[0]}`}
        description="We're here for you — no judgement, only help. United Angel Reach supports families with ration kits, medicines, women & child safety, animal rescue and emergency ambulance corridors."
        icon={<HeartHandshake className="size-5" />}
      />

      {/* Case record */}
      <SectionCard
        title="Your case record"
        description="How our team has you registered"
        icon={<HandHeart className="size-5" />}
      >
        {loadingCase ? (
          <div className="space-y-2">
            <Skeleton className="h-5 w-52" />
            <Skeleton className="h-5 w-72" />
          </div>
        ) : caseRow ? (
          <div className="space-y-2 text-sm">
            <p>
              <span className="text-muted-foreground">Registered as </span>
              <span className="font-semibold">{caseRow.name}</span>
              <span className="text-muted-foreground">
                {" "}
                · {labelOf(categoryOptions, caseRow.category) ?? titleCase(caseRow.category)}
                {caseRow.city ? ` · ${caseRow.city}` : ""}
              </span>
            </p>
            <p className="flex items-center gap-2">
              <span className="text-muted-foreground">Urgency on file:</span>
              <Badge
                variant="outline"
                className={cn(
                  "rounded-full text-[10px]",
                  (caseRow.urgencyLevel === "HIGH" || caseRow.urgencyLevel === "CRITICAL")
                    ? "border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-400"
                    : "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400"
                )}
              >
                {titleCase(caseRow.urgencyLevel)}
              </Badge>
            </p>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            Your case record isn&apos;t linked to this login yet — that&apos;s okay.
            Send a request below and our team will register and call you within 48
            hours.
          </p>
        )}
      </SectionCard>

      {/* Support received */}
      <SectionCard
        title="Support you've received"
        description="Distributions recorded for your family"
        icon={<PackageOpen className="size-5" />}
      >
        {loadingCase ? (
          <div className="space-y-3">
            <Skeleton className="h-12 w-full rounded-lg" />
          </div>
        ) : !caseRow || received.length === 0 ? (
          <EmptyState
            icon={<PackageOpen className="size-5" />}
            title={caseRow ? "Nothing recorded yet" : "Linked after your first delivery"}
            hint={
              caseRow
                ? "When a volunteer hands over a kit or support to your family, it shows up here."
                : "Once our team links your case, every delivery you receive is listed here."
            }
          />
        ) : (
          <ul className="divide-y">
            {received.map((d) => (
              <li key={d.id} className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <PackageOpen className="size-4" aria-hidden="true" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">{titleCase(d.type)} support</p>
                  <p className="text-xs text-muted-foreground">
                    {formatDate(d.distributedAt)}
                    {d.location ? ` · ${d.location}` : ""}
                  </p>
                </div>
                <p className="text-sm font-bold">×{d.quantity}</p>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>

      {/* Need help form */}
      <SectionCard
        title="Need help?"
        description="Tell us what you need — a case worker calls you back within 48 hours. There is no fee and no paperwork needed to ask."
        icon={<HandHeart className="size-5" />}
      >
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="bh-category">What kind of help?</Label>
              <Select value={category} onValueChange={setCategory}>
                <SelectTrigger id="bh-category" className="w-full">
                  <SelectValue placeholder="Select the kind of support" />
                </SelectTrigger>
                <SelectContent>
                  {categoryOptions.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="bh-urgency">How urgent is it?</Label>
              <Select value={urgency} onValueChange={setUrgency}>
                <SelectTrigger id="bh-urgency" className="w-full">
                  <SelectValue placeholder="Select urgency" />
                </SelectTrigger>
                <SelectContent>
                  {URGENCIES.map((u) => (
                    <SelectItem key={u.value} value={u.value}>
                      {u.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="bh-phone">Contact phone</Label>
              <Input
                id="bh-phone"
                type="tel"
                inputMode="tel"
                placeholder="+91 98765 43210"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                autoComplete="tel"
              />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="bh-message">Describe your need</Label>
              <Textarea
                id="bh-message"
                rows={4}
                placeholder="e.g. Family of four in BTM Layout, lost daily-wage income this month, need ration support…"
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                aria-describedby="bh-privacy"
              />
              <p id="bh-privacy" className="text-xs text-muted-foreground">
                Only our case team reads this. We never share your details publicly.
              </p>
            </div>
          </div>
          <Button className="min-h-11 gap-1.5" onClick={submit} disabled={submitting}>
            <Send className="size-4" aria-hidden="true" />
            {submitting ? "Sending…" : "Send request"}
          </Button>
        </div>
      </SectionCard>

      {/* My requests */}
      <SectionCard
        title="My requests"
        description="Sent from this device — our team updates you by phone"
        icon={<Send className="size-5" />}
      >
        {requests.length === 0 ? (
          <EmptyState
            icon={<Send className="size-5" />}
            title="No requests yet"
            hint="Whenever you send one above, it's listed here so you can track what you asked for."
          />
        ) : (
          <ul className="divide-y">
            {requests.map((r) => (
              <li key={r.id} className="flex items-start gap-3 py-3 first:pt-0 last:pb-0">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-medium">{r.categoryLabel}</p>
                    <Badge
                      variant="outline"
                      className="rounded-full border-amber-500/30 bg-amber-500/10 text-[10px] text-amber-700 dark:text-amber-400"
                    >
                      With our team
                    </Badge>
                    <span className="text-[11px] text-muted-foreground">
                      {formatDate(r.createdAt)} · urgency {titleCase(r.urgency)}
                    </span>
                  </div>
                  <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
                    {r.message}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-11 shrink-0 text-muted-foreground hover:text-red-600 dark:hover:text-red-400"
                  onClick={() => removeRequest(r.id)}
                  aria-label={`Remove request from ${formatDate(r.createdAt)} from this list`}
                >
                  <Trash2 className="size-4" aria-hidden="true" />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>

      {/* Helplines */}
      <section aria-label="Emergency helplines">
        <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          <LifeBuoy className="size-4" aria-hidden="true" /> Tap to call — free
          national helplines
        </h2>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {HELPLINES.map((h) => (
            <a
              key={h.num}
              href={`tel:${h.num}`}
              className="group flex min-h-11 flex-col gap-0.5 rounded-xl border bg-card p-4 shadow-sm outline-none transition hover:border-primary/40 hover:shadow-md focus-visible:ring-2 focus-visible:ring-ring"
              aria-label={`Call ${h.label} on ${h.num}`}
            >
              <span className="flex items-center gap-2">
                <Phone
                  className="size-4 text-primary transition-transform group-hover:scale-110"
                  aria-hidden="true"
                />
                <span className="text-xl font-bold tabular-nums">{h.num}</span>
              </span>
              <span className="text-sm font-medium">{h.label}</span>
              <span className="text-xs text-muted-foreground">{h.desc}</span>
            </a>
          ))}
        </div>
      </section>

      {/* Programmes */}
      <section aria-label="UAR programmes">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          How we can help
        </h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {PROGRAMMES.map((p) => {
            const Icon = p.icon;
            return (
              <button
                key={p.key}
                type="button"
                onClick={() => navigate("/campaigns")}
                aria-label={`Learn about ${p.title}`}
                className={`group flex min-h-11 flex-col gap-2 rounded-xl border bg-card p-5 text-left shadow-sm outline-none transition hover:shadow-md focus-visible:ring-2 focus-visible:ring-ring ${p.borderClass}`}
              >
                <span className={`flex size-10 items-center justify-center rounded-lg ${p.iconClass}`}>
                  <Icon className="size-5" aria-hidden="true" />
                </span>
                <span className="text-sm font-semibold">{p.title}</span>
                <span className="text-xs leading-relaxed text-muted-foreground">{p.desc}</span>
                <span className="pt-1 text-xs font-medium text-primary">See campaigns</span>
              </button>
            );
          })}
        </div>
      </section>
    </div>
  );
}
