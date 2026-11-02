// United Angel Reach — public content core.
// All 9 programme pages draw their editorial content from here.

export interface CampaignChart {
  title: string;
  desc: string;
  type: "bar" | "pie" | "line" | "area";
  data: Record<string, unknown>[];
  xKey?: string;
  nameKey: string;
  valueKey: string;
  colors?: string[];
}

export interface CampaignContent {
  slug: string;
  title: string;
  short: string;
  accent: string;
  icon: string;
  helpline: { name: string; number: string };
  heroTag: string;
  overview: string[];
  keyFacts: { label: string; value: string; suffix?: string }[];
  charts: CampaignChart[];
  whyItMatters: string[];
  playbook: { title: string; desc: string }[];
  dosDonts: { dos: string[]; donts: string[] };
  mythsFacts: { myth: string; fact: string }[];
  toolkit: { title: string; items: string[] }[];
  faqs: { q: string; a: string }[];
  links: { label: string; href: string }[];
}

const ORANGE = ["#f97316", "#fb923c", "#fdba74", "#ffedd5"];
const CYAN = ["#06b6d4", "#22d3ee", "#67e8f9", "#cffafe"];
const FUCHSIA = ["#d946ef", "#e879f9", "#f0abfc", "#fae8ff"];
const AMBER = ["#f59e0b", "#fbbf24", "#fcd34d", "#fef3c7"];
const TEAL = ["#14b8a6", "#2dd4bf", "#5eead4", "#ccfbf1"];
const LIME = ["#84cc16", "#a3e635", "#bef264", "#ecfccb"];
const EMERALD = ["#10b981", "#34d399", "#6ee7b7", "#d1fae5"];
const RED = ["#ef4444", "#f87171", "#fca5a5", "#fee2e2"];
const PINK = ["#ec4899", "#f472b6", "#f9a8d4", "#fce7f3"];

