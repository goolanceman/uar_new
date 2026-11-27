/**
 * Animals module — composition root. Wires repository → service → controller.
 * The router itself lives in src/routes/animals.ts (preserved export path for
 * tests and the app entry) and references the controller from here.
 */
import { PrismaAnimalRepository } from "./repositories/animal.repository";
import { AnimalService } from "./services/animal.service";
import { AnimalController } from "./controllers/animal.controller";

const animalRepository = new PrismaAnimalRepository();
const animalService = new AnimalService(animalRepository);

export const animalController = new AnimalController(animalService);
export { AnimalService, AnimalController, PrismaAnimalRepository };
