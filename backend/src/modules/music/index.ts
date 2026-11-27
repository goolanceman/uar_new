/**
 * Music module — composition root. Wires repository → service → controller.
 * The router itself lives in src/routes/music.ts (preserved export path for
 * tests and the app entry).
 */
import { LibMusicRepository } from "./repositories/music.repository";
import { MusicService } from "./services/music.service";
import { MusicController } from "./controllers/music.controller";

const musicRepository = new LibMusicRepository();
const musicService = new MusicService(musicRepository);

export const musicController = new MusicController(musicService);
export { MusicService, MusicController, LibMusicRepository };
