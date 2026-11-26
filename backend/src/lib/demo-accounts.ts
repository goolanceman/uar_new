/**
 * Demo accounts — SINGLE SOURCE OF TRUTH for the seeded demo logins.
 *
 * Consumed by:
 *  - prisma/seed.ts — creates exactly these users (nothing else about the
 *    demo data changes), and
 *  - GET /api/auth/demo-accounts — served ONLY while testing mode is ON
 *    (Setting "app.testingMode" or env TESTING_MODE), so credentials never
 *    reach a login screen in production.
 *
 * `key`, `name`, `city` and `phone` are seed metadata — the endpoint projects
 * only { role, label, email, password, description, portal }.
 */

export interface DemoAccount {
  /** Seed key (prisma/seed.ts links volunteer/health profiles against it). */
  key: string;
  /** Platform role — User.role. */
  role: string;
  /** Short display label shown on the login screens. */
  label: string;
  name: string;
  email: string;
  password: string;
  /** One line on what the account demonstrates. */
  description: string;
  /** Web portal path this role lands on after sign-in (routeByRole). */
  portal: string;
  city?: string;
  phone?: string;
}

export const DEMO_ACCOUNTS: readonly DemoAccount[] = [
  {
    key: "admin",
    role: "ADMIN",
    label: "Admin",
    name: "Anjali Rao",
    email: "admin@unitedangelreach.org",
    password: "Admin@123",
    description: "Full administration console — settings, people, programmes and reports.",
    portal: "/admin",
    city: "Bengaluru",
    phone: "+91 98860 10001",
  },
  {
    key: "donor",
    role: "DONOR",
    label: "Donor",
    name: "Rahul Sharma",
    email: "donor@demo.org",
    password: "Donor@123",
    description: "Donation history, 80G receipts and monthly sponsorships.",
    portal: "/donor",
    city: "Bengaluru",
    phone: "+91 98860 10002",
  },
  {
    key: "volunteer",
    role: "VOLUNTEER",
    label: "Volunteer",
    name: "Priya Nair",
    email: "volunteer@demo.org",
    password: "Volun@123",
    description: "Approved volunteer — tasks, distribution drives and kit scanning.",
    portal: "/volunteer",
    city: "Bengaluru",
    phone: "+91 98860 10003",
  },
  {
    key: "applicant",
    role: "VOLUNTEER",
    label: "Applicant",
    name: "Arjun Kumar",
    email: "applicant@demo.org",
    password: "Temp@12345",
    description: "Volunteer whose application is still pending approval.",
    portal: "/volunteer",
    city: "Mysuru",
    phone: "+91 98860 10004",
  },
  {
    key: "beneficiary",
    role: "BENEFICIARY",
    label: "Beneficiary",
    name: "Lakshmi Devi",
    email: "beneficiary@demo.org",
    password: "Benef@123",
    description: "Beneficiary hub — requests, distributions and monthly sponsors.",
    portal: "/beneficiary",
    city: "Bengaluru",
    phone: "+91 98860 10005",
  },
  {
    key: "hospital",
    role: "HOSPITAL",
    label: "Hospital",
    name: "Angel Multispeciality Hospital",
    email: "hospital@demo.org",
    password: "Hospital@123",
    description: "Hospital owner portal — organisation profile, staff and referrals.",
    portal: "/hospital",
    city: "Bengaluru",
  },
  {
    key: "meera",
    role: "DOCTOR",
    label: "Doctor",
    name: "Dr. Meera Iyer",
    email: "dr.meera@demo.org",
    password: "Doctor@123",
    description: "Verified doctor portal — consultations, appointments and lab orders.",
    portal: "/doctor",
    city: "Bengaluru",
  },
  {
    key: "nurse",
    role: "NURSE",
    label: "Nurse",
    name: "Nurse Priya",
    email: "nurse@demo.org",
    password: "Nurse@123",
    description: "Verified nurse portal — patient care and clinic tasks.",
    portal: "/doctor",
    city: "Bengaluru",
  },
  {
    key: "pharmacist",
    role: "PHARMACIST",
    label: "Pharmacist",
    name: "Pharmacist Suresh",
    email: "pharmacist@demo.org",
    password: "Pharm@123",
    description: "Dispensary portal — prescriptions and medicine stock.",
    portal: "/doctor",
    city: "Bengaluru",
  },
  {
    key: "labtech",
    role: "LAB_TECH",
    label: "Lab Tech",
    name: "Lab Tech Kavya",
    email: "labtech@demo.org",
    password: "Lab@123",
    description: "Diagnostics portal — sample collection and lab reports.",
    portal: "/doctor",
    city: "Bengaluru",
  },
];
