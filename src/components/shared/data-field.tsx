"use client";

import * as React from "react";
import { Check, Copy } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

/**
 * DataField — labelled key/value row used across detail panels and summaries.
 * - `mono` renders the value in monospace (ids, codes, receipt numbers).
 * - `copy` shows a small ghost copy button when the value is a non-empty string.
 * - Renders an em-dash for null / undefined / empty values.
 */
export function DataField({
  label,
  value,
  icon,
  mono,
  copy,
  className,
}: {
  label: string;
  value: React.ReactNode;
  icon?: React.ReactNode;
  mono?: boolean;
  copy?: boolean;
  className?: string;
}) {
  const [copied, setCopied] = React.useState(false);

  const isEmpty =
    value === null || value === undefined || (typeof value === "string" && value.length === 0);

  const copyable = copy === true && typeof value === "string" && value.length > 0;

  const handleCopy = async () => {
    if (typeof value !== "string") return;
    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(value);
      } else {
        const el = document.createElement("textarea");
        el.value = value;
        el.style.position = "fixed";
        el.style.opacity = "0";
        document.body.appendChild(el);
        el.select();
        document.execCommand("copy");
        document.body.removeChild(el);
      }
      setCopied(true);
      toast.success("Copied");
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      toast.error("Could not copy");
    }
  };

  return (
    <div className={cn("min-w-0", className)}>
      <p className="flex items-center gap-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {icon && <span aria-hidden="true" className="shrink-0">{icon}</span>}
        <span className="truncate">{label}</span>
      </p>
      <div className="mt-0.5 flex items-start gap-1.5">
        <span
          className={cn(
            "min-w-0 break-words text-sm leading-snug",
            mono && "font-mono text-xs",
            isEmpty && "text-muted-foreground/60"
          )}
        >
          {isEmpty ? "—" : value}
        </span>
        {copyable && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={`Copy ${label}`}
            className="size-9 shrink-0 text-muted-foreground hover:text-foreground sm:size-7"
            onClick={handleCopy}
          >
            {copied ? (
              <Check className="size-3.5 text-primary" aria-hidden="true" />
            ) : (
              <Copy className="size-3.5" aria-hidden="true" />
            )}
          </Button>
        )}
      </div>
    </div>
  );
}

export default DataField;
