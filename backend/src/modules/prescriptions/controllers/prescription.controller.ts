/**
 * Prescription controller — HTTP layer only. Extracts validated data /
 * session, delegates to the service, sends the response.
 *
 * Errors are rendered via lib/session handleError directly — the same pattern
 * shared/middleware/auth and the payments controller use — because test
 * harnesses mount this router on bare Express apps WITHOUT an app-level
 * error middleware: forwarding through next(error) there would fall through
 * to Express's default HTML error page instead of the legacy
 * { error: message } JSON body. In the real app the centralized middleware
 * renders through the identical handleError.
 */
import type { Request, RequestHandler, Response } from "express";
import { handleError } from "@/lib/session";
import { validatedBody, validatedParams, validatedQuery } from "@/shared/middleware/validate";
import type {
  CreatePrescriptionBody,
  DispensePrescriptionBody,
  ListPrescriptionsQuery,
  PrescriptionIdParams,
  UpdatePrescriptionBody,
} from "../schemas/prescription.schema";
import type { PrescriptionService } from "../services/prescription.service";

export class PrescriptionController {
  constructor(private readonly prescriptionService: PrescriptionService) {}

  /** GET /api/prescriptions — role-scoped list (BENEFICIARY sees own only). */
  list: RequestHandler = async (req: Request, res: Response): Promise<void> => {
    try {
      const query = validatedQuery<ListPrescriptionsQuery>(req);
      const payload = await this.prescriptionService.list(query, req.session!);
      res.json(payload);
    } catch (error) {
      handleError(error, res);
    }
  };

  /** POST /api/prescriptions */
  create: RequestHandler = async (req: Request, res: Response): Promise<void> => {
    try {
      const body = validatedBody<CreatePrescriptionBody>(req) ?? {};
      const prescription = await this.prescriptionService.create(body, req.session!);
      res.status(201).json(prescription);
    } catch (error) {
      handleError(error, res);
    }
  };

  /** GET /api/prescriptions/:id */
  get: RequestHandler = async (req: Request, res: Response): Promise<void> => {
    try {
      const { id } = validatedParams<PrescriptionIdParams>(req);
      const prescription = await this.prescriptionService.get(id, req.session!);
      res.json(prescription);
    } catch (error) {
      handleError(error, res);
    }
  };

  /** PATCH /api/prescriptions/:id — cancel path (status: CANCELLED) or
   *  DRAFT-edit path. */
  update: RequestHandler = async (req: Request, res: Response): Promise<void> => {
    try {
      const { id } = validatedParams<PrescriptionIdParams>(req);
      const body = validatedBody<UpdatePrescriptionBody>(req) ?? {};
      const prescription = await this.prescriptionService.update(id, body, req.session!);
      res.json(prescription);
    } catch (error) {
      handleError(error, res);
    }
  };

  /** POST /api/prescriptions/:id/dispense */
  dispense: RequestHandler = async (req: Request, res: Response): Promise<void> => {
    try {
      const { id } = validatedParams<PrescriptionIdParams>(req);
      const body = validatedBody<DispensePrescriptionBody>(req) ?? {};
      const prescription = await this.prescriptionService.dispense(id, body, req.session!);
      res.json(prescription);
    } catch (error) {
      handleError(error, res);
    }
  };

  /** POST /api/prescriptions/:id/sign */
  sign: RequestHandler = async (req: Request, res: Response): Promise<void> => {
    try {
      const { id } = validatedParams<PrescriptionIdParams>(req);
      const prescription = await this.prescriptionService.sign(id, req.session!);
      res.json(prescription);
    } catch (error) {
      handleError(error, res);
    }
  };

  /** GET /api/prescriptions/:id/print — print-ready HTML document. */
  print: RequestHandler = async (req: Request, res: Response): Promise<void> => {
    try {
      const { id } = validatedParams<PrescriptionIdParams>(req);
      const html = await this.prescriptionService.print(id, req.session!);
      res
        .status(200)
        .setHeader("Content-Type", "text/html; charset=utf-8")
        .setHeader("Cache-Control", "no-store")
        .send(html);
    } catch (error) {
      handleError(error, res);
    }
  };
}
