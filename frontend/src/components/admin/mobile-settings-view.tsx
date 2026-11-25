"use client";

/**
 * Community admin — App settings tab (PHP admin panel parity).
 * Ports the legacy admin panel's APP SETTINGS/CONFIG screens:
 *   SettingsController  → App settings form (settingView/updateSettings/
 *                         changeAppName/admob + deep-link fields) and the
 *                         document-type CRUD,
 *   ReportReason CRUD   → addreportReason/reportReasonList/updateReportReason/
 *                         deleteReportReasonType,
 *   RestrictionController → username-restriction CRUD,
 *   InterestController  → interest CRUD.
 *
 * Consumes the backend /api/mobile-admin/* endpoints (routes/mobile/
 * admin-config.ts) via the shared mfetch helper. App settings are stored in the
 * "mobile.app" Setting KV the mobile /api/fetchSetting reads, so saves are
 * reflected in the Flutter app immediately. is_* flags serialize as 0/1 ints —
 * the Flutter model parses int?, NOT booleans.
 */

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  FileText,
  Flag,
  Heart,
  Loader2,
  Pencil,
  Plus,
  Smartphone,
  RefreshCw,
  Save,
  Settings,
  ShieldBan,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/shared/page-header";
import { TitleListCard } from "./title-list-card";
import { mfetch } from "./community/shared";
import { SectionCard } from "@/components/shared/section-card";
import { EmptyState } from "@/components/shared/empty-state";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

/* ─────────────────────────────── types ───────────────────────────────── */

type SettingsMap = Record<string, string>;

interface ListItem {
  id: number;
  title: string;
  created_at: string | null;
  updated_at: string | null;
}

type FieldKind = "text" | "number" | "flag";

interface FieldDef {
  key: string;
  label: string;
  kind: FieldKind;
  hint?: string;
  placeholder?: string;
  multiline?: boolean;
}

interface GroupDef {
  value: string;
  title: string;
  icon: ReactNode;
  description: string;
  fields: FieldDef[];
}

/* ─────────────────────── app-settings field catalog ──────────────────── */
/* Mirrors the legacy setting.blade.php / admob.blade.php field groups. The
 * SightEngine moderation card groups the legacy moderation keys that have no
 * natural home in the four named groups. */

