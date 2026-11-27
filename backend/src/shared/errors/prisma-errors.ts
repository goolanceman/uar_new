/**
 * Prisma error mapping — translates Prisma known errors into application
 * errors at the repository boundary so no raw Prisma exception leaks into
 * HTTP responses. Existing error semantics are preserved: unique conflicts
 * were surfaced as 409s by callers, missing records as 404s, and everything
 * else keeps flowing to the 500 handler.
 */
import { Prisma } from "@prisma/client";
import { ConflictError, NotFoundError } from "./app-error";

/** Human-readable, model-aware messages for the most common constraints. */
function uniqueMessage(meta: { target?: string[] } | undefined): string {
  const fields = meta?.target?.join(", ");
  return fields
    ? `A record with this ${fields} already exists`
    : "A record with these unique values already exists";
}

/**
 * Wraps a repository operation and maps recognized Prisma errors to
 * application errors. Unknown errors are rethrown untouched (they were not
 * deliberately raised by this layer).
 */
export async function mapPrismaError<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      switch (error.code) {
        case "P2002": // unique constraint violation
          throw new ConflictError(
            uniqueMessage(error.meta as { target?: string[] } | undefined)
          );
        case "P2025": // record not found
          throw new NotFoundError("Record not found");
        case "P2003": // foreign key constraint violation
          throw new ConflictError("Related record does not exist or is still referenced");
        case "P2014": // required relation violation
          throw new ConflictError("Operation would violate a required relation");
        default:
          break;
      }
    }
    throw error;
  }
}
