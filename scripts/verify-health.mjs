#!/usr/bin/env node
/**
 * United Angel Reach — Healthcare Outreach module E2E verification harness (QA).
 *
 * Run:  bun scripts/verify-health.mjs
 *   or: node scripts/verify-health.mjs
 *
 * Requires the dev server already running (default http://localhost:3000).
 * Playwright 1.65.0 is resolved WITHOUT touching package.json: first a plain
 * import (works when installed normally / via bunx --package), then a scan of
 * the bun global install cache.
 *
 * Covers spec docs/health.md sections 25-27 acceptance scenarios:
 *   a. admin login (UI)
 *   b. admin health console (UI)
 *   c. camp lifecycle (API-driven; scenario A journey)
 *   d. UI smoke (health camps tab, camp detail, doctor portal, prescriptions)
 *   e. access-control matrix (API, token per role)
 *   f. regression (tsc, lint, verify-file-manager 9/9, build)
 *   +. AI governance (consult-draft disclaimer, no auto-signing)
 *
 * Exits non-zero if any assertion FAILs (SKIP = environment-gated, not a defect).
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { execSync } from "node:child_process";

/* ------------------------------------------------------------------ */
/* Config                                                              */
/* ------------------------------------------------------------------ */

const BASE = process.env.QA_BASE_URL || "http://localhost:3000";
const PROJECT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");

const CREDS = {
  ADMIN: { email: "admin@unitedangelreach.org", password: "Admin@123" },
  NURSE: { email: "nurse@demo.org", password: "Nurse@123" },
  DOCTOR: { email: "dr.meera@demo.org", password: "Doctor@123" },
  PHARMACIST: { email: "pharmacist@demo.org", password: "Pharm@123" },
  LAB_TECH: { email: "labtech@demo.org", password: "Lab@123" },
  HOSPITAL: { email: "hospital@demo.org", password: "Hospital@123" },
  DONOR: { email: "donor@demo.org", password: "Donor@123" },
  BENEFICIARY: { email: "beneficiary@demo.org", password: "Benef@123" },
};

const SCRIPT_DIR = path.dirname(new URL(import.meta.url).pathname);
const ASSETS = path.join(SCRIPT_DIR, "qa-health-assets");
fs.mkdirSync(ASSETS, { recursive: true });

/** Steps that may legitimately be unavailable in this environment (AI 503). */
const RUN = Date.now();
const UNIQUE = `QA-HL-${RUN}`;

/* ------------------------------------------------------------------ */
/* Playwright resolution (no dependency installs)                      */
/* ------------------------------------------------------------------ */

async function loadPlaywright() {
  try {
    return await import("playwright");
  } catch {
    /* fall through to cache scan */
  }
  const home = process.env.HOME || os.homedir();
  for (const cacheRoot of [
    path.join(home, ".bun", "install", "cache"),
    path.join(home, "Library", "Caches", "bun", "install", "cache"),
  ]) {
    try {
      const candidates = fs
        .readdirSync(cacheRoot)
        .filter((e) => /^playwright@\d+\.\d+\.\d+/.test(e))
        .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
      for (const c of candidates) {
        const p = path.join(cacheRoot, c, "index.mjs");
        if (fs.existsSync(p)) {
          return await import(pathToFileURL(p).href);
        }
      }
    } catch {
      /* ignore */
    }
  }
  console.error(
    "FATAL: playwright not importable. Run one of:\n" +
      "  bunx --package playwright@1.65.0 node scripts/verify-health.mjs\n" +
      "  bun scripts/verify-health.mjs"
  );
  process.exit(2);
}

/* ------------------------------------------------------------------ */
/* Tiny test framework (PASS / FAIL / SKIP)                            */
/* ------------------------------------------------------------------ */

const results = [];
const consoleErrors = [];
const pageErrors = [];
let page;

