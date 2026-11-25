"use client";

import { useState } from "react";
import type { LucideIcon } from "lucide-react";
import {
  ChartColumn,
  ChevronDown,
  ExternalLink,
  HeartHandshake,
  LogOut,
  Menu,
  UserRound,
  X,
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
import { ThemeToggle } from "@/components/shared/theme-toggle";
import { AssistantWidget } from "@/components/shared/assistant-widget";

export interface PortalNavItem {
  key: string;
  label: string;
  icon: LucideIcon;
  /** Optional small numeric/text badge, e.g. pending task count. */
  badge?: string | number;
}

/** Accent map — real Tailwind classes only (no dynamic class strings). */
const ACCENTS: Record<
  string,
  { solid: string; soft: string; text: string; ring: string; gradient: string }
> = {
  emerald: {
    solid: "bg-emerald-600",
    soft: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
    text: "text-emerald-600 dark:text-emerald-400",
    ring: "focus-visible:ring-emerald-600",
    gradient: "from-emerald-600 to-teal-600",
  },
  teal: {
    solid: "bg-teal-600",
    soft: "bg-teal-500/10 text-teal-700 dark:text-teal-400",
    text: "text-teal-600 dark:text-teal-400",
    ring: "focus-visible:ring-teal-600",
    gradient: "from-teal-600 to-cyan-600",
  },
  lime: {
    solid: "bg-lime-600",
    soft: "bg-lime-500/10 text-lime-700 dark:text-lime-400",
    text: "text-lime-600 dark:text-lime-400",
    ring: "focus-visible:ring-lime-600",
    gradient: "from-lime-600 to-emerald-600",
  },
  amber: {
    solid: "bg-amber-500",
    soft: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
    text: "text-amber-600 dark:text-amber-400",
    ring: "focus-visible:ring-amber-500",
    gradient: "from-amber-500 to-orange-500",
  },
  orange: {
    solid: "bg-orange-500",
    soft: "bg-orange-500/10 text-orange-700 dark:text-orange-400",
    text: "text-orange-600 dark:text-orange-400",
    ring: "focus-visible:ring-orange-500",
    gradient: "from-orange-500 to-amber-500",
  },
  fuchsia: {
    solid: "bg-fuchsia-600",
    soft: "bg-fuchsia-500/10 text-fuchsia-700 dark:text-fuchsia-400",
    text: "text-fuchsia-600 dark:text-fuchsia-400",
    ring: "focus-visible:ring-fuchsia-600",
    gradient: "from-fuchsia-600 to-pink-600",
  },
  red: {
    solid: "bg-red-600",
    soft: "bg-red-500/10 text-red-700 dark:text-red-400",
    text: "text-red-600 dark:text-red-400",
    ring: "focus-visible:ring-red-600",
    gradient: "from-red-600 to-rose-600",
  },
  pink: {
    solid: "bg-pink-600",
    soft: "bg-pink-500/10 text-pink-700 dark:text-pink-400",
    text: "text-pink-600 dark:text-pink-400",
    ring: "focus-visible:ring-pink-600",
    gradient: "from-pink-600 to-fuchsia-600",
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

function initialsOf(name: string) {
  return name
    .split(" ")
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase())
    .slice(0, 2)
    .join("");
}

/** Up to 4 primary items surface in the mobile bottom tab bar; the rest live in "More". */
const BOTTOM_TAB_LIMIT = 4;

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
  const [drawerOpen, setDrawerOpen] = useState(false);

  const activeItem = nav.find((n) => n.key === active);
  const initials = initialsOf(user.name);

  const handleLogout = async () => {
    await logout();
    navigate("/");
  };

  const go = (key: string) => {
    onNavigate(key);
    setDrawerOpen(false);
  };

  const primaryTabs = nav.slice(0, BOTTOM_TAB_LIMIT);
  const overflowTabs = nav.slice(BOTTOM_TAB_LIMIT);
  const hasOverflow = overflowTabs.length > 0;
  const overflowActive = overflowTabs.some((n) => n.key === active);

  const renderSidebarNav = (onItemClick?: () => void) => (
    <nav aria-label="Portal sections" className="flex-1 space-y-1 overflow-y-auto px-3 py-4 scrollbar-thin">
      {nav.map((item) => {
        const Icon = item.icon;
        const isActive = item.key === active;
        return (
          <button
            key={item.key}
            type="button"
            onClick={() => {
              go(item.key);
              onItemClick?.();
            }}
            aria-current={isActive ? "page" : undefined}
            className={cn(
              "flex min-h-11 w-full items-center gap-2.5 rounded-xl px-3 py-2 text-sm font-medium outline-none transition-all focus-visible:ring-2",
              a.ring,
              isActive
                ? cn(a.solid, "text-white shadow-sm")
                : "text-sidebar-foreground/75 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
            )}
          >
            <Icon className="size-4 shrink-0" aria-hidden="true" />
            <span className="truncate">{item.label}</span>
            {item.badge != null && (
              <Badge
                variant="secondary"
                className={cn(
                  "ml-auto h-5 min-w-5 justify-center rounded-full px-1.5 text-[10px]",
                  isActive ? "bg-white/20 text-white" : a.soft
                )}
              >
                {item.badge}
              </Badge>
            )}
          </button>
        );
      })}
    </nav>
  );

  const renderAccountMenu = (className?: string) => (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label="Account menu"
          className={cn("rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring", className)}
        >
          <Avatar className="size-9 border">
            <AvatarFallback className={cn("bg-primary/10 text-xs font-semibold", a.text)}>
              {initials || "U"}
            </AvatarFallback>
          </Avatar>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel>
          <p className="text-sm font-semibold">{user.name}</p>
          <p className="text-xs font-normal text-muted-foreground">{user.email}</p>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => go("profile")}>
          <UserRound className="size-4" aria-hidden="true" />
          Profile
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => onNavigateExtra?.("analytics")} aria-disabled={!onNavigateExtra}>
          <ChartColumn className="size-4" aria-hidden="true" />
          My analytics
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => navigate("/")}>
          <ExternalLink className="size-4" aria-hidden="true" />
          View public site
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" onClick={handleLogout}>
          <LogOut className="size-4" aria-hidden="true" />
          Logout
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );

  return (
    <div className="flex min-h-screen bg-muted/40">
      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col border-r bg-sidebar lg:flex">
        <button
          type="button"
          className="flex items-center gap-2.5 px-5 py-4 text-left outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring"
          onClick={() => go(nav[0]?.key ?? active)}
        >
          <span className={cn("flex size-9 shrink-0 items-center justify-center rounded-xl text-white shadow-sm bg-gradient-to-br", a.gradient)}>
            <HeartHandshake className="size-5" aria-hidden="true" />
          </span>
          <span className="min-w-0">
            <span className="block truncate text-sm font-bold leading-tight text-sidebar-foreground">
              UAR Portal
            </span>
            <span className="block truncate text-[11px] text-sidebar-foreground/55">
              {user.role === "VOLUNTEER" ? "Volunteer workspace" : user.role === "DONOR" ? "Donor workspace" : "Member workspace"}
            </span>
          </span>
        </button>
        {renderSidebarNav()}
        <div className="space-y-2 border-t p-3">
          <Button variant="outline" className="w-full justify-start" onClick={() => navigate("/")}>
            <ExternalLink className="size-4" aria-hidden="true" /> View public site
          </Button>
          <Button
            variant="ghost"
            className="w-full justify-start text-destructive hover:text-destructive"
            onClick={handleLogout}
          >
            <LogOut className="size-4" aria-hidden="true" /> Logout
          </Button>
        </div>
      </aside>

      {/* Mobile drawer */}
      {drawerOpen && (
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-label="Portal menu">
          <div className="absolute inset-0 bg-black/50" onClick={() => setDrawerOpen(false)} />
          <aside className="absolute inset-y-0 left-0 flex w-72 flex-col bg-sidebar shadow-xl">
            <div className="flex items-center justify-between px-4 py-4">
              <span className="flex items-center gap-2">
                <span className={cn("flex size-7 items-center justify-center rounded-lg text-white bg-gradient-to-br", a.gradient)}>
                  <HeartHandshake className="size-4" aria-hidden="true" />
                </span>
                <span className="text-sm font-bold">UAR Portal</span>
              </span>
              <Button size="icon" variant="ghost" onClick={() => setDrawerOpen(false)} aria-label="Close menu">
                <X className="size-5" />
              </Button>
            </div>
            {renderSidebarNav(() => setDrawerOpen(false))}
            <div className="space-y-2 border-t p-3">
              <Button variant="outline" className="w-full justify-start" onClick={() => navigate("/")}>
                <ExternalLink className="size-4" aria-hidden="true" /> View public site
              </Button>
              <Button
                variant="ghost"
                className="w-full justify-start text-destructive hover:text-destructive"
                onClick={handleLogout}
              >
                <LogOut className="size-4" aria-hidden="true" /> Logout
              </Button>
            </div>
          </aside>
        </div>
      )}

      {/* Main column */}
      <div className="flex min-w-0 flex-1 flex-col lg:pl-64">
        <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b bg-background/95 px-4 backdrop-blur supports-[backdrop-filter]:bg-background/80">
          <Button
            size="icon"
            variant="ghost"
            className="lg:hidden"
            onClick={() => setDrawerOpen(true)}
            aria-label="Open portal menu"
          >
            <Menu className="size-5" />
          </Button>
          <h1 className="truncate text-sm font-semibold sm:text-base">{activeItem?.label ?? "Overview"}</h1>
          <Badge
            variant="secondary"
            className="hidden rounded-full border bg-accent text-[10px] font-semibold uppercase tracking-wide text-muted-foreground sm:inline-flex"
          >
            {user.role}
          </Badge>
          <div className="ml-auto flex items-center gap-1.5 sm:gap-2">
            <ThemeToggle align="end" />
            <Button
              variant="outline"
              size="sm"
              className="hidden min-h-9 gap-1.5 rounded-full sm:flex"
              onClick={() => navigate("/")}
            >
              <ExternalLink className="size-4" aria-hidden="true" />
              View site
            </Button>
            {renderAccountMenu()}
          </div>
        </header>

        {/* Content — extra bottom padding on mobile so the tab bar never covers it */}
        <main className="mx-auto w-full max-w-5xl flex-1 p-4 pb-24 sm:p-6 lg:pb-6">{children}</main>

        <footer className="mt-auto hidden border-t bg-background px-4 py-3 text-center text-xs text-muted-foreground sm:px-6 lg:block">
          United Angel Reach · Bengaluru, Karnataka → serving all of India
        </footer>
      </div>

      {/* Mobile bottom tab bar — thumb-friendly primary navigation */}
      <nav
        aria-label="Portal sections (mobile)"
        className="fixed inset-x-0 bottom-0 z-30 border-t bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80 lg:hidden"
      >
        <div className="mx-auto grid max-w-5xl grid-cols-5" style={{ gridTemplateColumns: `repeat(${hasOverflow ? primaryTabs.length + 1 : primaryTabs.length}, minmax(0, 1fr))` }}>
          {primaryTabs.map((item) => {
            const Icon = item.icon;
            const isActive = item.key === active;
            return (
              <button
                key={item.key}
                type="button"
                onClick={() => go(item.key)}
                aria-current={isActive ? "page" : undefined}
                className={cn(
                  "flex min-h-14 flex-col items-center justify-center gap-0.5 py-1.5 text-[11px] font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-inset",
                  a.ring,
                  isActive ? a.text : "text-muted-foreground"
                )}
              >
                <span className="relative">
                  <Icon className="size-5" aria-hidden="true" />
                  {item.badge != null && (
                    <span className={cn("absolute -right-1.5 -top-1.5 flex size-3.5 items-center justify-center rounded-full text-[8px] font-bold text-white", a.solid)}>
                      {item.badge}
                    </span>
                  )}
                </span>
                <span className="truncate">{item.label}</span>
              </button>
            );
          })}
          {hasOverflow && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className={cn(
                    "flex min-h-14 w-full flex-col items-center justify-center gap-0.5 py-1.5 text-[11px] font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-inset",
                    a.ring,
                    overflowActive ? a.text : "text-muted-foreground"
                  )}
                >
                  <ChevronDown className="size-5" aria-hidden="true" />
                  <span>More</span>
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" side="top" className="w-48">
                {overflowTabs.map((item) => {
                  const Icon = item.icon;
                  return (
                    <DropdownMenuItem key={item.key} onClick={() => go(item.key)}>
                      <Icon className="size-4" aria-hidden="true" />
                      {item.label}
                      {item.badge != null && (
                        <Badge variant="secondary" className="ml-auto h-5 min-w-5 justify-center rounded-full px-1.5 text-[10px]">
                          {item.badge}
                        </Badge>
                      )}
                    </DropdownMenuItem>
                  );
                })}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </nav>

      <AssistantWidget user={user} />
    </div>
  );
}

export default PortalLayout;
