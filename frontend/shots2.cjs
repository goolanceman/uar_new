/* Screenshot the Masters → Mobile tab + audio spaces views. */
const { chromium } = require("playwright");

(async () => {
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

  await page.goto("http://localhost:3000/#/login", { waitUntil: "networkidle" });
  await page.waitForTimeout(1500);
  await page.locator('input[type="email"], input[placeholder*="mail" i]').first().fill("admin@unitedangelreach.org");
  await page.locator('input[type="password"]').first().fill("Admin@123");
  await page.locator('button[type="submit"], button:has-text("Sign in"), button:has-text("Log in")').first().click();
  await page.waitForTimeout(2500);

  // Masters → click the Mobile tab
  await page.goto("http://localhost:3000/#/admin/masters", { waitUntil: "networkidle" });
  await page.waitForTimeout(1500);
  await page.locator('button[role="tab"]:has-text("Mobile")').first().click();
  await page.waitForTimeout(1500);
  await page.screenshot({ path: "/tmp/shots/masters-mobile-tab.png" });
  console.log("shot: masters-mobile-tab");

  // Audio spaces: grid + list views
  await page.goto("http://localhost:3000/#/admin/mobile-audio-spaces", { waitUntil: "networkidle" });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: "/tmp/shots/audio-table.png" });
  await page.locator('button[aria-label*="rid"], [data-value="grid"], button:has(svg.lucide-layout-grid), button:has(svg.lucide-grip)').first().click().catch(() => console.log("grid click skipped"));
  await page.waitForTimeout(800);
  await page.screenshot({ path: "/tmp/shots/audio-grid.png" });
  await page.locator('button[aria-label*="ist"], button:has(svg.lucide-list), button:has(svg.lucide-align-justify)').first().click().catch(() => console.log("list click skipped"));
  await page.waitForTimeout(800);
  await page.screenshot({ path: "/tmp/shots/audio-list.png" });

  // Verifications → verified members tab
  await page.goto("http://localhost:3000/#/admin/mobile-verifications", { waitUntil: "networkidle" });
  await page.waitForTimeout(2000);
  await page.locator('button[role="tab"]:has-text("Verified members")').first().click();
  await page.waitForTimeout(1500);
  await page.screenshot({ path: "/tmp/shots/verifications-verified.png" });
  console.log("shot: verifications-verified");

  await browser.close();
})().catch((e) => {
  console.error("FAILED:", e.message);
  process.exit(1);
});
