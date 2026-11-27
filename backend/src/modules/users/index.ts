/**
 * Users module (admin directory) — composition root. Wires repository →
 * service → controller. The router itself lives in src/routes/users.ts
 * (preserved export path for tests and the app entry) and references the
 * controller from here.
 */
import { PrismaUserRepository } from "./repositories/user.repository";
import { UserService } from "./services/user.service";
import { UserController } from "./controllers/user.controller";

const userRepository = new PrismaUserRepository();
const userService = new UserService(userRepository);

export const userController = new UserController(userService);
export { UserService, UserController, PrismaUserRepository };
