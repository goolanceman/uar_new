// Database seed file for United Angel Reach
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  console.log("Starting seed...");

  // Create admin user
  const admin = await prisma.user.upsert({
    where: { email: "admin@unitedangelreach.org" },
    update: {},
    create: {
      email: "admin@unitedangelreach.org",
      name: "Admin User",
      phone: "+91 9876543210",
      password: "admin123", // In production, hash this!
      role: "ADMIN",
    },
  });

  console.log("Created admin user:", admin.email);

  // Create sample donors
  const donors = await Promise.all([
    prisma.user.upsert({
      where: { email: "rahul@email.com" },
      update: {},
      create: {
        email: "rahul@email.com",
        name: "Rahul Sharma",
        phone: "+91 9876543211",
        password: "donor123",
        role: "DONOR",
      },
    }),
    prisma.user.upsert({
      where: { email: "priya@email.com" },
      update: {},
      create: {
        email: "priya@email.com",
        name: "Priya Patel",
        phone: "+91 9876543212",
        password: "donor123",
        role: "DONOR",
      },
    }),
    prisma.user.upsert({
      where: { email: "mohammed@email.com" },
      update: {},
      create: {
        email: "mohammed@email.com",
        name: "Mohammed Khan",
        phone: "+91 9876543213",
        password: "donor123",
        role: "DONOR",
      },
    }),
  ]);

  console.log("Created", donors.length, "donors");

  // Create sample volunteer users
  const volunteerUsers = await Promise.all([
    prisma.user.upsert({
      where: { email: "arjun@email.com" },
      update: {},
      create: {
        email: "arjun@email.com",
        name: "Arjun Reddy",
        phone: "+91 9876543221",
        password: "volunteer123",
        role: "VOLUNTEER",
      },
    }),
    prisma.user.upsert({
      where: { email: "sneha@email.com" },
      update: {},
      create: {
        email: "sneha@email.com",
        name: "Sneha Gupta",
        phone: "+91 9876543222",
        password: "volunteer123",
        role: "VOLUNTEER",
      },
    }),
  ]);

  // Create volunteer profiles
  for (const user of volunteerUsers) {
    await prisma.volunteer.upsert({
      where: { userId: user.id },
      update: {},
      create: {
        userId: user.id,
        skills: JSON.stringify(["Distribution", "Driving"]),
        assignedArea: user.name.includes("Arjun") ? "Bangalore North" : "Mysore",
        status: "ACTIVE",
      },
    });
  }

  console.log("Created", volunteerUsers.length, "volunteers");

  // Create sample campaigns
  const campaigns = await Promise.all([
    prisma.campaign.create({
      data: {
        title: "Ramadan Food Drive 2024",
        description: "Distribute food kits to 500 families during Ramadan month. Each kit contains rice, dal, oil, sugar, and other essentials.",
        category: "FOOD_DISTRIBUTION",
        targetAmount: 500000,
        raisedAmount: 375000,
        startDate: new Date("2024-03-01"),
        endDate: new Date("2024-04-15"),
        location: "Bangalore, Karnataka",
        status: "ACTIVE",
        createdBy: admin.id,
      },
    }),
    prisma.campaign.create({
      data: {
        title: "Girls Education Initiative",
        description: "Support education for 100 underprivileged girls by providing school supplies, uniforms, and tuition fees.",
        category: "EDUCATION_SUPPORT",
        targetAmount: 300000,
        raisedAmount: 280000,
        startDate: new Date("2024-01-01"),
        endDate: new Date("2024-06-30"),
        location: "Multiple Locations",
        status: "ACTIVE",
        createdBy: admin.id,
      },
    }),
    prisma.campaign.create({
      data: {
        title: "Sanitary Pads for Schools",
        description: "Provide sanitary pads to 50 schools in rural areas and conduct awareness sessions on menstrual hygiene.",
        category: "SANITARY_PADS",
        targetAmount: 200000,
        raisedAmount: 200000,
        startDate: new Date("2024-01-01"),
        endDate: new Date("2024-03-31"),
        location: "Rural Karnataka",
        status: "COMPLETED",
        createdBy: admin.id,
      },
    }),
  ]);

  console.log("Created", campaigns.length, "campaigns");

  // Create sample donations
  const donationData = [
    { donor: donors[0], amount: 5000, category: "FOOD_DISTRIBUTION" },
    { donor: donors[1], amount: 2500, category: "EDUCATION_SUPPORT", type: "RECURRING" },
    { donor: donors[2], amount: 10000, category: "SANITARY_PADS" },
  ];

  for (const data of donationData) {
    await prisma.donation.create({
      data: {
        donorId: data.donor.id,
        donorName: data.donor.name,
        donorEmail: data.donor.email,
        donorPhone: data.donor.phone,
        amount: data.amount,
        category: data.category,
        type: data.type || "ONE_TIME",
        paymentMethod: "UPI",
        paymentStatus: "COMPLETED",
        receiptNumber: `UAR-${Date.now()}-${Math.random().toString(36).substr(2, 6).toUpperCase()}`,
        campaignId: campaigns[0].id,
      },
    });
  }

  console.log("Created sample donations");

  // Create sample beneficiaries
  const beneficiaries = await Promise.all([
    prisma.beneficiary.create({
      data: {
        name: "Fatima Begum",
        phone: "+91 9876543231",
        address: "Village Panchayat, Bangalore Rural",
        city: "Bangalore",
        state: "Karnataka",
        category: "WIDOW",
        urgencyLevel: "HIGH",
        familyMembers: 4,
        needs: JSON.stringify(["Food", "Education"]),
      },
    }),
    prisma.beneficiary.create({
      data: {
        name: "Ramesh Kumar",
        phone: "+91 9876543232",
        address: "Gandhi Nagar, Mysore",
        city: "Mysore",
        state: "Karnataka",
        category: "DISABLED",
        urgencyLevel: "CRITICAL",
        familyMembers: 2,
        needs: JSON.stringify(["Medical", "Food"]),
      },
    }),
    prisma.beneficiary.create({
      data: {
        name: "Lakshmi Devi",
        phone: "+91 9876543233",
        address: "Tumkur Road, Tumkur",
        city: "Tumkur",
        state: "Karnataka",
        category: "SINGLE_MOTHER",
        urgencyLevel: "MEDIUM",
        familyMembers: 3,
        needs: JSON.stringify(["Education", "Food"]),
      },
    }),
  ]);

  console.log("Created", beneficiaries.length, "beneficiaries");

  // Create sample inventory items
  const inventoryItems = await Promise.all([
    prisma.inventoryItem.create({
      data: {
        name: "Rice (5kg pack)",
        category: "FOOD_KIT",
        unit: "packs",
        quantity: 450,
        minStock: 100,
      },
    }),
    prisma.inventoryItem.create({
      data: {
        name: "Sanitary Pads (pack of 10)",
        category: "SANITARY_PADS",
        unit: "packs",
        quantity: 850,
        minStock: 200,
      },
    }),
    prisma.inventoryItem.create({
      data: {
        name: "School Notebooks",
        category: "EDUCATION_MATERIAL",
        unit: "pieces",
        quantity: 1200,
        minStock: 300,
      },
    }),
    prisma.inventoryItem.create({
      data: {
        name: "Dal (1kg pack)",
        category: "FOOD_KIT",
        unit: "packs",
        quantity: 85,
        minStock: 100,
      },
    }),
  ]);

  console.log("Created", inventoryItems.length, "inventory items");

  // Create sample distributions
  const volunteer = await prisma.volunteer.findFirst();
  if (volunteer) {
    await prisma.distribution.create({
      data: {
        type: "FOOD",
        beneficiaryId: beneficiaries[0].id,
        volunteerId: volunteer.id,
        items: JSON.stringify(["Rice 5kg", "Dal 1kg", "Oil 1L"]),
        quantity: 1,
        location: "Bangalore Rural",
        distributedAt: new Date(),
      },
    });
    console.log("Created sample distribution");
  }

  // Create sample pad distribution
  await prisma.padDistribution.create({
    data: {
      schoolName: "Government High School, Mysore",
      area: "Mysore",
      girlsCount: 120,
      padsDistributed: 480,
      awarenessSession: true,
      sessionAttendees: 100,
      distributionDate: new Date(),
    },
  });

  console.log("Created sample pad distribution");

  // Create settings (using upsert for each)
  const settingsData = [
    { key: "org_name", value: "United Angel Reach Trust", description: "Organization name" },
    { key: "org_registration", value: "TR/1234/2020", description: "Registration number" },
    { key: "org_upi", value: "unitedangelreach@upi", description: "UPI ID for donations" },
    { key: "org_phone", value: "+91 80 1234 5678", description: "Contact phone" },
    { key: "org_email", value: "contact@unitedangelreach.org", description: "Contact email" },
  ];

  for (const setting of settingsData) {
    await prisma.setting.upsert({
      where: { key: setting.key },
      update: { value: setting.value },
      create: setting,
    });
  }

  console.log("Created organization settings");

  console.log("Seed completed successfully!");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
