"use client";

import * as React from "react";
import { useTheme } from "next-themes";
import { Monitor, Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/**
 * Light / Dark / System theme switcher (next-themes, class strategy).
 * Shared across public site, admin console and portals.
 */
export function ThemeToggle({ align = "end" }: { align?: "start" | "center" | "end" }) {
  const { theme, setTheme, resolvedTheme } = useTheme();
  const [mounted, setMounted] = React.useState(false);

  React.useEffect(() => setMounted(true), []);

  const isDark = mounted ? resolvedTheme === "dark" : false;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Toggle colour theme"
          className="relative size-9 rounded-full"
        >
          {mounted && isDark ? (
            <Moon className="size-[1.05rem] transition-transform duration-300 rotate-0" />
          ) : (
            <Sun className="size-[1.05rem] transition-transform duration-300 rotate-0" />
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align={align} className="w-44">
        <DropdownMenuLabel className="text-xs text-muted-foreground">Appearance</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onClick={() => setTheme("light")}
          aria-label="Use light theme"
          className={mounted && theme === "light" ? "bg-accent" : ""}
        >
          <Sun className="size-4" /> Light
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => setTheme("dark")}
          aria-label="Use dark theme"
          className={mounted && theme === "dark" ? "bg-accent" : ""}
        >
          <Moon className="size-4" /> Dark
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => setTheme("system")}
          aria-label="Use system theme"
          className={mounted && theme === "system" ? "bg-accent" : ""}
        >
          <Monitor className="size-4" /> System
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
