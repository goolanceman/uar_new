import type { Metadata, Viewport } from "next";
import "./globals.css";
import { Toaster } from "@/components/ui/sonner";

export const metadata: Metadata = {
  title: {
    default: "United Angel Reach Trust — Bengaluru | Serving all of India",
    template: "%s | United Angel Reach",
  },
  description:
    "United Angel Reach is a Bengaluru-based charitable trust serving all of India — anti-drug & cyber-safety awareness, women & child safety, adopt-a-medicine, animal welfare, ration kits and AI-assisted green-corridor ambulances.",
  keywords: [
    "charity Bengaluru",
    "anti drug campaign India",
    "cyber crime helpline 1930",
    "women safety 181",
    "child safety 1098",
    "adopt a medicine",
    "animal adoption",
    "green corridor ambulance",
  ],
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
      <body className="antialiased min-h-screen flex flex-col">
        {children}
        <Toaster position="top-center" richColors />
      </body>
    </html>
  );
}
