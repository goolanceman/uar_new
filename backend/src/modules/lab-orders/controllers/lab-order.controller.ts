/**
 * Lab order controller — HTTP layer only. Extracts validated data / session,
 * delegates to the service, returns the response. Errors flow to the
 * centralized error middleware via next(error).
 */
import type { NextFunction, Request, RequestHandler, Response } from "express";
import { ApiError } from "@/shared/errors";
import { validatedBody, validatedParams, validatedQuery } from "@/shared/middleware/validate";
import type {
  CreateLabOrderBody,
  ListLabOrdersQuery,
  UpdateLabOrderBody,
} from "../schemas/lab-order.schema";
import type { LabOrderService } from "../services/lab-order.service";

export class LabOrderController {
  constructor(private readonly labOrderService: LabOrderService) {}

  /** GET /api/lab-orders — ADMIN | DOCTOR | LAB_TECH | NURSE (BENEFICIARY sees
   *  own orders only). The role check was a mid-handler gate in the legacy
   *  handler (right after requireAuth), so it stays as an in-controller check
   *  to preserve the exact legacy error. */
  list: RequestHandler = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const session = req.session!;
      const staffRoles = ["ADMIN", "DOCTOR", "LAB_TECH", "NURSE"];
      if (!staffRoles.includes(session.role) && session.role !== "BENEFICIARY")
        throw new ApiError("You do not have permission for this action", 403);

      const query = validatedQuery<ListLabOrdersQuery>(req);
      const payload = await this.labOrderService.list(query, session);
      res.json(payload);
    } catch (error) {
      next(error);
    }
  };

  /** POST /api/lab-orders — DOCTOR | ADMIN → code UAR-LAB-NNNNN, status ORDERED. */
  create: RequestHandler = async (req, res, next) => {
    try {
      const body = validatedBody<CreateLabOrderBody>(req);
      const order = await this.labOrderService.create(body, req.session!);
      res.status(201).json(order);
    } catch (error) {
      next(error);
    }
  };

  /** GET /api/lab-orders/:id — ADMIN | DOCTOR | LAB_TECH | NURSE. */
  get: RequestHandler = async (req, res, next) => {
    try {
      const { id } = validatedParams<{ id: string }>(req);
      const order = await this.labOrderService.getDetail(id);
      res.json(order);
    } catch (error) {
      next(error);
    }
  };

  /** PATCH /api/lab-orders/:id — enforced linear transitions + critical flag. */
  update: RequestHandler = async (req, res, next) => {
    try {
      const { id } = validatedParams<{ id: string }>(req);
      const body = validatedBody<UpdateLabOrderBody>(req);
      const order = await this.labOrderService.update(id, body, req.session!);
      res.json(order);
    } catch (error) {
      next(error);
    }
  };
}
