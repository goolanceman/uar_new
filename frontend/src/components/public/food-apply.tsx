"use client";

/**
 * Public Food Assistance application (/#/food-assistance/apply).
 * A short, dignified form — consent-first, no documents required, reference
 * number on submission, status check with mobile verification. Also serves
 * assisted applications (a volunteer filling it on someone's behalf).
 */

import { useState } from "react";
import {
  Apple, CheckCircle2, ClipboardList, HandHeart, Search, ShieldCheck,
} from "lucide-react";
import { toast } from "sonner";
import { get, post } from "@/lib/api-client";
import { navigate } from "@/lib/router";
import { formatDate } from "@/lib/format";
import { required, phoneRule, fieldError, validPin } from "@/lib/validators";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { FieldGrid, TextField, TextareaField, SelectField } from "@/components/shared/form-fields";
import { Section, EmptyState } from "@/components/public/shared";

const URGENCIES = [
  { value: "LOW", label: "Can wait a few days" },
  { value: "MEDIUM", label: "Within this week" },
  { value: "HIGH", label: "Urgent — we have little food left" },
  { value: "CRITICAL", label: "Emergency — we have none today" },
];

const SOURCES = [
  { value: "SELF", label: "I am applying for myself / my family" },
  { value: "ASSISTED", label: "Someone is helping me fill this form" },
  { value: "REFERRAL", label: "An organisation referred us" },
  { value: "EMERGENCY", label: "Emergency request (flood, fire, sudden crisis)" },
];

const CONTACTS = [
  { value: "PHONE", label: "Phone call" },
  { value: "SMS", label: "SMS" },
  { value: "WHATSAPP", label: "WhatsApp" },
  { value: "EMAIL", label: "Email" },
];

interface FormState {
  name: string; phone: string; address: string; city: string; pincode: string;
  familyMembers: string; childrenCount: string; seniorCount: string;
  urgency: string; source: string; details: string; dietary: string;
  preferredContact: string; consent: boolean;
}

const EMPTY: FormState = {
  name: "", phone: "", address: "", city: "", pincode: "",
  familyMembers: "1", childrenCount: "", seniorCount: "",
  urgency: "MEDIUM", source: "SELF", details: "", dietary: "",
  preferredContact: "PHONE", consent: false,
};

interface StatusResult {
  refCode: string;
  applicantFirstName: string;
  status: string;
  reviewNote: string | null;
  submittedAt: string;
  lastUpdatedAt: string;
}

const STATUS_COPY: Record<string, string> = {
  PENDING: "Submitted — waiting for our team to pick it up.",
  IN_REVIEW: "Being reviewed by our team right now.",
  APPROVED: "Approved! Our coordinator will contact you about the next distribution.",
  FULFILLED: "Assistance delivered. We're glad we could help.",
  REJECTED: "Not approved this time — see the note below. You can reapply or ask for a reassessment.",
};

