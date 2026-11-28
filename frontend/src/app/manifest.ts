import type { MetadataRoute } from "next";

/**
 * Web app manifest (served at /manifest.webmanifest). Referenced from the
 * root layout metadata — makes the site installable and satisfies the
 * Lighthouse/SEO "installability + branded icons" best-practice checks.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "United Angel Reach Trust",
    short_name: "UAR Trust",
    description:
      "80G tax-exempt charity serving India: food kits, women & child safety, de-addiction help, green-corridor ambulances.",
    id: "/",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#059669",
    lang: "en",
    icons: [
      {
        src: "/logo-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/apple-touch-icon.png",
        sizes: "180x180",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/favicon.svg",
        type: "image/svg+xml",
        purpose: "any",
      },
    ],
  };
}
