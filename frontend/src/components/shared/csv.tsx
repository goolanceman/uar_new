"use client";

/**
 * CSV export — one implementation instead of the two drifting copies.
 * `downloadCsv(filename, columns, rows)` builds RFC-4180-ish output with
 * BOM for Excel; `ExportMenu` renders the toolbar button + options.
 */

import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Download, FileSpreadsheet, Printer } from "lucide-react";

export type CsvColumn<T> = {
  header: string;
  value: (row: T) => string | number | null | undefined;
};

function escapeCell(v: string | number | null | undefined): string {
  const s = v === null || v === undefined ? "" : String(v);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function buildCsv<T>(columns: CsvColumn<T>[], rows: T[]): string {
  const head = columns.map((c) => escapeCell(c.header)).join(",");
  const body = rows
    .map((r) => columns.map((c) => escapeCell(c.value(r))).join(","))
    .join("\r\n");
  return `\uFEFF${head}\r\n${body}`;
}

export function downloadCsv<T>(
  filename: string,
  columns: CsvColumn<T>[],
  rows: T[]
): void {
  const blob = new Blob([buildCsv(columns, rows)], {
    type: "text/csv;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename.endsWith(".csv") ? filename : `${filename}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function ExportMenu<T>({
  columns,
  rows,
  filename,
  disabled,
  extraItems,
}: {
  columns: CsvColumn<T>[];
  rows: T[];
  filename: string;
  disabled?: boolean;
  extraItems?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" disabled={disabled}>
          <Download className="size-4" /> Export
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuItem
          onClick={() => {
            downloadCsv(filename, columns, rows);
            setOpen(false);
          }}
        >
          <FileSpreadsheet className="size-4" /> Download CSV
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => {
            window.print();
            setOpen(false);
          }}
        >
          <Printer className="size-4" /> Print view
        </DropdownMenuItem>
        {extraItems}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