const GROUPS: GroupDef[] = [
  {
    value: "general",
    title: "General",
    icon: <Settings className="size-4" aria-hidden="true" />,
    description: "App identity, store links and feed/purchase switches (changeAppName / updateSettings).",
    fields: [
      { key: "app_name", label: "App name", kind: "text", placeholder: "Charitable Trust" },
      { key: "support_email", label: "Support email", kind: "text", placeholder: "support@example.org" },
      { key: "uri_scheme", label: "URI scheme", kind: "text", hint: "Deep-link scheme, e.g. chatter://", placeholder: "chatter" },
      { key: "play_store_download_link", label: "Play Store link", kind: "text", placeholder: "https://play.google.com/…" },
      { key: "app_store_download_link", label: "App Store link", kind: "text", placeholder: "https://apps.apple.com/…" },
      { key: "android_app_version", label: "Android app version", kind: "text", placeholder: "1.0.0" },
      { key: "ios_app_version", label: "iOS app version", kind: "text", placeholder: "1.0.0" },
      { key: "storage_type", label: "Storage type", kind: "number", hint: "0 = local, 1 = AWS S3, 2 = DigitalOcean Spaces (legacy storage_type)." },
      { key: "fetch_post_type", label: "Fetch post type", kind: "number", hint: "Legacy feed ordering/type filter served to the app." },
      { key: "is_in_app_purchase_enabled", label: "In-app purchases enabled", kind: "flag", hint: "Enables the mobile in-app purchase flow." },
    ],
  },
  {
    value: "ads",
    title: "Ads",
    icon: <Badge variant="outline" className="text-[10px]">AD</Badge>,
    description: "AdMob unit ids and the master AdMob switch (legacy admob screen).",
    fields: [
      { key: "is_admob_on", label: "AdMob enabled", kind: "flag", hint: "Master switch for ads in the mobile app." },
      { key: "ad_banner_android", label: "Ad banner — Android", kind: "text", placeholder: "ca-app-pub-…" },
      { key: "ad_interstitial_android", label: "Ad interstitial — Android", kind: "text", placeholder: "ca-app-pub-…" },
      { key: "ad_banner_iOS", label: "Ad banner — iOS", kind: "text", placeholder: "ca-app-pub-…" },
      { key: "ad_interstitial_iOS", label: "Ad interstitial — iOS", kind: "text", placeholder: "ca-app-pub-…" },
    ],
  },
  {
    value: "limits",
    title: "Limits",
    icon: <Settings className="size-4" aria-hidden="true" />,
    description: "Media-length, upload and audio-space limits enforced by the app.",
    fields: [
      { key: "setRoomUsersLimit", label: "Room users limit", kind: "number" },
      { key: "minute_limit_in_creating_story", label: "Story recording limit (minutes)", kind: "number" },
      { key: "minute_limit_in_audio_post", label: "Audio post limit (minutes)", kind: "number" },
      { key: "minute_limit_in_choosing_video_for_story", label: "Story video pick limit (minutes)", kind: "number" },
      { key: "minute_limit_in_choosing_video_for_post", label: "Post video pick limit (minutes)", kind: "number" },
      { key: "max_images_can_be_uploaded_in_one_post", label: "Max images per post", kind: "number" },
      { key: "audio_space_hosts_limit", label: "Audio space hosts limit", kind: "number" },
      { key: "audio_space_listeners_limit", label: "Audio space listeners limit", kind: "number" },
      { key: "audio_space_duration_in_minutes", label: "Audio space duration (minutes)", kind: "number" },
      { key: "duration_limit_in_reel", label: "Reel duration limit (seconds)", kind: "number" },
    ],
  },
  {
    value: "moderation",
    title: "Content moderation",
    icon: <ShieldBan className="size-4" aria-hidden="true" />,
    description: "SightEngine image/video moderation credentials and workflow ids.",
    fields: [
      { key: "is_sight_engine_enabled", label: "SightEngine enabled", kind: "flag", hint: "Moderates uploaded media through SightEngine." },
      { key: "sight_engine_api_user", label: "API user", kind: "text", placeholder: "SightEngine API user" },
      { key: "sight_engine_api_secret", label: "API secret", kind: "text", placeholder: "SightEngine API secret" },
      { key: "sight_engine_image_workflow_id", label: "Image workflow ID", kind: "text" },
      { key: "sight_engine_video_workflow_id", label: "Video workflow ID", kind: "text" },
    ],
  },
  {
    value: "maintenance",
    title: "Maintenance",
    icon: <RefreshCw className="size-4" aria-hidden="true" />,
    description: "Maintenance mode banner and forced app-update gating.",
    fields: [
      { key: "is_maintenance_mode", label: "Maintenance mode", kind: "flag", hint: "Shows the maintenance screen in the mobile app." },
      { key: "maintenance_message", label: "Maintenance message", kind: "text", multiline: true, placeholder: "We'll be back shortly…" },
      { key: "is_force_app_update", label: "Force app update", kind: "flag", hint: "Blocks the app until it is updated to the versions above." },
    ],
  },
];

/** Primitives → string map for the form state. */
function normalize(raw: unknown): SettingsMap {
  const out: SettingsMap = {};
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") out[k] = String(v);
      else if (v === null) out[k] = "";
    }
  }
  return out;
}

/* ─────────────────────────────── view ────────────────────────────────── */

export default function MobileSettingsView() {
  return (
    <div className="space-y-4 sm:space-y-6">
      <PageHeader
        title="App Settings"
        description="Configuration for the mobile app — branding, limits, moderation, maintenance and username restrictions."
        icon={<Smartphone className="size-5" aria-hidden="true" />}
      />

      <Tabs defaultValue="settings">
      <TabsList className="h-auto w-full flex-wrap sm:w-auto">
        <TabsTrigger value="settings">App settings</TabsTrigger>
        <TabsTrigger value="restrictions">Username restrictions</TabsTrigger>
      </TabsList>

      <TabsContent value="settings" className="mt-4">
        <AppSettingsForm />
      </TabsContent>
      <TabsContent value="restrictions" className="mt-4">
        <TitleListCard
          title="Username restrictions"
          icon={<ShieldBan className="size-4" aria-hidden="true" />}
          description="Usernames mobile sign-ups may not claim (legacy addUsernameRestrict / updateUsernameRestrict / deleteUsernameRestrictions)."
          noun="Username"
          listPath="/api/mobile-admin/username-restrictions"
          listKey="username_restrictions"
          addPath="/api/mobile-admin/username-restrictions"
          updatePath="/api/mobile-admin/username-restrictions/update"
          deletePath="/api/mobile-admin/username-restrictions/delete"
          idKey="username_id"
          placeholder="e.g. admin"
          emptyIcon={<ShieldBan className="size-6" aria-hidden="true" />}
          batchHint="Comma-separated values create one row each (e.g. admin, root, support)."
        />
      </TabsContent>
    </Tabs>
    </div>
  );
}

/* ───────────────────────── App settings form ─────────────────────────── */

