/**
 * Environment configuration — validated once at boot with Zod. Optional
 * variables keep their legacy "unset means disabled/fallback" semantics:
 * every access still reads process.env (tests toggle values at runtime),
 * so this module only VERIFIES shape, it never freezes copies.
 */
import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  PORT: z.coerce.number().int().positive().catch(4000),
  DATABASE_URL: z.string().min(1),
  SESSION_SECRET: z.string().min(16),
  CORS_ORIGINS: z.string().default("http://localhost:3000"),
  REDIS_URL: z.string().optional(),
  LOG_LEVEL: z.string().optional(),
  LOG_PRISMA_QUERIES: z.string().optional(),
});

export type AppEnv = z.infer<typeof envSchema>;

/** Boot-time check (non-test): throws with a readable message on misconfig. */
export function verifyEnv(): void {
  if (process.env.NODE_ENV === "test") return; // tests control their own env
  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    const problems = result.error.issues
      .map((i) => `${i.path.join(".") || "env"}: ${i.message}`)
      .join("; ");
    throw new Error(`Environment validation failed: ${problems}`);
  }
}

export const allowedOrigins = (): string[] =>
  (process.env.CORS_ORIGINS || "http://localhost:3000")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
