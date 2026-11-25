"use client";

/**
 * Hospital partner portal — Profile & Staff. Edit the organisation profile
 * (PATCH /api/health-orgs/:id — own org only) and manage professionals
 * (GET/POST /api/health-professionals; verification is ADMIN-only, shown
 * read-only here).
 */

import { useCallback, useEffect, useState } from "react";
import { Plus, UserRound, Users } from "lucide-react";
import { toast } from "sonner";
import type { SessionUser } from "@/hooks/use-auth";
import { del, get, patch, post } from "@/lib/api-client";
import { formatDate } from "@/lib/format";
import { SectionCard } from "@/components/shared/section-card";
import { StatusBadge } from "@/components/shared/status-badge";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { FormSheet } from "@/components/shared/form-sheet";
import { FieldGrid, SelectField, TextField, TextareaField } from "@/components/shared/form-fields";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  asArray,
  ListSkeleton,
  medTone,
  QuietEmpty,
  toastError,
  type HealthOrgRow,
  type ProfessionalRow,
} from "../doctor/shared";
import { OrgNotFound, PartnerHeader, useMyOrg } from "./shared";

interface OrgForm {
  name: string;
  type: string;
  city: string;
  address: string;
  phone: string;
  email: string;
  website: string;
  regNumber: string;
  services: string;
  facilities: string;
  operatingHours: string;
  notes: string;
}

interface StaffForm {
  name: string;
  kind: string;
  speciality: string;
  qualification: string;
  regNumber: string;
  experienceYears: string;
  phone: string;
  email: string;
}

const ROLE_OPTIONS = [
  { value: "DOCTOR", label: "Doctor" },
  { value: "NURSE", label: "Nurse" },
  { value: "PHARMACIST", label: "Pharmacist" },
  { value: "LAB_TECH", label: "Lab technician" },
  { value: "OTHER", label: "Other clinical staff" },
];

const EMPTY_ORG: OrgForm = { name: "", type: "", city: "", address: "", phone: "", email: "", website: "", regNumber: "", services: "", facilities: "", operatingHours: "", notes: "" };
const EMPTY_STAFF: StaffForm = { name: "", kind: "DOCTOR", speciality: "", qualification: "", regNumber: "", experienceYears: "", phone: "", email: "" };

