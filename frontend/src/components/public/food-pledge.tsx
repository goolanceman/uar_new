"use client";

/**
 * Public "Donate groceries" pledge form (§7.2 + §18.D of docs/food.md).
 * Donors, restaurants and stores offer actual food; the logistics desk
 * schedules the pickup. Shown on the food security landing page.
 */

import { useState } from "react";
import { CheckCircle2, HandHeart, PackagePlus } from "lucide-react";
import { toast } from "sonner";
import { post } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { FieldGrid, TextField, TextareaField } from "@/components/shared/form-fields";

interface FormState {
  donorName: string; phone: string; orgName: string; items: string;
  pickupAddress: string; city: string; pincode: string; availability: string; storageNotes: string;
}

const EMPTY: FormState = {
  donorName: "", phone: "", orgName: "", items: "", pickupAddress: "",
  city: "Bengaluru", pincode: "", availability: "", storageNotes: "",
};

export function FoodPledgeSection() {
  const [form, setForm] = useState<FormState>(EMPTY);
  const [busy, setBusy] = useState(false);
  const [pledgeCode, setPledgeCode] = useState<string | null>(null);

  const set = (k: keyof FormState) => (v: string) => setForm((f) => ({ ...f, [k]: v }));

  const submit = async () => {
    if (!form.donorName.trim() || !form.items.trim() || !form.pickupAddress.trim()) {
      toast.error("Name, items and pickup address are required");
      return;
    }
    setBusy(true);
    try {
      const res = await post<{ code: string }>("/api/food/pledges", form);
      setPledgeCode(res.code);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Submission failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div id="donate-food" className="rounded-2xl border bg-card p-6">
      <span className="flex size-10 items-center justify-center rounded-xl bg-amber-500/10 text-amber-600">
        <PackagePlus className="size-5" />
      </span>
      <h2 className="mt-3 text-lg font-semibold">Donate groceries or surplus food</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Restaurants, grocery stores, wholesalers, hotels and families — pledge packaged
        groceries or safe surplus food and our logistics team collects it from your door.
      </p>

      {pledgeCode ? (
        <div className="mt-4 rounded-xl border border-emerald-500/40 bg-emerald-500/10 p-4 text-sm">
          <p className="flex items-center gap-2 font-medium text-emerald-700 dark:text-emerald-400">
            <CheckCircle2 className="size-4" /> Pledge registered — {pledgeCode}
          </p>
          <p className="mt-1 text-muted-foreground">
            We&apos;ll call {form.phone} to confirm the pickup window. Food safety inspection happens
            at collection — sealed, in-date items only.
          </p>
          <Button variant="outline" size="sm" className="mt-3" onClick={() => { setPledgeCode(null); setForm(EMPTY); }}>
            Pledge another donation
          </Button>
        </div>
      ) : (
        <div className="mt-4 space-y-3">
          <FieldGrid>
            <TextField label="Your name" required value={form.donorName} onChange={set("donorName")} placeholder="Full name" />
            <TextField label="Mobile number" required inputMode="tel" value={form.phone} onChange={set("phone")} placeholder="98765 43210" />
          </FieldGrid>
          <TextField label="Organisation (restaurant / store / company — optional)" value={form.orgName} onChange={set("orgName")} />
          <TextareaField
            label="What are you donating?"
            required
            value={form.items}
            onChange={set("items")}
            placeholder="e.g. 25 kg rice, 10 kg dal, 40 sealed grocery kits — all in date"
          />
          <TextareaField label="Pickup address" required value={form.pickupAddress} onChange={set("pickupAddress")} />
          <FieldGrid cols={3}>
            <TextField label="City" value={form.city} onChange={set("city")} />
            <TextField label="PIN code" inputMode="numeric" maxLength={6} value={form.pincode} onChange={set("pincode")} />
            <TextField label="When can we collect?" value={form.availability} onChange={set("availability")} placeholder="Weekdays 10am–6pm" />
          </FieldGrid>
          <TextField label="Storage / temperature notes (optional)" value={form.storageNotes} onChange={set("storageNotes")} placeholder="Ambient, sealed cartons" />
          <Button className="w-full" size="lg" onClick={submit} disabled={busy}>
            <HandHeart className="size-5" /> {busy ? "Submitting…" : "Register food donation"}
          </Button>
          <p className="text-center text-xs text-muted-foreground">
            Every pledge is quality-inspected before distribution — expired or unsealed food is never handed out.
          </p>
        </div>
      )}
    </div>
  );
}
