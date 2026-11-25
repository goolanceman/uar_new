/**
 * Mobile Audio Spaces — admin CRUD page (PHP parity didn't exist; full CRUD
 * per the community module conventions). List/search live & ended spaces,
 * detail sheet with participants (role/mic/kick) + messages, update, delete.
 * Data: /api/mobile-admin/audio-spaces* via the shared mfetch helper.
 */
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { ExternalLink, MessageSquare, Mic, Pencil, Plus, Radio, RefreshCw, Trash2, Users } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { EmptyState } from "@/components/shared/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { PageHeader } from "@/components/shared/page-header";
import { SectionCard } from "@/components/shared/section-card";
import {
  FormSection,
  SelectField,
  TextField,
} from "@/components/shared/form-fields";
import { FormSheet } from "@/components/shared/form-sheet";
import { DetailSheet } from "@/components/shared/detail-sheet";
import { StatCard } from "@/components/shared/stat-card";
import { mfetch, usePagedSearch, SearchInput } from "./community/shared";
import { useViewPref, ViewSwitcher } from "@/components/shared/view-switcher";
import { PaginationBar, PageSizeSelect } from "@/components/shared/view-switcher";

interface SpaceParticipant {
  id: string;
  user_id: string;
  username: string;
  full_name: string | null;
  profile: string | null;
  type: string;
  mic_status: string;
  is_left: boolean;
  joined_at: string | null;
  left_at: string | null;
}

interface SpaceMessage {
  id: string;
  user_id: string;
  username: string;
  full_name: string | null;
  profile: string | null;
  content: string;
  created_at: string | null;
}

interface SpaceDetail {
  id: string;
  title: string | null;
  description: string | null;
  topics: string | null;
  type: string;
  is_active: boolean;
  ended_at: string | null;
  created_at: string | null;
  hosts: Array<{ id: string; username: string; full_name: string | null; profile: string | null }>;
  listeners: number;
  participants: SpaceParticipant[];
  messages: SpaceMessage[];
}

interface SpaceRow {
  id: string;
  title: string | null;
  description: string | null;
  topics: string | null;
  type: string;
  is_active: boolean;
  ended_at: string | null;
  created_at: string | null;
  participant_count: number;
  host_count: number;
  message_count: number;
}