function AppSettingsForm() {
  const [saved, setSaved] = useState<SettingsMap>({});
  const [values, setValues] = useState<SettingsMap>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const raw = await mfetch<unknown>("/api/mobile-admin/settings");
      const map = normalize(raw);
      setSaved(map);
      setValues(map);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load app settings");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const set = (key: string, value: string) => setValues((prev) => ({ ...prev, [key]: value }));
  const flag = (key: string) => (values[key] ?? "0") === "1";

  const dirtyKeys = useMemo(() => {
    const keys = new Set([...Object.keys(saved), ...Object.keys(values)]);
    return [...keys].filter((k) => (values[k] ?? "") !== (saved[k] ?? ""));
  }, [saved, values]);

  const save = async () => {
    if (dirtyKeys.length === 0) {
      toast.info("No changes to save");
      return;
    }
    const payload: Record<string, string | number> = {};
    for (const g of GROUPS) {
      for (const f of g.fields) {
        if (!dirtyKeys.includes(f.key)) continue;
        if (f.kind === "flag") payload[f.key] = (values[f.key] ?? "0") === "1" ? 1 : 0;
        else if (f.kind === "number") payload[f.key] = Number(values[f.key] ?? 0) || 0;
        else payload[f.key] = values[f.key] ?? "";
      }
    }
    setSaving(true);
    try {
      const res = await mfetch<{ settings: Record<string, unknown> }>("/api/mobile-admin/settings", payload);
      setSaved(normalize(res.settings));
      setValues(normalize(res.settings));
      toast.success(`Saved ${dirtyKeys.length} setting${dirtyKeys.length === 1 ? "" : "s"} — live for the mobile app immediately`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to save settings");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="space-y-4" aria-busy="true">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-40 w-full rounded-xl" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <SectionCard
        title="Mobile app settings"
        description="Served to the Flutter app by /api/fetchSetting — saved values are live immediately."
        icon={<Settings className="size-4" aria-hidden="true" />}
        actions={
          <>
            {dirtyKeys.length > 0 && (
              <Badge variant="outline" className="border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400">
                {dirtyKeys.length} unsaved
              </Badge>
            )}
            <Button size="sm" variant="outline" onClick={() => void load()} disabled={saving} aria-label="Reload app settings">
              <RefreshCw className="size-4" aria-hidden="true" /> Reload
            </Button>
            <Button size="sm" onClick={() => void save()} disabled={saving || dirtyKeys.length === 0} aria-label="Save app settings">
              {saving ? (
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              ) : (
                <Save className="size-4" aria-hidden="true" />
              )}
              Save
            </Button>
          </>
        }
        bodyClassName="space-y-4"
      >
        {GROUPS.map((g, gi) => (
          <div key={g.value} className={gi > 0 ? "border-t pt-4" : undefined}>
            <div className="mb-3 flex items-center gap-2">
              <span className="grid size-7 place-items-center rounded-lg bg-muted text-muted-foreground" aria-hidden="true">
                {g.icon}
              </span>
              <div>
                <p className="text-sm font-semibold">{g.title}</p>
                <p className="text-[11px] text-muted-foreground">{g.description}</p>
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              {g.fields.map((f) =>
                f.kind === "flag" ? (
                  <div key={f.key} className="flex items-center justify-between gap-4 rounded-lg border p-3 sm:col-span-2">
                    <div className="min-w-0">
                      <Label htmlFor={`cfg-${f.key}`} className="text-sm">{f.label}</Label>
                      {f.hint && <p className="text-xs text-muted-foreground">{f.hint}</p>}
                    </div>
                    <Switch
                      id={`cfg-${f.key}`}
                      checked={flag(f.key)}
                      onCheckedChange={(v) => set(f.key, v ? "1" : "0")}
                      aria-label={f.label}
                    />
                  </div>
                ) : (
                  <div key={f.key} className="grid gap-1.5">
                    <Label htmlFor={`cfg-${f.key}`}>{f.label}</Label>
                    {f.multiline ? (
                      <Textarea
                        id={`cfg-${f.key}`}
                        rows={2}
                        value={values[f.key] ?? ""}
                        onChange={(e) => set(f.key, e.target.value)}
                        placeholder={f.placeholder}
                      />
                    ) : (
                      <Input
                        id={`cfg-${f.key}`}
                        type={f.kind === "number" ? "number" : "text"}
                        value={values[f.key] ?? ""}
                        onChange={(e) => set(f.key, e.target.value)}
                        placeholder={f.placeholder}
                      />
                    )}
                    {f.hint && <p className="text-xs text-muted-foreground">{f.hint}</p>}
                  </div>
                )
              )}
            </div>
          </div>
        ))}
      </SectionCard>
    </div>
  );
}

/* ─────────────────────── title-list CRUD card ────────────────────────── */

