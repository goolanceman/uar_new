"use client";

import { useAuth } from "@/hooks/use-auth";
import { useRoute } from "@/lib/router";
import { ShieldCheck, RefreshCw } from "lucide-react";
import PublicSite from "@/components/public/public-site";
import AdminApp from "@/components/admin/admin-app";
import PortalRouter from "@/components/portal/portal-router";

/**
 * Root shell — single Next.js route with hash-based role routing:
 *   #/…            → public multi-page site
 *   #/admin/…      → admin console (ADMIN)
 *   #/donor/…      → donor portal (DONOR)
 *   #/volunteer/…  → volunteer portal (VOLUNTEER; PENDING sees application status)
 *   #/beneficiary/…→ beneficiary hub
 */
export default function Home() {
  const { user, loading } = useAuth();
  const route = useRoute();

  if (loading) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background">
        <div className="flex size-14 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-lg">
          <ShieldCheck className="size-7" />
        </div>
        <p className="text-sm font-semibold">United Angel Reach</p>
        <RefreshCw className="size-4 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const seg0 = route.segments[0] ?? "";

  if (user && (seg0 === "admin" || seg0 === "donor" || seg0 === "volunteer" || seg0 === "beneficiary")) {
    if (seg0 === "admin" && user.role === "ADMIN") return <AdminApp />;
    return <PortalRouter />;
  }

  return <PublicSite />;
}
