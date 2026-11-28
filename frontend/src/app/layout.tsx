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
      // Cache on the server for an hour — this runs during metadata
      // generation on every request; a no-store round-trip to the backend
      // used to add its full latency to time-to-first-byte (page response
      // time). Admin branding changes appear within the hour.
      next: { revalidate: 3600 },
    });
    if (!res.ok) throw new Error(`settings/public ${res.status}`);
    const data = (await res.json()) as { faviconUrl?: string | null };
    return data.faviconUrl || "/brand/logo.svg";
  } catch {
    return "/brand/logo.svg";
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
const SITE_URL = "https://unitedangelreach.org";

// ~155 characters — search engines truncate descriptions much beyond this.
const SITE_DESCRIPTION =
  "United Angel Reach Trust, Bengaluru — 80G tax-exempt charity serving India: food kits, women & child safety, de-addiction help, green-corridor ambulances.";

export async function generateMetadata(): Promise<Metadata> {
  const favicon = await fetchFaviconUrl();
  return {
    metadataBase: new URL(SITE_URL),
    title: {
      default: "United Angel Reach Trust — Bengaluru | Serving all of India",
      template: "%s | United Angel Reach",
    },
    description: SITE_DESCRIPTION,
    alternates: {
      canonical: "/",
    },
    openGraph: {
      type: "website",
      url: SITE_URL,
      siteName: "United Angel Reach Trust",
      locale: "en_IN",
      title: "United Angel Reach Trust — Bengaluru | Serving all of India",
      description: SITE_DESCRIPTION,
      images: [
        {
          url: "/site-hero.jpg",
          width: 1200,
          height: 630,
          alt: "United Angel Reach volunteers delivering QR-traced aid across India",
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title: "United Angel Reach Trust — Bengaluru | Serving all of India",
      description: SITE_DESCRIPTION,
      images: ["/site-hero.jpg"],
    },
    robots: {
      index: true,
      follow: true,
    },
    manifest: "/manifest.webmanifest",
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
        {/* Structured data — helps search engines show the trust as an NGO
            entity (knowledge panel, rich results). Server-rendered. */}
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              "@context": "https://schema.org",
              "@type": "NGO",
              name: "United Angel Reach Trust",
              url: SITE_URL,
              logo: `${SITE_URL}/brand/logo.svg`,
              email: "care@unitedangelreach.org",
              description: SITE_DESCRIPTION,
              address: {
                "@type": "PostalAddress",
                addressLocality: "Bengaluru",
                addressRegion: "Karnataka",
                addressCountry: "IN",
              },
              areaServed: "IN",
              nonprofitStatus: "NonprofitType",
            }),
          }}
        />
      </body>
    </html>
  );
}
