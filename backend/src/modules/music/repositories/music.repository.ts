/**
 * Music repository — thin delegation to the shared community music helpers
 * (listMusic/listMusicCategories/listSavedMusic), which own the Prisma access
 * and the catalog caching for this module. Named Lib* because the Prisma
 * calls stay in the shared lib (read-only for this module).
 */
import { listMusic, listMusicCategories, listSavedMusic } from "@/domains/community/music";
import type { MusicRepository } from "./music.repository.interface";

export class LibMusicRepository implements MusicRepository {
  list(q: string, categoryId: number | null, skip: number, take: number) {
    return listMusic(q, categoryId, skip, take);
  }

  listCategories(skip: number, take: number) {
    return listMusicCategories(skip, take);
  }

  listSaved(userId: string, skip: number, take: number) {
    return listSavedMusic(userId, skip, take);
  }
}
