/**
 * Events module — composition root. Wires repository → service → controller.
 * The router itself lives in src/routes/events.ts (preserved export path for
 * tests and the app entry).
 */
import { LibEventRepository } from "./repositories/event.repository";
import { EventService } from "./services/event.service";
import { EventController } from "./controllers/event.controller";

const eventRepository = new LibEventRepository();
const eventService = new EventService(eventRepository);

export const eventController = new EventController(eventService);
export { EventService, EventController, LibEventRepository };