export default function PartnerProfile({ user }: { user: SessionUser }) {
  const { org, loading: orgLoading, error: orgError, reload } = useMyOrg();

  const [staff, setStaff] = useState<ProfessionalRow[]>([]);
  const [staffLoading, setStaffLoading] = useState(true);
  const [staffError, setStaffError] = useState<string | null>(null);

  const [orgSheet, setOrgSheet] = useState(false);
  const [orgForm, setOrgForm] = useState<OrgForm>(EMPTY_ORG);
  const [savingOrg, setSavingOrg] = useState(false);

  const [staffSheet, setStaffSheet] = useState(false);
  const [staffForm, setStaffForm] = useState<StaffForm>(EMPTY_STAFF);
  const [savingStaff, setSavingStaff] = useState(false);
  const [confirmStaff, setConfirmStaff] = useState<ProfessionalRow | null>(null);
  const [removing, setRemoving] = useState(false);

  const loadStaff = useCallback(async () => {
    setStaffLoading(true);
    setStaffError(null);
    try {
      const data = await get<unknown>("/api/health-professionals");
      setStaff(asArray<ProfessionalRow>(data));
    } catch (e) {
      setStaffError(e instanceof Error ? e.message : "Could not load staff");
      setStaff([]);
    } finally {
      setStaffLoading(false);
    }
  }, []);

  useEffect(() => {
    loadStaff();
  }, [loadStaff]);

  const openOrgSheet = () => {
    if (!org) return;
    setOrgForm({
      name: org.name ?? "",
      type: org.type ?? "",
      city: org.city ?? "",
      address: org.address ?? "",
      phone: org.phone ?? "",
      email: org.email ?? "",
      website: org.website ?? "",
      regNumber: org.regNumber ?? "",
      services: org.services ?? "",
      facilities: org.facilities ?? "",
      operatingHours: org.operatingHours ?? "",
      notes: org.notes ?? "",
    });
    setOrgSheet(true);
  };

  const saveOrg = async () => {
    if (!org) return;
    if (!orgForm.name.trim()) {
      toast.error("Organisation name is required");
      return;
    }
    setSavingOrg(true);
    try {
      await patch(`/api/health-orgs/${org.id}`, {
        name: orgForm.name.trim() || undefined,
        type: orgForm.type.trim() || undefined,
        city: orgForm.city.trim() || undefined,
        address: orgForm.address.trim() || undefined,
        phone: orgForm.phone.trim() || undefined,
        email: orgForm.email.trim() || undefined,
        website: orgForm.website.trim() || undefined,
        regNumber: orgForm.regNumber.trim() || undefined,
        services: orgForm.services.trim() || undefined,
        facilities: orgForm.facilities.trim() || undefined,
        operatingHours: orgForm.operatingHours.trim() || undefined,
        notes: orgForm.notes.trim() || undefined,
      });
      toast.success("Profile saved");
      setOrgSheet(false);
      await reload();
    } catch (e) {
      toastError(e, "Could not save the profile");
    } finally {
      setSavingOrg(false);
    }
  };

  const saveStaff = async () => {
    if (!staffForm.name.trim()) {
      toast.error("Staff name is required");
      return;
    }
    setSavingStaff(true);
    try {
      await post("/api/health-professionals", {
        orgId: org?.id || undefined,
        name: staffForm.name.trim(),
        kind: staffForm.kind,
        speciality: staffForm.speciality.trim() || undefined,
        qualification: staffForm.qualification.trim() || undefined,
        regNumber: staffForm.regNumber.trim() || undefined,
        experienceYears: staffForm.experienceYears ? Number(staffForm.experienceYears) : undefined,
        phone: staffForm.phone.trim() || undefined,
        email: staffForm.email.trim() || undefined,
      });
      toast.success("Staff member added — a UAR admin verifies clinical staff");
      setStaffSheet(false);
      await loadStaff();
    } catch (e) {
      toastError(e, "Could not add the staff member");
    } finally {
      setSavingStaff(false);
    }
  };

  const removeStaff = async () => {
    if (!confirmStaff) return;
    setRemoving(true);
    try {
      await del(`/api/health-professionals/${confirmStaff.id}`);
      toast.success("Staff member removed");
      setConfirmStaff(null);
      await loadStaff();
    } catch (e) {
      toastError(e, "Could not remove the staff member");
    } finally {
      setRemoving(false);
    }
  };

  return (
    <div className="space-y-6">
      <PartnerHeader title="Profile & staff" description="Keep your organisation's details current and manage your clinical team." />

      {orgLoading ? (
        <Skeleton className="h-40 w-full rounded-xl" />
      ) : orgError && !org ? (
        <div role="alert" className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-700 dark:text-red-300">
          {orgError}
        </div>
      ) : !org ? (
        <OrgNotFound />
      ) : (
        <SectionCard
          title="Organisation profile"
          description="Shown to UAR coordinators and doctors when referring patients"
          actions={
            <Button size="sm" variant="outline" className="min-h-11 gap-1.5 sm:min-h-9" onClick={openOrgSheet}>
              Edit profile
            </Button>
          }
        >
          <div className="grid gap-3 text-sm sm:grid-cols-2">
            <p><span className="text-muted-foreground">Name: </span><span className="font-medium">{org.name}</span></p>
            <p><span className="text-muted-foreground">Status: </span><StatusBadge status={org.status ?? "PENDING"} tone={medTone(org.status)} /></p>
            <p><span className="text-muted-foreground">Type: </span><span className="font-medium">{org.type || "—"}</span></p>
            <p><span className="text-muted-foreground">Phone: </span><span className="font-medium">{org.phone || "—"}</span></p>
            <p><span className="text-muted-foreground">Email: </span><span className="font-medium">{org.email || "—"}</span></p>
            <p><span className="text-muted-foreground">City: </span><span className="font-medium">{org.city || "—"}</span></p>
            <p className="sm:col-span-2"><span className="text-muted-foreground">Address: </span><span className="font-medium">{org.address || "—"}</span></p>
            {org.regNumber && <p><span className="text-muted-foreground">Reg number: </span><span className="font-medium font-mono">{org.regNumber}</span></p>}
            {org.website && <p><span className="text-muted-foreground">Website: </span><span className="font-medium">{org.website}</span></p>}
            {org.services && <p className="sm:col-span-2"><span className="text-muted-foreground">Services: </span><span className="font-medium">{org.services}</span></p>}
            {org.notes && <p className="sm:col-span-2 text-muted-foreground">{org.notes}</p>}
          </div>
        </SectionCard>
      )}

      <SectionCard
        title="Clinical staff"
        description="Doctors, nurses, pharmacists and lab technicians of your organisation"
        actions={
          <Button size="sm" className="min-h-11 gap-1.5 sm:min-h-9" onClick={() => { setStaffForm(EMPTY_STAFF); setStaffSheet(true); }}>
            <Plus className="size-4" aria-hidden="true" />
            Add staff
          </Button>
        }
      >
        {staffLoading ? (
          <ListSkeleton rows={3} />
        ) : staff.length === 0 ? (
          <QuietEmpty
            icon={<Users className="size-5" />}
            title="No staff added yet"
            error={staffError}
            hint="Add your clinical team so UAR can roster them to camps."
          />
        ) : (
          <ul className="max-h-96 divide-y overflow-y-auto scrollbar-thin">
            {staff.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 py-3 first:pt-0 last:pb-0">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <UserRound className="size-4" aria-hidden="true" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{s.name}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {s.kind ? s.kind.replace("_", " ") : "Staff"}
                    {s.speciality ? ` · ${s.speciality}` : ""}
                    {s.qualification ? ` · ${s.qualification}` : ""}
                    {s.phone ? ` · ${s.phone}` : ""}
                    {s.createdAt ? ` · added ${formatDate(s.createdAt)}` : ""}
                  </p>
                </div>
                <StatusBadge status={s.verificationStatus ?? "PENDING"} tone={medTone(s.verificationStatus)}>
                  {s.verificationStatus === "VERIFIED" ? "Verified" : "Awaiting verification"}
                </StatusBadge>
                <Button
                  size="sm"
                  variant="outline"
                  className="min-h-11 sm:min-h-9"
                  onClick={() => setConfirmStaff(s)}
                  aria-label={`Remove ${s.name} from staff`}
                >
                  Remove
                </Button>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>

      {/* Org profile FormSheet */}
      <FormSheet
        open={orgSheet}
        onOpenChange={setOrgSheet}
        title="Edit organisation profile"
        description="Updates are reviewed by UAR — verification status stays with the admin team."
        size="md"
        submitLabel="Save profile"
        onSubmit={saveOrg}
        loading={savingOrg}
        dirty={orgForm.name !== (org?.name ?? "")}
      >
        <FieldGrid>
          <TextField label="Organisation name" required value={orgForm.name} onChange={(v) => setOrgForm((f) => ({ ...f, name: v }))} />
          <TextField label="Type" value={orgForm.type} onChange={(v) => setOrgForm((f) => ({ ...f, type: v }))} placeholder="HOSPITAL / LAB / CLINIC" />
          <TextField label="Phone" type="tel" inputMode="tel" value={orgForm.phone} onChange={(v) => setOrgForm((f) => ({ ...f, phone: v }))} />
          <TextField label="Email" type="email" inputMode="email" value={orgForm.email} onChange={(v) => setOrgForm((f) => ({ ...f, email: v }))} />
          <TextField label="City" value={orgForm.city} onChange={(v) => setOrgForm((f) => ({ ...f, city: v }))} />
          <TextField label="Registration number" value={orgForm.regNumber} onChange={(v) => setOrgForm((f) => ({ ...f, regNumber: v }))} />
          <TextField label="Website" value={orgForm.website} onChange={(v) => setOrgForm((f) => ({ ...f, website: v }))} className="sm:col-span-2" />
        </FieldGrid>
        <TextField label="Address" value={orgForm.address} onChange={(v) => setOrgForm((f) => ({ ...f, address: v }))} />
        <TextareaField label="Services" value={orgForm.services} onChange={(v) => setOrgForm((f) => ({ ...f, services: v }))} rows={2} placeholder="OPD, pharmacy, diagnostics…" />
        <TextareaField label="Facilities & operating hours" value={orgForm.facilities} onChange={(v) => setOrgForm((f) => ({ ...f, facilities: v }))} rows={2} placeholder="X-ray, lab; Mon–Sat 9am–6pm" />
      </FormSheet>

      {/* Add staff FormSheet */}
      <FormSheet
        open={staffSheet}
        onOpenChange={setStaffSheet}
        title="Add staff member"
        description="UAR verifies clinical credentials before camp rosters include them."
        size="sm"
        submitLabel="Add staff member"
        onSubmit={saveStaff}
        loading={savingStaff}
        dirty={staffForm.name !== "" || staffForm.speciality !== "" || staffForm.phone !== "" || staffForm.email !== ""}
      >
        <FieldGrid>
          <TextField label="Full name" required value={staffForm.name} onChange={(v) => setStaffForm((f) => ({ ...f, name: v }))} />
          <SelectField label="Role" value={staffForm.kind as StaffForm["kind"]} onChange={(v) => setStaffForm((f) => ({ ...f, kind: v }))} options={ROLE_OPTIONS} />
          <TextField label="Speciality" value={staffForm.speciality} onChange={(v) => setStaffForm((f) => ({ ...f, speciality: v }))} placeholder="e.g. General medicine" />
          <TextField label="Qualification" value={staffForm.qualification} onChange={(v) => setStaffForm((f) => ({ ...f, qualification: v }))} placeholder="e.g. MBBS, B.Sc Nursing" />
          <TextField label="Registration number" value={staffForm.regNumber} onChange={(v) => setStaffForm((f) => ({ ...f, regNumber: v }))} />
          <TextField label="Experience (years)" type="number" inputMode="numeric" value={staffForm.experienceYears} onChange={(v) => setStaffForm((f) => ({ ...f, experienceYears: v }))} />
          <TextField label="Phone" type="tel" inputMode="tel" value={staffForm.phone} onChange={(v) => setStaffForm((f) => ({ ...f, phone: v }))} />
          <TextField label="Email" type="email" inputMode="email" value={staffForm.email} onChange={(v) => setStaffForm((f) => ({ ...f, email: v }))} />
        </FieldGrid>
      </FormSheet>

      {/* Remove staff confirmation */}
      <ConfirmDialog
        open={!!confirmStaff}
        onOpenChange={(o) => !o && setConfirmStaff(null)}
        title="Remove this staff member?"
        recordName={confirmStaff?.name}
        description="They will no longer be rosterable to UAR camps through your organisation. Their past records are kept."
        confirmLabel="Remove"
        loading={removing}
        onConfirm={removeStaff}
      />
    </div>
  );
}
