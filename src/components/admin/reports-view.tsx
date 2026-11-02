"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Download, FileBarChart, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { get } from "@/lib/api-client";
import { formatINR, formatDate, formatNumber, titleCase } from "@/lib/utils";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

/* ------------------------------ types & helpers ----------------------------- */

type Rec = Record<string, unknown>;
type ReportType = "overview" | "donations" | "distributions" | "causes" | "animals";

function pickNum(o: Rec | undefined, keys: string[], fb = 0): number {
  if (!o) return fb;
  for (const k of keys) {
    const v = o[k];
    if (typeof v === "number" && Number.isFinite(v)) return v;
    if (typeof v === "string" && v !== "" && Number.isFinite(Number(v))) return Number(v);
  }
  return fb;
}

function pickStr(o: Rec | undefined, keys: string[], fb = ""): string {
  if (!o) return fb;
  for (const k of keys) {
    const v = o[k];
    if (typeof v === "string" && v) return v;
  }
  return fb;
}

function asArray(v: unknown): Rec[] {
  if (Array.isArray(v)) return v as Rec[];
  if (v && typeof v === "object") {
    const o = v as Rec;
    if (Array.isArray(o.items)) return o.items as Rec[];
    if (Array.isArray(o.data)) return o.data as Rec[];
  }
  return [];
}

