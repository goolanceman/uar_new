import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { ThemeProvider } from "next-themes";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as SonnerToaster } from "@/components/ui/sonner";

// Favicon is admin-managed (Settings → Organisation → Branding); the value
// lives in the Setting table owned by the backend service, so we read it via
// GET /api/settings/public on the standalone backend (see backend/). Falls
// back to the default brand icon if the backend is unreachable.
async function fetchFaviconUrl(): Promise<string> {
  try {
    const base = process.env.BACKEND_URL || "http://localhost:4000";
    const res = await fetch(`${base}/api/settings/public`, {
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`settings/public ${res.status}`);
    const data = (await res.json()) as { faviconUrl?: string | null };
    return data.faviconUrl || "/logo_uar_final_emerald.svg";
  } catch {
    return "/logo_uar_final_emerald.svg";
  }
}

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// Favicon is admin-managed (Settings → Organisation → Branding); this reads
export async function generateMetadata(): Promise<Metadata> {
  const favicon = await fetchFaviconUrl();
  return {
    title: {
      default: "United Angel Reach Trust — Bengaluru | Serving all of India",
      template: "%s | United Angel Reach",
    },
    description:
      "United Angel Reach is a Bengaluru-based charitable trust serving all of India — anti-drug & cyber-safety awareness, women & child safety, adopt-a-medicine, animal welfare, ration kits, sanitary pads and AI green-corridor ambulances.",
    keywords: [
      "charity Bengaluru",
      "United Angel Reach",
      "anti drug campaign India",
      "cyber crime helpline 1930",
      "women safety 181",
      "child safety 1098",
      "adopt a medicine",
      "animal adoption",
      "green corridor ambulance",
      "80G donation",
    ],
    icons: {
      icon: [
        { url: favicon, type: "image/svg+xml" },
        { url: "/favicon-32.png", sizes: "32x32", type: "image/png" },
        { url: "/favicon-16.png", sizes: "16x16", type: "image/png" },
      ],
      apple: "/apple-touch-icon.png",
    },
  };
}

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#059669",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-background text-foreground min-h-screen flex flex-col`}
      >
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
          {children}
          <Toaster />
          <SonnerToaster position="top-center" richColors />
        </ThemeProvider>
      </body>
    </html>
  );
}
