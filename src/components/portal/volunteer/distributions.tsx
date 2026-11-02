"use client";

import { useCallback, useEffect, useState } from "react";
import { PackageOpen, Plus, Send, Users } from "lucide-react";
import { toast } from "sonner";
import type { SessionUser } from "@/hooks/use-auth";
import type { VolunteerProfile } from "../portal-router";
import { get, post } from "@/lib/api-client";
import { timeAgo, titleCase } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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

interface Beneficiary {
  id: string;
  name: string;
  city?: string | null;
}

interface Distribution {
  id: string;
  type: string;
  quantity: number;
  location?: string | null;
  notes?: string | null;
  distributedAt: string;
  beneficiary?: { name: string } | null;
}

function asArray<T>(data: unknown): T[] {
  if (Array.isArray(data)) return data as T[];
  if (data && typeof data === "object" && Array.isArray((data as { data?: unknown }).data))
    return (data as { data: T[] }).data;
  return [];
}

const TYPES = [
  "FOOD",
  "SANITARY_PADS",
  "MEDICAL",
  "ANIMAL_FEED",
  "CLOTHING",
  "OTHER",
] as const;

const TYPE_STYLES: Record<string, string> = {
  FOOD: "border-emerald-200 bg-emerald-50 text-emerald-700",
  SANITARY_PADS: "border-pink-200 bg-pink-50 text-pink-700",
  MEDICAL: "border-teal-200 bg-teal-50 text-teal-700",
  ANIMAL_FEED: "border-lime-200 bg-lime-50 text-lime-700",
  CLOTHING: "border-amber-200 bg-amber-50 text-amber-700",
  OTHER: "border-zinc-200 bg-zinc-50 text-zinc-600",
};

export default function VolunteerDistributions(_props: {
  user: SessionUser;
  volunteer?: VolunteerProfile | null;
}) {
  const [beneficiaries, setBeneficiaries] = useState<Beneficiary[]>([]);
  const [history, setHistory] = useState<Distribution[]>([]);
  const [loading, setLoading] = useState(true);

  // Form
  const [type, setType] = useState("FOOD");
  const [beneficiaryId, setBeneficiaryId] = useState("walk-in");
  const [quantity, setQuantity] = useState("1");
  const [location, setLocation] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [b, h] = await Promise.all([
        get<unknown>("/api/beneficiaries").catch(() => []),
        get<unknown>("/api/distributions?mine=1"),
      ]);
      setBeneficiaries(asArray<Beneficiary>(b).slice(0, 200));
      setHistory(asArray<Distribution>(h));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not load distributions");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const submit = async () => {
    const qty = Number(quantity);
    if (!Number.isFinite(qty) || qty < 1) {
      toast.error("Quantity must be at least 1");
      return;
    }
    setSubmitting(true);
    try {
      await post("/api/distributions", {
        type,
        beneficiaryId: beneficiaryId === "walk-in" ? undefined : beneficiaryId,
        quantity: Math.round(qty),
        location: location.trim() || undefined,
        notes: notes.trim() || undefined,
      });
      toast.success("Distribution recorded — thank you for being on ground!");
      setType("FOOD");
      setBeneficiaryId("walk-in");
      setQuantity("1");
      setLocation("");
      setNotes("");
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not record distribution");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold tracking-tight sm:text-2xl">
          Distributions
        </h1>
        <p className="text-sm text-muted-foreground">
          Log every handover — it feeds the impact dashboard in real time.
        </p>
      </div>

      {/* ---------- Record a distribution ---------- */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Plus className="size-4 text-primary" aria-hidden="true" />
            Record a distribution
          </CardTitle>
          <CardDescription>
            Kits, pads, medicines or feed — record it as soon as it&apos;s handed over.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="dist-type">What was distributed?</Label>
              <Select value={type} onValueChange={setType}>
                <SelectTrigger id="dist-type" className="w-full">
                  <SelectValue placeholder="Select type" />
                </SelectTrigger>
                <SelectContent>
                  {TYPES.map((t) => (
                    <SelectItem key={t} value={t}>
                      {titleCase(t)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="dist-beneficiary">Beneficiary</Label>
              <Select value={beneficiaryId} onValueChange={setBeneficiaryId}>
                <SelectTrigger id="dist-beneficiary" className="w-full">
                  <SelectValue placeholder="Select beneficiary" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="walk-in">Walk-in (not registered)</SelectItem>
                  {beneficiaries.map((b) => (
                    <SelectItem key={b.id} value={b.id}>
                      {b.name}
                      {b.city ? ` — ${b.city}` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="dist-qty">Quantity</Label>
              <Input
                id="dist-qty"
                type="number"
                min={1}
                inputMode="numeric"
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="dist-location">Location</Label>
              <Input
                id="dist-location"
                placeholder="e.g. Ejipura community hall"
                value={location}
                onChange={(e) => setLocation(e.target.value)}
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="dist-notes">Notes (optional)</Label>
            <Textarea
              id="dist-notes"
              rows={3}
              placeholder="Anything the coordinator should know…"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>
          <Button className="min-h-11 gap-1.5" onClick={submit} disabled={submitting}>
            <Send className="size-4" aria-hidden="true" />
            {submitting ? "Recording…" : "Record distribution"}
          </Button>
        </CardContent>
      </Card>

      {/* ---------- My history ---------- */}
      <section aria-label="My distribution history">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          My history
        </h2>
        {loading ? (
          <div className="space-y-3">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-16 w-full rounded-xl" />
            ))}
          </div>
        ) : history.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center gap-2 p-10 text-center">
              <PackageOpen className="size-8 text-primary/60" aria-hidden="true" />
              <p className="text-sm text-muted-foreground">
                No distributions recorded yet — your first entry will show up here.
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid max-h-96 gap-3 overflow-y-auto pr-1 scrollbar-thin">
            {history.map((d) => (
              <Card key={d.id} className="p-4">
                <div className="flex flex-wrap items-center gap-3">
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <PackageOpen className="size-4" aria-hidden="true" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge
                        variant="outline"
                        className={TYPE_STYLES[d.type] ?? TYPE_STYLES.OTHER}
                      >
                        {titleCase(d.type)}
                      </Badge>
                      {d.beneficiary?.name ? (
                        <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                          <Users className="size-3" aria-hidden="true" />
                          {d.beneficiary.name}
                        </span>
                      ) : (
                        <span className="text-xs text-muted-foreground">Walk-in</span>
                      )}
                    </div>
                    <p className="mt-0.5 truncate text-xs text-muted-foreground">
                      {d.location ? `${d.location} · ` : ""}
                      {timeAgo(d.distributedAt)}
                      {d.notes ? ` · ${d.notes}` : ""}
                    </p>
                  </div>
                  <p className="text-sm font-bold">
                    ×{d.quantity}
                  </p>
                </div>
              </Card>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
