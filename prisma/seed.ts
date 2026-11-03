/**
 * United Angel Reach — canonical seed (merged schema).
 * Run: bun prisma/seed.ts   (fresh DB: bun run db:reset)
 */
import { PrismaClient } from "@prisma/client";
import crypto from "crypto";

const db = new PrismaClient();

function hashPassword(pw: string): string {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(pw, salt, 32).toString("hex");
  return `${salt}:${hash}`;
}

function daysFromNow(d: number): Date {
  return new Date(Date.now() + d * 86400000);
}

async function main() {
  console.log("🌱 Seeding United Angel Reach (canonical)…");

  // ── Users ──────────────────────────────────────────────────────────────
  const users: Record<string, string> = {};
  const userDefs = [
    { key: "admin", name: "Anjali Rao", email: "admin@unitedangelreach.org", password: "Admin@123", role: "ADMIN", city: "Bengaluru", phone: "+91 98860 10001" },
    { key: "donor", name: "Rahul Sharma", email: "donor@demo.org", password: "Donor@123", role: "DONOR", city: "Bengaluru", phone: "+91 98860 10002" },
    { key: "volunteer", name: "Priya Nair", email: "volunteer@demo.org", password: "Volun@123", role: "VOLUNTEER", city: "Bengaluru", phone: "+91 98860 10003" },
    { key: "applicant", name: "Arjun Kumar", email: "applicant@demo.org", password: "Temp@12345", role: "VOLUNTEER", city: "Mysuru", phone: "+91 98860 10004" },
    { key: "beneficiary", name: "Lakshmi Devi", email: "beneficiary@demo.org", password: "Benef@123", role: "BENEFICIARY", city: "Bengaluru", phone: "+91 98860 10005" },
  ];
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
    create: { userId: users.volunteer, skills: JSON.stringify(["FIELD_OPS", "TEACHING", "KIT_SCAN"]), assignedArea: "Bengaluru South", status: "ACTIVE", availability: "WEEKENDS" },
  });
  await db.volunteer.upsert({
    where: { userId: users.applicant },
    update: {},
    create: { userId: users.applicant, skills: JSON.stringify(["FIELD_OPS"]), status: "PENDING", assignedArea: "Mysuru" },
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
    { slug: "anti-drug", title: "Sankalp Against Substance — Anti-Drug", tagline: "Awareness, de-addiction guidance and family support — addiction is a health condition, not a crime.", category: "AWARENESS", description: "School & college modules, workplace sessions, family counselling camps and rehab referrals across Bengaluru. Volunteers teach the 5-step helping playbook and connect people to the free National De-addiction Helpline 14446.", targetAmount: 800000, raisedAmount: 436500, beneficiaries: 12400, volunteersEngaged: 86, icon: "shield-alert", accent: "orange", featured: true, helpline: "14446" },
    { slug: "cyber-crime", title: "CyberSuraksha — Cyber Crime Safety", tagline: "Beat the golden hour: 1930, cybercrime.gov.in and scam-recognition training for every family.", category: "AWARENESS", description: "Bengaluru reports 1,000+ cyber frauds daily. We teach the 60-minute rescue playbook, run RWA and senior-citizen cyber-hygiene workshops, and handhold victims through 1930 + cybercrime.gov.in filings.", targetAmount: 500000, raisedAmount: 289000, beneficiaries: 8600, volunteersEngaged: 42, icon: "smartphone", accent: "cyan", featured: true, helpline: "1930" },
    { slug: "women-safety", title: "Suraksha — Women Safety", tagline: "Self-defence, legal power and 112/181/1091 readiness for every woman and girl.", category: "AWARENESS", description: "Free 15-day self-defence batches, POSH workplace workshops, safe-city drives and survivor support with legal-aid tie-ups. We teach the DV Act 2005, POSH Act 2013 and the trust-your-gut playbook.", targetAmount: 900000, raisedAmount: 512000, beneficiaries: 7800, volunteersEngaged: 64, icon: "heart-handshake", accent: "fuchsia", featured: true, helpline: "181" },
    { slug: "child-safety", title: "Little Angels Shield — Child Safety (POCSO)", tagline: "Underwear rule, safe-adult lists and POCSO training for schools, tuitions and homes.", category: "AWARENESS", description: "Age-appropriate safety education in schools, tuitions and orphanages; teacher verification toolkits; parent seminars. One number for any child in distress: CHILDLINE 1098.", targetAmount: 700000, raisedAmount: 398000, beneficiaries: 21500, volunteersEngaged: 58, icon: "baby", accent: "amber", featured: true, helpline: "1098" },
    { slug: "medicine-adoption", title: "Adopt-a-Medicine — monthly tablets for the needy", tagline: "₹150/month keeps a BP or diabetes patient alive. Adopt a real, verified patient today.", category: "MEDICAL", description: "A registry of verified patients who skip BP, sugar, thyroid and cardiac tablets because they cost ₹800–2,500/month. Donors adopt patients fully, partially or monthly — with refill proof and 80G receipts.", targetAmount: 1200000, raisedAmount: 645000, beneficiaries: 3200, volunteersEngaged: 38, icon: "pill", accent: "teal", featured: true },
    { slug: "animal-welfare", title: "Angel Paws — Animal Adoption & Food", tagline: "Adopt, don't shop. Feed a street dog for a month for ₹900. Rescue. Vaccinate. Love.", category: "ANIMAL_WELFARE", description: "Street-animal feeding zones, rescue coordination with CUPA/BAWA, ABC vaccination-sterilisation drives and an adoption platform for Indie dogs, cats and rescued cows.", targetAmount: 600000, raisedAmount: 331000, beneficiaries: 4100, volunteersEngaged: 74, icon: "paw-print", accent: "lime", featured: true, helpline: "1962" },
    { slug: "green-corridor", title: "AI Green Corridor — ambulances that clear their own path", tagline: "Traffic ahead knows before the siren does: 5G V2X → cellular → Bluetooth mesh → FM break-in.", category: "MOBILITY", description: "Bengaluru ambulances average 11 km/h; cardiac survival drops every minute. Our corridor mesh alerts vehicles up to 2 km ahead via V2X and offline Bluetooth beacons, cutting run time 40–60%.", targetAmount: 1500000, raisedAmount: 821000, beneficiaries: 5600, volunteersEngaged: 95, icon: "siren", accent: "red", featured: true, helpline: "108" },
    { slug: "ration-kits", title: "Ration Kit Mission — QR-coded food security", tagline: "Rice, atta, dal, oil — packed, QR-labelled, handed with dignity, tracked to the last kit.", category: "FOOD_DISTRIBUTION", description: "Every kit carries a unique code (UAR-RK-2026-XXXXXX). Volunteers scan at handover — inventory auto-decrements and every family is logged with time, place and volunteer.", targetAmount: 1000000, raisedAmount: 558000, beneficiaries: 18700, volunteersEngaged: 112, icon: "package", accent: "emerald", featured: true },
    { slug: "sanitary-pads", title: "Project Dignity — Sanitary Pad Banks", tagline: "No girl should miss school because of her period. Pad banks + awareness for all.", category: "SANITARY_PADS", description: "Pad-bank vending in government schools, slum communities and factory clusters; biodegradable awareness; anemia camps. Sessions include boys — because stigma ends with everyone.", targetAmount: 500000, raisedAmount: 276000, beneficiaries: 9400, volunteersEngaged: 47, icon: "flower-2", accent: "pink", featured: true },
  ];
  for (const c of campaigns) {
    await db.campaign.upsert({
      where: { slug: c.slug },
      update: {},
      create: { ...c, createdBy: "seed", status: "ACTIVE" },
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
        { name: "Brownie", species: "DOG", breed: "Indie", ageMonths: 24, gender: "MALE", story: "Rescued near KR Puram with a hind-leg fracture; healed fully after surgery. Gentle with kids, house-trained.", healthStatus: "Fully recovered", vaccinated: true, sterilized: true, location: "KR Puram, Bengaluru", status: "AVAILABLE", monthlyFood: 900 },
        { name: "Simba", species: "DOG", breed: "Indie", ageMonths: 8, gender: "MALE", story: "Abandoned puppy found inside a cardboard box in Indiranagar. Playful, vaccinated, ready for a forever home.", healthStatus: "Healthy", vaccinated: true, sterilized: false, location: "Indiranagar, Bengaluru", status: "AVAILABLE", monthlyFood: 800 },
        { name: "Kitty", species: "CAT", breed: "Domestic short-hair", ageMonths: 18, gender: "FEMALE", story: "Rescued from a storm drain in Malleshwaram. Quiet, affectionate, litter-trained.", healthStatus: "Healthy", vaccinated: true, sterilized: true, location: "Malleshwaram, Bengaluru", status: "AVAILABLE", monthlyFood: 700 },
        { name: "Lakshmi", species: "COW", breed: "Hallikar mix", ageMonths: 96, gender: "FEMALE", story: "Abandoned after milk yield dropped; rescued from a highway median. Now at our partner goshala, needs monthly fodder sponsor.", healthStatus: "Underweight, improving", vaccinated: true, sterilized: false, location: "Partner goshala, Nelamangala", status: "FOSTERED", monthlyFood: 2500 },
        { name: "Mithu", species: "BIRD", breed: "Rose-ringed parakeet", ageMonths: 14, gender: "MALE", story: "Rescued from an illegal seller; wing healed after clipping injury. Sensitive — needs a patient home or aviary.", healthStatus: "Recovering", vaccinated: false, sterilized: false, location: "CUPA shelter, Bengaluru", status: "AVAILABLE", monthlyFood: 400 },
        { name: "Raja", species: "DOG", breed: "Indie", ageMonths: 60, gender: "MALE", story: "Community dog of HSR Layout Sector 2, fed by our volunteer route. Critical after a road accident — needs surgery funds.", healthStatus: "Fracture surgery pending", vaccinated: true, sterilized: true, location: "HSR Layout, Bengaluru", status: "CRITICAL", monthlyFood: 900 },
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
  }

  // ── Inventory ──────────────────────────────────────────────────────────
  if ((await db.inventoryItem.count()) === 0) {
    await db.inventoryItem.createMany({
      data: [
        { name: "Rice (25kg sacks)", category: "FOOD_KIT", quantity: 180, unit: "sack", minStock: 40, location: "Central Warehouse, Peenya" },
        { name: "Wheat flour", category: "FOOD_KIT", quantity: 90, unit: "kg", minStock: 30, location: "Central Warehouse, Peenya" },
        { name: "Toor dal", category: "FOOD_KIT", quantity: 25, unit: "kg", minStock: 25, location: "Central Warehouse, Peenya" },
        { name: "Sanitary pads (packs)", category: "SANITARY_PADS", quantity: 420, unit: "pack", minStock: 100, location: "Pad Bank, Jayanagar" },
        { name: "BP tablets (Amlodipine)", category: "MEDICINE", quantity: 350, unit: "pack", minStock: 80, location: "Medicine Hub, Jayanagar" },
        { name: "Diabetes tablets (Metformin)", category: "MEDICINE", quantity: 60, unit: "pack", minStock: 80, location: "Medicine Hub, Jayanagar" },
        { name: "Dog feed (dry, 20kg)", category: "ANIMAL_FEED", quantity: 48, unit: "sack", minStock: 15, location: "Angel Paws Hub, HSR" },
        { name: "First-aid kits", category: "EQUIPMENT", quantity: 30, unit: "box", minStock: 10, location: "Ambulance Base, Bannerghatta" },
      ],
    });
  }

  // ── Beneficiaries ──────────────────────────────────────────────────────
  if ((await db.beneficiary.count()) === 0) {
    await db.beneficiary.createMany({
      data: [
        { name: "Muniamma", phone: "+91 90190 30001", city: "Bengaluru", category: "WIDOW", urgencyLevel: "HIGH", familyMembers: 2, monthlyIncome: 3500, monthlyNeed: 1850, onboardedByName: "Priya Nair", notes: "BP + ration support, Jayanagar" },
        { name: "Shivanna", phone: "+91 90190 30002", city: "Bengaluru", category: "DAILY_WAGE", urgencyLevel: "CRITICAL", familyMembers: 4, monthlyIncome: 8000, monthlyNeed: 2600, onboardedByName: "Anjali Rao", notes: "Construction worker, Whitefield camp" },
        { name: "Fatima Begum", phone: "+91 90190 30003", city: "Bengaluru", category: "SINGLE_MOTHER", urgencyLevel: "HIGH", familyMembers: 5, monthlyIncome: 6000, monthlyNeed: 2100, onboardedByName: "Priya Nair" },
        { name: "Gopal Krishna", phone: "+91 90190 30004", city: "Mysuru", category: "ELDERLY", urgencyLevel: "MEDIUM", familyMembers: 3, monthlyIncome: 9000, monthlyNeed: 3200 },
        { name: "Sarala", phone: "+91 90190 30005", city: "Bengaluru", category: "PATIENT", urgencyLevel: "HIGH", familyMembers: 3, monthlyIncome: 7500, monthlyNeed: 1550 },
        { name: "Lakshmi Devi", phone: "+91 98860 10005", city: "Bengaluru", category: "ELDERLY", urgencyLevel: "MEDIUM", familyMembers: 2, monthlyIncome: 2400, monthlyNeed: 1400 },
      ],
    });
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
    await db.donation.createMany({
      data: [
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
      ],
    });
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
  const settings: [string, string, string][] = [
    ["org.name", "United Angel Reach Trust", "Organisation name"],
    ["org.hq", "Bengaluru, Karnataka, India", "Headquarters"],
    ["org.vision", "From Bengaluru to the whole of India — every district served", "Vision statement"],
    ["org.email", "care@unitedangelreach.org", "Contact email"],
    ["org.80g", "UAR/80G/2024/0147", "80G registration number"],
    ["logs.level", "info", "Application log level"],
    ["logs.retention", "90", "Log retention days"],
    ["lang.default", "en", "Default language"],
    ["lang.enabled", "en,hi,kn", "Enabled languages"],
    ["payments.upi", "unitedangelreach@upi", "UPI ID"],
    ["payments.razorpay", "", "Razorpay key id"],
    ["payments.gst", "", "GST number"],
    ["sms.enabled", "true", "SMS notifications"],
    ["sms.provider", "msg91", "SMS provider"],
    ["email.enabled", "true", "Email notifications"],
    ["email.from", "care@unitedangelreach.org", "From address"],
    ["whatsapp.enabled", "true", "WhatsApp updates"],
    ["assist.model", "glm-4.5-air", "Assistant model"],
  ];
  for (const [key, value, description] of settings) {
    await db.setting.upsert({ where: { key }, update: { value }, create: { key, value, description } });
  }

  // ── Settings — Round-2 canonical keys (create-only: never clobber admin edits) ─
  const canonicalSettings: [string, string, string][] = [
    ["org.name", "United Angel Reach", "Organisation name"],
    ["org.hq", "Bengaluru, Karnataka", "Headquarters"],
    ["org.address", "Seva Sadana, 42, 7th Cross, Jayanagar 4th Block, Bengaluru — 560070, Karnataka", "Registered office address"],
    ["org.email", "care@unitedangelreach.org", "Contact email"],
    ["org.phone", "+91 80 4712 0000", "Office phone"],
    ["org.pan", "AABTU4521K", "Trust PAN"],
    ["org.80g", "UAR/80G/2019/BLR", "80G registration number"],
    ["org.reg12a", "UAR/12A/2019/BLR", "12A registration number"],
    ["org.darpan", "KA/2019/0245678", "NITI Aayog Darpan ID"],
    ["org.website", "https://unitedangelreach.org", "Public website"],
    ["org.vision", "To scale our service model to serve all of India", "Vision statement"],
    ["receipts.signatoryName", "Anjali Rao", "Default signatory on receipts & certificates"],
    ["receipts.signatoryRole", "Managing Trustee", "Signatory role"],
    ["receipts.footer", "United Angel Reach is a registered charitable trust. Donations are eligible for deduction u/s 80G of the Income-tax Act, 1961. This document is system-generated and valid without a physical signature when it carries the trust seal and registration numbers.", "Receipt/certificate footer note"],
    ["finance.upiId", "unitedangelreach@upi", "Donation UPI ID"],
    ["finance.razorpayKeyId", "rzp_test_\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022", "Payment gateway key id (masked placeholder)"],
    ["finance.gatewayEnabled", "true", "Online payment gateway enabled"],
    ["finance.currency", "INR", "Donation currency"],
    ["notify.email.enabled", "true", "Email notifications enabled"],
    ["notify.email.host", "smtp.unitedangelreach.org", "SMTP host"],
    ["notify.email.port", "587", "SMTP port"],
    ["notify.email.from", "care@unitedangelreach.org", "From address"],
    ["notify.email.fromName", "United Angel Reach", "From name"],
    ["notify.email.secure", "true", "STARTTLS/secure SMTP"],
    ["notify.sms.enabled", "true", "SMS notifications enabled"],
    ["notify.sms.provider", "msg91", "SMS provider"],
    ["notify.sms.senderId", "UARNGO", "DLT sender ID"],
    ["notify.sms.endpoint", "https://api.msg91.com/api/v5/flow/", "SMS API endpoint"],
    ["notify.whatsapp.enabled", "true", "WhatsApp updates enabled"],
    ["notify.whatsapp.number", "+91 80 4712 0000", "WhatsApp Business number"],
    ["logs.enabled", "true", "Activity logging enabled"],
    ["logs.level", "info", "Application log level"],
    ["logs.retentionDays", "90", "Log retention days"],
    ["app.language", "en", "Default language (en/hi/kn)"],
    ["app.timezone", "Asia/Kolkata", "Display timezone"],
    ["assist.model", "glm-4.5-air", "AI assistant model"],
  ];
  for (const [key, value, description] of canonicalSettings) {
    const exists = await db.setting.findUnique({ where: { key } });
    if (!exists) await db.setting.create({ data: { key, value, description } });
  }
  console.log("  ✓ settings (canonical keys ensured)");

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

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
