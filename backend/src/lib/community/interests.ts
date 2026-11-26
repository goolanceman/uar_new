/**
 * Community interests service — the interest list (with per-interest room
 * counts) shared by the generic /api/interests router (web + mobile).
 *
 * Port of InterestController::fetchInterests (src/routes/mobile/posts.ts).
 */
import { db } from "@/lib/db";

/** GET /api/interests — interests + totalRoomOfInterest. */
export async function listInterests(skip: number, take: number) {
  const [interests, total] = await Promise.all([
    db.communityInterest.findMany({ orderBy: { id: "asc" }, skip, take }),
    db.communityInterest.count(),
  ]);

  const items = [];
  for (const interest of interests) {
    // Legacy does Room::where('interest_ids', id) — an exact CSV match.
    const totalRoomOfInterest = await db.communityRoom.count({
      where: { interestIds: String(interest.id) },
    });
    items.push({
      id: interest.id,
      title: interest.title,
      createdAt: interest.createdAt,
      updatedAt: interest.updatedAt,
      totalRoomOfInterest,
    });
  }
  return { items, total };
}
