/**
 * Corridor-stats schemas — GET /api/corridor-stats takes no input. The
 * legacy handler ignored the query string entirely, so the schema accepts
 * (and strips) anything without inventing new rejections.
 */
import { z } from "zod";

export const corridorStatsQuerySchema = z.object({});
export type CorridorStatsQuery = z.infer<typeof corridorStatsQuerySchema>;
