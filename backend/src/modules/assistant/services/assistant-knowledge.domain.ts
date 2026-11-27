/**
 * United Angel Reach — AI Agent Knowledge Base (RAG corpus).
 * Each entry is a retrievable chunk. The chat API scores entries by
 * keyword relevance and injects the top matches into the LLM system prompt.
 * All helplines are official Government of India / Karnataka numbers.
 */

export interface KnowledgeEntry {
  id: string;
  title: string;
  keywords: string[];
  content: string;
}

export const HELPLINES = {
  emergency: "112",
  ambulance: "108",
  cyberFraud: "1930",
  womenEmergency: "1091",
  womenSupport: "181",
  childline: "1098",
  drugDeaddiction: "14446",
  teleManas: "14416",
  drugTrafficking: "1933",
  animalWelfare: "1962",
} as const;

export const KNOWLEDGE: KnowledgeEntry[] = [
  {
    id: "trust",
    title: "About United Angel Reach",
    keywords: [
      "about", "trust", "united angel reach", "uar", "who are you", "mission",
      "vision", "bengaluru", "bangalore", "karnataka", "india", "ngo", "charity",
    ],
    content: `United Angel Reach (UAR) is a charitable trust headquartered in Bengaluru, Karnataka, with one dream: to serve the whole of India as we grow. We run nine flagship programmes: Anti-Drug Awareness, Cyber Crime Safety, Women Safety, Child Safety (POCSO), Adopt-a-Medicine (monthly tablets for the poor), Animal Welfare & Adoption, Ration Kits, Sanitary Pad distribution, and the AI Green Corridor ambulance system. Our office: Bengaluru, Karnataka. Every rupee is receipted (80G eligible) and every drive is logged publicly on our Impact page. Trust seeded values: Service, Dignity, Transparency, Technology-for-good.`,
  },
  {
    id: "anti-drug",
    title: "Anti-Drug Campaign — awareness, help & recovery",
    keywords: [
      "drug", "drugs", "addiction", "addicted", "nasha", "alcohol", "substance",
      "weed", "ganja", "mdma", "cocaine", "heroine", "heroin", "smack", "opium",
      "rehab", "de-addiction", "recovery", "ndps", "overdose", "14545", "14446",
      "1933", "manas", "nasha mukt bharat", "peer pressure", "vaping", "gateway",
    ],
    content: `ANTI-DRUG CAMPAIGN (Sankalp Against Substance). India has ~16 crore alcohol users and addiction is rising among teens. We run school/college modules, workplace sessions and community drives across Bengaluru.

SIGNS A LOVED ONE MAY BE USING: sudden secrecy, falling grades/attendance, red eyes, new "friend groups", missing money, mood swings, paraphernalia (foil, burnt spoons, small pouches).

WHAT TO DO — our 5-step guidance:
1. STAY CALM, DON'T CONFRONT ANGRILY — addiction is a medical condition (chronic relapsing brain disorder), not a moral failure.
2. TALK IN PRIVATE with empathy; use "I" statements ("I am worried about you"), never shame.
3. CALL HELP LINES: National De-addiction Helpline 14446 (24x7, free, all languages); Tele-MANAS 14416 for mental-health-linked use; NIMHANS Bengaluru Centre for Addiction Medicine offers expert OPD care.
4. SEE A DOCTOR for medically supervised detox — sudden withdrawal from alcohol/benzos can be dangerous.
5. REPORT TRAFFICKING (not users!) to NCB MANAS 1933. Police book SUPPLIERS under the NDPS Act 1985; a person who voluntarily seeks treatment is protected (Section 64A NDPS gives immunity for voluntary treatment).

LAW EVERYONE SHOULD KNOW: NDPS Act 1985 — possession of small quantities for personal use → Section 27 (up to 1 year + fine); commercial quantity → 10–20 years. Immunity Sec 64A: addicts charged for small quantity who VOLUNTEER for treatment get immunity from prosecution. Nasha Mukt Bharat Abhiyaan (NMBA) is the national movement — our trust is a grassroots partner.

OUR SUPPORT: free awareness workshops, family counselling camps, rehab referrals, relapse-prevention groups. Ask me for the nearest step, and please call 14446 — it is free, anonymous and 24x7.`,
  },
  {
    id: "cyber-crime",
    title: "Cyber Crime Campaign — report fraud fast (golden hour)",
    keywords: [
      "cyber", "cyber crime", "fraud", "scam", "otp", "upi", "phishing", "hacked",
      "hacking", "blackmail", "sextortion", "online", "1930", "cybercrime.gov.in",
      "chakshu", "sim swap", "digital arrest", "loan app", "fake call", "vishing",
      "smishing", "money stolen", "bank fraud", "kyc", "lottery", "job scam",
      "telegram task", "investment scam",
    ],
    content: `CYBER SAFETY CAMPAIGN (CyberSuraksha). India lost thousands of crores to cyber fraud last year; Bengaluru alone reports ~1,000+ cases daily. The FIRST 60 MINUTES decide whether money is recovered — this is the "golden hour".

IF MONEY WAS STOLEN — ACT IN THIS ORDER:
1. CALL 1930 IMMEDIATELY (National Cyber Crime Helpline, 24x7) — it freezes the money trail across banks.
2. FILE AT cybercrime.gov.in within 24 hours (anonymous complaints allowed for women/children).
3. INFORM YOUR BANK'S fraud desk and freeze cards/UPI.
4. PRESERVE EVIDENCE: screenshots, transaction IDs, phone numbers, chat links, SMS — do NOT delete chats.
5. REPORT FAKE CALLS/NUMBERS at Chakshu portal (sancharsaathi.gov.in) and spam to 1909.

TOP SCAMS TO RECOGNISE:
• DIGITAL ARREST — "CBI/ customs officer on video call says you are arrested, stay on camera, pay to clear your name". NO GOVERNMENT AGENCY EVER ARRESTS BY VIDEO. Hang up.
• UPI "REQUEST" fraud — you only need a PIN TO PAY, never to receive. Never enter PIN for receiving money.
• KYC expiry calls — banks never ask OTP on calls.
• SEXTORTION — don't pay, don't panic; file at cybercrime.gov.in (women can complain anonymously), preserve chats.
• TASK/INVESTMENT SCAMS — Telegram "prepaid tasks", 200% returns, fake trading apps = guaranteed loss.
• LOAN APPS — instant apps asking contacts access then blackmailing; report to 1930.

PREVENTION RULES WE TEACH: never share OTP/CVV; verify before you click (no UPI PIN to receive); strong unique passwords + app lock; enable SIM lock; check URLs (rbi.org.in vs rbi-oct.com); parents — enable Google Family Link; elders — weekly 10-minute "scam of the week" chat with family.

OUR SUPPORT: free cyber-hygiene workshops for RWAs, schools and senior citizens across Bengaluru + handholding to file complaints. Ask me how to report any specific scam and I will walk you through it step by step.`,
  },
  {
    id: "women-safety",
    title: "Women Safety Campaign — helplines, self-help & law",
    keywords: [
      "women", "woman", "girl", "safety", "harassment", "eve teasing", "stalking",
      "domestic violence", "dv", "dowry", "181", "1091", "112", "abhayam",
      "one stop centre", "acid attack", "trafficking", "workplace harassment",
      "posh", "safety tips", "cab safety", "night travel", "molestation",
    ],
    content: `WOMEN SAFETY CAMPAIGN (Suraksha). We run self-defence camps, safe-city awareness drives, workplace POSH workshops and survivor support in Bengaluru.

EMERGENCY NUMBERS: 112 (national emergency, police+fire+medical), 1091 (women in distress, police), 181 (Abhayam/Sakhi Women Helpline — counselling, legal aid, shelter, One Stop Centres), Cyber complaints involving women → cybercrime.gov.in (anonymous allowed).

SAFETY PLAYBOOK WE TEACH:
• TRUST THE UNEASY FEELING — it is data. Move toward light and people, make a phone call aloud ("I'm at the gate, come out").
• CAB SAFETY: share trip live, match number plate, sit behind driver, keep pepper spray/legal keys handy.
• NIGHT TRAVEL: prefer well-lit arterial roads, keep location on with 2 trusted contacts.
• DOMESTIC VIOLENCE: you are protected by the Protection of Women from Domestic Violence Act 2005 — you can get Protection Order, residence rights, maintenance. Call 181 (they arrange shelter + police help), file DIR through a Protection Officer at any One Stop Centre.
• STALKING/EVE-TEASING: Section 354D IPC (stalking) and 509 (insulting modesty) are punishable — note time/place/vehicle number, call 112.
• DOWRY: Dowry Prohibition Act 1961 + Sec 498A. Never pay; document; call 181/112.
• WORKPLACE: POSH Act 2013 — every company with 10+ staff MUST have an Internal Committee; complaint must be heard within 90 days.
• ACID ATTACK survivors: free treatment under Health Ministry order + ₹3L state compensation in Karnataka; call 112/181.
• TRAFFICKING: Ujjawala scheme rescues & rehabilitates; call 1098 (if minor) or 112.

OUR SUPPORT: 15-day free self-defence batches (college girls & working women), legal-aid tie-ups, survivor counselling, employment bridge for survivors. Ask me anything — if you are in danger right now, please call 112 first, then come back to me.`,
  },
  {
    id: "child-safety",
    title: "Child Safety Campaign — POCSO, CHILDLINE 1098 & school toolkit",
    keywords: [
      "child", "children", "kid", "school", "tuition", "abuse", "csa", "pocso",
      "1098", "childline", "bad touch", "good touch", "bullying", "cyberbullying",
      "child labour", "trafficking child", "counsellor", "parent", "safe adult",
      "complaint e-box", "jj act", "childline india",
    ],
    content: `CHILD SAFETY CAMPAIGN (Little Angels Shield). We deliver age-appropriate safety education in schools, tuitions, orphanages and apartments across Bengaluru, plus teacher/parent workshops.

ONE NUMBER TO REMEMBER: 1098 — CHILDLINE (24x7, free, for any child in distress). POCSO e-Box: online anonymous complaint (pocso ebox on NCPCR site). Police: 112.

TEACHING KIDS — OUR 3 RULES:
1. "UNDERWEAR RULE" — body parts covered by underwear are private; nobody may see/touch/photograph them, and no adult should ASK a child to keep a secret from parents.
2. SAFE vs UNSAFE TOUCH — "good touch/bad touch" drills with 5 trusted adults list (5 finger rule: hand each finger = one safe adult with name+number).
3. "NO-GO-TELL" — it is OK to say NO to any adult, GO away, TELL a safe adult immediately. Secrets that feel heavy must always be told.

WARNING SIGNS FOR PARENTS/TEACHERS: sudden withdrawal, fear of a specific person/place, regression (bedwetting), sexual knowledge beyond age, self-harm, gifts from an adult, dropping marks, "accidents" being hidden. BELIEVE THE CHILD THE FIRST TIME — 90%+ abuse is by known/trusted persons, not strangers.

LAW: POCSO Act 2012 — any sexual offence against a minor (<18); mandatory reporting for everyone (Sec 21); child-friendly courts; identity protected; offender cannot approach the child. Juvenile Justice Act covers neglect/exploitation; RTE covers corporal punishment (banned).

FOR SCHOOLS & TUITION CENTRES (our free toolkit): verified-staff policy (police verification), CCTV + two-adult rule, transparent classrooms, complaint drop-box monitored by external counsellor, annual POCSO orientation, safe pickup protocols.

CYBER-SAFETY FOR CHILDREN: no personal photos to strangers, gaming-chat dangers, report cyberbullying at cybercrime.gov.in (anonymous for children), parental controls + open-device-in-common-area rule.

OUR SUPPORT: free school workshops (Kannada/English), parent seminars, counsellor network, survivor rehabilitation support. If a child is in danger right now — call 1098 or 112 FIRST.`,
  },
  {
    id: "medicine-adoption",
    title: "Adopt-a-Medicine — monthly tablets for those who can't afford",
    keywords: [
      "medicine", "medicines", "tablet", "tablets", "bp", "sugar", "diabetes",
      "adopt", "adoption", "monthly", "chronic", "patient", "cause", "sponsor",
      "health", "afford", "poor", "dialysis", "thyroid", "cardiac", "medicine adoption",
    ],
    content: `ADOPT-A-MEDICINE. Lakhs of Indians skip BP, diabetes, thyroid and cardiac tablets because ₹800–2,500/month is impossible for a daily-wage family — skipped doses cause strokes, kidney failure and blindness. Our registry lists verified patients (doctor prescription + Aadhaar + income check) who need monthly medicine support.

HOW IT WORKS (simple, scalable model):
1. BROWSE real patients on the Adopt-a-Medicine page — each cause shows condition, city, monthly cost and duration.
2. ADOPT — pledge as little as ₹150/month (full adopt: the whole monthly cost). You can adopt fully, partially (co-fund with others) or gift one-time.
3. TRACK — every pledge shows on your Donor dashboard; patients receive medicines via partner clinics + Jan Aushadhi generic stores (same molecule, 50–90% cheaper).
4. PROOF — refill logs and pharmacy bills update the cause page; you get quarterly impact reports + 80G receipt.

SMART FEATURES: auto-matching (we suggest causes about to lapse), group adoption (families/offices co-adopt), anniversary reminders, pause anytime.

IMPACT SNAPSHOT: a BP+diabetes patient stabilised for a year costs ~₹12,000 total — less than one emergency hospitalisation.

Donate at the Donate page or adopt from any cause card. Ask me "which conditions need most help" and I'll show live numbers.`,
  },
  {
    id: "animal-welfare",
    title: "Animal Welfare — adoption, food pledges & rescue",
    keywords: [
      "animal", "animals", "dog", "dogs", "puppy", "cat", "cow", "bird", "adopt",
      "adoption", "pet", "stray", "street dog", "feed", "feeding", "rescue",
      "injured", "vaccination", "sterilization", "sterilisation", "abc", "1962",
      "cupa", "shelter", "cruelty", "animal food", "sponsor",
    ],
    content: `ANIMAL WELFARE PROGRAMME (Angel Paws). We run street-animal feeding zones, rescue coordination, vaccination/sterilisation (ABC) drives and an adoption platform across Bengaluru.

ADOPT, DON'T SHOP: browse adoptable Indie dogs, cats and rescued animals on the Animal Welfare page — each profile has story, health status, vaccination and sterilisation status. Adoption process: 1) express interest on the profile, 2) quick home-visit + guidance call, 3) free adoption with vaccination card & sterilisation agreement, 4) lifetime support from our vet partners.

SPONSOR A MOUTH (food pledges): feed one street dog full meals for a month = ~₹900; a cow = ~₹2,500; a cat = ~₹700. Set a monthly pledge to a specific animal or the community food fund; we buy in bulk and distribute via trained feeders. One-time sacks of food are also welcome.

RESCUE & EMERGENCY: injured animal? Call our helpline desk or AWBI 1962; for wildlife call the Karnataka Forest Department. Note location pin + describe injuries; do NOT move a spine-injured animal. We coordinate with CUPA Bengaluru, BAWA and government veterinary hospitals.

KNOW THE LAW: Prevention of Cruelty to Animals Act 1960 — beating/kicking/poisoning animals is punishable; ABC Rules 2023 protect sterilised street dogs — they cannot be relocated; feeding dogs is legally protected (AWBI guidelines) when done hygienically. Report cruelty with photo/video to 1962 or our team.

OUR SUPPORT: volunteer feeder routes every weekend, bulk-food logistics, vet tie-ups, adoption follow-ups. Ask me "how do I start feeding in my area" and I'll give the exact starter kit.`,
  },
  {
    id: "green-corridor",
    title: "AI Green Corridor — ambulances that clear their own path",
    keywords: [
      "ambulance", "green corridor", "corridor", "108", "traffic", "emergency",
      "golden hour", "v2x", "bluetooth", "mesh", "alert", "give way", "siren",
      "ambulance stuck", "tech", "how does", "ble", "5g", "bengaluru traffic",
    ],
    content: `AI GREEN CORRIDOR (AR-Corridor). Bengaluru is India's most congested city — an ambulance averages 11 km/h and cardiac survival drops 10–15% for every minute lost. We built a smart corridor system so traffic AHEAD of the ambulance knows it is coming and clears a lane BEFORE the siren arrives.

HOW THE ALERT MESH WORKS (4 layers, automatic fallback):
1. 5G/4G V2X + CELL BROADCAST (needs internet): the ambulance's unit streams its GPS route to connected vehicles, smart signage and navigation apps within 2 km ahead. Drivers see "AMBULANCE APPROACHING — 90 seconds — please shift left" with a gentle audio nudge.
2. ROADSIDE UNITS + BLE MESH (no internet needed): low-power Bluetooth beacons on signals, buses and our volunteer bikes relay the alert hop-by-hop — works in network dead zones, tunnels and during disasters when towers fail.
3. FM-RDS BREAK-IN: traffic radio interrupts with the ambulance's location corridor for older cars.
4. SMART SIREN (always last): adaptive siren that only fires near vehicles the mesh couldn't reach.

IMPACT ENGINE: each mission logs congestion per segment, vehicles alerted, method used and seconds saved. In our Bengaluru pilots, corridor activation cuts travel time by 40–60% (e.g. a 27-min gridlocked run → 12–16 min) — that is the golden hour saved.

TRY IT: the public Green Corridor page has a live demo you can run; the admin Ops Console simulates real missions across Bengaluru corridors (ORR, Silk Board, Hebbal, KR Puram…).

REAL AMBULANCE: Government 108 (Arogya Kavacha, Karnataka) and 112. Our trust supports 108 with corridor awareness + first-responder volunteering. Ask me "how does the bluetooth mesh work" or "simulate a mission" and I'll explain.`,
  },
  {
    id: "ration-kits",
    title: "Ration Kit System — QR-coded kits, end to end",
    keywords: [
      "ration", "kit", "kits", "food", "grocery", "qr", "scan", "code", "label",
      "distribution", "inventory", "volunteer kit", "how kits work", "kit scan",
    ],
    content: `RATION KIT SYSTEM. Every kit we pack gets a unique QR label (e.g. UAR-RK-2026-000001) so nothing is lost, faked or double-counted.

FLOW: Admin creates a Kit Template (rice 5kg, atta 2kg, dal 1kg, oil 1L, sugar 1kg, salt, tea…) → generates a Batch (e.g. 100 units = 100 unique labels printed) → volunteers scan a kit's QR/enter its code at handover → stock auto-decrements, the unit is marked DISTRIBUTED, and the beneficiary gets it logged with time+location+volunteer.

TRACKING: Admin dashboard shows batch progress (packed/scanned/remaining), live inventory levels and low-stock alerts. Volunteers see packing instructions per template on their portal.

WHY CODES: zero paperwork, instant audit, donors can trace "their" kits in reports, and expired/leaked units are flagged automatically.`,
  },
  {
    id: "sanitary-pads",
    title: "Sanitary Pad Programme — dignity & menstrual health",
    keywords: [
      "pad", "pads", "sanitary", "menstrual", "period", "hygiene", "girl",
      "napkin", "dignity", "menopause", "pms", "pad distribution",
    ],
    content: `SANITARY PAD PROGRAMME (Project Dignity). Period poverty keeps girls out of school 3–5 days a month. We distribute subsidised pads via pad-bank vending in government schools, slum communities and factory clusters, plus menstruation-health sessions for boys AND girls to kill stigma.

WHAT WE PROVIDE: free/subsidised pad packs, incinerators to schools, biodegradable-pad awareness, anemia screening camps, and a school pad-bank monitored by female staff.

FOUND UNDER: Admin → Operations → Distributions → Sanitary Pads (all pad drives, stock and beneficiary counts live there). Support a school's pad-bank for a year ≈ ₹18,000.`,
  },
  {
    id: "donate",
    title: "Donations, 80G receipts & transparency",
    keywords: [
      "donate", "donation", "80g", "receipt", "tax", "upi", "payment", "monthly",
      "giving", "sponsor", "donor portal", "refund",
    ],
    content: `DONATING TO UNITED ANGEL REACH: choose a campaign on the Donate page (or adopt a medicine / sponsor animal food directly). We accept UPI, cards, bank transfer. Every completed donation gets a receipt number; registered donors can download 80G tax receipts from the Donor Portal → Receipts (80G exemption for Indian taxpayers under Sec 80G, Income Tax Act). Monthly donors can pause/cancel anytime from the portal. Transparency: donation totals roll up live on campaign pages and the Impact dashboard; administrative cost target <8%. Corporate CSR partnerships welcome.`,
  },
  {
    id: "volunteer",
    title: "Volunteering — apply, approval flow & what you can do",
    keywords: [
      "volunteer", "join", "help out", "apply", "approval", "application",
      "temp creds", "temporary password", "task", "field", "internship", "csr",
    ],
    content: `VOLUNTEERING WITH UAR: apply on the Volunteer page (name, city, skills, availability, motivation). You receive TEMPORARY credentials immediately — log in with them to see your application status live. An admin reviews every application; once APPROVED your volunteer portal unlocks: task board, distribution drives, ration-kit QR scanning, inventory stocking, ambulance first-responder sign-ups and animal welfare shifts. Rejected? You'll see the reason and can reapply. Time options: weekends, evenings, full-time, flexible. Volunteers get e-certificates (great for college credit/CSR hours). Ask me what roles are open this month.`,
  },
  {
    id: "assistant-capabilities",
    title: "What can this AI agent do?",
    keywords: [
      "what can you do", "help", "agent", "ai", "who are you", "assistant",
      "how do i", "can you", "guide",
    ],
    content: `I'm Angel, the United Angel Reach AI assistant. I can guide you through: DRUG DE-ADDICITION steps & helplines (14446), CYBER FRAUD first-hour rescue (1930), WOMEN SAFETY playbook (112/181/1091), CHILD SAFETY & POCSO reporting (1098), ADOPT-A-MEDICINE monthly tablet sponsorships, ANIMAL ADOPTION & food pledges, RATION KIT tracking, SANITARY PAD programme, GREEN CORRIDOR ambulance technology, donations & 80G receipts, and volunteering. I can also explain any campaign page's charts, tell you who to call for a specific emergency, and walk you step-by-step through filing a cyber complaint or adopting a patient. What do you need help with today?`,
  },
  {
    id: "impact-stats",
    title: "Our impact in numbers",
    keywords: [
      "impact", "stats", "numbers", "beneficiaries", "how many", "lives",
      "results", "progress", "report",
    ],
    content: `IMPACT SNAPSHOT (see the live Impact page for current numbers): 9 flagship programmes running in Bengaluru and expanding city-by-city across India. The dashboard tracks beneficiaries served, kits distributed, patients whose medicines are adopted, animals vaccinated/adopted, women & children trained in safety, students reached by anti-drug modules, corridor seconds saved for ambulances, and total funds raised with allocation per programme. Everything we log is auditable — kits carry QR codes, distributions carry volunteer + GPS + time stamps.`,
  },
  {
    id: "contact",
    title: "Contact, office & escalation",
    keywords: [
      "contact", "email", "phone", "office", "address", "reach", "call",
      "complaint", "escalate", "grievance", "hours",
    ],
    content: `REACHING UNITED ANGEL REACH: office in Bengaluru, Karnataka (open Mon–Sat, 9:30am–6:30pm). Use the Contact page form for anything — grievances get a 48-hour response. Emergencies NEVER wait for us: police 112, ambulance 108, cyber fraud 1930, women 181/1091, child 1098, de-addiction 14446, animal rescue 1962. For campaign collaborations, CSR partnerships, school/workshop bookings — mention "partnership" in the subject and our team prioritises it.`,
  },
  {
    id: "80g-tax-receipts",
    title: "80G tax benefits & how receipts work",
    keywords: [
      "80g", "tax", "taxes", "taxation", "deduction", "exemption", "income tax",
      "itr", "pan", "receipt number", "amount in words", "proof", "section 80g",
      "claim", "rebate", "tax benefit", "12a", "assessment",
    ],
    content: `80G TAX BENEFITS — how your giving saves tax. United Angel Reach is a registered charitable trust; donations are eligible for deduction under Section 80G of the Income-tax Act, 1961. Individual donors can claim a 50% deduction of the donated amount (subject to the qualifying-limit rules that apply to your income slab) when filing your ITR — corporate donors claim it as a business-charity expenditure under CSR rules.

WHAT YOUR RECEIPT CONTAINS (every field auditors and the IT department look for):
• Receipt number (format UAR-RCPT-YYYY-NNNNN) and issue date
• Financial year (April–March) the donation falls in
• Your name, email, phone and PAN — the PAN is what makes the deduction claimable
• Donation amount in figures AND in words (e.g. "Rupees Twenty Five Thousand Only")
• The trust's 80G registration number, 12A registration and trust PAN
• Payment mode (UPI / card / bank transfer) and transaction reference
• Authorised signatory block (Managing Trustee) and the trust footer declaration

HOW TO GET YOURS: guest donors receive the receipt number on screen right after paying; registered donors can open or print any receipt from the Donor Portal → Receipts — every entry has a print-ready 80G receipt. Lost the number? Ask me with your email and amount, or email care@unitedangelreach.org and we re-issue. No goods or services are provided in return for donations, so the full donated amount qualifies. Note: in-kind donations (clothes, food sacks) are not eligible for 80G — only monetary gifts.`,
  },
  {
    id: "certificates",
    title: "Certificates — donor appreciation, volunteer service, animal adoption & more",
    keywords: [
      "certificate", "certificates", "appreciation", "recognition", "award",
      "volunteer certificate", "adoption certificate", "csr hours", "college credit",
      "pad drive champion", "medicine sponsor", "honour", "honor",
    ],
    content: `CERTIFICATES FROM UNITED ANGEL REACH. We issue five kinds of signed, printable certificates — each carries a unique verification code (UAR-CERT-YYYY-NNNNN), the issue date, the trust seal and the Managing Trustee's signature block:

• CERTIFICATE OF APPRECIATION (DONOR_APPRECIATION) — for generous donors, individuals or corporates, recognising cumulative giving to our programmes.
• CERTIFICATE OF VOLUNTEER SERVICE (VOLUNTEER_SERVICE) — for volunteers completing service hours in drives, workshops, rescues or corridor operations; accepted by colleges for credit and by companies for CSR hour reporting.
• ANIMAL ADOPTION CERTIFICATE (ANIMAL_ADOPTION) — a keepsake for adopting a rescued animal, naming the animal and species.
• MEDICINE SPONSORSHIP CERTIFICATE (MEDICINE_SPONSOR) — for sponsors keeping patients on monthly BP/diabetes/cardiac medicine.
• MENSTRUAL HEALTH CHAMPION (PAD_DRIVE_CHAMPION) — for leaders of pad-bank drives and awareness sessions.

HOW THEY WORK: admins issue certificates from the admin console (they can link them to your donor or volunteer account). You'll find yours in the Donor/Volunteer Portal — open it and hit print: it renders as an elegant A4 award layout with a gold-and-emerald seal, ready for framing. Codes are unique, so anyone can verify the certificate by its number. Want one for your giving or volunteering? Ask me and I'll point you to the right request.`,
  },
  {
    id: "payment-options",
    title: "Donation & payment options — UPI, gateway, monthly giving",
    keywords: [
      "payment", "payments", "pay", "upi", "gpay", "phonepe", "paytm", "razorpay",
      "card", "debit", "credit", "net banking", "bank transfer", "neft", "imps",
      "recurring", "monthly giving", "auto debit", "emi", "cancel donation", "refund",
    ],
    content: `WAYS TO GIVE TO UNITED ANGEL REACH — every payment path is receipted and 80G-eligible:

1. UPI (fastest, zero fees): pay to the trust's UPI ID from the Donate page — the current VPA is shown live from our settings (unitedangelreach@upi). Works with GPay, PhonePe, Paytm, BHIM and every bank app. Your receipt number appears instantly.
2. PAYMENT GATEWAY (cards / net-banking / wallets): when the gateway is enabled, the Donate page opens a secure checkout supporting debit/credit cards, net-banking and wallets — PCI-DSS compliant, we never see or store your card details.
3. BANK TRANSFER (NEFT/IMPS): best for larger and CSR gifts — get our account details from care@unitedangelreach.org and share the UTR number so we can match and receipt it.
4. MONTHLY GIVING (RECURRING): set up a monthly donation of any amount — it fuels steady programmes like ₹150/month medicines or ₹900/month street-dog food. Pause, change or cancel anytime from the Donor Portal, no questions asked.

AFTER PAYING: every completed donation gets a UAR receipt number, shows on your dashboard (if signed in) and rolls into the live campaign totals on the Impact page. Refunds: for accidental double-charges contact us within 7 days — we return the amount to the source account. Anonymous giving is supported — tick 'Give anonymously' and your name never appears on public walls, only in the trust's books.`,
  },
  {
    id: "integrations",
    title: "Integrations — email, SMS & WhatsApp notifications (admin-configured)",
    keywords: [
      "integration", "integrations", "email", "smtp", "sms", "whatsapp",
      "notification", "notifications", "settings", "webhook", "gateway test",
      "connectivity", "msg91", "sender id", "configure", "admin settings",
    ],
    content: `INTEGRATIONS — how United Angel Reach stays in touch. The trust's notification stack is configured by admins in Settings → Integrations, and every channel can be health-checked with one click (Settings shows a live latency and handshake message for each test):

• EMAIL (SMTP): donor receipts, monthly impact digests and volunteer rosters are sent from care@unitedangelreach.org via the configured SMTP host/port (STARTTLS secure). Admins set the host, port, from-name and secure flag in Settings.
• SMS (DLT-compliant): mission-critical pings — low-stock alerts, volunteer approval status, ambulance corridor summaries — go through an Indian DLT provider (e.g. MSG91) with the registered sender ID (UARNGO). Admins configure provider, sender ID and API endpoint.
• WHATSAPP (Business API): richer updates for donors and beneficiaries — kit-delivery photos, adoption follow-ups, campaign launches — from the trust's WhatsApp Business number.
• PAYMENT GATEWAY: payment key management lives in the same Settings screen; enabling it turns on card/net-banking checkout on the Donate page.

PRIVACY: notification preferences are per-user; beneficiary identities are never exposed in messages. All keys and sender IDs are stored server-side only. Everything you see on the Settings page is simulated in this demo environment — no real blasts are sent.`,
  },
  {
    id: "kit-journey",
    title: "Ration kit end-to-end — template → batch → QR label → volunteer scan",
    keywords: [
      "kit template", "kit batch", "qr label", "kit label", "print labels",
      "pack kit", "kit workflow", "scan at handover", "batch progress",
      "how kits are made", "kit lifecycle", "depleted", "expired unit",
    ],
    content: `RATION KIT JOURNEY — from packing table to a family's kitchen, fully tracked:

1. TEMPLATE: an admin defines what goes inside — e.g. Family Ration Kit: rice 10kg, atta 5kg, toor dal 2kg, oil 2L, sugar 1kg, salt, tea — with a cost per unit (₹950 for the standard kit).
2. BATCH: admin generates a batch (say 100 units). The system instantly reserves 100 unique codes: UAR-RK-2026-000001 … 000100 and decrements raw inventory (rice sacks, dal, oil) automatically.
3. QR LABELS: print A4 label sheets from the batch page — each label shows the QR code of the unit code plus the trust name. Volunteers stick one on every packed kit.
4. SCAN AT HANDOVER: when a kit physically reaches a family, the volunteer scans the QR (or types the code) at the handover screen — the unit flips READY → SCANNED with time, GPS location and volunteer name recorded, the beneficiary gets logged, and batch progress ticks up (packed/scanned/remaining).
5. AUDIT: admin dashboards show batch progress, low-stock alerts, and any EXPIRED units (damaged/leaked kits) — donors can trace exactly how many kits "their" rupees packed.

Nothing is handwritten, nothing is double-counted: one kit = one code = one scanned handover with a full audit trail.`,
  },
  {
    id: "corridor-fallbacks",
    title: "Green corridor alert chain — V2X/5G → cell broadcast → BLE mesh → FM-RDS → siren",
    keywords: [
      "v2x", "5g", "cell broadcast", "cellbroadcast", "ble mesh", "bluetooth mesh",
      "fm rds", "rds", "fallback", "siren", "alert chain", "how the corridor works",
      "dead zone", "no internet", "offline", "rsu", "roadside unit",
    ],
    content: `GREEN CORRIDOR ALERT CHAIN — four layers that never all fail at once. When a mission starts, the ambulance's onboard unit plans the route and then alerts traffic AHEAD through a strict priority chain with automatic fallbacks:

1. V2X + 5G/4G (needs network): the vehicle streams its live GPS corridor over 5G to connected cars, smart traffic signals and navigation apps up to 2 km ahead — drivers get "AMBULANCE APPROACHING — 90 seconds — shift left" with a soft audio nudge.
2. CELL BROADCAST (needs towers, no internet): if data drops, the same alert goes out as a cell broadcast to every phone in the corridor's cells — the tech used for disaster alerts, so it reaches basic handsets too.
3. BLE MESH (fully offline): roadside units on signals, buses and volunteer bikes relay the alert hop-by-hop over low-energy Bluetooth — this keeps working in tunnels, network dead zones, floods and tower outages.
4. FM-RDS BREAK-IN: traffic radio interrupts with the corridor location for older cars without data.
5. SMART SIREN (always last resort): an adaptive siren that only fires near vehicles the mesh couldn't reach — quieter, targeted, less noise pollution.

EVERY SEGMENT IS LOGGED: method used, congestion level (LOW → GRIDLOCK), vehicles alerted and seconds saved — that's what you see on the corridor events feed. In Bengaluru pilots the full chain cuts run times 40–60%. Remember: for a real medical emergency always call 108 or 112 first — the corridor system supports those ambulances.`,
  },
  {
    id: "beneficiary-onboarding",
    title: "Beneficiary onboarding — how a family enters our care",
    keywords: [
      "beneficiary", "onboarding", "onboard", "register family", "add beneficiary",
      "survey", "verification", "widow", "orphan", "daily wage", "urgency",
      "monthly need", "case worker", "home visit",
    ],
    content: `BENEFICIARY ONBOARDING — how a family enters United Angel Reach's care with dignity:

1. IDENTIFY: families come to us via volunteer field surveys, RWA/panchayat referrals, school teachers, hospital social workers or self-referral on the Contact page. No family is ever turned away for lacking paperwork.
2. REGISTER: a volunteer or admin adds them to the Beneficiary register — name, contact, city, household size, family category (widow, orphan, student, elderly, differently-abled, single mother, poor family, patient, daily-wage worker), monthly income vs monthly need, and specific needs (ration, medicines, pads, school fees).
3. URGENCY TRIAGE: each case gets an urgency level — LOW, MEDIUM, HIGH or CRITICAL — so kit batches, medicine sponsors and pad drives reach the most fragile households first. CRITICAL cases surface at the top of the admin console the same day.
4. VERIFY & ASSIGN: a case volunteer does a home visit (photo + location note), then the family is linked to the right programme — ration-kit batches, Adopt-a-Medicine causes, pad-bank schools, or animal-welfare households.
5. SERVE & TRACK: every distribution is logged against the beneficiary with kit code, time, location and volunteer — so duplicates are impossible and impact per family is fully auditable. A beneficiary can also get a portal login to see their own history.

Privacy: beneficiary records are visible only to signed-in staff and volunteers — never on public pages.`,
  },
  {
    id: "volunteer-journey",
    title: "Volunteer journey — apply → temp credentials → admin approval → portal",
    keywords: [
      "volunteer journey", "apply", "application", "temp creds", "temporary password",
      "pending approval", "approve volunteer", "rejected", "reapply", "onboard volunteer",
      "status check", "volunteer portal", "how to join",
    ],
    content: `THE VOLUNTEER JOURNEY — from application to first distribution in four steps:

1. APPLY: fill the volunteer form (name, phone, city, occupation, skills, availability, motivation). Submission is instant and free.
2. TEMPORARY CREDENTIALS: the moment you apply, the system issues you TEMPORARY login credentials (shown on the success screen and sent by email). Sign in right away — you land in a limited portal where you can watch your application status live and complete your profile while you wait.
3. ADMIN REVIEW: an admin checks your application (skills, city, availability — occasional quick reference checks for medical or driving roles). Outcomes: APPROVED → your full volunteer portal unlocks (task board, distribution drives, ration-kit QR scanning, inventory stocking, animal welfare shifts, ambulance responder sign-ups); REJECTED → you see the review note and can reapply anytime.
4. ACTIVE SERVICE: approved volunteers get assigned tasks with date, location and priority; attendance, hours and completed tasks accumulate automatically — and at milestones you earn your Certificate of Volunteer Service (great for college credit and CSR hours).

TIPS: put real skills (teaching, medical, driving, tech) — matching is skills-based; WEEKENDS and EVENINGS availability fills fastest in Bengaluru South & Whitefield. Pending for more than 5 days? Ask me to nudge the admin queue.`,
  },
  {
    id: "safety-emergency-index",
    title: "Emergency quick index (who to call, when)",
    keywords: [
      "emergency", "who to call", "helpline", "police", "fire", "accident",
      "suicide", "mental health", "panic", "help me", "dying", "urgent", "now",
    ],
    content: `EMERGENCY INDEX — save these: 112 POLICE/FIRE/MEDICAL (national). 108 free AMBULANCE (Karnataka Arogya Kavacha). 1930 CYBER FRAUD (within the golden hour!). cybercrime.gov.in online complaints. 181 WOMEN helpline (Sakhi/Abhayam) • 1091 women police emergency. 1098 CHILDLINE (any child in distress). 14446 drug de-addiction • 1933 report drug trafficking • Tele-MANAS 14416 for mental-health crises & suicidal thoughts (24x7, free). 1962 animal rescue. If someone is suicidal: stay with them, remove means, call 14416 now — recovery is possible and help is free. Ask me about any of these and I'll walk you through exactly what to say and do.`,
  },
];

