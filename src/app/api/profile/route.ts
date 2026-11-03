import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import {
  requireAuth,
  ApiError,
  json,
  handleError,
  logActivity,
} from "@/lib/session";

export const dynamic = "force-dynamic";

const PHONE_RE = /^(\+91[\-\s]?)?[6-9]\d{9}$/;

function safeUser(u: {
  id: string;
  email: string;
  name: string;
  role: string;
  status: string;
  isActive: boolean;
  phone: string | null;
  city: string | null;
  pan: string | null;
  about: string | null;
  avatar: string | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  const { id, email, name, role, status, isActive, phone, city, pan, about, avatar, createdAt, updatedAt } = u;
  return { id, email, name, role, status, isActive, phone, city, pan, about, avatar, createdAt, updatedAt };
}

// GET /api/profile — the signed-in user's full record + role-aware extras
// (donor CRM stats / volunteer profile / beneficiary case). Used by the
// universal profile page for EVERY role.
export async function GET() {
  try {
    const session = await requireAuth();
    const user = await db.user.findUnique({ where: { id: session.userId } });
    if (!user) throw new ApiError("Account not found", 404);

    const extras: Record<string, unknown> = {};

    if (session.role === "DONOR") {
      const donationScope = {
        OR: [{ donorId: session.userId }, { donorEmail: session.email }],
      };
      const [donor, agg, completed, campaignIds] = await Promise.all([
        db.donor.findFirst({
          where: { OR: [{ userId: session.userId }, { email: session.email }] },
        }),
        db.donation.aggregate({
          where: donationScope,
          _sum: { amount: true },
          _count: { _all: true },
          _min: { createdAt: true },
          _max: { createdAt: true },
        }),
        db.donation.aggregate({
          where: { ...donationScope, paymentStatus: "COMPLETED" },
          _sum: { amount: true },
          _count: { _all: true },
        }),
        db.donation.findMany({
          where: { ...donationScope, campaignId: { not: null } },
          select: { campaignId: true },
          distinct: ["campaignId"],
        }),
      ]);
      extras.donor = donor;
      extras.stats = {
        lifetimeValue: completed._sum.amount ?? 0,
        donationCount: agg._count._all,
        completedCount: completed._count._all,
        receiptsCount: completed._count._all, // every completed gift carries an 80G receipt number
        campaignsSupported: campaignIds.length,
        firstDonationAt: agg._min.createdAt,
        lastDonationAt: agg._max.createdAt,
      };
    }

    if (session.role === "VOLUNTEER") {
      const volunteer = await db.volunteer.findUnique({
        where: { userId: session.userId },
      });
      if (volunteer) {
        const [tasksAssigned, tasksCompleted, attendanceDays, hours] = await Promise.all([
          db.volunteerTask.count({
            where: { volunteerId: volunteer.id, status: { not: "CANCELLED" } },
          }),
          db.volunteerTask.count({
            where: { volunteerId: volunteer.id, status: "COMPLETED" },
          }),
          db.volunteerAttendance.count({ where: { volunteerId: volunteer.id } }),
          db.volunteerAttendance.aggregate({
            where: { volunteerId: volunteer.id },
            _sum: { hours: true },
          }),
        ]);
        extras.volunteer = volunteer;
        extras.stats = {
          tasksAssigned,
          tasksCompleted,
          attendanceDays,
          hoursLogged: hours._sum.hours ?? 0,
        };
      } else {
        extras.volunteer = null;
        extras.stats = {
          tasksAssigned: 0,
          tasksCompleted: 0,
          attendanceDays: 0,
          hoursLogged: 0,
        };
      }
    }

    if (session.role === "BENEFICIARY") {
      const beneficiary = await db.beneficiary.findUnique({
        where: { userId: session.userId },
      });
      const requests = await db.beneficiaryRequest.findMany({
        where: beneficiary
          ? { OR: [{ userId: session.userId }, { beneficiaryId: beneficiary.id }] }
          : { userId: session.userId },
        orderBy: { createdAt: "desc" },
        take: 10,
      });
      const requestsByStatus: Record<string, number> = {};
      for (const r of requests) {
        requestsByStatus[r.status] = (requestsByStatus[r.status] ?? 0) + 1;
      }
      extras.beneficiary = beneficiary;
      extras.stats = {
        totalRequests: requests.length,
        requestsByStatus,
        caseStatus: beneficiary?.caseStatus ?? null,
      };
      extras.recentRequests = requests;
    }

    if (session.role === "ADMIN") {
      const actionsCount = await db.activityLog.count({ where: { userId: session.userId } });
      extras.stats = { actionsCount };
    }

    return json({ user: safeUser(user), extras });
  } catch (e) {
    return handleError(e);
  }
}

// PATCH /api/profile — self-service edits (name/phone/city/about/avatar only).
// Role and email are deliberately NOT editable here — that is an admin action
// in Users & Roles.
export async function PATCH(req: NextRequest) {
  try {
    const session = await requireAuth();
    const body = await req.json().catch(() => ({}));

    const data: Record<string, unknown> = {};

    if (body?.name !== undefined) {
      const name = String(body.name).trim();
      if (!name) throw new ApiError("Name cannot be empty", 400);
      data.name = name;
    }
    if (body?.phone !== undefined) {
      const phone = body.phone ? String(body.phone).trim() : null;
      if (phone && !PHONE_RE.test(phone.replace(/[\s-]/g, "")))
        throw new ApiError("Enter a valid 10-digit Indian mobile number", 400);
      data.phone = phone;
    }
    if (body?.city !== undefined) data.city = body.city ? String(body.city).trim() : null;
    if (body?.about !== undefined) data.about = body.about ? String(body.about) : null;
    if (body?.avatar !== undefined) data.avatar = body.avatar ? String(body.avatar) : null;

    if (Object.keys(data).length === 0) throw new ApiError("Nothing to update", 400);

    const updated = await db.user.update({
      where: { id: session.userId },
      data,
    });

    await logActivity(
      updated.name,
      "PROFILE_UPDATE",
      "USER",
      `${updated.email} → ${Object.keys(data).join(", ")}`,
      session.userId
    );

    return json({ user: safeUser(updated) });
  } catch (e) {
    return handleError(e);
  }
}
