"use client";

import type { LucideIcon } from "lucide-react";
import {
  ChartColumn,
  ExternalLink,
  HeartHandshake,
  LogOut,
  UserRound,
} from "lucide-react";
import { useAuth, type SessionUser } from "@/hooks/use-auth";
import { navigate } from "@/lib/router";
import { cn } from "@/lib/utils";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Separator } from "@/components/ui/separator";
import { ThemeToggle } from "@/components/shared/theme-toggle";
import { AssistantWidget } from "@/components/shared/assistant-widget";

export interface PortalNavItem {
  key: string;
  label: string;
  icon: LucideIcon;
}

/** Accent map — real Tailwind classes only (no dynamic class strings). */
const ACCENTS: Record<string, { square: string; tab: string; ring: string }> = {
  emerald: {
    square: "bg-emerald-600",
    tab: "bg-emerald-600 text-white shadow-sm",
    ring: "focus-visible:ring-emerald-600",
  },
  teal: {
    square: "bg-teal-600",
    tab: "bg-teal-600 text-white shadow-sm",
    ring: "focus-visible:ring-teal-600",
  },
  lime: {
    square: "bg-lime-600",
    tab: "bg-lime-600 text-white shadow-sm",
    ring: "focus-visible:ring-lime-600",
  },
  amber: {
    square: "bg-amber-500",
    tab: "bg-amber-500 text-white shadow-sm",
    ring: "focus-visible:ring-amber-500",
  },
  orange: {
    square: "bg-orange-500",
    tab: "bg-orange-500 text-white shadow-sm",
    ring: "focus-visible:ring-orange-500",
  },
  fuchsia: {
    square: "bg-fuchsia-600",
    tab: "bg-fuchsia-600 text-white shadow-sm",
    ring: "focus-visible:ring-fuchsia-600",
  },
  red: {
    square: "bg-red-600",
    tab: "bg-red-600 text-white shadow-sm",
    ring: "focus-visible:ring-red-600",
  },
  pink: {
    square: "bg-pink-600",
    tab: "bg-pink-600 text-white shadow-sm",
    ring: "focus-visible:ring-pink-600",
  },
};

export interface PortalLayoutProps {
  user: SessionUser;
  nav: PortalNavItem[];
  active: string;
  onNavigate: (key: string) => void;
  children: React.ReactNode;
  accent?: string;
  /** Dropdown-only extras (e.g. "analytics") — handled by the host router. */
  onNavigateExtra?: (key: "analytics") => void;
}

export function PortalLayout({
  user,
  nav,
  active,
  onNavigate,
  children,
  accent = "emerald",
  onNavigateExtra,
}: PortalLayoutProps) {
  const { logout } = useAuth();
  const a = ACCENTS[accent] ?? ACCENTS.emerald;

  const activeLabel = nav.find((n) => n.key === active)?.label;

  const initials = user.name
    .split(" ")
    .map((w) => w.charAt(0).toUpperCase())
    .slice(0, 2)
    .join("");

  const handleLogout = async () => {
    await logout();
    navigate("/");
  };

  return (
    <div className="flex min-h-screen flex-col bg-background">
      {/* Top bar */}
      <header className="sticky top-0 z-40 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2.5 sm:px-6">
          {/* Brand */}
          <button
            type="button"
            onClick={() => onNavigate(nav[0]?.key ?? active)}
            className="flex min-h-11 items-center gap-2.5 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label="Portal home"
          >
            <span
              className={cn(
                "flex size-9 shrink-0 items-center justify-center rounded-lg text-white shadow-sm",
                a.square
              )}
            >
              <HeartHandshake className="size-5" aria-hidden="true" />
            </span>
            <span className="text-base font-bold tracking-tight">
              UAR Portal
            </span>
            <Badge
              variant="secondary"
              className="hidden rounded-full border bg-accent text-[10px] font-semibold uppercase tracking-wide text-muted-foreground sm:inline-flex"
            >
              {user.role}
            </Badge>
            {activeLabel && (
              <span
                className="hidden items-center gap-2 text-sm text-muted-foreground md:flex"
                aria-hidden="true"
              >
                <span className="h-4 w-px bg-border" />
                <span className="max-w-[16rem] truncate font-medium text-foreground/80">
                  {activeLabel}
                </span>
              </span>
            )}
          </button>

          {/* Nav tabs — wrap on mobile, horizontally scrollable if still tight */}
          <nav
            aria-label="Portal sections"
            className="order-3 -mx-1 flex w-full flex-wrap items-center gap-1 overflow-x-auto px-1 scrollbar-thin sm:order-none sm:mx-0 sm:w-auto sm:flex-1 sm:flex-nowrap sm:overflow-visible sm:px-0"
          >
            {nav.map((item) => {
              const Icon = item.icon;
              const isActive = item.key === active;
              return (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => onNavigate(item.key)}
                  aria-current={isActive ? "page" : undefined}
                  className={cn(
                    "flex min-h-11 shrink-0 items-center gap-1.5 rounded-full px-3.5 text-sm font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
                    isActive
                      ? a.tab
                      : "text-muted-foreground hover:bg-accent hover:text-foreground"
                  )}
                >
                  <Icon className="size-4" aria-hidden="true" />
                  {item.label}
                </button>
              );
            })}
          </nav>

          {/* Right actions */}
          <div className="ml-auto flex items-center gap-1.5 sm:gap-2">
            <ThemeToggle align="end" />
            <Button
              variant="outline"
              size="sm"
              className="min-h-11 gap-1.5 rounded-full sm:min-h-9"
              onClick={() => navigate("/")}
            >
              <ExternalLink className="size-4" aria-hidden="true" />
              View site
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  aria-label="Account menu"
                  className="rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <Avatar className="size-9 border">
                    <AvatarFallback className="bg-primary/10 text-xs font-semibold text-primary">
                      {initials || "U"}
                    </AvatarFallback>
                  </Avatar>
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel>
                  <p className="text-sm font-semibold">{user.name}</p>
                  <p className="text-xs font-normal text-muted-foreground">
                    {user.email}
                  </p>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => onNavigate("profile")}>
                  <UserRound className="size-4" aria-hidden="true" />
                  Profile
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => onNavigateExtra?.("analytics")}
                  aria-disabled={!onNavigateExtra}
                >
                  <ChartColumn className="size-4" aria-hidden="true" />
                  My analytics
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  variant="destructive"
                  onClick={handleLogout}
                >
                  <LogOut className="size-4" aria-hidden="true" />
                  Logout
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
        <Separator />
      </header>

      {/* Content */}
      <main className="mx-auto w-full max-w-6xl flex-1 p-4 sm:p-6">
        {children}
      </main>

      {/* Footer — sticks to bottom via mt-auto */}
      <footer className="mt-auto border-t bg-muted/40">
        <p className="mx-auto w-full max-w-6xl px-4 py-4 text-center text-xs text-muted-foreground sm:px-6">
          United Angel Reach · Bengaluru, Karnataka → serving all of India
        </p>
      </footer>

      <AssistantWidget />
    </div>
  );
}

export default PortalLayout;
