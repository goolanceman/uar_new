#!/usr/bin/env node
/**
 * United Angel Reach — Urgent appeals / featured campaigns / health reports E2E harness (QA).
 *
 * Run:  bun scripts/verify-featured-urgent.mjs
 *   or: node scripts/verify-featured-urgent.mjs
 *
 * Requires the dev server already running (default http://localhost:3000) and a
 * seeded DB (`bun run db:seed` — the flood-relief urgent campaign is seeded).
 * Playwright 1.65.0 is resolved WITHOUT touching package.json (same loader as
 * verify-health.mjs: plain import, then bun global cache scan).
 *
 * Covers the urgent-appeals + health-report round (a–h):
 *   a. API: public /api/campaigns — seeded "flood-relief" urgent+featured+ACTIVE
 *   b. HOME (anonymous): "Urgent appeals" strip + Donate-now CTA + Urgent badges
 *   c. CAMPAIGNS LIST: Urgent badge, urgent filter, default sort puts it top
 *   d. CAMPAIGN DETAIL: no "Programme not found" regression + "Urgent appeal" pill
 *   e. ADMIN TOGGLES: Mark/Clear urgent + Feature/Unfeature on home (UI + API)
 *   f. REPORTS VIEW: "Health Programme" section renders (UI) incl. FY switch
 *   g. API: GET /api/reports?fy=<current> — programmes.health contracted shape
 *   h. REGRESSION: tsc, lint, verify-health 45/45, verify-file-manager 9/9
 *
 * SELF-CLEANUP: the harness creates no campaigns; any flag it flips on an
 * existing campaign is reverted to its pre-run value via PATCH at the end.
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

const ADMIN = { email: "admin@unitedangelreach.org", password: "Admin@123" };

const SCRIPT_DIR = path.dirname(new URL(import.meta.url).pathname);
const ASSETS = path.join(SCRIPT_DIR, "qa-featured-urgent-assets");
fs.mkdirSync(ASSETS, { recursive: true });

/** FY = April→March; `fy` param / label is the START year. */
function fyStartOf(d = new Date()) {
  return d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1; // month 3 = April
}
const FY_CURRENT = fyStartOf();
const FY_PREV = FY_CURRENT - 1;
const fyLabel = (start) => `FY ${start}-${String((start + 1) % 100).padStart(2, "0")}`;

const URGENT_SLUG = "flood-relief";
const URGENT_TITLE_PART = "Emergency Flood Relief";

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
      "  bunx --package playwright@1.65.0 node scripts/verify-featured-urgent.mjs\n" +
      "  bun scripts/verify-featured-urgent.mjs"
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

