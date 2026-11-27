/**
 * United Angel Reach — canonical seed (merged schema).
 * Run: bun prisma/seed.ts   (fresh DB: bun run db:reset)
 */
import { PrismaClient } from "@prisma/client";
import crypto from "crypto";
import { SETTING_DEFAULTS } from "../src/domains/settings-core";
import { DEMO_ACCOUNTS } from "../src/shared/constants/demo-accounts";

const db = new PrismaClient();

/** One demo-account lookup for the seed (single source: src/shared/constants/demo-accounts.ts). */
function demoByKey(key: string) {
  const d = DEMO_ACCOUNTS.find((x) => x.key === key);
  if (!d) throw new Error(`demo-accounts.ts is missing the "${key}" account`);
  return d;
}

function hashPassword(pw: string): string {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(pw, salt, 32).toString("hex");
  return `${salt}:${hash}`;
}

function daysFromNow(d: number): Date {
  return new Date(Date.now() + d * 86400000);
}

// ── Campaign cover + gallery photos (hotlinked, royalty-free Unsplash CDN) ──
const u = (id: string) => `https://images.unsplash.com/${id}?w=1200&q=80&auto=format&fit=crop`;
const PHOTO = {
  unityHands: u("photo-1527525443983-6e60c75fff46"),
  supportHands: u("photo-1604881991720-f91add269bed"),
  whiteboardTalk: u("photo-1532619675605-1ede6c2ed2b0"),
  circuitBoard: u("photo-1550751827-4bd374c3f58b"),
  selfDefence: u("photo-1517836357463-d25dfeac3438"),
  martialGrip: u("photo-1615461066841-6116e61058f4"),
  classroom: u("photo-1577896851231-70ef18881754"),
  booksDesk: u("photo-1503676260728-1c00da094a0b"),
  kidsGroup: u("photo-1542810634-71277d95dcbb"),
  medicinePills: u("photo-1584308666744-24d5c474f2ae"),
  doctorHands: u("photo-1532938911079-1b06ac7ceec7"),
  dogAdoption: u("photo-1583337130417-3346a1be7dee"),
  childHands: u("photo-1532629345422-7515f3d16bb6"),
  ambulance: u("photo-1587745416684-47953f16f02f"),
  foodTruck: u("photo-1593113630400-ea4288922497"),
};
const GALLERY = {
  antiDrug: [PHOTO.unityHands, PHOTO.supportHands, PHOTO.whiteboardTalk],
  cyberCrime: [PHOTO.circuitBoard, PHOTO.whiteboardTalk, PHOTO.supportHands],
  womenSafety: [PHOTO.selfDefence, PHOTO.martialGrip, PHOTO.whiteboardTalk],
  childSafety: [PHOTO.classroom, PHOTO.booksDesk, PHOTO.kidsGroup],
  medicineAdoption: [PHOTO.medicinePills, PHOTO.doctorHands, PHOTO.supportHands],
  animalWelfare: [PHOTO.dogAdoption, PHOTO.childHands, PHOTO.supportHands],
  greenCorridor: [PHOTO.ambulance, PHOTO.foodTruck, PHOTO.supportHands],
  rationKits: [PHOTO.foodTruck, PHOTO.kidsGroup, PHOTO.supportHands],
  sanitaryPads: [PHOTO.whiteboardTalk, PHOTO.kidsGroup, PHOTO.childHands],
};

