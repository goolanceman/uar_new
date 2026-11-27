/**
 * Historical Prisma client location — now a re-export of the centralized
 * infrastructure client. All new modules import from
 * `@/infrastructure/database/prisma`; this file remains so the many existing
 * imports (`@/lib/db`) keep a single shared client instance.
 */
export { db, queryCounter } from "@/infrastructure/database/prisma/prisma.client";
