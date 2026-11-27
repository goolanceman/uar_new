/**
 * Ambulance service — fleet CRUD rules. Depends on the repository contract,
 * throws application errors, never touches HTTP. Field checks keep the exact
 * legacy order and messages, and every log event keeps its legacy name.
 */
import { logger } from "@/infrastructure/logging/logger";
import { logActivity, type Session } from "@/infrastructure/auth/session";
import { AMBULANCE_STATUSES } from "@/modules/ambulances/services/ambulances.domain";
import { ApiError, ConflictError, NotFoundError } from "@/shared/errors";
import type { AmbulanceListFilter, AmbulanceRepository, AmbulanceRow } from "../repositories/ambulance.repository.interface";
import type { ListAmbulancesQuery } from "../schemas/ambulance.schema";

const log = logger.child("ambulances");

const TYPES = ["BLS", "ALS", "PTV", "NEONATAL"];
const STATUSES = ["AVAILABLE", "ON_MISSION", "MAINTENANCE"];
/** Same rule as client phoneRule() — kept in sync per conventions. */
const PHONE_RE = /^(\+91[\-\s]?)?[6-9]\d{9}$/;

export class AmbulanceService {
  constructor(private readonly ambulanceRepository: AmbulanceRepository) {}

  /** GET /api/ambulances?status=&type=&q= (auth). */
  async list(query: ListAmbulancesQuery): Promise<AmbulanceRow[]> {
    const filter: AmbulanceListFilter = {};
    if (query.status) filter.status = query.status;
    if (query.type) filter.type = query.type;
    if (query.q) filter.q = query.q;
    return this.ambulanceRepository.list(filter);
  }

  /** POST /api/ambulances (ADMIN). */
  async create(session: Session, body: Record<string, unknown>): Promise<AmbulanceRow> {
    const code = String(body.code ?? "").trim().toUpperCase();
    const type = String(body.type ?? "").trim().toUpperCase() || "BLS";
    const status = String(body.status ?? "AVAILABLE").trim().toUpperCase();
    const base = String(body.base ?? "").trim();
    const driverName = String(body.driverName ?? "").trim();
    const driverPhone = body.driverPhone ? String(body.driverPhone).trim() : "";

    if (!code) throw new ApiError("code is required", 400);
    if (!TYPES.includes(type)) throw new ApiError("Invalid type", 400);
    if (!STATUSES.includes(status)) throw new ApiError("Invalid status", 400);
    if (!base) throw new ApiError("base is required", 400);
    if (!driverName) throw new ApiError("driverName is required", 400);
    if (driverPhone && !PHONE_RE.test(driverPhone.replace(/[\s-]/g, "")))
      throw new ApiError("driverPhone must be a valid Indian mobile number", 400);

    const clash = await this.ambulanceRepository.findByCode(code);
    if (clash) {
      log.warn("ambulance_code_conflict", {
        code,
        actor: session.userId,
        existingId: clash.id,
      });
      throw new ConflictError("Ambulance code already exists");
    }

    const ambulance = await this.ambulanceRepository.createAmbulance({
      code,
      type,
      status,
      base,
      driverName,
      driverPhone: driverPhone || null,
      crew: body.crew ? String(body.crew).trim() : null,
      equipment: body.equipment ? String(body.equipment).trim() : null,
    });

    log.info("ambulance_created", {
      ambulanceId: ambulance.id,
      code,
      type,
      status,
      actor: session.userId,
    });

    await logActivity(session.name, "AMBULANCE_ADD", "Ambulance", `${code} (${type})`, session.userId);
    return ambulance;
  }

  /** PATCH /api/ambulances/:id (ADMIN). */
  async update(session: Session, id: string, body: Record<string, unknown>): Promise<AmbulanceRow> {
    const existing = await this.ambulanceRepository.findById(id);
    if (!existing) {
      log.warn("ambulance_update_not_found", { ambulanceId: id, actor: session.userId });
      throw new NotFoundError("Ambulance not found");
    }

    const data: Partial<{
      code: string;
      type: string;
      status: string;
      base: string;
      driverName: string;
      driverPhone: string | null;
      crew: string | null;
      equipment: string | null;
    }> = {};
    if (body.code !== undefined) {
      const code = String(body.code).trim().toUpperCase();
      if (!code) throw new ApiError("code cannot be empty", 400);
      if (code !== existing.code) {
        const clash = await this.ambulanceRepository.findByCode(code);
        if (clash) {
          log.warn("ambulance_code_conflict", {
            code,
            actor: session.userId,
            existingId: clash.id,
          });
          throw new ConflictError("Ambulance code already exists");
        }
      }
      data.code = code;
    }
    if (body.type !== undefined) {
      const type = String(body.type).trim().toUpperCase();
      if (!["BLS", "ALS", "PTV", "NEONATAL"].includes(type))
        throw new ApiError("Invalid type", 400);
      data.type = type;
    }
    if (body.status !== undefined) {
      const status = String(body.status).trim().toUpperCase();
      if (!AMBULANCE_STATUSES.includes(status))
        throw new ApiError("Invalid status", 400);
      data.status = status;
    }
    if (body.base !== undefined) data.base = String(body.base).trim();
    if (body.driverName !== undefined) data.driverName = String(body.driverName).trim();
    if (body.driverPhone !== undefined)
      data.driverPhone = body.driverPhone ? String(body.driverPhone).trim() : null;
    if (body.crew !== undefined) data.crew = body.crew ? String(body.crew).trim() : null;
    if (body.equipment !== undefined)
      data.equipment = body.equipment ? String(body.equipment).trim() : null;

    const ambulance = await this.ambulanceRepository.updateAmbulance(id, data);
    log.info("ambulance_updated", {
      ambulanceId: id,
      code: ambulance.code,
      fields: Object.keys(data),
      ...(body.status !== undefined ? { newStatus: ambulance.status } : {}),
      actor: session.userId,
    });
    await logActivity(
      session.name,
      "AMBULANCE_UPDATE",
      "Ambulance",
      `${ambulance.code}${body.status !== undefined ? ` → ${ambulance.status}` : ""}`,
      session.userId
    );
    return ambulance;
  }

  /** DELETE /api/ambulances/:id (ADMIN) — blocked while ON_MISSION. */
  async remove(session: Session, id: string): Promise<{ ok: boolean }> {
    const existing = await this.ambulanceRepository.findById(id);
    if (!existing) {
      log.warn("ambulance_delete_not_found", { ambulanceId: id, actor: session.userId });
      throw new NotFoundError("Ambulance not found");
    }
    if (existing.status === "ON_MISSION") {
      log.warn("ambulance_delete_blocked_on_mission", {
        ambulanceId: id,
        code: existing.code,
        actor: session.userId,
      });
      throw new ConflictError("Ambulance is on a mission");
    }

    await this.ambulanceRepository.deleteAmbulance(id);
    log.info("ambulance_deleted", { ambulanceId: id, code: existing.code, actor: session.userId });
    await logActivity(session.name, "AMBULANCE_DELETE", "Ambulance", existing.code, session.userId);
    return { ok: true };
  }
}