async function main() {
  console.log("🌱 Seeding United Angel Reach (canonical)…");

  // ── Users ──────────────────────────────────────────────────────────────
  // Demo logins come from ONE list: src/shared/constants/demo-accounts.ts (also served by
  // GET /api/auth/demo-accounts while testing mode is ON — no drift possible).
  const users: Record<string, string> = {};
  const userDefs = ["admin", "donor", "volunteer", "applicant", "beneficiary"].map((key) => {
    const d = demoByKey(key);
    return { key, name: d.name, email: d.email, password: d.password, role: d.role, city: d.city ?? "Bengaluru", phone: d.phone ?? "" };
  });
  for (const u of userDefs) {
    const status = u.key === "applicant" ? "PENDING" : "ACTIVE";
    const isActive = u.key !== "applicant";
    const rec = await db.user.upsert({
      where: { email: u.email },
      update: { password: hashPassword(u.password), status, isActive },
      create: { name: u.name, email: u.email, password: hashPassword(u.password), role: u.role, city: u.city, phone: u.phone, status, isActive },
    });
    users[u.key] = rec.id;
  }

  // Volunteer profiles (active volunteer + pending applicant)
  await db.volunteer.upsert({
    where: { userId: users.volunteer },
    update: { status: "ACTIVE" },
    create: { code: "UAR-VOL-00001", userId: users.volunteer, skills: JSON.stringify(["FIELD_OPS", "TEACHING", "KIT_SCAN"]), assignedArea: "Bengaluru South", status: "ACTIVE", availability: "WEEKENDS" },
  });
  await db.volunteer.upsert({
    where: { userId: users.applicant },
    update: {},
    create: { code: "UAR-VOL-00002", userId: users.applicant, skills: JSON.stringify(["FIELD_OPS"]), status: "PENDING", assignedArea: "Mysuru" },
  });

  // Pending volunteer application (temp creds flow)
  const appCount = await db.volunteerApplication.count();
  if (appCount === 0) {
    await db.volunteerApplication.create({
      data: {
        userId: users.applicant,
        fullName: "Arjun Kumar",
        email: "applicant@demo.org",
        phone: "+91 98860 10004",
        city: "Mysuru",
        occupation: "Student",
        skills: "FIELD_OPS,TEACHING",
        availability: "WEEKENDS",
        motivation: "I lost my cousin to substance abuse and want to educate students about addiction before it catches them.",
        status: "PENDING",
      },
    });
  }
  console.log("  ✓ users + volunteer profiles + application");

  // ── MDM Masters ────────────────────────────────────────────────────────
  const masters: [string, string, string][] = [
    ["CONDITION", "BP", "Blood Pressure"], ["CONDITION", "DIABETES", "Diabetes"], ["CONDITION", "THYROID", "Thyroid"], ["CONDITION", "CARDIAC", "Cardiac"], ["CONDITION", "ASTHMA", "Asthma"], ["CONDITION", "ARTHRITIS", "Arthritis"], ["CONDITION", "OTHER", "Other"],
    ["ANIMAL_SPECIES", "DOG", "Dog"], ["ANIMAL_SPECIES", "CAT", "Cat"], ["ANIMAL_SPECIES", "COW", "Cow"], ["ANIMAL_SPECIES", "BIRD", "Bird"], ["ANIMAL_SPECIES", "OTHER", "Other"],
    ["CITY", "Bengaluru", "Bengaluru"], ["CITY", "Mysuru", "Mysuru"], ["CITY", "Hubballi", "Hubballi"], ["CITY", "Mangaluru", "Mangaluru"], ["CITY", "Davanagere", "Davanagere"],
    ["AVAILABILITY", "WEEKENDS", "Weekends"], ["AVAILABILITY", "EVENINGS", "Weekday evenings"], ["AVAILABILITY", "FULL_TIME", "Full time"], ["AVAILABILITY", "FLEXIBLE", "Flexible"],
    ["SKILL", "FIELD_OPS", "Field operations"], ["SKILL", "MEDICAL", "Medical / first aid"], ["SKILL", "TEACHING", "Teaching & awareness"], ["SKILL", "DRIVING", "Driving"], ["SKILL", "COUNSELLING", "Counselling"], ["SKILL", "ANIMAL_CARE", "Animal care"], ["SKILL", "TECH", "Tech & data"], ["SKILL", "KIT_SCAN", "Kit scanning"],
    ["AMBULANCE_TYPE", "BLS", "BLS — Basic Life Support"], ["AMBULANCE_TYPE", "ALS", "ALS — Advanced Life Support"], ["AMBULANCE_TYPE", "PTV", "PTV — Patient Transport"], ["AMBULANCE_TYPE", "NEONATAL", "Neonatal"],
    ["EMERGENCY_TYPE", "CARDIAC", "Cardiac emergency"], ["EMERGENCY_TYPE", "ACCIDENT", "Road accident / trauma"], ["EMERGENCY_TYPE", "MATERNITY", "Maternity"], ["EMERGENCY_TYPE", "BURN", "Burns"], ["EMERGENCY_TYPE", "RESPIRATORY", "Respiratory"], ["EMERGENCY_TYPE", "TRANSFER", "Hospital transfer"],
    ["INVENTORY_CATEGORY", "FOOD_KIT", "Ration & food"], ["INVENTORY_CATEGORY", "SANITARY_PADS", "Hygiene & sanitary"], ["INVENTORY_CATEGORY", "MEDICINE", "Medicine"], ["INVENTORY_CATEGORY", "ANIMAL_FEED", "Animal feed"], ["INVENTORY_CATEGORY", "EQUIPMENT", "Equipment"],
    ["DISTRIBUTION_TYPE", "FOOD", "Ration kit"], ["DISTRIBUTION_TYPE", "SANITARY_PADS", "Sanitary pads"], ["DISTRIBUTION_TYPE", "MEDICAL", "Medicine"], ["DISTRIBUTION_TYPE", "ANIMAL_FEED", "Animal feed"], ["DISTRIBUTION_TYPE", "OTHER", "Other"],
    ["TASK_TYPE", "DISTRIBUTION", "Distribution drive"], ["TASK_TYPE", "KIT_SCAN", "Kit scanning"], ["TASK_TYPE", "INVENTORY", "Inventory & stocking"], ["TASK_TYPE", "EVENT", "Awareness event"], ["TASK_TYPE", "RESCUE", "Animal rescue"], ["TASK_TYPE", "AMBULANCE", "Ambulance support"],
    ["UNIT", "pcs", "Pieces"], ["UNIT", "kg", "Kilograms"], ["UNIT", "litre", "Litres"], ["UNIT", "box", "Boxes"], ["UNIT", "pack", "Packs"], ["UNIT", "sack", "Sacks"],
    ["BENEFICIARY_CATEGORY", "POOR_FAMILY", "Poor family"], ["BENEFICIARY_CATEGORY", "WIDOW", "Widow"], ["BENEFICIARY_CATEGORY", "ORPHAN", "Orphan"], ["BENEFICIARY_CATEGORY", "STUDENT", "Student"], ["BENEFICIARY_CATEGORY", "ELDERLY", "Elderly"], ["BENEFICIARY_CATEGORY", "DISABLED", "Differently abled"], ["BENEFICIARY_CATEGORY", "SINGLE_MOTHER", "Single mother"], ["BENEFICIARY_CATEGORY", "PATIENT", "Patient"], ["BENEFICIARY_CATEGORY", "DAILY_WAGE", "Daily wage worker"], ["BENEFICIARY_CATEGORY", "OTHER", "Other"],
    ["DONATION_CATEGORY", "GENERAL", "General"], ["DONATION_CATEGORY", "MEDICAL", "Medical"], ["DONATION_CATEGORY", "FOOD_DISTRIBUTION", "Food distribution"], ["DONATION_CATEGORY", "SANITARY_PADS", "Sanitary pads"], ["DONATION_CATEGORY", "EDUCATION_SUPPORT", "Education support"], ["DONATION_CATEGORY", "EMERGENCY", "Emergency"], ["DONATION_CATEGORY", "ANIMAL_WELFARE", "Animal welfare"], ["DONATION_CATEGORY", "MOBILITY", "Ambulance & corridor"], ["DONATION_CATEGORY", "AWARENESS", "Awareness"],
    // Campaign category dropdown (mobile Causes feed + admin composer). Values
    // mirror the existing campaign.category vocabulary — labels are friendlier
    // display names, so live campaign rows keep resolving to their category.
    ["CAMPAIGN_CATEGORY", "GENERAL", "General"], ["CAMPAIGN_CATEGORY", "MEDICAL", "Medical emergencies"], ["CAMPAIGN_CATEGORY", "FOOD_DISTRIBUTION", "Food & hunger"], ["CAMPAIGN_CATEGORY", "SANITARY_PADS", "Sanitary pads"], ["CAMPAIGN_CATEGORY", "EDUCATION_SUPPORT", "Education"], ["CAMPAIGN_CATEGORY", "EMERGENCY", "Disaster relief"], ["CAMPAIGN_CATEGORY", "ANIMAL_WELFARE", "Animal welfare"], ["CAMPAIGN_CATEGORY", "ANIMAL", "Animal rescue"], ["CAMPAIGN_CATEGORY", "MOBILITY", "Ambulance & corridor"], ["CAMPAIGN_CATEGORY", "AWARENESS", "Awareness"], ["CAMPAIGN_CATEGORY", "SAFETY", "Safety"], ["CAMPAIGN_CATEGORY", "COMMUNITY_DEVELOPMENT", "Community development"], ["CAMPAIGN_CATEGORY", "CHILD_WELFARE", "Child welfare"], ["CAMPAIGN_CATEGORY", "OTHER", "Other"],
  ];
  for (let i = 0; i < masters.length; i++) {
    const [category, value, label] = masters[i];
    await db.master.upsert({
      where: { category_value: { category, value } },
      update: { label, sortOrder: i },
      create: { category, value, label, sortOrder: i },
    });
  }
  console.log(`  ✓ masters (${masters.length})`);

  // ── Campaigns (9 flagship programmes) ──────────────────────────────────
  const campaigns = [
    { slug: "anti-drug", title: "Sankalp Against Substance — Anti-Drug", tagline: "Awareness, de-addiction guidance and family support — addiction is a health condition, not a crime.", category: "AWARENESS", description: "School & college modules, workplace sessions, family counselling camps and rehab referrals across Bengaluru. Volunteers teach the 5-step helping playbook and connect people to the free National De-addiction Helpline 14446.", targetAmount: 800000, raisedAmount: 436500, beneficiaries: 12400, volunteersEngaged: 86, icon: "shield-alert", accent: "orange", featured: true, helpline: "14446", gallery: JSON.stringify(GALLERY.antiDrug), coverImage: GALLERY.antiDrug[0] },
    { slug: "cyber-crime", title: "CyberSuraksha — Cyber Crime Safety", tagline: "Beat the golden hour: 1930, cybercrime.gov.in and scam-recognition training for every family.", category: "AWARENESS", description: "Bengaluru reports 1,000+ cyber frauds daily. We teach the 60-minute rescue playbook, run RWA and senior-citizen cyber-hygiene workshops, and handhold victims through 1930 + cybercrime.gov.in filings.", targetAmount: 500000, raisedAmount: 289000, beneficiaries: 8600, volunteersEngaged: 42, icon: "smartphone", accent: "cyan", featured: true, helpline: "1930", gallery: JSON.stringify(GALLERY.cyberCrime), coverImage: GALLERY.cyberCrime[0] },
    { slug: "women-safety", title: "Suraksha — Women Safety", tagline: "Self-defence, legal power and 112/181/1091 readiness for every woman and girl.", category: "AWARENESS", description: "Free 15-day self-defence batches, POSH workplace workshops, safe-city drives and survivor support with legal-aid tie-ups. We teach the DV Act 2005, POSH Act 2013 and the trust-your-gut playbook.", targetAmount: 900000, raisedAmount: 512000, beneficiaries: 7800, volunteersEngaged: 64, icon: "heart-handshake", accent: "fuchsia", featured: true, helpline: "181", gallery: JSON.stringify(GALLERY.womenSafety), coverImage: GALLERY.womenSafety[0] },
    { slug: "child-safety", title: "Little Angels Shield — Child Safety (POCSO)", tagline: "Underwear rule, safe-adult lists and POCSO training for schools, tuitions and homes.", category: "AWARENESS", description: "Age-appropriate safety education in schools, tuitions and orphanages; teacher verification toolkits; parent seminars. One number for any child in distress: CHILDLINE 1098.", targetAmount: 700000, raisedAmount: 398000, beneficiaries: 21500, volunteersEngaged: 58, icon: "baby", accent: "amber", featured: true, helpline: "1098", gallery: JSON.stringify(GALLERY.childSafety), coverImage: GALLERY.childSafety[0] },
    { slug: "medicine-adoption", title: "Adopt-a-Medicine — monthly tablets for the needy", tagline: "₹150/month keeps a BP or diabetes patient alive. Adopt a real, verified patient today.", category: "MEDICAL", description: "A registry of verified patients who skip BP, sugar, thyroid and cardiac tablets because they cost ₹800–2,500/month. Donors adopt patients fully, partially or monthly — with refill proof and 80G receipts.", targetAmount: 1200000, raisedAmount: 645000, beneficiaries: 3200, volunteersEngaged: 38, icon: "pill", accent: "teal", featured: true, gallery: JSON.stringify(GALLERY.medicineAdoption), coverImage: GALLERY.medicineAdoption[0] },
    { slug: "animal-welfare", title: "Angel Paws — Animal Adoption & Food", tagline: "Adopt, don't shop. Feed a street dog for a month for ₹900. Rescue. Vaccinate. Love.", category: "ANIMAL_WELFARE", description: "Street-animal feeding zones, rescue coordination with CUPA/BAWA, ABC vaccination-sterilisation drives and an adoption platform for Indie dogs, cats and rescued cows.", targetAmount: 600000, raisedAmount: 331000, beneficiaries: 4100, volunteersEngaged: 74, icon: "paw-print", accent: "lime", featured: true, helpline: "1962", gallery: JSON.stringify(GALLERY.animalWelfare), coverImage: GALLERY.animalWelfare[0] },
    { slug: "green-corridor", title: "AI Green Corridor — ambulances that clear their own path", tagline: "Traffic ahead knows before the siren does: 5G V2X → cellular → Bluetooth mesh → FM break-in.", category: "MOBILITY", description: "Bengaluru ambulances average 11 km/h; cardiac survival drops every minute. Our corridor mesh alerts vehicles up to 2 km ahead via V2X and offline Bluetooth beacons, cutting run time 40–60%.", targetAmount: 1500000, raisedAmount: 821000, beneficiaries: 5600, volunteersEngaged: 95, icon: "siren", accent: "red", featured: true, helpline: "108", gallery: JSON.stringify(GALLERY.greenCorridor), coverImage: GALLERY.greenCorridor[0] },
    { slug: "ration-kits", title: "Ration Kit Mission — QR-coded food security", tagline: "Rice, atta, dal, oil — packed, QR-labelled, handed with dignity, tracked to the last kit.", category: "FOOD_DISTRIBUTION", description: "Every kit carries a unique code (UAR-RK-2026-XXXXXX). Volunteers scan at handover — inventory auto-decrements and every family is logged with time, place and volunteer.", targetAmount: 1000000, raisedAmount: 558000, beneficiaries: 18700, volunteersEngaged: 112, icon: "package", accent: "emerald", featured: true, gallery: JSON.stringify(GALLERY.rationKits), coverImage: GALLERY.rationKits[0] },
    { slug: "sanitary-pads", title: "Project Dignity — Sanitary Pad Banks", tagline: "No girl should miss school because of her period. Pad banks + awareness for all.", category: "SANITARY_PADS", description: "Pad-bank vending in government schools, slum communities and factory clusters; biodegradable awareness; anemia camps. Sessions include boys — because stigma ends with everyone.", targetAmount: 500000, raisedAmount: 276000, beneficiaries: 9400, volunteersEngaged: 47, icon: "flower-2", accent: "pink", featured: true, gallery: JSON.stringify(GALLERY.sanitaryPads), coverImage: GALLERY.sanitaryPads[0] },
  ];
  for (let i = 0; i < campaigns.length; i++) {
    const c = campaigns[i];
    await db.campaign.upsert({
      where: { slug: c.slug },
      update: { gallery: c.gallery, coverImage: c.coverImage },
      create: { ...c, code: `UAR-CMP-${String(i + 1).padStart(5, "0")}`, createdBy: "seed", status: "ACTIVE" },
    });
  }
  console.log(`  ✓ campaigns (${campaigns.length})`);

  const bySlug = Object.fromEntries(
    (await db.campaign.findMany()).map((c) => [c.slug, c.id])
  );

  // ── Medicine adoption causes ───────────────────────────────────────────
  if ((await db.cause.count()) === 0) {
    await db.cause.createMany({
      data: [
        { code: "UAR-MED-0001", patientName: "Muniamma", age: 68, city: "Bengaluru", condition: "BP", monthlyCost: 850, durationMonths: 12, story: "Widow in Jayanagar working as a part-time cook. Her BP tablets stopped when her son lost his job — she fainted twice at work last month." },
        { code: "UAR-MED-0002", patientName: "Shivanna", age: 55, city: "Bengaluru", condition: "DIABETES", monthlyCost: 1200, durationMonths: 12, story: "Construction worker with diabetes for 9 years. Skips doses to save money; sugar swings landed him in hospital twice last year." },
        { code: "UAR-MED-0003", patientName: "Fatima Begum", age: 47, city: "Bengaluru", condition: "THYROID", monthlyCost: 600, durationMonths: 6, story: "Single mother of three, tailoring from home. Thyroid medicine is the first thing she drops when school fees are due." },
        { code: "UAR-MED-0004", patientName: "Gopal Krishna", age: 72, city: "Mysuru", condition: "CARDIAC", monthlyCost: 2400, durationMonths: 12, story: "Retired bus conductor with a stent. Cardiac tablets + statins cost his entire pension surplus.", status: "PARTIAL", raised: 800, adoptedByName: "Rahul Sharma", adoptedById: users.donor },
        { code: "UAR-MED-0005", patientName: "Sarala", age: 39, city: "Bengaluru", condition: "ASTHMA", monthlyCost: 950, durationMonths: 6, story: "Garment factory worker; dust and long hours trigger severe asthma. Inhalers are 'luxury' months." },
        { code: "UAR-MED-0006", patientName: "Rajesh Naik", age: 61, city: "Hubballi", condition: "BP", monthlyCost: 800, durationMonths: 12, story: "Auto driver with hypertension. Stopped medicines after his wife's surgery; now facing early kidney strain." },
        { code: "UAR-MED-0007", patientName: "Meenakshi", age: 65, city: "Bengaluru", condition: "DIABETES", monthlyCost: 1100, durationMonths: 12, story: "Lives alone, children abroad earn hand-to-mouth. Fully stabilised on Jan Aushadhi generics when medicines arrive on time.", status: "ADOPTED", raised: 1100, adoptedByName: "Priya Nair", adoptedById: users.volunteer },
        { code: "UAR-MED-0008", patientName: "Anthony D'Souza", age: 58, city: "Bengaluru", condition: "BP", monthlyCost: 900, durationMonths: 6, story: "Fisherman's family in KG Halli; BP medicines compete with boat-repair loans." },
      ],
    });
  }

  // ── Animals ────────────────────────────────────────────────────────────
  if ((await db.animal.count()) === 0) {
    await db.animal.createMany({
      data: [
        { code: "UAR-ANM-00001", name: "Brownie", species: "DOG", breed: "Indie", ageMonths: 24, gender: "MALE", story: "Rescued near KR Puram with a hind-leg fracture; healed fully after surgery. Gentle with kids, house-trained.", healthStatus: "Fully recovered", vaccinated: true, sterilized: true, location: "KR Puram, Bengaluru", status: "AVAILABLE", monthlyFood: 900 },
        { code: "UAR-ANM-00002", name: "Simba", species: "DOG", breed: "Indie", ageMonths: 8, gender: "MALE", story: "Abandoned puppy found inside a cardboard box in Indiranagar. Playful, vaccinated, ready for a forever home.", healthStatus: "Healthy", vaccinated: true, sterilized: false, location: "Indiranagar, Bengaluru", status: "AVAILABLE", monthlyFood: 800 },
        { code: "UAR-ANM-00003", name: "Kitty", species: "CAT", breed: "Domestic short-hair", ageMonths: 18, gender: "FEMALE", story: "Rescued from a storm drain in Malleshwaram. Quiet, affectionate, litter-trained.", healthStatus: "Healthy", vaccinated: true, sterilized: true, location: "Malleshwaram, Bengaluru", status: "AVAILABLE", monthlyFood: 700 },
        { code: "UAR-ANM-00004", name: "Lakshmi", species: "COW", breed: "Hallikar mix", ageMonths: 96, gender: "FEMALE", story: "Abandoned after milk yield dropped; rescued from a highway median. Now at our partner goshala, needs monthly fodder sponsor.", healthStatus: "Underweight, improving", vaccinated: true, sterilized: false, location: "Partner goshala, Nelamangala", status: "FOSTERED", monthlyFood: 2500 },
        { code: "UAR-ANM-00005", name: "Mithu", species: "BIRD", breed: "Rose-ringed parakeet", ageMonths: 14, gender: "MALE", story: "Rescued from an illegal seller; wing healed after clipping injury. Sensitive — needs a patient home or aviary.", healthStatus: "Recovering", vaccinated: false, sterilized: false, location: "CUPA shelter, Bengaluru", status: "AVAILABLE", monthlyFood: 400 },
        { code: "UAR-ANM-00006", name: "Raja", species: "DOG", breed: "Indie", ageMonths: 60, gender: "MALE", story: "Community dog of HSR Layout Sector 2, fed by our volunteer route. Critical after a road accident — needs surgery funds.", healthStatus: "Fracture surgery pending", vaccinated: true, sterilized: true, location: "HSR Layout, Bengaluru", status: "CRITICAL", monthlyFood: 900 },
      ],
    });
  }

  // ── Ambulances ─────────────────────────────────────────────────────────
  if ((await db.ambulance.count()) === 0) {
    await db.ambulance.createMany({
      data: [
        { code: "KA-01-UAR-101", type: "ALS", status: "AVAILABLE", base: "Bannerghatta Base", driverName: "Mahesh Gowda", driverPhone: "+91 98860 20101", crew: "EMT + Nurse", equipment: "Defibrillator,Ventilator,ECG,Oxygen" },
        { code: "KA-01-UAR-102", type: "BLS", status: "AVAILABLE", base: "Whitefield Base", driverName: "Suresh Kumar", driverPhone: "+91 98860 20102", crew: "EMT", equipment: "Oxygen,Stretcher,First-aid" },
        { code: "KA-03-UAR-103", type: "PTV", status: "AVAILABLE", base: "Jayanagar Base", driverName: "Imran Khan", driverPhone: "+91 98860 20103", crew: "Driver", equipment: "Wheelchair ramp" },
        { code: "KA-04-UAR-104", type: "NEONATAL", status: "MAINTENANCE", base: "Hebbal Base", driverName: "Ravi Shankar", driverPhone: "+91 98860 20104", crew: "NICU Nurse + EMT", equipment: "Incubator,Transport ventilator" },
        { code: "KA-05-UAR-105", type: "BLS", status: "AVAILABLE", base: "Marathahalli Base", driverName: "David Raj", driverPhone: "+91 98860 20105", crew: "EMT", equipment: "Oxygen,Stretcher,First-aid" },
      ],
    });
  }

  // ── Kit template + batch of 24 units ───────────────────────────────────
  if ((await db.kitTemplate.count()) === 0) {
    const t = await db.kitTemplate.create({
      data: {
        code: "UAR-KT-00001",
        name: "Family Ration Kit — Standard",
        description: "One month staples for a family of four",
        items: JSON.stringify([
          { name: "Rice", qty: 10, unit: "kg" },
          { name: "Wheat flour", qty: 5, unit: "kg" },
          { name: "Toor dal", qty: 2, unit: "kg" },
          { name: "Cooking oil", qty: 2, unit: "litre" },
          { name: "Sugar", qty: 1, unit: "kg" },
          { name: "Salt", qty: 1, unit: "kg" },
          { name: "Tea powder", qty: 250, unit: "g" },
        ]),
        costPerUnit: 950,
      },
    });
    const batch = await db.kitBatch.create({
      data: {
        templateId: t.id,
        name: "Batch 2026-01 — Bengaluru Winter Drive",
        totalUnits: 24,
        instructions: "1. Verify seal & weight\n2. Check rice/dal quality\n3. Apply QR label top-right\n4. Hand over only after scanning\n5. Log any damaged unit as EXPIRED",
        status: "READY",
      },
    });
    await db.kitUnit.createMany({
      data: Array.from({ length: 24 }, (_, i) => ({
        batchId: batch.id,
        code: `UAR-RK-2026-${String(i + 1).padStart(6, "0")}`,
        status: "READY",
      })),
    });

    // Second template + batch, items matching inventory item names exactly
    // (demonstrates "Build Kit Batch" cleanly consuming master stock).
    const hygieneTemplate = await db.kitTemplate.create({
      data: {
        code: "UAR-KT-00002",
        name: "Hygiene Kit — School Pad Pack",
        kind: "HYGIENE",
        description: "Two packs of sanitary pads per girl, per distribution round",
        items: JSON.stringify([{ name: "Sanitary pads (packs)", qty: 2, unit: "pack" }]),
        costPerUnit: 150,
      },
    });
    const hygieneBatch = await db.kitBatch.create({
      data: {
        templateId: hygieneTemplate.id,
        name: "Batch 2026-02 — Jayanagar Pad Bank",
        totalUnits: 40,
        scannedUnits: 6,
        instructions: "1. Seal check\n2. Hand over discreetly in a paper bag\n3. Log recipient age bracket only, never name in public reports",
        status: "IN_PROGRESS",
      },
    });
    await db.kitUnit.createMany({
      data: Array.from({ length: 40 }, (_, i) => ({
        batchId: hygieneBatch.id,
        code: `UAR-HK-2026-${String(i + 1).padStart(6, "0")}`,
        status: i < 6 ? "SCANNED" : "READY",
        scannedAt: i < 6 ? new Date() : null,
      })),
    });

    const medicalTemplate = await db.kitTemplate.create({
      data: {
        code: "UAR-KT-00003",
        name: "Medical Support Kit — BP & Diabetes",
        kind: "MEDICAL",
        description: "One month's BP + diabetes tablets bundled for a single patient",
        items: JSON.stringify([
          { name: "BP tablets (Amlodipine)", qty: 1, unit: "pack" },
          { name: "Diabetes tablets (Metformin)", qty: 1, unit: "pack" },
        ]),
        costPerUnit: 500,
      },
    });
    const medicalBatch = await db.kitBatch.create({
      data: {
        templateId: medicalTemplate.id,
        name: "Batch 2026-01 — Medicine Hub Jayanagar",
        totalUnits: 20,
        instructions: "1. Confirm patient identity against Adopt-a-Medicine registry\n2. Check expiry dates\n3. Hand over with dosage card",
        status: "READY",
      },
    });
    await db.kitUnit.createMany({
      data: Array.from({ length: 20 }, (_, i) => ({
        batchId: medicalBatch.id,
        code: `UAR-MK-2026-${String(i + 1).padStart(6, "0")}`,
        status: "READY",
      })),
    });
  }

  // ── Inventory ──────────────────────────────────────────────────────────
  if ((await db.inventoryItem.count()) === 0) {
    await db.inventoryItem.createMany({
      data: [
        { code: "UAR-ITM-00001", name: "Rice (25kg sacks)", category: "FOOD_KIT", quantity: 180, unit: "sack", minStock: 40, location: "Central Warehouse, Peenya" },
        { code: "UAR-ITM-00002", name: "Wheat flour", category: "FOOD_KIT", quantity: 90, unit: "kg", minStock: 30, location: "Central Warehouse, Peenya" },
        { code: "UAR-ITM-00003", name: "Toor dal", category: "FOOD_KIT", quantity: 25, unit: "kg", minStock: 25, location: "Central Warehouse, Peenya" },
        { code: "UAR-ITM-00004", name: "Sanitary pads (packs)", category: "SANITARY_PADS", quantity: 420, unit: "pack", minStock: 100, location: "Pad Bank, Jayanagar" },
        { code: "UAR-ITM-00005", name: "BP tablets (Amlodipine)", category: "MEDICINE", quantity: 350, unit: "pack", minStock: 80, location: "Medicine Hub, Jayanagar" },
        { code: "UAR-ITM-00006", name: "Diabetes tablets (Metformin)", category: "MEDICINE", quantity: 60, unit: "pack", minStock: 80, location: "Medicine Hub, Jayanagar" },
        { code: "UAR-ITM-00007", name: "Dog feed (dry, 20kg)", category: "ANIMAL_FEED", quantity: 48, unit: "sack", minStock: 15, location: "Angel Paws Hub, HSR" },
        { code: "UAR-ITM-00008", name: "First-aid kits", category: "EQUIPMENT", quantity: 30, unit: "box", minStock: 10, location: "Ambulance Base, Bannerghatta" },
      ],
    });
  }

  // ── Beneficiaries ──────────────────────────────────────────────────────
  if ((await db.beneficiary.count()) === 0) {
    await db.beneficiary.createMany({
      data: [
        { code: "UAR-BEN-00001", name: "Muniamma", phone: "+91 90190 30001", city: "Bengaluru", category: "WIDOW", urgencyLevel: "HIGH", familyMembers: 2, monthlyIncome: 3500, monthlyNeed: 1850, onboardedByName: "Priya Nair", notes: "BP + ration support, Jayanagar" },
        { code: "UAR-BEN-00002", name: "Shivanna", phone: "+91 90190 30002", city: "Bengaluru", category: "DAILY_WAGE", urgencyLevel: "CRITICAL", familyMembers: 4, monthlyIncome: 8000, monthlyNeed: 2600, onboardedByName: "Anjali Rao", notes: "Construction worker, Whitefield camp" },
        { code: "UAR-BEN-00003", name: "Fatima Begum", phone: "+91 90190 30003", city: "Bengaluru", category: "SINGLE_MOTHER", urgencyLevel: "HIGH", familyMembers: 5, monthlyIncome: 6000, monthlyNeed: 2100, onboardedByName: "Priya Nair" },
        { code: "UAR-BEN-00004", name: "Gopal Krishna", phone: "+91 90190 30004", city: "Mysuru", category: "ELDERLY", urgencyLevel: "MEDIUM", familyMembers: 3, monthlyIncome: 9000, monthlyNeed: 3200 },
        { code: "UAR-BEN-00005", name: "Sarala", phone: "+91 90190 30005", city: "Bengaluru", category: "PATIENT", urgencyLevel: "HIGH", familyMembers: 3, monthlyIncome: 7500, monthlyNeed: 1550 },
        { code: "UAR-BEN-00006", name: "Lakshmi Devi", phone: "+91 98860 10005", city: "Bengaluru", category: "ELDERLY", urgencyLevel: "MEDIUM", familyMembers: 2, monthlyIncome: 2400, monthlyNeed: 1400 },
      ],
    });
  }

  // ── Recurring needs (monthly standing needs → inventory forecast + donor
  //    auto-match pool) ───────────────────────────────────────────────────
  if ((await db.recurringNeed.count()) === 0) {
    const muniamma = await db.beneficiary.findFirst({ where: { name: "Muniamma" } });
    const gopal = await db.beneficiary.findFirst({ where: { name: "Gopal Krishna" } });
    const sarala = await db.beneficiary.findFirst({ where: { name: "Sarala" } });
    const bpTablets = await db.inventoryItem.findFirst({ where: { name: "BP tablets (Amlodipine)" } });
    const diabetesTablets = await db.inventoryItem.findFirst({ where: { name: "Diabetes tablets (Metformin)" } });
    const rice = await db.inventoryItem.findFirst({ where: { name: "Rice (25kg sacks)" } });
    const rows: { beneficiaryId: string; itemId: string; qtyPerCycle: number; cycle: string; reason: string }[] = [];
    if (muniamma && bpTablets) rows.push({ beneficiaryId: muniamma.id, itemId: bpTablets.id, qtyPerCycle: 2, cycle: "MONTHLY", reason: "BP medication — cannot afford to skip a month" });
    if (gopal && diabetesTablets) rows.push({ beneficiaryId: gopal.id, itemId: diabetesTablets.id, qtyPerCycle: 3, cycle: "MONTHLY", reason: "Diabetes management, post-cardiac discharge" });
    if (sarala && rice) rows.push({ beneficiaryId: sarala.id, itemId: rice.id, qtyPerCycle: 1, cycle: "MONTHLY", reason: "Ration top-up for family of 3" });
    for (const r of rows) await db.recurringNeed.create({ data: r });
  }

  // ── Distributions + pad drives ─────────────────────────────────────────
  if ((await db.distribution.count()) === 0) {
    const vol = await db.volunteer.findUnique({ where: { userId: users.volunteer } });
    await db.distribution.createMany({
      data: [
        { type: "FOOD", beneficiaryId: (await db.beneficiary.findFirst({ where: { name: "Shivanna" } }))?.id, quantity: 1, location: "Whitefield camp", volunteerId: vol?.id, distributedAt: daysFromNow(-2), notes: "Kit UAR-RK-2026-000003 scanned at handover" },
        { type: "MEDICAL", beneficiaryId: (await db.beneficiary.findFirst({ where: { name: "Muniamma" } }))?.id, quantity: 2, location: "Jayanagar", volunteerId: vol?.id, distributedAt: daysFromNow(-1), notes: "BP refill via Jan Aushadhi" },
        { type: "ANIMAL_FEED", quantity: 20, location: "HSR Layout", distributedAt: daysFromNow(-3), notes: "HSR feeder route — 14 dogs" },
      ],
    });
    await db.padDistribution.createMany({
      data: [
        { schoolName: "Govt High School, Jayanagar", area: "Jayanagar", girlsCount: 50, padsDistributed: 100, awarenessSession: true, sessionAttendees: 90, volunteerId: vol?.id, volunteerName: "Priya Nair", distributionDate: daysFromNow(-5) },
        { schoolName: "GHPS, Kadugodi", area: "Kadugodi", girlsCount: 34, padsDistributed: 70, awarenessSession: false, distributionDate: daysFromNow(-12) },
      ],
    });
  }

  // ── Donations ──────────────────────────────────────────────────────────
  if ((await db.donation.count()) === 0) {
    let n = 1;
    const mk = (donorName: string, slug: string, amount: number, opts?: { method?: string; message?: string; monthly?: boolean; anonymous?: boolean; category?: string }) => ({
      receiptNumber: `UAR-RCPT-2026-${String(n++).padStart(5, "0")}`,
      donorId: donorName === "Rahul Sharma" ? users.donor : null,
      donorName,
      donorEmail: donorName === "Rahul Sharma" ? "donor@demo.org" : `${donorName.toLowerCase().replace(/[^a-z]/g, ".")}@donors.uar.org`,
      campaignId: bySlug[slug],
      amount,
      type: opts?.monthly ? "RECURRING" : "ONE_TIME",
      category: opts?.category ?? "GENERAL",
      paymentMethod: opts?.method ?? "UPI",
      paymentStatus: "COMPLETED",
      message: opts?.message,
      isAnonymous: opts?.anonymous ?? false,
    });
    const donationRows = [
      mk("Rahul Sharma", "anti-drug", 25000, { message: "For the college workshops — great work team", category: "AWARENESS" }),
      mk("Rahul Sharma", "medicine-adoption", 2400, { message: "Co-funding Gopal Krishna garu's cardiac tabs", monthly: true, category: "MEDICAL" }),
      mk("Infosys Foundation", "green-corridor", 500000, { method: "BANK_TRANSFER", message: "CSR — Corridor pilot across 3 corridors", category: "MOBILITY" }),
      mk("Anonymous", "sanitary-pads", 50000, { anonymous: true, category: "SANITARY_PADS" }),
      mk("Meera Krishnan", "child-safety", 15000, { method: "CARD", message: "In memory of my grandmother", category: "AWARENESS" }),
      mk("TechM Cares", "ration-kits", 120000, { method: "BANK_TRANSFER", monthly: true, category: "FOOD_DISTRIBUTION" }),
      mk("Suresh Babu", "animal-welfare", 5000, { message: "Feed route sponsorship", category: "ANIMAL_WELFARE" }),
      mk("Deepa Iyer", "women-safety", 10000, { message: "Self-defence batch sponsor", category: "AWARENESS" }),
      mk("Vijay Anand", "cyber-crime", 7500, { category: "AWARENESS" }),
      mk("Rahul Sharma", "animal-welfare", 900, { message: "Brownie's food month", monthly: true, category: "ANIMAL_WELFARE" }),
      // Extra monthly supporters purely so the beneficiary "monthly sponsor"
      // picker and the donor auto-match engine have a real pool to work with.
      mk("Kavya Reddy", "medicine-adoption", 600, { message: "Monthly medicine support", monthly: true, category: "MEDICAL" }),
      mk("Arjun Mehta", "medicine-adoption", 1000, { message: "Monthly medicine support", monthly: true, category: "MEDICAL" }),
      mk("Nandini Rao", "ration-kits", 800, { message: "Monthly ration top-up", monthly: true, category: "FOOD_DISTRIBUTION" }),
    ];
    await db.donation.createMany({ data: donationRows });

    // Mirror the /api/donations upsert so every unique donor in the seed data
    // also has a Donor (CRM) record — otherwise donor pickers (sponsorship
    // assignment, auto-match pool) are empty until a real donation is made
    // through the public/admin flow. Anyone with a recurring (monthly)
    // donation is categorised MONTHLY so they show up as match candidates.
    const donorSeen = new Map<string, { name: string; userId: string | null; monthly: boolean }>();
    for (const d of donationRows) {
      if (d.donorName === "Anonymous") continue;
      const prev = donorSeen.get(d.donorEmail);
      donorSeen.set(d.donorEmail, {
        name: d.donorName,
        userId: d.donorId,
        monthly: (prev?.monthly ?? false) || d.type === "RECURRING",
      });
    }
    let donorSeq = 1;
    for (const [email, info] of donorSeen) {
      await db.donor.upsert({
        where: { email },
        update: {},
        create: {
          code: `UAR-DNR-${String(donorSeq++).padStart(5, "0")}`,
          email,
          name: info.name,
          userId: info.userId ?? undefined,
          category: info.monthly ? "MONTHLY" : "ONE_TIME",
          source: "IMPORT",
        },
      });
    }
  }

  // ── One sample sponsorship already live, so the beneficiary's "Monthly support
  //    sponsors" list isn't empty out of the box — the other seeded recurring
  //    needs stay unmatched for the auto-match dialog to suggest. ─────────
  if ((await db.beneficiarySponsorship.count()) === 0) {
    const muniamma = await db.beneficiary.findFirst({ where: { name: "Muniamma" } });
    const muniammaNeed = muniamma ? await db.recurringNeed.findFirst({ where: { beneficiaryId: muniamma.id } }) : null;
    const rahul = await db.donor.findUnique({ where: { email: "donor@demo.org" } });
    if (muniamma && rahul) {
      await db.beneficiarySponsorship.create({
        data: {
          beneficiaryId: muniamma.id,
          donorId: rahul.id,
          donorName: rahul.name,
          recurringNeedId: muniammaNeed?.id,
          amountPerMonth: 500,
          months: 12,
          source: "MANUAL",
          assignedByName: "Anjali Rao",
        },
      });
    }
  }

  // ── Volunteer tasks ────────────────────────────────────────────────────
  if ((await db.volunteerTask.count()) === 0) {
    const vol = await db.volunteer.findUnique({ where: { userId: users.volunteer } });
    if (vol) {
      await db.volunteerTask.createMany({
        data: [
          { volunteerId: vol.id, title: "Weekend ration drive — Whitefield camp", description: "Distribute 20 kits, scan each at handover", type: "DISTRIBUTION", status: "IN_PROGRESS", priority: "HIGH", location: "Whitefield", scheduledDate: daysFromNow(2) },
          { volunteerId: vol.id, title: "School safety workshop — Govt HS Jayanagar", description: "POCSO + good-touch module for class 6–8 (2 hrs)", type: "EVENT", status: "ASSIGNED", priority: "MEDIUM", location: "Jayanagar", scheduledDate: daysFromNow(6) },
          { volunteerId: vol.id, title: "Kit batch 2026-01 packing", description: "Pack & label remaining units in batch 2026-01", type: "KIT_SCAN", status: "ASSIGNED", priority: "MEDIUM", location: "Peenya warehouse", scheduledDate: daysFromNow(4) },
          { volunteerId: vol.id, title: "Feed route — HSR Sector 2", description: "Evening feeding for 14 street dogs", type: "RESCUE", status: "ASSIGNED", priority: "HIGH", location: "HSR Layout", scheduledDate: daysFromNow(1) },
        ],
      });
    }
  }

  // ── School coverage ────────────────────────────────────────────────────
  if ((await db.schoolCoverage.count()) === 0) {
    await db.schoolCoverage.createMany({
      data: [
        { schoolName: "Govt High School, Jayanagar", address: "4th Block, Jayanagar", city: "Bengaluru", contactPerson: "Smt. Vasanthi", contactPhone: "+91 90190 40001", totalGirls: 50, visitsCount: 4, lastVisited: daysFromNow(-5) },
        { schoolName: "GHPS, Kadugodi", address: "Main Road, Kadugodi", city: "Bengaluru", contactPerson: "Ravi Master", contactPhone: "+91 90190 40002", totalGirls: 34, visitsCount: 2, lastVisited: daysFromNow(-12) },
        { schoolName: "Govt PU College, Whitefield", city: "Bengaluru", contactPerson: "Latha M.", contactPhone: "+91 90190 40003", totalGirls: 76, visitsCount: 1, lastVisited: daysFromNow(-30) },
      ],
    });
  }

  // ── Testimonials ───────────────────────────────────────────────────────
  if ((await db.testimonial.count()) === 0) {
    await db.testimonial.createMany({
      data: [
        { name: "Meenakshi (65)", role: "Adopt-a-Medicine patient", message: "For the first time in two years I have not skipped a single sugar tablet. The volunteer calls me every month like family.", rating: 5 },
        { name: "Shivakumar", role: "Father of a Little Angels workshop student", message: "My daughter came home and taught US the underwear rule and her five safe adults. Every school needs this.", rating: 5 },
        { name: "Dr. Kavitha R", role: "Program partner, de-addiction unit", message: "UAR's anti-drug modules send us patients earlier — before the crisis stage. That changes outcomes.", rating: 5 },
        { name: "Lakshmi, feeder volunteer", role: "Angel Paws", message: "Fourteen dogs on my route eat because strangers pledge ₹900 a month. Bengaluru has a big heart.", rating: 5 },
      ],
    });
  }

  // ── Settings ───────────────────────────────────────────────────────────
  // ONE canonical list: exactly the keys of SETTING_DEFAULTS (single source
  // of truth in src/lib/settings-core.ts — no orphan keys, nothing missing).
  // Values start from the shared defaults; SEED_OVERRIDES keep the richer
  // demo values this seed has always populated. Secrets are seeded as "" —
  // never masked "•" placeholders; admins enter real credentials in the UI.
  // Create-only: existing rows are never touched, so admin edits survive.
  const SEED_OVERRIDES: Record<string, string> = {
    "org.address": "Seva Sadana, 42, 7th Cross, Jayanagar 4th Block, Bengaluru — 560070, Karnataka",
    "org.email": "care@unitedangelreach.org",
    "org.phone": "+91 80 4712 0000",
    "org.pan": "AABTU4521K",
    "org.80g": "UAR/80G/2019/BLR",
    "org.reg12a": "UAR/12A/2019/BLR",
    "org.darpan": "KA/2019/0245678",
    "org.website": "https://unitedangelreach.org",
    "org.vision": "To scale our service model to serve all of India",
    "finance.upiId": "unitedangelreach@upi",
    "finance.gatewayEnabled": "true",
    "notify.email.enabled": "true",
    "notify.email.host": "smtp.unitedangelreach.org",
    "notify.email.from": "care@unitedangelreach.org",
    "notify.email.secure": "true",
    "notify.sms.enabled": "true",
    "notify.sms.provider": "MSG91",
    "notify.sms.senderId": "UARNGO",
    "notify.sms.endpoint": "https://api.msg91.com/api/v5/flow/",
    "notify.whatsapp.enabled": "true",
    "notify.whatsapp.number": "+91 80 4712 0000",
    "receipts.signatoryName": "Mansoor Khan",
    "receipts.signatoryRole": "Managing Trustee",
    "receipts.footer": "United Angel Reach is a registered charitable trust. Donations are eligible for deduction u/s 80G of the Income-tax Act, 1961. This document is system-generated and valid without a physical signature when it carries the trust seal and registration numbers.",
  };

  const SETTING_DESCRIPTIONS: Record<string, string> = {
    "org.name": "Registered trust name shown across the site and on receipts",
    "org.hq": "Headquarters city and state",
    "org.address": "Registered office address (printed on receipts)",
    "org.email": "Primary contact email",
    "org.phone": "Office phone number",
    "org.pan": "Trust PAN (required for 80G receipts)",
    "org.80g": "80G registration number",
    "org.reg12a": "12A registration number",
    "org.darpan": "NITI Aayog Darpan portal ID",
    "org.website": "Public website URL",
    "org.vision": "Vision statement shown on the About page",
    "brand.logoUrl": "Logo image URL (local /path or https://)",
    "brand.faviconUrl": "Favicon image URL",
    "finance.fyStartMonth": "Financial year start month (1–12)",
    "finance.upiId": "UPI ID for direct bank donations",
    "finance.gatewayProvider": "Payment gateway provider (RAZORPAY, STRIPE, CASHFREE, PAYU)",
    "finance.razorpayKeyId": "Razorpay key ID (public)",
    "finance.stripeKeyId": "Stripe publishable key",
    "finance.cashfreeAppId": "Cashfree app ID",
    "finance.gatewayKeySecret": "Gateway secret key — stored securely, never displayed",
    "finance.gatewayWebhookSecret": "Gateway webhook signature secret — stored securely, never displayed",
    "finance.gatewayTestMode": "Use the provider's test/sandbox mode",
    "finance.gatewayEnabled": "Accept online payments through the configured gateway",
    "finance.currency": "Default donation currency (ISO 4217 code)",
    "payments.gst": "GST number (if registered)",
    "notify.email.enabled": "Send transactional email via SMTP",
    "notify.email.host": "SMTP server host",
    "notify.email.port": "SMTP server port",
    "notify.email.from": "From email address",
    "notify.email.fromName": "From display name",
    "notify.email.secure": "Use implicit TLS (port 465) instead of STARTTLS",
    "notify.email.username": "SMTP username",
    "notify.email.password": "SMTP password — stored securely, never displayed",
    "notify.email.replyTo": "Reply-To email address (optional)",
    "notify.sms.enabled": "Send SMS notifications",
    "notify.sms.provider": "SMS provider (TWILIO, MSG91, GENERIC)",
    "notify.sms.senderId": "DLT sender / from ID",
    "notify.sms.accountId": "Twilio Account SID",
    "notify.sms.endpoint": "MSG91 / generic provider API endpoint",
    "notify.sms.apiKey": "SMS provider API key or auth token — stored securely, never displayed",
    "notify.sms.templateId": "MSG91 DLT template ID (optional)",
    "notify.whatsapp.enabled": "Send WhatsApp notifications",
    "notify.whatsapp.provider": "WhatsApp provider (CLOUD, TWILIO)",
    "notify.whatsapp.number": "WhatsApp Business number",
    "notify.whatsapp.phoneId": "WhatsApp Cloud API phone number ID",
    "notify.whatsapp.apiKey": "WhatsApp access token — stored securely, never displayed",
    "storage.provider": "File storage provider (S3, GCS, AZURE, LOCAL)",
    "storage.bucket": "Storage bucket name",
    "storage.region": "Storage region",
    "storage.accessKey": "Storage access key — stored securely, never displayed",
    "storage.cdnBase": "CDN base URL for uploaded files",
    "webhooks.url": "Outbound webhook target URL",
    "webhooks.events": "Comma-separated list of events to forward",
    "webhooks.secret": "Webhook signing secret — stored securely, never displayed",
    "analytics.ga4Id": "Google Analytics 4 measurement ID (G-XXXXXXXXXX)",
    "analytics.metaPixel": "Meta (Facebook) pixel ID",
    "captcha.provider": "Captcha provider (NONE, RECAPTCHA, TURNSTILE, HCAPTCHA)",
    "captcha.siteKey": "Captcha site key",
    "captcha.secretKey": "Captcha secret key — stored securely, never displayed",
    "maps.provider": "Map provider (GOOGLE, OSM, MAPBOX)",
    "maps.apiKey": "Map provider API key — stored securely, never displayed",
    "kits.qrBaseUrl": "Base URL encoded into kit QR codes",
    "logs.enabled": "Record an activity/audit trail",
    "logs.level": "Minimum log level (DEBUG, INFO, WARN, ERROR)",
    "logs.retentionDays": "Days to keep activity log rows",
    "logs.track.logins": "Log sign-in events",
    "logs.track.donations": "Log donation events",
    "logs.track.distributions": "Log distribution events",
    "logs.track.adminEdits": "Log admin edit events",
    "app.language": "Default UI language (en, hi, kn)",
    "app.timezone": "Display timezone",
    "app.maintenance": "Show a maintenance banner on the public site",
    "receipts.signatoryName": "Default signatory name on receipts and certificates",
    "receipts.signatoryRole": "Signatory role/title",
    "receipts.prefix": "Receipt number prefix",
    "receipts.footer": "Footer note printed on every receipt",
    "assist.enabled": "Enable the Seva Sahayak AI assistant",
    "assist.model": "AI model used by the assistant",
    "matching.enabled": "Auto-match recurring donors to recurring needs",
    "matching.donorCategory": "Donor category eligible for matching",
    "matching.minMonthlyAmount": "Minimum monthly pledge to be match-eligible",
    "matching.maxActivePerDonor": "Maximum active matches per donor",
    "features.currencySwitcher": "Let donors pick their currency on the Donate page",
    "features.recurringDonations": "Offer monthly giving on the Donate page",
    "features.anonymousDonations": "Allow donors to give anonymously",
  };

  const settings: [string, string, string][] = Object.entries(SETTING_DEFAULTS).map(
    ([key, fallback]) => [key, SEED_OVERRIDES[key] ?? fallback, SETTING_DESCRIPTIONS[key] ?? key]
  );
  for (const [key, value, description] of settings) {
    const exists = await db.setting.findUnique({ where: { key } });
    if (!exists) await db.setting.create({ data: { key, value, description } });
  }
  console.log(`  ✓ settings (${settings.length} canonical keys ensured)`);

  // ── Certificates (Round-2) ─────────────────────────────────────────────
  const certYear = new Date().getFullYear();
  const certificates = [
    {
      code: `UAR-CERT-${certYear}-00001`,
      type: "DONOR_APPRECIATION",
      recipientName: "Ananya Rao",
      recipientEmail: "ananya.rao@donors.uar.org",
      title: "Certificate of Appreciation",
      description: "In grateful recognition of generous and sustained support towards the Ration Kit Mission and the Adopt-a-Medicine programme of United Angel Reach.",
      refType: "DONATION",
      meta: JSON.stringify({ programmes: "Ration Kits · Adopt-a-Medicine", fy: "FY 2025-26" }),
    },
    {
      code: `UAR-CERT-${certYear}-00002`,
      type: "VOLUNTEER_SERVICE",
      recipientName: "Kiran Kumar",
      recipientEmail: "kiran.kumar@volunteers.uar.org",
      title: "Certificate of Volunteer Service",
      description: "For 120+ hours of dedicated field service across ration-kit drives, school safety workshops and animal feeding routes in Bengaluru South.",
      refType: "VOLUNTEER",
      meta: JSON.stringify({ hours: "120", area: "Bengaluru South" }),
    },
    {
      code: `UAR-CERT-${certYear}-00003`,
      type: "ANIMAL_ADOPTION",
      recipientName: "Rohit Sharma",
      recipientEmail: "rohit.sharma@adopters.uar.org",
      title: "Animal Adoption Certificate",
      description: "For opening their heart and home to Brownie, a rescued Indie dog rehabilitated by the Angel Paws programme.",
      refType: "ANIMAL",
      meta: JSON.stringify({ animal: "Brownie", species: "DOG" }),
    },
  ];
  for (const c of certificates) {
    await db.certificate.upsert({
      where: { code: c.code },
      update: {},
      create: { ...c, issuedBy: "Anjali Rao" },
    });
  }
  console.log(`  ✓ certificates (${certificates.length})`);

  // ── Notifications (Round-2: global + admin-targeted) ───────────────────
  if ((await db.notification.count()) === 0) {
    await db.notification.createMany({
      data: [
        { userId: users.admin, type: "INVENTORY", title: "Low stock: Diabetes tablets (Metformin)", message: "Only 60 packs left against a minimum stock of 80 — raise a purchase order with the Jan Aushadhi bulk supplier.", isRead: false, actionUrl: "#/inventory" },
        { userId: users.admin, type: "VOLUNTEER", title: "Volunteer approval pending", message: "Arjun Kumar (Mysuru) applied with field-ops and teaching skills and is awaiting your review.", isRead: false, actionUrl: "#/volunteers" },
        { userId: users.admin, type: "DONATION", title: "New donation received", message: "Rahul Sharma donated ₹900 to Angel Paws via UPI — receipt UAR-RCPT-2026-00010 issued.", isRead: false, actionUrl: "#/donations" },
        { userId: null, type: "SYSTEM", title: "Green corridor mission completed", message: "Mission M-1004 reached the hospital 14 minutes early — the corridor mesh alerted 1,240 vehicles en route.", isRead: false, actionUrl: "#/green-corridor" },
        { userId: null, type: "SYSTEM", title: "Monthly impact report ready", message: "The consolidated FY impact report is live on the Impact page — donation totals, kit scans and corridor minutes saved.", isRead: false, actionUrl: "#/impact" },
      ],
    });
  }
  console.log("  ✓ notifications (5)");


  // ── Activity log ───────────────────────────────────────────────────────
  if ((await db.activityLog.count()) === 0) {
    await db.activityLog.createMany({
      data: [
        { actorName: "System", action: "SEED", entityType: "DATABASE", details: "Canonical seed loaded: 9 campaigns, 8 causes, 6 animals, 5 ambulances, kit batch of 24" },
        { actorName: "Anjali Rao", action: "APPROVE", entityType: "VOLUNTEER", details: "Priya Nair approved as field volunteer" },
      ],
    });
  }

  console.log("✅ Seed complete. Logins: admin@unitedangelreach.org/Admin@123 · donor@demo.org/Donor@123 · volunteer@demo.org/Volun@123 · applicant@demo.org/Temp@12345");
  console.log("   Certificates: UAR-CERT-" + certYear + "-00001/2/3 · Settings: canonical keys ensured · Notifications: 5");
}