/** Lightweight keyword-scored retrieval (RAG-lite). */
export function retrieve(query: string, topK = 5): KnowledgeEntry[] {
  const q = query.toLowerCase();
  const words = q.split(/[^a-z0-9]+/).filter((w) => w.length > 2);
  const scored = KNOWLEDGE.map((e) => {
    let score = 0;
    for (const kw of e.keywords) {
      if (q.includes(kw)) score += kw.includes(" ") ? 5 : 3;
    }
    for (const w of words) {
      if (e.keywords.some((kw) => kw.includes(w))) score += 1;
      if (e.title.toLowerCase().includes(w)) score += 1;
      if (e.content.toLowerCase().includes(w)) score += 0.5;
    }
    return { e, score };
  });
  return scored
    .sort((a, b) => b.score - a.score)
    .filter((s) => s.score > 0)
    .slice(0, topK)
    .map((s) => s.e);
}

export const SUGGESTED_QUESTIONS = [
  "A friend is addicted — how do I help him?",
  "Money stolen by UPI fraud, what do I do right now?",
  "I'm being stalked near my hostel, helpline?",
  "How do I teach my child the underwear rule?",
  "How can I adopt a BP/diabetes patient monthly?",
  "How do I adopt a street dog or pledge food?",
  "How does the green corridor ambulance tech work?",
  "How do I get an 80G donation receipt?",
];
