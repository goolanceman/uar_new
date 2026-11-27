/**
 * Dashboard module — composition root for the root /api snapshot.
 */
import { PrismaDashboardRepository } from "./repositories/dashboard.repository";
import { DashboardService } from "./services/dashboard.service";
import { DashboardController } from "./controllers/dashboard.controller";

const dashboardRepository = new PrismaDashboardRepository();
const dashboardService = new DashboardService(dashboardRepository);

export const dashboardController = new DashboardController(dashboardService);
