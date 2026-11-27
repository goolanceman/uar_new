/**
 * Corridor-events module — composition root. Wires repository → service →
 * controller. The router itself lives in src/routes/corridor-events.ts
 * (preserved export path for tests and the app entry).
 */
import { PrismaCorridorEventRepository } from "./repositories/corridor-event.repository";
import { CorridorEventService } from "./services/corridor-event.service";
import { CorridorEventController } from "./controllers/corridor-event.controller";

const corridorEventRepository = new PrismaCorridorEventRepository();
const corridorEventService = new CorridorEventService(corridorEventRepository);

export const corridorEventController = new CorridorEventController(corridorEventService);
export { CorridorEventService, CorridorEventController, PrismaCorridorEventRepository };
