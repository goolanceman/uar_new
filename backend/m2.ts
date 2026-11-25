import "dotenv/config";
import { issueToken } from "@/lib/session";
import { db } from "@/lib/db";
db.user.findUnique({ where: { email: "admin@uar.local" } }).then(a => { console.log(issueToken({ userId: a.id, role: "ADMIN", name: a.name, email: a.email })); process.exit(0); });
