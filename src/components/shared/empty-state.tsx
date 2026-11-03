"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * EmptyState — friendly dashed-border placeholder for empty lists / no results.
 * Slot `children` usually holds an action Button ("Add …", "Reset filters").
 */
export function EmptyState({
  icon,
  title,
  hint,
  children,
  className,
}: {
  icon?: React.ReactNode;
  title: string;
  hint?: string;
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed bg-muted/30 px-6 py-10 text-center",
        className
      )}
    >
      {icon && (
        <span
          aria-hidden="true"
          className="flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground"
        >
          {icon}
        </span>
      )}
      <div className="space-y-1">
        <p className="text-sm font-semibold">{title}</p>
        {hint && (
          <p className="mx-auto max-w-sm text-xs leading-relaxed text-muted-foreground">
            {hint}
          </p>
        )}
      </div>
      {children && <div className="mt-1">{children}</div>}
    </div>
  );
}

export default EmptyState;
