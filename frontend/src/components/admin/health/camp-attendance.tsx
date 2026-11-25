"use client";

/**
 * Camp check-in desk — used inside the camp DetailSheet attendance tab.
 *
 *  - `CheckinSearch` searches WITHIN the camp's registrations (check-in needs
 *    a registrationId), shows the picked beneficiary and the four method
 *    buttons (QR / ID / PHONE / MANUAL).
 *  - `QueueTable` renders the live queue: token, beneficiary, check-in time &
 *    method, status advance dropdown and a no-show action.
 */

import { useMemo, useState } from "react";
import { Check, ChevronDown, Search, UserRound, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatDateTime } from "@/lib/format";
import { humanize, StatusBadge } from "@/components/shared/status-badge";
import { EmptyState } from "@/components/shared/empty-state";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { attTransitions, type AttendanceRow, type RegRow } from "./shared";
import { canTransitionAttendance } from "@/lib/camp-attendance";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/** Registration search + check-in method selector. */
const METHODS = ["QR", "ID", "PHONE", "MANUAL"] as const;

export function CheckinSearch({
  regs,
  method,
  onMethodChange,
  onCheckIn,
  disabled,
}: {
  regs: RegRow[];
  method: string;
  onMethodChange: (m: string) => void;
  onCheckIn: (reg: RegRow) => void;
  disabled?: boolean;
}) {
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<RegRow | null>(null);
  const [open, setOpen] = useState(false);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q.length < 2) return [];
    return regs
      .filter((r) => {
        const b = r.beneficiary;
        return (
          (b?.name ?? "").toLowerCase().includes(q) ||
          (b?.phone ?? "").includes(q) ||
          (b?.code ?? "").toLowerCase().includes(q) ||
          (r.code ?? "").toLowerCase().includes(q)
        );
      })
      .slice(0, 6);
  }, [regs, query]);

  const active = picked && picked.status !== "CANCELLED" && picked.status !== "REJECTED";

  return (
    <div className="space-y-2">
      {picked ? (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border bg-card px-3 py-2.5">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
            <UserRound className="size-4" aria-hidden="true" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium">{picked.beneficiary?.name ?? "Beneficiary"}</span>
            <span className="block truncate text-xs text-muted-foreground">
              {[picked.beneficiary?.code, picked.beneficiary?.phone, picked.status].filter(Boolean).join(" · ")}
            </span>
          </span>
          <Button
            variant="ghost"
            size="icon"
            className="size-9"
            aria-label="Clear selected beneficiary"
            onClick={() => setPicked(null)}
          >
            <X className="size-4" aria-hidden="true" />
          </Button>
          <div className="flex w-full flex-wrap items-center gap-1.5" role="group" aria-label="Check-in method">
            {METHODS.map((m) => (
              <button
                key={m}
                type="button"
                aria-pressed={method === m}
                disabled={disabled}
                onClick={() => onMethodChange(m)}
                className={cn(
                  "min-h-9 rounded-full border px-3 text-xs font-semibold transition-colors",
                  method === m
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border bg-background text-muted-foreground hover:bg-accent"
                )}
              >
                {m}
              </button>
            ))}
          </div>
          <Button className="min-h-11 w-full sm:w-auto" disabled={disabled || !active} onClick={() => picked && onCheckIn(picked)}>
            <Check className="size-4" aria-hidden="true" /> Check in ({method})
          </Button>
        </div>
      ) : null}

      <div className="relative">
        <Search
          className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden="true"
        />
        <Input
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          placeholder="Search registered beneficiary by name / phone / code…"
          aria-label="Search registered beneficiary for check-in"
          className="h-11 pl-9"
        />
        {open && query.trim().length >= 2 ? (
          <div
            role="listbox"
            aria-label="Registered beneficiary results"
            className="absolute z-30 mt-1 max-h-56 w-full overflow-y-auto rounded-lg border bg-card shadow-lg scrollbar-thin"
          >
            {matches.length === 0 ? (
              <p className="px-3 py-3 text-xs text-muted-foreground">
                No matching registration — register the beneficiary first (Registrations tab).
              </p>
            ) : (
              matches.map((r) => {
                const blocked = r.status === "CANCELLED" || r.status === "REJECTED";
                return (
                  <button
                    key={r.id}
                    type="button"
                    role="option"
                    aria-selected={false}
                    disabled={blocked}
                    onClick={() => {
                      setPicked(r);
                      setQuery("");
                      setOpen(false);
                    }}
                    className="flex min-h-11 w-full items-center gap-2.5 px-3 py-2 text-left transition-colors hover:bg-accent focus-visible:bg-accent focus-visible:outline-none disabled:opacity-50"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{r.beneficiary?.name ?? "—"}</span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {[r.beneficiary?.code, r.beneficiary?.phone, r.code].filter(Boolean).join(" · ")}
                      </span>
                    </span>
                    <StatusBadge status={r.status} />
                  </button>
                );
              })
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}

/** Live camp queue with status advance + no-show. */
export function QueueTable({
  rows,
  loading,
  onAdvance,
}: {
  rows: AttendanceRow[];
  loading: boolean;
  onAdvance: (row: AttendanceRow, status: string) => void;
}) {
  if (loading) {
    return (
      <div className="space-y-2" aria-busy="true">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-10 animate-pulse rounded-md bg-muted" />
        ))}
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <EmptyState
        icon={<UserRound className="size-7" aria-hidden="true" />}
        title="Queue is empty"
        hint="Check-ins appear here the moment beneficiaries arrive — each gets a queue token and flows Waiting → In consultation → Completed → Checked out."
      />
    );
  }

  return (
    <div className="overflow-hidden rounded-xl border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-16">Token</TableHead>
            <TableHead>Beneficiary</TableHead>
            <TableHead className="hidden sm:table-cell">Checked in</TableHead>
            <TableHead className="hidden md:table-cell">Method</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="w-12 text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => {
            const moves = attTransitions(r.status);
            const name = r.beneficiary?.name ?? "—";
            return (
              <TableRow key={r.id}>
                <TableCell className="font-mono text-xs font-semibold">{r.queueToken ?? "—"}</TableCell>
                <TableCell className="font-medium">{name}</TableCell>
                <TableCell className="hidden text-xs text-muted-foreground sm:table-cell">
                  {r.checkInAt ? formatDateTime(r.checkInAt) : "—"}
                </TableCell>
                <TableCell className="hidden md:table-cell">
                  {r.checkInMethod ? (
                    <Badge variant="outline" className="font-mono text-[10px]">
                      {r.checkInMethod}
                    </Badge>
                  ) : (
                    "—"
                  )}
                </TableCell>
                <TableCell>
                  <StatusBadge status={r.status} />
                </TableCell>
                <TableCell className="text-right">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" className="size-8" aria-label={`Queue actions for ${name}`}>
                        <ChevronDown className="size-4" aria-hidden="true" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-52">
                      <DropdownMenuLabel className="text-[10px] uppercase tracking-wide text-muted-foreground">
                        {humanize(r.status)}
                      </DropdownMenuLabel>
                      {moves.map((m) => (
                        <DropdownMenuItem key={m.status} onClick={() => onAdvance(r, m.status)}>
                          <Check className="size-4" aria-hidden="true" /> {m.label}
                        </DropdownMenuItem>
                      ))}
                      {canTransitionAttendance(r.status, "NO_SHOW") ? (
                        <DropdownMenuItem
                          className="text-red-600 focus:text-red-600 dark:text-red-400 dark:focus:text-red-400"
                          onClick={() => onAdvance(r, "NO_SHOW")}
                        >
                          <X className="size-4" aria-hidden="true" /> Mark no-show
                        </DropdownMenuItem>
                      ) : null}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
