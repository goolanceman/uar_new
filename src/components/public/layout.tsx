"use client";

import * as React from "react";
import { useState } from "react";
import { Link, navigate } from "@/lib/router";
import { useAuth } from "@/hooks/use-auth";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ThemeToggle } from "@/components/shared/theme-toggle";
import {
  ChevronDown,
  Clock,
  FileBarChart,
  Heart,
  Landmark,
  LogOut,
  Mail,
  MapPin,
  Menu,
  Phone,
  ScrollText,
  ShieldCheck,
  Siren,
  Sparkles,
  User,
  X,
} from "lucide-react";
import { AssistantWidget } from "@/components/shared/assistant-widget";
import { CAMPAIGN_CONTENT } from "@/components/public/campaign-data";

const NAV_ITEMS = [
  { label: "Home", href: "/" },
  { label: "Campaigns", href: "/campaigns" },
  { label: "Impact", href: "/impact" },
  { label: "Green Corridor", href: "/green-corridor" },
  { label: "About", href: "/about" },
  { label: "Volunteer", href: "/volunteer" },
  { label: "Contact", href: "/contact" },
];

const EMERGENCY_NUMBERS = [
  { number: "112", label: "Police" },
  { number: "108", label: "Ambulance" },
  { number: "1930", label: "Cyber" },
  { number: "181", label: "Women" },
  { number: "1098", label: "Child" },
  { number: "14446", label: "De-addiction" },
];

const HELPLINE_STRIP = [
  { number: "112", label: "Emergency" },
  { number: "108", label: "Ambulance" },
  { number: "1930", label: "Cyber fraud" },
  { number: "181", label: "Women helpline" },
  { number: "1098", label: "CHILDLINE" },
];

const MORE_HELPLINES = [
  { number: "14446", label: "De-addiction" },
  { number: "1933", label: "Drug trafficking (NCB MANAS)" },
  { number: "1962", label: "Animal rescue (AWBI)" },
];

const TRANSPARENCY_LINKS = [
  { label: "Impact dashboard", href: "/impact", icon: FileBarChart },
  { label: "Green Corridor live ops", href: "/green-corridor", icon: Siren },
  { label: "All campaigns", href: "/campaigns", icon: ScrollText },
  { label: "Volunteer with us", href: "/volunteer", icon: Heart },
];

const LEGAL_LINKS = [
  { label: "Privacy policy", href: "/privacy" },
  { label: "Terms of use", href: "/terms" },
  { label: "Refunds", href: "/refunds" },
  { label: "Tax exemption (80G)", href: "/tax-exemption" },
  { label: "FAQ", href: "/faq" },
];

function isActive(path: string, href: string): boolean {
  if (href === "/") return path === "/";
  return path === href || path.startsWith(href + "/");
}

function initials(name?: string | null): string {
  if (!name) return "?";
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join("");
}

