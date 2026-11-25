import { useEffect, useState } from "react";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";

/**
 * Shared helper for the Mobile admin pages (feed, stories & reels, rooms,
 * verifications, audio spaces, settings, notifications & FAQs). Single source
 * of truth for the mobile-compat fetch wrapper — no page may re-implement it.
 */
export interface Envelope {
  status?: boolean;
  message?: string;
  data?: unknown;
}

export async function mfetch<T>(path: string, body?: unknown): Promise<T> {
  const token = typeof window !== "undefined" ? localStorage.getItem("uar_token") : null;
  const res = await fetch(path, {
    method: body !== undefined ? "POST" : "GET",
    headers: {
      "Content-Type": "application/json",
      apikey: "mobile-admin",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    cache: "no-store",
  });
  const json = (await res.json().catch(() => null)) as Envelope | null;
  if (json && typeof json.status === "boolean") {
    if (!json.status) throw new Error(json.message || "Request failed");
    return (json.data ?? json) as T;
  }
  if (!res.ok) throw new Error(`Request failed (${res.status})`);
  return json as T;
}

/* ────────────────────── server-side search + pagination ────────────────────── */
// Same UX pattern as the campaigns/users pages: debounced search input,
// 1-based page, page-size selector, server-side start/limit + q.

export function usePagedSearch(defaultLimit = 20) {
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(defaultLimit);

  useEffect(() => {
    const t = setTimeout(() => {
      setQuery(search.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [search]);

  return { search, setSearch, query, page, setPage, limit, setLimit, start: (page - 1) * limit };
}

export function SearchInput({
  value,
  onChange,
  placeholder,
  label,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  label: string;
}) {
  return (
    <div className="relative min-w-[200px] flex-1 sm:max-w-xs">
      <Search
        className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
        aria-hidden="true"
      />
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="h-8 pl-8 text-sm"
        aria-label={label}
      />
    </div>
  );
}