/** Record one step; never throws. Screenshots the page on failure. */
async function step(label, fn) {
  const t0 = Date.now();
  process.stdout.write(`\n> ${label}\n`);
  try {
    const detail = await fn();
    results.push({ step: label, status: "PASS", detail: detail || "", ms: Date.now() - t0 });
    console.log(`  PASS (${fmtMs(Date.now() - t0)})${detail ? ` — ${detail}` : ""}`);
    return true;
  } catch (e) {
    if (e && e.__skip) {
      results.push({ step: label, status: "SKIP", detail: String(e.message || e).slice(0, 300), ms: Date.now() - t0 });
      console.log(`  SKIP: ${e.message}`);
      return true;
    }
    const detail = String(e?.message || e)
      .split("\n")
      .filter((l) => l.trim())
      .slice(0, 3)
      .join(" ")
      .slice(0, 400);
    results.push({ step: label, status: "FAIL", detail, ms: Date.now() - t0 });
    console.log(`  FAIL: ${detail}`);
    try {
      if (page) {
        const slug = label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
        await page.screenshot({ path: path.join(ASSETS, `failure-${slug}.png`), fullPage: true });
      }
    } catch { /* screenshot best-effort */ }
    return false;
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

/** Throw a SKIP marker (environment-gated, not a product defect). */
function skip(msg) {
  const e = new Error(msg);
  e.__skip = true;
  throw e;
}

const fmtMs = (ms) => (ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ------------------------------------------------------------------ */
/* API helpers (token auth via Authorization: Bearer)                  */
/* ------------------------------------------------------------------ */

const tokens = {}; // role -> bearer token

/**
 * POST /api/auth/login; on non-200 (dev server recompiles / agents mid-edit /
 * 429 rate-limit) retry until `maxMs` elapses. Returns { token, user }.
 * Polling is 60s by design: the login endpoint rate-limits at 20 attempts
 * per 10 min per IP and 10 per email — a tighter poll would starve itself.
 */
async function loginWithRetry(role, maxMs = 15 * 60 * 1000, pollMs = 60000) {
  const { email, password } = CREDS[role];
  const t0 = Date.now();
  let last = 0;
  for (;;) {
    try {
      const res = await fetch(`${BASE}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      last = res.status;
      if (res.ok) {
        const data = await res.json();
        if (data?.token) return { token: data.token, user: data.user };
      }
    } catch { /* server momentarily down — keep polling */ }
    if (Date.now() - t0 > maxMs) {
      throw new Error(`login ${role} (${email}) did not succeed within ${Math.round(maxMs / 1000)}s — last HTTP ${last}`);
    }
    await sleep(pollMs);
  }
}

/** One authenticated API call. Returns { status, ok, data, text, ct }. */
async function api(method, path, body, token) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  return { status: res.status, ok: res.ok, data, text, ct: res.headers.get("content-type") || "" };
}

async function login(role) {
  if (tokens[role]) return tokens[role];
  const { token } = await loginWithRetry(role);
  tokens[role] = token;
  return token;
}

/** Expect an exact status; throw with the server error message otherwise. */
function expectStatus(r, expected, what) {
  const list = Array.isArray(expected) ? expected : [expected];
  assert(
    list.includes(r.status),
    `${what}: expected HTTP ${list.join("|")}, got ${r.status}${r.data?.error ? ` — ${r.data.error}` : ""}`
  );
}

/* Locator helper — try a list of candidate locators, return first with a match. */
async function firstExisting(locators) {
  for (const loc of locators) {
    try {
      if ((await loc.count()) > 0) return loc.first();
    } catch { /* ignore invalid selector */ }
  }
  return null;
}

const SHOT = (n) => path.join(ASSETS, n);

/* ------------------------------------------------------------------ */
/* Shared run state                                                    */
/* ------------------------------------------------------------------ */

const state = {
  camp: null, // MedicalCamp
  beneficiary: null, // Beneficiary
  registration: null,
  attendance: null,
  vitals: null,
  encounter: null,
  prescription: null, // with items[]
  rxItem: null,
  inventoryItem: null,
  inventoryQtyBefore: null,
  labOrder: null,
  referral: null,
  followUp: null,
  appointment: null,
  aiInteraction: null,
  hospitalUserOrgId: null,
  otherOrgId: null,
};

/* ------------------------------------------------------------------ */
/* Main                                                                */
/* ------------------------------------------------------------------ */

const pw = await loadPlaywright();

{
  const browser = await pw.chromium.launch({ headless: true });
  const context = await browser.newContext({
    baseURL: BASE,
    viewport: { width: 1440, height: 900 },
  });
  context.setDefaultTimeout(20000);
  context.setDefaultNavigationTimeout(45000);
  page = await context.newPage();
  page.setDefaultTimeout(20000);
  page.setDefaultNavigationTimeout(45000);

  page.on("console", (msg) => {
    if (msg.type() === "error") {
      consoleErrors.push({ step: "ui", text: msg.text().slice(0, 300) });
    }
  });
  page.on("pageerror", (err) => {
    pageErrors.push({ step: "ui", text: String(err).slice(0, 300) });
  });

  /* ---------------- a. Admin login (UI) ---------------- */
  await step("a. admin login via UI -> #/admin + uar_token stored", async () => {
    await page.goto(`${BASE}/#/login`, { waitUntil: "domcontentloaded" });
    const email = page.locator('input[type="email"]').first();
    await email.waitFor({ state: "visible", timeout: 30000 });
    await email.fill(CREDS.ADMIN.email);
    await page.locator("#l-password").fill(CREDS.ADMIN.password);
    await page.getByRole("button", { name: /sign in/i }).first().click();
    await page.waitForFunction(() => !!localStorage.getItem("uar_token"), null, { timeout: 30000 });
    await page.waitForURL(/#\/admin/, { timeout: 30000 });
    tokens.ADMIN = await page.evaluate(() => localStorage.getItem("uar_token"));
    await page.screenshot({ path: SHOT("01-admin-login.png") });
  });

  /* ---------------- b. Admin health console ---------------- */
  await step("b. #/admin/health renders Health console (nav item + KPI cards)", async () => {
    await page.evaluate(() => { window.location.hash = "/admin/health"; });
    await page.waitForURL(/#\/admin\/health/, { timeout: 30000 });
    // "Health" nav item present in the sidebar.
    const navHealth = await firstExisting([
      page.locator("aside nav a, aside nav button").filter({ hasText: /health/i }),
      page.locator('nav a, nav button').filter({ hasText: /health/i }),
    ]);
    assert(navHealth, 'sidebar nav item matching /health/i not found');
    // Health overview KPI cards rendered.
    await sleep(1500); // fetch + render
    const kpiCards = await page.locator('[data-slot="card"], .card-hover').count();
    assert(kpiCards >= 2, `expected >=2 KPI/stat cards on health overview, found ${kpiCards}`);
    await page.screenshot({ path: SHOT("02-admin-health-console.png"), fullPage: true });
  });

  /* ---------------- c1. Create camp ---------------- */
  await step("c1. POST /api/medical-camps -> 201 + UAR-CAMP code; PATCH -> SCHEDULED", async () => {
    const admin = await login("ADMIN");
    const r = await api("POST", "/api/medical-camps", {
      title: `${UNIQUE} General Health Camp`,
      venue: "QA Community Hall, Bengaluru",
      city: "Bengaluru",
      campDate: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      capacity: 200,
      services: ["General checkup", "Eye screening"],
      description: "Created by verify-health.mjs QA harness",
    }, admin);
    expectStatus(r, 201, "POST /api/medical-camps");
    assert(/^UAR-CAMP-/.test(r.data.code || ""), `camp code not UAR-CAMP-… (got "${r.data.code}")`);
    state.camp = r.data;
    // DRAFT -> SCHEDULED (registration requires SCHEDULED or LIVE)
    const p = await api("PATCH", `/api/medical-camps/${state.camp.id}`, { status: "SCHEDULED" }, admin);
    expectStatus(p, 200, "PATCH camp -> SCHEDULED");
    assert(p.data.status === "SCHEDULED", `camp status expected SCHEDULED, got ${p.data.status}`);
  });

  /* ---------------- c2. Beneficiary ---------------- */
  await step("c2. POST /api/beneficiaries -> 201 + id (QA Health Beneficiary)", async () => {
    const admin = await login("ADMIN");
    const r = await api("POST", "/api/beneficiaries", {
      name: "QA Health Beneficiary",
      phone: `+9198${String(RUN % 100000000).padStart(8, "0")}`,
      city: "Bengaluru",
      category: "PATIENT",
      urgencyLevel: "MEDIUM",
      needs: "General health screening (QA)",
    }, admin);
    expectStatus(r, 201, "POST /api/beneficiaries");
    assert(r.data.id, "beneficiary id missing in response");
    state.beneficiary = r.data;
  });

  /* ---------------- c3+c4. Registration + duplicate 409 ---------------- */
  await step("c3. POST /api/camp-registrations DESK -> 201 + UAR-CREG code", async () => {
    const admin = await login("ADMIN");
    const r = await api("POST", "/api/camp-registrations", {
      campId: state.camp.id,
      beneficiaryId: state.beneficiary.id,
      registeredVia: "DESK",
    }, admin);
    expectStatus(r, 201, "POST /api/camp-registrations");
    assert(/^UAR-CREG-/.test(r.data.code || ""), `registration code not UAR-CREG-… (got "${r.data.code}")`);
    state.registration = r.data;
  });

  await step("c4. duplicate camp-registration -> 409", async () => {
    const admin = await login("ADMIN");
    const r = await api("POST", "/api/camp-registrations", {
      campId: state.camp.id,
      beneficiaryId: state.beneficiary.id,
      registeredVia: "DESK",
    }, admin);
    expectStatus(r, 409, "duplicate POST /api/camp-registrations");
  });

  /* ---------------- c5+c6. Attendance QR + duplicate ---------------- */
  await step("c5. POST /api/camp-attendance QR -> queueToken 1 + CHECKED_IN", async () => {
    const admin = await login("ADMIN");
    const r = await api("POST", "/api/camp-attendance", {
      registrationId: state.registration.id,
      method: "QR",
    }, admin);
    expectStatus(r, 201, "POST /api/camp-attendance");
    assert(r.data.queueToken === 1, `queueToken expected 1, got ${r.data.queueToken}`);
    assert(r.data.status === "CHECKED_IN", `status expected CHECKED_IN, got ${r.data.status}`);
    assert(r.data.checkInMethod === "QR", `checkInMethod expected QR, got ${r.data.checkInMethod}`);
    state.attendance = r.data;
  });

  await step("c6. duplicate camp-attendance -> 409", async () => {
    const admin = await login("ADMIN");
    const r = await api("POST", "/api/camp-attendance", {
      registrationId: state.registration.id,
      method: "QR",
    }, admin);
    expectStatus(r, 409, "duplicate POST /api/camp-attendance");
  });

  /* ---------------- c7. Camp LIVE ---------------- */
  await step("c7. PATCH /api/medical-camps/:id -> status LIVE", async () => {
    const admin = await login("ADMIN");
    const p = await api("PATCH", `/api/medical-camps/${state.camp.id}`, { status: "LIVE" }, admin);
    expectStatus(p, 200, "PATCH camp -> LIVE");
    assert(p.data.status === "LIVE", `camp status expected LIVE, got ${p.data.status}`);
  });

  /* ---------------- c8. Nurse vitals + BMI ---------------- */
  await step("c8. nurse login (poll ≤15min) + POST /api/vitals -> bmi ≈ 22.5", async () => {
    const nurse = await login("NURSE");
    const r = await api("POST", "/api/vitals", {
      beneficiaryId: state.beneficiary.id,
      campId: state.camp.id,
      bpSystolic: 120,
      bpDiastolic: 80,
      pulse: 72,
      tempC: 36.8,
      spo2: 98,
      heightCm: 170,
      weightKg: 65,
    }, nurse);
    expectStatus(r, 201, "POST /api/vitals");
    const expectedBmi = 65 / Math.pow(170 / 100, 2); // 22.49
    assert(
      Math.abs((r.data.bmi ?? 0) - expectedBmi) <= 0.1,
      `bmi expected ≈${expectedBmi.toFixed(1)} (tol 0.1), got ${r.data.bmi}`
    );
    state.vitals = r.data;
  });

  /* ---------------- c9-c11. Encounter DRAFT -> SIGNED -> immutable ---------------- */
  await step("c9. doctor login + POST /api/encounters -> DRAFT", async () => {
    const doctor = await login("DOCTOR");
    const r = await api("POST", "/api/encounters", {
      beneficiaryId: state.beneficiary.id,
      campId: state.camp.id,
      chiefComplaint: "Fever and body ache for 2 days (QA)",
      observations: "BP 120/80, pulse 72, afebrile on exam (QA harness)",
      diagnosis: "Suspected viral fever (QA)",
      advice: "Rest, hydration, paracetamol SOS",
    }, doctor);
    expectStatus(r, 201, "POST /api/encounters");
    assert(r.data.status === "DRAFT", `encounter status expected DRAFT, got ${r.data.status}`);
    state.encounter = r.data;
  });

  await step("c10. POST /api/encounters/:id/sign -> SIGNED", async () => {
    const doctor = await login("DOCTOR");
    const r = await api("POST", `/api/encounters/${state.encounter.id}/sign`, {}, doctor);
    expectStatus(r, [200, 201], "POST /api/encounters/:id/sign");
    assert(r.data.status === "SIGNED", `encounter status expected SIGNED, got ${r.data.status}`);
    assert(r.data.signedAt, "signedAt not stamped on sign");
  });

  await step("c11. PATCH signed encounter WITHOUT amendment -> 409 (immutability)", async () => {
    const doctor = await login("DOCTOR");
    const r = await api("PATCH", `/api/encounters/${state.encounter.id}`, {
      diagnosis: "Tampered diagnosis (QA)",
    }, doctor);
    expectStatus(r, [409, 403], "PATCH signed encounter without amendment");
  });

  /* ---------------- c12-c14. Prescription DRAFT -> SIGNED -> print ---------------- */
  await step("c12. POST /api/prescriptions -> DRAFT + UAR-RX code", async () => {
    const doctor = await login("DOCTOR");
    const r = await api("POST", "/api/prescriptions", {
      beneficiaryId: state.beneficiary.id,
      encounterId: state.encounter.id,
      campId: state.camp.id,
      diagnosis: "Suspected viral fever (QA)",
      items: [
        { medicineName: "Paracetamol", quantity: 10, dosage: "500mg", frequency: "1-0-1", durationDays: 3 },
      ],
    }, doctor);
    expectStatus(r, 201, "POST /api/prescriptions");
    assert(/^UAR-RX-/.test(r.data.code || ""), `prescription code not UAR-RX-… (got "${r.data.code}")`);
    assert(r.data.status === "DRAFT", `prescription status expected DRAFT, got ${r.data.status}`);
    state.prescription = r.data;
    state.rxItem = (r.data.items || [])[0];
    assert(state.rxItem, "prescription items[] missing from response");
  });

  await step("c13. POST /api/prescriptions/:id/sign -> SIGNED", async () => {
    const doctor = await login("DOCTOR");
    const r = await api("POST", `/api/prescriptions/${state.prescription.id}/sign`, {}, doctor);
    expectStatus(r, [200, 201], "POST /api/prescriptions/:id/sign");
    assert(r.data.status === "SIGNED", `prescription status expected SIGNED, got ${r.data.status}`);
    state.prescription = r.data;
  });

  await step("c14. GET /api/prescriptions/:id/print -> 200 text/html", async () => {
    const doctor = await login("DOCTOR");
    const r = await api("GET", `/api/prescriptions/${state.prescription.id}/print`, undefined, doctor);
    expectStatus(r, 200, "GET /api/prescriptions/:id/print");
    assert(/text\/html/i.test(r.ct), `print content-type expected text/html, got "${r.ct}"`);
    assert((r.text || "").includes(state.prescription.code), "print HTML missing Rx code");
  });

  /* ---------------- c15-c16. Dispense + inventory decrement ---------------- */
  await step("c15. pharmacist dispense with inventoryItemId -> FULLY_DISPENSED", async () => {
    const admin = await login("ADMIN");
    // Ensure MEDICINE stock exists for "QA Paracetamol".
    let item = null;
    const list = await api("GET", "/api/inventory?q=" + encodeURIComponent("QA Paracetamol"), undefined, admin);
    const rows = Array.isArray(list.data) ? list.data : list.data?.items || [];
    item = rows.find((i) => i.name === "QA Paracetamol" && i.quantity >= 10) || null;
    if (!item) {
      const created = await api("POST", "/api/inventory", {
        name: "QA Paracetamol",
        category: "MEDICINE",
        quantity: 100,
        unit: "tablet",
        minStock: 10,
      }, admin);
      expectStatus(created, 201, "POST /api/inventory (QA Paracetamol)");
      item = created.data;
    }
    state.inventoryItem = item;
    state.inventoryQtyBefore = item.quantity;

    const pharm = await login("PHARMACIST");
    const r = await api("POST", `/api/prescriptions/${state.prescription.id}/dispense`, {
      dispenses: [{ itemId: state.rxItem.id, inventoryItemId: item.id, quantity: 10 }],
    }, pharm);
    expectStatus(r, [200, 201], "POST /api/prescriptions/:id/dispense");
    assert(
      r.data.status === "FULLY_DISPENSED",
      `prescription status expected FULLY_DISPENSED, got ${r.data.status}`
    );
    state.prescription = r.data;
  });

  await step("c16. inventory quantity decremented (GET /api/inventory)", async () => {
    const admin = await login("ADMIN");
    const r = await api("GET", "/api/inventory?q=" + encodeURIComponent("QA Paracetamol"), undefined, admin);
    expectStatus(r, 200, "GET /api/inventory");
    const rows = Array.isArray(r.data) ? r.data : r.data?.items || [];
    const item = rows.find((i) => i.id === state.inventoryItem.id);
    assert(item, "created inventory item not found after dispense");
    assert(
      item.quantity === state.inventoryQtyBefore - 10,
      `inventory quantity expected ${state.inventoryQtyBefore - 10} after dispensing 10, got ${item.quantity}`
    );
  });

  /* ---------------- c17-c20. Lab order state machine ---------------- */
  await step("c17. doctor POST /api/lab-orders 'Blood glucose' -> 201 + UAR-LAB code", async () => {
    const doctor = await login("DOCTOR");
    const r = await api("POST", "/api/lab-orders", {
      beneficiaryId: state.beneficiary.id,
      campId: state.camp.id,
      encounterId: state.encounter.id,
      testName: "Blood glucose",
    }, doctor);
    expectStatus(r, 201, "POST /api/lab-orders");
    assert(/^UAR-LAB-/.test(r.data.code || ""), `lab order code not UAR-LAB-… (got "${r.data.code}")`);
    state.labOrder = r.data;
  });

  await step("c18. out-of-order lab transition -> 409 (ORDERED -> RESULT_AVAILABLE)", async () => {
    const labtech = await login("LAB_TECH");
    const r = await api("PATCH", `/api/lab-orders/${state.labOrder.id}`, {
      status: "RESULT_AVAILABLE",
      resultText: "Jumping the queue (QA)",
    }, labtech);
    expectStatus(r, 409, "out-of-order PATCH /api/lab-orders/:id");
  });

  await step("c19. lab chain SAMPLE_COLLECTED->RECEIVED->PROCESSING->RESULT_AVAILABLE->VERIFIED", async () => {
    const labtech = await login("LAB_TECH");
    for (const [target, extra] of [
      ["SAMPLE_COLLECTED", {}],
      ["RECEIVED", {}],
      ["PROCESSING", {}],
      ["RESULT_AVAILABLE", { resultText: "Fasting glucose 92 mg/dL (QA)" }],
      ["VERIFIED", {}],
    ]) {
      const r = await api("PATCH", `/api/lab-orders/${state.labOrder.id}`, { status: target, ...extra }, labtech);
      expectStatus(r, 200, `PATCH lab-order -> ${target}`);
      assert(r.data.status === target, `lab order status expected ${target}, got ${r.data.status}`);
    }
  });

  await step("c20. doctor reviews lab result -> DOCTOR_REVIEWED", async () => {
    const doctor = await login("DOCTOR");
    const r = await api("PATCH", `/api/lab-orders/${state.labOrder.id}`, { status: "DOCTOR_REVIEWED" }, doctor);
    expectStatus(r, 200, "PATCH lab-order -> DOCTOR_REVIEWED");
    assert(r.data.status === "DOCTOR_REVIEWED", `status expected DOCTOR_REVIEWED, got ${r.data.status}`);
  });

  /* ---------------- c21-c22. Referral + follow-up ---------------- */
  await step("c21. doctor POST /api/referrals HIGH -> UAR-REF code", async () => {
    const doctor = await login("DOCTOR");
    const r = await api("POST", "/api/referrals", {
      beneficiaryId: state.beneficiary.id,
      campId: state.camp.id,
      encounterId: state.encounter.id,
      reason: "Persistent fever — needs physician review (QA)",
      priority: "HIGH",
    }, doctor);
    expectStatus(r, 201, "POST /api/referrals");
    assert(/^UAR-REF-/.test(r.data.code || ""), `referral code not UAR-REF-… (got "${r.data.code}")`);
    assert(r.data.priority === "HIGH", `referral priority expected HIGH, got ${r.data.priority}`);
    state.referral = r.data;
  });

  await step("c22. POST /api/follow-ups (+7d) -> PENDING; PATCH -> DONE", async () => {
    const doctor = await login("DOCTOR");
    const due = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    const r = await api("POST", "/api/follow-ups", {
      beneficiaryId: state.beneficiary.id,
      referralId: state.referral.id,
      dueDate: due,
      instructions: "Review fever resolution (QA)",
    }, doctor);
    expectStatus(r, 201, "POST /api/follow-ups");
    assert(r.data.status === "PENDING", `follow-up status expected PENDING, got ${r.data.status}`);
    state.followUp = r.data;

    const p = await api("PATCH", `/api/follow-ups/${state.followUp.id}`, { status: "DONE" }, doctor);
    expectStatus(p, 200, "PATCH follow-up -> DONE");
    assert(p.data.status === "DONE", `follow-up status expected DONE, got ${p.data.status}`);
    assert(p.data.doneAt, "doneAt not stamped when follow-up DONE");
  });

  /* ---------------- c23. Scenario B — no-show ---------------- */
  await step("c23. appointment -> NO_SHOW with reason (Scenario B)", async () => {
    const admin = await login("ADMIN");
    const r = await api("POST", "/api/appointments", {
      beneficiaryId: state.beneficiary.id,
      campId: state.camp.id,
      type: "CONSULTATION",
      scheduledAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      notes: "QA no-show scenario",
    }, admin);
    expectStatus(r, 201, "POST /api/appointments");
    assert(r.data.status === "SCHEDULED", `appointment status expected SCHEDULED, got ${r.data.status}`);
    state.appointment = r.data;

    const p = await api("PATCH", `/api/appointments/${state.appointment.id}`, {
      status: "NO_SHOW",
      noShowReason: "Beneficiary did not attend (QA)",
    }, admin);
    expectStatus(p, 200, "PATCH appointment -> NO_SHOW");
    assert(p.data.status === "NO_SHOW", `appointment status expected NO_SHOW, got ${p.data.status}`);
    assert(p.data.noShowReason, "noShowReason not persisted");
  });

  /* ---------------- d1-d2. Health camps tab + camp detail (UI) ---------------- */
  await step("d1. #/admin/health camps tab lists the created camp", async () => {
    await page.evaluate(() => { window.location.hash = "/admin/health/camps"; });
    await sleep(1200);
    let listed = await page.locator(`text=${state.camp.code}`).count();
    if (!listed) {
      // Fallback: camps may be a tab on the overview — click it.
      const tab = await firstExisting([
        page.getByRole("tab", { name: /camps/i }),
        page.locator("button, a").filter({ hasText: /^camps$/i }),
      ]);
      if (tab) {
        await tab.click();
        await sleep(1500);
        listed = await page.locator(`text=${state.camp.code}`).count();
      }
    }
    assert(listed > 0, `camp code ${state.camp.code} not visible on the health camps tab`);
    await page.screenshot({ path: SHOT("03-health-camps-tab.png"), fullPage: true });
  });

  await step("d2. camp detail opens for the created camp", async () => {
    const row = await firstExisting([
      page.locator(`tr:has-text("${state.camp.code}")`),
      page.locator(`[data-slot="card"]:has-text("${state.camp.code}")`),
      page.locator(`:text("${state.camp.code}")`).locator("xpath=ancestor::button | ancestor::a | ancestor::tr").first(),
    ]);
    assert(row, `no row/card found for camp ${state.camp.code}`);
    await row.click();
    await sleep(1800); // detail sheet/view fetch
    const detail = await firstExisting([
      page.locator('[role="dialog"]'),
      page.locator('[data-slot="sheet"]'),
      page.getByRole("heading", { name: new RegExp(state.camp.title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i") }),
    ]);
    assert(detail, "camp detail (dialog/sheet/heading) did not open");
    await page.screenshot({ path: SHOT("04-camp-detail.png"), fullPage: true });
    await page.keyboard.press("Escape").catch(() => {});
  });

  /* ---------------- d3-d5. Doctor portal via UI ---------------- */
  // Helper: UI login with retry (login endpoint 429s under rate limit; the
  // window resets after 10 min). Resolves when uar_token is in localStorage.
  async function uiLogin(p, email, password, tries = 3) {
    for (let i = 0; i < tries; i++) {
      await p.goto(`${BASE}/#/login`, { waitUntil: "domcontentloaded" });
      const emailInput = p.locator('input[type="email"]').first();
      await emailInput.waitFor({ state: "visible", timeout: 30000 });
      await emailInput.fill(email);
      await p.locator("#l-password").fill(password);
      await p.getByRole("button", { name: /sign in/i }).first().click();
      try {
        await p.waitForFunction(() => !!localStorage.getItem("uar_token"), null, { timeout: 15000 });
        return;
      } catch {
        if (i === tries - 1) throw new Error(`UI login failed for ${email} after ${tries} attempts`);
        await sleep(65000); // rate-limit window breathes
      }
    }
  }

  await step("d3. doctor UI login redirects to #/doctor (spec §3.2)", async () => {
    const ctx2 = await browser.newContext({ baseURL: BASE, viewport: { width: 1440, height: 900 } });
    ctx2.setDefaultTimeout(20000);
    const p2 = await ctx2.newPage();
    const prevPage = page;
    page = p2;
    try {
      await uiLogin(p2, CREDS.DOCTOR.email, CREDS.DOCTOR.password);
      await p2.waitForURL(/#\/doctor/, { timeout: 10000 });
      page = prevPage;
      await ctx2.close();
    } catch (e) {
      // Known defect context: capture where the doctor actually landed.
      const landed = await p2.evaluate(() => window.location.hash).catch(() => "?");
      page = prevPage;
      await ctx2.close().catch(() => {});
      throw new Error(
        `doctor UI login did not land on #/doctor (landed: "${landed || "no hash"}") — routeByRole() in src/components/public/auth-pages.tsx has no DOCTOR case. Original: ${e.message?.slice(0, 160)}`
      );
    }
  });

  await step("d4. doctor portal renders dashboard + patients (direct nav)", async () => {
    const ctx2 = await browser.newContext({ baseURL: BASE, viewport: { width: 1440, height: 900 } });
    ctx2.setDefaultTimeout(20000);
    const p2 = await ctx2.newPage();
    p2.setDefaultTimeout(20000);
    const prevPage = page;
    page = p2;
    try {
      await uiLogin(p2, CREDS.DOCTOR.email, CREDS.DOCTOR.password);
      // Defect workaround: doctors are not auto-redirected — go to the portal directly.
      await p2.evaluate(() => { window.location.hash = "/doctor"; });
      await p2.waitForURL(/#\/doctor/, { timeout: 30000 });
      await sleep(2000); // dashboard data
      const patientsNav = await firstExisting([
        p2.locator("nav a, nav button").filter({ hasText: /patients/i }),
        p2.locator("aside a, aside button").filter({ hasText: /patients/i }),
      ]);
      assert(
        patientsNav,
        'doctor portal: Patients nav item not found at #/doctor — src/app/page.tsx isPortalArea does not include "doctor", so #/doctor renders PublicSite instead of PortalRouter/MedicalPortal'
      );
      const hasOverview = (await p2.locator('[data-slot="card"], .card-hover, main').count()) > 0;
      assert(hasOverview, "doctor portal dashboard content missing");
      await p2.screenshot({ path: SHOT("05-doctor-portal.png"), fullPage: true });
      page = prevPage;
      await ctx2.close();
    } catch (e) {
      await p2.screenshot({ path: SHOT("failure-d4-doctor-portal.png"), fullPage: true }).catch(() => {});
      page = prevPage;
      await ctx2.close().catch(() => {});
      throw e;
    }
  });

  await step("d5. doctor portal prescriptions view shows the created prescription", async () => {
    const ctx2 = await browser.newContext({ baseURL: BASE, viewport: { width: 1440, height: 900 } });
    ctx2.setDefaultTimeout(20000);
    const p2 = await ctx2.newPage();
    const prevPage = page;
    page = p2;
    try {
      await uiLogin(p2, CREDS.DOCTOR.email, CREDS.DOCTOR.password);
      await p2.evaluate(() => { window.location.hash = "/doctor/prescriptions"; });
      await sleep(2500);
      const rx = p2.locator(`text=${state.prescription.code}`).first();
      await rx.waitFor({ state: "visible", timeout: 20000 });
      await p2.screenshot({ path: SHOT("06-prescriptions-view.png"), fullPage: true });
      page = prevPage;
      await ctx2.close();
    } catch (e) {
      await p2.screenshot({ path: SHOT("failure-d5-prescriptions-view.png"), fullPage: true }).catch(() => {});
      page = prevPage;
      await ctx2.close().catch(() => {});
      throw new Error(
        `${e.message?.slice(0, 200)} — note: #/doctor/* renders PublicSite because src/app/page.tsx isPortalArea omits "doctor"`
      );
    }
  });

  /* ---------------- e. Access-control matrix ---------------- */
  await step("e1. DONOR token GET /api/encounters -> 403", async () => {
    const donor = await login("DONOR");
    const r = await api("GET", "/api/encounters", undefined, donor);
    expectStatus(r, 403, "DONOR GET /api/encounters");
  });

  await step("e2. BENEFICIARY token GET /api/encounters of another beneficiary -> 403/404", async () => {
    const ben = await login("BENEFICIARY");
    const r = await api("GET", `/api/encounters?beneficiaryId=${state.beneficiary.id}`, undefined, ben);
    expectStatus(r, [403, 404], "BENEFICIARY GET /api/encounters?beneficiaryId=<other>");
  });

  await step("e3. BENEFICIARY own health timeline allowed -> 200", async () => {
    const ben = await login("BENEFICIARY");
    const r = await api("GET", "/api/health-timeline", undefined, ben);
    expectStatus(r, 200, "BENEFICIARY GET /api/health-timeline (own)");
  });

  await step("e4. PHARMACIST POST /api/encounters -> 403", async () => {
    const pharm = await login("PHARMACIST");
    const r = await api("POST", "/api/encounters", {
      beneficiaryId: state.beneficiary.id,
      chiefComplaint: "x",
      diagnosis: "x",
    }, pharm);
    expectStatus(r, 403, "PHARMACIST POST /api/encounters");
  });

  await step("e5. PHARMACIST POST /api/prescriptions -> 403", async () => {
    const pharm = await login("PHARMACIST");
    const r = await api("POST", "/api/prescriptions", {
      beneficiaryId: state.beneficiary.id,
      items: [{ medicineName: "Paracetamol", quantity: 1 }],
    }, pharm);
    expectStatus(r, 403, "PHARMACIST POST /api/prescriptions");
  });

  await step("e6. NURSE POST /api/encounters/:id/sign -> 403", async () => {
    const nurse = await login("NURSE");
    // Fresh DRAFT encounter => the route's role check (not the already-signed
    // 409 path) is what must reject the nurse.
    const doctor = await login("DOCTOR");
    const draft = await api("POST", "/api/encounters", {
      beneficiaryId: state.beneficiary.id,
      chiefComplaint: "Access-control probe (QA)",
      diagnosis: "Probe diagnosis (QA)",
    }, doctor);
    expectStatus(draft, 201, "setup: POST /api/encounters for nurse sign probe");
    const r = await api("POST", `/api/encounters/${draft.data.id}/sign`, {}, nurse);
    expectStatus(r, 403, "NURSE POST /api/encounters/:id/sign");
  });

  await step("e7. LAB_TECH POST /api/encounters/:id/sign -> 403", async () => {
    const labtech = await login("LAB_TECH");
    const doctor = await login("DOCTOR");
    const draft = await api("POST", "/api/encounters", {
      beneficiaryId: state.beneficiary.id,
      chiefComplaint: "Access-control probe (QA)",
      diagnosis: "Probe diagnosis (QA)",
    }, doctor);
    expectStatus(draft, 201, "setup: POST /api/encounters for lab-tech sign probe");
    const r = await api("POST", `/api/encounters/${draft.data.id}/sign`, {}, labtech);
    expectStatus(r, 403, "LAB_TECH POST /api/encounters/:id/sign");
  });

  await step("e8. HOSPITAL token cannot read another org's health-professionals", async () => {
    const admin = await login("ADMIN");
    const hospital = await login("HOSPITAL");
    // Create a probe org that can never be the hospital caller's own org
    // (fresh name, no ownerUserId link).
    const probeOrg = await api("POST", "/api/health-orgs", {
      name: `${UNIQUE} Probe Org`,
      type: "HOSPITAL",
      city: "Bengaluru",
    }, admin);
    expectStatus(probeOrg, 201, "POST /api/health-orgs (QA probe org)");
    const probedId = probeOrg.data.id;

    const probe = await api("GET", `/api/health-professionals?orgId=${probedId}&limit=100`, undefined, hospital);
    if (probe.status === 403 || probe.status === 404) return; // hard denial — acceptable
    expectStatus(probe, 200, "GET /api/health-professionals?orgId=<other> as HOSPITAL");
    const rows = probe.data?.items || [];
    const leaked = rows.filter((p) => p.orgId === probedId);
    assert(
      leaked.length === 0,
      `cross-org leak: ${leaked.length} professionals of another org visible to the HOSPITAL token`
    );
  });

  await step("e9. unauthenticated GET /api/encounters -> 401", async () => {
    const r = await api("GET", "/api/encounters");
    expectStatus(r, 401, "unauthenticated GET /api/encounters");
  });

  /* ---------------- AI governance ---------------- */
  await step("ai1. consult-draft returns a disclaimer + PENDING (no auto-sign)", async () => {
    const doctor = await login("DOCTOR");
    const r = await api("POST", "/api/health-ai", {
      action: "consult-draft",
      beneficiaryId: state.beneficiary.id,
      encounterId: state.encounter.id,
      chiefComplaint: "Fever for 2 days (QA)",
      observations: "Stable vitals (QA)",
      vitalSummary: "BP 120/80, SpO2 98%",
    }, doctor);
    if (r.status === 503) skip(`AI service unavailable in this environment (503): ${r.data?.error || r.text?.slice(0, 120)}`);
    expectStatus(r, [200, 201], "POST /api/health-ai consult-draft");
    assert(r.data?.disclaimer && String(r.data.disclaimer).length > 0, "consult-draft response has no disclaimer");
    assert(r.data?.status === "PENDING", `AI interaction status expected PENDING, got ${r.data?.status}`);
    assert(
      /review|not a diagnosis|clinician/i.test(`${r.data.draft || ""} ${r.data.disclaimer || ""}`),
      "AI draft/disclaimer does not state it requires clinician review"
    );
    state.aiInteraction = r.data;
  });

  await step("ai2. approving AI interaction never mutates clinical records (no auto-sign)", async () => {
    if (!state.aiInteraction) skip("ai1 skipped — AI service unavailable");
    const doctor = await login("DOCTOR");
    const before = await api("GET", `/api/encounters/${state.encounter.id}`, undefined, doctor);
    expectStatus(before, 200, "GET encounter before AI approval");
    const r = await api("PATCH", `/api/health-ai/${state.aiInteraction.id}`, { status: "APPROVED" }, doctor);
    expectStatus(r, 200, "PATCH /api/health-ai/:id APPROVED");
    assert(r.data.status === "APPROVED", `AI interaction expected APPROVED, got ${r.data.status}`);
    const after = await api("GET", `/api/encounters/${state.encounter.id}`, undefined, doctor);
    expectStatus(after, 200, "GET encounter after AI approval");
    assert(
      after.data.status === before.data.status && after.data.diagnosis === before.data.diagnosis,
      "approving the AI interaction mutated the encounter — AI output must never be applied automatically"
    );
  });

  await browser.close();
}

/* ------------------------------------------------------------------ */
/* f. Regression (shell steps — outside browser context)               */
/* ------------------------------------------------------------------ */

function runCmd(cmd, timeoutMs) {
  try {
    const out = execSync(cmd, { cwd: PROJECT, timeout: timeoutMs, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] });
    return { code: 0, out: (out || "").slice(-8000) };
  } catch (e) {
    return { code: e.status ?? 1, out: `${e.stdout || ""}${e.stderr || ""}`.slice(-8000) };
  }
}

await step("f1. bunx tsc --noEmit -> 0 errors", async () => {
  const r = runCmd("bunx tsc --noEmit", 300000);
  assert(r.code === 0, `tsc failed (exit ${r.code}):\n${r.out.slice(-600)}`);
});

await step("f2. bun run lint -> 0 problems", async () => {
  const r = runCmd("bun run lint", 300000);
  assert(r.code === 0, `lint failed (exit ${r.code}):\n${r.out.slice(-600)}`);
});

await step("f3. bun scripts/verify-file-manager.mjs -> 9/9 PASS", async () => {
  const r = runCmd("bun scripts/verify-file-manager.mjs", 600000);
  const m = (r.out || "").match(/Checks:\s*(\d+)\/(\d+)\s+passed/);
  assert(r.code === 0, `verify-file-manager exited ${r.code}:\n${r.out.slice(-600)}`);
  assert(m, `could not parse summary line from verify-file-manager output:\n${r.out.slice(-600)}`);
  assert(m[1] === m[2] && m[1] === "9", `verify-file-manager reported ${m[1]}/${m[2]} passed — require 9/9`);
});

await step("f4. bun run build -> success (600s timeout)", async () => {
  const r = runCmd("bun run build", 600000);
  assert(r.code === 0, `build failed (exit ${r.code}):\n${r.out.slice(-900)}`);
});

/* ------------------------------------------------------------------ */
/* Summary                                                             */
/* ------------------------------------------------------------------ */

const pad = (s, n) => (s.length >= n ? s : s + " ".repeat(n - s.length));

console.log("\n" + "=".repeat(78));
console.log("UAR HEALTHCARE OUTREACH - E2E SUMMARY");
console.log("=".repeat(78));
console.log(`${pad("STEP", 58)}${pad("RESULT", 8)}TIME`);
console.log("-".repeat(78));
for (const r of results) {
  const detail = r.status === "FAIL" ? `  -> ${r.detail}` : r.status === "SKIP" ? `  (${r.detail.slice(0, 60)})` : "";
  console.log(`${pad(r.step.slice(0, 56), 58)}${pad(r.status, 8)}${fmtMs(r.ms)}${detail}`);
}
console.log("-".repeat(78));
const failed = results.filter((r) => r.status === "FAIL").length;
const skipped = results.filter((r) => r.status === "SKIP").length;
console.log(`Checks: ${results.length - failed}/${results.length} passed (${skipped} skipped)`);
console.log(`Console errors: ${consoleErrors.length}  |  Page (uncaught) errors: ${pageErrors.length}`);
for (const e of consoleErrors.slice(0, 20)) console.log(`  [console.error] ${e.text}`);
for (const e of pageErrors.slice(0, 20)) console.log(`  [pageerror] ${e.text}`);
console.log(`Assets: ${ASSETS}`);
console.log("=".repeat(78));
console.log(failed === 0 ? "OVERALL: PASS" : `OVERALL: FAIL (${failed} failed check${failed > 1 ? "s" : ""})`);

/* ---------------- cleanup: remove this run's test artifacts ---------------- */
try {
  const admin = await login("ADMIN");
  if (state.beneficiary?.id) {
    // Beneficiary FKs cascade — this removes registrations, attendance,
    // encounters, prescriptions, labs, referrals and follow-ups in one call.
    await api("DELETE", `/api/beneficiaries/${state.beneficiary.id}`, undefined, admin).catch(() => {});
  }
  if (state.camp?.id) {
    // Cancel first so the camp leaves the public SCHEDULED/LIVE/COMPLETED view;
    // DELETE succeeds only for DRAFT camps with no registrations.
    await api("PATCH", `/api/medical-camps/${state.camp.id}`, { status: "CANCELLED" }, admin).catch(() => {});
    await api("DELETE", `/api/medical-camps/${state.camp.id}`, undefined, admin).catch(() => {});
  }
  console.log("Cleanup: test camp + beneficiary removed (if APIs permitted).");
} catch {
  console.log("Cleanup: skipped (non-fatal) — test artifacts may remain.");
}

if (failed > 0) process.exit(1);
