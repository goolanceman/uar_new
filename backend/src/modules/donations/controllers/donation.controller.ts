/**
 * Donation controller — HTTP layer only. Extracts the raw query string
 * (parsed exactly like the legacy handlers did, via URLSearchParams over the
 * mount-relative req.url), the parsed body, and the optional/verified
 * session, delegates to the service, returns the response.
 *
 * Errors are rendered via lib/session handleError directly — the same pattern
 * shared/middleware/auth uses — because the donations tests (campaigns-
 * donations, recurring-pledges, api, community-charity) mount this router on
 * bare Express harnesses WITHOUT an app-level error middleware: forwarding
 * through next(error) there would fall through to Express's default HTML
 * error page instead of the legacy { error: message } JSON body. In the real
 * app the centralized middleware renders through the identical handleError.
 */
import type { Request, RequestHandler, Response } from "express";
import { handleError, requireAuth, validateSession } from "@/infrastructure/auth/session";
import { validatedBody, validatedParams } from "@/shared/middleware/validate";
import type { DonationService } from "../services/donation.service";
import type {
  CreateDonationBody,
  UpdateDonationBody,
  UpdateRecurringBody,
} from "../schemas/donation.schema";

export class DonationController {
  constructor(private readonly donationService: DonationService) {}

  /**
   * GET /api/donations — mine=1 | public feed | wall=1 donor wall | admin
   * filtered list. No validate() middleware: the legacy handler read the raw
   * URLSearchParams directly (branch flags,sortBy/sortDirection, page/limit
   * fallbacks) and no Zod schema can reproduce those permissive semantics
   * without inventing rejections. The mine branch keeps its legacy mid-handler
   * requireAuth gate here (the route itself stays public for the wall).
   */
  list: RequestHandler = async (req: Request, res: Response): Promise<void> => {
    try {
      const sp = new URL(req.url, "http://localhost").searchParams;
      const session = await validateSession(req);

      if (sp.get("mine") === "1") {
        const s = await requireAuth(req);
        const limit = sp.get("limit") ? parseInt(sp.get("limit")!, 10) : undefined;
        const donations = await this.donationService.listMine(s.userId, limit);
        res.json(donations);
        return;
      }

      const payload = await this.donationService.list(
        sp,
        req.query as Record<string, unknown>,
        session
      );
      res.json(payload);
    } catch (error) {
      handleError(error, res);
    }
  };

  /**
   * POST /api/donations — public or logged-in donor. 201; gateway checkouts
   * hand back to POST /api/payments with the receipt number — flagged with
   * checkoutPending so the donate page opens hosted checkout instead of the
   * instant thank-you.
   */
  create: RequestHandler = async (req: Request, res: Response): Promise<void> => {
    try {
      const body = validatedBody<CreateDonationBody>(req);
      const session = await validateSession(req);
      const { donation, checkoutPending } = await this.donationService.create(body, session);
      res.status(201).json(checkoutPending ? { ...donation, checkoutPending: true } : donation);
    } catch (error) {
      handleError(error, res);
    }
  };

  /**
   * GET /api/donations/recurring/mine — the signed-in donor's monthly-giving
   * commitments. (Legacy gate: `await requireAuth(req)` as the first step —
   * the authenticate middleware on the route is exactly that gate.)
   */
  listMyRecurring: RequestHandler = async (req: Request, res: Response): Promise<void> => {
    try {
      const session = req.session!;
      const commitments = await this.donationService.listMyRecurring(session.userId);
      res.json(commitments);
    } catch (error) {
      handleError(error, res);
    }
  };

  /** PATCH /api/donations/recurring/:id — owner (or admin) pause/resume/
   *  cancel + amount/frequency edits. */
  updateRecurring: RequestHandler = async (req: Request, res: Response): Promise<void> => {
    try {
      const { id } = validatedParams<{ id: string }>(req);
      const body = validatedBody<UpdateRecurringBody>(req);
      const commitment = await this.donationService.updateRecurringCommitment(id, body, req.session!);
      res.json(commitment);
    } catch (error) {
      handleError(error, res);
    }
  };

  /** GET /api/donations/:id — single record with full detail. */
  get: RequestHandler = async (req: Request, res: Response): Promise<void> => {
    try {
      const { id } = validatedParams<{ id: string }>(req);
      const donation = await this.donationService.getDonation(id);
      res.json(donation);
    } catch (error) {
      handleError(error, res);
    }
  };

  /** PATCH /api/donations/:id — admin edits the full record (whitelisted). */
  update: RequestHandler = async (req: Request, res: Response): Promise<void> => {
    try {
      const { id } = validatedParams<{ id: string }>(req);
      const body = validatedBody<UpdateDonationBody>(req);
      const donation = await this.donationService.updateDonation(id, body, req.session!);
      res.json(donation);
    } catch (error) {
      handleError(error, res);
    }
  };

  /** DELETE /api/donations/:id — admin removes a donation. */
  remove: RequestHandler = async (req: Request, res: Response): Promise<void> => {
    try {
      const { id } = validatedParams<{ id: string }>(req);
      const result = await this.donationService.deleteDonation(id, req.session!);
      res.json(result);
    } catch (error) {
      handleError(error, res);
    }
  };
}
