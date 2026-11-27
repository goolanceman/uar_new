/**
 * Kit stats schemas — GET /api/kit-stats takes no input. The legacy handler
 * ignored the query string entirely, so the schema accepts (and strips)
 * anything without inventing new rejections.
 */
import { z } from "zod";

export const kitStatsQuerySchema = z.object({});
export type KitStatsQuery = z.infer<typeof kitStatsQuerySchema>;
