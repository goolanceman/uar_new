"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { Card, CardContent } from "@/components/ui/card";

/**
 * SectionCard — the standard content card: shadcn Card shell with a consistent
 * header row (icon chip + title + description, actions right-aligned) and a
 * CardContent body. Use `bodyClassName` to tweak body padding/layout.
 */
export function SectionCard({
  title,
  description,
  icon,
  actions,
  children,
  className,
  bodyClassName,
}: {
  title: string;
  description?: string;
  icon?: React.ReactNode;
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <Card className={cn("gap-4 py-5", className)}>
      <div className="flex flex-wrap items-start justify-between gap-3 px-5">
        <div className="flex min-w-0 items-start gap-3">
          {icon && (
            <span
              aria-hidden="true"
              className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"
            >
              {icon}
            </span>
          )}
          <div className="min-w-0">
            <h3 className="text-sm font-semibold tracking-tight sm:text-base">
              {title}
            </h3>
            {description && (
              <p className="mt-0.5 text-xs text-muted-foreground sm:text-sm">
                {description}
              </p>
            )}
          </div>
        </div>
        {actions && (
          <div className="flex flex-wrap items-center gap-2">{actions}</div>
        )}
      </div>
      <CardContent className={cn("px-5", bodyClassName)}>{children}</CardContent>
    </Card>
  );
}

export default SectionCard;
