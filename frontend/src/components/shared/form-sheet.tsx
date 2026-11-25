"use client";

/**
 * FormSheet — the single slide-over drawer used for ALL Add and Edit
 * operations across the app (replaces every centered Dialog form).
 *
 * Width contract (desktop ≥ sm):
 *  - every size is at least 60% of the viewport, per design spec
 *  - "full" opens a 75vw workbench (85vw on small screens), matching DetailSheet
 *  - full-screen behaviour on mobile for every size
 *
 * - Sticky header (title + description + close) and sticky footer
 *   (Cancel + Save) with an "unsaved changes" hint
 * - Submit/loading/disabled states, keyboard accessible (Esc closes)
 * - Unsaved-changes guard via `dirty` prop
 *
 * Usage:
 *   <FormSheet open onOpenChange title="Record donation" size="lg"
 *     submitLabel="Save donation" onSubmit={save} loading={saving} dirty={dirty}>
 *     …form fields…
 *   </FormSheet>
 */

import { useEffect } from "react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Loader2, X } from "lucide-react";
import { cn } from "@/lib/utils";

export type FormSheetSize = "sm" | "half" | "md" | "lg" | "xl" | "full";

/** Every size ≥ 60vw on desktop; "full" is the 75vw slide-over
 *  (85vw ≥ sm, 75vw ≥ md) used for detail-heavy add/edit workbenches.
 *  "half" is the 50vw variant used for focused wizards (adopt/sponsor). */
const SIZE_CLASS: Record<FormSheetSize, string> = {
  sm: "sm:w-[60vw] sm:max-w-[60vw]",
  half: "sm:w-[50vw] sm:max-w-[50vw]",
  md: "sm:w-[68vw] sm:max-w-[68vw]",
  lg: "sm:w-[76vw] sm:max-w-[76vw]",
  xl: "sm:w-[88vw] sm:max-w-[88vw]",
  full: "w-full sm:w-[85vw] sm:max-w-[85vw] md:w-[75vw] md:max-w-[75vw] h-full",
};

export interface FormSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children?: React.ReactNode;
  onSubmit?: () => void | Promise<void>;
  submitLabel?: string;
  cancelLabel?: string;
  loading?: boolean;
  dirty?: boolean;
  size?: FormSheetSize;
  /** Optional small pill/badge rendered in the header (e.g. record ref). */
  badge?: React.ReactNode;
  footerExtra?: React.ReactNode;
  /** Custom sticky-footer content — replaces the default Cancel/Save row
   *  (used by wizard-style flows that step their own navigation). */
  footer?: React.ReactNode;
}

export function FormSheet({
  open,
  onOpenChange,
  title,
  description,
  children,
  onSubmit,
  submitLabel = "Save changes",
  cancelLabel = "Cancel",
  loading = false,
  dirty = false,
  size = "md",
  badge,
  footerExtra,
  footer,
}: FormSheetProps) {
  const requestOpenChange = (nextOpen: boolean) => {
    if (loading && !nextOpen) return;
    if (!nextOpen && dirty && !window.confirm("Discard your unsaved changes?")) return;
    onOpenChange(nextOpen);
  };

  // Warn before losing unsaved edits on tab close / reload
  useEffect(() => {
    if (!open || !dirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [open, dirty]);

  return (
    <Sheet open={open} onOpenChange={requestOpenChange}>
      <SheetContent
        side="right"
        className={cn(
          "flex w-full flex-col gap-0 p-0 sm:w-full",
          SIZE_CLASS[size]
        )}
      >
        <SheetHeader className="sticky top-0 z-10 gap-1 border-b bg-background/95 px-6 py-4 pr-14 backdrop-blur supports-[backdrop-filter]:bg-background/80">
          <div className="flex flex-wrap items-center gap-2">
            <SheetTitle className="text-base font-semibold leading-snug">
              {title}
            </SheetTitle>
            {badge}
          </div>
          {description ? (
            <SheetDescription className="text-xs leading-relaxed">
              {description}
            </SheetDescription>
          ) : null}
          <button
            type="button"
            aria-label="Close drawer"
            disabled={loading}
            onClick={() => requestOpenChange(false)}
            className="absolute right-4 top-4 rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <X className="size-4" />
          </button>
        </SheetHeader>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (onSubmit && !loading) void onSubmit();
          }}
          className="flex min-h-0 flex-1 flex-col"
          noValidate
        >
          <ScrollArea className="min-h-0 flex-1">
            <div className="flex min-h-full flex-col gap-5 px-6 py-5">
              {children}
            </div>
          </ScrollArea>

          {onSubmit || footer ? (
            <SheetFooter className="sticky bottom-0 z-10 flex-row items-center justify-between gap-3 border-t bg-background/95 px-6 py-4 backdrop-blur supports-[backdrop-filter]:bg-background/80">
              {footer !== undefined ? (
                footer
              ) : (
                <>
                  <div className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
                    {footerExtra}
                    {dirty ? (
                      <span className="truncate">
                        Unsaved changes — remember to save.
                      </span>
                    ) : null}
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      disabled={loading}
                      onClick={() => requestOpenChange(false)}
                    >
                      {cancelLabel}
                    </Button>
                    <Button type="submit" disabled={loading}>
                      {loading ? (
                        <Loader2 className="size-4 animate-spin" />
                      ) : null}
                      {loading ? "Saving…" : submitLabel}
                    </Button>
                  </div>
                </>
              )}
            </SheetFooter>
          ) : null}
        </form>
      </SheetContent>
    </Sheet>
  );
}
