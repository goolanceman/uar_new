#!/usr/bin/env node
/**
 * United Angel Reach — File Manager E2E verification harness (QA).
 *
 * Run:  node scripts/verify-file-manager.mjs
 *   or: bun  scripts/verify-file-manager.mjs
 *   or: bunx --package playwright@1.65.0 node scripts/verify-file-manager.mjs
 *
 * Requires a dev server already running (default http://localhost:3000).
 * Playwright 1.65.0 is resolved WITHOUT touching package.json: first a plain
 * import (works when installed normally / via bunx --package), then a scan of
 * the bunx global cache (dot-bun install cache).
 *
 * Exits non-zero if any assertion fails. Prints a PASS/FAIL summary table.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

/* ------------------------------------------------------------------ */
/* Config                                                              */
/* ------------------------------------------------------------------ */

const BASE = process.env.QA_BASE_URL || "http://localhost:3000";
const EMAIL = "admin@unitedangelreach.org";
const PASSWORD = "Admin@123";

const SCRIPT_DIR = path.dirname(new URL(import.meta.url).pathname);
const ASSETS = path.join(SCRIPT_DIR, "qa-file-manager-report-assets");
fs.mkdirSync(ASSETS, { recursive: true });

const TMP_PNG = "/tmp/uar-qa.png";
/** Standard 1x1 transparent PNG. */
const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64"
);

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
  const cacheRoot = path.join(home, ".bun", "install", "cache");
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
  console.error(
    "FATAL: playwright not importable. Run one of:\n" +
      "  bunx --package playwright@1.65.0 node scripts/verify-file-manager.mjs\n" +
      "  bun scripts/verify-file-manager.mjs"
  );
  process.exit(2);
}

/* ------------------------------------------------------------------ */
/* Tiny test framework                                                 */
/* ------------------------------------------------------------------ */

const results = [];
const consoleErrors = [];
const pageErrors = [];
let currentStepLabel = "setup";
let page;

