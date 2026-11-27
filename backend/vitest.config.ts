import { defineConfig } from "vitest/config";
import path from "node:path";

// The suite runs against the dedicated TEST database (uar_test) — never the
// dev/prod `uar` database. backend/.env is NOT loaded so DATABASE_URL comes
// solely from this file's env below.
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    testTimeout: 30_000,
    pool: "forks", // isolated process — the in-app server + Prisma don't leak state
    fileParallelism: false, // suites share uar_test; api.test.ts wipes users
    env: {
      DATABASE_URL: "postgresql://uar:uar_dev_password@127.0.0.1:5433/uar_test?schema=public",
      SESSION_SECRET: "test-secret-value-at-least-16ch",
      NODE_ENV: "test",
      UPLOAD_DIR: "../upload-test",
      // Pin the cache OFF: vitest auto-loads backend/.env (REDIS_URL would
      // otherwise leak in), and a shared Redis serves the dev API's cached
      // settings/responses OVER the tests' direct db writes. The documented
      // test contract is "no Redis — tests hit Postgres directly".
      REDIS_URL: "",
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
});
