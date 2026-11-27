/**
 * Music repository contract — delegates to the shared music domain helpers in
 * @/lib/community/music (read-only shared code that owns the Prisma access
 * and catalog caching); the module adds no Prisma of its own.
 */
import type { listMusic, listMusicCategories, listSavedMusic } from "@/lib/community/music";

export interface MusicRepository {
  /** Browse/search (legacy fetchMusicWithSearch + fetchMusicByCategory). */
  list(q: string, categoryId: number | null, skip: number, take: number): ReturnType<typeof listMusic>;
  /** Categories with musics counts (legacy fetchMusicCategories). */
  listCategories(skip: number, take: number): ReturnType<typeof listMusicCategories>;
  /** The session user's saved musics (legacy fetchSavedMusic). */
  listSaved(userId: string, skip: number, take: number): ReturnType<typeof listSavedMusic>;
}
