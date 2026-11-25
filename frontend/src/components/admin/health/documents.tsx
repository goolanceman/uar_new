"use client";

/**
 * Health Programme — Documents tab.
 *
 * Medical documents register: beneficiary search → upload a file from the
 * shared FilePicker (URL from fileUrl(id)) with a kind → list with links.
 * AI document-extraction panel appears only when /api/health-ai responds
 * (gracefully hidden otherwise, e.g. while the backend agent is still
 * landing).
 */

import { useCallback, useEffect, useState } from "react";
import {
  FileText,
  FolderOpen,
  Plus,
  Sparkles,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { get, post } from "@/lib/api-client";
import { formatDateTime } from "@/lib/format";
import { humanize, StatusBadge } from "@/components/shared/status-badge";
import { EmptyState } from "@/components/shared/empty-state";
import { SectionCard } from "@/components/shared/section-card";
import { FormSheet } from "@/components/shared/form-sheet";
import { FormSection, SelectField, TextField } from "@/components/shared/form-fields";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { FilePickButton, fileUrl } from "@/components/shared/file-picker";
import type { TabProps } from "./overview";
import {
  asItems,
  BeneficiarySearch,
  DOC_KINDS,
  errorText,
  type AiInteractionRow,
  type BeneficiaryLite,
  type MedicalDocRow,
} from "./shared";

export default function DocumentsTab({ revision }: TabProps) {
  /* beneficiary + list */
  const [picked, setPicked] = useState<BeneficiaryLite | null>(null);
  const [docs, setDocs] = useState<MedicalDocRow[] | null>(null);
  const [docsError, setDocsError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  /* upload sheet */
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [kind, setKind] = useState("PRESCRIPTION");
  const [url, setUrl] = useState("");
  const [saving, setSaving] = useState(false);

  /* AI extract panel — hidden entirely while /api/health-ai is missing (503) */
  const [ai, setAi] = useState<AiInteractionRow[] | null>(null);

  const load = useCallback(async () => {
    if (!picked) {
      setDocs(null);
      return;
    }
    setLoading(true);
    setDocsError(null);
    try {
      const d = await get<unknown>(`/api/medical-documents?beneficiaryId=${picked.id}`);
      setDocs(asItems<MedicalDocRow>(d));
    } catch (e) {
      setDocsError(errorText(e));
      setDocs([]);
    } finally {
      setLoading(false);
    }
  }, [picked]);

  useEffect(() => {
    load();
  }, [load, revision]);

  /* probe the AI endpoint once; hide panel on any failure */
  useEffect(() => {
    let alive = true;
    get<unknown>("/api/health-ai")
      .then((d) => {
        if (alive) setAi(asItems<AiInteractionRow>(d).slice(0, 5));
      })
      .catch(() => {
        if (alive) setAi(null);
      });
    return () => {
      alive = false;
    };
  }, []);

  const save = async () => {
    if (!picked) {
      toast.error("Pick a beneficiary first");
      return;
    }
    if (!name.trim() || !url) {
      toast.error("Add a document name and pick a file");
      return;
    }
    setSaving(true);
    try {
      await post("/api/medical-documents", {
        beneficiaryId: picked.id,
        name: name.trim(),
        kind,
        url,
      });
      toast.success("Document saved");
      setOpen(false);
      setName("");
      setUrl("");
      await load();
    } catch (e) {
      toast.error(errorText(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4 lg:grid lg:grid-cols-3 lg:gap-6 lg:space-y-0">
      {/* documents */}
      <div className="space-y-4 lg:col-span-2">
        <div className="flex flex-wrap items-center gap-2">
          {picked ? (
            <div className="flex min-w-56 items-center justify-between gap-2 rounded-lg border bg-primary/5 px-3 py-2">
              <span className="truncate text-sm font-medium">{picked.name}</span>
              <Button variant="ghost" size="sm" className="h-8 px-2" aria-label="Clear selected beneficiary" onClick={() => setPicked(null)}>
                <X className="size-3.5" aria-hidden="true" />
              </Button>
            </div>
          ) : (
            <div className="min-w-56 flex-1">
              <BeneficiarySearch onPick={setPicked} placeholder="Pick a beneficiary to see their documents…" />
            </div>
          )}
          <Button className="min-h-11 sm:min-h-9 sm:ml-auto" disabled={!picked} onClick={() => setOpen(true)}>
            <Plus className="size-4" aria-hidden="true" /> Add document
          </Button>
        </div>

        {docsError ? (
          <EmptyState icon={<FolderOpen className="size-8" aria-hidden="true" />} title="Documents could not load" hint={docsError}>
            <Button variant="outline" size="sm" className="min-h-11" onClick={load}>
              Retry
            </Button>
          </EmptyState>
        ) : !picked ? (
          <EmptyState
            icon={<FolderOpen className="size-8" aria-hidden="true" />}
            title="No beneficiary selected"
            hint="Search for a beneficiary above — their prescriptions, lab reports and scans appear here with upload."
          />
        ) : loading ? (
          <div className="space-y-2" aria-busy="true">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-14 w-full rounded-lg" />
            ))}
          </div>
        ) : (docs ?? []).length === 0 ? (
          <EmptyState
            icon={<FileText className="size-8" aria-hidden="true" />}
            title="No documents yet"
            hint="Upload prescriptions, lab reports, scans and discharge summaries — files live in the file library and link to the beneficiary's timeline."
          >
            <Button size="sm" className="min-h-11" onClick={() => setOpen(true)}>
              <Plus className="size-4" aria-hidden="true" /> Add document
            </Button>
          </EmptyState>
        ) : (
          <ul className="space-y-2" aria-label="Medical documents">
            {(docs ?? []).map((d) => (
              <li key={d.id} className="flex flex-wrap items-center gap-3 rounded-xl border bg-card px-4 py-3">
                <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <FileText className="size-5" aria-hidden="true" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{d.name}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {d.createdAt ? formatDateTime(d.createdAt) : "—"}
                  </p>
                </div>
                {d.kind ? <Badge variant="outline">{humanize(d.kind)}</Badge> : null}
                <a
                  href={d.url?.startsWith("/") ? d.url : fileUrl(d.url)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="min-h-11 rounded-md border px-3 text-xs font-semibold leading-[44px] text-primary hover:bg-accent sm:min-h-9 sm:leading-[36px]"
                >
                  Open
                </a>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* AI extract panel — only when the AI service is reachable */}
      <div className="space-y-4">
        <SectionCard
          title="AI document extraction"
          description="Automated reading of uploaded reports."
          icon={<Sparkles className="size-4" aria-hidden="true" />}
        >
          {ai === null ? (
            <p className="text-xs text-muted-foreground">
              The AI extraction service is not enabled right now — this panel activates automatically
              when the health AI endpoint is available.
            </p>
          ) : ai.length === 0 ? (
            <p className="text-xs text-muted-foreground">No AI interactions recorded yet.</p>
          ) : (
            <ul className="max-h-72 space-y-2 overflow-y-auto scrollbar-thin" aria-label="AI interactions">
              {ai.map((a) => (
                <li key={a.id} className="rounded-lg border px-3 py-2">
                  <div className="flex items-center justify-between gap-2">
                    <p className="truncate text-xs font-semibold">{a.kind ?? "Extraction"}</p>
                    <StatusBadge status={a.status} />
                  </div>
                  {a.output ? (
                    <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{a.output}</p>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </SectionCard>

        <SectionCard title="How documents flow" description="Where uploads come from.">
          <ul className="list-disc space-y-1.5 pl-4 text-xs text-muted-foreground">
            <li>Camps upload lab reports and prescriptions from the camp desk.</li>
            <li>Pharmacists attach dispensing slips; doctors attach referrals.</li>
            <li>Admins (here) upload anything missing and link it to the beneficiary.</li>
          </ul>
        </SectionCard>
      </div>

      {/* add document FormSheet */}
      <FormSheet
        open={open}
        onOpenChange={setOpen}
        title="Add medical document"
        description={picked ? `Linked to ${picked.name}.` : undefined}
        size="sm"
        submitLabel="Save document"
        loading={saving}
        dirty={!!name.trim() || !!url}
        onSubmit={save}
      >
        <FormSection title="Document">
          <TextField label="Document name" required value={name} onChange={setName} placeholder="e.g. CBC report — Nov 2026" />
          <SelectField
            label="Kind"
            value={kind}
            onChange={setKind}
            options={DOC_KINDS.map((k) => ({ value: k, label: humanize(k) }))}
          />
          <div className="space-y-2">
            <p className="text-xs font-medium">File<span className="ml-0.5 text-destructive">*</span></p>
            <FilePickButton
              label={url ? "Replace file" : "Pick file"}
              folder="medical-documents"
              onPicked={(files) => {
                if (files[0]) {
                  setUrl(fileUrl(files[0].id));
                  if (!name.trim()) setName(files[0].title || files[0].name);
                  toast.success("File attached");
                }
              }}
            />
            {url ? (
              <Badge variant="outline" className="max-w-full truncate border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300">
                {url}
              </Badge>
            ) : null}
          </div>
        </FormSection>
      </FormSheet>
    </div>
  );
}