// ==================== HEALTHCARE MODULE SEED (idempotent) ====================
// Appended by the healthcare workstream. Reuses users/beneficiaries seeded
// above; every block checks for existence first so the whole function is
// safe to re-run.
async function seedHealthcare() {
  console.log("🏥 Seeding healthcare module…");

  // Collision-safe code generator (camps/registrations may also be created
  // through the API, so count+1 alone can collide).
  async function nextCode(prefix: string, exists: (c: string) => Promise<boolean>): Promise<string> {
    let n = 1;
    let code = `${prefix}-${String(n).padStart(5, "0")}`;
    while (await exists(code)) {
      n += 1;
      code = `${prefix}-${String(n).padStart(5, "0")}`;
    }
    return code;
  }

  // ── Portal users (hospital owner + one per professional) ─────────────
  // Same demo-accounts.ts list — the healthcare professional logins.
  const healthUsers: Record<string, string> = {};
  const healthUserDefs = ["hospital", "meera", "nurse", "pharmacist", "labtech"].map((key) => {
    const d = demoByKey(key);
    return { key, name: d.name, email: d.email, password: d.password, role: d.role, city: d.city ?? "Bengaluru" };
  });
  for (const h of healthUserDefs) {
    const rec = await db.user.upsert({
      where: { email: h.email },
      update: { password: hashPassword(h.password), role: h.role, isActive: true, status: "ACTIVE" },
      create: { name: h.name, email: h.email, password: hashPassword(h.password), role: h.role, city: h.city, status: "ACTIVE", isActive: true },
    });
    healthUsers[h.key] = rec.id;
  }

  // ── Healthcare organisations ─────────────────────────────────────────
  let angel = await db.healthcareOrg.findFirst({ where: { name: "Angel Multispeciality Hospital" } });
  if (!angel) {
    angel = await db.healthcareOrg.create({
      data: {
        name: "Angel Multispeciality Hospital",
        type: "HOSPITAL",
        city: "Bengaluru",
        address: "12, Service Road, Jayanagar 4th Block, Bengaluru — 560070",
        phone: "+91 80 4712 1111",
        email: "care@angelmultispeciality.org",
        website: "https://angelmultispeciality.example.org",
        regNumber: "KA/HOSP/2015/8842",
        licences: JSON.stringify(["Karnataka Nursing Home Act registration", "NABH entry-level"]),
        services: JSON.stringify(["General medicine", "Cardiology", "Diagnostics", "Pharmacy", "Day surgery"]),
        facilities: "OPD, pharmacy, phlebotomy, ECG, X-ray, minor OT",
        operatingHours: "OPD 08:00–20:00; emergency 24×7",
        status: "VERIFIED",
        verifiedByName: "Anjali Rao",
        verifiedAt: new Date(),
        ownerUserId: healthUsers.hospital,
      },
    });
  } else if (!angel.ownerUserId) {
    await db.healthcareOrg.update({ where: { id: angel.id }, data: { ownerUserId: healthUsers.hospital } });
  }

  let lab = await db.healthcareOrg.findFirst({ where: { name: "City Diagnostic Lab" } });
  if (!lab) {
    lab = await db.healthcareOrg.create({
      data: {
        name: "City Diagnostic Lab",
        type: "LAB",
        city: "Bengaluru",
        address: "5th Cross, Malleshwaram, Bengaluru — 560003",
        phone: "+91 80 4712 2222",
        email: "reports@citydiag.example.org",
        regNumber: "KA/LAB/2018/2210",
        services: JSON.stringify(["Blood panel", "Glucose", "Lipid profile", "Urinalysis"]),
        status: "VERIFIED",
        verifiedByName: "Anjali Rao",
        verifiedAt: new Date(),
      },
    });
  }
  console.log("  ✓ healthcare orgs (2)");

  // ── Verified health professionals with portal logins ─────────────────
  const professionalDefs = [
    { key: "meera", name: "Dr. Meera Iyer", kind: "DOCTOR", orgId: angel.id, regNumber: "KMC/45210/2009", qualification: "MBBS, MD (Gen. Medicine)", speciality: "General Medicine", experienceYears: 14 },
    { key: "arjun", name: "Dr. Arjun Rao", kind: "DOCTOR", orgId: angel.id, regNumber: "KMC/51822/2013", qualification: "MBBS, DM (Cardiology)", speciality: "Cardiology", experienceYears: 10 },
    { key: "nurse", name: "Nurse Priya", kind: "NURSE", orgId: angel.id, regNumber: "KNC/78104/2016", qualification: "GNM", speciality: "Community health nursing", experienceYears: 8 },
    { key: "pharmacist", name: "Pharmacist Suresh", kind: "PHARMACIST", orgId: angel.id, regNumber: "KPC/33455/2014", qualification: "B.Pharm", speciality: "Dispensary", experienceYears: 11 },
    { key: "labtech", name: "Lab Tech Kavya", kind: "LAB_TECH", orgId: lab.id, regNumber: "KMLT/22918/2019", qualification: "B.Sc MLT", speciality: "Phlebotomy & biochemistry", experienceYears: 6 },
  ];
  for (const p of professionalDefs) {
    const existing = await db.healthProfessional.findFirst({ where: { name: p.name } });
    if (!existing) {
      await db.healthProfessional.create({
        data: {
          name: p.name,
          kind: p.kind,
          orgId: p.orgId,
          userId: healthUsers[p.key],
          regNumber: p.regNumber,
          qualification: p.qualification,
          speciality: p.speciality,
          experienceYears: p.experienceYears,
          verificationStatus: "VERIFIED",
          verifiedByName: "Anjali Rao",
          verifiedAt: new Date(),
          active: true,
        },
      });
    }
  }
  console.log("  ✓ health professionals (5, VERIFIED)");

  // ── Campaign (reuse existing model) ──────────────────────────────────
  let healthCampaign = await db.campaign.findUnique({ where: { slug: "community-health-wellness" } });
  if (!healthCampaign) {
    healthCampaign = await db.campaign.create({
      data: {
        code: await nextCode("UAR-CMP", (c) => db.campaign.findUnique({ where: { code: c } }).then(Boolean)),
        title: "Community Health & Wellness Outreach",
        slug: "community-health-wellness",
        tagline: "Free camps that catch BP, sugar and vision problems before they become emergencies.",
        description: "Mobile medical camps in partnership with verified hospitals and labs: registration, vitals, doctor consults, free medicines and lab pick-ups — with every beneficiary tracked for follow-up care.",
        category: "HEALTHCARE",
        targetAmount: 900000,
        status: "ACTIVE",
        icon: "heart-handshake",
        accent: "teal",
        createdBy: "seed",
      },
    });
  }

  // ── Healthcare campaign imagery (public gallery + cover) ──────────────
  const HEALTH_GALLERY = [
    "https://images.unsplash.com/photo-1532619675605-1ede6c2ed2b0?w=1200&q=80&auto=format&fit=crop",
    "https://images.unsplash.com/photo-1542810634-71277d95dcbb?w=1200&q=80&auto=format&fit=crop",
    "https://images.unsplash.com/photo-1532629345422-7515f3d16bb6?w=1200&q=80&auto=format&fit=crop",
    "https://images.unsplash.com/photo-1576091160399-112ba8d25d1d?w=1200&q=80&auto=format&fit=crop",
    "https://images.unsplash.com/photo-1584982751601-97dcc096659c?w=1200&q=80&auto=format&fit=crop",
    "https://images.unsplash.com/photo-1579684385127-1ef15d508118?w=1200&q=80&auto=format&fit=crop",
  ];
  const healthGalleryJson = JSON.stringify(HEALTH_GALLERY);
  if (healthCampaign.gallery !== healthGalleryJson) {
    healthCampaign = await db.campaign.update({
      where: { id: healthCampaign.id },
      data: { gallery: healthGalleryJson, coverImage: HEALTH_GALLERY[0] },
    });
  }

  // ── Medical camps (one upcoming SCHEDULED, one past COMPLETED) ───────
  let scheduledCamp = await db.medicalCamp.findUnique({ where: { code: "UAR-CAMP-00001" } });
  if (!scheduledCamp) {
    scheduledCamp = await db.medicalCamp.create({
      data: {
        code: "UAR-CAMP-00001",
        title: "Free Community Health Checkup",
        description: "General checkup, eye screening, BP and glucose testing with free medicines for the Jayanagar community.",
        campaignId: healthCampaign.id,
        campDate: daysFromNow(10),
        startTime: "09:00",
        endTime: "17:00",
        venue: "Community Hall, Jayanagar 4th Block",
        city: "Bengaluru",
        capacity: 300,
        services: JSON.stringify(["General checkup", "Eye screening", "BP", "Glucose"]),
        status: "SCHEDULED",
        coordinatorName: "Anjali Rao",
        createdByName: "Anjali Rao",
      },
    });
  }
  let pastCamp = await db.medicalCamp.findUnique({ where: { code: "UAR-CAMP-00002" } });
  if (!pastCamp) {
    pastCamp = await db.medicalCamp.create({
      data: {
        code: "UAR-CAMP-00002",
        title: "Free Community Health Checkup — Whitefield",
        description: "Completed camp from last month, kept for reporting and follow-up demos.",
        campaignId: healthCampaign.id,
        campDate: daysFromNow(-30),
        startTime: "09:00",
        endTime: "16:00",
        venue: "Govt PU College Ground, Whitefield",
        city: "Bengaluru",
        capacity: 200,
        services: JSON.stringify(["General checkup", "BP", "Glucose"]),
        status: "COMPLETED",
        coordinatorName: "Anjali Rao",
        createdByName: "Anjali Rao",
      },
    });
  }
  console.log("  ✓ medical camps (1 SCHEDULED, 1 COMPLETED)");

  // ── Camp partners: hospital + lab attached to the scheduled camp ─────
  for (const pair of [
    { orgId: angel.id, role: "HOST" },
    { orgId: lab.id, role: "SUPPORT" },
  ]) {
    const existing = await db.campPartner.findUnique({
      where: { campId_orgId: { campId: scheduledCamp.id, orgId: pair.orgId } },
    });
    if (!existing) {
      await db.campPartner.create({
        data: { campId: scheduledCamp.id, orgId: pair.orgId, role: pair.role, status: "ACCEPTED", respondedAt: new Date() },
      });
    }
  }

  // ── Camp staff: verified professionals on the scheduled camp ─────────
  for (const name of ["Dr. Meera Iyer", "Nurse Priya", "Pharmacist Suresh"]) {
    const pro = await db.healthProfessional.findFirst({ where: { name } });
    if (!pro) continue;
    const existing = await db.campStaff.findFirst({
      where: { campId: scheduledCamp.id, professionalId: pro.id },
    });
    if (!existing) {
      await db.campStaff.create({
        data: { campId: scheduledCamp.id, professionalId: pro.id, role: pro.kind, status: "CONFIRMED" },
      });
    }
  }

  // ── Registrations (2–3 seed beneficiaries) + one already checked in ──
  const regTargets = [
    { name: "Muniamma", checkIn: true },
    { name: "Shivanna", checkIn: false },
    { name: "Fatima Begum", checkIn: false },
  ];
  for (const t of regTargets) {
    const beneficiary = await db.beneficiary.findFirst({ where: { name: t.name } });
    if (!beneficiary) continue;
    let registration = await db.campRegistration.findUnique({
      where: { campId_beneficiaryId: { campId: scheduledCamp.id, beneficiaryId: beneficiary.id } },
    });
    if (!registration) {
      registration = await db.campRegistration.create({
        data: {
          campId: scheduledCamp.id,
          beneficiaryId: beneficiary.id,
          code: await nextCode("UAR-CREG", (c) => db.campRegistration.findUnique({ where: { code: c } }).then(Boolean)),
          status: "REGISTERED",
          registeredVia: "DESK",
          registeredByName: "Anjali Rao",
        },
      });
    }
    if (t.checkIn && !(await db.campAttendance.findUnique({ where: { registrationId: registration.id } }))) {
      await db.campAttendance.create({
        data: {
          registrationId: registration.id,
          campId: scheduledCamp.id,
          beneficiaryId: beneficiary.id,
          status: "CHECKED_IN",
          queueToken: 1,
          checkInAt: new Date(),
          checkInMethod: "MANUAL",
          operatorName: "Anjali Rao",
        },
      });
    }
  }

  // Completed past camp: one full journey (registration → attendance →
  // vitals → screening) if trivially creatable and not already present.
  const shivanna = await db.beneficiary.findFirst({ where: { name: "Shivanna" } });
  if (shivanna && pastCamp) {
    let pastReg = await db.campRegistration.findUnique({
      where: { campId_beneficiaryId: { campId: pastCamp.id, beneficiaryId: shivanna.id } },
    });
    if (!pastReg) {
      pastReg = await db.campRegistration.create({
        data: {
          campId: pastCamp.id,
          beneficiaryId: shivanna.id,
          code: await nextCode("UAR-CREG", (c) => db.campRegistration.findUnique({ where: { code: c } }).then(Boolean)),
          status: "REGISTERED",
          registeredVia: "DESK",
          registeredByName: "Priya Nair",
        },
      });
    }
    if (!(await db.campAttendance.findUnique({ where: { registrationId: pastReg.id } }))) {
      await db.campAttendance.create({
        data: {
          registrationId: pastReg.id,
          campId: pastCamp.id,
          beneficiaryId: shivanna.id,
          status: "COMPLETED",
          queueToken: 1,
          checkInAt: pastCamp.campDate,
          checkInMethod: "ID",
          operatorName: "Priya Nair",
          checkOutAt: new Date(pastCamp.campDate.getTime() + 2 * 3600000),
        },
      });
    }
    if (!(await db.vitalObservation.findFirst({ where: { beneficiaryId: shivanna.id, campId: pastCamp.id } }))) {
      await db.vitalObservation.create({
        data: {
          beneficiaryId: shivanna.id,
          campId: pastCamp.id,
          recordedByName: "Nurse Priya",
          bpSystolic: 148,
          bpDiastolic: 94,
          pulse: 88,
          spo2: 97,
          weightKg: 71.5,
          heightCm: 168,
          bmi: 25.3,
          glucose: 132,
          recordedAt: pastCamp.campDate,
        },
      });
    }
    if (!(await db.screeningRecord.findFirst({ where: { beneficiaryId: shivanna.id, campId: pastCamp.id } }))) {
      await db.screeningRecord.create({
        data: {
          campId: pastCamp.id,
          beneficiaryId: shivanna.id,
          type: "BP",
          result: "Elevated — referred for follow-up",
          abnormal: true,
          recordedByName: "Nurse Priya",
          recordedAt: pastCamp.campDate,
        },
      });
    }
  }
  console.log("  ✓ camp registrations + attendance + vitals/screening");

  // ── Medicine inventory examples + one RECEIVED transaction each ──────
  const medicineDefs = [
    { name: "Paracetamol 500mg", unit: "strip", quantity: 240, minStock: 60, pricePerUnit: 8 },
    { name: "ORS (sachet)", unit: "pack", quantity: 180, minStock: 50, pricePerUnit: 12 },
    { name: "Ibuprofen 400mg", unit: "strip", quantity: 120, minStock: 40, pricePerUnit: 15 },
  ];
  for (const m of medicineDefs) {
    let item = await db.inventoryItem.findFirst({ where: { name: m.name } });
    if (!item) {
      item = await db.inventoryItem.create({
        data: {
          code: await nextCode("UAR-ITM", (c) => db.inventoryItem.findUnique({ where: { code: c } }).then(Boolean)),
          name: m.name,
          category: "MEDICINE",
          unit: m.unit,
          quantity: m.quantity,
          minStock: m.minStock,
          pricePerUnit: m.pricePerUnit,
          location: "Medicine Hub, Jayanagar",
        },
      });
    }
    const txnExists = await db.inventoryTransaction.findFirst({
      where: { itemId: item.id, type: "RECEIVED", notes: "Healthcare seed opening stock" },
    });
    if (!txnExists) {
      await db.inventoryTransaction.create({
        data: {
          itemId: item.id,
          type: "RECEIVED",
          quantity: m.quantity,
          source: "DONATED",
          notes: "Healthcare seed opening stock",
          handledByName: "Anjali Rao",
        },
      });
    }
  }
  console.log("  ✓ medicine inventory + RECEIVED transactions");

  // ── User-testing dataset: a LIVE camp today with the full pathway in flight ──
  const today = new Date();
  today.setHours(10, 0, 0, 0);
  let liveCamp = await db.medicalCamp.findUnique({ where: { code: "UAR-CAMP-00003" } });
  if (!liveCamp) {
    liveCamp = await db.medicalCamp.create({
      data: {
        code: "UAR-CAMP-00003",
        title: "Free Community Health Checkup — Live (Today)",
        description: "Happening now — live demo camp with the full pathway in progress: queue, vitals, consultations, prescriptions and lab pick-ups.",
        campaignId: healthCampaign.id,
        campDate: today,
        startTime: "09:00",
        endTime: "17:00",
        venue: "Anganwadi Centre, Ulsoor Ward",
        city: "Bengaluru",
        capacity: 150,
        services: JSON.stringify(["General checkup", "Eye screening", "BP", "Glucose", "Anaemia test"]),
        status: "LIVE",
        coordinatorName: "Anjali Rao",
        createdByName: "Anjali Rao",
      },
    });
  } else if (
    liveCamp.campaignId !== healthCampaign.id ||
    liveCamp.status !== "LIVE" ||
    liveCamp.title !== "Free Community Health Checkup — Live (Today)"
  ) {
    // Repair in place (e.g. the row was created by an API test run): normalise
    // it into the demo live camp.
    liveCamp = await db.medicalCamp.update({
      where: { id: liveCamp.id },
      data: {
        campaignId: healthCampaign.id,
        status: "LIVE",
        campDate: today,
        title: "Free Community Health Checkup — Live (Today)",
        description: "Happening now — live demo camp with the full pathway in progress: queue, vitals, consultations, prescriptions and lab pick-ups.",
        venue: "Anganwadi Centre, Ulsoor Ward",
        city: "Bengaluru",
        capacity: 150,
        startTime: "09:00",
        endTime: "17:00",
        services: JSON.stringify(["General checkup", "Eye screening", "BP", "Glucose", "Anaemia test"]),
        coordinatorName: "Anjali Rao",
      },
    });
  }
  {
    for (const pair of [
      { orgId: angel.id, role: "HOST" },
      { orgId: lab.id, role: "SUPPORT" },
    ]) {
      const exists = await db.campPartner.findUnique({
        where: { campId_orgId: { campId: liveCamp.id, orgId: pair.orgId } },
      });
      if (!exists) {
        await db.campPartner.create({
          data: { campId: liveCamp.id, orgId: pair.orgId, role: pair.role, status: "ACCEPTED", respondedAt: new Date() },
        });
      }
    }
    for (const name of ["Dr. Meera Iyer", "Nurse Priya", "Pharmacist Suresh", "Lab Tech Kavya"]) {
      const pro = await db.healthProfessional.findFirst({ where: { name } });
      if (!pro) continue;
      const staffExists = await db.campStaff.findFirst({
        where: { campId: liveCamp.id, professionalId: pro.id },
      });
      if (!staffExists) {
        await db.campStaff.create({
          data: { campId: liveCamp.id, professionalId: pro.id, role: pro.kind, status: "ATTENDED" },
        });
      }
    }
  }

  // One beneficiary per queue stage so every screen has content.
  const journey = [
    { name: "Muniamma", stage: "CHECKED_IN", bp: [136, 86] },
    { name: "Shivanna", stage: "WAITING", bp: [148, 94] },
    { name: "Fatima Begum", stage: "IN_CONSULTATION", bp: [126, 82] },
    { name: "Gopal Krishna", stage: "COMPLETED", bp: [118, 76] },
    { name: "Sarala", stage: "NO_SHOW", bp: [0, 0] },
  ];
  const meera = await db.healthProfessional.findFirst({ where: { name: "Dr. Meera Iyer" } });
  let completedBeneficiaryId: string | null = null;
  let token = 0;
  for (const j of journey) {
    const beneficiary = await db.beneficiary.findFirst({ where: { name: j.name } });
    if (!beneficiary) continue;
    let reg = await db.campRegistration.findUnique({
      where: { campId_beneficiaryId: { campId: liveCamp.id, beneficiaryId: beneficiary.id } },
    });
    if (!reg) {
      reg = await db.campRegistration.create({
        data: {
          campId: liveCamp.id,
          beneficiaryId: beneficiary.id,
          code: await nextCode("UAR-CREG", (c) => db.campRegistration.findUnique({ where: { code: c } }).then(Boolean)),
          status: j.stage === "NO_SHOW" ? "CONFIRMED" : "CONFIRMED",
          registeredVia: j.stage === "NO_SHOW" ? "SELF" : "DESK",
          registeredByName: "Anjali Rao",
        },
      });
    }
    if (!(await db.campAttendance.findUnique({ where: { registrationId: reg.id } }))) {
      if (j.stage !== "NO_SHOW") token += 1;
      await db.campAttendance.create({
        data: {
          registrationId: reg.id,
          campId: liveCamp.id,
          beneficiaryId: beneficiary.id,
          status: j.stage,
          queueToken: j.stage === "NO_SHOW" ? null : token,
          checkInAt: j.stage === "NO_SHOW" ? null : new Date(Date.now() - (5 - token) * 15 * 60000),
          checkInMethod: token % 2 === 0 ? "QR" : "ID",
          operatorName: "Nurse Priya",
          doctorId: j.stage === "IN_CONSULTATION" || j.stage === "COMPLETED" ? (meera?.id ?? null) : null,
        },
      });
    }
    // Vitals for everyone who reached the screening desk.
    if (j.stage !== "NO_SHOW" && !(await db.vitalObservation.findFirst({ where: { beneficiaryId: beneficiary.id, campId: liveCamp.id } }))) {
      await db.vitalObservation.create({
        data: {
          beneficiaryId: beneficiary.id,
          campId: liveCamp.id,
          recordedByName: "Nurse Priya",
          bpSystolic: j.bp[0],
          bpDiastolic: j.bp[1],
          pulse: 72 + token,
          spo2: 97 + (token % 3),
          weightKg: 55 + token * 2,
          heightCm: 158,
          bmi: Number(((55 + token * 2) / Math.pow(1.58, 2)).toFixed(1)),
          glucose: 95 + token * 9,
        },
      });
    }
    if (j.stage === "COMPLETED") completedBeneficiaryId = beneficiary.id;
  }

  // Eye screening flag on the live camp (abnormal → referral demo).
  const sarala = await db.beneficiary.findFirst({ where: { name: "Sarala" } });
  if (sarala && !(await db.screeningRecord.findFirst({ where: { beneficiaryId: sarala.id, campId: liveCamp.id } }))) {
    await db.screeningRecord.create({
      data: {
        campId: liveCamp.id,
        beneficiaryId: sarala.id,
        type: "EYE",
        result: "Blurred vision at distance — probable refractive error, refer to eye-care partner",
        abnormal: true,
        recordedByName: "Nurse Priya",
      },
    });
  }

  // A signed consultation + partially dispensed prescription on the live camp.
  const gopal = await db.beneficiary.findFirst({ where: { name: "Gopal Krishna" } });
  const paracetamol = await db.inventoryItem.findFirst({ where: { name: "Paracetamol 500mg" } });
  const ors = await db.inventoryItem.findFirst({ where: { name: "ORS (sachet)" } });
  if (gopal && meera && liveCamp) {
    let encounter = await db.encounter.findFirst({
      where: { beneficiaryId: gopal.id, campId: liveCamp.id },
    });
    if (!encounter) {
      encounter = await db.encounter.create({
        data: {
          campId: liveCamp.id,
          beneficiaryId: gopal.id,
          doctorId: meera.id,
          status: "SIGNED",
          chiefComplaint: "Body ache and low-grade fever for two days",
          observations: "Afebrile now, mild fatigue; BP well controlled; no focal signs",
          diagnosis: "Viral fever — supportive care",
          advice: "Rest, plenty of fluids, return if fever exceeds 3 days",
          aiDraftUsed: false,
          signedAt: new Date(),
          signedByName: "Dr. Meera Iyer",
        },
      });
    }
    let rx = await db.prescription.findFirst({ where: { encounterId: encounter.id } });
    if (!rx) {
      rx = await db.prescription.create({
        data: {
          code: await nextCode("UAR-RX", (c) => db.prescription.findUnique({ where: { code: c } }).then(Boolean)),
          encounterId: encounter.id,
          campId: liveCamp.id,
          beneficiaryId: gopal.id,
          doctorId: meera.id,
          diagnosis: "Viral fever — supportive care",
          status: "SIGNED",
          signedAt: new Date(),
          signedByName: "Dr. Meera Iyer",
          items: {
            create: [
              { medicineName: "Paracetamol 500mg", strength: "500mg", dosage: "1 tablet", route: "ORAL", frequency: "1-0-1", durationDays: 3, quantity: 6, instructions: "After food" },
              { medicineName: "ORS (sachet)", strength: "", dosage: "1 sachet", route: "ORAL", frequency: "TDS", durationDays: 2, quantity: 6, instructions: "Dissolve in 1L water, sip through the day" },
            ],
          },
        },
      });
      // Partial dispense of the first item — pharmacy queue demo.
      const item = await db.prescriptionItem.findFirst({ where: { prescriptionId: rx.id, medicineName: "Paracetamol 500mg" } });
      if (item && paracetamol) {
        const dispensed = await db.medicationDispense.create({
          data: {
            prescriptionId: rx.id,
            itemId: item.id,
            beneficiaryId: gopal.id,
            campId: liveCamp.id,
            inventoryItemId: paracetamol.id,
            quantity: 6,
            pharmacistName: "Pharmacist Suresh",
          },
        });
        await db.inventoryItem.update({ where: { id: paracetamol.id }, data: { quantity: { decrement: 6 } } });
        await db.inventoryTransaction.create({
          data: {
            itemId: paracetamol.id,
            campId: liveCamp.id,
            type: "ISSUED",
            quantity: -6,
            source: "INTERNAL",
            refType: "DISPENSE",
            refId: rx.id,
            handledByName: "Pharmacist Suresh",
            notes: "Dispensed against " + rx.code,
          },
        });
        await db.prescription.update({ where: { id: rx.id }, data: { status: "PARTIALLY_DISPENSED" } });
        void dispensed;
      }
      void ors;
    }

    // Lab order mid-pipeline for the same beneficiary.
    if (!(await db.diagnosticOrder.findFirst({ where: { beneficiaryId: gopal.id, campId: liveCamp.id } }))) {
      await db.diagnosticOrder.create({
        data: {
          code: await nextCode("UAR-LAB", (c) => db.diagnosticOrder.findUnique({ where: { code: c } }).then(Boolean)),
          campId: liveCamp.id,
          beneficiaryId: gopal.id,
          encounterId: encounter.id,
          testName: "CBC + fasting glucose",
          status: "RESULT_AVAILABLE",
          orderedByName: "Dr. Meera Iyer",
          collectedAt: new Date(Date.now() - 3600000),
          resultText: "Hb 13.2 g/dL · WBC 7,800/µL · fasting glucose 104 mg/dL — within normal limits",
        },
      });
    }

    // Referral + follow-ups (one overdue PENDING for the follow-up worklist).
    let referral = await db.medicalReferral.findFirst({ where: { beneficiaryId: gopal.id } });
    if (!referral) {
      referral = await db.medicalReferral.create({
        data: {
          code: await nextCode("UAR-REF", (c) => db.medicalReferral.findUnique({ where: { code: c } }).then(Boolean)),
          beneficiaryId: gopal.id,
          campId: liveCamp.id,
          encounterId: encounter.id,
          reason: "Routine cardiology review — family history of early heart disease",
          priority: "MEDIUM",
          receivingOrgId: angel.id,
          speciality: "Cardiology",
          referralDoctorName: "Dr. Meera Iyer",
          status: "ACCEPTED",
        },
      });
      await db.followUp.create({
        data: {
          beneficiaryId: gopal.id,
          campId: liveCamp.id,
          referralId: referral.id,
          dueDate: new Date(Date.now() - 3 * 86400000), // overdue — appears in follow-up worklist
          instructions: "Confirm cardiology appointment at Angel Multispeciality",
          ownerName: "Anjali Rao",
          status: "PENDING",
        },
      });
      const shivannaReg = await db.beneficiary.findFirst({ where: { name: "Shivanna" } });
      if (shivannaReg) {
        await db.followUp.create({
          data: {
            beneficiaryId: shivannaReg.id,
            campId: liveCamp.id,
            dueDate: new Date(Date.now() + 5 * 86400000),
            instructions: "Repeat BP reading after 1 week of salt reduction",
            ownerName: "Nurse Priya",
            status: "PENDING",
          },
        });
      }
    }
  }

  // Camp expenses on the past camp for the finance cards.
  if (pastCamp) {
    for (const ex of [
      { head: "Medicines & consumables", amount: 18400 },
      { head: "Venue & logistics", amount: 6500 },
      { head: "Lab pick-up charges", amount: 3200 },
    ]) {
      const exists = await db.campExpense.findFirst({ where: { campId: pastCamp.id, head: ex.head } });
      if (!exists) {
        await db.campExpense.create({
          data: { campId: pastCamp.id, head: ex.head, amount: ex.amount, spentByName: "Anjali Rao", spentAt: pastCamp.campDate },
        });
      }
    }
  }
  console.log("  ✓ live demo camp + pathway-in-flight data (queue, consults, rx, labs, referral, follow-ups, expenses)");

  console.log("🏥 Healthcare seed complete. Logins: hospital@demo.org/Hospital@123 · dr.meera@demo.org/Doctor@123 · dr.arjun@demo.org/Doctor@123 · nurse@demo.org/Nurse@123 · pharmacist@demo.org/Pharm@123 · labtech@demo.org/Lab@123");
}