export function FoodApplyPage() {
  const [form, setForm] = useState<FormState>(EMPTY);
  const [errors, setErrors] = useState<Record<string, string | null>>({});
  const [busy, setBusy] = useState(false);
  const [refCode, setRefCode] = useState<string | null>(null);

  // status check
  const [check, setCheck] = useState({ refCode: "", phone: "" });
  const [status, setStatus] = useState<StatusResult | null>(null);
  const [statusBusy, setStatusBusy] = useState(false);

  const set = (k: keyof FormState) => (v: string | boolean) =>
    setForm((f) => ({ ...f, [k]: v }) as FormState);

  const submit = async () => {
    const errs: Record<string, string | null> = {
      name: fieldError(form.name, [required("Your full name")]),
      phone: fieldError(form.phone, [phoneRule()]),
      pincode: form.pincode && !validPin(form.pincode) ? "PIN code must look like 560001" : null,
      details: fieldError(form.details, [required("What you need")]),
      consent: form.consent ? null : "Please give consent so our team can review and contact you",
    };
    setErrors(errs);
    if (Object.values(errs).some(Boolean)) return;

    setBusy(true);
    try {
      const res = await post<{ refCode: string; message: string }>("/api/food/applications", {
        ...form,
        familyMembers: Number(form.familyMembers) || undefined,
        childrenCount: Number(form.childrenCount) || undefined,
        seniorCount: Number(form.seniorCount) || undefined,
      });
      setRefCode(res.refCode);
      window.scrollTo({ top: 0 });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Submission failed");
    } finally {
      setBusy(false);
    }
  };

  const checkStatus = async () => {
    if (!check.refCode.trim() || !check.phone.trim()) {
      toast.error("Enter both your reference number and mobile number");
      return;
    }
    setStatusBusy(true);
    try {
      setStatus(await get<StatusResult>(
        `/api/food/applications/status?refCode=${encodeURIComponent(check.refCode.trim())}&phone=${encodeURIComponent(check.phone.trim())}`
      ));
    } catch (e) {
      setStatus(null);
      toast.error(e instanceof Error ? e.message : "Status check failed");
    } finally {
      setStatusBusy(false);
    }
  };

  if (refCode) {
    return (
      <Section>
        <div className="mx-auto max-w-xl text-center">
          <span className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-emerald-500/10 text-emerald-600">
            <CheckCircle2 className="size-7" />
          </span>
          <h1 className="mt-4 text-2xl font-bold tracking-tight">Application received</h1>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            Your reference number is <strong className="font-mono text-base text-emerald-700 dark:text-emerald-400">{refCode}</strong>.
            Keep it safe — you can check your status anytime with it and your mobile number.
          </p>
          <div className="mt-6 rounded-xl border bg-card p-4 text-left text-sm text-muted-foreground">
            <p className="font-medium text-foreground">What happens next</p>
            <ol className="mt-2 list-decimal space-y-1 pl-4">
              <li>Our team reviews your application (usually within 2 working days).</li>
              <li>We may call you on {form.phone} for a short verification.</li>
              <li>Approved families are matched to the nearest distribution programme.</li>
              <li>You receive a reminder with the venue, date and your kit details.</li>
            </ol>
            <p className="mt-3">If your situation is urgent, call our helpline — emergencies are prioritised.</p>
          </div>
          <div className="mt-6 flex flex-wrap justify-center gap-3">
            <Button onClick={() => checkStatusRefThen(refCode, form.phone)}>
              Check status now
            </Button>
            <Button variant="outline" onClick={() => navigate("/")}>Back to home</Button>
          </div>
        </div>
      </Section>
    );
  }

  function checkStatusRefThen(ref: string, phone: string) {
    setStatusBusy(true);
    get<StatusResult>(`/api/food/applications/status?refCode=${encodeURIComponent(ref)}&phone=${encodeURIComponent(phone)}`)
      .then((s) => { setStatus(s); document.getElementById("status-check")?.scrollIntoView({ behavior: "smooth" }); })
      .catch((e) => toast.error(e instanceof Error ? e.message : "Status check failed"))
      .finally(() => setStatusBusy(false));
  }

  return (
    <div>
      {/* Page heading (H1) — unique per page, above every other heading */}
      <section
        aria-labelledby="food-apply-heading"
        className="mx-auto w-full max-w-screen-2xl px-4 pt-12 sm:px-6 sm:pt-16"
      >
        <h1
          id="food-apply-heading"
          className="max-w-3xl text-3xl font-extrabold tracking-tight sm:text-4xl lg:text-5xl"
        >
          Request{" "}
          <span className="text-emerald-600 dark:text-emerald-400">food assistance</span>
        </h1>
        <p className="mt-3 max-w-2xl text-base leading-relaxed text-muted-foreground sm:text-lg">
          Free, confidential ration-kit support from United Angel Reach — reviewed
          by people, delivered to your door with a QR scan.
        </p>
      </section>

      <Section>
        <div className="grid gap-8 lg:grid-cols-5">
          {/* form */}
          <div className="space-y-4 rounded-2xl border bg-card p-6 lg:col-span-3">
            <Badge className="bg-emerald-600 text-white hover:bg-emerald-600">
              <ShieldCheck className="mr-1 size-3" /> Consent-first · confidential
            </Badge>
            <FieldGrid>
              <TextField label="Full name" required value={form.name} onChange={set("name")} error={errors.name} placeholder="Your name" />
              <TextField label="Mobile number" required inputMode="tel" value={form.phone} onChange={set("phone")} error={errors.phone} placeholder="98765 43210" />
            </FieldGrid>
            <FieldGrid>
              <TextField label="Address or locality" value={form.address} onChange={set("address")} placeholder="Area / landmark / shelter name" />
              <TextField label="City" value={form.city} onChange={set("city")} placeholder="Bengaluru" />
            </FieldGrid>
            <FieldGrid cols={3}>
              <TextField label="PIN code" inputMode="numeric" maxLength={6} value={form.pincode} onChange={set("pincode")} error={errors.pincode} placeholder="560001" />
              <TextField label="Family members" inputMode="numeric" value={form.familyMembers} onChange={set("familyMembers")} />
              <TextField label="Children in household" inputMode="numeric" value={form.childrenCount} onChange={set("childrenCount")} placeholder="0" />
            </FieldGrid>
            <FieldGrid cols={3}>
              <TextField label="Senior citizens (60+)" inputMode="numeric" value={form.seniorCount} onChange={set("seniorCount")} placeholder="0" />
              <SelectField label="Urgency" value={form.urgency} onChange={set("urgency")} options={URGENCIES} />
              <SelectField label="How are you applying?" value={form.source} onChange={set("source")} options={SOURCES} />
            </FieldGrid>
            <TextareaField
              label="What kind of help do you need?"
              required
              value={form.details}
              onChange={set("details")}
              error={errors.details}
              placeholder="e.g. Weekly grocery support for a family of four after job loss; any dietary restrictions or allergies."
            />
            <FieldGrid>
              <TextField label="Dietary restrictions / allergies (optional)" value={form.dietary} onChange={set("dietary")} placeholder="e.g. no gluten, diabetic-friendly" />
              <SelectField label="Preferred contact method" value={form.preferredContact} onChange={set("preferredContact")} options={CONTACTS} />
            </FieldGrid>

            <label className="flex cursor-pointer items-start gap-3 rounded-xl border bg-muted/30 p-4 text-sm">
              <input
                type="checkbox"
                checked={form.consent}
                onChange={(e) => set("consent")(e.target.checked)}
                className="mt-0.5 size-4 rounded"
              />
              <span>
                I consent to United Angel Reach reviewing this application and contacting me about food assistance.
                My details are never shared publicly or with donors. <strong className="text-destructive">{errors.consent ?? ""}</strong>
              </span>
            </label>

            <Button className="w-full" size="lg" onClick={submit} disabled={busy}>
              <HandHeart className="size-5" /> {busy ? "Submitting…" : "Submit application"}
            </Button>
            <p className="text-center text-xs text-muted-foreground">
              Emergency? Food packets are available immediately — mention the crisis and choose “Emergency”.
            </p>
          </div>

          {/* side column */}
          <div className="space-y-4 lg:col-span-2">
            <div id="status-check" className="rounded-2xl border bg-card p-6">
              <h2 className="flex items-center gap-2 text-base font-semibold">
                <Search className="size-4 text-emerald-600" /> Check application status
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">Reference number + the mobile number you applied with.</p>
              <div className="mt-4 space-y-3">
                <TextField label="Reference number" value={check.refCode} onChange={(v) => setCheck((c) => ({ ...c, refCode: v }))} placeholder="UAR-FAR-00001" />
                <TextField label="Mobile number" inputMode="tel" value={check.phone} onChange={(v) => setCheck((c) => ({ ...c, phone: v }))} placeholder="98765 43210" />
                <Button variant="outline" className="w-full" onClick={checkStatus} disabled={statusBusy}>
                  {statusBusy ? "Checking…" : "Check status"}
                </Button>
              </div>
              {status && (
                <div className="mt-4 rounded-lg border bg-muted/30 p-3 text-sm">
                  <p className="font-medium">{STATUS_COPY[status.status] ?? status.status}</p>
                  {status.reviewNote && <p className="mt-1 text-muted-foreground">{status.reviewNote}</p>}
                  <p className="mt-2 text-xs text-muted-foreground">
                    Submitted {formatDate(status.submittedAt)} · last updated {formatDate(status.lastUpdatedAt)}
                  </p>
                </div>
              )}
            </div>

            <div className="rounded-2xl border bg-card p-6">
              <h2 className="flex items-center gap-2 text-base font-semibold">
                <ClipboardList className="size-4 text-emerald-600" /> What we ask (and don&apos;t)
              </h2>
              <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
                <li>✓ Household size and urgency — so kits are packed for your family.</li>
                <li>✓ A mobile number — for the reminder and venue details.</li>
                <li>✗ No income proofs, no ration cards, no documents to start.</li>
                <li>✗ No fees, ever. Food assistance is free.</li>
                <li>✗ No public listing of applicants — identities stay private.</li>
              </ul>
            </div>

            <div className="rounded-2xl border bg-emerald-500/10 p-6">
              <h2 className="flex items-center gap-2 text-base font-semibold">
                <Apple className="size-4 text-emerald-600" /> Prefer to talk?
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Visit any UAR distribution point — volunteers fill this form with you (assisted registration).
              </p>
              <Button variant="outline" className="mt-3" onClick={() => navigate("/programs/food-security#distributions")}>
                See upcoming distributions
              </Button>
            </div>
          </div>
        </div>
      </Section>
    </div>
  );
}
