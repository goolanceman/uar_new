"use client";

/**
 * HowItWorksDialog — a numbered-steps explainer shown BEFORE a multi-step
 * commitment flow (adoption, sponsorship, campaign opt-in, etc.). The user
 * must read the steps and explicitly click "I understand, continue" before
 * the real form opens — this is the "explain → agree → proceed" pattern
 * used across donor/beneficiary adopt & opt-in flows.
 */

import { CheckCircle2 } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

export interface HowItWorksStep {
  title: string;
  detail: string;
}

export interface HowItWorksDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  icon: LucideIcon;
  title: string;
  description?: string;
  steps: HowItWorksStep[];
  /** Short note shown after the steps, e.g. "No payment is taken at this step." */
  note?: string;
  continueLabel?: string;
  onContinue: () => void;
}

export function HowItWorksDialog({
  open,
  onOpenChange,
  icon: Icon,
  title,
  description,
  steps,
  note,
  continueLabel = "I understand, continue",
  onContinue,
}: HowItWorksDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span className="flex size-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Icon className="size-4" aria-hidden="true" />
            </span>
            {title}
          </DialogTitle>
          {description ? <DialogDescription>{description}</DialogDescription> : null}
        </DialogHeader>

        <ol className="space-y-3">
          {steps.map((step, i) => (
            <li key={i} className="flex gap-3">
              <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">
                {i + 1}
              </span>
              <div className="min-w-0 pt-0.5">
                <p className="text-sm font-semibold leading-tight">{step.title}</p>
                <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{step.detail}</p>
              </div>
            </li>
          ))}
        </ol>

        {note ? (
          <div className="flex items-start gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-xs text-emerald-900 dark:text-emerald-200">
            <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
            <p>{note}</p>
          </div>
        ) : null}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} className="min-h-11 sm:min-h-9">
            Cancel
          </Button>
          <Button onClick={onContinue} className="min-h-11 sm:min-h-9">
            {continueLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
