/**
 * Retires the mobile-only "causes" duplicate: CommunityPost rows with
 * type='cause' (app_posts) and their mobile-only dependents.
 *
 * The mobile Causes feature now consumes the real Campaign domain via the
 * website endpoints (GET /api/campaigns, POST /api/donations,
 * POST /api/payments[/verify]) — see routes/mobile/charity.ts header.
 *
 * - Donation rows are FINANCIAL RECORDS and are never deleted. causePostId is
 *   unlinked (set to NULL) so the FK to a deleted post does not dangle; a
 *   summary of every affected donation is printed.
 * - CauseFollower rows of retired causes are removed (mobile-only feature with
 *   no campaign equivalent).
 * - CommunityReel.causeId references are nulled (no FK — soft reference).
 * - CauseCategory rows are kept (referenced by the schema; harmless legacy).
 *
 * Idempotent: on a second run the cause-post query matches nothing.
 *
 * Run against the DB pointed to by DATABASE_URL (backend/.env):
 *   npx tsx scripts/cleanup-mobile-causes.ts
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

async function main() {
  const causes = await db.communityPost.findMany({
    where: { type: "cause" },
    select: {
      id: true,
      userId: true,
      raisedAmount: true,
      _count: { select: { content: true, comments: true, likes: true, causeFollowers: true } },
    },
  });

  console.log(`[cleanup] cause posts (app_posts type='cause'): ${causes.length}`);
  for (const c of causes) {
    console.log(
      `  - ${c.id} user=${c.userId} raised=${c.raisedAmount} ` +
        `content=${c._count.content} comments=${c._count.comments} likes=${c._count.likes} followers=${c._count.causeFollowers}`
    );
  }
  if (causes.length === 0) {
    console.log("[cleanup] nothing to do — already clean.");
    return;
  }
  const causeIds = causes.map((c) => c.id);

  // ── Donations: financial records — keep, unlink, summarize ─────────────────
  const donations = await db.donation.findMany({
    where: { causePostId: { in: causeIds } },
    select: {
      id: true,
      receiptNumber: true,
      donorName: true,
      amount: true,
      currency: true,
      paymentStatus: true,
      gatewayOrderId: true,
      createdAt: true,
    },
    orderBy: { createdAt: "asc" },
  });
  const completed = donations.filter((d) => d.paymentStatus === "COMPLETED");
  console.log(`[cleanup] donations linked to cause posts: ${donations.length} ` +
    `(kept — financial records; causePostId unlinked)`);
  for (const d of donations) {
    console.log(
      `  - ${d.id} ${d.receiptNumber} ${d.paymentStatus} ${d.currency} ${d.amount} ` +
        `donor=${d.donorName ?? "-"} order=${d.gatewayOrderId ?? "-"} at=${d.createdAt.toISOString()}`
    );
  }
  console.log(
    `[cleanup] completed: ${completed.length}, total completed amount: ` +
      `${completed.reduce((s, d) => s + d.amount, 0)} ${completed[0]?.currency ?? "INR"}`
  );
  await db.donation.updateMany({
    where: { causePostId: { in: causeIds } },
    data: { causePostId: null },
  });

  // ── Mobile-only dependents ─────────────────────────────────────────────────
  const followers = await db.causeFollower.deleteMany({
    where: { causeId: { in: causeIds } },
  });
  console.log(`[cleanup] cause followers removed: ${followers.count}`);

  // CommunityReel.causeId is a soft reference (no FK) — null it out.
  const reels = await db.communityReel.updateMany({
    where: { causeId: { in: causeIds } },
    data: { causeId: null },
  });
  console.log(`[cleanup] reel cause references cleared: ${reels.count}`);

  // CommunityPostContent / comments / likes / reports cascade with the post.
  const posts = await db.communityPost.deleteMany({
    where: { id: { in: causeIds }, type: "cause" },
  });
  console.log(`[cleanup] cause posts deleted: ${posts.count}`);

  // ── Verify ─────────────────────────────────────────────────────────────────
  const [leftoverPosts, leftoverFollowers, linkedDonations] = await Promise.all([
    db.communityPost.count({ where: { type: "cause" } }),
    db.causeFollower.count({ where: { causeId: { in: causeIds } } }),
    db.donation.count({ where: { causePostId: { in: causeIds } } }),
  ]);
  console.log(
    `[cleanup] verify: cause posts left=${leftoverPosts}, followers left=${leftoverFollowers}, donations still linked=${linkedDonations}`
  );
  console.log("[cleanup] done.");
}

main()
  .catch((e) => {
    console.error("[cleanup] failed:", e);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
