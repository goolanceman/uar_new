/**
 * Music service — browse/search, categories and the session user's saved
 * list, wrapped in the shared paged() envelope. The non-numeric-category
 * fallback reproduces the legacy "matches nothing" empty page exactly
 * (page 1 / limit 20 — NOT the request's page/limit).
 */
import { paged } from "@/lib/community/serializers";
import type { MusicRepository } from "../repositories/music.repository.interface";

export class MusicService {
  constructor(private readonly musicRepository: MusicRepository) {}

  /** GET /api/music?q=&categoryId=&page=&limit= — public browse/search. */
  async list(q: string, categoryIdRaw: string, page: number, limit: number, skip: number) {
    const categoryId = categoryIdRaw === "" ? null : Number(categoryIdRaw);
    if (categoryId !== null && !Number.isFinite(categoryId)) {
      return paged([], 1, 20, 0); // a non-numeric category matches nothing (legacy parity)
    }
    const { rows, total } = await this.musicRepository.list(q, categoryId, skip, limit);
    return paged(rows, page, limit, total);
  }

  /** GET /api/music/categories — categories with musics counts (large default
   * limit: the UI fetches them all). */
  async categories(page: number, limit: number, skip: number) {
    const { rows, total } = await this.musicRepository.listCategories(skip, limit);
    return paged(rows, page, limit, total);
  }

  /** GET /api/music/saved — the session user's saved musics (the ids are
   * edited via PATCH /api/profile savedMusicIds). */
  async saved(userId: string, page: number, limit: number, skip: number) {
    const { rows, total } = await this.musicRepository.listSaved(userId, skip, limit);
    return paged(rows, page, limit, total);
  }
}
