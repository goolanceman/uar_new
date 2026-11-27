/**
 * Settings controller — HTTP layer only. Extracts validated data / session,
 * delegates to the service, returns the response. Errors flow to the
 * centralized error middleware via next(error).
 */
import type { NextFunction, Request, RequestHandler, Response } from "express";
import { validatedBody } from "@/shared/middleware/validate";
import type { TestSettingsBody, UpdateSettingsBody } from "../schemas/setting.schema";
import type { SettingService } from "../services/setting.service";

export class SettingController {
  constructor(private readonly settingService: SettingService) {}

  /** GET /api/settings — flat {key: value} merged with defaults (ADMIN only). */
  list: RequestHandler = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const payload = await this.settingService.list();
      res.json(payload);
    } catch (error) {
      next(error);
    }
  };

  /** PATCH /api/settings — flat {key: value, …} → upsert each (ADMIN only). */
  update: RequestHandler = async (req, res, next) => {
    try {
      const body = validatedBody<UpdateSettingsBody>(req);
      const payload = await this.settingService.update(req.session!, body);
      res.json(payload);
    } catch (error) {
      next(error);
    }
  };

  /** POST /api/settings/test — run a REAL connectivity check for one channel. */
  test: RequestHandler = async (req, res, next) => {
    try {
      const body = validatedBody<TestSettingsBody>(req);
      const result = await this.settingService.test(req.session!, body);
      res.json(result);
    } catch (error) {
      next(error);
    }
  };

  /** GET /api/settings/public — no auth. Public org identity subset. */
  publicSettings: RequestHandler = async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const payload = await this.settingService.publicSettings();
      res.json(payload);
    } catch (error) {
      next(error);
    }
  };

  /** GET /api/settings/app — no auth. Mobile app configuration. */
  appSettings: RequestHandler = async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const payload = await this.settingService.appSettings();
      res.json(payload);
    } catch (error) {
      next(error);
    }
  };
}
