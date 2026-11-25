"use client";

/**
 * Form primitives — Field wrapper with label/hint/error, and typed inputs
 * bound to a plain-object form state. Every add/edit drawer composes these
 * so labels, hints, error styling and spacing stay consistent app-wide.
 */

import { useId } from "react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

// ─── Field shell ─────────────────────────────────────────────────────────────

export function Field({
  label,
  hint,
  error,
  required,
  children,
  className,
  htmlFor,
}: {
  label?: string;
  hint?: string;
  error?: string | null;
  required?: boolean;
  children: React.ReactNode;
  className?: string;
  htmlFor?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      {label ? (
        <Label htmlFor={htmlFor} className="text-xs font-medium">
          {label}
          {required ? <span className="ml-0.5 text-destructive">*</span> : null}
        </Label>
      ) : null}
      {children}
      {error ? (
        <p className="text-xs font-medium text-destructive" role="alert">
          {error}
        </p>
      ) : hint ? (
        <p className="text-xs text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
}

// ─── Text input bound to form state ─────────────────────────────────────────

export function TextField({
  label,
  hint,
  error,
  required,
  value,
  onChange,
  placeholder,
  type = "text",
  disabled,
  className,
  prefix,
  step,
  min,
  max,
  maxLength,
  onBlur,
  inputMode,
}: {
  label?: string;
  hint?: string;
  error?: string | null;
  required?: boolean;
  value: string | number;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
  disabled?: boolean;
  className?: string;
  prefix?: string;
  step?: string;
  min?: string;
  max?: string;
  maxLength?: number;
  onBlur?: () => void;
  inputMode?: "text" | "numeric" | "decimal" | "tel" | "email" | "url";
}) {
  const id = useId();
  return (
    <Field
      label={label}
      hint={hint}
      error={error}
      required={required}
      className={className}
      htmlFor={id}
    >
      <div className="relative">
        {prefix ? (
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
            {prefix}
          </span>
        ) : null}
        <Input
          id={id}
          type={type}
          inputMode={inputMode}
          value={value}
          step={step}
          min={min}
          max={max}
          maxLength={maxLength}
          disabled={disabled}
          placeholder={placeholder}
          onBlur={onBlur}
          aria-invalid={!!error}
          className={cn(prefix && "pl-8", error && "border-destructive focus-visible:ring-destructive")}
          onChange={(e) => onChange(e.target.value)}
        />
      </div>
    </Field>
  );
}

// ─── Textarea ────────────────────────────────────────────────────────────────

export function TextareaField({
  label,
  hint,
  error,
  required,
  value,
  onChange,
  placeholder,
  rows = 3,
  disabled,
  className,
}: {
  label?: string;
  hint?: string;
  error?: string | null;
  required?: boolean;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  rows?: number;
  disabled?: boolean;
  className?: string;
}) {
  const id = useId();
  return (
    <Field
      label={label}
      hint={hint}
      error={error}
      required={required}
      className={className}
      htmlFor={id}
    >
      <Textarea
        id={id}
        rows={rows}
        value={value}
        disabled={disabled}
        placeholder={placeholder}
        aria-invalid={!!error}
        className={cn(error && "border-destructive focus-visible:ring-destructive")}
        onChange={(e) => onChange(e.target.value)}
      />
    </Field>
  );
}

// ─── Select bound to form state ──────────────────────────────────────────────

export function SelectField<T extends string>({
  label,
  hint,
  error,
  required,
  value,
  onChange,
  options,
  placeholder = "Select…",
  disabled,
  className,
}: {
  label?: string;
  hint?: string;
  error?: string | null;
  required?: boolean;
  value: T | "";
  onChange: (v: T) => void;
  options: Array<{ value: T; label: string; disabled?: boolean }>;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <Field label={label} hint={hint} error={error} required={required} className={className}>
      <Select
        value={value || undefined}
        onValueChange={(v) => onChange(v as T)}
        disabled={disabled}
      >
        <SelectTrigger
          aria-invalid={!!error}
          className={cn("w-full", error && "border-destructive focus-visible:ring-destructive")}
        >
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent>
          {options.map((o) => (
            <SelectItem key={o.value} value={o.value} disabled={o.disabled}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Field>
  );
}

// ─── Switch bound to form state ──────────────────────────────────────────────

export function SwitchField({
  label,
  hint,
  checked,
  onChange,
  disabled,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <div className="flex items-start justify-between gap-4 rounded-lg border bg-muted/30 px-3 py-2.5">
      <div className="min-w-0">
        <Label htmlFor={id} className="text-xs font-medium">
          {label}
        </Label>
        {hint ? <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p> : null}
      </div>
      <Switch
        id={id}
        checked={checked}
        disabled={disabled}
        onCheckedChange={onChange}
        className="shrink-0"
      />
    </div>
  );
}

// ─── Section divider inside drawers ─────────────────────────────────────────

export function FormSection({
  title,
  description,
  children,
  className,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("flex flex-col gap-3.5", className)}>
      <div className="border-b pb-2">
        <h3 className="text-sm font-semibold">{title}</h3>
        {description ? (
          <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {children}
    </section>
  );
}

/** Two-column responsive grid used inside drawers. */
export function FieldGrid({
  children,
  cols = 2,
}: {
  children: React.ReactNode;
  cols?: 1 | 2 | 3;
}) {
  return (
    <div
      className={cn(
        "grid gap-4",
        cols === 2 && "sm:grid-cols-2",
        cols === 3 && "sm:grid-cols-3"
      )}
    >
      {children}
    </div>
  );
}
