import { PrismaClient } from '@prisma/client'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

/** Test-only query counter. Production never reads it. Incremented by
 *  the read delegates the response-cache tests watch. */
export const queryCounter = { enabled: false, count: 0 }

function makeClient(): PrismaClient {
  return new PrismaClient({
    log: process.env.NODE_ENV === "test" ? [] : ["query"],
  })
}

export const db = globalForPrisma.prisma ?? makeClient()

if (process.env.NODE_ENV === "test") {
  // Prisma 6 dropped middleware. Wrap the reads the cache tests assert on
  // so a hit (zero calls) is distinguishable from a miss.
  const reads = ["findMany", "findUnique", "findFirst", "count", "aggregate", "groupBy"] as const
  for (const key of Object.keys(db)) {
    const model = (db as unknown as Record<string, Record<string, unknown>>)[key]
    if (!model || typeof model !== "object" || typeof model.findMany !== "function") continue
    for (const method of reads) {
      const original = model[method]
      if (typeof original !== "function") continue
      model[method] = (...args: unknown[]) => {
        if (queryCounter.enabled) queryCounter.count += 1
        return (original as (...a: unknown[]) => unknown).apply(model, args)
      }
    }
  }
}

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = db
