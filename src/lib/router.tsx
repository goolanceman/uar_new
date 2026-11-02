"use client";

import { useEffect, useState, useCallback } from "react";

/**
 * Tiny hash-based router.
 * The sandbox exposes a single Next.js route (/), so all app navigation
 * happens via location.hash, e.g. #/campaigns/anti-drug.
 */

function currentPath(): string {
  const h = window.location.hash.replace(/^#/, "");
  return h === "" || h === "/" ? "/" : h.replace(/\/+$/, "") || "/";
}

export function navigate(to: string) {
  if (to.startsWith("#")) to = to.slice(1);
  window.location.hash = to.startsWith("/") ? to : `/${to}`;
  window.scrollTo({ top: 0 });
}

export function useRoute() {
  const [path, setPath] = useState<string>("/");
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const onChange = () => {
      setPath(currentPath());
      setTick((t) => t + 1);
    };
    window.addEventListener("hashchange", onChange);
    setPath(currentPath());
    return () => window.removeEventListener("hashchange", onChange);
  }, []);

  const segments = path.split("/").filter(Boolean);
  const query = new URLSearchParams(
    path.includes("?") ? path.split("?")[1] : ""
  );

  return {
    path,
    segments,
    query,
    key: `${path}-${tick}`,
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