function downloadCsv(filename: string, rows: (string | number)[][]) {
  const csv = rows
    .map((r) => r.map((c) => `"${String(c ?? "").replace(/"/g, '""')}"`).join(","))
    .join("\n");
  const blob = new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function statusBadgeClass(status: string): string {
  switch (status) {
    case "ADOPTED":
    case "COMPLETED":
      return "bg-emerald-100 text-emerald-700";
    case "PARTIAL":
    case "FOSTERED":
      return "bg-amber-100 text-amber-700";
    case "PAUSED":
      return "bg-zinc-100 text-zinc-600";
    case "CRITICAL":
      return "bg-red-100 text-red-700";
    default:
      return "bg-teal-100 text-teal-700";
  }
}

const REPORT_TABS: { value: ReportType; label: string }[] = [
  { value: "overview", label: "Overview" },
  { value: "donations", label: "Donations" },
  { value: "distributions", label: "Distributions" },
  { value: "causes", label: "Causes" },
  { value: "animals", label: "Animals" },
];

/* ------------------------------- overview tab ------------------------------- */

function OverviewCharts({ data, loading }: { data: Rec | null; loading: boolean }) {
  const monthly = asArray(data?.monthly).map((m) => ({
    month: pickStr(m, ["month", "label", "name"], "—"),
    donations: pickNum(m, ["donations", "donationAmount", "amount", "raised"]),
    distributions: pickNum(m, ["distributions", "distributionCount", "distributionValue", "count"]),
  }));
  const byCampaign = asArray(data?.byCampaign)
    .map((c) => ({
      name: pickStr(c, ["name", "title", "campaign"]),
      raised: pickNum(c, ["raised", "amount", "value", "raisedAmount"]),
    }))
    .filter((c) => c.name)
    .slice(0, 8);
  const byType = asArray(data?.byType).map((t) => ({
    name: pickStr(t, ["name", "type", "label"], "Other"),
    count: pickNum(t, ["count", "value", "quantity"]),
  }));

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-64 w-full rounded-xl" />
        <div className="grid gap-4 lg:grid-cols-2">
          <Skeleton className="h-64 rounded-xl" />
          <Skeleton className="h-64 rounded-xl" />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Monthly donations vs distributions</CardTitle>
          <CardDescription>Two key operational lines over time</CardDescription>
        </CardHeader>
        <CardContent>
          {monthly.length === 0 ? (
            <div className="flex h-64 items-center justify-center text-sm text-muted-foreground">No data for this period</div>
          ) : (
            <div className="h-64 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={monthly} margin={{ top: 5, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e4e4e7" vertical={false} />
                  <XAxis dataKey="month" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
                  <YAxis tick={{ fontSize: 11 }} tickLine={false} axisLine={false} width={48} />
                  <Tooltip />
                  <Legend />
                  <Line type="monotone" dataKey="donations" name="Donations (₹)" stroke="#10b981" strokeWidth={2} dot={false} />
                  <Line type="monotone" dataKey="distributions" name="Distributions" stroke="#f59e0b" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Raised by campaign</CardTitle>
            <CardDescription>Donation totals per campaign in this period</CardDescription>
          </CardHeader>
          <CardContent>
            {byCampaign.length === 0 ? (
              <div className="flex h-56 items-center justify-center text-sm text-muted-foreground">No campaign data</div>
            ) : (
              <div className="h-56 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={byCampaign} margin={{ top: 5, right: 8, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e4e4e7" vertical={false} />
                    <XAxis
                      dataKey="name"
                      tick={{ fontSize: 10 }}
                      tickLine={false}
                      axisLine={false}
                      interval={0}
                      tickFormatter={(v: string) => (v.length > 12 ? `${v.slice(0, 11)}…` : v)}
                    />
                    <YAxis tick={{ fontSize: 11 }} tickLine={false} axisLine={false} tickFormatter={(v: number) => formatINR(v)} width={56} />
                    <Tooltip formatter={(v) => [formatINR(Number(v)), "Raised"]} />
                    <Bar dataKey="raised" fill="#10b981" radius={[6, 6, 0, 0]} maxBarSize={40} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Distributions by type</CardTitle>
            <CardDescription>Volume of aid distributed per category</CardDescription>
          </CardHeader>
          <CardContent>
            {byType.length === 0 ? (
              <div className="flex h-56 items-center justify-center text-sm text-muted-foreground">No distribution data</div>
            ) : (
              <div className="h-56 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={byType} layout="vertical" margin={{ top: 5, right: 16, left: 8, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e4e4e7" horizontal={false} />
                    <XAxis type="number" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
                    <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} width={96} />
                    <Tooltip formatter={(v) => [formatNumber(Number(v)), "Count"]} />
                    <Bar dataKey="count" fill="#f59e0b" radius={[0, 6, 6, 0]} maxBarSize={20} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

/* ---------------------------------- view ----------------------------------- */

export default function ReportsView() {
  const [type, setType] = useState<ReportType>("overview");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [data, setData] = useState<Rec | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ type });
      if (from) params.set("from", from);
      if (to) params.set("to", to);
      const res = await get<Rec>(`/api/reports?${params.toString()}`);
      setData(res ?? {});
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load report");
      setData({});
    } finally {
      setLoading(false);
    }
  }, [type, from, to]);

  useEffect(() => {
    load();
  }, [load]);

  const donationsRows = useMemo(() => asArray(data?.donations ?? (type === "donations" ? data : null)), [data, type]);
  const distributionRows = useMemo(() => asArray(data?.distributions ?? (type === "distributions" ? data : null)), [data, type]);
  const causeRows = useMemo(() => asArray(data?.causes ?? (type === "causes" ? data : null)), [data, type]);
  const animalRows = useMemo(() => asArray(data?.animals ?? (type === "animals" ? data : null)), [data, type]);

  const exportCsv = () => {
    const stamp = new Date().toISOString().slice(0, 10);
    if (type === "overview") {
      const monthly = asArray(data?.monthly);
      downloadCsv(`uar-report-overview-${stamp}.csv`, [
        ["Month", "Donations", "Distributions"],
        ...monthly.map((m) => [
          pickStr(m, ["month", "label", "name"]),
          pickNum(m, ["donations", "donationAmount", "amount", "raised"]),
          pickNum(m, ["distributions", "distributionCount", "distributionValue", "count"]),
        ]),
      ]);
    } else if (type === "donations") {
      downloadCsv(`uar-report-donations-${stamp}.csv`, [
        ["Receipt", "Donor", "Campaign", "Amount", "Type", "Status", "Date"],
        ...donationsRows.map((d) => [
          pickStr(d, ["receiptNumber"]),
          pickStr(d, ["donorName"]),
          typeof d.campaign === "object" && d.campaign ? pickStr(d.campaign as Rec, ["title"]) : pickStr(d, ["campaignTitle"]),
          pickNum(d, ["amount"]),
          pickStr(d, ["type"]),
          pickStr(d, ["paymentStatus"]),
          formatDate(pickStr(d, ["createdAt"])),
        ]),
      ]);
    } else if (type === "distributions") {
      downloadCsv(`uar-report-distributions-${stamp}.csv`, [
        ["Type", "Quantity", "Value", "Location", "Date"],
        ...distributionRows.map((d) => [
          pickStr(d, ["type"]),
          pickNum(d, ["quantity"]),
          pickNum(d, ["value"]),
          pickStr(d, ["location"]),
          formatDate(pickStr(d, ["distributedAt", "createdAt"])),
        ]),
      ]);
    } else if (type === "causes") {
      downloadCsv(`uar-report-causes-${stamp}.csv`, [
        ["Code", "Patient", "City", "Condition", "Monthly Cost", "Duration (months)", "Raised", "Status"],
        ...causeRows.map((c) => [
          pickStr(c, ["code"]),
          pickStr(c, ["patientName"]),
          pickStr(c, ["city"]),
          pickStr(c, ["condition"]),
          pickNum(c, ["monthlyCost"]),
          pickNum(c, ["durationMonths"]),
          pickNum(c, ["raised"]),
          pickStr(c, ["status"]),
        ]),
      ]);
    } else {
      downloadCsv(`uar-report-animals-${stamp}.csv`, [
        ["Name", "Species", "Location", "Monthly Food", "Status"],
        ...animalRows.map((a) => [
          pickStr(a, ["name"]),
          pickStr(a, ["species"]),
          pickStr(a, ["location"]),
          pickNum(a, ["monthlyFood"]),
          pickStr(a, ["status"]),
        ]),
      ]);
    }
    toast.success("Report exported to CSV");
  };

  const donationsTotal = donationsRows.reduce((s, d) => s + pickNum(d, ["amount"]), 0);
  const donationsCollected = donationsRows
    .filter((d) => pickStr(d, ["paymentStatus"]) === "COMPLETED")
    .reduce((s, d) => s + pickNum(d, ["amount"]), 0);
  const distTotalValue = distributionRows.reduce((s, d) => s + pickNum(d, ["value"]), 0);
  const distTotalQty = distributionRows.reduce((s, d) => s + pickNum(d, ["quantity"]), 0);
  const causesMonthly = causeRows.reduce((s, c) => s + pickNum(c, ["monthlyCost"]), 0);
  const animalsMonthly = animalRows.reduce((s, a) => s + pickNum(a, ["monthlyFood"]), 0);

  return (
    <div className="space-y-4">
      {/* Controls */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <Tabs value={type} onValueChange={(v) => setType(v as ReportType)}>
          <TabsList className="h-auto w-full flex-wrap justify-start sm:w-auto">
            {REPORT_TABS.map((t) => (
              <TabsTrigger key={t.value} value={t.value} className="px-3">
                {t.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <div className="flex flex-wrap items-end gap-2">
          <div className="grid gap-1">
            <Label htmlFor="r-from" className="text-xs text-muted-foreground">From</Label>
            <Input id="r-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="h-9 w-40" />
          </div>
          <div className="grid gap-1">
            <Label htmlFor="r-to" className="text-xs text-muted-foreground">To</Label>
            <Input id="r-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} className="h-9 w-40" />
          </div>
          <Button variant="outline" onClick={load} disabled={loading} aria-label="Refresh report">
            <RefreshCw className={loading ? "size-4 animate-spin" : "size-4"} /> Refresh
          </Button>
          <Button onClick={exportCsv} aria-label="Export report to CSV">
            <Download className="size-4" /> CSV
          </Button>
        </div>
      </div>

      {/* Content */}
      {type === "overview" && <OverviewCharts data={data} loading={loading} />}

      {type === "donations" && (
        <Card className="py-0">
          <CardHeader className="flex-row items-center justify-between space-y-0 py-4">
            <div>
              <CardTitle className="text-base">Donation report</CardTitle>
              <CardDescription>
                {formatNumber(donationsRows.length)} donations · collected {formatINR(donationsCollected)} · gross {formatINR(donationsTotal)}
              </CardDescription>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {loading ? (
              <div className="space-y-2 p-4">
                {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-11 w-full" />)}
              </div>
            ) : donationsRows.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
                <FileBarChart className="size-8" aria-hidden="true" />
                <p className="font-medium text-foreground">No donations in this period</p>
              </div>
            ) : (
              <div className="max-h-[32rem] overflow-auto scrollbar-thin">
                <Table>
                  <TableHeader className="sticky top-0 bg-background">
                    <TableRow>
                      <TableHead>Receipt</TableHead>
                      <TableHead>Donor</TableHead>
                      <TableHead className="hidden md:table-cell">Campaign</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="hidden sm:table-cell">Date</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {donationsRows.map((d, i) => {
                      const status = pickStr(d, ["paymentStatus"], "PENDING");
                      return (
                        <TableRow key={pickStr(d, ["id"], `d-${i}`)}>
                          <TableCell className="whitespace-nowrap font-mono text-xs">{pickStr(d, ["receiptNumber"], "—")}</TableCell>
                          <TableCell>{pickStr(d, ["donorName"], "—")}</TableCell>
                          <TableCell className="hidden max-w-40 truncate md:table-cell">
                            {typeof d.campaign === "object" && d.campaign ? pickStr(d.campaign as Rec, ["title"]) : pickStr(d, ["campaignTitle"]) || "General"}
                          </TableCell>
                          <TableCell className="whitespace-nowrap text-right font-semibold">{formatINR(pickNum(d, ["amount"]))}</TableCell>
                          <TableCell>
                            <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold ${status === "COMPLETED" ? "bg-emerald-100 text-emerald-700" : status === "PENDING" ? "bg-amber-100 text-amber-700" : "bg-red-100 text-red-700"}`}>
                              {titleCase(status)}
                            </span>
                          </TableCell>
                          <TableCell className="hidden whitespace-nowrap text-sm sm:table-cell">{formatDate(pickStr(d, ["createdAt"]))}</TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {type === "distributions" && (
        <Card className="py-0">
          <CardHeader className="py-4">
            <CardTitle className="text-base">Distribution report</CardTitle>
            <CardDescription>
              {formatNumber(distributionRows.length)} distributions · {formatNumber(distTotalQty)} items · {formatINR(distTotalValue)} value
            </CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            {loading ? (
              <div className="space-y-2 p-4">
                {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-11 w-full" />)}
              </div>
            ) : distributionRows.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
                <FileBarChart className="size-8" aria-hidden="true" />
                <p className="font-medium text-foreground">No distributions in this period</p>
              </div>
            ) : (
              <div className="max-h-[32rem] overflow-auto scrollbar-thin">
                <Table>
                  <TableHeader className="sticky top-0 bg-background">
                    <TableRow>
                      <TableHead>Type</TableHead>
                      <TableHead className="text-right">Quantity</TableHead>
                      <TableHead className="text-right">Value</TableHead>
                      <TableHead className="hidden md:table-cell">Location</TableHead>
                      <TableHead className="hidden sm:table-cell">Date</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {distributionRows.map((d, i) => (
                      <TableRow key={pickStr(d, ["id"], `dist-${i}`)}>
                        <TableCell className="font-medium">{titleCase(pickStr(d, ["type"], "OTHER"))}</TableCell>
                        <TableCell className="text-right">{formatNumber(pickNum(d, ["quantity"]))}</TableCell>
                        <TableCell className="text-right">{pickNum(d, ["value"]) ? formatINR(pickNum(d, ["value"])) : "—"}</TableCell>
                        <TableCell className="hidden md:table-cell">{pickStr(d, ["location"], "—")}</TableCell>
                        <TableCell className="hidden whitespace-nowrap text-sm sm:table-cell">{formatDate(pickStr(d, ["distributedAt", "createdAt"]))}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {type === "causes" && (
        <Card className="py-0">
          <CardHeader className="py-4">
            <CardTitle className="text-base">Adopt-a-Medicine report</CardTitle>
            <CardDescription>
              {formatNumber(causeRows.length)} causes · {formatINR(causesMonthly)} monthly medication need
            </CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            {loading ? (
              <div className="space-y-2 p-4">
                {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-11 w-full" />)}
              </div>
            ) : causeRows.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
                <FileBarChart className="size-8" aria-hidden="true" />
                <p className="font-medium text-foreground">No causes in this period</p>
              </div>
            ) : (
              <div className="max-h-[32rem] overflow-auto scrollbar-thin">
                <Table>
                  <TableHeader className="sticky top-0 bg-background">
                    <TableRow>
                      <TableHead>Code</TableHead>
                      <TableHead>Patient</TableHead>
                      <TableHead className="hidden md:table-cell">Condition</TableHead>
                      <TableHead className="text-right">Monthly cost</TableHead>
                      <TableHead className="text-right hidden sm:table-cell">Raised</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {causeRows.map((c, i) => {
                      const status = pickStr(c, ["status"], "SEEKING");
                      return (
                        <TableRow key={pickStr(c, ["id"], `cause-${i}`)}>
                          <TableCell className="whitespace-nowrap font-mono text-xs">{pickStr(c, ["code"], "—")}</TableCell>
                          <TableCell>
                            <p className="font-medium">{pickStr(c, ["patientName"], "—")}</p>
                            <p className="text-xs text-muted-foreground">{pickStr(c, ["city"])}</p>
                          </TableCell>
                          <TableCell className="hidden md:table-cell">{titleCase(pickStr(c, ["condition"]))}</TableCell>
                          <TableCell className="whitespace-nowrap text-right">{formatINR(pickNum(c, ["monthlyCost"]))}</TableCell>
                          <TableCell className="hidden whitespace-nowrap text-right sm:table-cell">{formatINR(pickNum(c, ["raised"]))}</TableCell>
                          <TableCell>
                            <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold ${statusBadgeClass(status)}`}>
                              {titleCase(status)}
                            </span>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {type === "animals" && (
        <Card className="py-0">
          <CardHeader className="py-4">
            <CardTitle className="text-base">Animal welfare report</CardTitle>
            <CardDescription>
              {formatNumber(animalRows.length)} animals · {formatINR(animalsMonthly)} monthly food need
            </CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            {loading ? (
              <div className="space-y-2 p-4">
                {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-11 w-full" />)}
              </div>
            ) : animalRows.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
                <FileBarChart className="size-8" aria-hidden="true" />
                <p className="font-medium text-foreground">No animals in this period</p>
              </div>
            ) : (
              <div className="max-h-[32rem] overflow-auto scrollbar-thin">
                <Table>
                  <TableHeader className="sticky top-0 bg-background">
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>Species</TableHead>
                      <TableHead className="hidden md:table-cell">Location</TableHead>
                      <TableHead className="text-right">Monthly food</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {animalRows.map((a, i) => {
                      const status = pickStr(a, ["status"], "AVAILABLE");
                      return (
                        <TableRow key={pickStr(a, ["id"], `animal-${i}`)}>
                          <TableCell className="font-medium">{pickStr(a, ["name"], "—")}</TableCell>
                          <TableCell>{titleCase(pickStr(a, ["species"]))}</TableCell>
                          <TableCell className="hidden md:table-cell">{pickStr(a, ["location"], "—")}</TableCell>
                          <TableCell className="whitespace-nowrap text-right">{formatINR(pickNum(a, ["monthlyFood"]))}</TableCell>
                          <TableCell>
                            <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold ${statusBadgeClass(status)}`}>
                              {titleCase(status)}
                            </span>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
