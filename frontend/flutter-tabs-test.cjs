/* Pre-seed a logged-in session → walk every tab → capture exceptions. */
const { chromium } = require("playwright");

const BASE = "http://localhost:9090";
const API = "http://192.168.1.8:4000";

(async () => {
  // 1. Mint a token for the demo user via the API
  const loginRes = await fetch(`${API}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: "test" },
    body: JSON.stringify({ email: "maya@demo.uar", password: "password123" }),
  });
  const login = await loginRes.json();
  const { token, user, expires_at } = login.data;

  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();

  const errs = [];
  page.on("console", (msg) => {
    const t = msg.text();
    if (/Exception|subtype|package:untitled|dart-sdk/i.test(t)) errs.push(t.slice(0, 1600));
  });

  // 2. Seed the GetStorage container before the app boots
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await page.evaluate(({ token, user, expires_at }) => {
    const store = JSON.parse(localStorage.getItem("GetStorage") || "{}");
    Object.assign(store, {
      isLogin: true,
      authToken: token,
      tokenExpiry: expires_at,
      onboardingSeen: 1,
      lang: "en",
      user,
    });
    localStorage.setItem("GetStorage", JSON.stringify(store));
  }, { token, user, expires_at });

  // 3. Reload → splash restores the session → tab bar
  await page.goto(BASE, { waitUntil: "networkidle" });
  await page.waitForTimeout(8000);
  await page.screenshot({ path: "/tmp/shots/u-0-tabbar.png" });

  // 4. Walk the tabs (5 across the bottom)
  const tabs = [["feed", 128], ["causes", 384], ["reels", 640], ["chats", 896], ["portal", 1152]];
  let i = 0;
  for (const [name, x] of tabs) {
    await page.mouse.click(x, 770);
    await page.waitForTimeout(4500);
    await page.screenshot({ path: `/tmp/shots/u-tab-${name}.png` });
    console.log(`tab ${name} — exceptions: ${errs.length}`);
    i++;
  }

  for (const e of errs) console.log("EXCEPTION:", e);
  if (errs.length === 0) console.log("NO TYPE ERRORS ACROSS ALL TABS");
  await browser.close();
})().catch((e) => {
  console.error("FAILED:", e.message);
  process.exit(1);
});
