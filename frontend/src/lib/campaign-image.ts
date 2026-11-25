/**
 * Campaign image helpers — single source of truth for gallery/cover parsing.
 * Used by campaigns list, home featured cards, campaign detail and donate.
 */

/** Parse the campaign `gallery` JSON column ([url, url, …]) into a string array. */
export function parseGallery(v?: string | null): string[] {
  if (!v) return [];
  try {
    const arr = JSON.parse(v);
    return Array.isArray(arr)
      ? arr.map(String).map((s) => s.trim()).filter(Boolean)
      : [];
  } catch {
    return [];
  }
}

/**
 * Cover photo for a campaign: admin-picked `coverImage`, else gallery[0],
 * else the legacy `images` column.
 */
export function coverImageOf(c: {
  coverImage?: string | null;
  gallery?: string | null;
  images?: string | null;
}): string | null {
  if (c.coverImage?.trim()) return c.coverImage.trim();
  const gallery = parseGallery(c.gallery);
  if (gallery.length > 0) return gallery[0];
  return c.images?.trim() || null;
}
