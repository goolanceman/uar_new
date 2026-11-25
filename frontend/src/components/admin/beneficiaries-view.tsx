"use client";

/**
 * Beneficiaries — round-5: DataTable (fill height, skeleton rows, built-in
 * pagination), 75%-width DetailSheet with every case field + distribution
 * history table, `full` FormSheet organised into identity → household &
 * economy → needs & urgency → notes & consent (+ case workflow), grid/list
 * views, filter chips and CSV export.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  AlertTriangle,
  BadgeCheck,
  Boxes,
  ClipboardList,
  Eye,
  FileSearch,
  FileText,
  HeartHandshake,
  Inbox,
  MapPin,
  Pencil,
  Phone,
  Plus,
  RefreshCw,
  Send,
  Siren,
  Trash2,
  UserRound,
} from "lucide-react";
import { toast } from "sonner";
import { del, get, patch, post } from "@/lib/api-client";
import {
  CASE_STATUSES,
  CASE_STATUS_TRANSITIONS,
  VERIFICATION_STATUSES,
  VERIFICATION_STATUS_TRANSITIONS,
} from "@/lib/beneficiaries";
import { formatDateTime, formatINR, titleCase } from "@/lib/format";
import {
  amountRule,
  dateRule,
  emailRule,
  phoneRule,
  pinRule,
  required,
} from "@/lib/validators";
import { labelOf, useMasters } from "@/hooks/use-masters";
import { PageHeader } from "@/components/shared/page-header";
import { StatCard } from "@/components/shared/stat-card";
import { DataField } from "@/components/shared/data-field";
import { EmptyState } from "@/components/shared/empty-state";
import { FormSheet } from "@/components/shared/form-sheet";
import {
  DetailGrid,
  DetailSection,
  DetailSheet,
} from "@/components/shared/detail-sheet";
import {
  FieldGrid,
  FormSection,
  SelectField,
  SwitchField,
  TextField,
  TextareaField,
} from "@/components/shared/form-fields";
import { StatusBadge, humanize } from "@/components/shared/status-badge";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { ExportMenu, type CsvColumn } from "@/components/shared/csv";
import {
  PaginationBar,
  ViewSwitcher,
  useViewPref,
  type DataViewMode,
} from "@/components/shared/view-switcher";
import {
  DataTable,
  type DataTableColumn,
} from "@/components/shared/data-table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAuth } from "@/hooks/use-auth";

/* ------------------------------ types & constants --------------------------- */

interface Beneficiary {
  id: string;
  code: string;
  name: string;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  pincode?: string | null;
  category: string;
  urgencyLevel: string;
  familyMembers: number;
  monthlyIncome?: number | null;
  monthlyNeed?: number | null;
  needs?: string | null;
  documents?: string | null;
  notes?: string | null;
  isActive: boolean;
  onboardedByName?: string | null;
  caseStatus: string;
  caseWorker?: string | null;
  verificationStatus: string;
  guardian?: string | null;
  age?: number | null;
  gender?: string | null;
  photoConsent: boolean;
  intakeDate?: string | null;
  createdAt?: string;
  _count?: { recurringNeeds: number };
}

interface DistributionRow {
  id: string;
  type: string;
  beneficiaryId?: string | null;
  quantity: number;
  value?: number | null;
  location?: string | null;
  distributedAt: string;
  items?: string | null;
  kitBatchId?: string | null;
  kitQuantity?: number | null;
  notes?: string | null;
  beneficiary?: { name: string } | null;
  volunteer?: { user?: { name: string } | null } | null;
}

function parseDistItems(json: string | null | undefined): { name: string; qty: number; unit?: string }[] {
  if (!json) return [];
  try {
    const parsed = JSON.parse(json);
    if (!Array.isArray(parsed)) return [];
    return parsed.map((i: Record<string, unknown>) => ({
      name: String(i?.name ?? ""),
      qty: Number(i?.qty ?? 0),
      unit: i?.unit ? String(i.unit) : undefined,
    }));
  } catch {
    return [];
  }
}

interface BenRequest {
  id: string;
  beneficiaryId?: string | null;
  name: string;
  category: string;
  urgency: string;
  details: string;
  status: string;
  createdAt: string;
}

interface RecurringNeedRow {
  id: string;
  itemId: string;
  qtyPerCycle: number;
  cycle: string;
  status: string;
  reason?: string | null;
  nextDueAt: string;
  lastFulfilledAt?: string | null;
  item: { id: string; name: string; unit: string; quantity: number; minStock: number };
}

interface MatchSuggestion {
  recurringNeedId: string;
  beneficiaryId: string;
  beneficiaryName: string;
  beneficiaryCity: string | null;
  urgencyLevel: string;
  itemName: string;
  unit: string;
  qtyPerCycle: number;
  cycle: string;
  suggestedAmountPerMonth: number;
  donorId: string;
  donorName: string;
  donorEmail: string;
}

interface SponsorshipRow {
  id: string;
  donorId?: string | null;
  donorName: string;
  amountPerMonth: number;
  months: number;
  status: string;
  source: string;
  recurringNeedId?: string | null;
  startDate: string;
  donor?: { id: string; name: string; email: string } | null;
  recurringNeed?: { id: string; item: { id: string; name: string; unit: string } } | null;
}

interface CaseNote {
  id: string;
  note: string;
  authorName?: string | null;
  createdAt: string;
}

const URGENCIES = ["LOW", "MEDIUM", "HIGH", "CRITICAL"] as const;
const GENDERS = ["MALE", "FEMALE", "OTHER"] as const;

/** Canonical schema enum — the POST/PATCH APIs validate against these. */
const BENEFICIARY_CATEGORIES: Array<{ value: string; label: string }> = [
  { value: "WIDOW", label: "Widow" },
  { value: "ORPHAN", label: "Orphan" },
  { value: "STUDENT", label: "Student" },
  { value: "ELDERLY", label: "Elderly" },
  { value: "DISABLED", label: "Differently abled" },
  { value: "SINGLE_MOTHER", label: "Single mother" },
  { value: "POOR_FAMILY", label: "Poor family" },
  { value: "PATIENT", label: "Patient" },
  { value: "DAILY_WAGE", label: "Daily wage worker" },
  { value: "OTHER", label: "Other" },
];

const NEXT_CASE_STATUS: Record<string, string> = {
  INTAKE: "VERIFICATION",
  VERIFICATION: "ACTIVE",
};

function urgencyTone(u?: string | null) {
  switch ((u ?? "").toUpperCase()) {
    case "CRITICAL":
      return "danger" as const;
    case "HIGH":
      return "warning" as const;
    case "MEDIUM":
      return "progress" as const;
    default:
      return "success" as const;
  }
}

function toDateInput(d?: string | null): string {
  if (!d) return "";
  const dt = new Date(d);
  return Number.isNaN(dt.getTime()) ? "" : dt.toISOString().slice(0, 10);
}

/* --------------------------------- form state ------------------------------- */

interface BenForm {
  name: string;
  guardian: string;
  age: string;
  gender: string;
  phone: string;
  email: string;
  address: string;
  city: string;
  state: string;
  pincode: string;
  category: string;
  urgencyLevel: string;
  caseStatus: string;
  verificationStatus: string;
  caseWorker: string;
  intakeDate: string;
  photoConsent: boolean;
  familyMembers: string;
  monthlyIncome: string;
  monthlyNeed: string;
  needs: string;
  documents: string;
  notes: string;
}

const emptyForm: BenForm = {
  name: "",
  guardian: "",
  age: "",
  gender: "",
  phone: "",
  email: "",
  address: "",
  city: "",
  state: "",
  pincode: "",
  category: "OTHER",
  urgencyLevel: "MEDIUM",
  caseStatus: "INTAKE",
  verificationStatus: "PENDING",
  caseWorker: "",
  intakeDate: "",
  photoConsent: false,
  familyMembers: "1",
  monthlyIncome: "",
  monthlyNeed: "",
  needs: "",
  documents: "",
  notes: "",
};

function formFromRow(b: Beneficiary): BenForm {
  return {
    name: b.name ?? "",
    guardian: b.guardian ?? "",
    age: b.age !== null && b.age !== undefined ? String(b.age) : "",
    gender: b.gender ?? "",
    phone: b.phone ?? "",
    email: b.email ?? "",
    address: b.address ?? "",
    city: b.city ?? "",
    state: b.state ?? "",
    pincode: b.pincode ?? "",
    category: b.category ?? "OTHER",
    urgencyLevel: b.urgencyLevel ?? "MEDIUM",
    caseStatus: b.caseStatus ?? "INTAKE",
    verificationStatus: b.verificationStatus ?? "PENDING",
    caseWorker: b.caseWorker ?? "",
    intakeDate: toDateInput(b.intakeDate),
    photoConsent: Boolean(b.photoConsent),
    familyMembers: String(b.familyMembers ?? 1),
    monthlyIncome:
      b.monthlyIncome !== null && b.monthlyIncome !== undefined ? String(b.monthlyIncome) : "",
    monthlyNeed:
      b.monthlyNeed !== null && b.monthlyNeed !== undefined ? String(b.monthlyNeed) : "",
    needs: b.needs ?? "",
    documents: b.documents ?? "",
    notes: b.notes ?? "",
  };
}

/* ----------------------------------- view ----------------------------------- */

