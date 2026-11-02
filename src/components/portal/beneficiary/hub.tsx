"use client";

import { useState } from "react";
import {
  Baby,
  HeartHandshake,
  LifeBuoy,
  Package,
  PawPrint,
  Phone,
  Pill,
  Send,
  Siren,
  Shield,
  ShieldAlert,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { toast } from "sonner";
import type { SessionUser } from "@/hooks/use-auth";
import { post } from "@/lib/api-client";
import { navigate } from "@/lib/router";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

/* Official helplines — numbers per CONVENTIONS.md */
const HELPLINES: { num: string; label: string; desc: string }[] = [
  { num: "112", label: "Emergency", desc: "Police · Fire · National" },
  { num: "108", label: "Ambulance", desc: "Free emergency response" },
  { num: "1930", label: "Cyber fraud", desc: "Financial fraud helpline" },
  { num: "181", label: "Women safety", desc: "Sakhi / Abhayam support" },
  { num: "1098", label: "Child safety", desc: "CHILDLINE 24×7" },
  { num: "14446", label: "De-addiction", desc: "Drug & substance help" },
  { num: "1962", label: "Animal rescue", desc: "AWBI injured-animal line" },
];

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
    iconClass: "bg-emerald-100 text-emerald-700",
    borderClass: "hover:border-emerald-300",
  },
  {
    key: "medicine",
    title: "Adopt-a-Medicine",
    desc: "Donors fund monthly medicines for BP, diabetes and cardiac patients — you never skip a dose.",
    icon: Pill,
    iconClass: "bg-teal-100 text-teal-700",
    borderClass: "hover:border-teal-300",
  },
  {
    key: "women",
    title: "Women safety",
    desc: "Sakhi desks, self-defence drives and the 181 Abhayam network across Bengaluru.",
    icon: Shield,
    iconClass: "bg-fuchsia-100 text-fuchsia-700",
    borderClass: "hover:border-fuchsia-300",
  },
  {
    key: "child",
    title: "Child safety",
    desc: "CHILDLINE outreach, school awareness and safe-space programmes for children.",
    icon: Baby,
    iconClass: "bg-amber-100 text-amber-700",
    borderClass: "hover:border-amber-300",
  },
  {
    key: "animals",
    title: "Animal welfare",
    desc: "Rescue, vaccination and sterilisation drives for street animals with our shelter partners.",
    icon: PawPrint,
    iconClass: "bg-lime-100 text-lime-700",
    borderClass: "hover:border-lime-300",
  },
  {
    key: "green-corridor",
    title: "Green corridor",
    desc: "Ambulances with smart traffic corridors reach hospitals minutes faster in emergencies.",
    icon: Siren,
    iconClass: "bg-red-100 text-red-700",
    borderClass: "hover:border-red-300",
  },
  {
    key: "anti-drug",
    title: "Anti-drug outreach",
    desc: "Confidential de-addiction counselling, 14446 referrals and community awareness.",
    icon: ShieldAlert,
    iconClass: "bg-orange-100 text-orange-700",
    borderClass: "hover:border-orange-300",
  },
];

const SUBJECTS = [
  "Ration support",
  "Medicine support",
  "Women safety",
  "Child safety",
  "Animal help",
  "Other",
] as const;

export default function BeneficiaryHub({ user }: { user: SessionUser }) {
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    if (!subject) {
      toast.error("Pick what kind of help you need");
      return;
    }
    if (message.trim().length < 10) {
      toast.error("Please describe your need in at least 10 characters");
      return;
    }
    setSubmitting(true);
    try {
      await post("/api/contact-queries", {
        name: user.name,
        email: user.email,
        phone: user.phone || undefined,
        subject,
        message: message.trim(),
      });
      toast.success("Request received — our team will reach out within 48 hours");
      setSubject("");
      setMessage("");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not send your request");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Welcome */}
      <Card className="overflow-hidden border-primary/20 bg-gradient-to-br from-pink-50 via-background to-emerald-50/60 p-0">
        <CardContent className="p-6 sm:p-8">
          <span className="flex size-12 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <HeartHandshake className="size-6" aria-hidden="true" />
          </span>
          <h1 className="mt-4 text-2xl font-bold tracking-tight sm:text-3xl">
            Namaste, {user.name.split(" ")[0]}
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground sm:text-base">
            <span className="font-semibold text-foreground">How we can help — </span>
            United Angel Reach supports families with ration kits, medicines,
            women &amp; child safety, animal rescue and emergency ambulance
            corridors. Call a helpline below or send a request — it goes straight
            to our case team.
          </p>
        </CardContent>
      </Card>

      {/* Helplines */}
      <section aria-label="Emergency helplines">
        <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          <LifeBuoy className="size-4" aria-hidden="true" /> Tap to call — free
          helplines
        </h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
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

      {/* Request help */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Request help</CardTitle>
          <CardDescription>
            Tell us what you need — a case worker calls you back within 48 hours.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="bh-subject">What do you need?</Label>
            <Select value={subject} onValueChange={setSubject}>
              <SelectTrigger id="bh-subject" className="w-full">
                <SelectValue placeholder="Select the kind of support" />
              </SelectTrigger>
              <SelectContent>
                {SUBJECTS.map((s) => (
                  <SelectItem key={s} value={s}>
                    {s}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="bh-message">Describe your situation</Label>
            <Textarea
              id="bh-message"
              rows={4}
              placeholder="e.g. Family of four in BTM Layout, lost daily-wage income this month, need ration support…"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
            />
          </div>
          <p className="text-xs text-muted-foreground">
            Request will be sent as <span className="font-medium">{user.name}</span>{" "}
            ({user.email}).
          </p>
          <Button
            className="min-h-11 gap-1.5"
            onClick={submit}
            disabled={submitting}
          >
            <Send className="size-4" aria-hidden="true" />
            {submitting ? "Sending…" : "Send request"}
          </Button>
        </CardContent>
      </Card>

      {/* Programmes */}
      <section aria-label="UAR programmes">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Our programmes
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
                <span
                  className={`flex size-10 items-center justify-center rounded-lg ${p.iconClass}`}
                >
                  <Icon className="size-5" aria-hidden="true" />
                </span>
                <span className="text-sm font-semibold">{p.title}</span>
                <span className="text-xs leading-relaxed text-muted-foreground">
                  {p.desc}
                </span>
                <span className="pt-1 text-xs font-medium text-primary">
                  See campaigns
                </span>
              </button>
            );
          })}
        </div>
      </section>
    </div>
  );
}
