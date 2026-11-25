/**
 * Live operations snapshots for the Angel AI assistant — ADMIN-only.
 * These turn free-text questions like "what's low on stock?" or
 * "show today's analytics" into real numbers pulled straight from the
 * database, instead of the assistant guessing or only quoting static
 * knowledge-base copy. Keep every query cheap (counts/aggregates/small
 * `take` limits) since this runs inline before every chat reply.
 */
import { db } from "@/lib/db";
import { formatINR } from "@/lib/format";

export interface OpsSection {
  title: string;
  content: string;
}

const matches = (msg: string, words: string[]) => words.some((w) => msg.includes(w));

async function inventorySnapshot(): Promise<OpsSection> {
  const items = await db.inventoryItem.findMany({
    select: { name: true, quantity: true, unit: true, minStock: true },
  });
  const low = items
    .filter((i) => i.quantity <= i.minStock)
    .sort((a, b) => a.quantity - b.quantity)
    .slice(0, 8);
  const lines = low.length
    ? low.map((i) => `- ${i.name}: ${i.quantity} ${i.unit} left (reorder at ${i.minStock})`).join("\n")
    : "- None — every item is above its reorder level.";
  return {
    title: "LIVE INVENTORY",
    content: `Total master items: ${items.length}\nItems at/below reorder level (${low.length}):\n${lines}`,
  };
}

async function analyticsSnapshot(): Promise<OpsSection> {
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const [donationAgg, donorCount, campaignCount, causeCount, animalCount, volunteerCount, beneficiaryCount, distThisMonth, missionsActive] =
    await Promise.all([
      db.donation.aggregate({ _sum: { amount: true }, _count: true, where: { paymentStatus: "COMPLETED" } }),
      db.donor.count(),
      db.campaign.count({ where: { status: "ACTIVE" } }),
      db.cause.count({ where: { status: { in: ["SEEKING", "PARTIAL"] } } }),
      db.animal.count(),
      db.volunteer.count({ where: { status: "ACTIVE" } }),
      db.beneficiary.count(),
      db.distribution.aggregate({ _count: true, _sum: { quantity: true }, where: { distributedAt: { gte: monthStart } } }),
      db.mission.count({ where: { status: { in: ["REQUESTED", "DISPATCHED", "EN_ROUTE", "ARRIVED"] } } }),
    ]);
  return {
    title: "LIVE ANALYTICS SNAPSHOT",
    content: [
      `Total donations (completed): ${formatINR(donationAgg._sum.amount ?? 0)} across ${donationAgg._count} gifts from ${donorCount} donors`,
      `Active campaigns: ${campaignCount} · Open medical causes: ${causeCount}`,
      `Animals in system: ${animalCount} · Active volunteers: ${volunteerCount} · Registered beneficiaries: ${beneficiaryCount}`,
      `This month: ${distThisMonth._count} distributions, ${distThisMonth._sum.quantity ?? 0} total units handed out`,
      `Ambulance missions in progress right now: ${missionsActive}`,
    ].join("\n"),
  };
}

async function volunteerWorkloadSnapshot(): Promise<OpsSection> {
  const volunteers = await db.volunteer.findMany({
    where: { status: "ACTIVE" },
    select: {
      user: { select: { name: true } },
      assignedArea: true,
      tasks: { where: { status: { in: ["ASSIGNED", "IN_PROGRESS"] } }, select: { id: true } },
    },
    take: 100,
  });
  const ranked = volunteers
    .map((v) => ({ name: v.user.name, area: v.assignedArea, open: v.tasks.length }))
    .sort((a, b) => a.open - b.open)
    .slice(0, 8);
  const lines = ranked.length
    ? ranked.map((v) => `- ${v.name}${v.area ? ` (${v.area})` : ""}: ${v.open} open task(s)`).join("\n")
    : "- No active volunteers on file yet.";
  return {
    title: "LIVE VOLUNTEER WORKLOAD (lightest load first — good for new task assignment)",
    content: lines,
  };
}

async function distributionSnapshot(): Promise<OpsSection> {
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const [today, recent] = await Promise.all([
    db.distribution.aggregate({ _count: true, _sum: { quantity: true }, where: { distributedAt: { gte: todayStart } } }),
    db.distribution.findMany({
      orderBy: { distributedAt: "desc" },
      take: 5,
      select: { type: true, quantity: true, location: true, distributedAt: true },
    }),
  ]);
  const lines = recent
    .map((d) => `- ${d.type} ×${d.quantity} at ${d.location ?? "unspecified location"} (${d.distributedAt.toISOString().slice(0, 10)})`)
    .join("\n");
  return {
    title: "LIVE DISTRIBUTIONS",
    content: `Today: ${today._count} distribution(s), ${today._sum.quantity ?? 0} units\nMost recent 5:\n${lines || "- None recorded yet."}`,
  };
}

async function animalAmbulanceSnapshot(): Promise<OpsSection> {
  const [animalsByStatus, ambulancesByStatus] = await Promise.all([
    db.animal.groupBy({ by: ["status"], _count: true }),
    db.ambulance.groupBy({ by: ["status"], _count: true }),
  ]);
  const a = animalsByStatus.map((x) => `${x.status}: ${x._count}`).join(", ") || "none on file";
  const b = ambulancesByStatus.map((x) => `${x.status}: ${x._count}`).join(", ") || "none on file";
  return {
    title: "LIVE ANIMALS & AMBULANCE FLEET",
    content: `Animals by status — ${a}\nAmbulances by status — ${b}`,
  };
}

async function donorSnapshot(): Promise<OpsSection> {
  const top = await db.donation.groupBy({
    by: ["donorName"],
    _sum: { amount: true },
    where: { paymentStatus: "COMPLETED" },
    orderBy: { _sum: { amount: "desc" } },
    take: 5,
  });
  const lines = top.map((t) => `- ${t.donorName}: ${formatINR(t._sum.amount ?? 0)}`).join("\n");
  return {
    title: "LIVE TOP DONORS",
    content: lines || "- No completed donations yet.",
  };
}

/**
 * Build the set of live-data sections relevant to this message for an ADMIN
 * (or VOLUNTEER, where noted) asking an ops question. Returns [] when the
 * message doesn't match any ops keyword — the assistant then falls back to
 * the static knowledge base only.
 */
export async function buildLiveOpsContext(message: string, role: string): Promise<OpsSection[]> {
  if (role !== "ADMIN" && role !== "VOLUNTEER") return [];
  const msg = message.toLowerCase();
  const sections: OpsSection[] = [];
  const tasks: Promise<OpsSection>[] = [];

  if (matches(msg, ["stock", "inventory", "available", "left in", "how much", "reorder", "low on"]))
    tasks.push(inventorySnapshot());
  if (role === "ADMIN" && matches(msg, ["analytic", "report", "summary", "stats", "numbers", "dashboard", "how are we doing", "overview"]))
    tasks.push(analyticsSnapshot());
  if (matches(msg, ["volunteer", "assign", "task", "workload"])) tasks.push(volunteerWorkloadSnapshot());
  if (matches(msg, ["distribution", "handed out", "delivered", "today"])) tasks.push(distributionSnapshot());
  if (matches(msg, ["animal", "ambulance", "mission", "fleet"])) tasks.push(animalAmbulanceSnapshot());
  if (role === "ADMIN" && matches(msg, ["donor", "top giver", "who donated"])) tasks.push(donorSnapshot());

  if (tasks.length === 0) return [];
  const settled = await Promise.allSettled(tasks);
  for (const s of settled) if (s.status === "fulfilled") sections.push(s.value);
  return sections;
}
