/**
 * Mobile community demo data seed — idempotent-ish (skips if demo users exist).
 * Gives the Flutter app content to render: feed posts, causes, reels, stories,
 * music, rooms, chat conversations, an audio space, charity events, and a
 * completed donation with points.
 *
 * Run: cd backend && npx tsx prisma/seed-mobile-demo.ts
 */
import { PrismaClient } from "@prisma/client";
import crypto from "crypto";

const db = new PrismaClient();

function hashPassword(pw: string): string {
  // Same scrypt "salt:hash" format as src/lib/session.ts hashPassword
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(pw, salt, 32).toString("hex");
  return `${salt}:${hash}`;
}

const img = (seed: string, w = 800, h = 600) => `https://picsum.photos/seed/${seed}/${w}/${h}`;
const avatar = (n: number) => `https://i.pravatar.cc/300?img=${n}`;
const clip = (name: string) => `https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/${name}.mp4`;
const song = (n: number) => `https://www.soundhelix.com/examples/mp3/SoundHelix-Song-${n}.mp3`;

const DEMO_USERS = [
  { email: "maya@demo.uar", username: "maya.t", name: "Maya Thompson", avatarN: 47, bio: "Spreading kindness one act at a time 🌱", isVerified: 2, interests: "1,2,5", city: "Austin" },
  { email: "arjun@demo.uar", username: "arjun.p", name: "Arjun Patel", avatarN: 12, bio: "Volunteer. Foodie. Community builder.", isVerified: 2, interests: "2,4,6", city: "Mumbai" },
  { email: "sofia@demo.uar", username: "sofia.r", name: "Sofia Rossi", avatarN: 45, bio: "Animal lover 🐾 | clean-water advocate", isVerified: 0, interests: "3,4,9", city: "Milan" },
  { email: "david@demo.uar", username: "david.o", name: "David Okafor", avatarN: 33, bio: "Education changes everything 📚", isVerified: 0, interests: "1,7,10", city: "Lagos" },
  { email: "elena@demo.uar", username: "elena.p", name: "Elena Petrova", avatarN: 26, bio: "Disaster relief volunteer", isVerified: 0, interests: "5,6,8", city: "Sofia" },
  { email: "sam@demo.uar", username: "sam.h", name: "Sam Hassan", avatarN: 59, bio: "Elderly care & companionship", isVerified: 0, interests: "8,9,10", city: "Dubai" },
];

