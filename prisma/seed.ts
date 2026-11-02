// United Angel Reach — canonical seed (v1 field names + v2 modules)
// Run: bun run db:reset   (force-reset + seed) or bun prisma/seed.ts
import { PrismaClient } from "@prisma/client";
import crypto from "crypto";

const db = new PrismaClient();

function hashPassword(pw: string): string {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(pw, salt, 32).toString("hex");
  return `${salt}:${hash}`;
}

function days(d: number): Date {
  return new Date(Date.now() + d * 86400000);
}

async function main() {
  console.log("🌱 Seeding United Angel Reach (canonical)…");

  // ── Users ──────────────────────────────────────────────────────────────
  const admin = await db.user.upsert({
    where: { email: "admin@unitedangelreach.org" },
    update: { password: hashPassword("Admin@123"), isActive: true, status: "ACTIVE" },
    create: { email: "admin@unitedangelreach.org", name: "Anjali Rao", phone: "+91 98860 10001", password: hashPassword("Admin@123"), role: "ADMIN", city: "Bengaluru", isActive: true, status: "ACTIVE" },
  });
  const donor = await db.user.upsert({
    where: { email: "donor@demo.org" },
    update: { password: hashPassword("Donor@123"), isActive: true },
    create: { email: "donor@demo.org", name: "Rahul Sharma", phone: "+91 98860 10002", password: hashPassword("Donor@123"), role: "DONOR", city: "Bengaluru", isActive: true, status: "ACTIVE" },
  });
  const volunteerUser = await db.user.upsert({
    where: { email: "volunteer@demo.org" },
    update: { password: hashPassword("Volun@123"), isActive: true },
    create: { email: "volunteer@demo.org", name: "Priya Nair", phone: "+91 98860 10003", password: hashPassword("Volun@123"), role: "VOLUNTEER", city: "Bengaluru", isActive: true, status: "ACTIVE" },
  });
  const applicant = await db.user.upsert({
    where: { email: "applicant@demo.org" },
    update: { password: hashPassword("Temp@12345") },
    create: { email: "applicant@demo.org", name: "Arjun Kumar", phone: "+91 98860 10004", password: hashPassword("Temp@12345"), role: "VOLUNTEER", city: "Mysuru", isActive: false, status: "PENDING" },
  });
  const beneficiaryUser = await db.user.upsert({
    where: { email: "beneficiary@demo.org" },
    update: { password: hashPassword("Benef@123"), isActive: true },
    create: { email: "beneficiary@demo.org", name: "Lakshmi Devi", phone: "+91 98860 10005", password: hashPassword("Benef@123"), role: "BENEFICIARY", city: "Bengaluru", isActive: true, status: "ACTIVE" },
  });
  console.log("  ✓ users (admin/donor/volunteer/applicant/beneficiary)");

  // ── Volunteer profiles ─────────────────────────────────────────────────
  const volunteer = await db.volunteer.upsert({
    where: { userId: volunteerUser.id },
    update: { status: "ACTIVE" },
    create: { userId: volunteerUser.id, skills: JSON.stringify(["FIELD_OPS", "TEACHING", "MEDICAL"]), availability: "WEEKENDS", assignedArea: "Bengaluru South", status: "ACTIVE" },
  });
  if ((await db.volunteerApplication.count()) === 0) {
    await db.volunteerApplication.create({
      data: {
        userId: applicant.id,
        fullName: "Arjun Kumar",
        email: "applicant@demo.org",
        phone: "+91 98860 10004",
        city: "Mysuru",
        occupation: "Student",
        skills: JSON.stringify(["FIELD_OPS", "TEACHING"]),
        availability: "WEEKENDS",
        motivation: "I lost my cousin to substance abuse and want to educate students about addiction before it catches them.",
        status: "PENDING",
      },
    });
  }
  console.log("  ✓ volunteer profile + 1 pending application");

  // ── MDM Masters ────────────────────────────────────────────────────────
  const masters: [string, string, string][] = [
    ["CONDITION", "BP", "Blood Pressure"], ["CONDITION", "DIABETES", "Diabetes"], ["CONDITION", "THYROID", "Thyroid"], ["CONDITION", "CARDIAC", "Cardiac"], ["CONDITION", "ASTHMA", "Asthma"], ["CONDITION", "ARTHRITIS", "Arthritis"], ["CONDITION", "OTHER", "Other"],
    ["ANIMAL_SPECIES", "DOG", "Dog"], ["ANIMAL_SPECIES", "CAT", "Cat"], ["ANIMAL_SPECIES", "COW", "Cow"], ["ANIMAL_SPECIES", "BIRD", "Bird"], ["ANIMAL_SPECIES", "OTHER", "Other"],
    ["CITY", "Bengaluru", "Bengaluru"], ["CITY", "Mysuru", "Mysuru"], ["CITY", "Hubballi", "Hubballi"], ["CITY", "Mangaluru", "Mangaluru"], ["CITY", "Davanagere", "Davanagere"],
    ["AVAILABILITY", "WEEKENDS", "Weekends"], ["AVAILABILITY", "EVENINGS", "Weekday evenings"], ["AVAILABILITY", "FULL_TIME", "Full time"], ["AVAILABILITY", "FLEXIBLE", "Flexible"],
    ["SKILL", "FIELD_OPS", "Field operations"], ["SKILL", "MEDICAL", "Medical / first aid"], ["SKILL", "TEACHING", "Teaching & awareness"], ["SKILL", "DRIVING", "Driving"], ["SKILL", "COUNSELLING", "Counselling"], ["SKILL", "ANIMAL_CARE", "Animal care"], ["SKILL", "TECH", "Tech & data"],
    ["AMBULANCE_TYPE", "BLS", "BLS — Basic Life Support"], ["AMBULANCE_TYPE", "ALS", "ALS — Advanced Life Support"], ["AMBULANCE_TYPE", "PTV", "PTV — Patient Transport"], ["AMBULANCE_TYPE", "NEONATAL", "Neonatal"],
    ["EMERGENCY_TYPE", "CARDIAC", "Cardiac emergency"], ["EMERGENCY_TYPE", "ACCIDENT", "Road accident / trauma"], ["EMERGENCY_TYPE", "MATERNITY", "Maternity"], ["EMERGENCY_TYPE", "BURN", "Burns"], ["EMERGENCY_TYPE", "RESPIRATORY", "Respiratory"], ["EMERGENCY_TYPE", "TRANSFER", "Hospital transfer"],
    ["INVENTORY_CATEGORY", "FOOD_KIT", "Ration & food"], ["INVENTORY_CATEGORY", "SANITARY_PADS", "Hygiene & sanitary"], ["INVENTORY_CATEGORY", "MEDICINE", "Medicine"], ["INVENTORY_CATEGORY", "ANIMAL_FEED", "Animal feed"], ["INVENTORY_CATEGORY", "EQUIPMENT", "Equipment"],
    ["UNIT", "pcs", "Pieces"], ["UNIT", "kg", "Kilograms"], ["UNIT", "litre", "Litres"], ["UNIT", "box", "Boxes"], ["UNIT", "pack", "Packs"], ["UNIT", "sack", "Sacks"],
    ["BENEFICIARY_CATEGORY", "WIDOW", "Widow"], ["BENEFICIARY_CATEGORY", "ORPHAN", "Orphan"], ["BENEFICIARY_CATEGORY", "STUDENT", "Student"], ["BENEFICIARY_CATEGORY", "ELDERLY", "Elderly"], ["BENEFICIARY_CATEGORY", "DISABLED", "Differently abled"], ["BENEFICIARY_CATEGORY", "SINGLE_MOTHER", "Single mother"], ["BENEFICIARY_CATEGORY", "POOR_FAMILY", "Poor family"], ["BENEFICIARY_CATEGORY", "PATIENT", "Patient"], ["BENEFICIARY_CATEGORY", "DAILY_WAGE", "Daily wage worker"],
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
    { slug: "women-safety", title: "Suraksha — Women Safety", tagline: "Self-defence, legal power and 112/181/1091 readiness for every woman and girl.", category: "SAFETY", description: "Free 15-day self-defence batches, POSH workplace workshops, safe-city drives and survivor support with legal-aid tie-ups. We teach the DV Act 2005, POSH Act 2013 and the trust-your-gut playbook.", targetAmount: 900000, raisedAmount: 512000, beneficiaries: 7800, volunteersEngaged: 64, icon: "heart-handshake", accent: "fuchsia", featured: true, helpline: "181" },
    { slug: "child-safety", title: "Little Angels Shield — Child Safety (POCSO)", tagline: "Underwear rule, safe-adult lists and POCSO training for schools, tuitions and homes.", category: "SAFETY", description: "Age-appropriate safety education in schools, tuitions and orphanages; teacher verification toolkits; parent seminars. One number for any child in distress: CHILDLINE 1098.", targetAmount: 700000, raisedAmount: 398000, beneficiaries: 21500, volunteersEngaged: 58, icon: "baby", accent: "amber", featured: true, helpline: "1098" },
    { slug: "medicine-adoption", title: "Adopt-a-Medicine — monthly tablets for the needy", tagline: "₹150/month keeps a BP or diabetes patient alive. Adopt a real, verified patient today.", category: "MEDICAL", description: "A registry of verified patients who skip BP, sugar, thyroid and cardiac tablets because they cost ₹800–2,500/month. Donors adopt patients fully, partially or monthly — with refill proof and 80G receipts.", targetAmount: 1200000, raisedAmount: 645000, beneficiaries: 3200, volunteersEngaged: 38, icon: "pill", accent: "teal", featured: true },
    { slug: "animal-welfare", title: "Angel Paws — Animal Adoption & Food", tagline: "Adopt, don't shop. Feed a street dog for a month for ₹900. Rescue. Vaccinate. Love.", category: "GENERAL", description: "Street-animal feeding zones, rescue coordination with CUPA/BAWA, ABC vaccination-sterilisation drives and an adoption platform for Indie dogs, cats and rescued cows.", targetAmount: 600000, raisedAmount: 331000, beneficiaries: 4100, volunteersEngaged: 74, icon: "paw-print", accent: "lime", featured: true, helpline: "1962" },
    { slug: "green-corridor", title: "AI Green Corridor — ambulances that clear their own path", tagline: "Traffic ahead knows before the siren does: 5G V2X → cellular → Bluetooth mesh → FM break-in.", category: "GENERAL", description: "Bengaluru ambulances average 11 km/h; cardiac survival drops every minute. Our corridor mesh alerts vehicles up to 2 km ahead via V2X and offline Bluetooth beacons, cutting run time 40–60%.", targetAmount: 1500000, raisedAmount: 821000, beneficiaries: 5600, volunteersEngaged: 95, icon: "siren", accent: "red", featured: true, helpline: "108" },
    { slug: "ration-kits", title: "Ration Kit Mission — QR-coded food security", tagline: "Rice, atta, dal, oil — packed, QR-labelled, handed with dignity, tracked to the last kit.", category: "FOOD_DISTRIBUTION", description: "Every kit carries a unique code (UAR-RK-2026-XXXXXX). Volunteers scan at handover — inventory auto-decrements and every family is logged with time, place and volunteer.", targetAmount: 1000000, raisedAmount: 558000, beneficiaries: 18700, volunteersEngaged: 112, icon: "package", accent: "emerald", featured: true },
    { slug: "sanitary-pads", title: "Project Dignity — Sanitary Pad Banks", tagline: "No girl should miss school because of her period. Pad banks + awareness for all.", category: "SANITARY_PADS", description: "Pad-bank vending in government schools, slum communities and factory clusters; biodegradable awareness; anemia camps. Sessions include boys — because stigma ends with everyone.", targetAmount: 500000, raisedAmount: 276000, beneficiaries: 9400, volunteersEngaged: 47, icon: "flower-2", accent: "pink", featured: true },
  ];
  const campMap: Record<string, string> = {};
  for (const c of campaigns) {
    const rec = await db.campaign.upsert({
      where: { slug: c.slug },
      update: {},
      create: { ...c, createdBy: admin.id, startDate: days(-90), status: "ACTIVE" },
    });
    campMap[c.slug] = rec.id;
  }
  console.log(`  ✓ campaigns (${campaigns.length})`);

  // ── Adopt-a-Medicine causes + pledges ──────────────────────────────────
  if ((await db.cause.count()) === 0) {
    const causes = [
      { code: "UAR-MED-0001", patientName: "Muniamma", age: 68, city: "Bengaluru", condition: "BP", monthlyCost: 850, durationMonths: 12, story: "Widow in Jayanagar working as a part-time cook. Her BP tablets stopped when her son lost his job — she fainted twice at work last month.", status: "SEEKING" },
      { code: "UAR-MED-0002", patientName: "Shivanna", age: 55, city: "Bengaluru", condition: "DIABETES", monthlyCost: 1200, durationMonths: 12, story: "Construction worker with diabetes for 9 years. Skips doses to save money; sugar swings landed him in hospital twice last year.", status: "SEEKING" },
      { code: "UAR-MED-0003", patientName: "Fatima Begum", age: 47, city: "Bengaluru", condition: "THYROID", monthlyCost: 600, durationMonths: 6, story: "Single mother of three, tailoring from home. Thyroid medicine is the first thing she drops when school fees are due.", status: "SEEKING" },
      { code: "UAR-MED-0004", patientName: "Gopal Krishna", age: 72, city: "Mysuru", condition: "CARDIAC", monthlyCost: 2400, durationMonths: 12, story: "Retired bus conductor with a stent. Cardiac tablets + statins cost his entire pension surplus — his daughter sponsors what she can.", status: "PARTIAL", raised: 800, adoptedByName: "Rahul Sharma", adoptedById: donor.id },
      { code: "UAR-MED-0005", patientName: "Sarala", age: 39, city: "Bengaluru", condition: "ASTHMA", monthlyCost: 950, durationMonths: 6, story: "Garment factory worker; dust and long hours trigger severe asthma. Inhalers become 'luxury' some months.", status: "SEEKING" },
      { code: "UAR-MED-0006", patientName: "Rajesh Naik", age: 61, city: "Hubballi", condition: "BP", monthlyCost: 800, durationMonths: 12, story: "Auto driver with hypertension. Stopped medicines after his wife's surgery; now facing early kidney strain.", status: "SEEKING" },
      { code: "UAR-MED-0007", patientName: "Meenakshi", age: 65, city: "Bengaluru", condition: "DIABETES", monthlyCost: 1100, durationMonths: 12, story: "Lives alone, children abroad earn hand-to-mouth. Fully stabilised on Jan Aushadhi generics when medicines arrive on time.", status: "ADOPTED", raised: 1100, adoptedByName: "Priya Nair", adoptedById: volunteerUser.id },
      { code: "UAR-MED-0008", patientName: "Anthony D'Souza", age: 58, city: "Bengaluru", condition: "BP", monthlyCost: 900, durationMonths: 6, story: "Fisherman's family in KG Halli; BP medicines compete with boat-repair loans.", status: "SEEKING" },
    ];
    for (const c of causes) {
      const rec = await db.cause.create({ data: c });
      if (c.code === "UAR-MED-0004") {
        await db.pledge.create({ data: { causeId: rec.id, donorId: donor.id, donorName: "Rahul Sharma", amountPerMonth: 800, months: 12, status: "ACTIVE" } });
      }
      if (c.code === "UAR-MED-0007") {
        await db.pledge.create({ data: { causeId: rec.id, donorId: volunteerUser.id, donorName: "Priya Nair", amountPerMonth: 1100, months: 6, status: "ACTIVE" } });
      }
    }
    console.log("  ✓ causes (8) + pledges (2)");
  }

  // ── Animals ────────────────────────────────────────────────────────────
  if ((await db.animal.count()) === 0) {
    const animals = [
      { name: "Brownie", species: "DOG", breed: "Indie", ageMonths: 24, gender: "MALE", story: "Rescued near KR Puram with a hind-leg fracture; healed fully after surgery. Gentle with kids, house-trained.", healthStatus: "Fully recovered", vaccinated: true, sterilized: true, location: "KR Puram, Bengaluru", status: "AVAILABLE", monthlyFood: 900 },
      { name: "Simba", species: "DOG", breed: "Indie", ageMonths: 8, gender: "MALE", story: "Abandoned puppy found inside a cardboard box in Indiranagar. Playful, vaccinated, ready for a forever home.", healthStatus: "Healthy", vaccinated: true, sterilized: false, location: "Indiranagar, Bengaluru", status: "AVAILABLE", monthlyFood: 800 },
      { name: "Kitty", species: "CAT", breed: "Domestic short-hair", ageMonths: 18, gender: "FEMALE", story: "Rescued from a storm drain in Malleshwaram. Quiet, affectionate, litter-trained.", healthStatus: "Healthy", vaccinated: true, sterilized: true, location: "Malleshwaram, Bengaluru", status: "AVAILABLE", monthlyFood: 700 },
      { name: "Lakshmi", species: "COW", breed: "Hallikar mix", ageMonths: 96, gender: "FEMALE", story: "Abandoned after milk yield dropped; rescued from a highway median. Now at our partner goshala, needs monthly fodder sponsor.", healthStatus: "Underweight, improving", vaccinated: true, sterilized: false, location: "Partner goshala, Nelamangala", status: "FOSTERED", monthlyFood: 2500 },
      { name: "Mithu", species: "BIRD", breed: "Rose-ringed parakeet", ageMonths: 14, gender: "MALE", story: "Rescued from an illegal seller; wing healed after clipping injury. Sensitive — needs a patient home or aviary.", healthStatus: "Recovering", vaccinated: false, sterilized: false, location: "CUPA shelter, Bengaluru", status: "AVAILABLE", monthlyFood: 400 },
      { name: "Raja", species: "DOG", breed: "Indie", ageMonths: 60, gender: "MALE", story: "Community dog of HSR Layout Sector 2, fed by our volunteer route. Critical after a road accident — needs surgery funds.", healthStatus: "Fracture surgery pending", vaccinated: true, sterilized: true, location: "HSR Layout, Bengaluru", status: "CRITICAL", monthlyFood: 900 },
    ];
    for (const a of animals) {
      const rec = await db.animal.create({ data: a });
      if (a.name === "Brownie") {
        await db.animalPledge.create({ data: { animalId: rec.id, donorId: donor.id, donorName: "Rahul Sharma", kind: "FOOD", amount: 900, frequency: "MONTHLY", status: "ACTIVE" } });
      }
    }
    await db.animalPledge.create({ data: { shelterFund: "Bengaluru Street Dog Food Fund", donorName: "Meera Krishnan", kind: "FOOD", amount: 2500, frequency: "MONTHLY", status: "ACTIVE" } });
    console.log("  ✓ animals (6) + food pledges (2)");
  }

  // ── Ambulances + sample missions ───────────────────────────────────────
  if ((await db.ambulance.count()) === 0) {
    const ambDefs = [
      { code: "KA-01-UAR-101", type: "ALS", status: "AVAILABLE", base: "Bannerghatta Base", driverName: "Mahesh Gowda", driverPhone: "+91 98860 20101", crew: "EMT + Nurse", equipment: "Defibrillator,Ventilator,ECG,Oxygen" },
      { code: "KA-01-UAR-102", type: "BLS", status: "AVAILABLE", base: "Whitefield Base", driverName: "Suresh Kumar", driverPhone: "+91 98860 20102", crew: "EMT", equipment: "Oxygen,Stretcher,First-aid" },
      { code: "KA-03-UAR-103", type: "PTV", status: "AVAILABLE", base: "Jayanagar Base", driverName: "Imran Khan", driverPhone: "+91 98860 20103", crew: "Driver", equipment: "Wheelchair ramp" },
      { code: "KA-04-UAR-104", type: "NEONATAL", status: "MAINTENANCE", base: "Hebbal Base", driverName: "Ravi Shankar", driverPhone: "+91 98860 20104", crew: "NICU Nurse + EMT", equipment: "Incubator,Transport ventilator" },
      { code: "KA-05-UAR-105", type: "BLS", status: "AVAILABLE", base: "Marathahalli Base", driverName: "David Raj", driverPhone: "+91 98860 20105", crew: "EMT", equipment: "Oxygen,Stretcher,First-aid" },
    ];
    for (const a of ambDefs) await db.ambulance.create({ data: a });
    const als = await db.ambulance.findUnique({ where: { code: "KA-01-UAR-101" } });
    const route = JSON.stringify([
      { name: "Bannerghatta Road", congestion: "MODERATE", lengthKm: 2.2 },
      { name: "Outer Ring Road", congestion: "HEAVY", lengthKm: 3.1 },
      { name: "Silk Board Junction", congestion: "GRIDLOCK", lengthKm: 1.4 },
      { name: "Hospital Road", congestion: "LOW", lengthKm: 0.8 },
    ]);
    const m = await db.mission.create({
      data: {
        requestRef: "M-1001", patientName: "Ramesh (demo)", contact: "+91 90000 00001",
        emergencyType: "CARDIAC", priority: "CRITICAL", pickup: "Bannerghatta, Bengaluru",
        destination: "Victoria Hospital, Bengaluru", ambulanceId: als?.id ?? null,
        status: "COMPLETED", progress: 100, route, corridorActive: true,
        vehiclesAlerted: 312, timeSavedSec: 648, etaMin: 11,
      },
    });
    await db.corridorEvent.createMany({
      data: [
        { missionId: m.id, segment: "Bannerghatta Road", method: "V2X_5G", congestion: "MODERATE", vehiclesAlerted: 42, timeSavedSec: 52, note: "V2X alert + nav-app push" },
        { missionId: m.id, segment: "Outer Ring Road", method: "CELL_BROADCAST", congestion: "HEAVY", vehiclesAlerted: 118, timeSavedSec: 186, note: "Signal beacons relayed" },
        { missionId: m.id, segment: "Silk Board Junction", method: "BLE_MESH", congestion: "GRIDLOCK", vehiclesAlerted: 152, timeSavedSec: 410, note: "Cellular degraded — BLE mesh took over (offline zone)" },
      ],
    });
    await db.mission.create({
      data: { requestRef: "M-1002", patientName: "Sujata (demo)", contact: "+91 90000 00002", emergencyType: "MATERNITY", priority: "HIGH", pickup: "KR Puram, Bengaluru", destination: "Manipal Hospital, Bengaluru", status: "REQUESTED" },
    });
    console.log("  ✓ ambulances (5) + missions (2, 1 completed with corridor events)");
  }

  // ── Kit templates + batch of 24 units ──────────────────────────────────
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
        status: "IN_PROGRESS",
      },
    });
    const codes = Array.from({ length: 24 }, (_, i) => `UAR-RK-2026-${String(i + 1).padStart(6, "0")}`);
    await db.kitUnit.createMany({
      data: codes.map((code, i) => ({
        batchId: batch.id,
        code,
        status: i < 3 ? "SCANNED" : "READY",
        scannedAt: i < 3 ? days(-i - 1) : null,
        scannedById: i < 3 ? volunteerUser.id : null,
        scannedByName: i < 3 ? "Priya Nair" : null,
        location: i < 3 ? ["Whitefield camp", "Jayanagar", "KR Puram"][i] : null,
      })),
    });
    console.log("  ✓ kit template + batch (24 units, 3 scanned)");
  }

  // ── Inventory ──────────────────────────────────────────────────────────
  if ((await db.inventoryItem.count()) === 0) {
    await db.inventoryItem.createMany({
      data: [
        { name: "Rice (25kg sacks)", category: "FOOD_KIT", quantity: 180, unit: "sack", minStock: 40, location: "Central Warehouse, Peenya" },
        { name: "Wheat flour", category: "FOOD_KIT", quantity: 90, unit: "kg", minStock: 30, location: "Central Warehouse, Peenya" },
        { name: "Toor dal", category: "FOOD_KIT", quantity: 65, unit: "kg", minStock: 25, location: "Central Warehouse, Peenya" },
        { name: "Sanitary pads (packs)", category: "SANITARY_PADS", quantity: 420, unit: "pack", minStock: 100, location: "Pad Bank, Jayanagar" },
        { name: "BP tablets (Amlodipine)", category: "MEDICINE", quantity: 350, unit: "pack", minStock: 80, location: "Medicine Hub, Jayanagar" },
        { name: "Diabetes tablets (Metformin)", category: "MEDICINE", quantity: 60, unit: "pack", minStock: 80, location: "Medicine Hub, Jayanagar" },
        { name: "Dog feed (dry, 20kg)", category: "ANIMAL_FEED", quantity: 48, unit: "sack", minStock: 15, location: "Angel Paws Hub, HSR" },
        { name: "First-aid kits", category: "EQUIPMENT", quantity: 30, unit: "box", minStock: 10, location: "Ambulance Base, Bannerghatta" },
      ],
    });
    console.log("  ✓ inventory (8 items, 1 low-stock)");
  }

  // ── Beneficiaries ──────────────────────────────────────────────────────
  if ((await db.beneficiary.count()) === 0) {
    await db.beneficiary.createMany({
      data: [
        { name: "Muniamma", phone: "+91 90190 30001", city: "Bengaluru", category: "ELDERLY", familyMembers: 2, monthlyIncome: 4000, urgencyLevel: "HIGH", onboardedByName: "Priya Nair", notes: "BP + ration support, Jayanagar" },
        { name: "Shivanna", phone: "+91 90190 30002", city: "Bengaluru", category: "DAILY_WAGE", familyMembers: 4, monthlyIncome: 9000, urgencyLevel: "CRITICAL", onboardedByName: "Anjali Rao", notes: "Construction worker, Whitefield camp" },
        { name: "Fatima Begum", phone: "+91 90190 30003", city: "Bengaluru", category: "SINGLE_MOTHER", familyMembers: 5, monthlyIncome: 7500, urgencyLevel: "HIGH", onboardedByName: "Priya Nair" },
        { name: "Gopal Krishna", phone: "+91 90190 30004", city: "Mysuru", category: "ELDERLY", familyMembers: 3, monthlyIncome: 12000, urgencyLevel: "MEDIUM" },
        { name: "Sarala", phone: "+91 90190 30005", city: "Bengaluru", category: "PATIENT", familyMembers: 3, monthlyIncome: 8500, urgencyLevel: "HIGH" },
        { name: "Lakshmi Devi", userId: beneficiaryUser.id, phone: "+91 98860 10005", city: "Bengaluru", category: "WIDOW", familyMembers: 2, monthlyIncome: 3000, urgencyLevel: "HIGH" },
      ],
    });
    console.log("  ✓ beneficiaries (6)");
  }

  // ── Distributions + pad distributions ──────────────────────────────────
  if ((await db.distribution.count()) === 0) {
    const muniamma = await db.beneficiary.findFirst({ where: { name: "Muniamma" } });
    await db.distribution.createMany({
      data: [
        { type: "FOOD", beneficiaryId: muniamma?.id ?? null, volunteerId: volunteer.id, campaignId: campMap["ration-kits"], items: JSON.stringify([{ name: "Family Ration Kit", code: "UAR-RK-2026-000002" }]), quantity: 1, location: "Jayanagar", distributedAt: days(-2), notes: "Kit scanned at handover" },
        { type: "FOOD", volunteerId: volunteer.id, campaignId: campMap["ration-kits"], quantity: 3, location: "Whitefield camp", distributedAt: days(-4) },
        { type: "MEDICAL", beneficiaryId: muniamma?.id ?? null, volunteerId: volunteer.id, campaignId: campMap["medicine-adoption"], quantity: 2, location: "Jayanagar", distributedAt: days(-1), notes: "BP refill via Jan Aushadhi" },
      ],
    });
    await db.padDistribution.createMany({
      data: [
        { schoolName: "Govt High School, Jayanagar", area: "Jayanagar", girlsCount: 120, padsDistributed: 240, awarenessSession: true, sessionAttendees: 145, volunteerId: volunteer.id, distributionDate: days(-5) },
        { area: "KR Market slum cluster", girlsCount: 45, padsDistributed: 90, volunteerId: volunteer.id, distributionDate: days(-9) },
      ],
    });
    console.log("  ✓ distributions (3) + pad distributions (2)");
  }

  // ── Donations ──────────────────────────────────────────────────────────
  if ((await db.donation.count()) === 0) {
    let n = 1;
    const mk = (donorName: string, donorEmail: string, slug: string, amount: number, method: string, message?: string, recurring = false, anonymous = false) => ({
      receiptNumber: `UAR-RCPT-2026-${String(n++).padStart(5, "0")}`,
      donorId: donorName === "Rahul Sharma" ? donor.id : null,
      donorName,
      donorEmail,
      campaignId: campMap[slug],
      amount,
      type: recurring ? "RECURRING" : "ONE_TIME",
      paymentMethod: method,
      paymentStatus: "COMPLETED",
      message,
      isAnonymous: anonymous,
    });
    await db.donation.createMany({
      data: [
        mk("Rahul Sharma", "donor@demo.org", "anti-drug", 25000, "UPI", "For the college workshops — great work team"),
        mk("Rahul Sharma", "donor@demo.org", "medicine-adoption", 2400, "UPI", "Co-funding Gopal Krishna garu's cardiac tabs", true),
        mk("Infosys Foundation", "csr@example.com", "green-corridor", 500000, "BANK_TRANSFER", "CSR — Corridor pilot across 3 corridors"),
        mk("Anonymous", "anon@example.com", "sanitary-pads", 50000, "UPI", undefined, false, true),
        mk("Meera Krishnan", "meera@example.com", "child-safety", 15000, "RAZORPAY", "In memory of my grandmother"),
        mk("TechM Cares", "csr@techm.example", "ration-kits", 120000, "BANK_TRANSFER", undefined, true),
        mk("Suresh Babu", "suresh@example.com", "animal-welfare", 5000, "UPI", "Feed route sponsorship"),
        mk("Deepa Iyer", "deepa@example.com", "women-safety", 10000, "UPI", "Self-defence batch sponsor"),
        mk("Vijay Anand", "vijay@example.com", "cyber-crime", 7500, "UPI"),
        mk("Rahul Sharma", "donor@demo.org", "animal-welfare", 900, "UPI", "Brownie's food month", true),
      ],
    });
    console.log("  ✓ donations (10)");
  }

  // ── Volunteer tasks ────────────────────────────────────────────────────
  if ((await db.volunteerTask.count()) === 0) {
    await db.volunteerTask.createMany({
      data: [
        { volunteerId: volunteer.id, title: "Weekend ration drive — Whitefield camp", description: "Distribute 20 kits, scan each at handover", type: "DISTRIBUTION", status: "IN_PROGRESS", priority: "HIGH", location: "Whitefield camp", scheduledDate: days(2) },
        { volunteerId: volunteer.id, title: "School safety workshop — Govt HS Jayanagar", description: "POCSO + good-touch module for class 6–8 (2 hrs)", type: "EVENT", status: "ASSIGNED", priority: "MEDIUM", location: "Jayanagar", scheduledDate: days(6) },
        { title: "Kit batch 2026-01 packing", description: "Pack & label remaining units in batch 2026-01", volunteerId: volunteer.id, type: "KIT_SCAN", status: "ASSIGNED", priority: "MEDIUM", scheduledDate: days(4) },
        { title: "Feed route — HSR Sector 2", description: "Evening feeding for 14 street dogs", volunteerId: volunteer.id, type: "RESCUE", status: "ASSIGNED", priority: "HIGH", scheduledDate: days(1) },
      ],
    });
    console.log("  ✓ volunteer tasks (4)");
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
    console.log("  ✓ testimonials (4)");
  }

  // ── Settings ───────────────────────────────────────────────────────────
  const settings: [string, string, string?][] = [
    ["org.name", "United Angel Reach Trust", "Registered charitable trust"],
    ["org.hq", "Bengaluru, Karnataka, India"],
    ["org.vision", "From Bengaluru to the whole of India — every district served"],
    ["org.email", "care@unitedangelreach.org"],
    ["org.80g", "UAR/80G/2024/0147"],
    ["ops.lowStockAlerts", "true"],
    ["ops.currency", "INR"],
    ["assist.model", "glm-4.5-air"],
  ];
  for (const [key, value, description] of settings) {
    await db.setting.upsert({ where: { key }, update: { value }, create: { key, value, description } });
  }

  // ── Activity log ───────────────────────────────────────────────────────
  if ((await db.activityLog.count()) === 0) {
    await db.activityLog.createMany({
      data: [
        { actorName: "System", action: "SEED", entityType: "DATABASE", details: "Canonical seed: 9 campaigns, 8 causes, 6 animals, 5 ambulances, kit batch of 24, 65 masters" },
        { actorName: "Anjali Rao", userId: admin.id, action: "APPROVE", entityType: "VOLUNTEER", details: "Priya Nair approved as field volunteer" },
        { actorName: "Priya Nair", userId: volunteerUser.id, action: "SCAN", entityType: "KIT", details: "UAR-RK-2026-000002 scanned → Jayanagar" },
      ],
    });
  }

  console.log("✅ Seed complete. Logins: admin@unitedangelreach.org/Admin@123 · donor@demo.org/Donor@123 · volunteer@demo.org/Volun@123 · applicant@demo.org/Temp@12345 · beneficiary@demo.org/Benef@123");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
