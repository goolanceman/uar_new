"use client";

import { useState } from "react";
import { post } from "@/lib/api-client";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { TextField, TextareaField, FieldGrid } from "@/components/shared/form-fields";
import { Section, HelplineCard } from "@/components/public/shared";
import { emailRule, phoneRule, minLen, required, fieldError } from "@/lib/validators";
import {
  CheckCircle2,
  Clock,
  Loader2,
  Mail,
  MapPin,
  MessageSquareHeart,
  Send,
} from "lucide-react";

const HELPLINES = [
  { name: "Police & Fire", number: "112", desc: "Any emergency, 24×7", accent: "red" },
  { name: "Ambulance", number: "108", desc: "Free emergency response", accent: "emerald" },
  { name: "Cyber Fraud", number: "1930", desc: "Freeze stolen money", accent: "cyan" },
  { name: "Women (Sakhi)", number: "181", desc: "Support, shelter, legal aid", accent: "fuchsia" },
  { name: "CHILDLINE", number: "1098", desc: "Any child in distress", accent: "amber" },
  { name: "De-addiction", number: "14446", desc: "Free, confidential", accent: "orange" },
  { name: "Drug trafficking (NCB)", number: "1933", desc: "Anonymous tips", accent: "teal" },
  { name: "Animal rescue (AWBI)", number: "1962", desc: "Injured / mistreated animals", accent: "lime" },
];

interface ContactForm {
  name: string;
  email: string;
  phone: string;
  subject: string;
  message: string;
}

type ContactErrors = Partial<Record<keyof ContactForm, string | null>>;

const EMPTY_FORM: ContactForm = { name: "", email: "", phone: "", subject: "", message: "" };

