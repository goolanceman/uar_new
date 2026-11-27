/**
 * Transaction manager — a controlled callback-based boundary over Prisma
 * interactive transactions. Multi-repository operations receive the SAME
 * transaction client, so every participating repository works inside one
 * atomic unit with automatic rollback on failure.
 *
 * Intentionally minimal: simple single-repository writes do not need this —
 * they run on the default client. Only genuinely atomic multi-step flows
 * open a transaction.
 */
import type { Prisma, PrismaClient } from "@prisma/client";
import { db } from "../prisma/prisma.client";

/** A Prisma client bound to the current (possibly transactional) context. */
export type DbClient = PrismaClient | Prisma.TransactionClient;

/**
 * Runs `fn` inside an interactive transaction. The tx client must be passed
 * explicitly to repository methods participating in the transaction —
 * repositories never obtain clients themselves.
 */
export async function withTransaction<T>(
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
  options?: { maxWait?: number; timeout?: number }
): Promise<T> {
  return db.$transaction(fn, options);
}
