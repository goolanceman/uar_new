/**
 * Files module — composition root. Wires repository → service → controller.
 * The router itself lives in src/routes/files.ts (preserved export path for
 * tests and the app entry) and references the controller from here.
 */
import { PrismaFileRepository } from "./repositories/file.repository";
import { FileService } from "./services/file.service";
import { FileController } from "./controllers/file.controller";

const fileRepository = new PrismaFileRepository();
const fileService = new FileService(fileRepository);

export const fileController = new FileController(fileService);
export { FileService, FileController, PrismaFileRepository };
