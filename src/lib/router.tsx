"use client";

import { useSyncExternalStore } from "react";

/**
 * Tiny hash-based router (React 19 external-store style).
 * The sandbox exposes a single Next.js route (/), so all app navigation
 * happens via location.hash, e.g. #/campaigns/anti-drug.
 */

function currentPath(): string {
  const h = window.location.hash.replace(/^#/, "");
  return h === "" || h === "/" ? "/" : h.replace(/\/+$/, "") || "/";
}

function subscribe(onChange: () => void) {
  window.addEventListener("hashchange", onChange);
  return () => window.removeEventListener("hashchange", onChange);
}

function getSnapshot(): string {
  return currentPath();
}

function getServerSnapshot(): string {
  return "/";
}

export function navigate(to: string) {
  if (to.startsWith("#")) to = to.slice(1);
  window.location.hash = to.startsWith("/") ? to : `/${to}`;
  window.scrollTo({ top: 0 });
}

export function useRoute() {
  const path = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const segments = path.split("/").filter(Boolean);
  const query = new URLSearchParams(
    path.includes("?") ? path.split("?")[1] : ""
  );

  return {
    path,
    segments,
    query,
    key: path,
  };
}

export function Link({
  href,
  children,
  className,
  onClick,
  ...rest
}: {
  href: string;
  children: React.ReactNode;
  className?: string;
  onClick?: () => void;
} & Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, "href" | "onClick">) {
  const handle = (e: React.MouseEvent) => {
    e.preventDefault();
    onClick?.();
    navigate(href);
  };
  return (
    <a href={`#${href}`} onClick={handle} className={className} {...rest}>
      {children}
    </a>
  );
}

/** Match a path pattern like /campaigns/:slug against segments */
export function matchPath(
  pattern: string,
  segments: string[]
): Record<string, string> | null {
  const parts = pattern.split("/").filter(Boolean);
  if (parts.length !== segments.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < parts.length; i++) {
    if (parts[i].startsWith(":")) {
      params[parts[i].slice(1)] = decodeURIComponent(segments[i]);
    } else if (parts[i] !== segments[i]) {
      return null;
    }
  }
  return params;
}
