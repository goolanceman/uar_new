/**
 * Contact query service — all business rules for the public contact form and
 * the admin inbox. Depends on the repository contract + shared notification
 * helpers, throws application errors, never touches HTTP.
 */
import { logger } from "@/infrastructure/logging/logger";
import { logActivity } from "@/infrastructure/auth/session";
import { assertTransition } from "@/shared/workflow";
import { loadSettings, notifyContactQuery } from "@/infrastructure/notifications/notify";
import { NotFoundError } from "@/shared/errors";
import type { Session } from "@/infrastructure/auth/session";
import type { ContactQueryRepository, ContactQueryRow } from "../repositories/contact-query.repository.interface";

const log = logger.child("contact-queries");

const CONTACT_QUERY_STATUSES = ["PENDING", "RESOLVED", "CLOSED"];
const CONTACT_QUERY_TRANSITIONS: Record<string, string[]> = {
  PENDING: ["RESOLVED", "CLOSED"],
  RESOLVED: ["CLOSED", "PENDING"],
  CLOSED: ["PENDING"],
};

export class ContactQueryService {
  constructor(private readonly contactQueryRepository: ContactQueryRepository) {}

  /** GET /api/contact-queries?status — admin inbox. */
  async list(status?: string): Promise<ContactQueryRow[]> {
    return this.contactQueryRepository.list(status);
  }

  /** POST /api/contact-queries — public contact form (no session). */
  async create(data: {
    name: string;
    email: string;
    phone: string | null;
    subject: string;
    message: string;
  }): Promise<ContactQueryRow> {
    const query = await this.contactQueryRepository.create({
      ...data,
      status: "PENDING",
    });

    log.info("contact_query_created", {
      queryId: query.id,
      email: query.email,
      status: query.status,
    });
    await logActivity(data.name, "CONTACT", "CONTACT_QUERY", `${data.subject} · ${data.email}`);

    // Fire-and-forget public acknowledgement (senders no-op when disabled)
    void (async () => {
      try {
        const map = await loadSettings();
        await notifyContactQuery(
          map,
          {
            name: map["org.name"] || "United Angel Reach",
            footer: map["receipts.footer"] || undefined,
          },
          { name: query.name, email: query.email }
        );
      } catch (e) {
        log.warn("contact_query_ack_failed", {
          error: e instanceof Error ? e : String(e),
          queryId: query.id,
        });
      }
    })();

    return query;
  }

  /** PATCH /api/contact-queries/:id — admin updates query status. */
  async update(id: string, status: string, actor: Session): Promise<ContactQueryRow> {
    const existing = await this.contactQueryRepository.findById(id);
    if (!existing) {
      log.warn("contact_query_update_not_found", { queryId: id, actor: actor.userId });
      throw new NotFoundError("Query not found");
    }
    const allowedNext = CONTACT_QUERY_TRANSITIONS[existing.status] ?? [];
    if (existing.status !== status && !allowedNext.includes(status)) {
      log.warn("contact_query_invalid_transition", {
        queryId: id,
        from: existing.status,
        to: status,
        actor: actor.userId,
      });
    }
    assertTransition(CONTACT_QUERY_TRANSITIONS, existing.status, status, "contact query");

    const data: { status: string; resolvedAt?: Date; resolvedBy?: string } = { status };
    if (status === "RESOLVED") {
      data.resolvedAt = new Date();
      data.resolvedBy = actor.name;
    }

    const query = await this.contactQueryRepository.update(id, data);
    log.info("contact_query_updated", {
      queryId: id,
      status,
      actor: actor.userId,
    });

    await logActivity(
      actor.name,
      "CONTACT_QUERY_UPDATE",
      "CONTACT_QUERY",
      `${query.subject} → ${status}`,
      actor.userId
    );

    return query;
  }

  /** DELETE /api/contact-queries/:id — admin removes a query. */
  async remove(id: string, actor: Session): Promise<{ ok: boolean }> {
    const existing = await this.contactQueryRepository.findById(id);
    if (!existing) {
      log.warn("contact_query_delete_not_found", { queryId: id, actor: actor.userId });
      throw new NotFoundError("Query not found");
    }

    await this.contactQueryRepository.remove(id);
    log.info("contact_query_deleted", {
      queryId: id,
      email: existing.email,
      actor: actor.userId,
    });

    await logActivity(
      actor.name,
      "CONTACT_QUERY_DELETE",
      "CONTACT_QUERY",
      `${existing.subject} · ${existing.email}`,
      actor.userId
    );

    return { ok: true };
  }
}
