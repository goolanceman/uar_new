import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { ThemeProvider } from "next-themes";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as SonnerToaster } from "@/components/ui/sonner";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
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
  icons: { icon: "/logo.svg" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#16a34a",
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
