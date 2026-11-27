/**
 * Stories module — composition root. Wires repository → service → controller.
 * The router itself lives in src/routes/stories.ts (preserved export path for
 * tests and the app entry) and references the controller from here.
 */
import { LibStoryRepository } from "./repositories/story.repository";
import { StoryService } from "./services/story.service";
import { StoryController } from "./controllers/story.controller";

const storyRepository = new LibStoryRepository();
const storyService = new StoryService(storyRepository);

export const storyController = new StoryController(storyService);
export { StoryService, StoryController, LibStoryRepository };
