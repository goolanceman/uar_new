/**
 * Food module — composition root. Wires the aggregate repositories into the
 * sub-domain services (the module is the largest surface, so services are
 * split by sub-domain with a shared repository per aggregate) and the
 * controllers. The router itself lives in src/routes/food.ts (preserved
 * export path for tests and the app entry) and references the controllers
 * from here.
 */
import { PrismaFoodEventRepository } from "./repositories/food-event.repository";
import { PrismaFoodRegistrationRepository } from "./repositories/food-registration.repository";
import { PrismaFoodInventoryRepository } from "./repositories/food-inventory.repository";
import { PrismaFoodRequestRepository } from "./repositories/food-request.repository";
import { PrismaFoodHouseholdRepository } from "./repositories/food-household.repository";
import { PrismaFoodPledgeRepository } from "./repositories/food-pledge.repository";
import { PrismaFoodProgrammeRepository } from "./repositories/food-programme.repository";
import { PrismaFoodInsightRepository } from "./repositories/food-insight.repository";
import { PrismaFoodPublicRepository } from "./repositories/food-public.repository";

import { AllocationService } from "./services/allocation.service";
import { ApplicationService } from "./services/application.service";
import { BatchService } from "./services/batch.service";
import { CheckinService } from "./services/checkin.service";
import { EventService } from "./services/event.service";
import { EventVolunteerService } from "./services/event-volunteer.service";
import { RegistrationService } from "./services/registration.service";
import { HouseholdService } from "./services/household.service";
import { InsightService } from "./services/insight.service";
import { PledgeService } from "./services/pledge.service";
import { ProgrammeService } from "./services/programme.service";
import { PublicStatsService } from "./services/public-stats.service";

import { AllocationController } from "./controllers/allocation.controller";
import { ApplicationController } from "./controllers/application.controller";
import { BatchController } from "./controllers/batch.controller";
import { CheckinController } from "./controllers/checkin.controller";
import { EventController } from "./controllers/event.controller";
import { EventVolunteerController } from "./controllers/event-volunteer.controller";
import { RegistrationController } from "./controllers/registration.controller";
import { HouseholdController } from "./controllers/household.controller";
import { InsightController } from "./controllers/insight.controller";
import { PledgeController } from "./controllers/pledge.controller";
import { ProgrammeController } from "./controllers/programme.controller";
import { PublicStatsController } from "./controllers/public-stats.controller";
import { foodRateLimit } from "./controllers/rate-limit.middleware";

// ── aggregate repositories ───────────────────────────────────────────────────
const eventRepository = new PrismaFoodEventRepository();
const registrationRepository = new PrismaFoodRegistrationRepository();
const inventoryRepository = new PrismaFoodInventoryRepository();
const requestRepository = new PrismaFoodRequestRepository();
const householdRepository = new PrismaFoodHouseholdRepository();
const pledgeRepository = new PrismaFoodPledgeRepository();
const programmeRepository = new PrismaFoodProgrammeRepository();
const insightRepository = new PrismaFoodInsightRepository();
const publicRepository = new PrismaFoodPublicRepository();

// ── sub-domain controllers (service wiring inside) ──────────────────────────
export const allocationController = new AllocationController(
  new AllocationService(inventoryRepository, eventRepository)
);
export const applicationController = new ApplicationController(
  new ApplicationService(requestRepository)
);
export const batchController = new BatchController(new BatchService(inventoryRepository));
export const checkinController = new CheckinController(new CheckinService(registrationRepository));
export const eventController = new EventController(
  new EventService(eventRepository, inventoryRepository, programmeRepository, requestRepository, registrationRepository)
);
export const eventVolunteerController = new EventVolunteerController(
  new EventVolunteerService(registrationRepository, eventRepository)
);
export const registrationController = new RegistrationController(
  new RegistrationService(registrationRepository, eventRepository, requestRepository)
);
export const householdController = new HouseholdController(
  new HouseholdService(householdRepository, requestRepository)
);
export const insightController = new InsightController(new InsightService(insightRepository));
export const pledgeController = new PledgeController(
  new PledgeService(pledgeRepository, inventoryRepository)
);
export const programmeController = new ProgrammeController(new ProgrammeService(programmeRepository));
export const publicStatsController = new PublicStatsController(new PublicStatsService(publicRepository));

export {
  AllocationService,
  ApplicationController,
  BatchService,
  BatchController,
  CheckinService,
  CheckinController,
  EventService,
  EventController,
  EventVolunteerService,
  EventVolunteerController,
  RegistrationService,
  RegistrationController,
  HouseholdService,
  HouseholdController,
  InsightService,
  InsightController,
  PledgeService,
  PledgeController,
  ProgrammeService,
  ProgrammeController,
  PublicStatsService,
  PublicStatsController,
  foodRateLimit,
  PrismaFoodEventRepository,
  PrismaFoodRegistrationRepository,
  PrismaFoodInventoryRepository,
  PrismaFoodRequestRepository,
  PrismaFoodHouseholdRepository,
  PrismaFoodPledgeRepository,
  PrismaFoodProgrammeRepository,
  PrismaFoodInsightRepository,
  PrismaFoodPublicRepository,
};
