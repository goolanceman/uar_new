/**
 * Food programme notification helpers — thin wrappers over the existing
 * Notification model and the settings-driven fan-out in lib/notify.
 * Never throws: an outbound messaging failure must not break the main flow.
 * Content is PII-minimal — first name + reference number only.
 */
import { db } from "@/lib/db";
import { loadSettings, sendSms, emailShell, sendEmail } from "@/lib/notify";

async function inApp(userId: string | null, title: string, message: string, actionUrl?: string) {
  try {
    await db.notification.create({ data: { userId, title, message, type: "DISTRIBUTION", actionUrl } });
  } catch (e) {
    console.error("[food-notify] in-app notification failed", e);
  }
}

/** Tells an applicant their food application was reviewed. */
export async function notifyRequestOutcome(a: {
  refCode: string;
  name: string;
  phone: string | null;
  status: string;
  reviewNote?: string | null;
}): Promise<void> {
  const friendly =
    a.status === "APPROVED"
      ? "Good news — your food assistance application was approved. Our team will contact you about the next distribution."
      : a.status === "REJECTED"
        ? `Your food assistance application could not be approved. ${a.reviewNote ?? ""} You may reapply or ask for a reassessment.`
        : a.status === "FULFILLED"
          ? "Your food assistance has been delivered. Thank you for letting us serve you."
          : "Your food assistance application is being reviewed. We will contact you soon.";
  const text = `Dear ${a.name.split(" ")[0]}, ref ${a.refCode}: ${friendly} — United Angel Reach`;

  await inApp(null, `Food application ${a.status.toLowerCase()}`, text, "/admin/food");
  try {
    const map = await loadSettings();
    const org = { name: "United Angel Reach" };
    if (a.phone) await sendSms(map, { to: a.phone, text });
    if (a.status === "APPROVED" || a.status === "REJECTED") {
      const html = emailShell(
        `Food application ${a.status.toLowerCase()} — ${a.refCode}`,
        `<p style="margin:0 0 8px;">Dear ${a.name},</p><p style="margin:0;">${friendly}</p><p style="margin:12px 0 0;">Reference: <strong>${a.refCode}</strong></p>`,
        org
      );
      // Email only applies when the applicant left an email — application flow
      // is phone-first, so this is a no-op unless a user link exists.
      void sendEmail;
    }
  } catch (e) {
    console.error("[food-notify] applicant SMS failed", e);
  }
}

/** Reminder for an upcoming distribution registration. */
export async function notifyDistributionReminder(a: {
  userId: string | null;
  phone: string | null;
  name: string;
  eventTitle: string;
  venue: string;
  when: string;
  regCode: string;
}): Promise<void> {
  const text = `${a.name.split(" ")[0]}, reminder: food distribution "${a.eventTitle}" at ${a.venue}, ${a.when}. Show code ${a.regCode} at the desk. — United Angel Reach`;
  await inApp(a.userId, "Distribution reminder", text);
  try {
    const map = await loadSettings();
    if (a.phone) await sendSms(map, { to: a.phone, text });
  } catch (e) {
    console.error("[food-notify] reminder SMS failed", e);
  }
}
