/**
 * United Angel Reach — database seed.
 * Run: bun prisma/seed.ts   (after: bun run db:push)
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
  console.log("🌱 Seeding United Angel Reach…");

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
    const rec = await db.user.upsert({
      where: { email: u.email },
      update: { password: hashPassword(u.password) },
      create: { name: u.name, email: u.email, password: hashPassword(u.password), role: u.role, city: u.city, phone: u.phone },
    });
    users[u.key] = rec.id;
  }
  console.log("  ✓ users");

  // ── Volunteer application (pending, uses temp creds) ───────────────────
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
    console.log("  ✓ volunteer application (pending)");
  }

  // ── MDM Masters ────────────────────────────────────────────────────────
  const masters: [string, string, string][] = [
    ["CONDITION", "BP", "Blood Pressure"], ["CONDITION", "DIABETES", "Diabetes"], ["CONDITION", "THYROID", "Thyroid"], ["CONDITION", "CARDIAC", "Cardiac"], ["CONDITION", "ASTHMA", "Asthma"], ["CONDITION", "ARTHRITIS", "Arthritis"], ["CONDITION", "OTHER", "Other"],
    ["ANIMAL_SPECIES", "DOG", "Dog"], ["ANIMAL_SPECIES", "CAT", "Cat"], ["ANIMAL_SPECIES", "COW", "Cow"], ["ANIMAL_SPECIES", "BIRD", "Bird"], ["ANIMAL_SPECIES", "OTHER", "Other"],
    ["CITY", "Bengaluru", "Bengaluru"], ["CITY", "Mysuru", "Mysuru"], ["CITY", "Hubballi", "Hubballi"], ["CITY", "Mangaluru", "Mangaluru"], ["CITY", "Davanagere", "Davanagere"],
    ["AVAILABILITY", "WEEKENDS", "Weekends"], ["AVAILABILITY", "EVENINGS", "Weekday evenings"], ["AVAILABILITY", "FULL_TIME", "Full time"], ["AVAILABILITY", "FLEXIBLE", "Flexible"],
    ["SKILL", "FIELD_OPS", "Field operations"], ["SKILL", "MEDICAL", "Medical / first aid"], ["SKILL", "TEACHING", "Teaching & awareness"], ["SKILL", "DRIVING", "Driving"], ["SKILL", "COUNSELLING", "Counselling"], ["SKILL", "ANIMAL_CARE", "Animal care"], ["SKILL", "TECH", "Tech & data"],
    ["AMBULANCE_TYPE", "BLS", "BLS — Basic Life Support"], ["AMBULANCE_TYPE", "ALS", "ALS — Advanced Life Support"], ["AMBULANCE_TYPE", "PTV", "PTV — Patient Transport"], ["AMBULANCE_TYPE", "NEONATAL", "Neonatal"],
    ["EMERGENCY_TYPE", "CARDIAC", "Cardiac emergency"], ["EMERGENCY_TYPE", "ACCIDENT", "Road accident / trauma"], ["EMERGENCY_TYPE", "MATERNITY", "Maternity"], ["EMERGENCY_TYPE", "BURN", "Burns"], ["EMERGENCY_TYPE", "RESPIRATORY", "Respiratory"], ["EMERGENCY_TYPE", "TRANSFER", "Hospital transfer"],
    ["INVENTORY_CATEGORY", "RATION", "Ration & food"], ["INVENTORY_CATEGORY", "HYGIENE", "Hygiene & sanitary"], ["INVENTORY_CATEGORY", "MEDICINE", "Medicine"], ["INVENTORY_CATEGORY", "ANIMAL_FEED", "Animal feed"], ["INVENTORY_CATEGORY", "EQUIPMENT", "Equipment"],
    ["DISTRIBUTION_TYPE", "RATION", "Ration kit"], ["DISTRIBUTION_TYPE", "PAD", "Sanitary pads"], ["DISTRIBUTION_TYPE", "MEDICINE", "Medicine"], ["DISTRIBUTION_TYPE", "ANIMAL_FEED", "Animal feed"], ["DISTRIBUTION_TYPE", "OTHER", "Other"],
    ["TASK_TYPE", "DISTRIBUTION", "Distribution drive"], ["TASK_TYPE", "KIT_SCAN", "Kit scanning"], ["TASK_TYPE", "INVENTORY", "Inventory & stocking"], ["TASK_TYPE", "EVENT", "Awareness event"], ["TASK_TYPE", "RESCUE", "Animal rescue"], ["TASK_TYPE", "AMBULANCE", "Ambulance support"],
    ["UNIT", "pcs", "Pieces"], ["UNIT", "kg", "Kilograms"], ["UNIT", "litre", "Litres"], ["UNIT", "box", "Boxes"], ["UNIT", "pack", "Packs"],
    ["BENEFICIARY_CATEGORY", "FAMILY", "Family"], ["BENEFICIARY_CATEGORY", "ELDERLY", "Elderly"], ["BENEFICIARY_CATEGORY", "CHILD", "Child"], ["BENEFICIARY_CATEGORY", "DISABLED", "Differently abled"], ["BENEFICIARY_CATEGORY", "PATIENT", "Patient"], ["BENEFICIARY_CATEGORY", "DAILY_WAGE", "Daily wage worker"],
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

  // ── Campaigns ──────────────────────────────────────────────────────────
  const campaigns = [
    { slug: "anti-drug", title: "Sankalp Against Substance — Anti-Drug", tagline: "Awareness, de-addiction guidance and family support — because addiction is a health condition, not a crime.", category: "AWARENESS", description: "School & college modules, workplace sessions, family counselling camps and rehab referrals across Bengaluru. Volunteers teach the 5-step helping playbook and connect users to the free National De-addiction Helpline 14446.", targetAmount: 800000, raisedAmount: 436500, beneficiaries: 12400, volunteersEngaged: 86, icon: "shield-alert", accent: "orange", featured: true, helpline: "14446" },
    { slug: "cyber-crime", title: "CyberSuraksha — Cyber Crime Safety", tagline: "Beat the golden hour: 1930, cybercrime.gov.in and scam-recognition training for every family.", category: "AWARENESS", description: "Bengaluru reports 1,000+ cyber frauds daily. We teach the 60-minute rescue playbook, run RWA and senior-citizen cyber-hygiene workshops, and handhold victims through 1930 + cybercrime.gov.in filings.", targetAmount: 500000, raisedAmount: 289000, beneficiaries: 8600, volunteersEngaged: 42, icon: "smartphone", accent: "cyan", featured: true, helpline: "1930" },
    { slug: "women-safety", title: "Suraksha — Women Safety", tagline: "Self-defence, legal power and 112/181/1091 readiness for every woman and girl.", category: "SAFETY", description: "Free 15-day self-defence batches, POSH workplace workshops, safe-city drives and survivor support with legal-aid tie-ups. We teach the DV Act 2005, POSH Act 2013 and the trust-your-gut playbook.", targetAmount: 900000, raisedAmount: 512000, beneficiaries: 7800, volunteersEngaged: 64, icon: "heart-handshake", accent: "fuchsia", featured: true, helpline: "181" },
    { slug: "child-safety", title: "Little Angels Shield — Child Safety (POCSO)", tagline: "Underwear rule, safe-adult lists and POCSO training for schools, tuitions and homes.", category: "SAFETY", description: "Age-appropriate safety education in schools, tuitions and orphanages; teacher verification toolkits; parent seminars. One number for any child in distress: CHILDLINE 1098.", targetAmount: 700000, raisedAmount: 398000, beneficiaries: 21500, volunteersEngaged: 58, icon: "baby", accent: "amber", featured: true, helpline: "1098" },
    { slug: "medicine-adoption", title: "Adopt-a-Medicine — monthly tablets for the needy", tagline: "₹150/month keeps a BP or diabetes patient alive. Adopt a real, verified patient today.", category: "HEALTH", description: "A registry of verified patients who skip BP, sugar, thyroid and cardiac tablets because they cost ₹800–2,500/month. Donors adopt patients fully, partially or monthly — with refill proof and 80G receipts.", targetAmount: 1200000, raisedAmount: 645000, beneficiaries: 3200, volunteersEngaged: 38, icon: "pill", accent: "teal", featured: true, helpline: null },
    { slug: "animal-welfare", title: "Angel Paws — Animal Adoption & Food", tagline: "Adopt, don't shop. Feed a street dog for a month for ₹900. Rescue. Vaccinate. Love.", category: "ANIMAL", description: "Street-animal feeding zones, rescue coordination with CUPA/BAWA, ABC vaccination-sterilisation drives and an adoption platform for Indie dogs, cats and rescued cows.", targetAmount: 600000, raisedAmount: 331000, beneficiaries: 4100, volunteersEngaged: 74, icon: "paw-print", accent: "lime", featured: true, helpline: "1962" },
    { slug: "green-corridor", title: "AI Green Corridor — ambulances that clear their own path", tagline: "Traffic ahead knows before the siren does: 5G V2X → cellular → Bluetooth mesh → FM break-in.", category: "MOBILITY", description: "Bengaluru ambulances average 11 km/h; cardiac survival drops every minute. Our corridor mesh alerts vehicles up to 2 km ahead via V2X and offline Bluetooth beacons, cutting run time 40–60%.", targetAmount: 1500000, raisedAmount: 821000, beneficiaries: 5600, volunteersEngaged: 95, icon: "siren", accent: "red", featured: true, helpline: "108" },
    { slug: "ration-kits", title: "Ration Kit Mission — QR-coded food security", tagline: "Rice, atta, dal, oil — packed, QR-labelled, handed with dignity, tracked to the last kit.", category: "NUTRITION", description: "Every kit carries a unique code (UAR-RK-2026-XXXXXX). Volunteers scan at handover — inventory auto-decrements and every family is logged with time, place and volunteer.", targetAmount: 1000000, raisedAmount: 558000, beneficiaries: 18700, volunteersEngaged: 112, icon: "package", accent: "emerald", featured: true, helpline: null },
    { slug: "sanitary-pads", title: "Project Dignity — Sanitary Pad Banks", tagline: "No girl should miss school because of her period. Pad banks + awareness for all.", category: "HYGIENE", description: "Pad-bank vending in government schools, slum communities and factory clusters; biodegradable awareness; anemia camps. Sessions include boys — because stigma ends with everyone.", targetAmount: 500000, raisedAmount: 276000, beneficiaries: 9400, volunteersEngaged: 47, icon: "flower-2", accent: "pink", featured: true, helpline: null },
  ];
  for (const c of campaigns) {
    await db.campaign.upsert({ where: { slug: c.slug }, update: {}, create: c });
  }
  console.log(`  ✓ campaigns (${campaigns.length})`);

  // ── Medicine adoption causes ───────────────────────────────────────────
  const causeCount = await db.cause.count();
  if (causeCount === 0) {
    await db.cause.createMany({
      data: [
        { code: "UAR-MED-0001", patientName: "Muniamma", age: 68, city: "Bengaluru", condition: "BP", monthlyCost: 850, durationMonths: 12, story: "Widow in Jayanagar working as a part-time cook. Her BP tablets stopped when her son lost his job — she fainted twice at work last month.", status: "SEEKING" },
        { code: "UAR-MED-0002", patientName: "Shivanna", age: 55, city: "Bengaluru", condition: "DIABETES", monthlyCost: 1200, durationMonths: 12, story: "Construction worker with diabetes for 9 years. Skips doses to save money; sugar swings landed him in hospital twice last year.", status: "SEEKING" },
        { code: "UAR-MED-0003", patientName: "Fatima Begum", age: 47, city: "Bengaluru", condition: "THYROID", monthlyCost: 600, durationMonths: 6, story: "Single mother of three, tailoring from home. Thyroid medicine is the first thing she drops when school fees are due.", status: "SEEKING" },
        { code: "UAR-MED-0004", patientName: "Gopal Krishna", age: 72, city: "Mysuru", condition: "CARDIAC", monthlyCost: 2400, durationMonths: 12, story: "Retired bus conductor with a stent. Cardiac tablets + statins cost his entire pension surplus — his daughter sponsors what she can.", status: "PARTIAL", raised: 800, adoptedByName: "Rahul Sharma", adoptedById: users.donor },
        { code: "UAR-MED-0005", patientName: "Sarala", age: 39, city: "Bengaluru", condition: "ASTHMA", monthlyCost: 950, durationMonths: 6, story: "Garment factory worker; dust and long hours trigger severe asthma. Inhalers are 'luxury' months.", status: "SEEKING" },
        { code: "UAR-MED-0006", patientName: "Rajesh Naik", age: 61, city: "Hubballi", condition: "BP", monthlyCost: 800, durationMonths: 12, story: "Auto driver with hypertension. Stopped medicines after his wife's surgery; now facing early kidney strain.", status: "SEEKING" },
        { code: "UAR-MED-0007", patientName: "Meenakshi", age: 65, city: "Bengaluru", condition: "DIABETES", monthlyCost: 1100, durationMonths: 12, story: "Lives alone, children abroad earn hand-to-mouth. Fully stabilised on Jan Aushadhi generics when medicines arrive on time.", status: "ADOPTED", raised: 1100, adoptedByName: "Priya Nair", adoptedById: users.volunteer },
        { code: "UAR-MED-0008", patientName: "Anthony D'Souza", age: 58, city: "Bengaluru", condition: "BP", monthlyCost: 900, durationMonths: 6, story: "Fisherman's family in KG Halli; BP medicines compete with boat-repair loans.", status: "SEEKING" },
      ],
    });
  }

  // ── Animals ────────────────────────────────────────────────────────────
  const animalCount = await db.animal.count();
  if (animalCount === 0) {
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
  const ambCount = await db.ambulance.count();
  if (ambCount === 0) {
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

  // ── Kit templates & a batch with 24 units ──────────────────────────────
  const kitCount = await db.kitTemplate.count();
  if (kitCount === 0) {
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
          { name: "Tea powder", qty: 250, unit: "pcs" },
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
  const invCount = await db.inventoryItem.count();
  if (invCount === 0) {
    await db.inventoryItem.createMany({
      data: [
        { name: "Rice (25kg sacks)", category: "RATION", quantity: 180, unit: "sack", minQuantity: 40, location: "Central Warehouse, Peenya" },
        { name: "Wheat flour", category: "RATION", quantity: 90, unit: "kg", minQuantity: 30, location: "Central Warehouse, Peenya" },
        { name: "Toor dal", category: "RATION", quantity: 65, unit: "kg", minQuantity: 25, location: "Central Warehouse, Peenya" },
        { name: "Sanitary pads (packs)", category: "HYGIENE", quantity: 420, unit: "pack", minQuantity: 100, location: "Pad Bank, Jayanagar" },
        { name: "BP tablets (Amlodipine)", category: "MEDICINE", quantity: 350, unit: "pack", minQuantity: 80, location: "Medicine Hub, Jayanagar" },
        { name: "Diabetes tablets (Metformin)", category: "MEDICINE", quantity: 60, unit: "pack", minQuantity: 80, location: "Medicine Hub, Jayanagar" },
        { name: "Dog feed (dry, 20kg)", category: "ANIMAL_FEED", quantity: 48, unit: "sack", minQuantity: 15, location: "Angel Paws Hub, HSR" },
        { name: "First-aid kits", category: "EQUIPMENT", quantity: 30, unit: "box", minQuantity: 10, location: "Ambulance Base, Bannerghatta" },
      ],
    });
  }

  // ── Beneficiaries ──────────────────────────────────────────────────────
  const benCount = await db.beneficiary.count();
  if (benCount === 0) {
    await db.beneficiary.createMany({
      data: [
        { name: "Muniamma", phone: "+91 90190 30001", city: "Bengaluru", category: "ELDERLY", familySize: 2, monthlyNeed: 1850, status: "VERIFIED", onboardedById: users.volunteer, onboardedByName: "Priya Nair", notes: "BP + ration support, Jayanagar" },
        { name: "Shivanna", phone: "+91 90190 30002", city: "Bengaluru", category: "DAILY_WAGE", familySize: 4, monthlyNeed: 2600, status: "ACTIVE", onboardedById: users.admin, onboardedByName: "Anjali Rao", notes: "Construction worker, Whitefield camp" },
        { name: "Fatima Begum", phone: "+91 90190 30003", city: "Bengaluru", category: "FAMILY", familySize: 5, monthlyNeed: 2100, status: "VERIFIED", onboardedById: users.volunteer, onboardedByName: "Priya Nair" },
        { name: "Gopal Krishna", phone: "+91 90190 30004", city: "Mysuru", category: "ELDERLY", familySize: 3, monthlyNeed: 3200, status: "VERIFIED" },
        { name: "Sarala", phone: "+91 90190 30005", city: "Bengaluru", category: "PATIENT", familySize: 3, monthlyNeed: 1550, status: "ACTIVE" },
      ],
    });
  }

  // ── Distributions ──────────────────────────────────────────────────────
  const distCount = await db.distribution.count();
  if (distCount === 0) {
    await db.distribution.createMany({
      data: [
        { type: "RATION", beneficiaryName: "Shivanna", itemCount: 1, location: "Whitefield camp", volunteerId: users.volunteer, volunteerName: "Priya Nair", date: daysFromNow(-2), notes: "Kit UAR-RK-2026-000003 scanned at handover" },
        { type: "PAD", beneficiaryName: "Govt High School, Jayanagar (50 girls)", itemCount: 100, location: "Jayanagar", volunteerId: users.volunteer, volunteerName: "Priya Nair", date: daysFromNow(-5), notes: "Pad bank refill + awareness session" },
        { type: "MEDICINE", beneficiaryName: "Muniamma", itemCount: 2, location: "Jayanagar", volunteerId: users.volunteer, volunteerName: "Priya Nair", date: daysFromNow(-1), notes: "BP refill via Jan Aushadhi" },
        { type: "ANIMAL_FEED", beneficiaryName: "HSR feeder route (14 dogs)", itemCount: 20, location: "HSR Layout", volunteerId: users.admin, volunteerName: "Anjali Rao", date: daysFromNow(-3) },
      ],
    });
  }

  // ── Donations ──────────────────────────────────────────────────────────
  const donCount = await db.donation.count();
  if (donCount === 0) {
    const camps = await db.campaign.findMany();
    const bySlug = Object.fromEntries(camps.map((c) => [c.slug, c.id]));
    let n = 1;
    const mk = (donorName: string, slug: string, amount: number, method: string, message?: string, monthly = false, anonymous = false) => ({
      receiptNo: `UAR-RCPT-2026-${String(n++).padStart(5, "0")}`,
      donorId: donorName === "Rahul Sharma" ? users.donor : null,
      donorName,
      email: donorName === "Rahul Sharma" ? "donor@demo.org" : null,
      campaignId: bySlug[slug],
      amount,
      type: monthly ? "MONTHLY" : "ONE_TIME",
      method,
      status: "COMPLETED",
      message,
      isAnonymous: anonymous,
    });
    await db.donation.createMany({
      data: [
        mk("Rahul Sharma", "anti-drug", 25000, "UPI", "For the college workshops — great work team"),
        mk("Rahul Sharma", "medicine-adoption", 2400, "UPI", "Co-funding Gopal Krishna garu's cardiac tabs", true),
        mk("Infosys Foundation", "green-corridor", 500000, "BANK", "CSR — Corridor pilot across 3 corridors"),
        mk("Anonymous", "sanitary-pads", 50000, "UPI", undefined, false, true),
        mk("Meera Krishnan", "child-safety", 15000, "CARD", "In memory of my grandmother"),
        mk("TechM Cares", "ration-kits", 120000, "BANK", undefined, true),
        mk("Suresh Babu", "animal-welfare", 5000, "UPI", "Feed route sponsorship"),
        mk("Deepa Iyer", "women-safety", 10000, "UPI", "Self-defence batch sponsor"),
        mk("Vijay Anand", "cyber-crime", 7500, "UPI"),
        mk("Rahul Sharma", "animal-welfare", 900, "UPI", "Brownie's food month", true),
      ],
    });
  }

  // ── Volunteer tasks ────────────────────────────────────────────────────
  const taskCount = await db.volunteerTask.count();
  if (taskCount === 0) {
    await db.volunteerTask.createMany({
      data: [
        { title: "Weekend ration drive — Whitefield camp", description: "Distribute 20 kits, scan each at handover", assignedToId: users.volunteer, assigneeName: "Priya Nair", type: "DISTRIBUTION", status: "IN_PROGRESS", priority: "HIGH", dueDate: daysFromNow(2) },
        { title: "School safety workshop — Govt HS Jayanagar", description: "POCSO + good-touch module for class 6–8 (2 hrs)", assignedToId: users.volunteer, assigneeName: "Priya Nair", type: "EVENT", status: "OPEN", priority: "MEDIUM", dueDate: daysFromNow(6) },
        { title: "Kit batch 2026-01 packing", description: "Pack & label remaining units in batch 2026-01", type: "KIT_SCAN", status: "OPEN", priority: "MEDIUM", dueDate: daysFromNow(4) },
        { title: "Feed route — HSR Sector 2", description: "Evening feeding for 14 street dogs", type: "RESCUE", status: "OPEN", priority: "HIGH", dueDate: daysFromNow(1) },
      ],
    });
  }

  // ── Testimonials ───────────────────────────────────────────────────────
  const tCount = await db.testimonial.count();
  if (tCount === 0) {
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
  const settings: [string, string][] = [
    ["org.name", "United Angel Reach Trust"],
    ["org.hq", "Bengaluru, Karnataka, India"],
    ["org.vision", "From Bengaluru to the whole of India — every district served"],
    ["org.email", "care@unitedangelreach.org"],
    ["org.80g", "UAR/80G/2024/0147"],
    ["ops.lowStockAlerts", "true"],
    ["ops.currency", "INR"],
    ["assist.model", "glm-4.5-air"],
  ];
  for (const [key, value] of settings) {
    await db.setting.upsert({ where: { key }, update: { value }, create: { key, value } });
  }

  // ── Activity log ───────────────────────────────────────────────────────
  if ((await db.activityLog.count()) === 0) {
    await db.activityLog.createMany({
      data: [
        { actorName: "System", action: "SEED", entity: "database", detail: "Seed data loaded: 9 campaigns, 8 medicine causes, 6 animals, 5 ambulances, kit batch of 24" },
        { actorName: "Anjali Rao", action: "APPROVE", entity: "volunteer", detail: "Priya Nair approved as field volunteer" },
        { actorName: "Priya Nair", action: "SCAN", entity: "kit", detail: "UAR-RK-2026-000003 scanned → Whitefield camp" },
      ],
    });
  }

  console.log("✅ Seed complete. Login: admin@unitedangelreach.org / Admin@123");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