// ==================== URGENT CAMPAIGN SEED (idempotent) ====================
// Appended by the urgent-appeals feature round. Upserts the flood-relief demo
// campaign find-by-slug then create/update — never duplicates, safe to re-run.
async function seedUrgentCampaign() {
  console.log("\ud83d\udea8 Seeding urgent campaign (flood-relief)\u2026");

  // All four URLs verified HTTP 200 (Unsplash CDN) before seeding.
  const FLOOD_GALLERY = [
    "https://images.unsplash.com/photo-1593113630400-ea4288922497?w=1200&q=80&auto=format&fit=crop", // volunteers loading relief supplies
    "https://images.unsplash.com/photo-1587745416684-47953f16f02f?w=1200&q=80&auto=format&fit=crop", // ambulance / rescue response
    "https://images.unsplash.com/photo-1542810634-71277d95dcbb?w=1200&q=80&auto=format&fit=crop", // sheltered families
    "https://images.unsplash.com/photo-1532629345422-7515f3d16bb6?w=1200&q=80&auto=format&fit=crop", // donor hands / relief fund
  ];

  const existing = await db.campaign.findUnique({ where: { slug: "flood-relief" } });
  if (existing) {
    // Repair-in-place: only ensure demo-critical state; never clobber live progress.
    await db.campaign.update({
      where: { slug: "flood-relief" },
      data: {
        urgent: true,
        featured: true,
        status: "ACTIVE",
        gallery: JSON.stringify(FLOOD_GALLERY),
        coverImage: FLOOD_GALLERY[0],
      },
    });
    console.log("  \u2713 urgent campaign flood-relief (already existed \u2014 updated, not duplicated)");
    return;
  }

  // Collision-safe code generator (mirrors the healthcare block).
  let n = 1;
  let code = `UAR-CMP-${String(n).padStart(5, "0")}`;
  while (await db.campaign.findUnique({ where: { code } }).then(Boolean)) {
    n += 1;
    code = `UAR-CMP-${String(n).padStart(5, "0")}`;
  }

  await db.campaign.create({
    data: {
      code,
      slug: "flood-relief",
      title: "Emergency Flood Relief \u2014 North Bengaluru",
      tagline: "Boat rescues, relief kits, clean water and health camps for families hit by the North Bengaluru floods \u2014 every kit QR-traced to the door it reaches.",
      description: "UAR's emergency response to the North Bengaluru floods works shoulder-to-shoulder with NDRF/SDRF, fire services and ward flood desks: night-one boat rescues, QR-tracked relief kits (dry ration, tarpaulins, blankets, hygiene kits), water tanker and purification-tablet refills through the first 72 hours, and medical camps screening for cholera, leptospirosis and dengue before outbreaks start. Every kit, every litre, every consult is logged so donors see exactly what their rupee delivered.",
      category: "EMERGENCY",
      targetAmount: 1500000,
      raisedAmount: 412000,
      beneficiaries: 5200,
      volunteersEngaged: 46,
      icon: "siren",
      accent: "red",
      urgent: true,
      featured: true,
      status: "ACTIVE",
      helpline: "108",
      startDate: daysFromNow(-7),
      gallery: JSON.stringify(FLOOD_GALLERY),
      coverImage: FLOOD_GALLERY[0],
      createdBy: "seed",
    },
  });
  console.log("  \u2713 urgent campaign flood-relief (created)");
}