export default function MobileAudioSpacesView() {
  const { search, setSearch, query, page, setPage, limit, setLimit, start } = usePagedSearch(20);
  const [spaces, setSpaces] = useState<SpaceRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [activeFilter, setActiveFilter] = useState<"all" | "1" | "0">("all");
  const [detail, setDetail] = useState<SpaceDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<SpaceRow | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<SpaceRow | null>(null);
  const [form, setForm] = useState({ title: "", description: "", topics: "", type: "public" });
  const [view, setView] = useViewPref("mobile-audio-spaces", "table");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await mfetch<{ spaces: SpaceRow[]; total_count: number }>(
        `/api/mobile-admin/audio-spaces?${(() => {
          const params = new URLSearchParams({ start: String(start), limit: String(limit) });
          if (query) params.set("q", query);
          if (activeFilter !== "all") params.set("active", activeFilter);
          return params.toString();
        })()}`
      );
      setSpaces(res.spaces ?? []);
      setTotal(res.total_count ?? 0);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load audio spaces");
    } finally {
      setLoading(false);
    }
  }, [start, limit, query, activeFilter]);

  const openCreate = () => {
    setEditTarget(null);
    setForm({ title: "", description: "", topics: "", type: "public" });
    setFormOpen(true);
  };

  const openEdit = (s: SpaceRow) => {
    setEditTarget(s);
    setForm({ title: s.title ?? "", description: s.description ?? "", topics: s.topics ?? "", type: s.type });
    setFormOpen(true);
  };

  const save = async () => {
    try {
      if (editTarget) {
        await mfetch("/api/mobile-admin/audio-spaces/update", { id: editTarget.id, ...form });
        toast.success("Audio space updated");
      } else {
        await mfetch("/api/mobile-admin/audio-spaces/create", form);
        toast.success("Audio space created");
      }
      setFormOpen(false);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Save failed");
    }
  };

  useEffect(() => {
    void load();
  }, [load]);

  const openDetail = async (id: string) => {
    setDetailLoading(true);
    setDetail({ id } as SpaceDetail);
    try {
      const d = await mfetch<SpaceDetail>(`/api/mobile-admin/audio-spaces/details?id=${encodeURIComponent(id)}`);
      setDetail(d);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load audio space");
      setDetail(null);
    } finally {
      setDetailLoading(false);
    }
  };

  const toggleActive = async (space: SpaceRow) => {
    try {
      await mfetch("/api/mobile-admin/audio-spaces/update", {
        id: space.id,
        is_active: space.is_active ? 0 : 1,
      });
      toast.success(space.is_active ? "Audio space ended" : "Audio space marked live");
      void load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Update failed");
    }
  };

  const updateParticipant = async (spaceId: string, participantId: string, payload: Record<string, unknown>) => {
    try {
      await mfetch("/api/mobile-admin/audio-spaces/participants/update", {
        participant_id: participantId,
        ...payload,
      });
      await openDetail(spaceId);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Update failed");
    }
  };

  const deleteSpace = async (id: string) => {
    try {
      await mfetch("/api/mobile-admin/audio-spaces/delete", { id });
      toast.success("Audio space deleted");
      setDeleteTarget(null);
      setDetail(null);
      void load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Delete failed");
    }
  };

  const fmtDate = (iso: string | null) => (iso ? new Date(iso).toLocaleString() : "—");

  return (
    <div className="space-y-4 sm:space-y-6">
      <PageHeader
        title="Audio Spaces"
        description="Live and scheduled mobile audio spaces — hosts, participants and lifecycle."
        icon={<Radio className="size-5" aria-hidden="true" />}
        actions={
          <Button onClick={openCreate} aria-label="Create new audio space">
            <Plus className="size-4" /> New space
          </Button>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Total spaces" value={String(total)} icon={<Radio className="size-5" aria-hidden="true" />} accent="emerald" hint="All audio spaces" loading={loading} />
        <StatCard label="Live now" value={String(spaces.filter((s) => s.is_active).length)} icon={<Mic className="size-5" aria-hidden="true" />} accent="pink" hint="Currently broadcasting" loading={loading} />
        <StatCard label="Participants" value={String(spaces.reduce((a, s) => a + (s.participant_count ?? 0), 0))} icon={<Users className="size-5" aria-hidden="true" />} accent="cyan" hint="On this page" loading={loading} />
        <StatCard label="Messages" value={String(spaces.reduce((a, s) => a + (s.message_count ?? 0), 0))} icon={<MessageSquare className="size-5" aria-hidden="true" />} accent="amber" hint="On this page" loading={loading} />
      </div>

      <SectionCard
        title="Audio space directory"
        icon={<Radio className="size-4" aria-hidden="true" />}
        description={loading ? "Loading spaces…" : `${total} space${total === 1 ? "" : "s"}`}
        bodyClassName="space-y-4"
        actions={<ViewSwitcher value={view} onChange={setView} />}
      >
      <div className="flex flex-wrap items-center gap-2">
        <SearchInput value={search} onChange={setSearch} placeholder="Search title or description…" label="Search audio spaces" />
        <select
          value={activeFilter}
          onChange={(e) => setActiveFilter(e.target.value as "all" | "1" | "0")}
          className="h-9 rounded-md border bg-background px-3 text-sm"
          aria-label="Filter by state"
        >
          <option value="all">All</option>
          <option value="1">Live</option>
          <option value="0">Ended</option>
        </select>

      </div>

      {loading ? (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </div>
      ) : spaces.length === 0 ? (
        <EmptyState icon={<Radio className="size-8 text-muted-foreground" />} title="No audio spaces">
          <p className="text-sm text-muted-foreground">
            Live and ended audio spaces from the mobile app appear here.
          </p>
        </EmptyState>
      ) : view !== "table" ? (
        <div className={view === "grid" ? "grid gap-4 sm:grid-cols-2 xl:grid-cols-3" : "divide-y rounded-xl border bg-card"}>
          {spaces.map((s) => (
            <article key={s.id} className={view === "grid" ? "flex flex-col gap-3 rounded-xl border bg-card p-4" : "flex items-center gap-3 px-3 py-2.5"}>
              <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-muted">
                <Radio className="size-5 text-muted-foreground" aria-hidden="true" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className="truncate text-sm font-medium">{s.title || "(untitled)"}</p>
                  <Badge variant={s.is_active ? "default" : "secondary"}>{s.is_active ? "Live" : "Ended"}</Badge>
                  <Badge variant="outline">{s.type}</Badge>
                </div>
                <p className="truncate text-xs text-muted-foreground">{s.description}</p>
              </div>
              <div className="shrink-0 text-right text-xs text-muted-foreground">
                {s.participant_count} participants · {s.message_count} messages
                <div>{s.created_at ? fmtDate(s.created_at) : ""}</div>
              </div>
              <div className="flex justify-end gap-2" onClick={(e) => e.stopPropagation()}>
                <Button size="sm" variant="outline" onClick={() => openDetail(s.id)}>Details</Button>
                <Button size="sm" variant="outline" onClick={() => openEdit(s)}>
                  <Pencil className="size-4" />
                </Button>
                <Button size="sm" variant="destructive" onClick={() => setDeleteTarget(s)}>
                  <Trash2 className="size-4" />
                </Button>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-4 py-3">Space</th>
                <th className="px-4 py-3">Type</th>
                <th className="px-4 py-3">State</th>
                <th className="px-4 py-3">Hosts</th>
                <th className="px-4 py-3">Participants</th>
                <th className="px-4 py-3">Messages</th>
                <th className="px-4 py-3">Started</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {spaces.map((s) => (
                  <tr key={s.id} className="border-t hover:bg-muted/30">
                    <td className="px-4 py-3">
                      <div className="font-medium">{s.title || "(untitled)"}</div>
                      <div className="line-clamp-1 max-w-md text-xs text-muted-foreground">{s.description}</div>
                    </td>
                    <td className="px-4 py-3">
                      <Badge variant="outline">{s.type}</Badge>
                    </td>
                    <td className="px-4 py-3">
                      <Badge variant={s.is_active ? "default" : "secondary"}>
                        {s.is_active ? "Live" : "Ended"}
                      </Badge>
                    </td>
                    <td className="px-4 py-3">{s.host_count}</td>
                    <td className="px-4 py-3">{s.participant_count}</td>
                    <td className="px-4 py-3">{s.message_count}</td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">{fmtDate(s.created_at)}</td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-2">
                        <Button size="sm" variant="outline" onClick={() => void openDetail(s.id)}>
                          Details
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => openEdit(s)}>
                          <Pencil className="size-4" /> Edit
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => void toggleActive(s)}>
                          {s.is_active ? "End" : "Mark live"}
                        </Button>
                        <Button size="sm" variant="destructive" onClick={() => setDeleteTarget(s)}>
                          Delete
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      )}

        {!loading && total > 0 ? (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <PaginationBar page={page} pages={Math.max(1, Math.ceil(total / limit))} total={total} onPage={setPage} itemLabel="audio spaces" />
            <PageSizeSelect value={limit} onChange={setLimit} />
          </div>
        ) : null}

      {/* Create / edit dialog */}
      <FormSheet
        open={formOpen}
        onOpenChange={setFormOpen}
        title={editTarget ? "Edit audio space" : "New audio space"}
        description={
          editTarget ? "Update the space details." : "Creates a paused space hosted by your admin account — start it live from the app."
        }
        onSubmit={save}
        submitLabel={editTarget ? "Save changes" : "Create space"}
        dirty={formOpen}
      >
        <FormSection title="Space">
          <TextField
            label="Title"
            value={form.title}
            onChange={(v) => setForm({ ...form, title: v })}
          />
          <TextField
            label="Description"
            value={form.description}
            onChange={(v) => setForm({ ...form, description: v })}
          />
          <TextField
            label="Topics (interest IDs)"
            value={form.topics}
            onChange={(v) => setForm({ ...form, topics: v })}
            placeholder="1,2"
          />
        </FormSection>
        <FormSection title="Visibility">
          <SelectField
            label="Type"
            value={form.type}
            onChange={(v) => setForm({ ...form, type: v })}
            options={[
              { value: "public", label: "Public" },
              { value: "private", label: "Private" },
            ]}
          />
        </FormSection>
      </FormSheet>

      {/* Detail dialog */}
      <DetailSheet
        open={detail !== null}
        onOpenChange={(open) => !open && setDetail(null)}
        eyebrow="Mobile audio spaces"
        title={detail?.title || "Audio space"}
        description={`${detail?.description ?? ""} · ${detail?.type ?? ""} · ${
          detail?.is_active ? "Live" : `Ended ${detail?.ended_at ? fmtDate(detail.ended_at) : ""}`
        }`}
      >
        <div className="space-y-4">
          {detailLoading || !detail || !detail.participants ? (
            <div className="space-y-2">
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
            </div>
          ) : (
            <div className="space-y-4">
              <div>
                <h4 className="mb-2 text-sm font-semibold">Participants ({detail.participants.length})</h4>
                <div className="overflow-hidden rounded-md border">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
                      <tr>
                        <th className="px-3 py-2">Member</th>
                        <th className="px-3 py-2">Role</th>
                        <th className="px-3 py-2">Mic</th>
                        <th className="px-3 py-2">Joined</th>
                        <th className="px-3 py-2 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {detail.participants.map((p) => (
                        <tr key={p.id} className="border-t">
                          <td className="px-3 py-2">
                            <div className="font-medium">{p.full_name || p.username}</div>
                            <div className="text-xs text-muted-foreground">@{p.username}</div>
                          </td>
                          <td className="px-3 py-2">
                            <Badge variant="outline">{p.type}</Badge>
                          </td>
                          <td className="px-3 py-2">
                            <Switch
                              checked={p.mic_status === "on"}
                              onCheckedChange={(v) =>
                                void updateParticipant(detail.id, p.id, { action: "mic", mic_status: v ? "on" : "muted" })
                              }
                              aria-label="Toggle mic"
                            />
                          </td>
                          <td className="px-3 py-2 text-xs text-muted-foreground">{fmtDate(p.joined_at)}</td>
                          <td className="px-3 py-2">
                            <div className="flex justify-end gap-2">
                              {["host", "listener"].map((t) =>
                                p.type !== t ? (
                                  <Button
                                    key={t}
                                    size="sm"
                                    variant="outline"
                                    onClick={() =>
                                      void updateParticipant(detail.id, p.id, { action: "type", type: t })
                                    }
                                  >
                                    Make {t}
                                  </Button>
                                ) : null
                              )}
                              {!p.is_left && (
                                <Button
                                  size="sm"
                                  variant="destructive"
                                  onClick={() => void updateParticipant(detail.id, p.id, { action: "kick" })}
                                >
                                  Kick
                                </Button>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div>
                <h4 className="mb-2 flex items-center gap-2 text-sm font-semibold">
                  <Mic className="size-4" /> Messages ({detail.messages.length})
                </h4>
                {detail.messages.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No messages.</p>
                ) : (
                  <div className="max-h-56 space-y-2 overflow-y-auto rounded-md border p-3">
                    {detail.messages.map((m) => (
                      <div key={m.id} className="text-sm">
                        <span className="font-medium">{m.full_name || m.username}:</span>{" "}
                        <span className="text-muted-foreground">{m.content}</span>
                        <span className="ml-2 text-xs text-muted-foreground/70">{fmtDate(m.created_at)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {detail.description && (
                <p className="text-xs text-muted-foreground">
                  <ExternalLink className="mr-1 inline size-3" />
                  Topics: {detail.topics || "—"}
                </p>
              )}
            </div>
          )}
        </div>
      </DetailSheet>

      {/* Delete confirm */}
      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title="Delete audio space?"
        description={`"${deleteTarget?.title ?? ""}" and all its participants and messages will be permanently removed.`}
        confirmLabel="Delete"
        onConfirm={() => {
          if (deleteTarget) void deleteSpace(deleteTarget.id);
        }}
      />
      </SectionCard>
    </div>
  );
}
