"use client";

import { useCallback, useEffect, useState } from "react";
import { Bot, Building2, Loader2, Save, Settings2 } from "lucide-react";
import { toast } from "sonner";
import { get, patch } from "@/lib/api-client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";

/* --------------------------------- helpers ---------------------------------- */

type SettingsMap = Record<string, string>;

function normalize(raw: unknown): SettingsMap {
  if (Array.isArray(raw)) {
    const out: SettingsMap = {};
    for (const item of raw as Record<string, unknown>[]) {
      if (item && typeof item.key === "string") out[item.key] = String(item.value ?? "");
    }
    return out;
  }
  if (raw && typeof raw === "object") {
    const o = raw as Record<string, unknown>;
    if (o.settings && typeof o.settings === "object" && !Array.isArray(o.settings)) return normalize(o.settings);
    const out: SettingsMap = {};
    for (const [k, v] of Object.entries(o)) {
      if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") out[k] = String(v);
    }
    return out;
  }
  return {};
}

const DEFAULTS: SettingsMap = {
  "org.name": "United Angel Reach",
  "org.hq": "Bengaluru, Karnataka",
  "org.vision": "To scale our service model to serve all of India.",
  "org.email": "contact@unitedangelreach.org",
  "org.80g": "",
  "org.pan": "",
  "ops.lowStockAlerts": "true",
  "ops.currency": "INR",
  "assist.model": "",
};

/* ---------------------------------- view ------------------------------------ */

export default function SettingsView() {
  const [values, setValues] = useState<SettingsMap>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const raw = await get<unknown>("/api/settings");
      setValues({ ...DEFAULTS, ...normalize(raw) });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load settings");
      setValues({ ...DEFAULTS });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const set = (key: string, value: string) => setValues((prev) => ({ ...prev, [key]: value }));

  const save = async () => {
    setSaving(true);
    try {
      await patch("/api/settings", values);
      toast.success("Settings saved");
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to save settings");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="space-y-4">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-52 rounded-xl" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">Organisation, operations and assistant preferences.</p>
        <Button onClick={save} disabled={saving} aria-label="Save settings">
          {saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
          {saving ? "Saving…" : "Save settings"}
        </Button>
      </div>

      {/* Organisation */}
      <Card>
        <CardHeader className="pb-4">
          <CardTitle className="flex items-center gap-2 text-base">
            <span className="flex size-8 items-center justify-center rounded-lg bg-emerald-100 text-emerald-700">
              <Building2 className="size-4" aria-hidden="true" />
            </span>
            Organisation
          </CardTitle>
          <CardDescription>Public identity of the trust shown across the site and receipts.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div className="grid gap-2">
            <Label htmlFor="s-org-name">Organisation name</Label>
            <Input id="s-org-name" value={values["org.name"] ?? ""} onChange={(e) => set("org.name", e.target.value)} />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="s-org-email">Contact email</Label>
            <Input id="s-org-email" type="email" value={values["org.email"] ?? ""} onChange={(e) => set("org.email", e.target.value)} />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="s-org-hq">Headquarters</Label>
            <Input id="s-org-hq" value={values["org.hq"] ?? ""} onChange={(e) => set("org.hq", e.target.value)} placeholder="Bengaluru, Karnataka" />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="s-org-80g">80G registration number</Label>
            <Input id="s-org-80g" value={values["org.80g"] ?? ""} onChange={(e) => set("org.80g", e.target.value)} placeholder="80G cert. no." />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="s-org-pan">PAN</Label>
            <Input id="s-org-pan" value={values["org.pan"] ?? ""} onChange={(e) => set("org.pan", e.target.value)} placeholder="Trust PAN" />
          </div>
          <div className="grid gap-2 sm:col-span-2">
            <Label htmlFor="s-org-vision">Vision statement</Label>
            <Textarea id="s-org-vision" rows={2} value={values["org.vision"] ?? ""} onChange={(e) => set("org.vision", e.target.value)} />
          </div>
        </CardContent>
      </Card>

      {/* Operations */}
      <Card>
        <CardHeader className="pb-4">
          <CardTitle className="flex items-center gap-2 text-base">
            <span className="flex size-8 items-center justify-center rounded-lg bg-amber-100 text-amber-700">
              <Settings2 className="size-4" aria-hidden="true" />
            </span>
            Operations
          </CardTitle>
          <CardDescription>Day-to-day behaviour of inventory, distribution and finance modules.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div className="flex items-center justify-between gap-4 rounded-lg border p-3 sm:col-span-2">
            <div>
              <Label htmlFor="s-ops-lowstock" className="text-sm">Low stock alerts</Label>
              <p className="text-xs text-muted-foreground">Show dashboard callouts and warnings when items fall below minimum stock.</p>
            </div>
            <Switch
              id="s-ops-lowstock"
              checked={(values["ops.lowStockAlerts"] ?? "true") === "true"}
              onCheckedChange={(v) => set("ops.lowStockAlerts", v ? "true" : "false")}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="s-ops-currency">Currency</Label>
            <Input id="s-ops-currency" value={values["ops.currency"] ?? "INR"} onChange={(e) => set("ops.currency", e.target.value)} placeholder="INR" />
          </div>
        </CardContent>
      </Card>

      {/* AI assistant */}
      <Card>
        <CardHeader className="pb-4">
          <CardTitle className="flex items-center gap-2 text-base">
            <span className="flex size-8 items-center justify-center rounded-lg bg-teal-100 text-teal-700">
              <Bot className="size-4" aria-hidden="true" />
            </span>
            AI Assistant
          </CardTitle>
          <CardDescription>Configuration for the in-app assistant widget.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div className="grid gap-2">
            <Label htmlFor="s-ai-model">Model</Label>
            <Input id="s-ai-model" value={values["assist.model"] ?? ""} onChange={(e) => set("assist.model", e.target.value)} placeholder="glm-4.6" />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
