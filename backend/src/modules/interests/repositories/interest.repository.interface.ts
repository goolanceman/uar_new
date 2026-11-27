/**
 * Interest repository contract — delegates to the shared interests domain
 * helpers in @/lib/community/interests (which own the Prisma access, the
 * catalog caching and the CSV dangling-reference cleanup); the module adds no
 * Prisma of its own.
 */
import type { addInterest, deleteInterest, listInterests, updateInterest } from "@/lib/community/interests";

export interface InterestRepository {
  /** Interests + totalRoomOfInterest (per-interest room count). */
  list(skip: number, take: number): ReturnType<typeof listInterests>;
  add(title: string): ReturnType<typeof addInterest>;
  update(id: number, title: string): ReturnType<typeof updateInterest>;
  delete(id: number): ReturnType<typeof deleteInterest>;
}
