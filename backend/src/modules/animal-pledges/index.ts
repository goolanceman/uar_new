/**
 * Animal pledges module — composition root. Wires repository → service →
 * controller. The router itself lives in src/routes/animal-pledges.ts
 * (preserved export path for tests and the app entry) and references the
 * controller from here.
 */
import { PrismaAnimalPledgeRepository } from "./repositories/animal-pledge.repository";
import { AnimalPledgeService } from "./services/animal-pledge.service";
import { AnimalPledgeController } from "./controllers/animal-pledge.controller";

const animalPledgeRepository = new PrismaAnimalPledgeRepository();
const animalPledgeService = new AnimalPledgeService(animalPledgeRepository);

export const animalPledgeController = new AnimalPledgeController(animalPledgeService);
export { AnimalPledgeService, AnimalPledgeController, PrismaAnimalPledgeRepository };
