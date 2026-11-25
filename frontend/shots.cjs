/* Screenshot the admin pages with system Chrome (no browser download). */
const { chromium } = require("playwright");

const BASE = "http://localhost:3000";
const PAGES = [
  ["masters", "#/admin/masters"],
  ["mobile-feed", "#/admin/mobile-feed"],
  ["mobile-stories-reels", "#/admin/mobile-stories-reels"],
  ["mobile-rooms", "#/admin/mobile-rooms"],
  ["mobile-verifications", "#/admin/mobile-verifications"],
  ["mobile-audio-spaces", "#/admin/mobile-audio-spaces"],
  ["mobile-notifications-faqs", "#/admin/mobile-notifications-faqs"],
  ["mobile-settings", "#/admin/mobile-settings"],
];

(async () => {
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

  // Login once — the app stores the JWT in localStorage
  await page.goto(`${BASE}/#/login`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1500);

  const emailInput = page.locator('input[type="email"], input[placeholder*="mail" i]').first();
  if (await emailInput.isVisible().catch(() => false)) {
    await emailInput.fill("admin@unitedangelreach.org");
    await page.locator('input[type="password"]').first().fill("Admin@123");
    await page.locator('button[type="submit"], button:has-text("Sign in"), button:has-text("Log in")').first().click();
    await page.waitForTimeout(2500);
    console.log("logged in");
  } else {
    console.log("login form not shown (maybe already authenticated)");
  }

  for (const [name, hash] of PAGES) {
    await page.goto(`${BASE}/${hash}`, { waitUntil: "networkidle" });
    await page.waitForTimeout(2000);
    await page.screenshot({ path: `/tmp/shots/${name}.png`, fullPage: false });
    console.log("shot:", name);
  }

  await browser.close();
})().catch((e) => {
  console.error("FAILED:", e.message);
  process.exit(1);
});
