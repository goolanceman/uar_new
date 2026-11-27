/**
 * Auth module — composition root. Wires repository → service → controller.
 * The router itself lives in src/routes/auth.ts (preserved export path for
 * tests and the app entry) and references the controller from here.
 */
import { PrismaAuthRepository } from "./repositories/auth.repository";
import { AuthService } from "./services/auth.service";
import { AuthController } from "./controllers/auth.controller";

const authRepository = new PrismaAuthRepository();
const authService = new AuthService(authRepository);

export const authController = new AuthController(authService);
export { AuthService, AuthController, PrismaAuthRepository };
