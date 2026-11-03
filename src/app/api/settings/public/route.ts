import { json, handleError } from "@/lib/session";
import { publicOrgSettings } from "../../_lib/org";

export const dynamic = "force-dynamic";

// GET /api/settings/public — no auth. Public org identity subset
// consumed by public pages (letterheads, footers, UPI, vision).
export async function GET() {
  try {
    return json(await publicOrgSettings());
  } catch (e) {
    return handleError(e);
  }
}
