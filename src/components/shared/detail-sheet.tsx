"use client";

/**
 * DetailSheet — the standard full-screen slide-over for viewing a record's
 * complete details (distributions, campaigns, donations, … anywhere a
 * detail-heavy, read-mostly view is needed).
 *
 * Contract per design spec:
 *  - Full-screen slide-over on desktop and mobile
 *  - Proper sticky header: eyebrow (module), title, status badge, actions
 *  - Scrollable body: organised in labelled sections (children)
 *  - Proper sticky footer: primary action(s) + close
 *  - Esc to close, focus accessible
 *
 * Usage:
 *   <DetailSheet open onOpenChange eyebrow="Distributions" title="DIST-0007"
 *     status={<StatusBadge …>} actions={<Button…/>} footer={<>…</>}>
 *     <DetailSection title="Overview">…fields…</DetailSection>
 *   </DetailSheet>
 */

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

export function DetailSection({
  title,
  description,
  actions,
  children,
  className,
}: {
  title: string;
  description?: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("space-y-3", className)} aria-label={title}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold tracking-tight">{title}</h3>
          {description ? (
            <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
          ) : null}
        </div>
        {actions}
      </div>
      <Separator />
      {children}
    </section>
  );
}

/** Key-value detail field grid — pairs with DataField for dense layouts. */
export function DetailGrid({
  cols = 2,
  children,
  className,
}: {
  cols?: 1 | 2 | 3 | 4;
  children: React.ReactNode;
  className?: string;
}) {
  const map = {
    1: "grid-cols-1",
    2: "grid-cols-1 sm:grid-cols-2",
    3: "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3",
    4: "grid-cols-2 lg:grid-cols-4",
  } as const;
  return (
    <dl className={cn("grid gap-x-6 gap-y-4", map[cols], className)}>
      {children}
    </dl>
  );
}

export interface DetailSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Small uppercase module label above the title (e.g. "Distributions"). */
  eyebrow?: string;
  title: string;
  description?: string;
  /** Status badge / pills row next to the title. */
  status?: React.ReactNode;
  /** Right-aligned header action buttons (Edit, Download, …). */
  actions?: React.ReactNode;
  children: React.ReactNode;
  /** Sticky footer content (primary actions). */
  footer?: React.ReactNode;
  loading?: boolean;
}

export function DetailSheet({
  open,
  onOpenChange,
  eyebrow,
  title,
  description,
  status,
  actions,
  children,
  footer,
  loading = false,
}: DetailSheetProps) {
  return (
    <Sheet open={open} onOpenChange={(o) => !loading && onOpenChange(o)}>
      <SheetContent
        side="right"
        className="flex h-full w-full flex-col gap-0 p-0 sm:w-[100vw] sm:max-w-[100vw]"
      >
        <SheetHeader className="sticky top-0 z-10 gap-1 border-b bg-background/95 px-6 py-4 pr-16 backdrop-blur supports-[backdrop-filter]:bg-background/80">
          {eyebrow ? (
            <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
              {eyebrow}
            </p>
          ) : null}
          <div className="flex flex-wrap items-center gap-2.5">
            <SheetTitle className="text-lg font-semibold tracking-tight">
              {title}
            </SheetTitle>
            {status}
          </div>
          {description ? (
            <SheetDescription className="text-xs leading-relaxed">
              {description}
            </SheetDescription>
          ) : null}
          {actions ? (
            <div className="absolute right-14 top-1/2 flex -translate-y-1/2 items-center gap-1.5">
              {actions}
            </div>
          ) : null}
          <button
            type="button"
            aria-label="Close details"
            onClick={() => onOpenChange(false)}
            className="absolute right-4 top-1/2 -translate-y-1/2 rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <X className="size-4" />
          </button>
        </SheetHeader>

        <ScrollArea className="min-h-0 flex-1">
          <div className="mx-auto flex max-w-5xl flex-col gap-6 px-6 py-6">
            {children}
          </div>
        </ScrollArea>

        {footer ? (
          <div className="sticky bottom-0 z-10 flex flex-wrap items-center justify-between gap-3 border-t bg-background/95 px-6 py-3.5 backdrop-blur supports-[backdrop-filter]:bg-background/80">
            {footer}
          </div>
        ) : (
          <div className="sticky bottom-0 z-10 flex justify-end border-t bg-background/95 px-6 py-3.5 backdrop-blur supports-[backdrop-filter]:bg-background/80">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Close
            </Button>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