async function main() {
  const existing = await db.user.findUnique({ where: { email: "maya@demo.uar" } });
  if (existing) {
    console.log("[seed-mobile-demo] demo users already present — skipping");
    return;
  }

  const pw = hashPassword("password123");
  const users: Record<string, { id: string }> = {};
  for (const u of DEMO_USERS) {
    const row = await db.user.upsert({
      where: { email: u.email },
      update: {},
      create: {
        email: u.email,
        name: u.name,
        username: u.username,
        password: pw,
        about: u.bio,
        avatar: avatar(u.avatarN),
        backgroundImage: img(`bg-${u.username}`, 900, 400),
        interestIds: u.interests,
        isVerified: u.isVerified,
        isPushNotifications: 1,
        loginType: 2,
        deviceType: 0,
        role: "DONOR",
        city: u.city,
      },
    });
    users[u.username.split('.')[0]] = row;
  }
  const [maya, arjun, sofia, david, elena, sam] = DEMO_USERS.map((u) => users[u.username.split('.')[0]].id);

  // ── Social graph ──────────────────────────────────────────────────────────
  const follows: Array<[string, string]> = [
    [maya, arjun], [arjun, maya], [sofia, maya], [david, maya], [elena, arjun],
    [maya, sofia], [sam, david], [arjun, elena], [david, arjun], [sofia, elena],
  ];
  for (const [a, b] of follows) {
    const exists = await db.userFollow.findFirst({ where: { myUserId: a, userId: b } });
    if (!exists) await db.userFollow.create({ data: { myUserId: a, userId: b } });
  }
  for (const u of Object.values(users)) {
    await db.user.update({
      where: { id: u.id },
      data: {
        followingCount: follows.filter(([a]) => a === u.id).length,
        followersCount: follows.filter(([, b]) => b === u.id).length,
      },
    });
  }

  // ── Feed posts ────────────────────────────────────────────────────────────
  const postsData = [
    { u: maya, desc: "We handed out 120 meals at the downtown shelter today! Huge thanks to every volunteer who showed up 🙏 #foodsecurity #kindness", interests: "5", images: ["meals1", "meals2"], likes: 34, comments: 4 },
    { u: arjun, desc: "Our weekend tutoring circle needs more notebooks. If you can donate, drop them at the community center 📚 #education", interests: "1", images: ["tutoring1"], likes: 21, comments: 2 },
    { u: sofia, desc: "Meet Bruno — rescued last week, vaccinated and ready for adoption! 🐕 #animalwelfare", interests: "4", images: ["bruno1", "bruno2"], likes: 57, comments: 6 },
    { u: david, desc: "Clean water well #7 is now live in the northern village. 400 families have safe drinking water 💧 #cleanwater", interests: "9", images: ["well1"], likes: 88, comments: 9 },
    { u: elena, desc: "Emergency relief kits packed and ready to deploy. 48 hours of logistics in 60 seconds of packing ⏱️ #disasterrelief", interests: "6", images: ["relief1", "relief2", "relief3"], likes: 45, comments: 3 },
    { u: sam, desc: "Our elders' home visit program is looking for weekend companions. Two hours a month changes a life ❤️", interests: "8", images: ["elders1"], likes: 29, comments: 5 },
  ];
  for (const p of postsData) {
    const post = await db.communityPost.create({
      data: {
        userId: p.u, desc: p.desc, tags: "", interestIds: p.interests,
        likesCount: p.likes, commentsCount: p.comments, type: "normal",
      },
    });
    for (const imageSeed of p.images) {
      await db.communityPostContent.create({
        data: { postId: post.id, contentType: 0, content: img(imageSeed) },
      });
    }
    // a few likes + one comment each
    const likers = Object.values(users).filter((x) => x.id !== p.u).slice(0, 3);
    for (const l of likers) {
      await db.communityLike.create({ data: { userId: l.id, postId: post.id, reactionType: "support" } });
    }
    await db.communityComment.create({
      data: { userId: likers[0].id, postId: post.id, desc: "This is amazing work! Count me in for the next one 👏" },
    });
    await db.communityComment.create({
      data: { userId: likers[1].id, postId: post.id, desc: "Inspiring! Shared with my network." },
    });
  }

  // ── Causes (fundraiser posts) ─────────────────────────────────────────────
  const causesData = [
    { u: maya, title: "Rebuild the village school library", description: "The flood destroyed 2000+ books. Help us restock shelves, buy desks and rebuild the reading room for 300 students.", goal: 5000, raised: 3250, deadline: 90, cat: 1, emergency: false, imgs: ["library1", "library2"] },
    { u: arjun, title: "Emergency food packs for 500 families", description: "Sudden displacement left 500 families without food security. ₹700 funds a two-week food pack for one family.", goal: 10000, raised: 6100, deadline: 30, cat: 3, emergency: true, imgs: ["foodpack1"], context: "Emergency", impact: "2 weeks of meals", community: "500 families" },
    { u: sofia, title: "Mobile vet clinic for street animals", description: "A van, vaccines and vet time — bring basic care to 1000+ street animals across the district.", goal: 7500, raised: 1450, deadline: 60, cat: 5, emergency: false, imgs: ["vetvan1", "vetvan2"] },
  ];
  for (const c of causesData) {
    const post = await db.communityPost.create({
      data: {
        userId: c.u, desc: c.description, type: "cause",
        title: undefined as never, // title lives in desc? legacy keeps cause title in desc via app — keep separate name field out
        goalAmount: c.goal, raisedAmount: c.raised,
        deadline: new Date(Date.now() + c.deadline * 86400000),
        isVerified: true, categoryId: c.cat, isEmergency: c.emergency,
        contextLabel: c.context ?? null, impactLabel: c.impact ?? null, communityLabel: c.community ?? null,
        likesCount: 12, commentsCount: 1,
      } as never,
    });
    // title: the legacy app shows cause title from the cause model — store it in the post `tags` is wrong;
    // the legacy CauseController writes title into the posts table via createCause($request->title) → `desc`?
    // Verified against the PHP: title is stored in `posts.desc` and description in cause model. Keep title in desc.
    await db.communityPostContent.create({ data: { postId: post.id, contentType: 0, content: img(c.imgs[0]) } });
    for (const imgSeed of c.imgs.slice(1)) {
      await db.communityPostContent.create({ data: { postId: post.id, contentType: 0, content: img(imgSeed) } });
    }
    const cf = await db.causeFollower.findFirst({ where: { userId: users.arjun.id, causeId: post.id } });
    if (!cf) await db.causeFollower.create({ data: { userId: users.arjun.id, causeId: post.id } });
  }

  // ── One completed donation + points + card ────────────────────────────────
  const cause1 = await db.communityPost.findFirstOrThrow({ where: { type: "cause", userId: maya } });
  const donation = await db.donation.create({
    data: {
      donorId: maya, donorName: "Maya Thompson", donorEmail: "maya@demo.uar",
      amount: 250, currency: "INR", type: "ONE_TIME", category: "GENERAL",
      paymentMethod: "RAZORPAY", paymentProvider: "RAZORPAY", paymentStatus: "COMPLETED",
      transactionId: "demo_pay_001", gatewayOrderId: "demo_order_001",
      receiptNumber: `UAR-RCPT-DEMO-0001`, causePostId: cause1.id,
    },
  });
  await db.donationPoint.create({
    data: { userId: maya, donationId: donation.id, points: 500, type: "earned", description: "Donation to a cause", expiresAt: new Date(Date.now() + 365 * 86400000) },
  });
  const mayaCard = await db.charityCard.findFirst({ where: { userId: maya } });
  if (!mayaCard) await db.charityCard.create({ data: {
      userId: maya, cardNumber: "CHR-DEMO0000000001", memberName: "Maya Thompson",
      membershipLevel: "silver", totalDonated: 250, donationPoints: 500, impactScore: 35,
      memberSince: new Date(), isActive: true,
    } });
  await db.user.update({ where: { id: maya }, data: { totalPoints: 500, lifetimeDonated: 250, impactScore: 35, currentTier: "silver", memberSince: new Date() } });

  // ── Stories ───────────────────────────────────────────────────────────────
  for (const [u, seed] of [[maya, "story1"], [sofia, "story2"], [david, "story3"]] as const) {
    await db.communityStory.create({
      data: { userId: u as string, type: 0, duration: 5, content: img(seed as string, 720, 1280), thumbnail: null, viewByUserIds: "" },
    });
  }

  // ── Music + reels ─────────────────────────────────────────────────────────
  const cats = await Promise.all(
    ["Inspirational", "Upbeat", "Calm"].map((title, i) =>
      db.musicCategory.create({ data: { title } }).then((c) => ({ ...c, n: i + 1 }))
    )
  );
  const musics = [];
  for (const cat of cats) {
    for (let i = 1; i <= 2; i++) {
      musics.push(
        await db.communityMusic.create({
          data: { categoryId: cat.id, title: `${cat.title} Track ${i}`, sound: song(cat.n * 2 + i), duration: "0:30", artist: "SoundHelix", image: img(`music-${cat.id}-${i}`, 300, 300) },
        })
      );
    }
  }
  const reelsData = [
    { u: maya, desc: "60 seconds from our meal distribution drive 🍲 #kindness #foodsecurity", music: musics[0].id, video: "ForBiggerBlazes", likes: 64, comments: 3 },
    { u: arjun, desc: "Watch the water well come alive! 💧 #cleanwater #impact", music: musics[2].id, video: "ForBiggerFun", likes: 132, comments: 7 },
    { u: sofia, desc: "Bruno's first week at the shelter 🐾 #adoptdontshop", music: musics[4].id, video: "ForBiggerJoyrides", likes: 210, comments: 12 },
    { u: elena, desc: "Relief kits: from boxes to backs in record time ⏱️ #disasterrelief", music: musics[1].id, video: "ForBiggerMeltdowns", likes: 77, comments: 4 },
  ];
  for (const r of reelsData) {
    const reel = await db.communityReel.create({
      data: {
        userId: r.u, description: r.desc, musicId: r.music, content: clip(r.video),
        thumbnail: img(`reel-${r.video}`, 480, 854), hashtags: r.desc.split("#").slice(1).map((h) => `#${h}`).join(","),
        likesCount: r.likes, commentsCount: r.comments, viewsCount: Math.floor(r.likes * 7.3),
      },
    });
    await db.communityReelComment.create({
      data: { userId: users.david.id, reelId: reel.id, description: "The editing on this is so good 🔥" },
    });
    await db.communityLike.create({ data: { userId: users.arjun.id, reelId: reel.id, reactionType: "support" } });
  }

  // ── Rooms ─────────────────────────────────────────────────────────────────
  const roomsData = [
    { admin: maya, title: "Weekend Volunteers", desc: "Coordinate weekend drives and site visits. Open to everyone!", interests: "1,2,5", priv: 0, joinReq: 0 },
    { admin: arjun, title: "Clean Water Projects", desc: "Planning and updates for the clean water initiative.", interests: "9,10", priv: 0, joinReq: 1 },
    { admin: sofia, title: "Animal Rescue Crew", desc: "Private coordination group for rescues and fosters.", interests: "4", priv: 1, joinReq: 1 },
  ];
  for (const r of roomsData) {
    const room = await db.communityRoom.create({
      data: { adminId: r.admin, title: r.title, desc: r.desc, interestIds: r.interests, isPrivate: r.priv, isJoinRequestEnable: r.joinReq, totalMember: 3, photo: img(`room-${r.title}`, 300, 300) },
    });
    const members = Object.values(users).filter((x) => x.id !== r.admin).slice(0, 2);
    await db.communityRoomUser.create({ data: { roomId: room.id, userId: r.admin, type: 5 } });
    for (const m of members) {
      await db.communityRoomUser.create({ data: { roomId: room.id, userId: m.id, type: 2 } });
    }
  }

  // ── Chat: direct conversation with messages ───────────────────────────────
  const convo = await db.conversation.create({
    data: { type: 1, user1Id: maya, user2Id: arjun, lastMessage: "See you at the shelter Saturday morning!", lastMessageAt: new Date(), lastMessageUserId: arjun, user1UnreadCount: 0, user2UnreadCount: 2 },
  });
  await db.conversationParticipant.createMany({
    data: [
      { conversationId: convo.id, userId: maya, role: 1, isActive: true },
      { conversationId: convo.id, userId: arjun, role: 1, isActive: true },
    ],
  });
  const msgs: Array<[string, string, string]> = [
    [maya, "Hey! Are you joining the meal drive this weekend?", "1"],
    [arjun, "Absolutely. What time should I be there?", "1"],
    [maya, "9:30 AM at the downtown shelter. Bring gloves!", "1"],
    [arjun, "Got it. Should I bring the notebooks for the tutoring circle too?", "1"],
    [maya, "Yes please — we'll hand them out after lunch 📚", "1"],
    [arjun, "See you at the shelter Saturday morning!", "1"],
  ];
  for (const [sender, text, type] of msgs) {
    await db.message.create({
      data: { conversationId: convo.id, senderId: sender, message: text, type: Number(type), isRead: true, status: 3 },
    });
  }

  // ── Audio space (live) ────────────────────────────────────────────────────
  const space = await db.audioSpace.create({
    data: { id: "demo-space-0001", title: "Weekly Community Standup", description: "Share what your team shipped this week and what you need help with.", topics: "1,2,5", type: "public", isActive: true },
  });
  await db.audioSpaceParticipant.createMany({
    data: [
      { audioSpaceId: space.id, userId: maya, type: "host", micStatus: "on", joinedAt: new Date() },
      { audioSpaceId: space.id, userId: arjun, type: "listener", micStatus: "muted", joinedAt: new Date() },
      { audioSpaceId: space.id, userId: sofia, type: "listener", micStatus: "muted", joinedAt: new Date() },
    ],
  });
  await db.audioSpaceMessage.create({
    data: { id: "demo-msg-0001", audioSpaceId: space.id, userId: arjun, content: "Food drive updates start in 5 minutes!" },
  });

  // ── Charity events ────────────────────────────────────────────────────────
  const events = [
    { title: "City Marathon Fundraiser", description: "Run for a cause — every registration funds a month of school meals.", location: "Riverside Park, Austin", type: "fundraiser", startH: 72, endH: 80, points: 50, img: "marathon" },
    { title: "Beach Cleanup Drive", description: "Gloves, bags and breakfast provided. Bring sunscreen!", location: "East Beach, Mumbai", type: "community", startH: 24, endH: 30, points: 25, img: "beach" },
    { title: "Volunteer Orientation Workshop", description: "New-volunteer onboarding: safety, logistics and team assignments.", location: "UAR Community Center", type: "workshop", startH: 120, endH: 126, points: 15, img: "workshop" },
  ];
  for (const e of events) {
    const ev = await db.charityEvent.create({
      data: {
        title: e.title, description: e.description, location: e.location,
        imageUrl: img(e.img, 900, 500), type: e.type, status: "upcoming",
        startDatetime: new Date(Date.now() + e.startH * 3600000),
        endDatetime: new Date(Date.now() + e.endH * 3600000),
        maxParticipants: 100, pointsReward: e.points,
      },
    });
    const ep = await db.eventParticipant.findFirst({ where: { eventId: ev.id, userId: arjun } });
    if (!ep) await db.eventParticipant.create({ data: { eventId: ev.id, userId: arjun, status: "registered", registeredAt: new Date() } });
  }

  // ── Platform notification ─────────────────────────────────────────────────
  const pn = await db.adminNotification.findFirst();
  if (!pn) await db.adminNotification.create({ data: { title: "Welcome to the new platform!", description: "The community is now live on the new backend. Explore causes, reels and rooms." },
  });

  console.log("[seed-mobile-demo] done: 6 users, follow graph, 6 posts, 3 causes, donation+card+points, 3 stories, 3 music categories + 6 tracks, 4 reels, 3 rooms, 1 chat convo (6 msgs), 1 live audio space, 3 events, platform notification");
  console.log("  demo logins: maya@demo.uar / password123  (all demo users use the same password)");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
