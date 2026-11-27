/**
 * Payment controller — HTTP layer only. Extracts the request origin (Stripe
 * success/cancel URLs), the parsed body, the webhook signature header, and
 * the RAW request bytes (stashed by the app-level express.json verify
 * callback), delegates to the service, returns the response.
 *
 * Errors are rendered via lib/session handleError directly — the same pattern
 * shared/middleware/auth uses — because the payments tests (campaigns-
 * donations, community-charity, recurring-pledges) mount this router on bare
 * Express harnesses WITHOUT an app-level error middleware: forwarding through
 * next(error) there would fall through to Express's default HTML error page
 * instead of the legacy { error: message } JSON body. In the real app the
 * centralized middleware renders through the identical handleError.
 */
import type { Request, RequestHandler, Response } from "express";
import { handleError } from "@/infrastructure/auth/session";
import { validatedBody } from "@/shared/middleware/validate";
import type { PaymentService } from "../services/payment.service";
import type { VerifyPaymentBody, WebhookBody } from "../schemas/payment.schema";

export class PaymentController {
  constructor(private readonly paymentService: PaymentService) {}

  /** POST /api/payments — { receiptNumber } → provider checkout payload. */
  createOrder: RequestHandler = async (req: Request, res: Response): Promise<void> => {
    try {
      const body = validatedBody<Record<string, unknown>>(req);
      const origin = new URL(req.url, "http://localhost").origin;
      const payload = await this.paymentService.createOrder(body, origin);
      res.json(payload);
    } catch (error) {
      handleError(error, res);
    }
  };

  /** POST /api/payments/verify — provider callback → settle the donation.
   *  settledNow === false renders the idempotent { ok, already } replay. */
  verify: RequestHandler = async (req: Request, res: Response): Promise<void> => {
    try {
      const body = validatedBody<VerifyPaymentBody>(req);
      const { settled, settledNow } = await this.paymentService.verify(body);
      res.json({ ok: true, ...(settledNow ? {} : { already: true }), donation: settled });
    } catch (error) {
      handleError(error, res);
    }
  };

  /** POST /api/payments/webhook — Razorpay server-to-server settlement. */
  webhook: RequestHandler = async (req: Request, res: Response): Promise<void> => {
    try {
      const signature = req.header("X-Razorpay-Signature") ?? "";
      const rawBody = (req as Request & { rawBody?: Buffer }).rawBody;
      const body = validatedBody<WebhookBody>(req);
      await this.paymentService.webhook({ signature, rawBody, parsedBody: body });
      res.json({ ok: true });
    } catch (error) {
      handleError(error, res);
    }
  };
}