export default function BeneficiariesView() {
  const { user } = useAuth();
  const isAdmin = user?.role === "ADMIN";

  const [rows, setRows] = useState<Beneficiary[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // toolbar
  const [q, setQ] = useState("");
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("ALL");
  const [caseFilter, setCaseFilter] = useState("ALL");
  const [recurringFilter, setRecurringFilter] = useState(false);
  const [verFilter, setVerFilter] = useState("ALL");

  // pagination + view mode
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [mode, setMode] = useViewPref("beneficiaries");

  // create / edit
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Beneficiary | null>(null);
  const [form, setForm] = useState<BenForm>({ ...emptyForm });
  const [snapshot, setSnapshot] = useState<string>(JSON.stringify(emptyForm));

  // detail sheet + tabs data
  const [viewTarget, setViewTarget] = useState<Beneficiary | null>(null);
  const [notes, setNotes] = useState<CaseNote[]>([]);
  const [notesLoading, setNotesLoading] = useState(false);
  const [noteText, setNoteText] = useState("");
  const [noteSaving, setNoteSaving] = useState(false);
  const [assist, setAssist] = useState<DistributionRow[]>([]);
  const [assistLoading, setAssistLoading] = useState(false);
  const [requests, setRequests] = useState<BenRequest[]>([]);
  const [requestsLoading, setRequestsLoading] = useState(false);

  // recurring (monthly) needs
  const [recNeeds, setRecNeeds] = useState<RecurringNeedRow[]>([]);
  const [recLoading, setRecLoading] = useState(false);
  const [recItems, setRecItems] = useState<{ id: string; name: string; unit: string; quantity: number }[]>([]);
  const [newNeed, setNewNeed] = useState({ itemId: "", qtyPerCycle: "1", cycle: "MONTHLY", reason: "" });
  const [savingNeed, setSavingNeed] = useState(false);
  const [fulfillingId, setFulfillingId] = useState<string | null>(null);

  // monthly-support sponsorships (donor → beneficiary) — manual assign + auto-match
  const [sponsorships, setSponsorships] = useState<SponsorshipRow[]>([]);
  const [donorOptions, setDonorOptions] = useState<{ id: string; name: string; email: string; category?: string | null }[]>([]);
  const [newSponsor, setNewSponsor] = useState({ donorId: "", recurringNeedId: "", amountPerMonth: "", months: "6" });
  const [savingSponsor, setSavingSponsor] = useState(false);

  // auto-match engine: suggested donor ↔ beneficiary pairings (Phase C)
  const [matchOpen, setMatchOpen] = useState(false);
  const [matchLoading, setMatchLoading] = useState(false);
  const [matchSuggestions, setMatchSuggestions] = useState<MatchSuggestion[]>([]);
  const [matchMeta, setMatchMeta] = useState({ enabled: true, unmatchedNeeds: 0, availableDonors: 0 });
  const [assigningKey, setAssigningKey] = useState<string | null>(null);
  const reqCache = useRef<BenRequest[] | null>(null);

  // destructive confirms
  const [deleteTarget, setDeleteTarget] = useState<Beneficiary | null>(null);
  const [closeTarget, setCloseTarget] = useState<Beneficiary | null>(null);
  const [rejectTarget, setRejectTarget] = useState<Beneficiary | null>(null);

  // MDM category options (masters first, canonical 10 fallback merged in)
  const { options: mastersCategoryOptions } = useMasters("BENEFICIARY_CATEGORY");
  const categoryOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const c of BENEFICIARY_CATEGORIES) map.set(c.value, c.label);
    for (const o of mastersCategoryOptions) {
      if (map.has(o.value)) map.set(o.value, o.label);
    }
    return Array.from(map, ([value, label]) => ({ value, label }));
  }, [mastersCategoryOptions]);

  /* -------------------------------- loading -------------------------------- */

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await get<Beneficiary[]>("/api/beneficiaries");
      setRows(Array.isArray(data) ? data : []);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load beneficiaries");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const t = setTimeout(() => setSearch(q), 300);
    return () => clearTimeout(t);
  }, [q]);

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return rows.filter((b) => {
      if (categoryFilter !== "ALL" && b.category !== categoryFilter) return false;
      if (caseFilter !== "ALL" && (b.caseStatus ?? "INTAKE") !== caseFilter) return false;
      if (verFilter !== "ALL" && (b.verificationStatus ?? "PENDING") !== verFilter) return false;
      if (recurringFilter && (b._count?.recurringNeeds ?? 0) <= 0) return false;
      if (
        needle &&
        !`${b.name} ${b.guardian ?? ""} ${b.phone ?? ""} ${b.city ?? ""} ${b.caseWorker ?? ""}`
          .toLowerCase()
          .includes(needle)
      )
        return false;
      return true;
    });
  }, [rows, search, categoryFilter, caseFilter, verFilter, recurringFilter]);

  const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
  useEffect(() => {
    setPage(1);
  }, [search, categoryFilter, caseFilter, verFilter, recurringFilter, pageSize]);
  const paged = useMemo(
    () => filtered.slice((page - 1) * pageSize, page * pageSize),
    [filtered, page, pageSize]
  );

  const stats = useMemo(
    () => ({
      total: rows.length,
      active: rows.filter((b) => (b.caseStatus ?? "INTAKE") === "ACTIVE").length,
      awaitingVerification: rows.filter(
        (b) => (b.verificationStatus ?? "PENDING") === "PENDING"
      ).length,
      critical: rows.filter((b) => b.urgencyLevel === "CRITICAL").length,
    }),
    [rows]
  );

  const hasFilters =
    categoryFilter !== "ALL" ||
    caseFilter !== "ALL" ||
    verFilter !== "ALL" ||
    recurringFilter ||
    search.trim() !== "";

  const clearFilters = () => {
    setQ("");
    setCategoryFilter("ALL");
    setCaseFilter("ALL");
    setVerFilter("ALL");
    setRecurringFilter(false);
  };

  /* ------------------------------ create / edit ----------------------------- */

  const openCreate = () => {
    setEditing(null);
    setForm({ ...emptyForm });
    setSnapshot(JSON.stringify(emptyForm));
    setFormOpen(true);
  };

  const openEdit = (b: Beneficiary) => {
    setEditing(b);
    const next = formFromRow(b);
    setForm(next);
    setSnapshot(JSON.stringify(next));
    setFormOpen(true);
  };

  const dirty = formOpen && JSON.stringify(form) !== snapshot;

  const submitForm = async () => {
    const errors: string[] = [];
    const nameErr = required("Name")(form.name);
    if (nameErr) errors.push(nameErr);
    const phoneErr = phoneRule()(form.phone);
    if (phoneErr) errors.push(phoneErr);
    const emailErr = emailRule(true)(form.email);
    if (emailErr) errors.push(emailErr);
    const pinErr = pinRule()(form.pincode);
    if (pinErr) errors.push(pinErr);
    if (form.age) {
      const age = Number(form.age);
      if (!Number.isFinite(age) || age < 1 || age > 120)
        errors.push("Age must be between 1 and 120");
    }
    const incomeErr = amountRule({ optional: true, label: "Monthly income" })(form.monthlyIncome);
    if (incomeErr) errors.push(incomeErr);
    const needErr = amountRule({ optional: true, label: "Monthly need" })(form.monthlyNeed);
    if (needErr) errors.push(needErr);
    const dateErr = dateRule(true)(form.intakeDate);
    if (dateErr) errors.push(dateErr);
    if (errors.length) {
      toast.error(errors[0]);
      return;
    }

    const payload = {
      name: form.name.trim(),
      guardian: form.guardian.trim() || null,
      age: form.age ? Math.trunc(Number(form.age)) : null,
      gender: form.gender || null,
      phone: form.phone.trim() || null,
      email: form.email.trim() || null,
      address: form.address.trim() || null,
      city: form.city.trim() || null,
      state: form.state.trim() || null,
      pincode: form.pincode.trim() || null,
      category: form.category,
      urgencyLevel: form.urgencyLevel,
      caseStatus: form.caseStatus,
      verificationStatus: form.verificationStatus,
      caseWorker: form.caseWorker.trim() || null,
      intakeDate: form.intakeDate ? new Date(form.intakeDate).toISOString() : null,
      photoConsent: form.photoConsent,
      familyMembers: Math.max(1, Math.trunc(Number(form.familyMembers) || 1)),
      monthlyIncome: form.monthlyIncome ? Number(form.monthlyIncome) : null,
      monthlyNeed: form.monthlyNeed ? Number(form.monthlyNeed) : null,
      needs: form.needs.trim() || null,
      documents: form.documents.trim() || null,
      notes: form.notes.trim() || null,
    };

    setSaving(true);
    try {
      if (editing) {
        const updated = await patch<Beneficiary>(`/api/beneficiaries/${editing.id}`, payload);
        setRows((r) => r.map((x) => (x.id === editing.id ? { ...x, ...updated } : x)));
        setViewTarget((v) => (v && v.id === editing.id ? { ...v, ...updated } : v));
        toast.success(`${payload.name} updated`);
      } else {
        await post("/api/beneficiaries", payload);
        toast.success(`${payload.name} added to the case register`);
        await load();
      }
      setFormOpen(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to save beneficiary");
    } finally {
      setSaving(false);
    }
  };

  /* ----------------------------- quick case actions ------------------------- */

  const quickPatch = useCallback(
    async (b: Beneficiary, body: Record<string, unknown>, successMsg: string) => {
      try {
        const updated = await patch<Beneficiary>(`/api/beneficiaries/${b.id}`, body);
        setRows((r) => r.map((x) => (x.id === b.id ? { ...x, ...updated } : x)));
        setViewTarget((v) => (v && v.id === b.id ? { ...v, ...updated } : v));
        toast.success(successMsg);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Action failed");
      }
    },
    []
  );

  const advanceCase = (b: Beneficiary) => {
    const next = NEXT_CASE_STATUS[b.caseStatus ?? "INTAKE"];
    if (next) void quickPatch(b, { caseStatus: next }, `${b.name} → ${humanize(next)}`);
  };

  const confirmCloseCase = async () => {
    if (!closeTarget) return;
    await quickPatch(closeTarget, { caseStatus: "CLOSED" }, "Case closed");
    setCloseTarget(null);
  };

  const confirmRejectCase = async () => {
    if (!rejectTarget) return;
    await quickPatch(rejectTarget, { caseStatus: "REJECTED" }, "Case rejected");
    setRejectTarget(null);
  };

  const markVerified = (b: Beneficiary) =>
    void quickPatch(b, { verificationStatus: "VERIFIED" }, `${b.name} marked verified`);

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    try {
      await del(`/api/beneficiaries/${deleteTarget.id}`);
      toast.success("Beneficiary removed");
      setDeleteTarget(null);
      setViewTarget((v) => (v && v.id === deleteTarget.id ? null : v));
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to delete beneficiary");
    }
  };

  /* ------------------------------ detail sheet ------------------------------ */

  const openView = (b: Beneficiary) => {
    setViewTarget(b);
    setNoteText("");
    // case notes
    setNotesLoading(true);
    setNotes([]);
    get<CaseNote[]>(`/api/beneficiaries/${b.id}/notes`)
      .then((data) => setNotes(Array.isArray(data) ? data : []))
      .catch(() => toast.error("Could not load case notes"))
      .finally(() => setNotesLoading(false));
    // assistance history — fetched scoped to this beneficiary so heavily-served
    // cases don't fall off a global "first 200 distributions" page.
    setAssistLoading(true);
    setAssist([]);
    get<DistributionRow[]>(`/api/distributions?beneficiaryId=${b.id}&limit=200`)
      .then((d) => setAssist(Array.isArray(d) ? d : []))
      .catch(() => toast.error("Could not load assistance history"))
      .finally(() => setAssistLoading(false));
    // requests (shared fetch, cached)
    setRequestsLoading(true);
    setRequests([]);
    const reqPromise = reqCache.current
      ? Promise.resolve(reqCache.current)
      : get<BenRequest[]>("/api/beneficiary-requests").then((d) => {
          const list = Array.isArray(d) ? d : [];
          reqCache.current = list;
          return list;
        });
    reqPromise
      .then((list) => setRequests(list.filter((r) => r.beneficiaryId === b.id)))
      .catch(() => toast.error("Could not load requests"))
      .finally(() => setRequestsLoading(false));
    // recurring needs + the inventory master (for the "add need" picker)
    setRecLoading(true);
    setRecNeeds([]);
    setNewNeed({ itemId: "", qtyPerCycle: "1", cycle: "MONTHLY", reason: "" });
    Promise.all([
      get<RecurringNeedRow[]>(`/api/recurring-needs?beneficiaryId=${b.id}`),
      recItems.length ? Promise.resolve(recItems) : get<typeof recItems>("/api/inventory"),
    ])
      .then(([needs, items]) => {
        setRecNeeds(Array.isArray(needs) ? needs : []);
        if (!recItems.length) setRecItems(Array.isArray(items) ? items : []);
      })
      .catch(() => toast.error("Could not load recurring needs"))
      .finally(() => setRecLoading(false));
    // existing sponsorships + the donor master (for the "assign donor" picker)
    setSponsorships([]);
    setNewSponsor({ donorId: "", recurringNeedId: "", amountPerMonth: "", months: "6" });
    Promise.all([
      get<SponsorshipRow[]>(`/api/sponsorships?beneficiaryId=${b.id}`),
      donorOptions.length
        ? Promise.resolve(donorOptions)
        : get<{ items: typeof donorOptions }>("/api/donors?limit=200").then((d) => d.items ?? []),
    ])
      .then(([sp, donors]) => {
        setSponsorships(Array.isArray(sp) ? sp : []);
        if (!donorOptions.length) setDonorOptions(Array.isArray(donors) ? donors : []);
      })
      .catch(() => toast.error("Could not load sponsorships"));
  };

  const reloadRecNeeds = (beneficiaryId: string) =>
    get<RecurringNeedRow[]>(`/api/recurring-needs?beneficiaryId=${beneficiaryId}`)
      .then((needs) => setRecNeeds(Array.isArray(needs) ? needs : []))
      .catch(() => toast.error("Could not refresh recurring needs"));

  const addRecurringNeed = async () => {
    if (!viewTarget) return;
    if (!newNeed.itemId) {
      toast.error("Pick an item from the inventory master");
      return;
    }
    const qty = Math.max(1, Math.trunc(Number(newNeed.qtyPerCycle) || 1));
    setSavingNeed(true);
    try {
      await post("/api/recurring-needs", {
        beneficiaryId: viewTarget.id,
        itemId: newNeed.itemId,
        qtyPerCycle: qty,
        cycle: newNeed.cycle,
        reason: newNeed.reason.trim() || undefined,
      });
      toast.success("Recurring need added");
      setNewNeed({ itemId: "", qtyPerCycle: "1", cycle: "MONTHLY", reason: "" });
      await reloadRecNeeds(viewTarget.id);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not add recurring need");
    } finally {
      setSavingNeed(false);
    }
  };

  const toggleNeedStatus = async (need: RecurringNeedRow) => {
    if (!viewTarget) return;
    const next = need.status === "ACTIVE" ? "PAUSED" : "ACTIVE";
    try {
      await patch(`/api/recurring-needs/${need.id}`, { status: next });
      toast.success(next === "PAUSED" ? "Need paused" : "Need resumed");
      await reloadRecNeeds(viewTarget.id);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not update need");
    }
  };

  const deleteRecurringNeed = async (need: RecurringNeedRow) => {
    if (!viewTarget) return;
    try {
      await del(`/api/recurring-needs/${need.id}`);
      toast.success("Recurring need removed");
      await reloadRecNeeds(viewTarget.id);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not remove need");
    }
  };

  const reloadSponsorships = (beneficiaryId: string) =>
    get<SponsorshipRow[]>(`/api/sponsorships?beneficiaryId=${beneficiaryId}`)
      .then((sp) => setSponsorships(Array.isArray(sp) ? sp : []))
      .catch(() => toast.error("Could not refresh sponsorships"));

  const assignSponsor = async () => {
    if (!viewTarget) return;
    if (!newSponsor.donorId) {
      toast.error("Pick a donor to assign");
      return;
    }
    const amount = Number(newSponsor.amountPerMonth);
    if (!Number.isFinite(amount) || amount <= 0) {
      toast.error("Enter a valid monthly amount");
      return;
    }
    setSavingSponsor(true);
    try {
      await post("/api/sponsorships", {
        beneficiaryId: viewTarget.id,
        donorId: newSponsor.donorId,
        recurringNeedId: newSponsor.recurringNeedId || undefined,
        amountPerMonth: amount,
        months: Math.max(1, Math.trunc(Number(newSponsor.months) || 6)),
      });
      toast.success("Donor assigned as a monthly sponsor");
      setNewSponsor({ donorId: "", recurringNeedId: "", amountPerMonth: "", months: "6" });
      await reloadSponsorships(viewTarget.id);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not assign sponsor");
    } finally {
      setSavingSponsor(false);
    }
  };

  const toggleSponsorStatus = async (s: SponsorshipRow) => {
    if (!viewTarget) return;
    const next = s.status === "ACTIVE" ? "PAUSED" : "ACTIVE";
    try {
      await patch(`/api/sponsorships/${s.id}`, { status: next });
      toast.success(next === "PAUSED" ? "Sponsorship paused" : "Sponsorship resumed");
      await reloadSponsorships(viewTarget.id);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not update sponsorship");
    }
  };

  const cancelSponsor = async (s: SponsorshipRow) => {
    if (!viewTarget) return;
    try {
      await patch(`/api/sponsorships/${s.id}`, { status: "CANCELLED" });
      toast.success("Sponsorship cancelled");
      await reloadSponsorships(viewTarget.id);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not cancel sponsorship");
    }
  };

  const openMatchDialog = () => {
    setMatchOpen(true);
    setMatchLoading(true);
    get<{ enabled: boolean; suggestions: MatchSuggestion[]; unmatchedNeeds: number; availableDonors: number }>(
      "/api/sponsorships/match"
    )
      .then((res) => {
        setMatchSuggestions(Array.isArray(res?.suggestions) ? res.suggestions : []);
        setMatchMeta({
          enabled: res?.enabled ?? true,
          unmatchedNeeds: res?.unmatchedNeeds ?? 0,
          availableDonors: res?.availableDonors ?? 0,
        });
      })
      .catch((e) => toast.error(e instanceof Error ? e.message : "Could not load match suggestions"))
      .finally(() => setMatchLoading(false));
  };

  const acceptMatch = async (s: MatchSuggestion) => {
    const key = `${s.recurringNeedId}:${s.donorId}`;
    setAssigningKey(key);
    try {
      await post("/api/sponsorships", {
        beneficiaryId: s.beneficiaryId,
        donorId: s.donorId,
        recurringNeedId: s.recurringNeedId,
        amountPerMonth: s.suggestedAmountPerMonth,
        source: "AUTO_MATCH",
      });
      toast.success(`${s.donorName} assigned to sponsor ${s.beneficiaryName}`);
      setMatchSuggestions((prev) => prev.filter((x) => x !== s));
      if (viewTarget?.id === s.beneficiaryId) await reloadSponsorships(s.beneficiaryId);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not assign this match");
    } finally {
      setAssigningKey(null);
    }
  };

  const fulfillNeedNow = async (need: RecurringNeedRow) => {
    if (!viewTarget) return;
    setFulfillingId(need.id);
    try {
      await post("/api/distributions", {
        type: "OTHER",
        beneficiaryId: viewTarget.id,
        quantity: need.qtyPerCycle,
        location: viewTarget.city || viewTarget.address || "Recurring hand-out",
        items: [{ itemId: need.itemId, name: need.item.name, qty: need.qtyPerCycle, unit: need.item.unit }],
        recurringNeedId: need.id,
        notes: need.reason ? `Recurring: ${need.reason}` : "Recurring need fulfilment",
      });
      toast.success(`${need.item.name} handed out — next due date advanced.`);
      await reloadRecNeeds(viewTarget.id);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not record the hand-out — check stock");
    } finally {
      setFulfillingId(null);
    }
  };

  const addNote = async () => {
    if (!viewTarget) return;
    const note = noteText.trim();
    if (!note) {
      toast.error("Write a note first");
      return;
    }
    setNoteSaving(true);
    try {
      const created = await post<CaseNote>(`/api/beneficiaries/${viewTarget.id}/notes`, { note });
      setNotes((n) => [created, ...n]);
      setNoteText("");
      toast.success("Case note added");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to add note");
    } finally {
      setNoteSaving(false);
    }
  };

  /* --------------------------------- actions UI ----------------------------- */

  const caseActions = (b: Beneficiary) => {
    const cs = b.caseStatus ?? "INTAKE";
    const next = NEXT_CASE_STATUS[cs];
    const open = cs === "INTAKE" || cs === "VERIFICATION";
    return (
      <>
        {next ? (
          <DropdownMenuItem onSelect={() => advanceCase(b)}>
            <Send className="size-4" />
            {cs === "INTAKE" ? "Send to verification" : "Activate case"}
          </DropdownMenuItem>
        ) : null}
        {(b.verificationStatus ?? "PENDING") !== "VERIFIED" ? (
          <DropdownMenuItem onSelect={() => markVerified(b)}>
            <BadgeCheck className="size-4" />
            Mark verified
          </DropdownMenuItem>
        ) : null}
        {open ? (
          <>
            <DropdownMenuItem
              className="text-amber-700 dark:text-amber-400"
              onSelect={() => setCloseTarget(b)}
            >
              <Inbox className="size-4" />
              Close case
            </DropdownMenuItem>
            <DropdownMenuItem
              className="text-red-600 focus:text-red-700 dark:text-red-400"
              onSelect={() => setRejectTarget(b)}
            >
              <FileText className="size-4" />
              Reject case
            </DropdownMenuItem>
          </>
        ) : null}
      </>
    );
  };

  const rowActions = (b: Beneficiary) => (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          size="icon"
          variant="ghost"
          className="size-11 md:size-8"
          aria-label={`Actions for ${b.name}`}
          onClick={(e) => e.stopPropagation()}
        >
          <Activity className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52" onClick={(e) => e.stopPropagation()}>
        <DropdownMenuLabel className="truncate">{b.name}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => openView(b)}>
          <Eye className="size-4" /> View case
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => openEdit(b)}>
          <Pencil className="size-4" /> Edit
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {caseActions(b)}
        {(b.caseStatus ?? "INTAKE") !== "CLOSED" ||
        (b.verificationStatus ?? "PENDING") !== "VERIFIED" ? (
          <DropdownMenuSeparator />
        ) : null}
        {isAdmin ? (
          <DropdownMenuItem
            className="text-red-600 focus:text-red-700 dark:text-red-400"
            onSelect={() => setDeleteTarget(b)}
          >
            <Trash2 className="size-4" /> Delete
          </DropdownMenuItem>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );

  /* ---------------------------------- CSV ----------------------------------- */

  const csvColumns: CsvColumn<Beneficiary>[] = useMemo(
    () => [
      { header: "Name", value: (b) => b.name },
      { header: "Guardian", value: (b) => b.guardian ?? "" },
      { header: "Category", value: (b) => labelOf(categoryOptions, b.category) },
      { header: "Urgency", value: (b) => humanize(b.urgencyLevel) },
      { header: "Case status", value: (b) => humanize(b.caseStatus) },
      { header: "Verification", value: (b) => humanize(b.verificationStatus) },
      { header: "Case worker", value: (b) => b.caseWorker ?? "" },
      { header: "City", value: (b) => b.city ?? "" },
      { header: "State", value: (b) => b.state ?? "" },
      { header: "Pincode", value: (b) => b.pincode ?? "" },
      { header: "Phone", value: (b) => b.phone ?? "" },
      { header: "Email", value: (b) => b.email ?? "" },
      { header: "Age", value: (b) => b.age ?? "" },
      { header: "Gender", value: (b) => humanize(b.gender) },
      { header: "Family members", value: (b) => b.familyMembers },
      { header: "Monthly income", value: (b) => b.monthlyIncome ?? "" },
      { header: "Monthly need", value: (b) => b.monthlyNeed ?? "" },
      { header: "Intake date", value: (b) => toDateInput(b.intakeDate) },
      { header: "Onboarded by", value: (b) => b.onboardedByName ?? "" },
      { header: "Photo consent", value: (b) => (b.photoConsent ? "Yes" : "No") },
    ],
    [categoryOptions]
  );

  /* ------------------------------- table columns ----------------------------- */

  const columns: DataTableColumn<Beneficiary>[] = [
    { key: "name", header: "Beneficiary" },
    { key: "category", header: "Category", hideBelow: "md" },
    { key: "urgency", header: "Urgency" },
    { key: "case", header: "Case" },
    { key: "verification", header: "Verification", hideBelow: "sm" },
    { key: "city", header: "City", hideBelow: "md" },
    { key: "worker", header: "Case worker", hideBelow: "lg" },
    { key: "actions", header: "", align: "right", className: "w-14" },
  ];

  /* --------------------------------- render --------------------------------- */

  return (
    <div className="space-y-4 sm:space-y-6">
      <PageHeader
        title="Beneficiary Cases"
        description="Case register from intake to closure — verification, caseworkers and assistance."
        icon={<HeartHandshake className="size-5" aria-hidden="true" />}
        actions={
          <>
            <Button variant="outline" onClick={() => load()} aria-label="Refresh list">
              <RefreshCw className="size-4" /> <span className="hidden sm:inline">Refresh</span>
            </Button>
            <Button variant="outline" onClick={openMatchDialog} aria-label="Suggest donor sponsor matches">
              <HeartHandshake className="size-4" /> <span className="hidden sm:inline">Match sponsors</span>
            </Button>
            <Button onClick={openCreate} aria-label="Register new beneficiary case">
              <Plus className="size-4" /> New case
            </Button>
          </>
        }
      />

      {/* Stats */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Total cases"
          value={loading ? "—" : stats.total}
          icon={<ClipboardList className="size-5" aria-hidden="true" />}
          accent="emerald"
          hint="All registered beneficiaries"
          loading={loading}
        />
        <StatCard
          label="Active cases"
          value={loading ? "—" : stats.active}
          icon={<Activity className="size-5" aria-hidden="true" />}
          accent="teal"
          hint="Currently receiving support"
          loading={loading}
        />
        <StatCard
          label="Awaiting verification"
          value={loading ? "—" : stats.awaitingVerification}
          icon={<FileSearch className="size-5" aria-hidden="true" />}
          accent="amber"
          hint="Verification status Pending"
          loading={loading}
        />
        <StatCard
          label="Critical urgency"
          value={loading ? "—" : stats.critical}
          icon={<Siren className="size-5" aria-hidden="true" />}
          accent="red"
          hint="Need immediate attention"
          loading={loading}
        />
      </div>

      {/* Toolbar */}
      <div className="flex flex-col gap-3 rounded-xl border bg-card p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
          <div className="relative flex-1">
            <UserRound
              className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden="true"
            />
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search name, guardian, phone, city or caseworker…"
              className="pl-9"
              aria-label="Search beneficiaries"
            />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Select value={categoryFilter} onValueChange={setCategoryFilter}>
              <SelectTrigger className="w-full sm:w-44" aria-label="Filter by category">
                <SelectValue placeholder="All categories" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All categories</SelectItem>
                {categoryOptions.map((c) => (
                  <SelectItem key={c.value} value={c.value}>
                    {c.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={caseFilter} onValueChange={setCaseFilter}>
              <SelectTrigger className="w-full sm:w-40" aria-label="Filter by case status">
                <SelectValue placeholder="Case status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All case statuses</SelectItem>
                {CASE_STATUSES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {humanize(s)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={verFilter} onValueChange={setVerFilter}>
              <SelectTrigger className="w-full sm:w-44" aria-label="Filter by verification">
                <SelectValue placeholder="Verification" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All verification</SelectItem>
                {VERIFICATION_STATUSES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {humanize(s)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              variant={recurringFilter ? "default" : "outline"}
              size="sm"
              className="min-h-10 gap-1.5"
              onClick={() => setRecurringFilter((v) => !v)}
              aria-pressed={recurringFilter}
            >
              <RefreshCw className="size-3.5" aria-hidden="true" />
              Recurring support
            </Button>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {/* active filter chips */}
          {hasFilters ? (
            <div className="flex flex-wrap items-center gap-1.5" aria-label="Active filters">
              {search.trim() !== "" && (
                <span className="rounded-full bg-muted px-2.5 py-1 text-xs text-muted-foreground">
                  Search: <strong className="font-semibold text-foreground">{search.trim()}</strong>
                </span>
              )}
              {categoryFilter !== "ALL" && (
                <span className="rounded-full bg-muted px-2.5 py-1 text-xs text-muted-foreground">
                  Category: <strong className="font-semibold text-foreground">{labelOf(categoryOptions, categoryFilter)}</strong>
                </span>
              )}
              {caseFilter !== "ALL" && (
                <span className="rounded-full bg-muted px-2.5 py-1 text-xs text-muted-foreground">
                  Case: <strong className="font-semibold text-foreground">{humanize(caseFilter)}</strong>
                </span>
              )}
              {verFilter !== "ALL" && (
                <span className="rounded-full bg-muted px-2.5 py-1 text-xs text-muted-foreground">
                  Verification: <strong className="font-semibold text-foreground">{humanize(verFilter)}</strong>
                </span>
              )}
              {recurringFilter && (
                <span className="rounded-full bg-muted px-2.5 py-1 text-xs text-muted-foreground">
                  Recurring support only
                </span>
              )}
              <Button variant="ghost" size="sm" className="min-h-9" onClick={clearFilters} aria-label="Clear filters">
                Clear
              </Button>
            </div>
          ) : null}
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <ViewSwitcher value={mode} onChange={(m: DataViewMode) => setMode(m)} />
            <ExportMenu
              columns={csvColumns}
              rows={filtered}
              filename="uar-beneficiary-cases"
              disabled={filtered.length === 0}
            />
          </div>
          <span className="hidden text-xs text-muted-foreground sm:inline" aria-live="polite">
            {loading ? "Loading…" : `${filtered.length} of ${rows.length} cases`}
          </span>
        </div>
      </div>

      {/* Table view */}
      {mode === "table" ? (
        <DataTable
          columns={columns}
          rows={paged}
          rowKey={(b) => b.id}
          loading={loading}
          skeletonRows={8}
          height="fill"
          fillOffset={330}
          onRowClick={openView}
          page={page}
          pages={pages}
          total={filtered.length}
          pageSize={pageSize}
          onPage={setPage}
          onPageSize={setPageSize}
          itemLabel="cases"
          empty={
            <EmptyState
              icon={<HeartHandshake className="size-6" aria-hidden="true" />}
              title="No cases found"
              hint="Adjust the filters or register a new beneficiary case."
            >
              <div className="flex gap-2">
                {hasFilters && (
                  <Button size="sm" variant="outline" onClick={clearFilters}>
                    Clear filters
                  </Button>
                )}
                <Button size="sm" onClick={openCreate}>
                  <Plus className="size-4" /> New case
                </Button>
              </div>
            </EmptyState>
          }
        >
          {(b, col) => {
            switch (col.key) {
              case "name":
                return (
                  <div className="flex items-center gap-2.5">
                    <span
                      className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary"
                      aria-hidden="true"
                    >
                      {b.name.charAt(0).toUpperCase()}
                    </span>
                    <div className="min-w-0">
                      <p className="flex items-center gap-1.5 truncate font-medium">
                        <span className="truncate">{b.name}</span>
                        <span className="shrink-0 font-mono text-[10px] font-normal text-muted-foreground/70">{b.code}</span>
                      </p>
                      {b.guardian ? (
                        <p className="truncate text-xs text-muted-foreground">Guardian: {b.guardian}</p>
                      ) : (
                        <p className="truncate font-mono text-xs text-muted-foreground">{b.phone || "—"}</p>
                      )}
                    </div>
                  </div>
                );
              case "category":
                return <span className="text-sm">{labelOf(categoryOptions, b.category)}</span>;
              case "urgency":
                return <StatusBadge status={b.urgencyLevel} tone={urgencyTone(b.urgencyLevel)} />;
              case "case":
                return <StatusBadge status={b.caseStatus ?? "INTAKE"} />;
              case "verification":
                return <StatusBadge status={b.verificationStatus ?? "PENDING"} />;
              case "city":
                return <span className="text-sm">{b.city || "—"}</span>;
              case "worker":
                return <span className="text-sm">{b.caseWorker || "—"}</span>;
              case "actions":
                return <div className="flex justify-end">{rowActions(b)}</div>;
              default:
                return null;
            }
          }}
        </DataTable>
      ) : null}

      {/* Grid view */}
      {mode === "grid" ? (
        <div>
          {loading ? (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-44 rounded-xl" />
              ))}
            </div>
          ) : paged.length === 0 ? (
            <EmptyState
              icon={<HeartHandshake className="size-6" aria-hidden="true" />}
              title="No cases found"
              hint="Adjust the filters or register a new beneficiary case."
            />
          ) : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {paged.map((b) => (
                <article
                  key={b.id}
                  className="card-hover flex cursor-pointer flex-col gap-3 rounded-xl border bg-card p-4"
                  onClick={() => openView(b)}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex min-w-0 items-start gap-2.5">
                      <span
                        className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary"
                        aria-hidden="true"
                      >
                        {b.name.charAt(0).toUpperCase()}
                      </span>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold">{b.name}</p>
                        <p className="truncate text-xs text-muted-foreground">
                          <span className="font-mono">{b.code}</span> · {labelOf(categoryOptions, b.category)}
                          {b.guardian ? ` · Guardian: ${b.guardian}` : ""}
                        </p>
                      </div>
                    </div>
                    <div onClick={(e) => e.stopPropagation()}>{rowActions(b)}</div>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    <StatusBadge status={b.urgencyLevel} tone={urgencyTone(b.urgencyLevel)} />
                    <StatusBadge status={b.caseStatus ?? "INTAKE"} />
                    <StatusBadge status={b.verificationStatus ?? "PENDING"} />
                  </div>
                  <div className="mt-auto flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                    <span className="inline-flex items-center gap-1">
                      <MapPin className="size-3.5" aria-hidden="true" /> {b.city || "—"}
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <Phone className="size-3.5" aria-hidden="true" /> <span className="font-mono">{b.phone || "—"}</span>
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <UserRound className="size-3.5" aria-hidden="true" />
                      {b.caseWorker || "Unassigned"}
                    </span>
                  </div>
                </article>
              ))}
            </div>
          )}
        </div>
      ) : null}

      {/* List view */}
      {mode === "list" ? (
        <div className="rounded-xl border bg-card p-2">
          {loading ? (
            <div className="space-y-2 p-2">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : paged.length === 0 ? (
            <EmptyState
              icon={<HeartHandshake className="size-6" aria-hidden="true" />}
              title="No cases found"
              hint="Adjust the filters or register a new beneficiary case."
            />
          ) : (
            <ul
              className="max-h-96 divide-y overflow-y-auto scrollbar-thin"
              aria-label="Beneficiary cases list"
            >
              {paged.map((b) => (
                <li key={b.id}>
                  <div
                    role="button"
                    tabIndex={0}
                    aria-label={`View case ${b.name}`}
                    className="flex w-full cursor-pointer items-center gap-3 rounded-lg px-2 py-2.5 text-left transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    onClick={() => openView(b)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        openView(b);
                      }
                    }}
                  >
                    <span
                      className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary"
                      aria-hidden="true"
                    >
                      {b.name.charAt(0).toUpperCase()}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">
                        {b.name}
                        <span className="font-mono text-[10px] font-normal text-muted-foreground/70"> {b.code}</span>
                        {b.guardian ? (
                          <span className="font-normal text-muted-foreground"> · {b.guardian}</span>
                        ) : null}
                      </span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {labelOf(categoryOptions, b.category)} · {b.city || "—"} · Caseworker:{" "}
                        {b.caseWorker || "Unassigned"}
                      </span>
                    </span>
                    <span className="hidden shrink-0 items-center gap-1.5 sm:flex">
                      <StatusBadge status={b.urgencyLevel} tone={urgencyTone(b.urgencyLevel)} />
                      <StatusBadge status={b.caseStatus ?? "INTAKE"} />
                    </span>
                    <span className="shrink-0" onClick={(e) => e.stopPropagation()}>
                      {rowActions(b)}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}

      {/* Pagination for grid/list (table paginates inside DataTable) */}
      {mode !== "table" ? (
        <PaginationBar
          page={page}
          pages={pages}
          total={filtered.length}
          onPage={setPage}
          itemLabel="cases"
        />
      ) : null}

      {/* ------------------------------ Add / Edit ------------------------------ */}
      <FormSheet
        open={formOpen}
        onOpenChange={(o) => {
          if (!o && !saving) setFormOpen(false);
        }}
        title={editing ? `Edit case — ${editing.name}` : "Register beneficiary case"}
        description={
          editing
            ? "Update identity, household, need and consent details."
            : "Add a beneficiary to the case register. Case status starts at Intake."
        }
        onSubmit={submitForm}
        submitLabel={editing ? "Save changes" : "Register case"}
        loading={saving}
        dirty={dirty}
        size="full"
        badge={
          editing ? (
            <StatusBadge status={editing.caseStatus ?? "INTAKE"} />
          ) : undefined
        }
      >
        <FormSection title="Identity" description="Who the case is for, and where the family lives.">
          <FieldGrid>
            <TextField
              label="Full name"
              required
              value={form.name}
              onChange={(v) => setForm({ ...form, name: v })}
              placeholder="e.g. Lakshmi Devi"
            />
            <TextField
              label="Guardian / next of kin"
              value={form.guardian}
              onChange={(v) => setForm({ ...form, guardian: v })}
              placeholder="e.g. Ramesh (son)"
            />
            <TextField
              label="Age"
              inputMode="numeric"
              value={form.age}
              onChange={(v) => setForm({ ...form, age: v })}
              placeholder="e.g. 68"
            />
            <SelectField
              label="Gender"
              value={form.gender as (typeof GENDERS)[number] | ""}
              onChange={(v) => setForm({ ...form, gender: v })}
              options={GENDERS.map((g) => ({ value: g, label: titleCase(g) }))}
              placeholder="Select gender"
            />
            <TextField
              label="Phone"
              required
              inputMode="tel"
              value={form.phone}
              onChange={(v) => setForm({ ...form, phone: v })}
              placeholder="9876543210"
            />
            <TextField
              label="Email"
              inputMode="email"
              value={form.email}
              onChange={(v) => setForm({ ...form, email: v })}
              placeholder="Optional"
            />
            <TextField
              label="Address"
              value={form.address}
              onChange={(v) => setForm({ ...form, address: v })}
              placeholder="House, street, landmark"
              className="sm:col-span-2"
            />
            <TextField
              label="City"
              value={form.city}
              onChange={(v) => setForm({ ...form, city: v })}
              placeholder="e.g. Bengaluru"
            />
            <TextField
              label="State"
              value={form.state}
              onChange={(v) => setForm({ ...form, state: v })}
              placeholder="e.g. Karnataka"
            />
            <TextField
              label="PIN code"
              required
              inputMode="numeric"
              maxLength={6}
              value={form.pincode}
              onChange={(v) => setForm({ ...form, pincode: v })}
              placeholder="560001"
            />
          </FieldGrid>
        </FormSection>

        <FormSection
          title="Household & economy"
          description="Family size and the monthly money picture used to size support."
        >
          <FieldGrid>
            <TextField
              label="Family members"
              inputMode="numeric"
              value={form.familyMembers}
              onChange={(v) => setForm({ ...form, familyMembers: v })}
              placeholder="e.g. 4"
            />
            <TextField
              label="Monthly income"
              prefix="₹"
              inputMode="decimal"
              value={form.monthlyIncome}
              onChange={(v) => setForm({ ...form, monthlyIncome: v })}
              placeholder="e.g. 3500"
            />
            <TextField
              label="Monthly need"
              prefix="₹"
              inputMode="decimal"
              value={form.monthlyNeed}
              onChange={(v) => setForm({ ...form, monthlyNeed: v })}
              placeholder="e.g. 6000"
            />
          </FieldGrid>
        </FormSection>

        <FormSection
          title="Needs & urgency"
          description="What kind of support is required and how urgent it is."
        >
          <FieldGrid>
            <SelectField
              label="Category"
              required
              value={form.category}
              onChange={(v) => setForm({ ...form, category: v })}
              options={categoryOptions}
            />
            <SelectField
              label="Urgency"
              required
              value={form.urgencyLevel as (typeof URGENCIES)[number]}
              onChange={(v) => setForm({ ...form, urgencyLevel: v })}
              options={URGENCIES.map((u) => ({ value: u, label: titleCase(u) }))}
            />
          </FieldGrid>
          <TextareaField
            label="Needs"
            value={form.needs}
            onChange={(v) => setForm({ ...form, needs: v })}
            placeholder="What support does this family need?"
          />
          <TextareaField
            label="Documents"
            hint="comma-separated document refs"
            value={form.documents}
            onChange={(v) => setForm({ ...form, documents: v })}
            placeholder="AADHAAR-XXXX, RATION-XXXX, DISABILITY-CARD"
          />
        </FormSection>

        <FormSection
          title="Case workflow"
          description="Workflow stage, verification and ownership of the case."
        >
          <FieldGrid>
            <SelectField
              label="Case status"
              required
              value={form.caseStatus as (typeof CASE_STATUSES)[number]}
              onChange={(v) => setForm({ ...form, caseStatus: v })}
              options={(editing
                ? [editing.caseStatus ?? "INTAKE", ...(CASE_STATUS_TRANSITIONS[editing.caseStatus ?? "INTAKE"] ?? [])]
                : CASE_STATUSES
              ).map((s) => ({ value: s, label: humanize(s) }))}
            />
            <SelectField
              label="Verification"
              required
              value={form.verificationStatus as (typeof VERIFICATION_STATUSES)[number]}
              onChange={(v) => setForm({ ...form, verificationStatus: v })}
              options={(editing
                ? [editing.verificationStatus ?? "PENDING", ...(VERIFICATION_STATUS_TRANSITIONS[editing.verificationStatus ?? "PENDING"] ?? [])]
                : VERIFICATION_STATUSES
              ).map((s) => ({ value: s, label: humanize(s) }))}
            />
            <TextField
              label="Case worker"
              value={form.caseWorker}
              onChange={(v) => setForm({ ...form, caseWorker: v })}
              placeholder="Volunteer / staff member"
            />
            <TextField
              label="Intake date"
              type="date"
              value={form.intakeDate}
              onChange={(v) => setForm({ ...form, intakeDate: v })}
            />
          </FieldGrid>
        </FormSection>

        <FormSection title="Notes & consent" description="Internal remarks and family consent.">
          <TextareaField
            label="Notes"
            value={form.notes}
            onChange={(v) => setForm({ ...form, notes: v })}
            placeholder="Internal remarks"
          />
          <SwitchField
            label="Photo consent"
            hint="Family agrees to photos being used in campaigns and reports."
            checked={form.photoConsent}
            onChange={(v) => setForm({ ...form, photoConsent: v })}
          />
        </FormSection>
      </FormSheet>

      {/* ------------------------------ Detail sheet ---------------------------- */}
      <DetailSheet
        open={!!viewTarget}
        onOpenChange={(o) => !o && setViewTarget(null)}
        eyebrow={viewTarget ? `Beneficiary case · ${viewTarget.code}` : "Beneficiary case"}
        title={viewTarget?.name ?? "Case"}
        description={
          viewTarget
            ? `${labelOf(categoryOptions, viewTarget.category)} · ${viewTarget.city || "No city"}${
                viewTarget.caseWorker ? ` · Case worker: ${viewTarget.caseWorker}` : ""
              }`
            : ""
        }
        status={
          viewTarget ? (
            <>
              <StatusBadge status={viewTarget.urgencyLevel} tone={urgencyTone(viewTarget.urgencyLevel)} />
              <StatusBadge status={viewTarget.caseStatus ?? "INTAKE"} />
              <StatusBadge status={viewTarget.verificationStatus ?? "PENDING"} />
            </>
          ) : undefined
        }
        actions={viewTarget ? rowActions(viewTarget) : undefined}
      >
        {viewTarget ? (
          <Tabs defaultValue="overview" className="gap-0" key={viewTarget.id}>
            <TabsList className="mb-4 w-full sm:w-auto">
              <TabsTrigger value="overview">Overview</TabsTrigger>
              <TabsTrigger value="notes">Case notes</TabsTrigger>
              <TabsTrigger value="assistance">Assistance</TabsTrigger>
              <TabsTrigger value="recurring">Recurring needs</TabsTrigger>
              <TabsTrigger value="requests">Requests</TabsTrigger>
            </TabsList>

            {/* Overview */}
            <TabsContent value="overview" className="mt-0 space-y-6">
              <DetailSection title="Identity" description="Who the case is for.">
                <DetailGrid cols={2}>
                  <DataField label="Full name" value={viewTarget.name} />
                  <DataField label="Guardian" value={viewTarget.guardian} />
                  <DataField label="Age" value={viewTarget.age ?? undefined} />
                  <DataField label="Gender" value={viewTarget.gender ? humanize(viewTarget.gender) : ""} />
                  <DataField label="Phone" value={viewTarget.phone} copy mono />
                  <DataField label="Email" value={viewTarget.email} copy />
                </DetailGrid>
              </DetailSection>

              <DetailSection title="Address" description="Where the family lives.">
                <DetailGrid cols={2}>
                  <DataField label="Address" value={viewTarget.address} className="sm:col-span-2" />
                  <DataField label="City" value={viewTarget.city} />
                  <DataField label="State" value={viewTarget.state} />
                  <DataField label="PIN code" value={viewTarget.pincode} mono />
                </DetailGrid>
              </DetailSection>

              <DetailSection title="Household & economy" description="Family size and monthly money picture.">
                <DetailGrid cols={2}>
                  <DataField label="Family members" value={String(viewTarget.familyMembers ?? "")} />
                  <DataField
                    label="Monthly income"
                    value={viewTarget.monthlyIncome !== null && viewTarget.monthlyIncome !== undefined ? formatINR(viewTarget.monthlyIncome) : ""}
                    mono
                  />
                  <DataField
                    label="Monthly need"
                    value={viewTarget.monthlyNeed !== null && viewTarget.monthlyNeed !== undefined ? formatINR(viewTarget.monthlyNeed) : ""}
                    mono
                  />
                  <DataField
                    label="Monthly gap"
                    value={
                      viewTarget.monthlyIncome != null && viewTarget.monthlyNeed != null
                        ? formatINR(Math.max(0, viewTarget.monthlyNeed - viewTarget.monthlyIncome))
                        : ""
                    }
                    mono
                  />
                </DetailGrid>
              </DetailSection>

              <DetailSection title="Case" description="Workflow, verification and ownership.">
                <DetailGrid cols={2}>
                  <DataField label="Category" value={labelOf(categoryOptions, viewTarget.category)} />
                  <DataField
                    label="Urgency"
                    value={<StatusBadge status={viewTarget.urgencyLevel} tone={urgencyTone(viewTarget.urgencyLevel)} />}
                  />
                  <DataField
                    label="Case status"
                    value={<StatusBadge status={viewTarget.caseStatus ?? "INTAKE"} />}
                  />
                  <DataField
                    label="Verification"
                    value={<StatusBadge status={viewTarget.verificationStatus ?? "PENDING"} />}
                  />
                  <DataField label="Case worker" value={viewTarget.caseWorker} />
                  <DataField label="Intake date" value={viewTarget.intakeDate ? toDateInput(viewTarget.intakeDate) : ""} />
                  <DataField label="Photo consent" value={viewTarget.photoConsent ? "Granted" : "Not granted"} />
                  <DataField label="Onboarded by" value={viewTarget.onboardedByName} />
                  <DataField
                    label="Registered"
                    value={viewTarget.createdAt ? formatDateTime(viewTarget.createdAt) : ""}
                  />
                  <DataField label="Active" value={viewTarget.isActive ? "Yes" : "No — archived"} />
                </DetailGrid>
              </DetailSection>

              <DetailSection title="Needs & notes" description="Requested support and internal remarks.">
                <DetailGrid cols={1}>
                  <DataField label="Needs" value={viewTarget.needs} />
                  <DataField label="Documents" value={viewTarget.documents} mono />
                  <DataField label="Notes" value={viewTarget.notes} />
                </DetailGrid>
              </DetailSection>
            </TabsContent>

            {/* Case notes */}
            <TabsContent value="notes" className="mt-0 space-y-4">
              <div className="rounded-lg border bg-muted/30 p-3">
                <Textarea
                  value={noteText}
                  onChange={(e) => setNoteText(e.target.value)}
                  rows={3}
                  placeholder="Add a case note — home visit, verification call, follow-up…"
                  aria-label="New case note"
                />
                <div className="mt-2 flex justify-end">
                  <Button size="sm" onClick={addNote} disabled={noteSaving}>
                    {noteSaving ? "Adding…" : "Add note"}
                  </Button>
                </div>
              </div>
              {notesLoading ? (
                <div className="space-y-2">
                  {Array.from({ length: 3 }).map((_, i) => (
                    <Skeleton key={i} className="h-16 w-full" />
                  ))}
                </div>
              ) : notes.length === 0 ? (
                <EmptyState
                  icon={<FileText className="size-6" aria-hidden="true" />}
                  title="No case notes yet"
                  hint="Notes build the case timeline — add the first one above."
                />
              ) : (
                <ol className="max-h-96 space-y-0 overflow-y-auto scrollbar-thin" aria-label="Case notes timeline">
                  {notes.map((n, i) => (
                    <li key={n.id} className="relative flex gap-3 pb-4 pl-1 last:pb-0">
                      {i < notes.length - 1 ? (
                        <span
                          aria-hidden="true"
                          className="absolute left-[7px] top-5 h-full w-px bg-border"
                        />
                      ) : null}
                      <span
                        aria-hidden="true"
                        className="relative mt-1.5 size-3.5 shrink-0 rounded-full border-2 border-primary/40 bg-primary/20"
                      />
                      <div className="min-w-0 flex-1 rounded-lg border bg-card p-3">
                        <p className="whitespace-pre-line text-sm leading-relaxed">{n.note}</p>
                        <p className="mt-1.5 text-xs text-muted-foreground">
                          {n.authorName || "Staff"} · {formatDateTime(n.createdAt)}
                        </p>
                      </div>
                    </li>
                  ))}
                </ol>
              )}
            </TabsContent>

            {/* Assistance history */}
            <TabsContent value="assistance" className="mt-0 space-y-3">
              {assistLoading ? (
                <div className="space-y-2">
                  {Array.from({ length: 3 }).map((_, i) => (
                    <Skeleton key={i} className="h-16 w-full" />
                  ))}
                </div>
              ) : assist.length === 0 ? (
                <EmptyState
                  icon={<HeartHandshake className="size-6" aria-hidden="true" />}
                  title="No assistance recorded"
                  hint="Distributions linked to this beneficiary will appear here."
                />
              ) : (
                <>
                  {(() => {
                    const totalValue = assist.reduce((s, d) => s + (d.value || 0), 0);
                    const totalQty = assist.reduce((s, d) => s + (d.quantity || 0), 0);
                    const untraced = assist.filter(
                      (d) => !d.kitBatchId && parseDistItems(d.items).length === 0
                    ).length;
                    return (
                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 rounded-lg border bg-muted/30 px-3 py-2 text-xs">
                        <span><strong className="text-foreground">{assist.length}</strong> hand-out(s)</span>
                        <span><strong className="text-foreground">{totalQty}</strong> total units</span>
                        <span><strong className="text-foreground">{formatINR(totalValue)}</strong> est. value</span>
                        {untraced > 0 && (
                          <span className="ml-auto flex items-center gap-1 text-amber-700 dark:text-amber-400">
                            <AlertTriangle className="size-3.5" aria-hidden="true" />
                            {untraced} record(s) have no item/kit-level detail — quantity only.
                          </span>
                        )}
                      </div>
                    );
                  })()}

                  <div className="overflow-x-auto rounded-lg border">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b bg-muted/50 text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                          <th scope="col" className="px-3 py-2 font-semibold">Type</th>
                          <th scope="col" className="px-3 py-2 font-semibold">Items</th>
                          <th scope="col" className="px-3 py-2 text-right font-semibold">Qty</th>
                          <th scope="col" className="hidden px-3 py-2 text-right font-semibold sm:table-cell">Value</th>
                          <th scope="col" className="hidden px-3 py-2 font-semibold md:table-cell">Location</th>
                          <th scope="col" className="hidden px-3 py-2 font-semibold lg:table-cell">By</th>
                          <th scope="col" className="px-3 py-2 font-semibold">When</th>
                        </tr>
                      </thead>
                      <tbody>
                        {assist.map((d) => {
                          const lines = parseDistItems(d.items);
                          const untraced = !d.kitBatchId && lines.length === 0;
                          return (
                            <tr key={d.id} className="border-b last:border-b-0 align-top">
                              <td className="px-3 py-2.5 font-medium">{titleCase(d.type)}</td>
                              <td className="px-3 py-2.5">
                                {d.kitBatchId ? (
                                  <span className="inline-flex items-center gap-1 text-xs text-emerald-700 dark:text-emerald-400">
                                    <Boxes className="size-3.5" aria-hidden="true" />
                                    Kit hand-out · {d.kitQuantity ?? d.quantity} unit(s)
                                  </span>
                                ) : lines.length > 0 ? (
                                  <ul className="space-y-0.5">
                                    {lines.map((l, i) => (
                                      <li key={i} className="text-xs">
                                        {l.name} <span className="text-muted-foreground">×{l.qty} {l.unit ?? ""}</span>
                                      </li>
                                    ))}
                                  </ul>
                                ) : (
                                  <span className="flex items-center gap-1 text-xs text-amber-700 dark:text-amber-400">
                                    <AlertTriangle className="size-3" aria-hidden="true" />
                                    No item detail
                                  </span>
                                )}
                              </td>
                              <td className="px-3 py-2.5 text-right tabular-nums">{d.quantity}</td>
                              <td className="hidden px-3 py-2.5 text-right tabular-nums sm:table-cell">
                                {d.value ? formatINR(d.value) : "—"}
                              </td>
                              <td className="hidden max-w-40 truncate px-3 py-2.5 md:table-cell">{d.location || "—"}</td>
                              <td className="hidden px-3 py-2.5 lg:table-cell">{d.volunteer?.user?.name || "—"}</td>
                              <td className="whitespace-nowrap px-3 py-2.5 text-xs text-muted-foreground">
                                {formatDateTime(d.distributedAt)}
                                {untraced && <span className="sr-only"> — no item-level detail recorded</span>}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </TabsContent>

            {/* Requests */}
            <TabsContent value="recurring" className="mt-0 space-y-4">
              <div className="rounded-lg border bg-muted/30 p-3">
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Add a standing (recurring) need
                </p>
                <FieldGrid cols={2}>
                  <SelectField
                    label="Item"
                    value={newNeed.itemId}
                    onChange={(v) => setNewNeed((f) => ({ ...f, itemId: v }))}
                    options={recItems.map((i) => ({ value: i.id, label: `${i.name} (${i.quantity} ${i.unit} in stock)` }))}
                    placeholder="Pick from inventory master…"
                  />
                  <SelectField
                    label="Repeats"
                    value={newNeed.cycle}
                    onChange={(v) => setNewNeed((f) => ({ ...f, cycle: v }))}
                    options={[
                      { value: "WEEKLY", label: "Every week" },
                      { value: "MONTHLY", label: "Every month" },
                      { value: "QUARTERLY", label: "Every quarter" },
                    ]}
                  />
                  <TextField
                    label="Qty per cycle"
                    inputMode="numeric"
                    value={newNeed.qtyPerCycle}
                    onChange={(v) => setNewNeed((f) => ({ ...f, qtyPerCycle: v.replace(/[^\d]/g, "") }))}
                  />
                  <TextField
                    label="Reason (optional)"
                    value={newNeed.reason}
                    onChange={(v) => setNewNeed((f) => ({ ...f, reason: v }))}
                    placeholder="e.g. BP tablets, insulin…"
                  />
                </FieldGrid>
                <div className="mt-2 flex justify-end">
                  <Button size="sm" onClick={addRecurringNeed} disabled={savingNeed}>
                    {savingNeed ? "Adding…" : "Add recurring need"}
                  </Button>
                </div>
              </div>

              {recLoading ? (
                <div className="space-y-2">
                  {Array.from({ length: 2 }).map((_, i) => (
                    <Skeleton key={i} className="h-16 w-full" />
                  ))}
                </div>
              ) : recNeeds.length === 0 ? (
                <EmptyState
                  icon={<RefreshCw className="size-6" aria-hidden="true" />}
                  title="No recurring needs set up"
                  hint="Add one above for items this case needs on a repeating cycle, e.g. monthly medicine."
                />
              ) : (
                <ul className="space-y-2" aria-label="Recurring needs">
                  {recNeeds.map((n) => {
                    const due = new Date(n.nextDueAt);
                    const overdue = n.status === "ACTIVE" && due.getTime() < Date.now();
                    const short = n.item.quantity < n.qtyPerCycle;
                    return (
                      <li key={n.id} className="rounded-lg border bg-card p-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="flex items-center gap-1.5 text-sm font-medium">
                            <Boxes className="size-3.5 text-primary" aria-hidden="true" />
                            {n.item.name} ×{n.qtyPerCycle} {n.item.unit} / {titleCase(n.cycle)}
                          </span>
                          <span className="flex items-center gap-1.5">
                            <StatusBadge status={n.status} />
                            {overdue && <StatusBadge status="OVERDUE" tone="danger" />}
                            {short && <StatusBadge status="LOW STOCK" tone="warning" />}
                          </span>
                        </div>
                        {n.reason && <p className="mt-1 text-xs text-muted-foreground">{n.reason}</p>}
                        <p className="mt-1.5 text-xs text-muted-foreground">
                          Next due {formatDateTime(n.nextDueAt)}
                          {n.lastFulfilledAt ? ` · last given ${formatDateTime(n.lastFulfilledAt)}` : " · never fulfilled yet"}
                        </p>
                        <div className="mt-2 flex flex-wrap gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => fulfillNeedNow(n)}
                            disabled={fulfillingId === n.id || n.status !== "ACTIVE"}
                          >
                            {fulfillingId === n.id ? "Recording…" : "Fulfil now"}
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => toggleNeedStatus(n)}>
                            {n.status === "ACTIVE" ? "Pause" : "Resume"}
                          </Button>
                          <Button size="sm" variant="ghost" className="text-destructive" onClick={() => deleteRecurringNeed(n)}>
                            Remove
                          </Button>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}

              <div className="border-t pt-4">
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Monthly support sponsors
                </p>
                <div className="rounded-lg border bg-muted/30 p-3">
                  <p className="mb-2 text-xs text-muted-foreground">
                    Manually assign a donor to pledge monthly support for this case — optionally tied to one
                    recurring need (e.g. “cover BP tablets every month”).
                  </p>
                  <FieldGrid cols={2}>
                    <SelectField
                      label="Donor"
                      value={newSponsor.donorId}
                      onChange={(v) => setNewSponsor((f) => ({ ...f, donorId: v }))}
                      options={donorOptions.map((d) => ({ value: d.id, label: `${d.name} (${d.email})` }))}
                      placeholder="Pick a donor…"
                    />
                    <SelectField
                      label="Tied to recurring need (optional)"
                      value={newSponsor.recurringNeedId}
                      onChange={(v) => setNewSponsor((f) => ({ ...f, recurringNeedId: v }))}
                      options={recNeeds.map((n) => ({ value: n.id, label: `${n.item.name} ×${n.qtyPerCycle}/${titleCase(n.cycle)}` }))}
                      placeholder="General monthly support…"
                    />
                    <TextField
                      label="Amount per month (₹)"
                      inputMode="numeric"
                      value={newSponsor.amountPerMonth}
                      onChange={(v) => setNewSponsor((f) => ({ ...f, amountPerMonth: v.replace(/[^\d]/g, "") }))}
                    />
                    <TextField
                      label="Commitment (months)"
                      inputMode="numeric"
                      value={newSponsor.months}
                      onChange={(v) => setNewSponsor((f) => ({ ...f, months: v.replace(/[^\d]/g, "") }))}
                    />
                  </FieldGrid>
                  <div className="mt-2 flex justify-end">
                    <Button size="sm" onClick={assignSponsor} disabled={savingSponsor}>
                      {savingSponsor ? "Assigning…" : "Assign donor as sponsor"}
                    </Button>
                  </div>
                </div>

                {sponsorships.length > 0 && (
                  <ul className="mt-3 space-y-2" aria-label="Monthly sponsors">
                    {sponsorships.map((s) => (
                      <li key={s.id} className="rounded-lg border bg-card p-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="flex items-center gap-1.5 text-sm font-medium">
                            <HeartHandshake className="size-3.5 text-primary" aria-hidden="true" />
                            {s.donorName} — {formatINR(s.amountPerMonth)}/mo ×{s.months}mo
                          </span>
                          <span className="flex items-center gap-1.5">
                            <StatusBadge status={s.status} />
                            {s.source === "AUTO_MATCH" && <StatusBadge status="AUTO-MATCHED" tone="info" />}
                          </span>
                        </div>
                        {s.recurringNeed && (
                          <p className="mt-1 text-xs text-muted-foreground">
                            Covers: {s.recurringNeed.item.name}
                          </p>
                        )}
                        <div className="mt-2 flex flex-wrap gap-2">
                          {s.status !== "CANCELLED" && s.status !== "COMPLETED" && (
                            <>
                              <Button size="sm" variant="ghost" onClick={() => toggleSponsorStatus(s)}>
                                {s.status === "ACTIVE" ? "Pause" : "Resume"}
                              </Button>
                              <Button size="sm" variant="ghost" className="text-destructive" onClick={() => cancelSponsor(s)}>
                                Cancel
                              </Button>
                            </>
                          )}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </TabsContent>

            <TabsContent value="requests" className="mt-0 space-y-3">
              {requestsLoading ? (
                <div className="space-y-2">
                  {Array.from({ length: 3 }).map((_, i) => (
                    <Skeleton key={i} className="h-16 w-full" />
                  ))}
                </div>
              ) : requests.length === 0 ? (
                <EmptyState
                  icon={<Inbox className="size-6" aria-hidden="true" />}
                  title="No help requests"
                  hint="Requests submitted for this beneficiary will appear here."
                />
              ) : (
                <ul className="max-h-96 space-y-2 overflow-y-auto scrollbar-thin" aria-label="Help requests">
                  {requests.map((r) => (
                    <li key={r.id} className="rounded-lg border bg-card p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="text-sm font-medium">{r.name}</span>
                        <span className="flex items-center gap-1.5">
                          <StatusBadge status={r.urgency} tone={urgencyTone(r.urgency)} />
                          <StatusBadge status={r.status} />
                        </span>
                      </div>
                      <p className="mt-1 text-sm text-muted-foreground">{r.details}</p>
                      <p className="mt-1.5 text-xs text-muted-foreground">
                        {titleCase(r.category)} · {formatDateTime(r.createdAt)}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </TabsContent>
          </Tabs>
        ) : null}
      </DetailSheet>

      {/* ------------------------------ Confirmations --------------------------- */}
      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
        title="Delete beneficiary?"
        recordName={deleteTarget ? `${deleteTarget.name} · ${labelOf(categoryOptions, deleteTarget.category)}` : ""}
        description="The case, its notes and links to distributions will be permanently removed. This cannot be undone."
        confirmLabel="Delete case"
        onConfirm={confirmDelete}
      />
      <ConfirmDialog
        open={!!closeTarget}
        onOpenChange={(o) => !o && setCloseTarget(null)}
        title="Close this case?"
        recordName={closeTarget?.name ?? ""}
        description="Closing marks the case as CLOSED — support stops and it moves out of the active workflow."
        confirmLabel="Close case"
        onConfirm={confirmCloseCase}
      />
      <ConfirmDialog
        open={!!rejectTarget}
        onOpenChange={(o) => !o && setRejectTarget(null)}
        title="Reject this case?"
        recordName={rejectTarget?.name ?? ""}
        description="Rejection marks the case as REJECTED — the request will not proceed. Prefer closing a completed case instead."
        confirmLabel="Reject case"
        onConfirm={confirmRejectCase}
      />

      {/* ---------------------- Auto-match sponsor suggestions -------------------- */}
      <Dialog open={matchOpen} onOpenChange={setMatchOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Suggested donor ↔ beneficiary matches</DialogTitle>
            <DialogDescription>
              Active recurring needs without a sponsor, paired with monthly donors who have capacity.
              Configure the matching pool in Settings → Recurring Matching. Assigning a match creates a
              normal sponsorship — nothing is auto-charged.
            </DialogDescription>
          </DialogHeader>
          {matchLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-16 w-full" />
              ))}
            </div>
          ) : !matchMeta.enabled ? (
            <EmptyState
              icon={<HeartHandshake className="size-6" aria-hidden="true" />}
              title="Auto-matching is turned off"
              hint="Enable it under Settings → Recurring Matching."
            />
          ) : matchSuggestions.length === 0 ? (
            <EmptyState
              icon={<HeartHandshake className="size-6" aria-hidden="true" />}
              title="No suggestions right now"
              hint={
                matchMeta.unmatchedNeeds === 0
                  ? "Every active recurring need already has a sponsor."
                  : "There are unmatched needs but no donors with spare capacity in the configured pool."
              }
            />
          ) : (
            <ul className="max-h-[28rem] space-y-2 overflow-y-auto scrollbar-thin" aria-label="Match suggestions">
              {matchSuggestions.map((s) => {
                const key = `${s.recurringNeedId}:${s.donorId}`;
                return (
                  <li key={key} className="rounded-lg border bg-card p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-sm font-medium">
                        {s.donorName} <span className="text-muted-foreground">→</span> {s.beneficiaryName}
                      </span>
                      <StatusBadge status={s.urgencyLevel} tone={urgencyTone(s.urgencyLevel)} />
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Covers {s.itemName} ×{s.qtyPerCycle} {s.unit} / {titleCase(s.cycle)}
                      {s.beneficiaryCity ? ` · ${s.beneficiaryCity}` : ""}
                    </p>
                    <div className="mt-2 flex items-center justify-between">
                      <span className="text-sm font-semibold">{formatINR(s.suggestedAmountPerMonth)}/mo</span>
                      <Button size="sm" onClick={() => acceptMatch(s)} disabled={assigningKey === key}>
                        {assigningKey === key ? "Assigning…" : "Assign"}
                      </Button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
