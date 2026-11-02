"use client";

import { useState } from "react";
import { post } from "@/lib/api-client";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Section, HelplineCard } from "@/components/public/shared";
import { Clock, Loader2, Mail, MapPin, MessageSquareHeart, Send } from "lucide-react";

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

export function ContactPage() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!name.trim()) {
      toast.error("Please enter your name");
      return;
    }
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())) {
      toast.error("Please enter a valid email");
      return;
    }
    if (!subject.trim()) {
      toast.error("Please add a subject");
      return;
    }
    if (message.trim().length < 10) {
      toast.error("Message should be at least 10 characters");
      return;
    }
    setBusy(true);
    try {
      await post("/api/contact-queries", {
        name: name.trim(),
        email: email.trim(),
        phone: phone.trim() || undefined,
        subject: subject.trim(),
        message: message.trim(),
      });
      toast.success("Query received — we reply within 2 working days.");
      setName("");
      setEmail("");
      setPhone("");
      setSubject("");
      setMessage("");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not send your query");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Section
        title="Contact us"
        subtitle="Partnerships, school adoptions, CSR, volunteering or a question about a programme — write to us."
      >
        <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
          {/* Form */}
          <Card className="p-5 sm:p-6">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="c-name">Name *</Label>
                <Input id="c-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="c-email">Email *</Label>
                <Input id="c-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="c-phone">Phone</Label>
                <Input id="c-phone" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="10-digit mobile (optional)" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="c-subject">Subject *</Label>
                <Input id="c-subject" value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="e.g. Adopt a school pad bank" />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="c-msg">Message *</Label>
                <Textarea
                  id="c-msg"
                  rows={5}
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  placeholder="Tell us what you need — the more specific, the faster we can help."
                />
              </div>
            </div>
            <Button
              size="lg"
              className="mt-5 h-12 bg-emerald-600 hover:bg-emerald-700 sm:px-10"
              onClick={submit}
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
          </Card>

          {/* Info cards */}
          <div className="space-y-4">
            <Card className="flex gap-3 p-5">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-emerald-100 text-emerald-700">
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
              <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-emerald-100 text-emerald-700">
                <Mail className="size-5" aria-hidden />
              </span>
              <div className="min-w-0">
                <h3 className="font-semibold">Email</h3>
                <a
                  href="mailto:care@unitedangelreach.org"
                  className="mt-1 block truncate text-sm font-medium text-emerald-700 hover:underline"
                >
                  care@unitedangelreach.org
                </a>
                <p className="mt-0.5 text-xs text-muted-foreground">Replies within 2 working days</p>
              </div>
            </Card>
            <Card className="flex gap-3 p-5">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-emerald-100 text-emerald-700">
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
            <Card className="border-emerald-200 bg-emerald-50/60 p-5">
              <p className="flex items-start gap-2 text-sm leading-relaxed text-emerald-900">
                <MessageSquareHeart className="mt-0.5 size-5 shrink-0 text-emerald-700" aria-hidden />
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
