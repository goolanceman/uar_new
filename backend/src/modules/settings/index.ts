/**
 * Settings module — composition root. Wires repository → service →
 * controller. The router itself lives in src/routes/settings.ts (preserved
 * export path for tests and the app entry) and references the controller
 * from here.
 */
import { PrismaSettingRepository } from "./repositories/setting.repository";
import { SettingService } from "./services/setting.service";
import { SettingController } from "./controllers/setting.controller";

const settingRepository = new PrismaSettingRepository();
const settingService = new SettingService(settingRepository);

export const settingController = new SettingController(settingService);
export { SettingService, SettingController, PrismaSettingRepository };
