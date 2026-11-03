"use client";

/**
 * Typed fetch wrapper for all client → API calls.
 *
 * Auth strategy (works in every embedding context):
 *  - If a session token is present in localStorage it is sent as
 *    `Authorization: Bearer <token>` (survives cross-site preview iframes
 *    where SameSite cookies are blocked).
 *  - The httpOnly session cookie is still the primary mechanism for normal
 *    top-level browsing.
 */

const TOKEN_KEY = "uar_token";

export function getToken(): string | null {
  try {
    return window.localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setToken(token: string | null): void {
  try {
    if (token) window.localStorage.setItem(TOKEN_KEY, token);
    else window.localStorage.removeItem(TOKEN_KEY);
  } catch {
    // storage unavailable (private mode) — cookie-only fallback applies
  }
}

export async function api<T = unknown>(
  path: string,
  options?: { method?: string; body?: unknown }
): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(path, {
    method: options?.method ?? "GET",
    headers,
    body: options?.body !== undefined ? JSON.stringify(options.body) : undefined,
    cache: "no-store",
  });
  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    // empty body
  }
  if (!res.ok) {
    const msg =
      (data as { error?: string })?.error ||
      `Request failed (${res.status})`;
    throw new Error(msg);
  }
  return data as T;
}

export const get = <T = unknown>(path: string) => api<T>(path);
export const post = <T = unknown>(path: string, body?: unknown) =>
  api<T>(path, { method: "POST", body });
export const patch = <T = unknown>(path: string, body?: unknown) =>
  api<T>(path, { method: "PATCH", body });
export const del = <T = unknown>(path: string) =>
  api<T>(path, { method: "DELETE" });