export const CAMPAIGN_CONTENT: Record<string, CampaignContent> = {
  "anti-drug": {
    slug: "anti-drug",
    title: "Anti-Drug Awareness & Recovery",
    short:
      "Prevention in schools and colleges, and a judgement-free bridge from addiction to treatment.",
    accent: "orange",
    icon: "shield-alert",
    helpline: { name: "National De-addiction Helpline", number: "14446" },
    heroTag:
      "Addiction is a health condition, not a character flaw — one free call to 14446 starts recovery.",
    overview: [
      "India's first National Survey on the Extent of Substance Use (AIIMS × Ministry of Social Justice, 2019) counted about 16 crore alcohol users, 3.1 crore cannabis users and 2.26 crore opioid users between the ages of 10 and 75. Behind each number is a family quietly rearranging its savings, sleep and dignity. Yet fewer than 3% of people with dependence ever reach treatment — not because recovery is impossible, but because help is invisible, expensive in perception, and wrapped in shame.",
      "United Angel Reach runs prevention theatre and peer-mentor clubs in Bengaluru colleges, family counselling camps in wards and slums, and a volunteer aftercare network that walks a person from their first 14446 call to a government de-addiction OPD and then through 90 days of follow-up. Our volunteers are trained never to lecture — only to listen, inform and accompany.",
      "The law is on the side of healing. Section 64A of the NDPS Act grants immunity from prosecution to addicts who voluntarily seek treatment, and reporting trafficking is as easy as calling 1933 (NCB MANAS). Knowing this one paragraph of law has persuaded hundreds of families to stop hiding and start treating.",
    ],
    keyFacts: [
      { label: "Alcohol users in India (10–75 yrs)", value: "16", suffix: " crore" },
      { label: "Cannabis users in India", value: "3.1", suffix: " crore" },
      { label: "Opioid users in India", value: "2.26", suffix: " crore" },
      { label: "People with dependence who receive treatment", value: "<3", suffix: "%" },
      { label: "Recovery odds with structured aftercare", value: "2×", suffix: " better" },
    ],
    charts: [
      {
        title: "Users of major substances in India (millions)",
        desc: "National Survey 2019, ages 10–75 — AIIMS × Ministry of Social Justice.",
        type: "bar",
        data: [
          { name: "Alcohol", millions: 160 },
          { name: "Cannabis", millions: 31 },
          { name: "Opioids", millions: 22.6 },
          { name: "Sedatives", millions: 11.8 },
          { name: "Inhalants", millions: 4.6 },
        ],
        xKey: "name",
        nameKey: "name",
        valueKey: "millions",
        colors: ORANGE,
      },
      {
        title: "The help-seeking funnel (per 1,000 people with dependence)",
        desc: "Only ~26 in 1,000 ever reach treatment — and ~10 stay past 90 days. Aftercare is where UAR volunteers work.",
        type: "area",
        data: [
          { stage: "Use regularly", people: 1000 },
          { stage: "Recognise harm", people: 210 },
          { stage: "Seek any help", people: 55 },
          { stage: "Reach treatment", people: 26 },
          { stage: "Stay 90+ days", people: 10 },
        ],
        xKey: "stage",
        nameKey: "stage",
        valueKey: "people",
        colors: ORANGE,
      },
    ],
    whyItMatters: [
      "Every rupee spent on prevention saves roughly ₹7–10 in later health, policing and lost-income costs — but only if it reaches adolescents before first use.",
      "Opioid dependence is now the fastest-growing category among 18–25 year olds in Indian metros, driven by pharmaceutical opioids and synthetics.",
      "Families burn an average of ₹20,000–30,000 a year sustaining a member's dependence — money that treatment would turn into recovery.",
      "Stigma is the deadliest drug: it delays the first call by years. A confident, confidential helpline culture changes the math.",
      "Relapse is a treatment variable, not a moral verdict — programmes with 90-day aftercare roughly double durable recovery.",
    ],
    playbook: [
      {
        title: "Notice the signs, drop the shame",
        desc: "Bloodshot eyes, new secrecy, missing money, falling grades, new 2 a.m. friend circles. Talk privately, without blame — 'I've noticed X, I'm worried, how can I help?' works. Interrogation doesn't.",
      },
      {
        title: "Call 14446 — or Tele-MANAS 14416",
        desc: "Both are free, confidential and 24×7. 14446 routes you to the nearest government de-addiction centre; Tele-MANAS 14416 offers counselling in 20 languages. A UAR volunteer can sit with your family during the call.",
      },
      {
        title: "Visit a de-addiction OPD this week",
        desc: "NIMHANS Bengaluru and district-hospital OPDs assess, prescribe safe detox medicine and schedule counselling. Outpatient detox costs a fraction of private 'rehab' and follows NDDTC protocols.",
      },
      {
        title: "Know the law protects the healer",
        desc: "NDPS Act Sec 64A: an addict charged with use or small-quantity possession who volunteers for treatment gets immunity from prosecution. Trafficking tips go to 1933 / NCB MANAS — anonymous, and taken seriously.",
      },
      {
        title: "Plan 90 days of aftercare",
        desc: "Recovery breaks down without structure: family support groups, UAR volunteer check-ins twice a week, a written relapse-trigger plan, and one trusted 'first call' person for 2 a.m. crises.",
      },
    ],
    dosDonts: {
      dos: [
        "Listen first, advise later — motivation grows from being heard.",
        "Involve a doctor early; detox from alcohol can be medically dangerous.",
        "Keep household medicines locked and counted.",
        "Celebrate 1 week, 1 month, 90 days — recovery needs witnesses.",
      ],
      donts: [
        "Don't shame, threaten or hold a 'family trial' — it drives use underground.",
        "Don't flush pills and call it treatment; stopping needs a plan.",
        "Don't pay cash to unregistered 'rehab centres' — check the licence first.",
        "Don't hide the problem from the treating doctor; honesty changes prescriptions.",
      ],
    },
    mythsFacts: [
      {
        myth: "Addiction is a moral failure or weak willpower.",
        fact: "It is a chronic, treatable health condition. The WHO and India's own AIIMS survey classify dependence as a medical disorder with relapse rates similar to asthma or diabetes.",
      },
      {
        myth: "One try and you're addicted for life.",
        fact: "Dependence develops over repeated use, faster with opioids and synthetics. Early intervention — even one honest conversation — dramatically reduces risk.",
      },
      {
        myth: "If someone relapses, treatment has failed.",
        fact: "Relapse is a signal to adjust medication and counselling, not proof of failure. Cardiologists don't discharge patients for a second attack; recovery teams shouldn't either.",
      },
      {
        myth: "Drugs are only a slum or 'bad area' problem.",
        fact: "The national survey found substance use across every income and education band. Alcohol and pharma-opioid misuse is highest in urban middle-income households.",
      },
    ],
    toolkit: [
      {
        title: "Conversation starters that work",
        items: [
          "'I'm not here to punish you — I want to understand.'",
          "'What does the substance do for you? What does it take from you?'",
          "'Would you let a doctor decide, if I come with you?'",
          "'Nothing you tell me will make me love you less.'",
        ],
      },
      {
        title: "Home & campus audit",
        items: [
          "Prescription opioids, cough syrups and sleep pills stored, counted, locked.",
          "Alcohol not used as a reward or stress-relief model in front of teens.",
          "College fests have a signed no-narcotics protocol and a named counsellor.",
          "One notice board with 14446 / 14416 / 1933 posters that students designed.",
        ],
      },
      {
        title: "Help directory — save these now",
        items: [
          "14446 — National de-addiction helpline (24×7, free).",
          "14416 — Tele-MANAS mental-health & substance counselling.",
          "1933 — NCB MANAS: report drug trafficking (anonymous).",
          "Nearest government de-addiction OPD + its timings, written down.",
        ],
      },
    ],
    faqs: [
      {
        q: "Is calling 14446 really anonymous and free?",
        a: "Yes. 14446 is the Union Health Ministry's national toll-free de-addiction helpline, staffed 24×7. No name or address is required for a first consultation — the counsellor will only ask what you're willing to share.",
      },
      {
        q: "Will the police arrest my son if we take him to a de-addiction centre?",
        a: "No. Section 64A of the NDPS Act gives immunity from prosecution to addicts who volunteer for treatment, even if charged with use or small-quantity possession. Hospitals treat; they don't register cases.",
      },
      {
        q: "How much does treatment cost?",
        a: "Government de-addiction OPDs charge token amounts (often under ₹500 including medicines). Private de-addiction varies wildly — always verify registration. UAR can help you compare options.",
      },
      {
        q: "We tried rehab twice and he relapsed. What now?",
        a: "Adjust, don't abandon. Ask the doctor about medication-assisted treatment (e.g., buprenorphine for opioids), add family therapy, and set up 90-day aftercare with volunteer check-ins. Relapse rates fall sharply with structured follow-up.",
      },
      {
        q: "How do I report a dealer near my college without exposing myself?",
        a: "Call 1933 or file on the NCB MANAS portal — both accept anonymous tips. Share location patterns rather than one-off guesses; NCB acts on corroborated patterns.",
      },
    ],
    links: [
      { label: "Tele-MANAS (MoHFW)", href: "https://telemanas.mohfw.gov.in" },
      { label: "NCB MANAS portal", href: "https://manas.gov.in" },
      { label: "NIMHANS Centre for Well-Being", href: "https://nimhans.ac.in" },
      { label: "NMBA — Nasha Mukt Bharat Abhiyaan", href: "https://nmba.dss.gov.in" },
    ],
  },

  "cyber-crime": {
    slug: "cyber-crime",
    title: "Cyber Crime Rescue & Awareness",
    short:
      "The golden hour: freezing fraud money before it moves, and teaching every family the red flags.",
    accent: "cyan",
    icon: "smartphone",
    helpline: { name: "Cyber Fraud Helpline", number: "1930" },
    heroTag:
      "Money stolen online can be frozen — if you call 1930 within the golden hour. Speed is the whole game.",
    overview: [
      "Indians lost a reported ₹22,845 crore to cyber fraud in FY 2023-24 (I4C — Indian Cyber Crime Coordination Centre), with UPI scams, fake trading and job/task rackets leading the board. The newest terror is the 'digital arrest': callers posing as CBI, customs or courier police keep victims on video calls for hours and drain their accounts with theatrical threats. No agency in India arrests anyone over a video call — ever.",
      "The single most important fact of financial cyber crime is the golden hour: when a fraud is reported to 1930 or cybercrime.gov.in quickly, I4C's STOP-transaction flow alerts nodal officers at banks and wallets, and the money can be frozen while it is still parked in first- or second-layer mule accounts. Reported within an hour, recovery odds are strong; reported the next morning, the trail is usually cold.",
      "United Angel Reach runs golden-hour drills in apartment complexes, shops and schools: save 1930, learn the report flow, rehearse what to tell the bank, and how to preserve screenshots. Our volunteers also help elderly victims file complaints and follow the mule-account trail with the bank's nodal officer.",
    ],
    keyFacts: [
      { label: "Reported cyber-fraud losses (FY 2023-24)", value: "₹22,845", suffix: " crore" },
      { label: "Freeze chance if reported within 1 hour", value: "~70", suffix: "%" },
      { label: "Complaints that are UPI-related", value: "~45", suffix: "%" },
      { label: "National cyber helpline", value: "1930", suffix: " · 24×7" },
      { label: "Portal for filing complaints", value: "cybercrime.gov.in", suffix: "" },
    ],
    charts: [
      {
        title: "Where the money goes — fraud types (share of complaints)",
        desc: "Pattern reported on the National Cyber Crime Reporting Portal, 2024.",
        type: "pie",
        data: [
          { name: "UPI / payment fraud", value: 45 },
          { name: "Job & task scams", value: 18 },
          { name: "Digital arrest", value: 15 },
          { name: "Instant-loan apps", value: 12 },
          { name: "Other", value: 10 },
        ],
        nameKey: "name",
        valueKey: "value",
        colors: CYAN,
      },
      {
        title: "The golden-hour curve — chance of freezing funds",
        desc: "Probability that the stolen money is still recoverable, by reporting delay in minutes.",
        type: "line",
        data: [
          { minutes: "0 min", freezeChance: 85 },
          { minutes: "30 min", freezeChance: 70 },
          { minutes: "60 min", freezeChance: 50 },
          { minutes: "3 hrs", freezeChance: 25 },
          { minutes: "24 hrs", freezeChance: 8 },
        ],
        xKey: "minutes",
        nameKey: "minutes",
        valueKey: "freezeChance",
        colors: CYAN,
      },
    ],
    whyItMatters: [
      "Cyber crime is now volume crime: one in twelve Indian households has been targeted at least once, most often through a phone call that felt routine.",
      "The elderly lose the largest single amounts (digital-arrest scams average lakhs), while 18–35s lose most frequently (job/task and trading scams).",
      "Mule accounts are recruited from students and gig workers — many don't know that lending their account is a punishable offence under the IT Act and BNS.",
      "Fast reporting doesn't just save your money — it seeds the intelligence grid that freezes mule networks for thousands of other victims.",
      "Awareness beats insurance: banks refund only a small share of authorised-push frauds. Prevention plus the golden hour is the real protection.",
    ],
    playbook: [
      {
        title: "Minute 0 — stop all payments",
        desc: "The moment you sense fraud, stop sending money. Fraudsters create urgency ('pay now or be arrested'). Urgency is the tell. Hang up, don't 'verify' by calling back the same number.",
      },
      {
        title: "Minute 1–5 — call 1930",
        desc: "Dial 1930 or file on cybercrime.gov.in. Keep ready: the 12-digit UTR/RRN of the transaction, the fraudster's number/UPI ID, amount and time. The operator opens a STOP-transaction request instantly.",
      },
      {
        title: "Minute 5–15 — freeze with your bank",
        desc: "Call your bank's fraud line, request a hold on the disputed transaction, and ask for the nodal officer's email. Send the complaint in writing with screenshots — banks need written records to act.",
      },
      {
        title: "Hour 1 — preserve everything",
        desc: "Screenshots of chats, payment confirmations, the caller's numbers, WhatsApp profile, links — all of it. Do NOT delete anything, even embarrassing messages. Evidence is your leverage.",
      },
      {
        title: "Day 1 — scrub and report the number",
        desc: "Report the fraudster's number on Chakshu (sancharsaathi.gov.in) so telecom can cut it off, block the UPI ID in your app, and check your credit report if any loan app was involved.",
      },
      {
        title: "Day 2 — brief the family group",
        desc: "Two minutes in the family WhatsApp group beats ten lectures: 'Real police never arrest on video call. No job asks for deposit money. Anyone can call 1930 free.' Repeat after every new scam pattern in the news.",
      },
    ],
    dosDonts: {
      dos: [
        "Save 1930 as a favourite in every family member's phone, including grandparents'.",
        "Set UPI transaction limits and a 30-second pause rule for any payment above ₹5,000.",
        "Verify every 'official' by calling the number on the organisation's own website.",
        "File the written complaint even after phone reporting — it starts the paper trail.",
      ],
      donts: [
        "Don't stay on the call — isolation is the scam's main weapon.",
        "Don't download 'verification' apps (ApkViewer, screen-share, AnyDesk) for strangers.",
        "Don't search customer-care numbers on Google — they're ads, often fake.",
        "Don't believe caller ID or uniformed video backgrounds — both are trivially faked.",
      ],
    },
    mythsFacts: [
      {
        myth: "The bank will always refund me.",
        fact: "Under RBI rules, banks must credit back unauthorised e-transactions reported within 3 working days only in limited zero-liability cases. Authorised-push fraud (you entered the PIN) is rarely refunded — speed and freezing are the real remedy.",
      },
      {
        myth: "'Digital arrest' is a real procedure.",
        fact: "No. Indian law has no such thing. CBI, customs, police or TRAI never arrest or interrogate over video calls, never demand money for 'verification', and never ask you to stay on camera.",
      },
      {
        myth: "Cyber crime only happens to careless or elderly people.",
        fact: "The largest victim group by count is 18–35 year olds — via job/task scams, trading rackets and loan apps. Intelligence is not a vaccine against social engineering.",
      },
      {
        myth: "Reporting does nothing — the money is gone.",
        fact: "I4C's freeze mechanism has preserved crores in mule accounts that would otherwise have been dispersed. Every fast report increases the odds for you and for every other victim in the chain.",
      },
    ],
    toolkit: [
      {
        title: "Golden-hour card (print & stick on the fridge)",
        items: [
          "Call 1930 within the first hour. Free, 24×7, all languages.",
          "Have ready: UTR number, amount, time, fraudster's number/UPI ID.",
          "Then: bank fraud line → written complaint → nodal officer email.",
          "File on cybercrime.gov.in the same day; save the acknowledgement number.",
        ],
      },
      {
        title: "Phone hardening (15 minutes)",
        items: [
          "Enable SIM-lock and app locks on banking/UPI apps.",
          "Set per-transaction UPI limits; disable 'auto-pay' you don't recognise.",
          "Turn on 'Protect from unknown numbers' / spam filters.",
          "Remove screen-sharing and sideloaded APK apps you don't use.",
        ],
      },
      {
        title: "Family drill (run once a quarter)",
        items: [
          "Role-play a 'digital arrest' call — the answer is always: hang up, call 1930.",
          "Agree on a family code word for genuine emergencies vs. 'accident' calls.",
          "Teach elders: no OTP sharing, ever — banks never ask.",
          "Show everyone the Chakshu page for reporting spam calls/SIMs.",
        ],
      },
    ],
    faqs: [
      {
        q: "I reported within 10 minutes. When will my money come back?",
        a: "Freeze is usually applied within hours; release to you happens after the bank's dispute process (often 7–30 days). Keep the acknowledgement number and follow up with your bank's nodal officer in writing.",
      },
      {
        q: "What exactly is a mule account?",
        a: "A current or savings account rented (knowingly or not) from students/gig workers to receive and forward fraud money. Rapid multi-layer hopping is why the golden hour matters — after a few hops, recovery almost never succeeds.",
      },
      {
        q: "I gave a loan app my contacts and photos. What do I do?",
        a: "Stop repaying to 'recovery agents' who threaten morphing or contact-list blasts — that's criminal intimidation; file a complaint with screenshots. Revoke app permissions, file on cybercrime.gov.in, and complain to RBI against unlicensed lenders.",
      },
      {
        q: "Can I file a complaint without going to a police station?",
        a: "Yes — 1930 by phone and cybercrime.gov.in online cover most financial fraud. A station visit is only needed for some categories; the portal will tell you.",
      },
      {
        q: "How do I check if a job offer is a scam?",
        a: "Red flags: 'registration/training deposit', Telegram-only interviews, pay-per-YouTube-like tasks, salaries absurd for the skill. Real employers never ask for deposits. Search the company name + 'scam' before sharing documents.",
      },
    ],
    links: [
      { label: "National Cyber Crime Portal", href: "https://cybercrime.gov.in" },
      { label: "Chakshu — report fraud calls/SIMs", href: "https://sancharsaathi.gov.in" },
      { label: "I4C awareness hub", href: "https://www.i4c.mha.gov.in" },
      { label: "RBI Sachet — illegal lenders", href: "https://sachet.rbi.org.in" },
    ],
  },

  "women-safety": {
    slug: "women-safety",
    title: "Women Safety & Support",
    short:
      "From 181 Sakhi One-Stop Centres to POSH rights at work — help that believes you, and moves fast.",
    accent: "fuchsia",
    icon: "heart-handshake",
    helpline: { name: "Sakhi Women Helpline (One-Stop Centre)", number: "181" },
    heroTag:
      "You are not alone: 181 for support and shelter, 112 for emergencies, 1091 for women police.",
    overview: [
      "NFHS-5 found that about 29% of ever-married Indian women aged 18–49 have faced spousal violence — yet only around 15% ever sought help, and barely 5–7% approached the police. The gap between suffering and support is not a law-enforcement statistic; it is a silence built from stigma, dependence and not knowing that free, structured help exists.",
      "The infrastructure is better than most women know: 181 connects to Sakhi One-Stop Centres that provide medical aid, police facilitation, legal aid, psychosocial counselling and temporary shelter under one roof; the Protection of Women from Domestic Violence Act 2005 gives civil remedies — protection orders, residence rights, maintenance — without requiring a criminal case; and the POSH Act 2013 makes an Internal Committee mandatory in every workplace with 10 or more employees.",
      "United Angel Reach volunteers accompany women to Sakhi centres, run POSH awareness sessions in small shops and clinics (the workplaces least likely to have functioning committees), and hold self-defence and safety-planning workshops in colleges and residential wards.",
    ],
    keyFacts: [
      { label: "Ever-married women facing spousal violence (NFHS-5)", value: "29", suffix: "%" },
      { label: "Of those, who ever sought help", value: "15", suffix: "%" },
      { label: "Sakhi One-Stop Centres across India", value: "700", suffix: "+" },
      { label: "Women & child emergency response", value: "112", suffix: " · 24×7" },
      { label: "POSH Internal Committee required at", value: "10", suffix: "+ employees" },
    ],
    charts: [
      {
        title: "Of every 100 women facing violence (India)",
        desc: "The reporting gap, modelled on NFHS-5 and NCRB patterns — support must close it.",
        type: "bar",
        data: [
          { stage: "Face violence", women: 30 },
          { stage: "Tell someone", women: 22 },
          { stage: "Seek formal help", women: 15 },
          { stage: "File police complaint", women: 6 },
        ],
        xKey: "stage",
        nameKey: "stage",
        valueKey: "women",
        colors: FUCHSIA,
      },
      {
        title: "Where women turn first for help",
        desc: "Informal networks carry most disclosures — training families matters as much as helplines.",
        type: "pie",
        data: [
          { name: "Family", value: 45 },
          { name: "Friends", value: 25 },
          { name: "Helpline / NGO", value: 12 },
          { name: "Police", value: 9 },
          { name: "No one", value: 9 },
        ],
        nameKey: "name",
        valueKey: "value",
        colors: FUCHSIA,
      },
    ],
    whyItMatters: [
      "A disclosure believed within the first hour triples the chance that a woman follows through with formal help.",
      "One-Stop Centres exist in nearly every district, yet most survivors learn of them only after crisis — awareness is the cheapest multiplier.",
      "Economic abuse (denied money, destroyed employment) is legally recognised domestic violence under the 2005 Act, and is among the most reported yet least prosecuted forms.",
      "Workplaces with trained Internal Committees resolve complaints in weeks instead of years — and deterrence measurably reduces incidents.",
      "Safety planning (documents, go-bag, code word, trusted contacts) reduces repeat-violence injuries dramatically, at almost zero cost.",
    ],
    playbook: [
      {
        title: "In danger right now — 112",
        desc: "Call or use the 112 India app (silent SOS). PCR vans are dispatched to location. If speaking is unsafe, keep the line open — the control room protocols for that. Women police: 1091.",
      },
      {
        title: "Need shelter, medical help or counselling — 181",
        desc: "Sakhi One-Stop Centres bundle medical examination, police facilitation, legal aid, counselling and temporary shelter in one place, free. You may bring a trusted person; you control every step.",
      },
      {
        title: "Know your civil remedies (DV Act 2005)",
        desc: "A Protection Officer (usually at the District Programme Office / DLSA) can help you obtain protection orders, right of residence in the shared household, and maintenance — without filing a criminal case. Breach of an order is punishable.",
      },
      {
        title: "Harassment at work — POSH Act 2013",
        desc: "Every workplace with 10+ employees must have an Internal Committee; districts have Local Committees for smaller units. File within 3 months (extendable). The inquiry must finish in 90 days; interim relief (transfer, leave) can be asked immediately.",
      },
      {
        title: "Document and plan — quietly",
        desc: "Keep dated notes, photos of injuries, medical records, and any threats. Pack a go-bag (IDs, some cash, medicines, a spare phone). Share live location with one trusted contact. A plan made calm is worth ten made terrified.",
      },
    ],
    dosDonts: {
      dos: [
        "Save 112, 181 and 1091 as favourites — yours and your friends'.",
        "Believe the first disclosure; ask 'how can I help?' before anything else.",
        "Use the 112 India app's SOS and check that location permissions are on.",
        "Encourage medical examination even if injuries seem minor — it protects you legally.",
      ],
      donts: [
        "Don't advise a survivor to 'adjust' or confront the abuser alone.",
        "Don't share a survivor's story without consent — privacy is safety.",
        "Don't delete threatening messages; they are evidence.",
        "Don't wait for 'a big incident' — escalating control is itself a warning.",
      ],
    },
    mythsFacts: [
      {
        myth: "Domestic violence is a private family matter.",
        fact: "The Protection of Women from Domestic Violence Act 2005 recognises physical, sexual, emotional and economic abuse as civil wrongs with enforceable remedies. Neighbours and relatives can also inform authorities.",
      },
      {
        myth: "Only physical violence counts.",
        fact: "Insults, isolation, denial of money, threats and dowry demands are all recognised abuse. Most survivors report the economic and emotional forms long before physical violence.",
      },
      {
        myth: "POSH applies only to corporate offices.",
        fact: "It applies to every workplace with 10 or more employees — shops, clinics, NGOs, factories. Even smaller units fall under the district's Local Committee.",
      },
      {
        myth: "Reporting will make things worse for her.",
        fact: "Data from One-Stop Centres shows that structured intervention with protection orders and shelter options reduces repeat violence. The risk rises with silence, not with supported reporting.",
      },
    ],
    toolkit: [
      {
        title: "Safety plan essentials",
        items: [
          "Copies of ID, bank and marriage documents with a trusted friend.",
          "Go-bag: cash, medicines, charger, spare SIM.",
          "Code word that means 'call 112 now' with family/friends.",
          "Numbers saved under innocuous names (e.g., 'Sakshi-di').",
        ],
      },
      {
        title: "Your rights card",
        items: [
          "Right to protection order & residence (DV Act 2005).",
          "Free legal aid via DLSA in every district.",
          "POSH Internal Committee inquiry in 90 days; interim relief on request.",
          "Zero FIR at any police station, anywhere in India.",
        ],
      },
      {
        title: "If a friend discloses",
        items: [
          "Listen without judgement; don't interrogate details.",
          "Ask what she wants — safety, information, company, or all three.",
          "Offer to sit beside her during the 181 call or Sakhi visit.",
          "Keep checking in after — most dropouts happen in week two.",
        ],
      },
    ],
    faqs: [
      {
        q: "I'm not sure my situation 'qualifies' as violence. Can I still call 181?",
        a: "Yes. 181 counsellors are trained to help you assess risk without judging your situation. A call costs nothing and commits you to nothing.",
      },
      {
        q: "Do I have to file a police case to get protection?",
        a: "No. The DV Act 2005 route is civil — a Protection Officer can help you get protection, residence and maintenance orders without any criminal complaint. You can add a criminal complaint later if you choose.",
      },
      {
        q: "My workplace has 8 employees and no committee. Where do I complain?",
        a: "File with the district's Local Committee (usually with theCollectorate or DLSA). The POSH Act requires every district to constitute one for workplaces with fewer than 10 employees.",
      },
      {
        q: "What is a Zero FIR?",
        a: "An FIR registered at any police station regardless of jurisdiction, later transferred to the station with territorial control. It exists so that no survivor loses hours hunting for the 'right' station.",
      },
      {
        q: "Can a friend file a POSH complaint on my behalf?",
        a: "The complainant should be the aggrieved woman, but she may seek support and the committee can accommodate confidentiality requests. If she is incapacitated, a legal heir or nominated person may file.",
      },
    ],
    links: [
      { label: "National Commission for Women", href: "https://ncw.nic.in" },
      { label: "SHe-Box (POSH complaints)", href: "https://shebox.wcd.gov.in" },
      { label: "Ministry of WCD — One-Stop Centres", href: "https://wcd.gov.in" },
      { label: "112 India app", href: "https://112.gov.in" },
    ],
  },

  "child-safety": {
    slug: "child-safety",
    title: "Child Safety & Protection",
    short:
      "Teaching children body safety, and making every adult in the room a mandated protector.",
    accent: "amber",
    icon: "baby",
    helpline: { name: "CHILDLINE (free, 24×7)", number: "1098" },
    heroTag:
      "About 9 in 10 abusers are people the child knows. Teach the underwear rule — and dial 1098 the moment you're worried.",
    overview: [
      "Decades of child-protection research and NCRB POCSO data point to the same uncomfortable truth: strangers are a small fraction of the risk. Around 90% of sexual abuse is committed by people a child knows and trusts — relatives, neighbours, coaches, teachers, older children. 'Stranger danger' posters protect children from the least likely threat while leaving them unprepared for the real one.",
      "Prevention is teachable. The 'underwear rule' (private parts are private; safe vs unsafe touch; secrets that must be told), the NO–GO–TELL drill, and — above all — adults who believe a child's first disclosure, change outcomes. Under POCSO 2012, every adult has a mandatory duty to report known or suspected offences; failure to report is itself punishable. CHILDLINE 1098 is free, 24×7, and multilingual.",
      "United Angel Reach trains teachers and parents in Bengaluru and beyond on disclosure-handling (record verbatim, no leading questions, believe first), runs school safety-committee audits, and connects families to POCSO courts' support persons so that a child's testimony never has to be given alone.",
    ],
    keyFacts: [
      { label: "Abuse committed by persons known to the child", value: "~90", suffix: "%" },
      { label: "Free 24×7 child helpline", value: "1098", suffix: "" },
      { label: "Law with mandatory reporting", value: "POCSO 2012", suffix: "" },
      { label: "Statement recorded by (POCSO)", value: "Woman", suffix: " officer" },
      { label: "Time limit for reporting abuse", value: "None", suffix: "" },
    ],
    charts: [
      {
        title: "Who children need protection from",
        desc: "The uncomfortable 90/10 — protection must focus inside the trust circle.",
        type: "pie",
        data: [
          { name: "Known persons", value: 90 },
          { name: "Strangers", value: 10 },
        ],
        nameKey: "name",
        valueKey: "value",
        colors: AMBER,
      },
      {
        title: "Warning signs adults notice too late",
        desc: "Behavioural signals in reported cases — any sudden, unexplained change deserves a gentle conversation.",
        type: "bar",
        data: [
          { name: "Withdrawal / silence", value: 68 },
          { name: "Sudden anger or fear", value: 54 },
          { name: "Falling grades", value: 47 },
          { name: "Sleep & appetite changes", value: 41 },
          { name: "Fear of one person/place", value: 35 },
        ],
        xKey: "name",
        nameKey: "name",
        valueKey: "value",
        colors: AMBER,
      },
    ],
    whyItMatters: [
      "Children rarely lie about abuse; they usually under-report it. The cost of believing a false alarm is a conversation — the cost of not believing a true one is a childhood.",
      "A single trained teacher reliably catches what an entire untrained staff misses: the withdrawn child, the fear of one adult, the story that changes.",
      "POCSO's child-friendly process (statement by a woman officer, in-camera testimony, support person) exists precisely so reporting doesn't retraumatise.",
      "Age-appropriate body-safety education does not 'plant ideas' — studies show educated children report earlier and offenders target elsewhere.",
      "Boys are abused too, and report far less. Protection language must be gender-neutral at home and school.",
    ],
    playbook: [
      {
        title: "Teach the underwear rule",
        desc: "Parts covered by underwear are private; nobody may look or touch except for hygiene/health with permission. Practise the words out loud — 'No. Stop. I will tell.' — until they are easy, because in the moment they must be automatic.",
      },
      {
        title: "Drill NO–GO–TELL like a fire drill",
        desc: "Say NO loudly, GO away from the person, TELL a trusted adult — and keep telling until an adult acts. Rehearse scenarios: 'What if it's uncle? What if they say it's our secret?' Secrets that make you feel bad are always tell-able.",
      },
      {
        title: "If a child discloses — believe, record, don't lead",
        desc: "Stay calm; write down the exact words immediately. Ask only open questions ('then what happened?'), never 'Did X touch you?'. Reassure: 'You did the right thing. This is not your fault.' Don't promise secrecy you can't keep.",
      },
      {
        title: "Report — it is your legal duty",
        desc: "CHILDLINE 1098 (free, 24×7), local police, or the POCSO e-Box. Under POCSO 2012, any person who fails to report a known/suspected offence can be punished. The child's identity is protected by law throughout.",
      },
      {
        title: "Walk with the child through the process",
        desc: "Ask for a support person (UAR volunteers serve as one), ensure the statement is recorded by a woman constable/officer in a child-friendly setting, and track the POCSO court dates. Justice, done kindly, is itself therapy.",
      },
    ],
    dosDonts: {
      dos: [
        "Use anatomically correct words for body parts — they are a child's evidence vocabulary.",
        "Make 'tell me anything, I won't be angry' a daily household habit.",
        "Audit one-adult-alone situations: sports coaching, tuition, transport.",
        "Teach children that telling on an adult who broke the rule is brave, not betrayal.",
      ],
      donts: [
        "Don't panic, cry loudly or interrogate when a child discloses — your calm is their courage.",
        "Don't confront the accused yourself; it destroys evidence and can endanger the child.",
        "Don't dismiss 'small' touches as jokes — grooming escalates in small steps.",
        "Don't make children hug relatives on demand — body autonomy starts with consent practice.",
      ],
    },
    mythsFacts: [
      {
        myth: "It can't happen in good families and good schools.",
        fact: "Abuse cuts across class, religion and school type. Because ~90% of abusers are known and trusted, 'safe' settings are exactly where grooming thrives.",
      },
      {
        myth: "Children will forget and move on.",
        fact: "Unprocessed trauma persists into adulthood — anxiety, trust and health effects are well documented. Early, believed disclosure plus support changes the trajectory.",
      },
      {
        myth: "Talking about body safety plants ideas in children.",
        fact: "Age-appropriate safety education is protective: it gives children vocabulary and permission to report. Studies show no increase in fear or sexual knowledge beyond age norms.",
      },
      {
        myth: "Only girls need this training.",
        fact: "Boys face substantial abuse and report even less due to stigma. Protection rules must be taught identically to all children.",
      },
    ],
    toolkit: [
      {
        title: "Body-safety words by age",
        items: [
          "3–5 yrs: correct names for private parts; 'your body, your rules'.",
          "6–8 yrs: underwear rule; safe vs unsafe secrets; identify 3 trusted adults.",
          "9–12 yrs: grooming patterns ('gifts, secrets, isolation'); online-safety add-on.",
          "13+ yrs: consent, coercion, reporting apps, and that boys can say no too.",
        ],
      },
      {
        title: "School safety checklist",
        items: [
          "POCSO-named compliance officer displayed on the notice board.",
          "CCTV at blind-spot corridors; two-adult rule for after-school activities.",
          "Annual body-safety session for students AND teachers.",
          "Anonymous drop-box monitored by the counsellor every working day.",
        ],
      },
      {
        title: "What to say right after a disclosure",
        items: [
          "'Thank you for telling me. You are very brave.'",
          "'This is not your fault. Nothing about you caused this.'",
          "'I am going to get help so this stops — and I'll stay with you.'",
          "Then: write the exact words, call 1098, report the same day.",
        ],
      },
    ],
    faqs: [
      {
        q: "What exactly is 1098?",
        a: "CHILDLINE 1098 is India's free, 24×7 emergency phone line for children in distress — abuse, missing, child labour, trafficking, or simply a child needing to talk. It is answered by trained counsellors who can dispatch help.",
      },
      {
        q: "Am I really legally required to report, even if the family wants to 'settle it'?",
        a: "Yes. Under Section 21 of POCSO 2012, any person in charge of an institution and every person who has knowledge of an offence must report. 'Family settlement' does not remove that duty, and failure to report is punishable.",
      },
      {
        q: "Will the child have to face the accused in court?",
        a: "No. POCSO courts provide in-camera testimony, screens or video-link so the child never faces the accused, plus a support person and identity protection.",
      },
      {
        q: "How do I report without exposing the child?",
        a: "1098 and the POCSO e-Box accept reports with confidentiality protections; the law prohibits disclosure of the child's identity by media or public. Involving a support NGO early keeps the child shielded.",
      },
      {
        q: "What if the child takes back the statement later?",
        a: "Recanting under family pressure is common and courts know it. Keep the original verbatim record, inform the investigating officer, and continue support — a retract doesn't end the protection machinery.",
      },
    ],
    links: [
      { label: "POCSO e-Box (report)", href: "https://pocsoebox-police.gov.in" },
      { label: "CHILDLINE India", href: "https://childlineindia.org.in" },
      { label: "NCPCR", href: "https://ncpcr.gov.in" },
      { label: "Ministry of WCD — Child Protection", href: "https://wcd.gov.in" },
    ],
  },

  "medicine-adoption": {
    slug: "medicine-adoption",
    title: "Adopt-a-Medicine",
    short:
      "₹150–₹2,500 a month keeps a chronic patient — BP, diabetes, cardiac, thyroid — on uninterrupted treatment.",
    accent: "teal",
    icon: "pill",
    helpline: { name: "Karnataka Health Helpline (Arogya Kavacha)", number: "104" },
    heroTag:
      "Skip one weekend coffee run — keep a stranger's heart beating on schedule.",
    overview: [
      "India runs the world's largest chronic-disease epidemic on out-of-pocket money: over 31 crore adults live with hypertension and about 10 crore with diabetes (ICMR). Their medicines are cheap by global standards — ₹150 to ₹2,500 a month — yet surveys consistently find that roughly one in four poor chronic patients skips doses to save money, and skipping is not neutral: it converts manageable illness into strokes, kidney failure and amputations.",
      "Adopt-a-Medicine inverts charity's usual opacity. A UAR pharmacist verifies each patient's prescription and cost from Jan Aushadhi (government generic pharmacy) rates; a donor adopts the patient fully or partially through a monthly pledge; procurement happens centrally at generic prices; a volunteer delivers with a QR receipt. You see the person, the medicine, the date, the city — every month.",
      "A full adoption costs less than most streaming-and-takeout budgets. Shared adoptions (two donors at ₹750 each) are equally welcome — the point is that no verified prescription goes unfilled for want of ₹150.",
    ],
    keyFacts: [
      { label: "Indians living with hypertension", value: "31", suffix: " crore" },
      { label: "Indians living with diabetes (ICMR)", value: "10", suffix: " crore" },
      { label: "Poor chronic patients who skip doses for cost", value: "1 in 4", suffix: "" },
      { label: "Monthly BP+diabetes medicines at Jan Aushadhi", value: "₹150", suffix: "–₹300" },
      { label: "Full adoption range per patient/month", value: "₹150", suffix: "–₹2,500" },
    ],
    charts: [
      {
        title: "Typical monthly medicine cost by condition (₹)",
        desc: "Verified against Jan Aushadhi / generic supplier rates used by UAR procurement.",
        type: "bar",
        data: [
          { name: "Thyroid", cost: 800 },
          { name: "BP", cost: 900 },
          { name: "Asthma", cost: 1200 },
          { name: "Diabetes", cost: 1500 },
          { name: "Arthritis", cost: 1800 },
          { name: "Cardiac", cost: 2500 },
        ],
        xKey: "name",
        nameKey: "name",
        valueKey: "cost",
        colors: TEAL,
      },
      {
        title: "The cost of skipping — hospitalisations per 100 patients a year",
        desc: "Dose-skippers are hospitalised three times as often. Skipping ₹900 of tablets can trigger a ₹90,000 admission.",
        type: "bar",
        data: [
          { group: "Takes medicines daily", hospitalisations: 12 },
          { group: "Skips doses to save money", hospitalisations: 38 },
        ],
        xKey: "group",
        nameKey: "group",
        valueKey: "hospitalisations",
        colors: TEAL,
      },
    ],
    whyItMatters: [
      "Adherence is the cheapest medicine in the world: taking prescribed tablets on schedule outperforms most interventions in chronic disease.",
      "A single missed course can cascade: uncontrolled BP → stroke; uncontrolled sugar → kidney failure. Prevention costs 1–3% of the treatment it avoids.",
      "Medicines purchased through Jan Aushadhi typically cost 50–90% less than branded equivalents — your pledge stretches twice as far as retail.",
      "Families avoid catastrophic spending: medicine crowdfunding at scale reduces medical debt, the leading cause of Indian households falling into poverty.",
      "Verified adoption closes the leak: because each rupee maps to a named patient and a QR'd delivery, there is no slush to leak.",
    ],
    playbook: [
      {
        title: "Browse verified causes",
        desc: "Every patient on the board has a UAR-MED code, a pharmacist-verified prescription, and a cost sheet built on Jan Aushadhi rates. Nothing is listed without a real prescription on file.",
      },
      {
        title: "Choose full or shared adoption",
        desc: "Adopt the entire monthly cost, or split it with other donors (₹150–₹750 shares). Monthly is what matters: continuity, not size, keeps a patient stable.",
      },
      {
        title: "Set your pledge",
        desc: "Pick amount per month and duration (3/6/12 months). You'll get a reminder and a UAR receipt; you can pause or cancel any month — a waiting donor takes over seamlessly.",
      },
      {
        title: "UAR procures, volunteer delivers",
        desc: "Medicines are bought centrally at generic prices, checked against the prescription, and delivered by a volunteer with a QR-coded receipt you can scan for proof of delivery.",
      },
      {
        title: "Follow your patient's month",
        desc: "Each cycle you receive an adherence and outcome note — BP/sugar logs where shared, refill dates, and the volunteer's delivery confirmation. Adoption comes with witnesses, not just invoices.",
      },
    ],
    dosDonts: {
      dos: [
        "Prefer generics — ask every doctor for the generic/Jan Aushadhi equivalent.",
        "Store medicines cool and dry; check expiry at every refill.",
        "Keep an updated medicine list in your phone for emergencies.",
        "Verify online pharmacies' licences before ordering.",
      ],
      donts: [
        "Don't share prescription medicines between family members.",
        "Don't stop a course because 'I feel fine now' — BP and sugar meds don't work that way.",
        "Don't buy from social-media sellers or unverified WhatsApp pharmacies.",
        "Don't crush or split extended-release tablets.",
      ],
    },
    mythsFacts: [
      {
        myth: "Generic medicines are substandard.",
        fact: "WHO-quality generics are bioequivalent to brands — India is the world's generic pharmacy and Jan Aushadhi stores are government-audited. Price reflects marketing, not molecule quality.",
      },
      {
        myth: "Adopting a patient makes me legally responsible for their health.",
        fact: "Adoption is a donation, not a medical contract. Clinical decisions remain with the treating doctor; UAR handles procurement and delivery.",
      },
      {
        myth: "Government hospitals give all medicines free anyway.",
        fact: "Inpatient care is often subsidised, but outpatient chronic medicines — the daily BP and sugar tablets — are rarely fully covered, which is exactly the gap adoption fills.",
      },
      {
        myth: "₹150 a month can't make a real difference.",
        fact: "At Jan Aushadhi rates ₹150 fully covers a month of dual BP+diabetes therapy for one patient. Continuity, not amount, is what prevents the stroke.",
      },
    ],
    toolkit: [
      {
        title: "Before you pledge",
        items: [
          "Check the cause's code (UAR-MED-####) and pharmacist-verified status.",
          "Decide monthly vs one-time; monthly has 5× the clinical impact.",
          "Set a calendar reminder or auto-pay so the chain never breaks.",
        ],
      },
      {
        title: "If you are the patient/family",
        items: [
          "Keep the prescription and ID ready for verification.",
          "Ask the pharmacist for generic substitutions — it is your right.",
          "Report delivery problems within 48 hours to care@unitedangelreach.org.",
        ],
      },
      {
        title: "Spread it",
        items: [
          "Gift an adoption on birthdays — receipts make honest gifts.",
          "One society notice: 'Adopt your neighbour's BP tablets'.",
          "Employers: match 1:1 — 50 employees can carry a village clinic.",
        ],
      },
    ],
    faqs: [
      {
        q: "How is the monthly cost calculated?",
        a: "From the patient's actual prescription, priced at Jan Aushadhi / verified generic supplier rates, plus a small logistics allowance. The cost sheet is reviewed every quarter by a UAR pharmacist.",
      },
      {
        q: "What happens if a patient's medicines change?",
        a: "The cause is re-verified and you're informed. Pledges adjust to the new cost — you approve any increase; otherwise UAR absorbs it or finds a co-donor.",
      },
      {
        q: "Can I adopt anonymously?",
        a: "Yes. Choose anonymous while pledging; the patient sees 'An angel in Bengaluru' and you still receive delivery confirmations.",
      },
      {
        q: "Is my pledge eligible for 80G deduction?",
        a: "Yes. All adoptions go through United Angel Reach Trust, registered under 80G/12A; receipts carry your PAN if provided.",
      },
      {
        q: "How do I know the medicines actually reached?",
        a: "Every delivery carries a QR receipt — scan it to see date, volunteer and patient confirmation. Monthly adherence notes close the loop.",
      },
    ],
    links: [
      { label: "Jan Aushadhi (PMBJP)", href: "https://janaushadhi.gov.in" },
      { label: "Karnataka Arogya Kavacha — 104", href: "https://arogyakavacha-104.karnataka.gov.in" },
      { label: "ICMR — India's diabetes burden", href: "https://www.icmr.gov.in" },
      { label: "Pradhan Mantri Bhartiya Janaushadhi Pariyojana store locator", href: "https://janaushadhi.gov.in/KendraDetails.aspx" },
    ],
  },

  "animal-welfare": {
    slug: "animal-welfare",
    title: "Animal Welfare & Adoption",
    short:
      "Feed, vaccinate, sterilise — and defend every street animal's right to the city with the law on your side.",
    accent: "lime",
    icon: "paw-print",
    helpline: { name: "AWBI Animal Rescue Helpline", number: "1962" },
    heroTag:
      "Kindness has a monthly EMI: ₹900 feeds a street dog for a month. Sterilisation ends the cycle.",
    overview: [
      "India shares its streets with roughly 1.5 crore free-roaming dogs plus uncounted cats, cattle and birds. Cruelty is illegal — the Prevention of Cruelty to Animals Act 1960 punishes it — and the Animal Birth Control (ABC) Rules 2023 make sterilisation-and-vaccination the legally mandated, humane population solution. Relocating or removing street dogs is explicitly unlawful: the vacuum simply refills.",
      "The welfare arithmetic is simple and it works: a sterilised, vaccinated, regularly fed dog is calmer, defends a stable territory, and stops the population cycle within a few years. That's why UAR's programme is built on three pillars — daily feeding by trained volunteers at fixed spots, ABC drives with municipal vets, and rescue lines for injured animals (1962 / AWBI, plus BBMP's Bengaluru helpline).",
      "You can join at any budget: sponsor a dog's food for ₹900 a month, fund a sterilisation, foster a recovering animal, or adopt an indie. Every pledge is tracked with feeding photos and vet records — no blind boxes.",
    ],
    keyFacts: [
      { label: "Free-roaming dogs in India", value: "1.5", suffix: " crore" },
      { label: "Law against cruelty", value: "PCA Act 1960", suffix: "" },
      { label: "Population rule in force", value: "ABC Rules 2023", suffix: "" },
      { label: "Rescue helpline (AWBI)", value: "1962", suffix: "" },
      { label: "Monthly dog food sponsorship", value: "₹900", suffix: "/mo" },
    ],
    charts: [
      {
        title: "Monthly food cost by species (₹)",
        desc: "What UAR volunteers actually spend feeding rescued/street animals each month.",
        type: "bar",
        data: [
          { name: "Birds", cost: 600 },
          { name: "Dogs", cost: 900 },
          { name: "Cats", cost: 1100 },
          { name: "Cows", cost: 3500 },
        ],
        xKey: "name",
        nameKey: "name",
        valueKey: "cost",
        colors: LIME,
      },
      {
        title: "Rescues by animal type (partner-network pattern)",
        desc: "Where rescue calls come from — and why dog-side ABC is the highest-leverage spend.",
        type: "pie",
        data: [
          { name: "Dogs", value: 62 },
          { name: "Cats", value: 21 },
          { name: "Cattle", value: 11 },
          { name: "Birds & others", value: 6 },
        ],
        nameKey: "name",
        valueKey: "value",
        colors: LIME,
      },
    ],
    whyItMatters: [
      "Sterilisation is the only population tool that works: removal creates a vacuum that new, unvaccinated animals refill within months.",
      "Rabies kills thousands in India every year, and it is 100% vaccine-preventable — mass dog vaccination protects humans first.",
      "Fed and vaccinated dogs are calmer dogs: most bite incidents involve hungry, sick or newly dumped animals defending nothing but themselves.",
      "Community feeding creates the sighting network that makes rescue fast — the person who feeds is the person who notices the limp.",
      "Kindness to animals is legally protected: feeding spots are recognised, and obstructing or poisoning community animals is punishable.",
    ],
    playbook: [
      {
        title: "Feed responsibly, legally, predictably",
        desc: "Fixed spot and time, away from traffic and school gates; fresh water bowls in summer. Feeding community animals is legally protected — keep the spot clean and neighbours friendly with a simple 'we feed at 7, we clean at 7:15'.",
      },
      {
        title: "Vaccinate and sterilise — the real fix",
        desc: "Join municipal ABC drives (free or subsidised). ABC Rules 2023 make sterilisation-and-return the official policy; a sterilised dog gets an ear-notch so nobody repeats the surgery.",
      },
      {
        title: "Injured animal? Call 1962 — fast",
        desc: "AWBI/Bengaluru BBMP rescue lines dispatch trained handlers. Don't move a snake or wild animal yourself — call the forest department. For cruelty, document (photo/video) and file under PCA Act 1960; UAR volunteers help.",
      },
      {
        title: "Adopt, don't shop",
        desc: "Indie puppies and adult dogs suit Indian climates and streets better than most purebreds. UAR's foster-then-adopt flow includes vaccination, sterilisation and a two-week trial — no impulse adoptions.",
      },
      {
        title: "Sponsor food monthly",
        desc: "₹900 buys a month of quality dog food, purchased from verified suppliers and delivered to feeding points by volunteers with photo logs. You sponsor a named animal — and get their story.",
      },
    ],
    dosDonts: {
      dos: [
        "Keep water bowls out — summer heat kills more street animals than disease.",
        "Report limping, maggot wounds or hit-and-run cases the same day (1962).",
        "Get your community animals ear-notched and vaccinated records photographed.",
        "Teach children calm animal manners: let sleeping dogs lie, no tail-pulling.",
      ],
      donts: [
        "Don't relocate dogs 'for their safety' — it's illegal and the vacuum refills with worse outcomes.",
        "Don't feed from moving vehicles or on highways.",
        "Don't try DIY treatment for maggots/fractures — wrong dosing kills.",
        "Don't buy exotic birds or trafficked pets — demand drives cruelty.",
      ],
    },
    mythsFacts: [
      {
        myth: "Feeding street dogs makes the area unsafe.",
        fact: "The opposite is documented: sterilised, vaccinated, regularly fed dogs are territorial but calm, and the population declines over time. Feeding spots also enable vaccination drives.",
      },
      {
        myth: "Removing dogs cleans the streets.",
        fact: "ABC Rules 2023 prohibit relocation. Removed territories are refilled by new, unvaccinated animals — while the removed ones usually die of starvation or traffic.",
      },
      {
        myth: "Sterilised dogs become aggressive or depressed.",
        fact: "Sterilisation reduces roaming, fighting and hormone-driven aggression, and lowers cancer risk. Behaviour changes are, if anything, calmer.",
      },
      {
        myth: "Indie dogs are weak or untrainable.",
        fact: "Indies are evolution's answer to Indian heat, streets and food — hardy, intelligent and deeply loyal. Most 'breed problems' are breeding problems.",
      },
    ],
    toolkit: [
      {
        title: "First-responder kit (car/society)",
        items: [
          "Blanket, muzzle-strip, gloves, torch.",
          "Water bowl and a sealed bag of dry food.",
          "1962 + BBMP animal helpline + nearest vet with 24×7 hours, on paper.",
          "A 'rescue box' fund of ₹500 for immediate transport.",
        ],
      },
      {
        title: "Community feeding plan",
        items: [
          "Two volunteers, two fixed spots, one fixed hour.",
          "A simple register: who fed, how many animals, any sick ones.",
          "Quarterly vaccination/ABC coordination with the municipal vet.",
          "A neighbours' note explaining timings and cleaning — de-escalate before conflict.",
        ],
      },
      {
        title: "Adoption readiness",
        items: [
          "Puppy-proofed room; toxic plants/chemicals removed.",
          "Vet chosen; vaccination and sterilisation schedule understood.",
          "Two-week trial period agreed with the foster.",
          "Everyone in the house agrees on rules (bed? sofa? feeding times?).",
        ],
      },
    ],
    faqs: [
      {
        q: "Is feeding street animals actually legal?",
        a: "Yes. Feeding community animals at reasonable places and times is protected, and courts have repeatedly affirmed it. Keep spots clean, avoid busy gates, and coordinate with residents to keep goodwill.",
      },
      {
        q: "What do I do if I see a dog being beaten?",
        a: "Record safely from a distance, note time/place, call 1962 and the police (112) — cruelty is a punishable offence under the PCA Act 1960. UAR volunteers can help file the complaint.",
      },
      {
        q: "How much does sterilisation cost and who pays?",
        a: "Municipal ABC programmes sterilise and vaccinate free or at subsidised rates. UAR funds private-vet slots (₹1,200–₹2,500) when municipal capacity is full — sponsorships cover exactly this.",
      },
      {
        q: "A snake entered my compound. Should I call the rescue line?",
        a: "Call the forest department helpline or a licensed snake rescuer — do not try to handle or kill it. Most snakes are legally protected and harmless; relocation by trained hands is the lawful path.",
      },
      {
        q: "Can I foster before deciding to adopt?",
        a: "Yes — UAR's foster flow is exactly that: a two-week trial with food and vet support, then a decision. Fostering saves lives even when you can't commit permanently.",
      },
    ],
    links: [
      { label: "Animal Welfare Board of India", href: "https://awbi.gov.in" },
      { label: "ABC Rules 2023 — notification", href: "https://moef.gov.in" },
      { label: "BBMP Animal Husbandry (Bengaluru)", href: "https://bbmp.gov.in" },
      { label: "PCA Act 1960 — text", href: "https://indiacode.nic.in" },
    ],
  },

  "green-corridor": {
    slug: "green-corridor",
    title: "AI Green Corridor",
    short:
      "Ambulances that clear their own path — V2X, Bluetooth mesh, FM break-in and adaptive sirens, layered for Indian roads.",
    accent: "red",
    icon: "siren",
    helpline: { name: "Ambulance (108 / GVK EMRI)", number: "108" },
    heroTag:
      "Cardiac survival drops 10–15% every minute. We built a road that listens — 40–60% faster missions.",
    overview: [
      "The average city ambulance in India crawls at about 11 km/h in peak traffic — slower than a bicycle. For a cardiac arrest, that is fatal arithmetic: survival probability falls roughly 10–15% with every minute without restoration of flow. Bengaluru's Silicon Valley gridlocks routinely turn 15-minute runs into 50-minute ordeals.",
      "The AI Green Corridor flips the problem: instead of asking traffic to yield eventually, the ambulance broadcasts its route ahead and the road reorganises. A four-layer alert mesh — V2X 5G + cell broadcast, roadside Bluetooth mesh, FM-RDS break-in, and a smart adaptive siren as last resort — reaches connected cars, legacy cars and even phones in dead zones, 2 km ahead.",
      "On piloted routes the corridor shortens mission times by 40–60%: 65 minutes of gridlock becomes 42, and every saved minute is logged, timestamped and auditable. The demo below lets you run a live simulated mission from Hebbal to Tin Factory — watch which layer fires at each junction.",
    ],
    keyFacts: [
      { label: "Average ambulance speed in city traffic", value: "11", suffix: " km/h" },
      { label: "Cardiac survival drop per minute of delay", value: "10–15", suffix: "%" },
      { label: "Mission-time reduction with corridor", value: "40–60", suffix: "%" },
      { label: "Independent alert layers in the mesh", value: "4", suffix: "" },
      { label: "Advance warning distance (top layer)", value: "2", suffix: " km" },
    ],
    charts: [
      {
        title: "Journey minutes: with vs without corridor",
        desc: "Sample Bengaluru route under four traffic conditions — the corridor's edge grows with congestion.",
        type: "line",
        data: [
          { congestion: "Light", withoutCorridor: 22, withCorridor: 17 },
          { congestion: "Moderate", withoutCorridor: 34, withCorridor: 25 },
          { congestion: "Heavy", withoutCorridor: 48, withCorridor: 33 },
          { congestion: "Gridlock", withoutCorridor: 65, withCorridor: 42 },
        ],
        xKey: "congestion",
        nameKey: "congestion",
        valueKey: "withoutCorridor",
        colors: RED,
      },
      {
        title: "Alert-layer coverage radius (km)",
        desc: "Each layer covers a different fleet and terrain — together they leave almost no car unwarned.",
        type: "area",
        data: [
          { layer: "Siren", km: 0.3 },
          { layer: "BLE mesh", km: 0.8 },
          { layer: "V2X 5G", km: 2 },
          { layer: "FM-RDS", km: 5 },
        ],
        xKey: "layer",
        nameKey: "layer",
        valueKey: "km",
        colors: RED,
      },
    ],
    whyItMatters: [
      "The golden hour is not a metaphor: a blocked artery or bleeding brain has a countdown, and traffic is the most preventable delay in it.",
      "Emergency corridors in other countries are single-layer (lights and sirens). India's mixed traffic — connected cars, old cars, no cars — demands a layered mesh.",
      "Every minute saved also cuts fuel burn and secondary accidents caused by panic swerving; an organised corridor is safer for everyone.",
      "The system costs less than one ALS ambulance per kilometre covered — hardware is a ₹500 beacon and software on existing networks.",
      "Logged corridor events create India's first auditable dataset of pre-hospital delays — the evidence base city planners currently lack.",
    ],
    playbook: [
      {
        title: "Layer 1 — V2X 5G + cell broadcast",
        desc: "The ambulance's route broadcasts over 5G/4G V2X and cell broadcast: connected cars and nav apps (Google Maps-style alerts) reroute 2 km ahead. Highest capacity, needs connectivity.",
      },
      {
        title: "Layer 2 — roadside units + BLE mesh",
        desc: "₹500 Bluetooth beacons on poles hop the alert car-to-car with no internet at all. This is the layer that keeps working in floods, tunnels and network dead zones — designed for exactly the days when minutes matter most.",
      },
      {
        title: "Layer 3 — FM-RDS break-in",
        desc: "Legacy cars with FM systems receive a break-in alert on the broadcast band. Old-tech, near-universal reach, zero dependence on the car's intelligence.",
      },
      {
        title: "Layer 4 — smart adaptive siren",
        desc: "The last resort: a siren that adapts its pattern and direction, with approach lights at junctions. Replaces the panic-blare with a structured sound corridor.",
      },
      {
        title: "Run, log, improve",
        desc: "Every corridor event (segment, congestion, method, vehicles alerted, seconds saved) is logged and reviewed weekly — routes, beacon placement and layer priority are re-tuned from evidence, not opinions.",
      },
    ],
    dosDonts: {
      dos: [
        "Keep a 100 m clear lane habit when you hear any emergency siren — even without a corridor.",
        "Update your car's nav app; connected cars are the corridor's fastest responders.",
        "If you run a fleet, ask UAR about V2X integration for your drivers.",
        "Call 108 for real emergencies; the corridor coordinates with their dispatch.",
      ],
      donts: [
        "Don't chase or block ambulances for footage.",
        "Don't assume the siren alone will clear traffic — the mesh exists because it doesn't.",
        "Don't park in the narrow lanes of hospital approaches even 'for two minutes'.",
        "Don't break signals dangerously; corridor design accounts for disciplined slowdowns.",
      ],
    },
    mythsFacts: [
      {
        myth: "Green corridors require police at every junction.",
        fact: "Manual corridors need dozens of personnel per mission. The alert mesh automates clearance with zero police on most segments — police coordination remains for the hardest junctions.",
      },
      {
        myth: "Bluetooth alerts are unreliable.",
        fact: "BLE mesh is exactly the layer built for reliability: it needs no internet, no SIM and no network, hopping beacon-to-beacon through floods and dead zones where 4G fails.",
      },
      {
        myth: "Sirens are enough if people care.",
        fact: "Modern cabins insulate sound, music drowns alerts, and reaction distance shrinks at speed. Sirens still matter — as the fourth layer, not the first.",
      },
      {
        myth: "This tech is unaffordable for Indian cities.",
        fact: "The per-km hardware cost is lower than a single ALS ambulance. The expensive part of emergency care is arriving late; the corridor pays for itself in saved minutes.",
      },
    ],
    toolkit: [
      {
        title: "For citizens",
        items: [
          "Save 108 and 112 as favourites; teach the family.",
          "Enable nav-app alerts while driving in city corridors.",
          "Learn the 100 m clear-lane habit; practise at every siren.",
          "Report chronic blocker junctions to the UAR corridor desk.",
        ],
      },
      {
        title: "For societies & offices",
        items: [
          "Keep service-lane gates clear and labelled for ambulances.",
          "Nominate a floor warden for emergency-vehicle guidance.",
          "Host a 30-minute UAR corridor-awareness session.",
          "If on a pilot route, register parking-lot exits for beacon coverage.",
        ],
      },
      {
        title: "For fleet operators",
        items: [
          "V2X app integration for drivers on pilot corridors.",
          "Policy: yield-first culture, dashcams on, no phone calls during alerts.",
          "Share telematics (opted-in) to improve corridor timing models.",
        ],
      },
    ],
    faqs: [
      {
        q: "Is this a real deployed system or a concept?",
        a: "The four-layer architecture is being piloted on Bengaluru routes with partner ambulance services; the simulation on this page mirrors the real alert logic (congestion → method → timing) used in those pilots.",
      },
      {
        q: "What happens when there is no internet in the area?",
        a: "That is precisely why the BLE mesh exists — roadside beacons pass the alert vehicle-to-vehicle without any network. FM-RDS covers legacy cars and cell broadcast covers phones when towers are up.",
      },
      {
        q: "How much time is actually saved?",
        a: "Pilots show 40–60% reductions: gridlock segments alone give 30–45 seconds per segment, and a full corridor compounds that across 4–6 junctions — often 15–25 minutes on a cross-city mission.",
      },
      {
        q: "Does the corridor help only ambulances?",
        a: "The same mesh can carry fire-engine and police-protocol alerts, and the logged data helps city engineers fix chronic chokepoints for everyone.",
      },
      {
        q: "Can I volunteer or contribute hardware?",
        a: "Yes — volunteers run beacon installation and post-mission audits; sponsors fund beacons (₹500 each) and junction units. Write to care@unitedangelreach.org.",
      },
    ],
    links: [
      { label: "108 Ambulance service", href: "https://www.emri.in" },
      { label: "Bengaluru Traffic Police", href: "https://bengalurutrafficpolice.gov.in" },
      { label: "NIHSAD / road-safety research", href: "https://morth.nic.in" },
      { label: "Golden-hour cardiac science", href: "https://www.who.int/health-topics/cardiovascular-diseases" },
    ],
  },

  "ration-kits": {
    slug: "ration-kits",
    title: "QR-Coded Ration Kits",
    short:
      "₹950 buys a family 30 days of staples — and every kit is trackable from donor to table by QR.",
    accent: "emerald",
    icon: "package",
    helpline: { name: "National Consumer Helpline (PDS grievances)", number: "1915" },
    heroTag:
      "A QR code on every kit: donors see the family, the date, the photo — charity with a trail.",
    overview: [
      "India grows enough food for everyone, yet the FAO counts over 22 crore undernourished Indians. The failure is distribution: bottom-quartile urban families spend up to 62% of income on food, one bad month (illness, a job loss, a death back home) collapses nutrition instantly, and children absorb the first cut — dal disappears from the pot before rice does.",
      "The UAR ration kit is engineered for both honesty and nutrition: rice, atta, dal, oil, sugar, spices and hygiene items assembled by volunteers at wholesale rates — ₹950 buys a family of four a full month. Each kit unit carries a printed QR code (UAR-RK-YYYY-######) that a volunteer scans at the doorstep; family, location and photo are captured, and the donor's dashboard shows the exact scan event.",
      "The QR journey is also an audit trail: batches reconcile against scans monthly, leak-free by construction. A kit is not 'aid sent' — it is aid evidenced.",
    ],
    keyFacts: [
      { label: "One kit feeds a family of four", value: "30", suffix: " days" },
      { label: "Cost per kit", value: "₹950", suffix: "" },
      { label: "Families fed per ₹1 lakh", value: "105", suffix: "" },
      { label: "Undernourished Indians (FAO)", value: "22", suffix: " crore" },
      { label: "Bottom-quartile income spent on food", value: "62", suffix: "%" },
    ],
    charts: [
      {
        title: "Inside a ₹950 kit (cost breakdown, ₹)",
        desc: "Wholesale procurement assembled by volunteers — hygiene included, because dignity needs soap.",
        type: "pie",
        data: [
          { name: "Rice, dal & atta", value: 420 },
          { name: "Oil, sugar & spices", value: 140 },
          { name: "Dry vegetables & flour", value: 180 },
          { name: "Hygiene (soap, detergent)", value: 110 },
          { name: "Packing & QR", value: 100 },
        ],
        nameKey: "name",
        valueKey: "value",
        colors: EMERALD,
      },
      {
        title: "Share of income spent on food (%)",
        desc: "Why one bad month breaks nutrition: the poorest urban families spend nearly double the city average on food alone.",
        type: "bar",
        data: [
          { group: "Urban average household", share: 33 },
          { group: "Bottom-quartile family", share: 62 },
        ],
        xKey: "group",
        nameKey: "group",
        valueKey: "share",
        colors: EMERALD,
      },
    ],
    whyItMatters: [
      "Hunger in cities is income volatility, not scarcity — a 30-day kit converts a crisis month into a manageable one.",
      "Children eat last and least: kit-level support measurably reduces 'dal-cut weeks' that stall growth and schooling.",
      "Food inflation hits staples hardest; wholesale procurement stretches a donor rupee roughly 40% further than retail.",
      "QR evidence changes donor behaviour: people give again when they can see the family, date and photo — repeat giving is 3×.",
      "Zero-leak design protects the sector's credibility: every batch reconciles against scans, and every scan is a receipt.",
    ],
    playbook: [
      {
        title: "Donate a kit (₹950)",
        desc: "One button, one family, one month. UAR batch-purchases staples wholesale — your ₹950 buys what would cost ₹1,300+ at retail.",
      },
      {
        title: "Volunteers assemble the batch",
        desc: "Monthly assembly days at UAR hubs: schools, corporate CSR teams and volunteers weigh, pack and label. Each unit gets its printed QR — UAR-RK-YYYY-######.",
      },
      {
        title: "Doorstep scan at distribution",
        desc: "The volunteer scans the QR at the family's door: family consent, location, timestamp and photo are captured in seconds — even without network, syncing later.",
      },
      {
        title: "Donor sees the scan event",
        desc: "Your dashboard shows the scan: which family, when, where. The beneficiary receives an SMS in Kannada/English with the kit contents and the volunteer's name.",
      },
      {
        title: "Monthly audit — zero-leak reconciliation",
        desc: "Batches vs scans, inventory vs distributions: the books close with every unit accounted for. Exceptions (damaged, expired) are logged and replaced, never quietly absorbed.",
      },
    ],
    dosDonts: {
      dos: [
        "Give monthly — families plan around predictable kits, not surprise feasts.",
        "Respect beneficiaries' consent for photos; no faces without permission.",
        "Include hygiene items; soap is nutrition's quiet partner.",
        "Volunteer one assembly day — it converts donors into lifers.",
      ],
      donts: [
        "Don't dump near-expiry stock into kits — families are not waste bins.",
        "Don't photograph children for 'impact posts' without consent.",
        "Don't bypass the QR 'to save time' — the scan IS the programme.",
        "Don't create dependency: pair kits with skilling/livelihood referrals.",
      ],
    },
    mythsFacts: [
      {
        myth: "India produces enough food, so hunger is exaggerated.",
        fact: "Production and plate-access are different problems. Over 22 crore Indians remain undernourished (FAO) because poverty, inflation and shocks break last-mile access.",
      },
      {
        myth: "Cash is always better than kits.",
        fact: "Cash works in functioning markets; in shock months (illness, debt collection, festivals) cash is often pre-committed. Kits guarantee nutrition floors — the best programmes layer both.",
      },
      {
        myth: "₹950 can't really feed a family for a month.",
        fact: "At wholesale rates with volunteer assembly, it can — staples per the kit sheet, not a luxury diet. The QR receipt lists exact weights so you can price-check.",
      },
      {
        myth: "Aid gets stolen anyway.",
        fact: "The QR journey makes theft visible: units reconcile against doorstep scans monthly. Leakage in UAR's design is not a risk to manage but a number that would immediately show.",
      },
    ],
    toolkit: [
      {
        title: "Host an assembly day",
        items: [
          "20 people × 3 hours ≈ 400 kits assembled and QR-labelled.",
          "Order wholesale 2 weeks ahead; confirm weights on the kit sheet.",
          "Assign one person only to QR printing/affixing — accuracy matters.",
          "Photograph the line (not faces) for your CSR report.",
        ],
      },
      {
        title: "Adopt a lane",
        items: [
          "Pick 25 families in one ward — quarterly consistency beats random drops.",
          "One volunteer 'lane captain' keeps the relationships and records needs.",
          "Pair kits with school-supply or skilling referrals every second visit.",
        ],
      },
      {
        title: "Give smarter",
        items: [
          "₹950 = 1 family-month; ₹9,500 = 1 lane-month.",
          "Corporate match: 50 employees × ₹500 = 26 kits/month.",
          "Gift a kit on birthdays — scan receipts make honest gifts.",
        ],
      },
    ],
    faqs: [
      {
        q: "What exactly is inside the ₹950 kit?",
        a: "Rice, atta, dal, cooking oil, sugar, salt, spices, dry vegetables and hygiene items (soap, detergent) — itemised on the QR receipt so you can verify weights and prices yourself.",
      },
      {
        q: "How do you choose beneficiary families?",
        a: "Ward-level surveys with volunteers and anganwadi/AWW referrals, prioritising daily-wage, single-parent, elderly-led and disability-affected households. Lists are re-verified quarterly.",
      },
      {
        q: "What if I donate but the QR is never scanned?",
        a: "You'd see it — and so would our audit. Unscanned units are investigated and replaced from the next batch. The dashboard shows your kit's journey end-to-end.",
      },
      {
        q: "Can I sponsor a specific lane or community?",
        a: "Yes — 'adopt a lane' lets you cover 25 families monthly with a named volunteer captain and quarterly impact notes.",
      },
      {
        q: "Are kits only for Bengaluru?",
        a: "Hub assembly is Bengaluru-first; partner-lane distribution already reaches families beyond the city, and the playbook is designed for replication anywhere in India.",
      },
    ],
    links: [
      { label: "FAO — State of Food Security", href: "https://www.fao.org/publications/sofi" },
      { label: "National Food Security Act", href: "https://nfsa.gov.in" },
      { label: "National Consumer Helpline 1915", href: "https://consumerhelpline.gov.in" },
      { label: "UN WFP India", href: "https://www.wfp.org/countries/india" },
    ],
  },

  "sanitary-pads": {
    slug: "sanitary-pads",
    title: "Sanitary Pads & Menstrual Health",
    short:
      "₹18 per pad keeps a girl in school — pad banks, awareness sessions, and zero shame on the timetable.",
    accent: "pink",
    icon: "flower-2",
    helpline: { name: "Women & Girls Helpline (Sakhi)", number: "181" },
    heroTag:
      "Nearly 23 million girls drop out of school each year — periods are a leading, preventable reason.",
    overview: [
      "The research is blunt: about 63% of girls in India miss school during their periods, and roughly 23 million drop out of education every year with menstruation cited among the leading reasons (Dasra, 'Spot On'). Many manage with cloth, ash or nothing; 71% had never heard of a period before their first one. A ₹18 pad is not a comfort purchase — it is school attendance, exam performance and dignity.",
      "UAR's pad-bank model puts supply where shame lives: a locked cabinet in the school with free access (a girl prefect holds the key), two awareness sessions a year (one for girls, one for boys — myths die in mixed rooms), and safe-disposal incinerators. ₹18,000 covers a 120-girl school for a full year, pads and sessions included.",
      "The results schools report back are consistent: fewer period-absence days, fewer infections from cloth reuse, and — the quiet metric — girls who stop hiding their notebook-stuffed waistbands on pad days.",
    ],
    keyFacts: [
      { label: "Girls who miss school during periods", value: "63", suffix: "%" },
      { label: "School dropouts linked to menstruation", value: "23", suffix: " million girls/yr" },
      { label: "Girls unaware of periods before first one", value: "71", suffix: "%" },
      { label: "Girls using cloth or unsafe alternatives", value: "35", suffix: "%" },
      { label: "UAR cost per school per year", value: "₹18,000", suffix: "" },
    ],
    charts: [
      {
        title: "The period tax on education (% of girls)",
        desc: "DASRA / NSS-pattern studies — absence compounds into dropout, one week a month.",
        type: "bar",
        data: [
          { group: "Miss school during periods", share: 63 },
          { group: "Miss 2+ days a month", share: 26 },
          { group: "Use cloth/unsafe alternatives", share: 35 },
          { group: "Unaware before first period", share: 71 },
        ],
        xKey: "group",
        nameKey: "group",
        valueKey: "share",
        colors: PINK,
      },
      {
        title: "Where the ₹18,000 goes (one school-year)",
        desc: "A 120-girl pad bank: supplies, two awareness sessions and disposal — fully audited.",
        type: "pie",
        data: [
          { name: "Pads (year-round)", value: 11000 },
          { name: "Awareness sessions ×2", value: 4000 },
          { name: "Safe disposal & bins", value: 3000 },
        ],
        nameKey: "name",
        valueKey: "value",
        colors: PINK,
      },
    ],
    whyItMatters: [
      "Absence is cumulative: one week a month of missed school becomes a year of lost instruction by class 10 — dropout follows absence like a shadow.",
      "Cloth reuse without washing/drying facilities causes reproductive-tract infections that go untreated for years.",
      "Awareness sessions that include boys halve the teasing that drives girls to hide, skip and eventually stop.",
      "A girl who stays in school marries later, earns more, and vaccinates her children — pad economics is intergenerational.",
      "Pad banks normalise asking: the free, shame-free supply is also a counselling door for deeper problems.",
    ],
    playbook: [
      {
        title: "Adopt a school (₹18,000/yr)",
        desc: "Covers a 120-girl pad bank for 12 months plus two awareness sessions. Individual donors pool; CSR sponsors whole schools with naming (if the school agrees).",
      },
      {
        title: "Install the pad bank",
        desc: "A locked, labelled cabinet in the girls' washroom, stocked monthly. A trained girl-prefect holds the key — free two pads, no questions, no register of 'needy' names.",
      },
      {
        title: "Run the awareness arc",
        desc: "Session 1 (girls): anatomy, hygiene, cycle-tracking, cloth-vs-pad myths. Session 2 (boys): what periods are, what teasing costs, how to be decent. Teachers sit in both.",
      },
      {
        title: "Close the disposal loop",
        desc: "Incinerator or sanitary bins with the municipality's waste partner. Disposal failure is the #1 reason schools quietly stop pad programmes — we budget it from day one.",
      },
      {
        title: "Track, report, repeat",
        desc: "Pads used, absence notes before/after, an anonymous feedback box, and a termly report to the sponsor. The programme earns its renewal with numbers, not sentiment.",
      },
    ],
    dosDonts: {
      dos: [
        "Say the word 'period' normally — euphemisms teach shame.",
        "Include boys in awareness; silence is where mockery grows.",
        "Stock pads in staff rooms too — female teachers skip school for the same reason.",
        "Budget disposal with the same seriousness as supply.",
      ],
      donts: [
        "Don't make girls sign a register to 'prove need' — privacy is the design.",
        "Don't run one-and-done sessions; the arc needs a second year to stick.",
        "Don't hand out pads publicly in assembly — the whole point is dignity.",
        "Don't sell myths (hot water cures cramps, exercise is forbidden) — teach physiology.",
      ],
    },
    mythsFacts: [
      {
        myth: "Menstruating girls are impure and shouldn't enter kitchens/temples.",
        fact: "Menstruation is a normal biological cycle. Purity taboos have no basis in physiology and are a primary driver of school absence and infection.",
      },
      {
        myth: "Cloth is as good as pads if washed properly.",
        fact: "Cloth can be safe with hot washing and sunlight drying — but in urban slums and hostels, drying privacy and water access make that unreliable. Pads remove the variables.",
      },
      {
        myth: "Periods make girls weak and unable to study.",
        fact: "There is no cognitive effect from menstruation; the deficit comes from pain without information, and absence without supplies.",
      },
      {
        myth: "Free pads make girls dependent.",
        fact: "A pad bank is infrastructure, like a water fountain. Attendance data from pad-bank schools shows the opposite: retention rises.",
      },
    ],
    toolkit: [
      {
        title: "Pad-bank starter checklist",
        items: [
          "Locked cabinet, labelled, in the girls' washroom — key with girl-prefect.",
          "Monthly stock count; re-order at 20% remaining.",
          "Anonymous feedback slip-box beside the bank.",
          "Termly absence-notes comparison (before vs after).",
        ],
      },
      {
        title: "Awareness session kit",
        items: [
          "Uterus model + cycle wall chart (Kannada/English).",
          "Myth-vs-fact cards; anatomy quiz with prizes.",
          "Hygiene demo: washing, drying, disposal.",
          "Boys' session script: periods 101 + bystander pledges.",
        ],
      },
      {
        title: "Sponsor a school — what you get",
        items: [
          "Named report: pads distributed, sessions held, absence delta.",
          "Photos (with consent) of the pad bank, never of faces.",
          "Termly call with the school's nodal teacher.",
          "80G receipt for the full ₹18,000.",
        ],
      },
    ],
    faqs: [
      {
        q: "Why a 'pad bank' instead of giving pads in packets?",
        a: "Dignity and reliability. A bank in the washroom means no girl must ask, plan or carry — supply meets need exactly when it occurs, and no one is publicly labelled.",
      },
      {
        q: "What if a school refuses mixed (boys) awareness sessions?",
        a: "We start with girls' sessions and return each term with evidence until the school agrees. Boys' sessions are the programme's long-term culture fix, but we never make girls wait for them.",
      },
      {
        q: "How is ₹18 per pad possible?",
        a: "Bulk government-standard procurement: pads at ₹6–8 per unit wholesale, distributed at a fully-loaded cost of ~₹18 including storage and logistics.",
      },
      {
        q: "Do you support menstrual-health questions beyond pads?",
        a: "Yes — sessions cover PCOS awareness, pain management basics, and when to see a doctor; 181 connects girls to counselling where needed.",
      },
      {
        q: "Can I sponsor one girl instead of a school?",
        a: "Pooled sponsorship is how the model stays shame-free — but you can sponsor a school's month (₹1,500) and receive its termly report.",
      },
    ],
    links: [
      { label: "Dasra — Spot On report", href: "https://www.dasra.org" },
      { label: "Menstrual Hygiene Scheme (MoHFW)", href: "https://nhm.gov.in" },
      { label: "Menstrual Hygiene Day", href: "https://menstrualhygieneday.org" },
      { label: "Sakhi One-Stop Centres", href: "https://wcd.gov.in" },
    ],
  },
};

export const CAMPAIGN_SLUGS = Object.keys(CAMPAIGN_CONTENT);
