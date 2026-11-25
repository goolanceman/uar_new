/**
 * Mobile compat reference seed — idempotent.
 * Seeds the rows the legacy endpoints expect to exist: the app-settings
 * Setting row (fetchSetting), interests, report reasons, username
 * restrictions, FAQ types/faqs, cause categories and the achievement catalog.
 *
 * Run: cd backend && npx tsx prisma/seed-mobile.ts
 */
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

const APP_SETTINGS = {
  app_name: "Charitable Trust",
  setRoomUsersLimit: 16,
  minute_limit_in_creating_story: 3,
  minute_limit_in_audio_post: 3,
  minute_limit_in_choosing_video_for_story: 1,
  minute_limit_in_choosing_video_for_post: 1,
  max_images_can_be_uploaded_in_one_post: 10,
  ad_banner_android: "",
  ad_interstitial_android: "",
  ad_banner_iOS: "",
  ad_interstitial_iOS: "",
  is_admob_on: 0,
  audio_space_hosts_limit: 10,
  audio_space_listeners_limit: 1000,
  audio_space_duration_in_minutes: 120,
  duration_limit_in_reel: 60,
  is_sight_engine_enabled: 0,
  sight_engine_api_user: null,
  sight_engine_api_secret: null,
  sight_engine_image_workflow_id: null,
  sight_engine_video_workflow_id: null,
  storage_type: 0,
  fetch_post_type: 0,
  support_email: "support@unitedangelreach.org",
  is_in_app_purchase_enabled: 0,
  play_store_download_link: "",
  app_store_download_link: "",
  uri_scheme: "chatter",
  is_maintenance_mode: 0,
  maintenance_message: null,
  is_force_app_update: 0,
  android_app_version: "1.0.0",
  ios_app_version: "1.0.0",
};

const INTERESTS = [
  "Education", "Healthcare", "Environment", "Animal Welfare", "Food Security",
  "Disaster Relief", "Women Empowerment", "Child Welfare", "Elderly Care", "Clean Water",
];

const REPORT_REASONS = [
  "Spam", "Inappropriate Content", "Harassment or Bullying", "Hate Speech",
  "Misinformation", "Violence or Threats", "Other",
];

const USERNAME_RESTRICTIONS = ["admin", "moderator", "support", "official", "uar", "root", "null", "undefined"];

const DOCUMENT_TYPES = ["Passport", "Driver's License", "National ID Card", "Aadhaar Card", "Social Security Card"];

const CAUSE_CATEGORIES = [
  { name: "Education", icon: "education", color: "#2E7D32", description: "Education support causes" },
  { name: "Healthcare", icon: "health", color: "#C62828", description: "Medical and healthcare causes" },
  { name: "Emergency", icon: "emergency", color: "#EF6C00", description: "Emergency relief causes" },
  { name: "Environment", icon: "environment", color: "#2E7D32", description: "Environmental causes" },
  { name: "Animal Welfare", icon: "animal", color: "#6A1B9A", description: "Animal welfare causes" },
  { name: "Community", icon: "community", color: "#1565C0", description: "Community development causes" },
];

const ACHIEVEMENTS = [
  { name: "First Donation", slug: "first-donation", description: "Made your first donation", category: "donation", tier: "bronze", pointsRequired: 0, amountRequired: 0, countRequired: 1, rewardPoints: 10 },
  { name: "Generous Heart", slug: "generous-heart", description: "Donated a total of 1,000", category: "donation", tier: "silver", pointsRequired: 0, amountRequired: 1000, countRequired: 0, rewardPoints: 25 },
  { name: "Philanthropist", slug: "philanthropist", description: "Donated a total of 10,000", category: "donation", tier: "gold", pointsRequired: 0, amountRequired: 10000, countRequired: 0, rewardPoints: 50 },
  { name: "Platinum Supporter", slug: "platinum-supporter", description: "Donated a total of 50,000", category: "donation", tier: "platinum", pointsRequired: 0, amountRequired: 50000, countRequired: 0, rewardPoints: 100 },
  { name: "Regular Giver", slug: "regular-giver", description: "Donated 5 times", category: "milestone", tier: "silver", pointsRequired: 0, amountRequired: 0, countRequired: 5, rewardPoints: 30 },
  { name: "Marathon Giver", slug: "marathon-giver", description: "Donated 25 times", category: "milestone", tier: "gold", pointsRequired: 0, amountRequired: 0, countRequired: 25, rewardPoints: 60 },
];

const FAQ_TYPES = [
  { title: "General", faqs: [{ question: "How do I create an account?", answer: "Tap Sign Up on the welcome screen and follow the steps." }, { question: "How do I reset my password?", answer: "Use Forgot Password on the login screen and follow the emailed OTP." }] },
  { title: "Donations", faqs: [{ question: "How do I donate to a cause?", answer: "Open a cause and tap the Donate button." }, { question: "Are donations refundable?", answer: "Donations are generally non-refundable once disbursed." }] },
  { title: "Account & Safety", faqs: [{ question: "How do I report content?", answer: "Use the Report option on any post, reel, room or profile." }] },
];

async function main() {
  // 1. App settings — single Setting row (key/value infra reused)
  await db.setting.upsert({
    where: { key: "mobile.app" },
    update: { value: JSON.stringify(APP_SETTINGS) },
    create: { key: "mobile.app", value: JSON.stringify(APP_SETTINGS), description: "Mobile app config served by /api/fetchSetting" },
  });

  // 2. Interests
  const interestCount = await db.communityInterest.count();
  if (interestCount === 0) {
    await db.communityInterest.createMany({ data: INTERESTS.map((title) => ({ title })) });
  }

  // 3. Report reasons + username restrictions + document types
  const reasonCount = await db.reportReason.count();
  if (reasonCount === 0) {
    await db.reportReason.createMany({ data: REPORT_REASONS.map((title) => ({ title })) });
  }
  const restrictionCount = await db.usernameRestriction.count();
  if (restrictionCount === 0) {
    await db.usernameRestriction.createMany({ data: USERNAME_RESTRICTIONS.map((title) => ({ title })) });
  }
  // document_types live in the Setting KV as a JSON list (fetchSetting nests
  // them under documentType)
  await db.setting.upsert({
    where: { key: "mobile.documentTypes" },
    update: {},
    create: { key: "mobile.documentTypes", value: JSON.stringify(DOCUMENT_TYPES), description: "Profile verification document types for the mobile app" },
  });

  // 4. Cause categories
  const catCount = await db.causeCategory.count();
  if (catCount === 0) {
    await db.causeCategory.createMany({ data: CAUSE_CATEGORIES });
  }

  // 5. Achievement catalog
  for (const a of ACHIEVEMENTS) {
    await db.achievement.upsert({ where: { slug: a.slug }, update: {}, create: a });
  }

  // 6. FAQ types + faqs
  const faqTypeCount = await db.faqType.count();
  if (faqTypeCount === 0) {
    for (const t of FAQ_TYPES) {
      const type = await db.faqType.create({ data: { title: t.title } });
      await db.faq.createMany({ data: t.faqs.map((f) => ({ ...f, faqsTypeId: type.id })) });
    }
  }

  // 7. Terms & privacy pages
  const page = await db.tblPage.findFirst();
  if (!page) {
    await db.tblPage.create({
      data: {
        privacy: "<h1>Privacy Policy</h1><p>We respect your privacy and protect your personal data.</p>",
        termsofuse: "<h1>Terms of Use</h1><p>By using this app you agree to our community guidelines.</p>",
      },
    });
  }

  console.log("[seed-mobile] done: settings, interests, report reasons, username restrictions, cause categories, achievements, faqs, pages");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
