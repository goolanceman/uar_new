"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * PageHeader — consistent sticky-feel title row for any view/portal page.
 * Icon chip on the left, title + muted description in the middle, actions
 * right-aligned. Wraps cleanly on mobile (actions drop to a full-width row).
 */
export function PageHeader({
  title,
  description,
  icon,
  actions,
  className,
}: {
  title: string;
  description?: string;
  icon?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <header
      className={cn(
        "flex flex-wrap items-start gap-3 border-b pb-4",
        className
      )}
    >
      {icon && (
        <span
          aria-hidden="true"
          className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary"
        >
          {icon}
        </span>
      )}
      <div className="min-w-0 flex-1">
        <h1 className="text-lg font-semibold tracking-tight sm:text-xl">
          {title}
        </h1>
        {description && (
          <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>
        )}
      </div>
      {actions && (
        <div className="flex w-full flex-wrap items-center gap-2 sm:ml-auto sm:w-auto">
          {actions}
        </div>
      )}
    </header>
  );
}

export default PageHeader;
