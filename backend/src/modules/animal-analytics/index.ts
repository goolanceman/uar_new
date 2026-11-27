/**
 * Animal analytics module — composition root. Wires repository → service →
 * controller. The router itself lives in src/routes/animal-analytics.ts
 * (preserved export path for tests and the app entry) and references the
 * controller from here.
 */
import { PrismaAnimalAnalyticsRepository } from "./repositories/animal-analytics.repository";
import { AnimalAnalyticsService } from "./services/animal-analytics.service";
import { AnimalAnalyticsController } from "./controllers/animal-analytics.controller";

const animalAnalyticsRepository = new PrismaAnimalAnalyticsRepository();
const animalAnalyticsService = new AnimalAnalyticsService(animalAnalyticsRepository);

export const animalAnalyticsController = new AnimalAnalyticsController(animalAnalyticsService);
export { AnimalAnalyticsService, AnimalAnalyticsController, PrismaAnimalAnalyticsRepository };
