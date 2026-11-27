/**
 * Kit unit service — read model for the scanned ration-kit registry. The
 * legacy `mine=1` filter scoped to the session user's scanned units.
 */
import type { ListKitUnitsQuery } from "../schemas/kit-unit.schema";
import type { KitUnitListFilter, KitUnitRepository, KitUnitWithBatch } from "../repositories/kit-unit.repository.interface";

export class KitUnitService {
  constructor(private readonly kitUnitRepository: KitUnitRepository) {}

  /** GET /api/kit-units — order by code asc; "mine" scopes to the caller. */
  async list(query: ListKitUnitsQuery, currentUserId: string): Promise<KitUnitWithBatch[]> {
    const filter: KitUnitListFilter = {
      batchId: query.batchId,
      status: query.status,
      q: query.q,
      scannedById: query.mine ? currentUserId : undefined,
      limit: query.limit,
    };
    return this.kitUnitRepository.list(filter);
  }
}
