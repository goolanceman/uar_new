/**
 * Event stream schemas — GET /api/events/stream takes no input. The legacy
 * handler ignored the query string entirely, so the schema accepts (and
 * strips) anything without inventing new rejections.
 */
import { z } from "zod";

export const eventStreamQuerySchema = z.object({});
export type EventStreamQuery = z.infer<typeof eventStreamQuerySchema>;