// ── Food Security & Community Nutrition (docs/food.md round) ────────────
async function seedFoodSecurity() {
  console.log("🍎 Seeding food security module…");

  // Programme 1 — monthly ration (reuses the ration-kits fundraising campaign)
  let rationProgramme = await db.foodProgramme.findUnique({ where: { code: "UAR-FSP-00001" } });
  if (!rationProgramme) {
    const rationCampaign = await db.campaign.findUnique({ where: { slug: "ration-kits" } });
    rationProgramme = await db.foodProgramme.create({
      data: {
        code: "UAR-FSP-00001",
        slug: "monthly-family-ration",
        title: "Monthly Family Ration Assistance",
        description: "Every registered family receives a grocery kit sized to its household on a fixed monthly cycle — rice, atta, dal, oil and essentials, verified at handover with a QR scan.",
        category: "MONTHLY_RATION",
        targetGroup: "Families below the poverty line, daily-wage workers in crisis, households with seniors or children",
        geographicCoverage: "Bengaluru Urban · expanding to Mysuru",
        frequency: "MONTHLY",
        assistanceCategories: JSON.stringify(["GROCERY_KIT", "MONTHLY_RATION"]),
        eligibilityCriteria: "Household income below ₹12,000/month — self-declared, verified by staff call",
        coordinatorName: "Priya Nair",
        coordinatorPhone: "+91 90190 30010",
        campaignId: rationCampaign?.id ?? null,
        budget: 400000,
        fundraisingTarget: 600000,
        publicVisible: true,
        status: "ACTIVE",
        createdByName: "Admin",
      },
    });
  }

  // Programme 2 — festival distribution (published, upcoming)
  let festivalProgramme = await db.foodProgramme.findUnique({ where: { code: "UAR-FSP-00002" } });
  if (!festivalProgramme) {
    festivalProgramme = await db.foodProgramme.create({
      data: {
        code: "UAR-FSP-00002",
        slug: "festival-food-distribution",
        title: "Festival Food Distribution",
        description: "Ramadan, Deepavali and Pongal special kits so celebration never skips a household — festive essentials alongside the monthly ration.",
        category: "FESTIVAL",
        targetGroup: "All registered families + new applicants during festival weeks",
        geographicCoverage: "Bengaluru",
        frequency: "ONE_TIME",
        assistanceCategories: JSON.stringify(["GROCERY_KIT", "COOKED_MEAL"]),
        eligibilityCriteria: "Open registration — first-come, capacity-limited",
        coordinatorName: "Anjali Rao",
        publicVisible: true,
        status: "PUBLISHED",
        createdByName: "Admin",
      },
    });
  }

  // Package template = the existing ration kit template (kind RATION/FOOD)
  const rationTemplate = await db.kitTemplate.findFirst({
    where: { OR: [{ kind: "RATION" }, { kind: "FOOD" }] },
  });

  // Events — one upcoming open-for-registration, one past completed
  let upcomingEvent = await db.foodEvent.findUnique({ where: { code: "UAR-FEVT-00001" } });
  if (!upcomingEvent) {
    upcomingEvent = await db.foodEvent.create({
      data: {
        code: "UAR-FEVT-00001",
        programmeId: rationProgramme.id,
        campaignId: rationProgramme.campaignId,
        title: "Monthly Family Ration — Peenya distribution",
        description: "200 family grocery kits handed out at the Peenya community ground. Bring your registration code — assisted registration available at the desk.",
        eventDate: daysFromNow(9),
        startTime: "09:00",
        endTime: "14:00",
        venue: "Community Ground, Peenya Industrial Area",
        city: "Bengaluru",
        address: "Near Peenya Metro Station, exit B (staff only)",
        eventType: "MONTHLY_KIT",
        packageTemplateId: rationTemplate?.id ?? null,
        plannedUnits: 200,
        maxCapacity: 220,
        coordinatorName: "Priya Nair",
        registrationOpen: true,
        publicVisible: true,
        specialInstructions: "Queue opens 8:30. Wheelchair-accessible entrance on the east side.",
        status: "REGISTRATION_OPEN",
        createdByName: "Admin",
      },
    });
  }

  let pastEvent = await db.foodEvent.findUnique({ where: { code: "UAR-FEVT-00002" } });
  if (!pastEvent) {
    pastEvent = await db.foodEvent.create({
      data: {
        code: "UAR-FEVT-00002",
        programmeId: rationProgramme.id,
        campaignId: rationProgramme.campaignId,
        title: "Monthly Family Ration — Whitefield distribution",
        description: "Completed monthly distribution kept for reporting and impact demos.",
        eventDate: daysFromNow(-12),
        startTime: "09:00",
        endTime: "13:00",
        venue: "Govt PU College Ground, Whitefield",
        city: "Bengaluru",
        eventType: "MONTHLY_KIT",
        plannedUnits: 150,
        maxCapacity: 150,
        coordinatorName: "Priya Nair",
        publicVisible: true,
        status: "RECONCILED",
        createdByName: "Admin",
      },
    });
  }

  // Food batches — every FOOD_KIT master quantity is explained exactly by its
  // batch ledger (received − consumed − wasted − returned = master quantity),
  // so #/admin/inventory and the food batches desk always agree. This block
  // is self-repairing: it rewrites the canonical demo ledger on every seed.
  const rice = await db.inventoryItem.findFirst({ where: { name: { contains: "Rice" } } });
  const dal = await db.inventoryItem.findFirst({ where: { name: { contains: "Toor dal" } } });
  const flour = await db.inventoryItem.findFirst({ where: { name: { contains: "Wheat flour" } } });
  if (rice && dal && flour) {
    const canonical: Array<Record<string, unknown>> = [
      { itemId: rice.id, batchNo: "RICE-2026-A", source: "PURCHASED", supplierName: "Sri Lakshmi Wholesalers", quantityReceived: 120, mfgDate: daysFromNow(-40), expiryDate: daysFromNow(320), qualityStatus: "PASSED", inspectedByName: "Admin", inspectedAt: new Date(), tempRequirement: "AMBIENT", status: "ACTIVE", quantityReserved: 0, quantityConsumed: 0, quantityWasted: 0, quantityReturned: 0, createdByName: "Admin" },
      { itemId: rice.id, batchNo: "RICE-2026-B", source: "DONATED", donorName: "TechM Cares CSR", quantityReceived: 60, mfgDate: daysFromNow(-90), expiryDate: daysFromNow(18), qualityStatus: "PASSED", inspectedByName: "Admin", inspectedAt: new Date(), tempRequirement: "AMBIENT", status: "ACTIVE", quantityReserved: 0, quantityConsumed: 0, quantityWasted: 0, quantityReturned: 0, createdByName: "Admin" },
      { itemId: dal.id, batchNo: "DAL-2026-A", source: "PURCHASED", supplierName: "Sri Lakshmi Wholesalers", quantityReceived: 25, expiryDate: daysFromNow(200), qualityStatus: "PASSED", inspectedByName: "Admin", inspectedAt: new Date(), status: "ACTIVE", quantityReserved: 0, quantityConsumed: 0, quantityWasted: 0, quantityReturned: 0, createdByName: "Admin" },
      { itemId: flour.id, batchNo: "ATTA-2026-A", source: "DONATED", donorName: "Nandini Rao", quantityReceived: 60, expiryDate: daysFromNow(75), qualityStatus: "PENDING", status: "ACTIVE", quantityReserved: 0, quantityConsumed: 0, quantityWasted: 0, quantityReturned: 0, createdByName: "Admin" },
      { itemId: flour.id, batchNo: "ATTA-2026-B", source: "PURCHASED", supplierName: "Sri Lakshmi Wholesalers", quantityReceived: 30, expiryDate: daysFromNow(120), qualityStatus: "PASSED", inspectedByName: "Admin", inspectedAt: new Date(), status: "ACTIVE", quantityReserved: 0, quantityConsumed: 0, quantityWasted: 0, quantityReturned: 0, createdByName: "Admin" },
      // Expired write-off demo: received 30, all 30 wasted — contributes zero.
      { itemId: dal.id, batchNo: "DAL-2026-B", source: "RECOVERED", supplierName: "Metro Cash & Carry surplus", quantityReceived: 30, expiryDate: daysFromNow(-5), qualityStatus: "PASSED", status: "BLOCKED", rejectionReason: "Expired — blocked from allocation by food safety rule", quantityReserved: 0, quantityConsumed: 0, quantityWasted: 30, quantityReturned: 0, createdByName: "Admin" },
    ];
    for (const b of canonical) {
      const batchNo = b.batchNo as string;
      await db.foodBatch.upsert({
        where: { itemId_batchNo: { itemId: b.itemId as string, batchNo } },
        update: b,
        create: { ...(b as object), batchNo } as never,
      });
    }
    // Drop any non-canonical batches left on these items, then set each
    // master quantity to the exact ledger sum.
    for (const item of [rice, dal, flour]) {
      await db.foodBatch.deleteMany({
        where: { itemId: item.id, batchNo: { notIn: canonical.map((b) => b.batchNo as string) } },
      });
      const ledger = await db.foodBatch.findMany({ where: { itemId: item.id } });
      const net = ledger.reduce(
        (sum, b) => sum + b.quantityReceived - b.quantityConsumed - b.quantityWasted - b.quantityReturned,
        0
      );
      await db.inventoryItem.update({ where: { id: item.id }, data: { quantity: net } });
    }
    console.log("  ✓ food batch ledger reconciled to master inventory (rice 180 · atta 90 · dal 25)");
  }

  // Household demo
  if ((await db.household.count()) === 0) {
    const fatima = await db.beneficiary.findFirst({ where: { name: "Fatima Begum" } });
    const sarala = await db.beneficiary.findFirst({ where: { name: "Sarala" } });
    if (fatima) {
      const household = await db.household.create({
        data: {
          code: "UAR-HOU-00001",
          name: "Fatima Begum household",
          headBeneficiaryId: fatima.id,
          primaryPhone: fatima.phone,
          city: "Bengaluru",
          size: 5,
          childrenCount: 2,
          seniorCount: 1,
          createdByName: "Admin",
        },
      });
      await db.householdMember.create({
        data: { householdId: household.id, beneficiaryId: fatima.id, name: "Fatima Begum", relation: "HEAD" },
      });
      if (sarala)
        await db.householdMember.create({
          data: { householdId: household.id, beneficiaryId: sarala.id, name: "Sarala", relation: "OTHER" },
        });
    }
    console.log("  ✓ household (1 with members)");
  }

  // Registrations: past event fully distributed; upcoming event with approvals
  if ((await db.foodRegistration.count()) === 0) {
    const bens = await db.beneficiary.findMany({ take: 5, orderBy: { code: "asc" } });
    const household = await db.household.findFirst();
    let seq = 0;
    const mkReg = async (
      event: { id: string }, b: { id: string }, status: string,
      extra: Record<string, unknown> = {}
    ) => {
      seq += 1;
      return db.foodRegistration.create({
        data: {
          code: `UAR-FREG-${String(seq).padStart(5, "0")}`,
          eventId: event.id,
          beneficiaryId: b.id,
          householdId: household?.id ?? null,
          unitsAllocated: 1,
          packageSnapshot: rationTemplate?.items ?? null,
          status,
          registeredVia: "DESK",
          createdByName: "Admin",
          ...extra,
        },
      });
    };
    if (bens[0]) await mkReg(pastEvent, bens[0], "DISTRIBUTED", { unitsDelivered: 1, ackMethod: "OTP", ackRef: "4821", ackByName: "Volunteer Ravi", ackAt: daysFromNow(-12) });
    if (bens[1]) await mkReg(pastEvent, bens[1], "DISTRIBUTED", { unitsDelivered: 1, ackMethod: "DIGITAL", ackByName: "Volunteer Ravi", ackAt: daysFromNow(-12) });
    if (bens[2]) await mkReg(pastEvent, bens[2], "PARTIALLY_DISTRIBUTED", { unitsDelivered: 1, reason: "PARTIAL_COLLECTION" });
    if (bens[3]) await mkReg(pastEvent, bens[3], "NO_SHOW", { reason: "NO_SHOW" });
    if (bens[4]) await mkReg(pastEvent, bens[4], "DISTRIBUTED", { unitsDelivered: 1, ackMethod: "SIGNATURE", ackByName: "Volunteer Meena", ackAt: daysFromNow(-12) });
    for (const b of bens.slice(0, 3)) await mkReg(upcomingEvent, b, "APPROVED");
    console.log("  ✓ food registrations (5 distributed on past event, 3 approved on upcoming)");
  }

  // Public food assistance applications
  if ((await db.beneficiaryRequest.count({ where: { category: "FOOD_ASSISTANCE" } })) === 0) {
    await db.beneficiaryRequest.createMany({
      data: [
        {
          refCode: "UAR-FAR-00001",
          name: "Ramesh Kumar", phone: "9019030011", category: "FOOD_ASSISTANCE",
          urgency: "HIGH", source: "SELF", status: "PENDING",
          details: "Lost my job last month — two school-going children, need monthly grocery support until I find work.",
          address: "BTM Layout", city: "Bengaluru", pincode: "560076",
          familyMembers: 4, childrenCount: 2, seniorCount: 0,
          preferredContact: "WHATSAPP", consent: true,
        },
        {
          refCode: "UAR-FAR-00002",
          name: "Zainab Amina", phone: "9019030012", category: "FOOD_ASSISTANCE",
          urgency: "CRITICAL", source: "EMERGENCY", status: "IN_REVIEW",
          details: "Flood water entered our home — everything spoiled. Need immediate food packets and dry ration for a week.",
          address: "KR Market", city: "Bengaluru", pincode: "560002",
          familyMembers: 6, childrenCount: 3, seniorCount: 2,
          preferredContact: "PHONE", consent: true,
        },
      ],
    });
    console.log("  ✓ food assistance applications (2)");
  }

  // Expense history on the past event
  if ((await db.foodEventExpense.count()) === 0) {
    await db.foodEventExpense.createMany({
      data: [
        { eventId: pastEvent.id, head: "Grocery purchase — toor dal top-up", amount: 18400, spentByName: "Admin" },
        { eventId: pastEvent.id, head: "Transport — tempo rental", amount: 4500, spentByName: "Admin" },
        { eventId: pastEvent.id, head: "Packaging materials", amount: 3100, spentByName: "Admin" },
      ],
    });
    console.log("  ✓ food event expenses (3)");
  }

  console.log("🍎 Food security seed complete.");
}

main()
  .then(() => seedHealthcare())
  .then(() => seedUrgentCampaign())
  .then(() => seedFoodSecurity())
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
