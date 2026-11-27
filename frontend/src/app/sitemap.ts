import type { MetadataRoute } from "next";

/**
 * The public website is a single canonical URL — all navigation happens via
 * in-page hash routes (#/about, #/donate, …), which search engines treat as
 * part of this one document, so only the root URL is listed in the sitemap.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  return [
    {
      url: "https://unitedangelreach.org",
      lastModified: new Date(),
      changeFrequency: "weekly",
      priority: 1,
    },
  ];
}
