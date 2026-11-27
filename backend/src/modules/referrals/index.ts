/**
 * Referrals module — composition root. Wires repository → service →
 * controller. The router itself lives in src/routes/referrals.ts (preserved
 * export path for tests and the app entry) and references the controller
 * from here.
 */
import { PrismaReferralRepository } from "./repositories/referral.repository";
import { ReferralService } from "./services/referral.service";
import { ReferralController } from "./controllers/referral.controller";

const referralRepository = new PrismaReferralRepository();
const referralService = new ReferralService(referralRepository);

export const referralController = new ReferralController(referralService);
export { ReferralService, ReferralController, PrismaReferralRepository };
