/**
 * Community music service — the reel-music library shared by the generic
 * /api/music router (web + mobile).
 *
 * Ported from the legacy mobile handlers (src/routes/mobile/reels-rooms.ts
 * music half, ReelController): search/browse, categories, and the session
 * user's saved music (the ids are edited via PATCH /api/profile).
 */
import { Prisma } from "@prisma/client";
import { db } from "@/infrastructure/database/prisma";
import { ApiError } from "@/infrastructure/auth/session";
import { musicJson } from "@/domains/community/reels";
import { cached, cacheKeyPart, cacheTtl, catalogKey } from "@/infrastructure/cache";

const DELETED_NO = 0;

type MusicRow = Prisma.CommunityMusicGetPayload<object>;
type MusicCategoryRow = Prisma.MusicCategoryGetPayload<{ include: { _count: { select: { musics: true } } } }>;

export { musicJson };

/** GET /api/music?q=&categoryId= (legacy fetchMusicWithSearch + fetchMusicByCategory). */
export async function listMusic(q: string, categoryId: number | null, skip: number, take: number) {
  const keyword = q.trim();
  // Search results are per-query and short-lived relative to the catalog;
  // an empty browse (the home screen) is the repeated call worth caching.
  if (keyword) return loadMusic(keyword, categoryId, skip, take);
  return cached(
    catalogKey("music", cacheKeyPart({ categoryId, skip, take })),
    cacheTtl.catalog,
    () => loadMusic("", categoryId, skip, take)
  );
}

async function loadMusic(keyword: string, categoryId: number | null, skip: number, take: number) {
  const where: Prisma.CommunityMusicWhereInput = {
    isDeleted: DELETED_NO,
    ...(categoryId !== null ? { categoryId } : {}),
    ...(keyword
      ? { OR: [{ title: { contains: keyword } }, { artist: { contains: keyword } }] }
      : {}),
  };
  const [rows, total] = await Promise.all([
    db.communityMusic.findMany({ where, orderBy: { id: "desc" }, skip, take }),
    db.communityMusic.count({ where }),
  ]);
  return { rows: rows.map((m) => musicJson(m)), total };
}

/** GET /api/music/categories (legacy fetchMusicCategories — newest first, with
 *  the count of non-deleted musics attached). */
export async function listMusicCategories(skip: number, take: number) {
  return cached(catalogKey("music-categories", cacheKeyPart({ skip, take })), cacheTtl.catalog, () =>
    loadMusicCategories(skip, take)
  );
}

async function loadMusicCategories(skip: number, take: number) {
  const [rows, total] = await Promise.all([
    db.musicCategory.findMany({
      where: { isDeleted: DELETED_NO },
      orderBy: { id: "desc" },
      include: { _count: { select: { musics: true } } },
      skip,
      take,
    }),
    db.musicCategory.count({ where: { isDeleted: DELETED_NO } }),
  ]);
  return { rows: rows.map(musicCategoryJson), total };
}

export function musicCategoryJson(c: MusicCategoryRow) {
  return {
    id: c.id,
    title: c.title,
    isDeleted: c.isDeleted,
    musicsCount: c._count.musics,
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
  };
}

/** GET /api/music/saved — the session user's savedMusicIds CSV (legacy fetchSavedMusic). */
export async function listSavedMusic(myUserId: string, skip: number, take: number) {
  const user = await db.user.findUnique({ where: { id: myUserId }, select: { savedMusicIds: true } });
  if (!user) throw new ApiError("User not found", 404);

  const savedMusicIds = (user.savedMusicIds ?? "")
    .split(",")
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isFinite(n) && n !== 0);
  const where: Prisma.CommunityMusicWhereInput = { id: { in: savedMusicIds } };
  const [rows, total] = await Promise.all([
    savedMusicIds.length
      ? db.communityMusic.findMany({ where, orderBy: { id: "desc" }, skip, take })
      : Promise.resolve([] as MusicRow[]),
    savedMusicIds.length ? db.communityMusic.count({ where }) : Promise.resolve(0),
  ]);
  return { rows: rows.map((m) => musicJson(m)), total };
}
