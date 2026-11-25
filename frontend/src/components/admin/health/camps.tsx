"use client";

/**
 * Health Programme — Camps tab.
 *
 * List-page standard: toolbar (search, status chips, city filter, upcoming
 * toggle, ViewSwitcher, ExportMenu, "New camp"), DataTable table view with a
 * pulsing LIVE badge, responsive grid view, FormSheet for camp creation
 * (services as a comma list, campaign link) and the CampDetailSheet
 * workbench (see camp-detail.tsx / camp-ops.tsx).
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CalendarPlus,
  MapPin,
  MoreHorizontal,
  Tent,
} from "lucide-react";
import { toast } from "sonner";
import { get, post } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { formatDate } from "@/lib/format";
import { EmptyState } from "@/components/shared/empty-state";
import { FormSheet } from "@/components/shared/form-sheet";
import { FieldGrid, FormSection, SelectField, TextField, TextareaField } from "@/components/shared/form-fields";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { ExportMenu, type CsvColumn } from "@/components/shared/csv";
import { useViewPref, ViewSwitcher } from "@/components/shared/view-switcher";
import { DataTable, type DataTableColumn } from "@/components/shared/data-table";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { CampDetailSheet } from "./camp-detail";
import type { TabProps } from "./overview";
import {
  asPaged,
  CampSelect,
  CampStatusBadge,
  CAMP_STATUSES,
  CapacityBar,
  errorText,
  FilterChips,
  jsonList,
  LiveDot,
  useDebounced,
  type MedicalCamp,
} from "./shared";

interface CampsResp {
  items: MedicalCamp[];
  total: number;
  page: number;
  pages: number;
}

interface CampaignLite {
  id: string;
  title: string;
}

const EMPTY_FORM = {
  title: "",
  campDate: "",
  startTime: "",
  endTime: "",
  venue: "",
  city: "",
  capacity: "100",
  services: "",
  coordinatorName: "",
  budget: "",
  description: "",
  campaignId: "",
};

export default function CampsTab({ revision }: TabProps) {
  const [rows, setRows] = useState<MedicalCamp[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [query, setQuery] = useState("");
  const q = useDebounced(query.trim());
  const [status, setStatus] = useState("ALL");
  const [city, setCity] = useState("");
  const [upcomingOnly, setUpcomingOnly] = useState(false);
  const [view, setView] = useViewPref("health-camps");
  const pageSize = 25;

  const [detailId, setDetailId] = useState<string | null>(null);
  const [newOpen, setNewOpen] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [campaigns, setCampaigns] = useState<CampaignLite[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const sp = new URLSearchParams({ page: String(page), limit: String(pageSize), withCounts: "1" });
      if (q) sp.set("q", q);
      if (status !== "ALL") sp.set("status", status);
      if (city.trim()) sp.set("city", city.trim());
      if (upcomingOnly) sp.set("upcoming", "1");
      const d = await get<CampsResp>(`/api/medical-camps?${sp.toString()}`);
      setRows(d?.items ?? []);
      setTotal(d?.total ?? 0);
      setPages(Math.max(1, d?.pages ?? 1));
    } catch (e) {
      setError(errorText(e));
    } finally {
      setLoading(false);
    }
  }, [q, status, city, upcomingOnly, page]);

  useEffect(() => {
    load();
  }, [load, revision]);

  /* campaigns for the link select (loaded when the sheet opens) */
  const loadCampaigns = useCallback(() => {
    get<unknown>("/api/campaigns?limit=100")
      .then((d) => setCampaigns(asPaged<CampaignLite>(d).items.slice(0, 100)))
      .catch(() => setCampaigns([]));
  }, []);

  useEffect(() => {
    setPage(1);
  }, [q, status, city, upcomingOnly]);

  const csv: CsvColumn<MedicalCamp>[] = useMemo(
    () => [
      { header: "Code", value: (c) => c.code },
      { header: "Title", value: (c) => c.title },
      { header: "Date", value: (c) => formatDate(c.campDate) },
      { header: "Start", value: (c) => c.startTime ?? "" },
      { header: "End", value: (c) => c.endTime ?? "" },
      { header: "Venue", value: (c) => c.venue },
      { header: "City", value: (c) => c.city ?? "" },
      { header: "Capacity", value: (c) => c.capacity },
      { header: "Registrations", value: (c) => c.counts?.registrations ?? "" },
      { header: "Checked in", value: (c) => c.counts?.checkedIn ?? "" },
      { header: "Completed", value: (c) => c.counts?.completed ?? "" },
      { header: "Status", value: (c) => c.status },
      { header: "Coordinator", value: (c) => c.coordinatorName ?? "" },
      { header: "Budget", value: (c) => c.budget ?? "" },
      { header: "Services", value: (c) => jsonList(c.services).join("; ") },
    ],
    []
  );

  const create = async () => {
    if (!form.title.trim() || !form.venue.trim() || !form.campDate) {
      toast.error("Title, camp date and venue are required");
      return;
    }
    const capacity = Number(form.capacity);
    if (!Number.isFinite(capacity) || capacity <= 0) {
      toast.error("Capacity must be a positive number");
      return;
    }
    setSaving(true);
    try {
      await post("/api/medical-camps", {
        title: form.title.trim(),
        campDate: form.campDate,
        startTime: form.startTime || undefined,
        endTime: form.endTime || undefined,
        venue: form.venue.trim(),
        city: form.city.trim() || undefined,
        capacity,
        services: jsonList(form.services),
        coordinatorName: form.coordinatorName.trim() || undefined,
        budget: form.budget ? Number(form.budget) : undefined,
        description: form.description.trim() || undefined,
        campaignId: form.campaignId || undefined,
      });
      toast.success("Camp created — find it below and open it to invite partners");
      setNewOpen(false);
      setForm(EMPTY_FORM);
      await load();
    } catch (e) {
      toast.error(errorText(e));
    } finally {
      setSaving(false);
    }
  };

  const columns: DataTableColumn<MedicalCamp>[] = [
    {
      key: "camp",
      header: "Camp",
      accessor: (c) => (
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 truncate font-medium">
            {c.status === "LIVE" ? <LiveDot /> : null}
            <span className="truncate">{c.title}</span>
          </p>
          <p className="truncate font-mono text-[10px] text-muted-foreground/70">{c.code}</p>
        </div>
      ),
    },
    {
      key: "when",
      header: "When",
      hideBelow: "sm",
      accessor: (c) => (
        <div className="min-w-0">
          <p className="whitespace-nowrap text-sm">{formatDate(c.campDate)}</p>
          <p className="text-xs text-muted-foreground">
            {[c.startTime, c.endTime].filter(Boolean).join("–") || "Full day"}
          </p>
        </div>
      ),
    },
    {
      key: "where",
      header: "Venue",
      hideBelow: "md",
      accessor: (c) => (
        <div className="min-w-0">
          <p className="truncate text-sm">{c.venue}</p>
          <p className="truncate text-xs text-muted-foreground">{c.city || "—"}</p>
        </div>
      ),
    },
    {
      key: "capacity",
      header: "Capacity",
      hideBelow: "lg",
      accessor: (c) => (
        <CapacityBar used={c.counts?.registrations ?? 0} total={c.capacity} />
      ),
    },
    {
      key: "status",
      header: "Status",
      accessor: (c) => <CampStatusBadge status={c.status} />,
    },
    {
      key: "actions",
      header: "",
      align: "right",
      className: "w-12",
      accessor: (c) => (
        <div className="flex justify-end" onClick={(e) => e.stopPropagation()}>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="size-8" aria-label={`Actions for camp ${c.title}`}>
                <MoreHorizontal className="size-4" aria-hidden="true" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44">
              <DropdownMenuItem onClick={() => setDetailId(c.id)}>
                <Tent className="size-4" aria-hidden="true" /> Open camp desk
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      ),
    },
  ];

  const filtersActive = q !== "" || status !== "ALL" || city.trim() !== "" || upcomingOnly;

  return (
    <div className="space-y-4">
      {/* toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full sm:w-60">
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search camps…"
            aria-label="Search camps"
            className="h-11 sm:h-9"
          />
        </div>
        <FilterChips
          label="Filter camps by status"
          options={["ALL", ...CAMP_STATUSES]}
          value={status}
          onChange={setStatus}
        />
        <Input
          value={city}
          onChange={(e) => setCity(e.target.value)}
          placeholder="City…"
          aria-label="Filter camps by city"
          className="h-11 w-28 sm:h-9 sm:w-24"
        />
        <button
          type="button"
          aria-pressed={upcomingOnly}
          onClick={() => setUpcomingOnly((v) => !v)}
          className={cn(
            "min-h-11 rounded-full border px-3 text-xs font-medium transition-colors sm:min-h-9",
            upcomingOnly
              ? "border-primary bg-primary/10 text-primary"
              : "border-border bg-background text-muted-foreground hover:bg-accent"
          )}
        >
          Upcoming only
        </button>
        <span className="text-xs tabular-nums text-muted-foreground" aria-live="polite">
          {loading ? "Loading…" : `${total} camp${total === 1 ? "" : "s"}`}
        </span>
        <div className="flex flex-wrap items-center gap-2 sm:ml-auto">
          <ExportMenu columns={csv} rows={rows} filename="uar-medical-camps" disabled={rows.length === 0} />
          <ViewSwitcher value={view} onChange={setView} options={["table", "grid"]} />
          <Button
            className="min-h-11 sm:min-h-9"
            onClick={() => {
              loadCampaigns();
              setNewOpen(true);
            }}
          >
            <CalendarPlus className="size-4" aria-hidden="true" /> New camp
          </Button>
        </div>
      </div>

      {error ? (
        <EmptyState
          icon={<Tent className="size-8" aria-hidden="true" />}
          title="Camps could not load"
          hint={error}
        >
          <Button variant="outline" size="sm" className="min-h-11" onClick={load}>
            Retry
          </Button>
        </EmptyState>
      ) : view === "table" ? (
        <DataTable
          columns={columns}
          rows={rows}
          rowKey={(c) => c.id}
          loading={loading}
          skeletonRows={6}
          height="fill"
          fillOffset={420}
          onRowClick={(c) => setDetailId(c.id)}
          page={page}
          pages={pages}
          total={total}
          pageSize={pageSize}
          onPage={setPage}
          itemLabel="camps"
          empty={
            <EmptyState
              icon={<Tent className="size-8" aria-hidden="true" />}
              title={filtersActive ? "No camps match these filters" : "No medical camps yet"}
              hint="Plan the first camp: set the date, venue and capacity, then open the camp desk to register beneficiaries and invite partner hospitals."
            >
              <Button size="sm" className="min-h-11" onClick={() => setNewOpen(true)}>
                <CalendarPlus className="size-4" aria-hidden="true" /> New camp
              </Button>
            </EmptyState>
          }
        />
      ) : loading ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3" aria-busy="true">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-44 rounded-xl" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <EmptyState
          icon={<Tent className="size-8" aria-hidden="true" />}
          title={filtersActive ? "No camps match these filters" : "No medical camps yet"}
          hint="Plan the first camp from the New camp button in the toolbar."
        />
      ) : (
        <div
          className="grid max-h-[36rem] gap-4 overflow-y-auto scrollbar-thin sm:grid-cols-2 xl:grid-cols-3"
          role="list"
          aria-label="Camps"
        >
          {rows.map((c) => (
            <div
              key={c.id}
              role="listitem"
              className="flex cursor-pointer flex-col gap-3 rounded-xl border bg-card p-4 shadow-sm transition-colors hover:bg-accent/40"
              onClick={() => setDetailId(c.id)}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="flex items-center gap-1.5 truncate text-sm font-semibold">
                    {c.status === "LIVE" ? <LiveDot /> : null}
                    <span className="truncate">{c.title}</span>
                  </p>
                  <p className="truncate font-mono text-[10px] text-muted-foreground/70">{c.code}</p>
                </div>
                <CampStatusBadge status={c.status} />
              </div>
              <div className="space-y-1 text-xs text-muted-foreground">
                <p className="flex items-center gap-1.5">
                  <Badge variant="outline" className="font-normal">{formatDate(c.campDate)}</Badge>
                  {[c.startTime, c.endTime].filter(Boolean).join("–")}
                </p>
                <p className="flex items-center gap-1.5 truncate">
                  <MapPin className="size-3.5 shrink-0" aria-hidden="true" />
                  <span className="truncate">{[c.venue, c.city].filter(Boolean).join(", ")}</span>
                </p>
              </div>
              <CapacityBar used={c.counts?.registrations ?? 0} total={c.capacity} />
            </div>
          ))}
        </div>
      )}

      {/* New camp FormSheet */}
      <FormSheet
        open={newOpen}
        onOpenChange={setNewOpen}
        title="Plan a medical camp"
        description="Schedule a camp, set capacity and services. Partners, staff and registrations are managed from the camp desk once it exists."
        size="lg"
        submitLabel="Create camp"
        loading={saving}
        dirty={Object.values(form).some((v) => v !== "")}
        onSubmit={create}
      >
        <FormSection title="Basics">
          <FieldGrid>
            <TextField label="Camp title" required value={form.title} onChange={(v) => setForm({ ...form, title: v })} placeholder="e.g. Free BP & Diabetes Screening — Yelahanka" />
            <TextField label="Camp date" required type="date" value={form.campDate} onChange={(v) => setForm({ ...form, campDate: v })} />
            <TextField label="Starts at" type="time" value={form.startTime} onChange={(v) => setForm({ ...form, startTime: v })} />
            <TextField label="Ends at" type="time" value={form.endTime} onChange={(v) => setForm({ ...form, endTime: v })} />
          </FieldGrid>
          <FieldGrid>
            <TextField label="Venue" required value={form.venue} onChange={(v) => setForm({ ...form, venue: v })} placeholder="Community hall address" />
            <TextField label="City" value={form.city} onChange={(v) => setForm({ ...form, city: v })} placeholder="Bengaluru" />
          </FieldGrid>
          <FieldGrid>
            <TextField label="Capacity" required inputMode="numeric" value={form.capacity} onChange={(v) => setForm({ ...form, capacity: v })} hint="Maximum registrations" />
            <TextField label="Coordinator" value={form.coordinatorName} onChange={(v) => setForm({ ...form, coordinatorName: v })} placeholder="On-ground coordinator" />
          </FieldGrid>
        </FormSection>

        <FormSection title="Services & budget">
          <TextField
            label="Services"
            value={form.services}
            onChange={(v) => setForm({ ...form, services: v })}
            placeholder="BP check, Blood sugar, ECG, Eye screening"
            hint="Comma-separated list shown on the camp card"
          />
          <FieldGrid>
            <TextField label="Budget (₹)" inputMode="decimal" value={form.budget} onChange={(v) => setForm({ ...form, budget: v })} placeholder="Optional" />
            <SelectField
              label="Link to campaign"
              value={form.campaignId}
              onChange={(v) => setForm({ ...form, campaignId: v })}
              options={[
                { value: "", label: "No campaign link" },
                ...campaigns.map((c) => ({ value: c.id, label: c.title })),
              ]}
            />
          </FieldGrid>
          <TextareaField
            label="Description"
            value={form.description}
            onChange={(v) => setForm({ ...form, description: v })}
            placeholder="What the camp offers, who should attend…"
            rows={3}
          />
        </FormSection>
      </FormSheet>

      <CampDetailSheet
        campId={detailId}
        open={!!detailId}
        onOpenChange={(o) => {
          if (!o) setDetailId(null);
        }}
        onChanged={load}
      />
    </div>
  );
}