export function ContactPage() {
  const [form, setForm] = useState<ContactForm>(EMPTY_FORM);
  const [errors, setErrors] = useState<ContactErrors>({});
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  const setField = (key: keyof ContactForm) => (v: string) => {
    setForm((f) => ({ ...f, [key]: v }));
    // Clear the field's inline error as soon as the visitor starts fixing it
    setErrors((e) => (e[key] ? { ...e, [key]: null } : e));
  };

  const validate = (): ContactErrors => {
    return {
      name: fieldError(form.name, [required("Name")]),
      email: fieldError(form.email, [emailRule()]),
      phone: fieldError(form.phone, [phoneRule(true)]),
      subject: fieldError(form.subject, [required("Subject")]),
      message: fieldError(form.message, [minLen(10, "Message")]),
    };
  };

  const submit = async () => {
    const errs = validate();
    setErrors(errs);
    if (Object.values(errs).some(Boolean)) {
      toast.error("Please fix the highlighted fields");
      return;
    }
    setBusy(true);
    try {
      await post("/api/contact-queries", {
        name: form.name.trim(),
        email: form.email.trim(),
        phone: form.phone.trim() || undefined,
        subject: form.subject.trim(),
        message: form.message.trim(),
      });
      toast.success("Query received — we reply within 2 working days.");
      setSent(true);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not send your query");
    } finally {
      setBusy(false);
    }
  };

  const reset = () => {
    setForm(EMPTY_FORM);
    setErrors({});
    setSent(false);
  };

  return (
    <>
      <Section
        title="Contact us"
        subtitle="Partnerships, school adoptions, CSR, volunteering or a question about a programme — write to us."
      >
        <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
          {/* Form / success screen */}
          <Card className="p-5 sm:p-6">
            {sent ? (
              <div
                role="status"
                aria-live="polite"
                className="flex flex-col items-center gap-3 py-10 text-center"
              >
                <span className="flex size-14 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
                  <CheckCircle2 className="size-7" aria-hidden />
                </span>
                <h3 className="text-lg font-bold tracking-tight">Message received</h3>
                <p className="max-w-sm text-sm leading-relaxed text-muted-foreground">
                  Thank you, {form.name.trim().split(/\s+/)[0] || "friend"}. Our team replies within
                  2 working days. For emergencies, use the 24×7 helplines alongside — they are
                  always faster than email.
                </p>
                <Button variant="outline" className="mt-2" onClick={reset}>
                  <Send className="size-4" aria-hidden /> Send another message
                </Button>
              </div>
            ) : (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void submit();
                }}
                noValidate
              >
                <FieldGrid>
                  <TextField
                    label="Name"
                    required
                    value={form.name}
                    onChange={setField("name")}
                    error={errors.name}
                    placeholder="Your name"
                    autoComplete="name"
                  />
                  <TextField
                    label="Email"
                    required
                    type="email"
                    inputMode="email"
                    value={form.email}
                    onChange={setField("email")}
                    error={errors.email}
                    placeholder="you@example.com"
                    autoComplete="email"
                  />
                  <TextField
                    label="Phone"
                    type="tel"
                    inputMode="tel"
                    value={form.phone}
                    onChange={setField("phone")}
                    error={errors.phone}
                    hint="Optional — a 10-digit Indian mobile"
                    placeholder="10-digit mobile (optional)"
                    autoComplete="tel"
                  />
                  <TextField
                    label="Subject"
                    required
                    value={form.subject}
                    onChange={setField("subject")}
                    error={errors.subject}
                    placeholder="e.g. Adopt a school pad bank"
                  />
                </FieldGrid>
                <TextareaField
                  className="mt-4"
                  label="Message"
                  required
                  rows={5}
                  value={form.message}
                  onChange={setField("message")}
                  error={errors.message}
                  placeholder="Tell us what you need — the more specific, the faster we can help."
                />
                <Button
                  type="submit"
                  size="lg"
                  className="mt-5 h-12 bg-emerald-600 hover:bg-emerald-700 sm:px-10"
                  disabled={busy}
                >
                  {busy ? (
                    <>
                      <Loader2 className="size-5 animate-spin" aria-hidden /> Sending…
                    </>
                  ) : (
                    <>
                      <Send className="size-4" aria-hidden /> Send message
                    </>
                  )}
                </Button>
              </form>
            )}
          </Card>

          {/* Info cards */}
          <div className="space-y-4">
            <Card className="flex gap-3 p-5">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400">
                <MapPin className="size-5" aria-hidden />
              </span>
              <div>
                <h3 className="font-semibold">Visit / write</h3>
                <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                  United Angel Reach Trust,
                  <br />
                  Bengaluru, Karnataka, India
                </p>
              </div>
            </Card>
            <Card className="flex gap-3 p-5">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400">
                <Mail className="size-5" aria-hidden />
              </span>
              <div className="min-w-0">
                <h3 className="font-semibold">Email</h3>
                <a
                  href="mailto:care@unitedangelreach.org"
                  className="mt-1 block truncate text-sm font-medium text-emerald-700 hover:underline dark:text-emerald-400"
                >
                  care@unitedangelreach.org
                </a>
                <p className="mt-0.5 text-xs text-muted-foreground">Replies within 2 working days</p>
              </div>
            </Card>
            <Card className="flex gap-3 p-5">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400">
                <Clock className="size-5" aria-hidden />
              </span>
              <div>
                <h3 className="font-semibold">Hours</h3>
                <p className="mt-1 text-sm text-muted-foreground">
                  Monday – Saturday
                  <br />
                  9:30 AM – 6:30 PM IST
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Emergencies: use the helplines below — they&rsquo;re 24×7.
                </p>
              </div>
            </Card>
            <Card className="border-emerald-200 bg-emerald-50/60 p-5 dark:border-emerald-500/25 dark:bg-emerald-500/10">
              <p className="flex items-start gap-2 text-sm leading-relaxed text-emerald-900 dark:text-emerald-100">
                <MessageSquareHeart className="mt-0.5 size-5 shrink-0 text-emerald-700 dark:text-emerald-400" aria-hidden />
                Schools, CSR teams and hospitals: mention your city and scale — we&rsquo;ll send the
                relevant playbook the same week.
              </p>
            </Card>
          </div>
        </div>
      </Section>

      <Section title="24×7 helplines" subtitle="For emergencies, always call these first — they are national, free and staffed round the clock." className="bg-muted/40">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {HELPLINES.map((h) => (
            <HelplineCard key={h.number} {...h} />
          ))}
        </div>
      </Section>
    </>
  );
}