const fmtMs = (ms) => (ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ------------------------------------------------------------------ */
/* API helpers (token auth via Authorization: Bearer)                  */
/* ------------------------------------------------------------------ */

let adminToken = null;

/**
 * POST /api/auth/login; retry until `maxMs` elapses. Polling is 60s by design:
 * the login endpoint rate-limits (20 attempts / 10 min / IP, 10 / email).
 */
async function loginWithRetry(maxMs = 15 * 60 * 1000, pollMs = 60000) {
  const t0 = Date.now();
  let last = 0;
  for (;;) {
    try {
      const res = await fetch(`${BASE}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(ADMIN),
      });
      last = res.status;
      if (res.ok) {
        const data = await res.json();
        if (data?.token) return data.token;
      }
    } catch { /* server momentarily down — keep polling */ }
    if (Date.now() - t0 > maxMs) {
      throw new Error(`admin login did not succeed within ${Math.round(maxMs / 1000)}s — last HTTP ${last}`);
    }
    await sleep(pollMs);
  }
}

async function ensureAdminToken() {
  if (adminToken) return adminToken;
  adminToken = await loginWithRetry();
  return adminToken;
}

/** One API call. Returns { status, ok, data, text, ct }. */
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

/** Expect an exact status; throw with the server error message otherwise. */
function expectStatus(r, expected, what) {
  const list = Array.isArray(expected) ? expected : [expected];
  assert(
    list.includes(r.status),
    `${what}: expected HTTP ${list.join("|")}, got ${r.status}${r.data?.error ? ` — ${r.data.error}` : ""}`
  );
}

async function getPublicCampaigns() {
  const r = await api("GET", "/api/campaigns");
  expectStatus(r, 200, "GET /api/campaigns");
  assert(Array.isArray(r.data), "GET /api/campaigns should return a raw array");
  return r.data;
}

/** Locator helper — try a list of candidate locators, return first with a match. */
async function firstExisting(locators) {
  for (const loc of locators) {
    try {
      if ((await loc.count()) > 0) return loc.first();
    } catch { /* ignore invalid selector */ }
  }
  return null;
}

const SHOT = (n) => path.join(ASSETS, n);

/** Deep-walk an object: every leaf must be a finite number. */
function allLeavesNumbers(o, prefix = "") {
  const bad = [];
  for (const [k, v] of Object.entries(o || {})) {
    const p = prefix ? `${prefix}.${k}` : k;
    if (typeof v === "number") {
      if (!Number.isFinite(v)) bad.push(`${p}=${v}`);
    } else if (v !== null && typeof v === "object") {
      bad.push(...allLeavesNumbers(v, p));
    } else {
      bad.push(`${p}=${JSON.stringify(v)} (${typeof v})`);
    }
  }
  return bad;
}

/* ------------------------------------------------------------------ */
/* Shared run state                                                    */
/* ------------------------------------------------------------------ */

const state = {
  floodRelief: null, // seeded urgent campaign row from the API
  target: null, // non-urgent campaign used for the admin-toggle cycle
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

  /* ---------------- a. Public campaigns API — seeded urgent campaign ---------------- */
  await step("a. GET /api/campaigns -> flood-relief exists, urgent=true, featured=true, ACTIVE", async () => {
    const rows = await getPublicCampaigns();
    const flood = rows.find((c) => c.slug === URGENT_SLUG);
    assert(flood, `no campaign with slug "${URGENT_SLUG}" in public /api/campaigns (${rows.length} rows) — run "bun run db:seed"`);
    assert(flood.urgent === true, `flood-relief urgent expected true, got ${JSON.stringify(flood.urgent)}`);
    assert(flood.featured === true, `flood-relief featured expected true, got ${JSON.stringify(flood.featured)}`);
    assert(flood.status === "ACTIVE", `flood-relief status expected ACTIVE, got ${flood.status}`);
    assert(String(flood.title || "").includes(URGENT_TITLE_PART), `flood-relief title unexpected: "${flood.title}"`);
    state.floodRelief = flood;

    // Pick the non-urgent toggle target (the seeded anti-drug campaign).
    const target =
      rows.find((c) => c.slug === "anti-drug" && c.urgent !== true && c.status === "ACTIVE") ||
      rows.find((c) => c.slug !== URGENT_SLUG && c.urgent !== true && c.status === "ACTIVE");
    assert(target, "no non-urgent ACTIVE campaign found to exercise the admin toggles");
    state.target = {
      id: target.id,
      slug: target.slug,
      title: target.title,
      urgentInitial: Boolean(target.urgent),
      featuredInitial: Boolean(target.featured),
    };
    return `"${flood.title}" ok · toggle target "${target.title}" (urgent=${state.target.urgentInitial}, featured=${state.target.featuredInitial})`;
  });

  /* ---------------- b. HOME (anonymous) — urgent appeals strip ---------------- */
  await step("b. #/ anonymous -> 'Urgent appeals' strip with flood-relief card + Donate now CTA + Urgent badges", async () => {
    await page.goto(`${BASE}/#/`, { waitUntil: "domcontentloaded" });
    const strip = page.locator('section[aria-label="Urgent appeals"]');
    await strip.waitFor({ state: "visible", timeout: 30000 });
    const stripText = (await strip.innerText()) || "";
    assert(
      stripText.includes(URGENT_TITLE_PART) && stripText.includes("North Bengaluru"),
      `urgent strip does not mention the flood-relief campaign title — got: "${stripText.slice(0, 200)}"`
    );
    const cta = strip.locator('a[href="#/campaigns/flood-relief"]').filter({ hasText: "Donate now" });
    await cta.waitFor({ state: "visible", timeout: 10000 });
    const ctaHref = await cta.first().getAttribute("href");
    assert(ctaHref === "#/campaigns/flood-relief", `Donate now CTA href expected #/campaigns/flood-relief, got "${ctaHref}"`);
    // Featured campaign cards render an exact "Urgent" badge where urgent.
    await sleep(800); // featured section hydrates with the same campaigns fetch
    const badges = await page.getByText("Urgent", { exact: true }).count();
    assert(badges >= 1, `expected >=1 exact "Urgent" badge on home featured cards, found ${badges}`);
    await page.screenshot({ path: SHOT("01-home-urgent-strip.png"), fullPage: true });
    return `strip rendered; ${badges} "Urgent" badge(s) on cards`;
  });

  /* ---------------- c. CAMPAIGNS LIST — badge, filter, default sort ---------------- */
  await step("c1. #/campaigns -> flood-relief card shows an exact 'Urgent' badge", async () => {
    await page.goto(`${BASE}/#/campaigns`, { waitUntil: "domcontentloaded" });
    const floodCard = await firstExisting([
      page.locator('a[href="#/campaigns/flood-relief"]').locator("xpath=ancestor::article | ancestor::li | ancestor::div[contains(@class,'card')]").first(),
      page.locator('a[href="#/campaigns/flood-relief"]').first(),
    ]);
    assert(floodCard, "no card/link for #/campaigns/flood-relief on the campaigns list");
    const card = page.locator("article, li, div").filter({ has: page.locator('a[href="#/campaigns/flood-relief"]') }).first();
    const badge = card.getByText("Urgent", { exact: true }).first();
    await badge.waitFor({ state: "visible", timeout: 15000 });
    await page.screenshot({ path: SHOT("02-campaigns-list-urgent.png"), fullPage: true });
  });

  await step("c2. default 'Featured' sort puts flood-relief above non-urgent campaigns", async () => {
    // Fresh load so the default sort applies (default SortKey = "featured" = urgent first).
    await page.goto(`${BASE}/#/campaigns`, { waitUntil: "domcontentloaded" });
    await page.locator('main a[href^="#/campaigns/"]').first().waitFor({ state: "visible", timeout: 30000 });
    const hrefs = await page.locator('main a[href^="#/campaigns/"]').evaluateAll((els) => els.map((e) => e.getAttribute("href")));
    const floodIdx = hrefs.indexOf("#/campaigns/flood-relief");
    assert(floodIdx !== -1, "flood-relief card not found in the sorted list");
    const nonUrgentIdx = hrefs.findIndex((h, i) => h !== "#/campaigns/flood-relief" && i > floodIdx);
    assert(floodIdx === 0 || nonUrgentIdx > floodIdx, `flood-relief at index ${floodIdx} but a non-urgent campaign appears above it (hrefs[0..5]=${hrefs.slice(0, 6).join(", ")})`);
    return `flood-relief at position ${floodIdx + 1} of ${hrefs.length}`;
  });

  await step("c3. 'Urgent' status filter narrows the list to flood-relief", async () => {
    await page.getByLabel("Filter by status").click();
    await page.getByRole("option", { name: "Urgent", exact: true }).click();
    await sleep(600); // re-render
    const floodLink = page.locator('main a[href="#/campaigns/flood-relief"]');
    await floodLink.first().waitFor({ state: "visible", timeout: 15000 });
    const otherCards = await page.locator('main a[href^="#/campaigns/"]').evaluateAll((els) =>
      els.map((e) => e.getAttribute("href")).filter((h) => h !== "#/campaigns/flood-relief")
    );
    assert(otherCards.length === 0, `urgent filter should narrow to flood-relief only, still showing ${otherCards.slice(0, 4).join(", ")}`);
    await page.screenshot({ path: SHOT("03-campaigns-list-urgent-filtered.png"), fullPage: true });
    // reset filter for later steps
    await page.getByLabel("Filter by status").click();
    await page.getByRole("option", { name: "All statuses" }).click();
    await sleep(400);
  });

  /* ---------------- d. CAMPAIGN DETAIL — no "Programme not found" regression ---------------- */
  await step("d. #/campaigns/flood-relief -> renders title + 'Urgent appeal' pill, NOT 'Programme not found'", async () => {
    await page.goto(`${BASE}/#/campaigns/flood-relief`, { waitUntil: "domcontentloaded" });
    // Give the detail fetch a fair chance before judging either way.
    await sleep(2500);
    const notFoundCount = await page.getByText("Programme not found").count();
    assert(
      notFoundCount === 0,
      'REGRESSION: campaign detail shows "Programme not found" for an existing ACTIVE campaign (src/components/public/campaign-detail.tsx slug lookup)'
    );
    const title = page.getByText(URGENT_TITLE_PART, { exact: false }).first();
    await title.waitFor({ state: "visible", timeout: 20000 });
    const pill = page.getByText("Urgent appeal", { exact: true }).first();
    await pill.waitFor({ state: "visible", timeout: 15000 });
    await page.screenshot({ path: SHOT("04-campaign-detail-flood-relief.png"), fullPage: true });
  });

  /* ---------------- e. ADMIN TOGGLES (UI) ---------------- */
  await step("e0. admin UI login -> uar_token stored", async () => {
    await page.goto(`${BASE}/#/login`, { waitUntil: "domcontentloaded" });
    const email = page.locator('input[type="email"]').first();
    await email.waitFor({ state: "visible", timeout: 30000 });
    await email.fill(ADMIN.email);
    await page.locator("#l-password").fill(ADMIN.password);
    await page.getByRole("button", { name: /sign in/i }).first().click();
    await page.waitForFunction(() => !!localStorage.getItem("uar_token"), null, { timeout: 30000 });
    await page.waitForURL(/#\/admin/, { timeout: 30000 });
    adminToken = await page.evaluate(() => localStorage.getItem("uar_token"));
    assert(!!adminToken, "uar_token missing from localStorage after admin login");
  });

  /** Open the row menu of the toggle target and click one of its flag items. */
  async function clickFlagMenuItem(label) {
    const searchBox = page.getByPlaceholder("Search title, tagline, place…");
    if ((await searchBox.count()) > 0) {
      await searchBox.first().fill("Sankalp");
      await sleep(800); // 300ms debounce + refetch-free client filter
    }
    const card = await firstExisting([
      page.locator("article").filter({ hasText: state.target.title }),
      page.locator("tr").filter({ hasText: state.target.title }),
      page.locator("li").filter({ hasText: state.target.title }),
    ]);
    assert(card, `row/card for "${state.target.title}" not found on #/admin/campaigns`);
    const actions = card
      .getByLabel(`Actions for campaign ${state.target.title}`)
      .first();
    await actions.waitFor({ state: "visible", timeout: 10000 });
    await actions.click();
    const item = page.getByRole("menuitemcheckbox", { name: label }).first();
    await item.waitFor({ state: "visible", timeout: 8000 });
    await item.click();
    return card;
  }

  async function expectToast(re) {
    const toast = page.locator("[data-sonner-toast]").filter({ hasText: re }).first();
    await toast.waitFor({ state: "visible", timeout: 8000 });
  }

  async function apiFlag(slug, field) {
    const rows = await getPublicCampaigns();
    const row = rows.find((c) => c.slug === slug);
    assert(row, `campaign "${slug}" disappeared from /api/campaigns during toggle test`);
    return Boolean(row[field]);
  }

  await step("e1. 'Mark urgent' -> toast + row 'Urgent' badge + API urgent=true", async () => {
    await page.evaluate(() => { window.location.hash = "/admin/campaigns"; });
    await page.waitForURL(/#\/admin\/campaigns/, { timeout: 30000 });
    await sleep(1500); // initial load
    const card = await clickFlagMenuItem("Mark urgent");
    await expectToast(/Marked urgent/);
    // Row badge appears after the view refreshes.
    await card.getByText("Urgent", { exact: true }).first().waitFor({ state: "visible", timeout: 15000 });
    assert((await apiFlag(state.target.slug, "urgent")) === true, "API still reports urgent=false after 'Mark urgent'");
    await page.screenshot({ path: SHOT("05-admin-campaign-marked-urgent.png"), fullPage: true });
  });

  await step("e2. 'Clear urgent flag' -> toast + badge gone + API urgent=false", async () => {
    const card = await clickFlagMenuItem("Clear urgent flag");
    await expectToast(/Urgent flag cleared/);
    await card.getByText("Urgent", { exact: true }).first().waitFor({ state: "detached", timeout: 15000 }).catch(async () => {
      // The row may have re-rendered — re-scope and require absence.
      const still = await page.locator("article, tr").filter({ hasText: state.target.title }).getByText("Urgent", { exact: true }).count();
      assert(still === 0, "row still shows an 'Urgent' badge after clearing the flag");
    });
    assert((await apiFlag(state.target.slug, "urgent")) === false, "API still reports urgent=true after 'Clear urgent flag'");
  });

  await step("e3. 'Remove from home page' -> toast + API featured=false", async () => {
    const card = await clickFlagMenuItem("Remove from home page");
    await expectToast(/Removed from home page/);
    await card.getByText("Featured", { exact: true }).first().waitFor({ state: "detached", timeout: 15000 }).catch(async () => {
      const still = await page.locator("article, tr").filter({ hasText: state.target.title }).getByText("Featured", { exact: true }).count();
      assert(still === 0, "row still shows a 'Featured' badge after removing from home page");
    });
    assert((await apiFlag(state.target.slug, "featured")) === false, "API still reports featured=true after 'Remove from home page'");
  });

  await step("e4. 'Feature on home page' -> toast + API featured=true (reverted)", async () => {
    const card = await clickFlagMenuItem("Feature on home page");
    await expectToast(/Now featured on the home page/);
    await card.getByText("Featured", { exact: true }).first().waitFor({ state: "visible", timeout: 15000 });
    assert((await apiFlag(state.target.slug, "featured")) === true, "API still reports featured=false after re-featuring");
    await page.screenshot({ path: SHOT("06-admin-campaign-featured.png"), fullPage: true });
  });

  /* ---------------- f. REPORTS VIEW — Health Programme section ---------------- */
  await step("f1. #/admin/reports -> Programme impact tab renders 'Health Programme' with camp KPIs", async () => {
    await page.evaluate(() => { window.location.hash = "/admin/reports"; });
    await page.waitForURL(/#\/admin\/reports/, { timeout: 30000 });
    await sleep(1500); // register tab data loads first
    await page.getByRole("tab", { name: /programme impact/i }).click();
    const healthCard = page.getByText("Health Programme", { exact: true }).first();
    await healthCard.waitFor({ state: "visible", timeout: 20000 });
    await sleep(1200); // section data
    // StatCard labels render with CSS text-transform: uppercase — innerText
    // returns the TRANSFORMED text, so all label matching is case-insensitive.
    const text = ((await page.locator("main").innerText()) || "").toLowerCase();
    for (const label of [
      "medical camps",
      "camp registrations",
      "beneficiaries attended",
      "consultations",
      "prescriptions issued",
      "lab orders verified",
      "pending follow-ups",
    ]) {
      assert(text.includes(label), `Health Programme section missing "${label}" KPI card`);
    }
    const live = text.match(/(\d+)\s+live\s*·/);
    assert(live && Number(live[1]) >= 1, `expected >=1 live camp in the Medical camps KPI hint, got "${live ? live[1] : "no match"}"`);
    assert(text.includes("camp pipeline"), "missing Camp pipeline (camp status) breakdown");
    await page.screenshot({ path: SHOT("07-admin-reports-health.png"), fullPage: true });
  });

  await step("f2. Health Programme: attendance funnel, prescriptions, lab orders, referrals, follow-ups (overdue highlighted), finances", async () => {
    const funnel = page.locator('[aria-label^="Attendance funnel:"]');
    assert((await funnel.count()) >= 1, 'no [aria-label^="Attendance funnel:"] element in the Health Programme section');
    const text = ((await page.locator("main").innerText()) || "").toLowerCase();
    for (const label of ["continuity of care", "healthcare donations", "camp expenses", "net health funding"]) {
      assert(text.includes(label), `Health Programme section missing "${label}"`);
    }
    const overdue = text.match(/(\d+)\s+overdue/);
    assert(overdue, "no 'N overdue' hint found for follow-ups");
    const overdueCount = Number(overdue[1]);
    assert(overdueCount >= 1, `expected >=1 overdue follow-up highlighted (seeded), got ${overdueCount}`);
    if (overdueCount > 0) {
      const overdueSpan = page.locator("span").filter({ hasText: new RegExp(`^\\s*${overdueCount}\\s+overdue\\s*$`, "i") }).first();
      const cls = (await overdueSpan.getAttribute("class").catch(() => "")) || "";
      assert(/rose|red/.test(cls), `overdue follow-up count (${overdueCount}) is not visually highlighted — class "${cls}"`);
    }
  });

  await step("f3. FY selector switch does not crash (prev FY -> back to current)", async () => {
    const errorsBefore = pageErrors.length;
    await page.getByLabel("Financial year").click();
    await page.getByRole("option", { name: fyLabel(FY_PREV), exact: true }).click();
    await sleep(2500); // refetch for the previous FY window
    const healthCard = page.getByText("Health Programme", { exact: true }).first();
    await healthCard.waitFor({ state: "visible", timeout: 20000 });
    const body = (await page.locator("body").innerText()) || "";
    assert(!/application error/i.test(body), "FY switch rendered an application error");
    const newErrors = pageErrors.slice(errorsBefore);
    assert(newErrors.length === 0, `pageerror(s) while switching FY: ${newErrors.map((e) => e.text).join(" | ")}`);
    await page.screenshot({ path: SHOT("08-admin-reports-health-prev-fy.png"), fullPage: true });
    // back to current FY
    await page.getByLabel("Financial year").click();
    await page.getByRole("option", { name: fyLabel(FY_CURRENT), exact: true }).click();
    await sleep(2000);
    await healthCard.waitFor({ state: "visible", timeout: 20000 });
  });

  await browser.close();
}

/* ---------------- g. /api/reports programmes.health shape ---------------- */
await step("g. GET /api/reports?fy=<current> (admin) -> programmes.health contracted shape, all numbers", async () => {
  const token = await ensureAdminToken();
  const r = await api("GET", `/api/reports?fy=${FY_CURRENT}`, undefined, token);
  expectStatus(r, 200, "GET /api/reports");
  assert(r.data?.programmes?.health, "response.programmes.health missing from /api/reports");
  const health = r.data.programmes.health;
  for (const key of ["camps", "attendance", "prescriptions", "followUps", "donations", "expenses"]) {
    assert(health[key] && typeof health[key] === "object", `programmes.health.${key} missing or not an object`);
  }
  assert(typeof health.camps.total === "number", "programmes.health.camps.total not a number");
  assert(typeof health.attendance.checkedIn === "number", "programmes.health.attendance.checkedIn not a number");
  assert(typeof health.prescriptions.total === "number", "programmes.health.prescriptions.total not a number");
  assert(typeof health.followUps.overdue === "number", "programmes.health.followUps.overdue not a number");
  assert(typeof health.donations.amount === "number", "programmes.health.donations.amount not a number");
  assert(typeof health.expenses.amount === "number", "programmes.health.expenses.amount not a number");
  const bad = allLeavesNumbers(health);
  assert(bad.length === 0, `non-numeric leaves in programmes.health: ${bad.slice(0, 5).join(", ")}`);
});

/* ------------------------------------------------------------------ */
/* h. Regression (shell steps — outside browser context)               */
/* ------------------------------------------------------------------ */

function runCmd(cmd, timeoutMs) {
  try {
    const out = execSync(cmd, { cwd: PROJECT, timeout: timeoutMs, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] });
    return { code: 0, out: (out || "").slice(-8000) };
  } catch (e) {
    return { code: e.status ?? 1, out: `${e.stdout || ""}${e.stderr || ""}`.slice(-8000) };
  }
}

await step("h1. bunx tsc --noEmit -> 0 errors", async () => {
  const r = runCmd("bunx tsc --noEmit", 300000);
  assert(r.code === 0, `tsc failed (exit ${r.code}):\n${r.out.slice(-600)}`);
});

await step("h2. bun run lint -> 0 problems", async () => {
  const r = runCmd("bun run lint", 300000);
  assert(r.code === 0, `lint failed (exit ${r.code}):\n${r.out.slice(-600)}`);
});

await step("h3. bun scripts/verify-health.mjs -> 45/45 PASS", async () => {
  const r = runCmd("bun scripts/verify-health.mjs", 900000);
  const m = (r.out || "").match(/Checks:\s*(\d+)\/(\d+)\s+passed/);
  assert(r.code === 0, `verify-health exited ${r.code}:\n${r.out.slice(-600)}`);
  assert(m, `could not parse summary line from verify-health output:\n${r.out.slice(-600)}`);
  assert(m[1] === m[2] && m[1] === "45", `verify-health reported ${m[1]}/${m[2]} passed — require 45/45`);
});

await step("h4. bun scripts/verify-file-manager.mjs -> 9/9 PASS", async () => {
  const r = runCmd("bun scripts/verify-file-manager.mjs", 600000);
  const m = (r.out || "").match(/Checks:\s*(\d+)\/(\d+)\s+passed/);
  assert(r.code === 0, `verify-file-manager exited ${r.code}:\n${r.out.slice(-600)}`);
  assert(m, `could not parse summary line from verify-file-manager output:\n${r.out.slice(-600)}`);
  assert(m[1] === m[2] && m[1] === "9", `verify-file-manager reported ${m[1]}/${m[2]} passed — require 9/9`);
});

/* ------------------------------------------------------------------ */
/* Self-cleanup: restore pre-run flag values on the toggle target      */
/* ------------------------------------------------------------------ */

try {
  if (state.target?.id) {
    const token = await ensureAdminToken();
    const rows = await getPublicCampaigns();
    const now = rows.find((c) => c.id === state.target.id) ||
      (await api("GET", "/api/campaigns?all=1", undefined, token)).data?.find?.((c) => c.id === state.target.id);
    const urgentNow = Boolean(now?.urgent);
    const featuredNow = Boolean(now?.featured);
    const patch = {};
    if (urgentNow !== state.target.urgentInitial) patch.urgent = state.target.urgentInitial;
    if (featuredNow !== state.target.featuredInitial) patch.featured = state.target.featuredInitial;
    if (Object.keys(patch).length > 0) {
      const p = await api("PATCH", `/api/campaigns/${state.target.id}`, patch, token);
      console.log(
        `Cleanup: reverted flags on "${state.target.title}" -> urgent=${state.target.urgentInitial}, featured=${state.target.featuredInitial} (HTTP ${p.status})`
      );
    } else {
      console.log("Cleanup: flags already at pre-run values — nothing to revert.");
    }
  } else {
    console.log("Cleanup: no toggle target recorded — nothing to revert.");
  }
} catch (e) {
  console.log(`Cleanup: FAILED (non-fatal) — ${String(e?.message || e).slice(0, 200)}`);
}

/* ------------------------------------------------------------------ */
/* Summary                                                             */
/* ------------------------------------------------------------------ */

const pad = (s, n) => (s.length >= n ? s : s + " ".repeat(n - s.length));

console.log("\n" + "=".repeat(78));
console.log("UAR URGENT APPEALS / FEATURED / HEALTH REPORTS - E2E SUMMARY");
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

if (failed > 0) process.exit(1);
