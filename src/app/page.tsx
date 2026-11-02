"use client";

import { AuthProvider, useAuth } from "@/hooks/use-auth";
import { useRoute, navigate } from "@/lib/router";
import { PublicSite } from "@/components/public/public-site";
import AdminApp from "@/components/admin/admin-app";
import PortalRouter from "@/components/portal/portal-router";
import { Button } from "@/components/ui/button";
import { ShieldCheck, LogIn } from "lucide-react";

/**
 * United Angel Reach — single-route app shell.
 * Hash routing decides the experience:
 *   #/admin/*      → Admin console (ADMIN only)
 *   #/donor/*      → Donor portal
 *   #/volunteer/*  → Volunteer portal (PENDING volunteers see application tracking)
 *   #/beneficiary  → Beneficiary help hub
 *   everything else → Public multi-page website
 */

function Splash() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-background">
      <span className="flex size-12 items-center justify-center rounded-2xl bg-primary text-primary-foreground">
        <ShieldCheck className="size-6" />
      </span>
      <p className="text-sm font-medium text-muted-foreground">United Angel Reach…</p>
      <span className="size-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
    </div>
  );
}

function AuthGate({
  title,
  message,
}: {
  title: string;
  message: string;
}) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-muted/40 p-6 text-center">
      <span className="flex size-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
        <LogIn className="size-6" />
      </span>
      <div>
        <h1 className="text-lg font-semibold">{title}</h1>
        <p className="mt-1 max-w-sm text-sm text-muted-foreground">{message}</p>
      </div>
      <div className="flex gap-2">
        <Button onClick={() => navigate("/login")}>Sign in</Button>
        <Button variant="outline" onClick={() => navigate("/")}>
          Back to site
        </Button>
      </div>
    </div>
  );
}

function AppShell() {
  const { user, loading } = useAuth();
  const route = useRoute();
  const top = route.segments[0] ?? "";

  if (loading) return <Splash />;

  if (top === "admin") {
    if (!user)
      return (
        <AuthGate
          title="Admin sign-in required"
          message="Sign in with an administrator account to open the operations console."
        />
      );
    if (user.role !== "ADMIN")
      return (
        <AuthGate
          title="Admins only"
          message={`You are signed in as ${user.role.toLowerCase()}. This console is restricted to administrators.`}
        />
      );
    return <AdminApp />;
  }

  const isPortalArea =
    top === "donor" || top === "volunteer" || top === "beneficiary";
  if (isPortalArea) {
    if (!user)
      return (
        <AuthGate
          title="Sign in to continue"
          message="Your personalised portal lives behind a sign-in. Donor, volunteer and beneficiary accounts all work here."
        />
      );
    return <PortalRouter user={user} />;
  }

  return <PublicSite />;
}

export default function Page() {
  return (
    <AuthProvider>
      <AppShell />
    </AuthProvider>
  );
}
