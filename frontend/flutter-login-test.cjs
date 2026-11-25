/* Continue: role selection → tab bar → open every tab + portal → capture exceptions. */
const { chromium } = require("playwright");

(async () => {
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });

  const errs = [];
  page.on("console", (msg) => {
    const t = msg.text();
    if (/Exception|subtype|is not a subtype/i.test(t)) errs.push(t.slice(0, 200));
  });

  await page.goto("http://localhost:9090/", { waitUntil: "networkidle" });
  await page.waitForTimeout(7000);
  await page.mouse.click(1225, 37); // skip onboarding
  await page.waitForTimeout(2000);
  await page.mouse.click(640, 653); // Log In
  await page.waitForTimeout(2500);
  await page.mouse.click(640, 267); // email
  await page.waitForTimeout(700);
  await page.keyboard.type("maya@demo.uar", { delay: 25 });
  await page.mouse.click(640, 331); // password
  await page.waitForTimeout(700);
  await page.keyboard.type("password123", { delay: 25 });
  await page.waitForTimeout(300);
  await page.mouse.click(640, 456); // submit
  await page.waitForTimeout(9000);

  // Role selection: "Join as Supporter" (green button ~y=511)
  await page.mouse.click(640, 511);
  await page.waitForTimeout(6000);
  await page.screenshot({ path: "/tmp/shots/f-1-after-role.png" });

  // Tab bar: 5 tabs across the bottom — walk each one
  const tabs = [["feed", 128], ["causes", 384], ["reels", 640], ["chats", 896], ["portal", 1152]];
  for (const [name, x] of tabs) {
    await page.mouse.click(x, 770);
    await page.waitForTimeout(4000);
    await page.screenshot({ path: `/tmp/shots/f-tab-${name}.png` });
    console.log(`tab ${name} shot taken — exceptions so far: ${errs.length}`);
  }

  for (const e of errs) console.log("EXCEPTION:", e);
  if (errs.length === 0) console.log("NO TYPE ERRORS ACROSS ALL TABS");
  await browser.close();
})().catch((e) => {
  console.error("FAILED:", e.message);
  process.exit(1);
});