export function PublicLayout({
  children,
  path,
}: {
  children: React.ReactNode;
  path: string;
}) {
  const { user, logout } = useAuth();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [stripVisible, setStripVisible] = useState(true);
  const year = new Date().getFullYear();

  const handleLogout = async () => {
    try {
      await logout();
    } catch {
      // ignore
    }
    setMobileOpen(false);
    navigate("/");
  };

  return (
    <div className="flex min-h-screen flex-col bg-background">
      {/* ============ Sticky glass header ============ */}
      <header className="glass sticky top-0 z-40 border-b border-border/60">
        <div className="mx-auto flex h-16 w-full max-w-7xl items-center gap-2 px-4 sm:px-6">
          {/* Logo */}
          <Link
            href="/"
            className="flex min-w-0 items-center gap-2.5"
            aria-label="United Angel Reach home"
          >
            <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-emerald-600 text-white shadow-sm">
              <ShieldCheck className="size-6" aria-hidden />
            </span>
            <span className="min-w-0 leading-tight">
              <span className="block truncate text-base font-bold tracking-tight sm:text-lg">
                United Angel Reach
              </span>
              <span className="block text-[11px] font-medium text-emerald-700 dark:text-emerald-400">
                Bengaluru → India
              </span>
            </span>
          </Link>

          {/* Desktop nav */}
          <nav
            aria-label="Primary"
            className="mx-auto hidden items-center gap-0.5 lg:flex"
          >
            {NAV_ITEMS.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                aria-current={isActive(path, item.href) ? "page" : undefined}
                className={cn(
                  "rounded-full px-3 py-2 text-sm transition-colors",
                  isActive(path, item.href)
                    ? "bg-emerald-500/10 font-semibold text-emerald-700 dark:text-emerald-400"
                    : "font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
                )}
              >
                {item.label}
              </Link>
            ))}
          </nav>

          {/* Right actions (desktop) */}
          <div className="ml-auto hidden items-center gap-1.5 lg:ml-0 lg:flex">
            <ThemeToggle align="end" />
            {user ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    className="h-11 gap-2 pl-1.5 pr-2"
                    aria-label="Account menu"
                  >
                    <span className="flex size-8 items-center justify-center rounded-full bg-emerald-600 text-xs font-bold text-white">
                      {initials(user.name)}
                    </span>
                    <span className="hidden min-w-0 text-left xl:block">
                      <span className="block max-w-[140px] truncate text-sm font-semibold leading-tight">
                        {user.name}
                      </span>
                      <span className="block text-[10px] uppercase tracking-wide text-muted-foreground">
                        {user.role}
                      </span>
                    </span>
                    <ChevronDown className="size-4 text-muted-foreground" aria-hidden />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56">
                  <DropdownMenuLabel>
                    <span className="block truncate">{user.name}</span>
                    <span className="text-xs font-normal text-muted-foreground">
                      {user.email} · {user.role}
                    </span>
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem asChild>
                    <Link href="/profile">
                      <User className="size-4" aria-hidden /> Profile
                    </Link>
                  </DropdownMenuItem>
                  {user.role === "DONOR" && (
                    <DropdownMenuItem asChild>
                      <Link href="/donor">
                        <Heart className="size-4" aria-hidden /> Donor Portal
                      </Link>
                    </DropdownMenuItem>
                  )}
                  {user.role === "VOLUNTEER" && (
                    <DropdownMenuItem asChild>
                      <Link href="/volunteer">
                        <Sparkles className="size-4" aria-hidden /> Volunteer Portal
                      </Link>
                    </DropdownMenuItem>
                  )}
                  {user.role === "ADMIN" && (
                    <DropdownMenuItem asChild>
                      <Link href="/admin">
                        <ShieldCheck className="size-4" aria-hidden /> Admin
                      </Link>
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onClick={handleLogout}
                    className="text-red-600 focus:text-red-600 dark:text-red-400 dark:focus:text-red-400"
                  >
                    <LogOut className="size-4" aria-hidden /> Logout
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            ) : (
              <>
                <Button variant="ghost" asChild>
                  <Link href="/login">Sign in</Link>
                </Button>
                <Button
                  asChild
                  className="bg-emerald-600 font-semibold text-white shadow-sm hover:bg-emerald-700 dark:bg-emerald-500 dark:hover:bg-emerald-600"
                >
                  <Link href="/donate">
                    <Heart className="size-4" aria-hidden /> Donate
                  </Link>
                </Button>
              </>
            )}
          </div>

          {/* Mobile: donate + hamburger */}
          <div className="ml-auto flex items-center gap-1.5 lg:hidden">
            {!user && (
              <Button
                asChild
                size="sm"
                className="hidden bg-emerald-600 font-semibold text-white shadow-sm hover:bg-emerald-700 dark:bg-emerald-500 dark:hover:bg-emerald-600 sm:inline-flex"
              >
                <Link href="/donate">Donate</Link>
              </Button>
            )}
            <Button
              variant="ghost"
              size="icon"
              className="size-11"
              aria-label={mobileOpen ? "Close menu" : "Open menu"}
              aria-expanded={mobileOpen}
              aria-haspopup="dialog"
              onClick={() => setMobileOpen((o) => !o)}
            >
              {mobileOpen ? <X className="size-5" /> : <Menu className="size-5" />}
            </Button>
          </div>
        </div>
      </header>

      {/* ============ Mobile sheet (sectioned links) ============ */}
      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent side="right" className="flex w-80 flex-col gap-0 p-0 sm:w-84">
          <SheetHeader className="border-b px-5 py-4 text-left">
            <SheetTitle className="flex items-center gap-2.5">
              <span className="flex size-9 items-center justify-center rounded-xl bg-emerald-600 text-white">
                <ShieldCheck className="size-5" aria-hidden />
              </span>
              <span className="leading-tight">
                <span className="block text-sm font-bold">United Angel Reach</span>
                <span className="block text-[11px] font-medium text-emerald-700 dark:text-emerald-400">
                  Bengaluru → India
                </span>
              </span>
            </SheetTitle>
          </SheetHeader>

          <div className="flex-1 overflow-y-auto px-3 py-3 scrollbar-thin safe-bottom">
            <p className="px-2 pb-1.5 pt-1 text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground">
              Explore
            </p>
            <nav aria-label="Mobile" className="space-y-0.5">
              {NAV_ITEMS.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setMobileOpen(false)}
                  aria-current={isActive(path, item.href) ? "page" : undefined}
                  className={cn(
                    "flex min-h-11 items-center rounded-xl px-3 text-sm font-medium",
                    isActive(path, item.href)
                      ? "bg-emerald-500/10 font-semibold text-emerald-700 dark:text-emerald-400"
                      : "text-foreground hover:bg-muted"
                  )}
                >
                  {item.label}
                </Link>
              ))}
            </nav>

            <Separator className="my-3" />

            <p className="px-2 pb-1.5 text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground">
              Appearance
            </p>
            <div className="flex min-h-11 items-center justify-between rounded-xl px-3">
              <span className="text-sm font-medium text-muted-foreground">
                Light / Dark
              </span>
              <ThemeToggle align="start" />
            </div>

            <Separator className="my-3" />

            <p className="px-2 pb-1.5 text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground">
              Account
            </p>
            {user ? (
              <div className="space-y-0.5">
                <p className="truncate px-3 py-2 text-xs font-semibold text-muted-foreground">
                  {user.name} · {user.role}
                </p>
                <Link
                  href="/profile"
                  onClick={() => setMobileOpen(false)}
                  className="flex min-h-11 items-center rounded-xl px-3 text-sm font-medium hover:bg-muted"
                >
                  Profile
                </Link>
                {user.role === "DONOR" && (
                  <Link
                    href="/donor"
                    onClick={() => setMobileOpen(false)}
                    className="flex min-h-11 items-center rounded-xl px-3 text-sm font-medium hover:bg-muted"
                  >
                    Donor Portal
                  </Link>
                )}
                {user.role === "VOLUNTEER" && (
                  <Link
                    href="/volunteer"
                    onClick={() => setMobileOpen(false)}
                    className="flex min-h-11 items-center rounded-xl px-3 text-sm font-medium hover:bg-muted"
                  >
                    Volunteer Portal
                  </Link>
                )}
                {user.role === "ADMIN" && (
                  <Link
                    href="/admin"
                    onClick={() => setMobileOpen(false)}
                    className="flex min-h-11 items-center rounded-xl px-3 text-sm font-medium hover:bg-muted"
                  >
                    Admin Console
                  </Link>
                )}
                <button
                  onClick={handleLogout}
                  className="flex min-h-11 w-full items-center rounded-xl px-3 text-left text-sm font-medium text-red-600 hover:bg-red-500/10 dark:text-red-400"
                >
                  Logout
                </button>
              </div>
            ) : (
              <div className="flex gap-2 px-1 pb-3 pt-1">
                <Button variant="outline" className="min-h-11 flex-1" asChild>
                  <Link href="/login" onClick={() => setMobileOpen(false)}>
                    Sign in
                  </Link>
                </Button>
                <Button
                  className="min-h-11 flex-1 bg-emerald-600 font-semibold text-white hover:bg-emerald-700 dark:bg-emerald-500 dark:hover:bg-emerald-600"
                  asChild
                >
                  <Link href="/donate" onClick={() => setMobileOpen(false)}>
                    Donate
                  </Link>
                </Button>
              </div>
            )}
          </div>
        </SheetContent>
      </Sheet>

      {/* ============ Dismissible emergency strip ============ */}
      {stripVisible && (
        <div
          className="border-b border-red-500/15 bg-red-500/5 text-red-700 dark:text-red-400"
          role="region"
          aria-label="Emergency helplines"
        >
          <div className="mx-auto flex w-full max-w-7xl items-center gap-1.5 overflow-x-auto px-4 py-1.5 text-xs scrollbar-thin sm:px-6">
            <Siren className="size-3.5 shrink-0" aria-hidden />
            <span className="shrink-0 font-bold uppercase tracking-wide">Emergency</span>
            {EMERGENCY_NUMBERS.map((n) => (
              <a
                key={n.number}
                href={`tel:${n.number}`}
                className="shrink-0 whitespace-nowrap rounded-full bg-background/70 px-2 py-0.5 font-semibold ring-1 ring-red-500/20 transition hover:bg-red-500/10"
              >
                {n.number} {n.label}
              </a>
            ))}
            <button
              onClick={() => setStripVisible(false)}
              aria-label="Dismiss emergency strip"
              className="ml-auto flex size-7 shrink-0 items-center justify-center rounded-full hover:bg-red-500/10"
            >
              <X className="size-3.5" aria-hidden />
            </button>
          </div>
        </div>
      )}

      {/* ============ Page content ============ */}
      <main className="flex-1">{children}</main>

      {/* ============ Footer (mt-auto sticks to bottom) ============ */}
      <footer className="mt-auto bg-emerald-950 text-emerald-50/80">
        <div className="mx-auto w-full max-w-7xl px-4 py-12 sm:px-6">
          <div className="grid gap-10 md:grid-cols-2 lg:grid-cols-4">
            {/* About */}
            <div>
              <div className="flex items-center gap-2.5">
                <span className="flex size-10 items-center justify-center rounded-xl bg-emerald-600 text-white">
                  <ShieldCheck className="size-6" aria-hidden />
                </span>
                <span className="leading-tight">
                  <span className="block font-bold text-white">United Angel Reach</span>
                  <span className="block text-[11px] text-emerald-300">Bengaluru → India</span>
                </span>
              </div>
              <p className="mt-4 text-sm leading-relaxed">
                A Bengaluru-based charitable trust turning everyday kindness into nine
                nationwide programmes — safety, health, hunger and dignity.
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                <Badge variant="outline" className="border-emerald-700 bg-emerald-900/60 text-emerald-200">
                  <Landmark className="mr-1 size-3" aria-hidden /> 80G tax exempt
                </Badge>
                <Badge variant="outline" className="border-emerald-700 bg-emerald-900/60 text-emerald-200">
                  12A registered
                </Badge>
              </div>
            </div>

            {/* Programmes */}
            <nav aria-label="Programmes">
              <h3 className="text-sm font-bold uppercase tracking-wider text-white">
                Programmes
              </h3>
              <ul className="mt-4 space-y-2 text-sm">
                {Object.values(CAMPAIGN_CONTENT).map((c) => (
                  <li key={c.slug}>
                    <Link
                      href={`/campaigns/${c.slug}`}
                      className="transition hover:text-white hover:underline"
                    >
                      {c.title}
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>

            {/* Transparency */}
            <nav aria-label="Transparency">
              <h3 className="text-sm font-bold uppercase tracking-wider text-white">
                Transparency
              </h3>
              <ul className="mt-4 space-y-2 text-sm">
                {TRANSPARENCY_LINKS.map((t) => {
                  const Icon = t.icon;
                  return (
                    <li key={t.href}>
                      <Link
                        href={t.href}
                        className="inline-flex items-center gap-2 transition hover:text-white"
                      >
                        <Icon className="size-3.5 text-emerald-300" aria-hidden />
                        {t.label}
                      </Link>
                    </li>
                  );
                })}
                <li className="border-t border-white/10 pt-2 text-xs text-emerald-300/80">
                  Donations to UAR are tax-exempt under Section 80G. Utilisation is
                  reported publicly every quarter.
                </li>
                {MORE_HELPLINES.map((h) => (
                  <li key={h.number} className="text-xs">
                    <a href={`tel:${h.number}`} className="transition hover:text-white">
                      <span className="font-bold text-emerald-300">{h.number}</span>{" "}
                      {h.label}
                    </a>
                  </li>
                ))}
              </ul>
            </nav>

            {/* Contact */}
            <div>
              <h3 className="text-sm font-bold uppercase tracking-wider text-white">
                Contact
              </h3>
              <ul className="mt-4 space-y-3 text-sm">
                <li className="flex items-start gap-2">
                  <MapPin className="mt-0.5 size-4 shrink-0 text-emerald-300" aria-hidden />
                  <span>
                    United Angel Reach Trust,
                    <br />
                    Bengaluru, Karnataka, India
                  </span>
                </li>
                <li>
                  <a
                    href="mailto:care@unitedangelreach.org"
                    className="flex items-center gap-2 transition hover:text-white"
                  >
                    <Mail className="size-4 shrink-0 text-emerald-300" aria-hidden />
                    care@unitedangelreach.org
                  </a>
                </li>
                <li className="flex items-start gap-2">
                  <Clock className="mt-0.5 size-4 shrink-0 text-emerald-300" aria-hidden />
                  <span>Mon–Sat, 9:30 AM – 6:30 PM</span>
                </li>
              </ul>
            </div>
          </div>
        </div>

        {/* Helpline strip */}
        <div className="border-t border-white/10 bg-emerald-900/60" role="region" aria-label="National helplines">
          <div className="mx-auto flex w-full max-w-7xl flex-wrap items-center gap-x-4 gap-y-1.5 px-4 py-3 text-xs sm:px-6">
            <span className="inline-flex items-center gap-1.5 font-bold uppercase tracking-wide text-emerald-200">
              <Phone className="size-3.5" aria-hidden /> National helplines
            </span>
            {HELPLINE_STRIP.map((h) => (
              <a
                key={h.number}
                href={`tel:${h.number}`}
                className="inline-flex items-baseline gap-1.5 whitespace-nowrap rounded-full bg-emerald-950/60 px-2.5 py-1 font-semibold text-emerald-50 ring-1 ring-emerald-700/60 transition hover:bg-emerald-900"
              >
                <span className="text-emerald-300">{h.number}</span>
                <span className="text-emerald-200/80">{h.label}</span>
              </a>
            ))}
          </div>
        </div>

        <div className="border-t border-white/10">
          <div className="mx-auto flex w-full max-w-7xl flex-col gap-3 px-4 py-4 text-xs sm:px-6">
            <nav
              aria-label="Trust and Legal"
              className="flex flex-wrap items-center gap-x-4 gap-y-1.5"
            >
              <span className="font-bold uppercase tracking-wider text-emerald-200">
                Trust &amp; Legal
              </span>
              {LEGAL_LINKS.map((l) => (
                <Link
                  key={l.href}
                  href={l.href}
                  className="transition hover:text-white hover:underline"
                >
                  {l.label}
                </Link>
              ))}
            </nav>
            <div className="flex flex-col items-center justify-between gap-1 sm:flex-row">
              <p>© {year} United Angel Reach Trust · All rights reserved</p>
              <p className="text-emerald-300/70">Made in Bengaluru, for all of India</p>
            </div>
          </div>
        </div>
      </footer>

      {/* Angel assistant */}
      <AssistantWidget />
    </div>
  );
}
