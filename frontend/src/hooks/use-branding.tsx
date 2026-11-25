"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { get } from "@/lib/api-client";

/**
 * Site branding (logo, favicon, org name) — admin-managed via
 * Settings → Organisation → Branding, sourced from GET /api/settings/public
 * (no auth required so it loads on every portal + the public site).
 * Ships with the UAR emerald logo as the default so the site never renders
 * without a brand mark, even before the first settings fetch resolves.
 */

export interface Branding {
  name: string;
  logoUrl: string;
  faviconUrl: string;
}

export const DEFAULT_BRANDING: Branding = {
  name: "United Angel Reach",
  logoUrl: "/logo_uar_final_emerald.svg",
  faviconUrl: "/logo_uar_final_emerald.svg",
};

const BrandingContext = createContext<Branding>(DEFAULT_BRANDING);

export function BrandingProvider({ children }: { children: React.ReactNode }) {
  const [branding, setBranding] = useState<Branding>(DEFAULT_BRANDING);

  useEffect(() => {
    let cancelled = false;
    get<{ orgName?: string; logoUrl?: string; faviconUrl?: string }>("/api/settings/public")
      .then((data) => {
        if (cancelled) return;
        setBranding({
          name: data.orgName?.trim() || DEFAULT_BRANDING.name,
          logoUrl: data.logoUrl?.trim() || DEFAULT_BRANDING.logoUrl,
          faviconUrl: data.faviconUrl?.trim() || DEFAULT_BRANDING.faviconUrl,
        });
      })
      .catch(() => {
        // keep defaults — public pages must never fail to render on this
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <BrandingContext.Provider value={branding}>{children}</BrandingContext.Provider>
  );
}

export function useBranding(): Branding {
  return useContext(BrandingContext);
}
