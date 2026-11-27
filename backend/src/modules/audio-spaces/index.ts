/**
 * Audio-spaces module — composition root. Wires repository → service →
 * controller. The router itself lives in src/routes/audio-spaces.ts
 * (preserved export path for tests and the app entry) and references the
 * controller from here.
 */
import { LibAudioSpaceRepository } from "./repositories/audio-space.repository";
import { AudioSpaceService } from "./services/audio-space.service";
import { AudioSpaceController } from "./controllers/audio-space.controller";

const audioSpaceRepository = new LibAudioSpaceRepository();
const audioSpaceService = new AudioSpaceService(audioSpaceRepository);

export const audioSpaceController = new AudioSpaceController(audioSpaceService);
export { AudioSpaceService, AudioSpaceController, LibAudioSpaceRepository };