/** Record one step; never throws. Screenshots the page on failure. */
async function step(label, fn) {
  currentStepLabel = label;
  const t0 = Date.now();
  process.stdout.write(`\n> ${label}\n`);
  try {
    await fn();
    results.push({ step: label, status: "PASS", detail: "", ms: Date.now() - t0 });
    console.log(`  PASS (${fmtMs(Date.now() - t0)})`);
    return true;
  } catch (e) {
    // Keep the first meaningful lines: summary + which locator/why.
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

/* Locator helper — try a list of candidate locators, return first with a match. */
async function firstExisting(locators) {
  for (const loc of locators) {
    try {
      if ((await loc.count()) > 0) return loc.first();
    } catch { /* ignore invalid selector */ }
  }
  return null;
}

async function toastTexts() {
  return page.locator("[data-sonner-toast]").allInnerTexts().catch(() => []);
}

/** Wait for a sonner toast matching regex; returns its text. */
async function waitForToast(re, timeout = 15000) {
  const t0 = Date.now();
  for (;;) {
    const texts = await toastTexts();
    const hit = texts.find((t) => re.test(t));
    if (hit) return hit;
    if (Date.now() - t0 > timeout) {
      throw new Error(`toast matching ${re} not seen in ${timeout}ms; toasts seen: ${JSON.stringify(texts)}`);
    }
    await sleep(250);
  }
}

/**
 * Open a file row's actions dropdown ("Actions for {name}" trigger) and click
 * the menu item matching actionRe. Retries: dev-server HMR remounts can close
 * menus mid-interaction while implementation agents land code.
 */
async function rowAction(row, actionRe, attempts = 3) {
  let lastErr = null;
  for (let i = 0; i < attempts; i++) {
    try {
      const trigger = await firstExisting([
        row.locator('button[aria-label*="ctions for" i]'),
        row.locator('button[aria-label*="ore" i]'),
        row.locator("button").last(),
      ]);
      assert(trigger, "row actions trigger not found");
      await trigger.click({ timeout: 8000 });
      const item = page.getByRole("menuitem", { name: actionRe }).first();
      await item.waitFor({ state: "visible", timeout: 8000 });
      await item.click({ timeout: 8000 });
      return;
    } catch (e) {
      lastErr = e;
      await page.keyboard.press("Escape").catch(() => {});
      await sleep(1200);
    }
  }
  throw lastErr;
}

/** Click with a force fallback (dev HMR remounts / animated overlays). */
async function robustClick(loc, timeout = 10000) {
  try {
    await loc.click({ timeout });
  } catch (e) {
    try {
      await loc.click({ timeout, force: true });
    } catch {
      throw e;
    }
  }
}

/* ------------------------------------------------------------------ */
/* Main                                                                */
/* ------------------------------------------------------------------ */

const pw = await loadPlaywright();
const SHOT = (n) => path.join(ASSETS, n);

const state = {
  baseName: `uar-qa-${Date.now()}`, // unique per run; upload uses {baseName}.png
  newTitle: "",
  fileId: null,
  rawUrl: null,
};

{
  /* ---------------- Browser + context ---------------- */
  const browser = await pw.chromium.launch({ headless: true });
  const context = await browser.newContext({
    baseURL: BASE,
    viewport: { width: 1440, height: 900 },
    permissions: ["clipboard-read", "clipboard-write"],
  });
  context.setDefaultTimeout(20000);
  context.setDefaultNavigationTimeout(45000);
  page = await context.newPage();
  page.setDefaultTimeout(20000);
  page.setDefaultNavigationTimeout(45000);

  page.on("console", (msg) => {
    if (msg.type() === "error") {
      consoleErrors.push({ step: currentStepLabel, text: msg.text().slice(0, 300) });
    }
  });
  page.on("pageerror", (err) => {
    pageErrors.push({ step: currentStepLabel, text: String(err).slice(0, 300) });
  });

  fs.writeFileSync(TMP_PNG, PNG_1X1);

  /* ---------------- a. Login ---------------- */
  await step("a. login as admin -> #/admin, uar_token set", async () => {
    await page.goto(`${BASE}/#/login`, { waitUntil: "domcontentloaded" });
    const email = page.locator('input[type="email"]').first();
    await email.waitFor({ state: "visible", timeout: 30000 });
    await email.fill(EMAIL);
    await page.locator("#l-password").fill(PASSWORD);
    await page.getByRole("button", { name: /sign in/i }).first().click();
    await page.waitForFunction(() => !!localStorage.getItem("uar_token"), null, { timeout: 30000 });
    await page.waitForURL(/#\/admin/, { timeout: 30000 });
  });

  /* ---------------- b. Admin files page ---------------- */
  await step("b. #/admin/files renders File Manager (header, stats, toolbar)", async () => {
    await page.evaluate(() => { window.location.hash = "/admin/files"; });
    await page.waitForURL(/#\/admin\/files/, { timeout: 30000 });
    // NOTE .first(): the admin topbar h1 may share the "File Manager" label.
    const heading = page.getByRole("heading", { name: /file manager/i }).first();
    await heading.waitFor({ state: "visible", timeout: 30000 });

    // Stat cards: StatCard renders .card-hover tiles; SectionCard a shadcn
    // Card (data-slot="card"). Expect 4 stat tiles + toolbar card.
    const nCards = await page.locator('.card-hover, [data-slot="card"]').count();
    assert(nCards >= 2, `expected >=2 stat cards, found ${nCards}`);

    // Toolbar: search input + upload control.
    const search = await firstExisting([
      page.locator('[aria-label="Search files"]'),
      page.locator('input[type="search"]'),
      page.locator('input[placeholder*="search" i]'),
    ]);
    assert(search, "toolbar search input not found");
    const uploadBtn = await firstExisting([
      page.getByRole("button", { name: /upload files/i }),
      page.getByRole("button", { name: /upload/i }),
    ]);
    assert(uploadBtn, "toolbar upload button not found");

    await page.screenshot({ path: SHOT("01-admin-files.png"), fullPage: true });
  });

  /* ---------------- c. Upload ---------------- */
  await step("c. upload 1x1 PNG via UI -> toast + row visible", async () => {
    state.fileName = `${state.baseName}.png`;
    const uploadBtn = await firstExisting([
      page.getByRole("button", { name: /upload files/i }),
      page.getByRole("button", { name: /upload/i }),
    ]);
    assert(uploadBtn, "upload control not found in toolbar");
    await uploadBtn.click();

    const dlg = page.locator('[role="dialog"]:visible').last();
    await dlg.waitFor({ state: "visible", timeout: 15000 });

    const fileInput = await firstExisting([
      dlg.locator('input[type="file"]'),
      page.locator('[role="dialog"] input[type="file"]'),
    ]);
    assert(fileInput, "no <input type=file> found in upload sheet");
    await fileInput.setInputFiles({
      name: state.fileName,
      mimeType: "image/png",
      buffer: PNG_1X1,
    });
    // Staged list should show the chosen file.
    const staged = dlg.getByText(state.fileName).first();
    await staged.waitFor({ state: "visible", timeout: 10000 }).catch(() => {});

    const submit = await firstExisting([
      dlg.getByRole("button", { name: /^upload\b/i }),
      dlg.locator('button[type="submit"]'),
    ]);
    assert(submit, "upload submit button not found in sheet");
    await submit.click();

    await waitForToast(/uploaded/i, 25000);
    const listed = await firstExisting([
      page.locator("tr").filter({ hasText: state.fileName }),
      page.locator('[data-slot="card"]').filter({ hasText: state.fileName }),
      page.locator("main").getByText(state.fileName),
    ]);
    assert(listed, `uploaded file "${state.fileName}" not visible in list`);
  });

  /* ---------------- d. Search listing ---------------- */
  await step("d. toolbar search finds the uploaded file", async () => {
    const search = await firstExisting([
      page.locator('[aria-label="Search files"]'),
      page.locator('input[type="search"]'),
      page.locator('input[placeholder*="search" i]'),
    ]);
    assert(search, "toolbar search input not found");
    await search.fill(state.baseName);
    await sleep(1000); // 300ms debounce + fetch + render
    const row = await firstExisting([
      page.locator("tr").filter({ hasText: state.fileName }),
      page.locator('[data-slot="card"]').filter({ hasText: state.fileName }),
    ]);
    assert(row, `no row/card matched "${state.baseName}" after search`);
    await search.fill("");
    await sleep(800);
  });

  /* ---------------- e. Copy URL + Download link ---------------- */
  await step("e. Copy URL action works; Download link exists", async () => {
    const row = await firstExisting([
      page.locator("tr").filter({ hasText: state.fileName }),
      page.locator('[data-slot="card"]').filter({ hasText: state.fileName }),
    ]);
    assert(row, `row for "${state.fileName}" not found`);

    // Capture the raw URL early from the row thumbnail img src.
    const thumb = row.locator('img[src*="/api/files/"]').first();
    if (await thumb.count()) {
      const src = await thumb.getAttribute("src");
      const m = src && src.match(/\/api\/files\/([^/\s?#]+)/);
      if (m) {
        state.fileId = m[1];
        state.rawUrl = `${BASE}/api/files/${m[1]}/file`;
      }
    }

    // Open actions menu once: verify Download exists while the menu is open,
    // then click Copy URL (clicking it closes the menu and detaches items).
    // Retried: HMR remounts while implementation agents land code can close
    // the menu mid-interaction.
    let downloadExists = false;
    let lastErr = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const freshRow = page
          .locator('tr, [data-slot="card"]')
          .filter({ hasText: state.fileName })
          .first();
        await freshRow.waitFor({ state: "visible", timeout: 15000 });
        const trigger = await firstExisting([
          freshRow.locator('button[aria-label*="ctions for" i]'),
          freshRow.locator("button").last(),
        ]);
        assert(trigger, "row actions trigger not found");
        await robustClick(trigger);
        const downloadItem = page.getByRole("menuitem", { name: /download/i }).first();
        await downloadItem.waitFor({ state: "visible", timeout: 10000 });
        downloadExists = (await downloadItem.count()) > 0;
        const copyItem = page.getByRole("menuitem", { name: /copy url/i }).first();
        assert((await copyItem.count()) > 0, '"Copy URL" menu item not found');
        await robustClick(copyItem);
        await waitForToast(/copied/i, 15000);
        lastErr = null;
        break;
      } catch (e) {
        lastErr = e;
        await page.keyboard.press("Escape").catch(() => {});
        await sleep(1200);
      }
    }
    if (lastErr) throw lastErr;

    let clip = null;
    try {
      clip = await page.evaluate(() => navigator.clipboard.readText());
    } catch { /* clipboard read unavailable -> toast is the contract */ }
    if (clip && clip.length > 0) {
      assert(/\/api\/files\//.test(clip), `clipboard "${clip.slice(0, 120)}" is not a /api/files/ URL`);
      const m = clip.match(/\/api\/files\/([^/\s?#]+)/);
      if (m && !state.fileId) state.fileId = m[1];
    }

    // Download: verified while the menu was open (spec: "Download link exists").
    assert(downloadExists, "download link/control not found in actions menu");
    await page.keyboard.press("Escape").catch(() => {});
  });

  /* ---------------- f. Raw serve: /api/files/{id}/file ---------------- */
  await step("f. raw serve: /api/files/{id}/file -> 200 image/png, public (no auth)", async () => {
    const token = await page.evaluate(() => localStorage.getItem("uar_token"));
    if (!state.fileId) {
      const res = await fetch(`${BASE}/api/files?q=${encodeURIComponent(state.baseName)}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      assert(res.ok, `GET /api/files?q=... failed: HTTP ${res.status}`);
      const data = await res.json().catch(() => null);
      const items = Array.isArray(data) ? data : data?.items || [];
      const hit = items.find((f) => JSON.stringify(f).includes(state.baseName));
      assert(hit, "file id not resolvable (row media + GET /api/files both failed)");
      state.fileId = hit.id;
    }
    state.rawUrl = `${BASE}/api/files/${state.fileId}/file`;

    const authed = await fetch(state.rawUrl, { headers: { Authorization: `Bearer ${token}` } });
    assert(authed.status === 200, `authed fetch expected 200, got ${authed.status}`);
    const ctA = authed.headers.get("content-type") || "";
    assert(/image\/png/i.test(ctA), `authed content-type expected image/png, got "${ctA}"`);

    const anon = await fetch(state.rawUrl); // NO auth headers — must still be public
    assert(anon.status === 200, `public fetch expected 200, got ${anon.status}`);
    const ctB = anon.headers.get("content-type") || "";
    assert(/image\/png/i.test(ctB), `public content-type expected image/png, got "${ctB}"`);
  });

  /* ---------------- g. Rename via Edit FormSheet ---------------- */
  await step("g. rename via Edit FormSheet -> title updated", async () => {
    // Full edit flow with retries (HMR remounts can close sheets mid-flow).
    let lastErr = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const freshRow = page
          .locator('tr, [data-slot="card"]')
          .filter({ hasText: state.fileName })
          .first();
        await freshRow.waitFor({ state: "visible", timeout: 15000 });
        const directEdit = await firstExisting([
          freshRow.locator('[aria-label="Edit ' + state.fileName + '"]'),
        ]);
        if (directEdit) {
          await robustClick(directEdit);
        } else {
          await rowAction(freshRow, /^edit\b/i);
        }

        const dlg = page.locator('[role="dialog"]:visible').last();
        await dlg.waitFor({ state: "visible", timeout: 15000 });
        state.newTitle = `${state.baseName} RENAMED`;
        const titleField = await firstExisting([
          dlg.getByLabel(/^title$/i),
          dlg.getByLabel(/title/i),
        ]);
        assert(titleField, "title field not found in edit sheet");
        await titleField.fill(state.newTitle);
        const save = await firstExisting([
          dlg.getByRole("button", { name: /save changes|save/i }),
          dlg.locator('button[type="submit"]'),
        ]);
        assert(save, "save button not found in edit sheet");
        await robustClick(save);
        await waitForToast(/updated|saved/i, 25000);

        const updated = await firstExisting([
          page.locator("tr").filter({ hasText: state.newTitle }),
          page.locator('[data-slot="card"]').filter({ hasText: state.newTitle }),
          page.locator("main").getByText(state.newTitle),
        ]);
        assert(updated, `renamed title "${state.newTitle}" not visible in list`);
        lastErr = null;
        break;
      } catch (e) {
        lastErr = e;
        await page.keyboard.press("Escape").catch(() => {});
        await sleep(1500);
      }
    }
    if (lastErr) throw lastErr;
    await page.keyboard.press("Escape").catch(() => {});
  });

  /* ---------------- h. Delete via ConfirmDialog ---------------- */
  await step("h. delete via ConfirmDialog -> gone from list, raw URL -> 404", async () => {
    const row = await firstExisting([
      page.locator("tr").filter({ hasText: state.fileName }),
      page.locator('[data-slot="card"]').filter({ hasText: state.fileName }),
    ]);
    assert(row, `row for "${state.fileName}" not found`);

    let lastErr = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const freshRow = page
          .locator('tr, [data-slot="card"]')
          .filter({ hasText: state.fileName })
          .first();
        await freshRow.waitFor({ state: "visible", timeout: 15000 });
        const directDel = await firstExisting([
          freshRow.locator('[aria-label="Delete ' + state.fileName + '"]'),
        ]);
        if (directDel) {
          await robustClick(directDel);
        } else {
          await rowAction(freshRow, /delete/i);
        }

        const confirmDialog = page.locator('[role="alertdialog"]').last();
        await confirmDialog.waitFor({ state: "visible", timeout: 15000 });
        const confirmBtn = await firstExisting([
          confirmDialog.getByRole("button", { name: /delete file|delete|confirm|remove/i }),
          confirmDialog.locator("button").last(),
        ]);
        assert(confirmBtn, "confirm button not found in ConfirmDialog");
        await robustClick(confirmBtn);
        await waitForToast(/deleted|removed/i, 25000);
        lastErr = null;
        break;
      } catch (e) {
        lastErr = e;
        await page.keyboard.press("Escape").catch(() => {});
        await sleep(1500);
      }
    }
    if (lastErr) throw lastErr;

    // Gone from the list (scoped to main so sonner toasts don't count).
    await sleep(1500);
    const stillListed = await page
      .locator("main")
      .locator(`text=${state.fileName}`)
      .count();
    assert(stillListed === 0, `file "${state.fileName}" still present in list after delete`);

    // Raw URL must now 404.
    assert(state.rawUrl, "raw URL unknown — cannot verify 404");
    const res = await fetch(state.rawUrl);
    assert(res.status === 404, `raw URL after delete expected 404, got ${res.status}`);
  });

  /* ---------------- i. File Picker integration in campaigns ---------------- */
  await step("i. File Picker integration on campaign form -> URL contains /api/files/", async () => {
    await page.evaluate(() => { window.location.hash = "/admin/campaigns"; });
    await page.waitForURL(/#\/admin\/campaigns/, { timeout: 30000 });
    const campaignsHeading = page.getByRole("heading", { name: /campaigns/i }).first();
    await campaignsHeading.waitFor({ state: "visible", timeout: 30000 });

    const addBtn = await firstExisting([
      page.getByRole("button", { name: /add campaign|new campaign/i }),
      page.getByRole("button", { name: /^add$/i }),
    ]);
    assert(addBtn, "add-campaign button not found");
    await addBtn.click();

    const sheet = page.locator('[role="dialog"]:visible').last();
    await sheet.waitFor({ state: "visible", timeout: 20000 });

    // Picker buttons live next to the Gallery / cover field ("Media & SEO").
    const pickerBtn = await firstExisting([
      sheet.getByRole("button", { name: /add gallery photos/i }),
      sheet.getByRole("button", { name: /set cover photo/i }),
      sheet.getByRole("button", { name: /file picker|pick file|choose file|file library|media library|pick image|choose image|from library|browse file/i }),
      sheet.locator('button[aria-label*="picker" i]'),
      sheet.locator('button[aria-label*="library" i]'),
    ]);
    assert(
      pickerBtn,
      "File Picker button not found next to Cover Image/Gallery field. Buttons in sheet: " +
        (await sheet
          .getByRole("button")
          .allInnerTexts()
          .catch(() => []))
          .map((s) => s.trim())
          .filter(Boolean)
          .slice(0, 30)
          .join(" | ")
    );
    await pickerBtn.click();
    await sleep(700);

    const picker = page.locator('[role="dialog"]:visible').last();
    await picker.waitFor({ state: "visible", timeout: 15000 });

    // Library tab first; if empty, upload through the picker's Upload tab.
    const pickerName = `${state.baseName}-picker.png`;
    const hasLibImage = (await picker.locator('img[src*="/api/files/"]').count()) > 0;
    if (!hasLibImage) {
      const uploadTab = await firstExisting([
        picker.getByRole("tab", { name: /upload/i }),
        picker.getByRole("button", { name: /upload a file|upload/i }),
      ]);
      assert(uploadTab, "picker library is empty and no Upload tab found");
      await uploadTab.click();
      await sleep(500);
      const pInput = await firstExisting([
        picker.locator('input[type="file"]'),
        page.locator('[role="dialog"] input[type="file"]'),
      ]);
      assert(pInput, "no file input inside picker Upload tab");
      await pInput.setInputFiles({
        name: pickerName,
        mimeType: "image/png",
        buffer: PNG_1X1,
      });
      await sleep(400);
      const pSubmit = await firstExisting([
        picker.getByRole("button", { name: /^upload \d+ file/i }),
        picker.getByRole("button", { name: /^(upload|save|add)\b/i }),
      ]);
      assert(pSubmit, "picker upload submit button not found");
      await pSubmit.click();
      await waitForToast(/uploaded|success/i, 25000);
      const libTab = await firstExisting([
        picker.getByRole("tab", { name: /library/i }),
      ]);
      if (libTab) { await libTab.click(); await sleep(700); }
    }

    // Select the image in the library grid, then confirm with "Use file".
    // Retry until the item reports aria-pressed=true (toasts can overlay the
    // grid right after an upload; HMR remounts can reset selection).
    let selected = false;
    for (let attempt = 0; attempt < 4 && !selected; attempt++) {
      const itemBtn = await firstExisting([
        picker.locator('button[aria-pressed="false"]').filter({ hasText: state.baseName }),
        picker.locator('button[aria-pressed="false"]').first(),
        picker.locator('button[aria-pressed]').first(),
        picker.locator('img[src*="/api/files/"]').first(),
      ]);
      assert(itemBtn, "no selectable item found in picker library");
      await itemBtn.scrollIntoViewIfNeeded().catch(() => {});
      await robustClick(itemBtn);
      await sleep(600);
      selected = (await picker.locator('button[aria-pressed="true"]').count()) > 0;
    }
    assert(selected, "could not select a library item (aria-pressed never true)");

    const useBtn = await firstExisting([
      picker.getByRole("button", { name: /^use file$|use \d+ files?/i }),
      picker.getByRole("button", { name: /use|select|insert/i }).last(),
    ]);
    assert(useBtn, '"Use file" confirm button not found in picker');
    await useBtn.waitFor({ state: "visible", timeout: 10000 });
    await robustClick(useBtn);
    await sleep(700);

    const ok = await page.evaluate(() => {
      const vals = [...document.querySelectorAll("input, textarea")].map((el) => el.value || "").join(" ");
      const srcs = [...document.querySelectorAll("img[src]")].map((el) => el.getAttribute("src") || "").join(" ");
      return (vals + " " + srcs).includes("/api/files/");
    });
    assert(ok, "after picking, no field/preview value contains /api/files/");
    await page.screenshot({ path: SHOT("02-campaign-file-picker.png"), fullPage: true });
    await page.keyboard.press("Escape").catch(() => {});
  });

  await browser.close();
}

/* ------------------------------------------------------------------ */
/* Summary                                                             */
/* ------------------------------------------------------------------ */

const pad = (s, n) => (s.length >= n ? s : s + " ".repeat(n - s.length));

console.log("\n" + "=".repeat(78));
console.log("UAR FILE MANAGER - E2E SUMMARY");
console.log("=".repeat(78));
console.log(`${pad("STEP", 62)}${pad("RESULT", 8)}TIME`);
console.log("-".repeat(78));
for (const r of results) {
  const detail = r.status === "FAIL" ? `  -> ${r.detail}` : "";
  console.log(`${pad(r.step.slice(0, 60), 62)}${pad(r.status, 8)}${fmtMs(r.ms)}${detail}`);
}
console.log("-".repeat(78));
const failed = results.filter((r) => r.status === "FAIL").length;
console.log(`Checks: ${results.length - failed}/${results.length} passed`);
console.log(`Console errors: ${consoleErrors.length}  |  Page (uncaught) errors: ${pageErrors.length}`);
for (const e of consoleErrors) console.log(`  [console.error][${e.step}] ${e.text}`);
for (const e of pageErrors) console.log(`  [pageerror][${e.step}] ${e.text}`);
console.log(`Assets: ${ASSETS}`);
console.log("=".repeat(78));
console.log(failed === 0 ? "OVERALL: PASS" : `OVERALL: FAIL (${failed} failed check${failed > 1 ? "s" : ""})`);

if (failed > 0) process.exit(1);
