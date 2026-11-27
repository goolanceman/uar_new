/**
 * Encounters module — composition root. Wires repository → service →
 * controller. The router itself lives in src/routes/encounters.ts
 * (preserved export path for tests and the app entry) and references the
 * controller from here.
 */
import { PrismaEncounterRepository } from "./repositories/encounter.repository";
import { EncounterService } from "./services/encounter.service";
import { EncounterController } from "./controllers/encounter.controller";

const encounterRepository = new PrismaEncounterRepository();
const encounterService = new EncounterService(encounterRepository);

export const encounterController = new EncounterController(encounterService);
export { EncounterService, EncounterController, PrismaEncounterRepository };
