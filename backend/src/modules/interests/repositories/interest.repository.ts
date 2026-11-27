/**
 * Interest repository — thin delegation to the shared community interest
 * helpers (listInterests/addInterest/updateInterest/deleteInterest), which
 * own the Prisma access and caching for this module. Named Lib* because the
 * Prisma calls stay in the shared lib (read-only for this module).
 */
import { addInterest, deleteInterest, listInterests, updateInterest } from "@/domains/community/interests";
import type { InterestRepository } from "./interest.repository.interface";

export class LibInterestRepository implements InterestRepository {
  list(skip: number, take: number) {
    return listInterests(skip, take);
  }

  add(title: string) {
    return addInterest(title);
  }

  update(id: number, title: string) {
    return updateInterest(id, title);
  }

  delete(id: number) {
    return deleteInterest(id);
  }
}
