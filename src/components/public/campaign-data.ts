/**
 * ============================================================
 * UNITED ANGEL REACH — PUBLIC CONTENT CORE (campaign-data.ts)
 * ============================================================
 * Single source of truth for all 9 public programme pages.
 * Imported ONLY via `CAMPAIGN_CONTENT` by the 5 public-site
 * components: layout, home, campaigns, campaign-detail, donate.
 *
 * RULES
 * - Pure data + types file. NO imports of any kind.
 * - Keys are the campaign slugs and MUST match the DB
 *   `campaign.slug` values exactly.
 * - Accent must exist in shared.tsx ACCENT_MAP:
 *   orange | cyan | fuchsia | amber | teal | lime | red | emerald | pink
 * - Icon is a lucide-react icon name.
 * - Helplines are OFFICIAL India numbers only:
 *   112 · 108 · 1930 · 181 · 1091 · 1098 · 14446 · 14416 · 1933 · 1962
 * - Chart data arrays carry plain numeric values; `nameKey` names
 *   each slice/point, `valueKey` holds the number, optional `xKey`
 *   orders line/area charts.
 * ============================================================ */

/* ============================================================
 * Shared chart palettes (per-accent, light→dark ramps).
 * ============================================================ */
const ORANGE = ["#f97316", "#fb923c", "#fdba74", "#ffedd5"];
const CYAN = ["#06b6d4", "#22d3ee", "#67e8f9", "#cffafe"];
const FUCHSIA = ["#d946ef", "#e879f9", "#f0abfc", "#fae8ff"];
const AMBER = ["#f59e0b", "#fbbf24", "#fcd34d", "#fef3c7"];
const TEAL = ["#14b8a6", "#2dd4bf", "#5eead4", "#ccfbf1"];
const LIME = ["#84cc16", "#a3e635", "#bef264", "#ecfccb"];
const RED = ["#ef4444", "#f87171", "#fca5a5", "#fee2e2"];
const EMERALD = ["#10b981", "#34d399", "#6ee7b7", "#d1fae5"];
const PINK = ["#ec4899", "#f472b6", "#f9a8d4", "#fce7f3"];

/* ============================================================
 * PUBLIC SHAPE — the 5 consumers depend on this EXACTLY.
 * ============================================================ */
export interface CampaignContent {
  slug: string;
  title: string;
  heroTag: string;
  accent: string; // orange|cyan|fuchsia|amber|teal|lime|red|emerald|pink (must exist in shared ACCENT_MAP)
  icon: string; // lucide icon name
  helpline?: string;
  overview: string[]; // 2-3 rich paragraphs, rendered via .map
  keyFacts: { value: string; suffix?: string; label: string }[]; // 4-6; first renders col-span-2
  charts: {
    title: string;
    desc?: string;
    type: "bar" | "pie" | "line" | "area";
    data: Record<string, unknown>[];
    xKey?: string;
    nameKey: string;
    valueKey: string;
    colors?: string[];
  }[]; // 2-3 per campaign, real India-context datasets
  whyItMatters: string[]; // 4-5 bullets
  playbook: { title: string; desc: string }[]; // 5-7 steps (field-tested guidance)
  dosDonts: { dos: string[]; donts: string[] };
  mythsFacts: { myth: string; fact: string }[]; // 3-4
  toolkit: { title: string; items: string[] }[]; // 2-3 interactive checklist groups
  faqs: { q: string; a: string }[]; // 4-6
  links: { label: string; href: string }[]; // official gov / institutional links
}

/* ============================================================
 * CAMPAIGN CONTENT
 * ============================================================ */
export const CAMPAIGN_CONTENT: Record<string, CampaignContent> = {
  /* ------------------------------------------------------------
   * 1) ANTI-DRUG — Sankalp Against Substance
   * ------------------------------------------------------------ */
  "anti-drug": {
    slug: "anti-drug",
    title: "Anti-Drug Awareness & Recovery",
    heroTag:
      "Addiction is an illness, not a character flaw. Sankalp walks with you from the first honest conversation to a full year of recovery support.",
    accent: "orange",
    icon: "shield-alert",
    helpline: "14446",
    overview: [
      "India has roughly 16 crore people who use alcohol, 3.1 crore cannabis users and 2.1 crore opioid users (Ministry of Social Justice & Empowerment, national survey). Behind every number is a family navigating fear, shame and confusion. Sankalp Against Substance exists to replace that silence with science: substance dependence is a chronic, relapsing medical condition of the brain's reward circuitry — as treatable as diabetes or hypertension, and never a verdict on a person's worth.",
      "Our Bengaluru teams run school and college awareness sessions, confidential screening camps, workplace peer-support programmes and street-corner outreach in high-vulnerability wards. When someone is ready, we hand-hold the referral into professional care — NIMHANS Bengaluru, district de-addiction centres and Tele-MANAS counsellors — and then stay: family counselling, monthly follow-ups and reintegration support for a full 12 months after treatment begins.",
      "The law is designed to protect recovery, not punish it. Under the NDPS Act 1985, Section 64A grants immunity from prosecution for consumption to addicts who voluntarily seek treatment; Section 27 deals with personal consumption separately from trafficking, which is pursued by the Narcotics Control Bureau (report on 1933). The national 14446 de-addiction helpline runs 24×7, and Nasha Mukt Bharat Abhiyaan now reaches 372 districts — including every Bengaluru zone we serve.",
    ],
    keyFacts: [
      {
        value: "16 Cr",
        label: "Indians use alcohol — with 3.1 Cr cannabis and 2.1 Cr opioid users (MoSJE national survey)",
      },
      {
        value: "14446",
        label: "24×7 national de-addiction helpline — free, anonymous, in your language",
      },
      {
        value: "70%+",
        label: "of people with substance dependence never receive any treatment — the gap Sankalp exists to close",
      },
      {
        value: "Sec 64A",
        label: "NDPS Act 1985: voluntary treatment grants immunity from prosecution for consumption",
      },
      {
        value: "372",
        label: "districts covered by Nasha Mukt Bharat Abhiyaan, including all Bengaluru zones",
      },
      {
        value: "12",
        suffix: "months",
        label: "of follow-up support — because the first year of recovery is when relapse risk peaks",
      },
    ],
    charts: [
      {
        title: "Who is affected in India",
        desc: "Estimated users by substance, in crore (10 million). Alcohol dominates the burden (MoSJE, 2019).",
        type: "bar",
        data: [
          { name: "Alcohol", usersCr: 16 },
          { name: "Cannabis", usersCr: 3.1 },
          { name: "Opioids", usersCr: 2.1 },
          { name: "Sedatives", usersCr: 1.2 },
        ],
        nameKey: "name",
        valueKey: "usersCr",
        colors: ORANGE,
      },
      {
        title: "The help-seeking funnel",
        desc: "For every 100 people living with dependence, how many actually get care — the treatment gap in one picture.",
        type: "bar",
        data: [
          { stage: "Living with dependence", people: 100 },
          { stage: "Recognise the problem", people: 60 },
          { stage: "Reach out for help", people: 18 },
          { stage: "Stay in structured care", people: 8 },
        ],
        nameKey: "stage",
        valueKey: "people",
        colors: ORANGE,
      },
      {
        title: "Recovery rewards persistence",
        desc: "Share of patients retained in outpatient care by month — consistent drop-offs show exactly where families need us most.",
        type: "line",
        data: [
          { month: "1", retained: 100 },
          { month: "3", retained: 68 },
          { month: "6", retained: 52 },
          { month: "9", retained: 45 },
          { month: "12", retained: 41 },
        ],
        xKey: "month",
        nameKey: "month",
        valueKey: "retained",
        colors: ORANGE,
      },
    ],
    whyItMatters: [
      "India's treatment gap for dependence exceeds 70% — most people who need care never reach a counsellor, a doctor or a helpline.",
      "Early use is the strongest predictor of lifelong dependence: prevention in class 8–10 changes entire trajectories.",
      "Recovery is medical. Detox from alcohol and sedatives without supervision can be life-threatening — guidance matters from day one.",
      "One person's recovery stabilises a whole household: finances, schooling, safety and mental health all improve together.",
      "Section 64A means the law protects people who choose treatment — fear of police should never delay help.",
    ],
    playbook: [
      {
        title: "Spot the early signs",
        desc: "Watch for red eyes and dilated pupils, erratic sleep, sudden money shortages, missing medicines at home, new secretive friend circles and falling grades or work output. One sign is a question; three together are a conversation.",
      },
      {
        title: "Open the door, not a trial",
        desc: "Choose a calm, private moment. Lead with care: 'I've noticed you seem exhausted lately — I'm on your side.' Never begin with accusations, threats or moral lectures; shame is the strongest glue of addiction.",
      },
      {
        title: "Call 14446 — tonight, not someday",
        desc: "The national de-addiction helpline (14446) is free, confidential and runs 24×7. Trained counsellors will assess urgency, explain options and can connect you to Tele-MANAS (14416) for ongoing tele-counselling.",
      },
      {
        title: "Get a professional assessment",
        desc: "Within the first week, book an evaluation at NIMHANS Bengaluru (Service for Healthy Use of Substances), a district de-addiction centre, or a trusted psychiatrist. Screening takes under an hour and turns fear into a plan.",
      },
      {
        title: "Begin supervised detox & counselling",
        desc: "Follow the doctor's plan: medication-assisted detox where needed, then counselling — motivational therapy, CBT or group support. For alcohol and benzodiazepines, NEVER quit cold turkey without medical supervision; withdrawal can cause seizures.",
      },
      {
        title: "Make the family part of the medicine",
        desc: "Two family members attend every counselling block. Learn what enabling looks like (paying debts, covering up), what support looks like (routine, transport to sessions, no alcohol at home), and how to handle a slip calmly.",
      },
      {
        title: "Guard against relapse for 12 months",
        desc: "Relapse is a data point, not a failure. Keep monthly check-ins with the Sankalp volunteer, build a 3-person emergency contact circle, identify high-risk triggers (payday, festivals, old friend groups) and have a rehearsed exit plan for each.",
      },
    ],
    dosDonts: {
      dos: [
        "Use person-first language — 'person with substance use disorder', never 'addict' or 'junkie'.",
        "Keep conversations short, kind and repeated; one honest talk per month beats one explosive intervention.",
        "Lock away and count household medicines and alcohol; remove easy access during vulnerable phases.",
        "Report drug trafficking or sale near schools to the Narcotics Control Bureau MANAS line — 1933.",
        "Encourage harm reduction while recovery is being planned: safer routines, medical check-ups, no using alone.",
      ],
      donts: [
        "Don't try to detox someone from alcohol or sedatives at home — unsupervised withdrawal can be fatal.",
        "Don't buy 'quick cure' courses from online sellers or unlicensed 'rehab' ashrams with no doctors.",
        "Don't bribe, threaten or publicise the problem to relatives as leverage — it deepens secrecy.",
        "Don't hand over money when asked; offer food, transport to a clinic, or time together instead.",
        "Don't give up after a relapse — most people need several attempts before recovery sticks.",
      ],
    },
    mythsFacts: [
      {
        myth: "Addiction is a weakness of character — people just need willpower.",
        fact: "Dependence is a recognised chronic brain condition listed by WHO. Willpower helps, but structured treatment, counselling and follow-up are what actually produce recovery.",
      },
      {
        myth: "Seeking treatment means a police case.",
        fact: "Section 64A of the NDPS Act grants immunity from prosecution for consumption to those who voluntarily seek treatment — the system is built to reward recovery, not punish it.",
      },
      {
        myth: "Only 'hard drugs' like heroin are dangerous.",
        fact: "Alcohol causes the largest harm burden in India, and misuse of cough syrups, painkillers and sedatives is rising fast. Legal does not mean safe.",
      },
      {
        myth: "One relapse means treatment failed.",
        fact: "Relapse rates for dependence are comparable to asthma or diabetes — it signals the plan needs adjusting, not that recovery is impossible.",
      },
    ],
    toolkit: [
      {
        title: "Recognise the signs",
        items: [
          "Physical: red eyes, dilated or pinpoint pupils, trembling hands, sudden weight change",
          "Behavioural: secretive calls, new coded language, sleeping through the day, selling belongings",
          "Social: abandoned hobbies, changed friend circle, avoiding family meals",
          "Money: frequent small borrowings, missing cash, unexplained ATM withdrawals",
          "Work/study: late attendance, falling output, disciplinary notes in a previously clean record",
        ],
      },
      {
        title: "Start the conversation",
        items: [
          "Pick a private, sober, unhurried moment — never mid-argument or in front of others",
          "Open with observation + care: 'You haven't seemed yourself for weeks. I'm worried because I love you.'",
          "Listen for the feeling under the answer — stress, loneliness, pain are usually the real drivers",
          "Offer one concrete next step, not a lecture: 'Shall we call 14446 together right now?'",
          "End every conversation with the door open, even if it ended in refusal",
        ],
      },
      {
        title: "Family safety net",
        items: [
          "Save 14446 (de-addiction, 24×7) and 14416 (Tele-MANAS) in every family phone",
          "Report trafficking or sale near schools on 1933 (NCB MANAS)",
          "Locate your nearest de-addiction centre / NIMHANS clinic before an emergency exists",
          "Agree a family code word that means 'I need help now' with zero questions asked",
          "Keep one envelope per person: ID copy, prescription list, insurance — for a fast clinic visit",
        ],
      },
    ],
    faqs: [
      {
        q: "Is calling 14446 really anonymous? Will it be reported to the police?",
        a: "Yes, it is confidential. 14446 is a support helpline run for de-addiction counselling — calls are not forwarded to law enforcement. Seeking help is protected under Section 64A of the NDPS Act.",
      },
      {
        q: "Can someone be forced into treatment?",
        a: "Involuntary admission is possible only through specific legal provisions and medical certification. In practice, treatment works far better when the person consents — our playbook is designed to build that consent.",
      },
      {
        q: "How much does de-addiction treatment cost?",
        a: "Government de-addiction centres and NIMHANS Bengaluru offer treatment at nominal cost, 14446 and Tele-MANAS (14416) counselling is free, and UAR helps eligible families navigate subsidised care end-to-end.",
      },
      {
        q: "We suspect a class 9 student is using drugs. Should the school be told?",
        a: "Approach the school counsellor confidentially — schools must respond supportively, not punitively. Our child-safe facilitators can run an awareness session without singling anyone out. Call 14446 for guidance first.",
      },
      {
        q: "What is the difference between 14446, 14416 and 1933?",
        a: "14446 is the national de-addiction helpline for substance use; 14416 is Tele-MANAS for mental-health crises including addiction-related distress; 1933 is the NCB MANAS line to report drug trafficking.",
      },
    ],
    links: [
      { label: "Nasha Mukt Bharat Abhiyaan — Ministry of Social Justice", href: "https://nmba.mohfw.gov.in" },
      { label: "Tele-MANAS — national tele-mental-health (14416)", href: "https://telemanas.mohfw.gov.in" },
      { label: "NIMHANS Bengaluru — de-addiction services", href: "https://nimhans.ac.in" },
      { label: "Narcotics Control Bureau — report trafficking (1933)", href: "https://ncb.gov.in" },
      { label: "Ministry of Social Justice & Empowerment — national survey & schemes", href: "https://socialjustice.gov.in" },
    ],
  },

  /* ------------------------------------------------------------
   * 2) CYBER-CRIME — CyberSuraksha
   * ------------------------------------------------------------ */
  "cyber-crime": {
    slug: "cyber-crime",
    title: "Cyber Fraud Prevention & Response",
    heroTag:
      "The golden hour decides everything: call 1930 within 60 minutes and the money trail can be frozen before it disappears.",
    accent: "cyan",
    icon: "smartphone",
    helpline: "1930",
    overview: [
      "Cyber frauds drained over ₹22,800 crore from Indians in 2024 (I4C, Ministry of Home Affairs), and Bengaluru consistently reports among the highest complaint volumes in the country — hundreds of cases every single day. The scammers are professional operations: scripted calls, fake police ID cards on video calls, cloned bank websites and Telegram channels selling 'guaranteed returns'. Anyone can be targeted — students, homemakers, retired officers, software engineers.",
      "CyberSuraksha is UAR's public armour: plain-language workshops in apartment complexes, schools, senior-citizen forums and basti digital-literacy drives; plus a victim-assistance desk where our trained volunteers help you file the complaint correctly on cybercrime.gov.in, escalate on Chakshu (sancharsaathi.gov.in) and follow up until the acknowledgment arrives.",
      "One rule outranks everything: speed. Money stolen through UPI and net-banking is layered across mule accounts within minutes. The 1930 helpline and the cybercrime.gov.in portal can freeze the trail — but only if you call within the first hour. Saving these two contacts in your phone today may be the most valuable cybersecurity investment you ever make.",
    ],
    keyFacts: [
      {
        value: "60",
        suffix: "minutes",
        label: "the golden hour — call 1930 immediately after the fraud to freeze the money trail",
      },
      {
        value: "₹22,845 Cr",
        label: "lost by Indians to cyber frauds in 2024 (I4C, Ministry of Home Affairs)",
      },
      {
        value: "₹0",
        label: "the amount a genuine bank, RBI official or policeman will ever ask you to 'transfer for verification'",
      },
      {
        value: "No arrest by video call",
        label: "digital arrest is not a real procedure — no agency in India arrests anyone over a video call",
      },
      {
        value: "Chakshu",
        label: "report fraudulent calls, SMS and SIMs on sancharsaathi.gov.in — it gets numbers disconnected",
      },
      {
        value: "1909",
        label: "the national DND/SPAM registry — register to silence marketing spam at the source",
      },
    ],
    charts: [
      {
        title: "Where the money leaks",
        desc: "Share of online financial-fraud complaints by category — UPI misuse dominates (indicative mix, I4C/NCRB patterns).",
        type: "pie",
        data: [
          { name: "UPI & QR frauds", share: 47 },
          { name: "Investment / task scams", share: 18 },
          { name: "Digital arrest & impersonation", share: 14 },
          { name: "Instant-loan app harassment", share: 9 },
          { name: "Others", share: 12 },
        ],
        nameKey: "name",
        valueKey: "share",
        colors: CYAN,
      },
      {
        title: "Every minute costs money",
        desc: "Approximate share of stolen funds recoverable when reporting to 1930 — report within the golden hour.",
        type: "line",
        data: [
          { window: "0–60 min", recoverable: 80 },
          { window: "1–6 hrs", recoverable: 45 },
          { window: "6–24 hrs", recoverable: 20 },
          { window: "24 hrs+", recoverable: 5 },
        ],
        xKey: "window",
        nameKey: "window",
        valueKey: "recoverable",
        colors: CYAN,
      },
      {
        title: "Bengaluru's daily battle",
        desc: "New cyber-fraud complaints filed per day in Bengaluru — the curve only steepens year on year (City Police cyber cell, indicative).",
        type: "bar",
        data: [
          { year: "2020", complaints: 60 },
          { year: "2021", complaints: 110 },
          { year: "2022", complaints: 180 },
          { year: "2023", complaints: 260 },
          { year: "2024", complaints: 320 },
        ],
        nameKey: "year",
        valueKey: "complaints",
        colors: CYAN,
      },
    ],
    whyItMatters: [
      "Money reported within the first 60 minutes has a real chance of being frozen; after 24 hours it is almost always gone.",
      "Scams are engineered by organised syndicates with call centres and scripts — embarrassment is what they depend on; reporting breaks their business model.",
      "Seniors and first-time smartphone users are the fastest-growing victim groups in Bengaluru — one family workshop protects dozens.",
      "Fraud is a crime, not a personal failure: filing a complaint creates the paper trail banks, RBI and courts require.",
      "Every complaint on cybercrime.gov.in feeds I4C's pattern database — your report helps block the same gang for thousands of others.",
    ],
    playbook: [
      {
        title: "If money just left your account — the first 10 minutes",
        desc: "Call 1930 immediately (24×7). Give the transaction ID, amount, time and the UPI/mobile number you paid to. Simultaneously call your bank's fraud line to block cards and request a hold on the transaction.",
      },
      {
        title: "File the formal complaint within 24 hours",
        desc: "Go to cybercrime.gov.in → 'Report Financial Fraud' (or report other cybercrimes under 'Report Other Cybercrime'). Save screenshots of chats, payment confirmations, caller numbers, profile links — before deleting anything.",
      },
      {
        title: "Kill the scammer's reach",
        desc: "Report the fraud number on Chakshu at sancharsaathi.gov.in so the SIM gets disconnected, and register on 1909 to cut marketing spam. If SIM-swap is suspected, get the SIM blocked instantly and reissued.",
      },
      {
        title: "Recognise the six big Bengaluru scams",
        desc: "Digital arrest videos, UPI 'receive money' PIN requests, KYC-expiry calls, video-call sextortion, Telegram task/investment groups and instant-loan apps with threat calls. If you can name the script, you can refuse it.",
      },
      {
        title: "Harden your phone in 15 minutes",
        desc: "Set transaction limits on UPI, enable app-lock on payment apps, turn off 'install unknown apps', review permissions of every app monthly, and keep separate UPI handles for receiving versus paying.",
      },
      {
        title: "Brief the family — especially seniors",
        desc: "One dinner-table drill: nobody shares OTPs, nobody 'verifies' via a video call, nobody transfers on fear. Put 1930 and cybercrime.gov.in as a shortcut on the phones of parents and grandparents.",
      },
      {
        title: "Follow up until closure",
        desc: "Track the acknowledgment number on cybercrime.gov.in, keep the bank dispute reference alive, and escalate to the banking ombudsman (cms.rbi.org.in) if the bank delays. UAR's victim desk can walk you through each step.",
      },
    ],
    dosDonts: {
      dos: [
        "Call 1930 within 60 minutes of any fraudulent transaction — speed is the whole game.",
        "Preserve all evidence: screenshots, call logs, SMS, emails, transaction IDs, links.",
        "Verify every 'bank official' by hanging up and calling the number printed on your card or passbook.",
        "Use Chakshu (sancharsaathi.gov.in) to report fake numbers and get them disconnected.",
        "Set daily UPI transaction limits and enable transaction alerts for every account.",
      ],
      donts: [
        "Don't ever enter a PIN or OTP to 'receive' money — receiving never needs your PIN.",
        "Don't stay on a video call with 'police/customs/CBI' — no agency conducts digital arrest.",
        "Don't download screen-sharing or remote-access apps for anyone who calls you.",
        "Don't join 'earning by liking videos' Telegram groups or pay 'release fees' for prize winnings.",
        "Don't delete chats out of embarrassment — evidence is your leverage.",
      ],
    },
    mythsFacts: [
      {
        myth: "It was partly my mistake, so the police won't help.",
        fact: "Cyber fraud is a crime against you regardless. 1930 and cybercrime.gov.in exist precisely for victims — thousands of crores have been frozen because people reported without shame.",
      },
      {
        myth: "I need to enter my UPI PIN to receive money.",
        fact: "Receiving money NEVER requires a PIN or OTP. Any 'collect request' asking for one is a withdrawal in disguise — decline it.",
      },
      {
        myth: "Only gullible or elderly people get scammed.",
        fact: "Doctors, engineers and police officers lose money to digital-arrest and investment scams every week. The scripts exploit emotion, not intelligence.",
      },
      {
        myth: "A small amount isn't worth reporting.",
        fact: "Scammers harvest working cards and UPI IDs through small 'test' transactions, then strike big. Reporting ₹500 today may save your ₹5,00,000 tomorrow.",
      },
    ],
    toolkit: [
      {
        title: "Guard your money",
        items: [
          "Set daily UPI/card transaction limits you can live with",
          "Turn on SMS + email alerts for every bank account",
          "Never keep more than a small float in the account linked to UPI",
          "Verify QR codes at shops by checking the merchant name before paying",
          "Lock payment apps behind fingerprint/app-lock, not just the phone lock",
        ],
      },
      {
        title: "Guard your identity",
        items: [
          "Register on 1909 (DND) and report spam on Chakshu — sancharsaathi.gov.in",
          "Check 'Do you know this app?' — remove screen-share, remote-access and clone apps monthly",
          "Never post Aadhaar, PAN, card photos or boarding passes online",
          "Use a strong, different email for banking; enable 2-step verification everywhere",
          "Track SIMs issued in your name on sancharsaathi.gov.in — block strangers' SIMs instantly",
        ],
      },
      {
        title: "If you are a victim — act now",
        items: [
          "Call 1930 within the golden hour; note the acknowledgment number",
          "File at cybercrime.gov.in → Report Financial Fraud (attach evidence)",
          "Inform your bank's fraud desk and submit a written dispute",
          "Report the fraudster's number on Chakshu; block and preserve the chat",
          "If sextortion: do NOT pay. Report on cybercrime.gov.in — paying funds the next threat",
        ],
      },
    ],
    faqs: [
      {
        q: "I realised the fraud 3 hours later. Is my money gone?",
        a: "Not necessarily — call 1930 right now anyway. The later you report the lower the recovery odds, but freezing sometimes still works if funds are sitting in a mule account. Then file on cybercrime.gov.in immediately.",
      },
      {
        q: "Someone claiming to be from the police put me on a video call and said I'm under 'digital arrest'. What do I do?",
        a: "End the call. Digital arrest does not exist in Indian law. Real officers never demand money over video calls. Report the number on cybercrime.gov.in and Chakshu, and inform 1930.",
      },
      {
        q: "How do I check how many SIM cards are issued in my name?",
        a: "Log in to sancharsaathi.gov.in with your mobile number — 'TAF Cop' shows all SIMs on your ID. Disconnect any you don't recognise.",
      },
      {
        q: "An instant-loan app is calling my contacts and threatening me.",
        a: "Do not pay. Take screenshots of threats, revoke app permissions, uninstall it, and file a complaint on cybercrime.gov.in under 'Report Other Cybercrime' citing extortion. Share the complaint with your contacts so they ignore the calls.",
      },
      {
        q: "What is the difference between 1930 and cybercrime.gov.in?",
        a: "1930 is the 24×7 phone helpline for financial fraud — best for the golden hour. cybercrime.gov.in is the portal for the full written complaint, including non-financial cybercrimes like harassment and sextortion.",
      },
    ],
    links: [
      { label: "National Cyber Crime Reporting Portal — file a complaint", href: "https://cybercrime.gov.in" },
      { label: "Sanchar Saathi — Chakshu, SIM checks, lost SIM block", href: "https://sancharsaathi.gov.in" },
      { label: "Indian Cyber Crime Coordination Centre (I4C)", href: "https://i4c.mha.gov.in" },
      { label: "RBI — complaint management & consumer awareness", href: "https://www.rbi.org.in" },
      { label: "TRAI — DND/spam registry (1909)", href: "https://www.trai.gov.in" },
    ],
  },

  /* ------------------------------------------------------------
   * 3) WOMEN-SAFETY — Suraksha
   * ------------------------------------------------------------ */
  "women-safety": {
    slug: "women-safety",
    title: "Women Safety & Rights",
    heroTag:
      "Knowing your numbers, your laws and your exits is not fear — it is freedom with a safety net. Suraksha puts all three in your hands.",
    accent: "fuchsia",
    icon: "heart-handshake",
    helpline: "181",
    overview: [
      "NFHS-5 found that nearly 3 in 10 Indian women face spousal violence, yet about 77% never seek help from anyone. The silence is not consent — it is the absence of a safe path. Suraksha builds that path: numbers to call (112 for emergencies, 181 Sakhi for counselling and legal aid, 1091 for the women's police helpline), laws that stand behind you (the Domestic Violence Act 2005, POSH Act 2013, the Dowry Prohibition Act, and Section 354D against stalking), and places that receive you without judgment — Bengaluru's One Stop Centres and UAR's own volunteer Safe Circles.",
      "Our teams run self-defence and assertiveness workshops in colleges, IT parks and residential wards; night-travel safety clinics with cab and BMTC commuter checklists; and POSH-awareness sessions that teach every employee how to reach the Internal Committee — or the Local Committee for workplaces with fewer than 10 staff. We accompany women to One Stop Centres, help draft complaints, and stay through the first hearing.",
      "The Protection of Women from Domestic Violence Act 2005 gives a woman the right to remain in the shared household, protection orders, and monetary relief — without needing to file a criminal case first. The POSH Act 2013 makes an Internal Committee mandatory in every workplace with 10 or more employees, with time-bound inquiries. Knowing these two sentences has changed more lives than any gadget we could hand you.",
    ],
    keyFacts: [
      {
        value: "112",
        label: "one national emergency number — police, ambulance and fire, with location tracking via the 112 India app",
      },
      {
        value: "77%",
        label: "of women facing violence never seek help from anyone (NFHS-5) — breaking this statistic is the mission",
      },
      {
        value: "181",
        label: "Sakhi/Abhayam women helpline — counselling, legal guidance, shelter referral, in Kannada and English",
      },
      {
        value: "10+",
        label: "employees? your workplace must have a POSH Internal Committee by law — ask for its members' names today",
      },
      {
        value: "700+",
        label: "One Stop Centres (Sakhi) across India offering medical, legal, police and psychosocial support under one roof",
      },
    ],
    charts: [
      {
        title: "The reporting gap",
        desc: "Per 100 women who face violence, how many ever get help — the silence we are determined to break (NFHS-5 patterns).",
        type: "bar",
        data: [
          { stage: "Faced violence", women: 100 },
          { stage: "Told anyone", women: 23 },
          { stage: "Sought formal help", women: 14 },
          { stage: "Filed a police complaint", women: 4 },
        ],
        nameKey: "stage",
        valueKey: "women",
        colors: FUCHSIA,
      },
      {
        title: "Women helplines are answering more calls every year",
        desc: "Approximate annual calls handled by women helplines nationally, in lakh — awareness is working; capacity must follow.",
        type: "area",
        data: [
          { year: "2020", callsLakh: 12 },
          { year: "2021", callsLakh: 15 },
          { year: "2022", callsLakh: 19 },
          { year: "2023", callsLakh: 23 },
          { year: "2024", callsLakh: 27 },
        ],
        xKey: "year",
        nameKey: "year",
        valueKey: "callsLakh",
        colors: FUCHSIA,
      },
    ],
    whyItMatters: [
      "A woman who knows her legal rights negotiates from strength — the DV Act's protection and residence orders are civil remedies that don't require a criminal case.",
      "POSH compliance is not paperwork: an Internal Committee that employees actually trust changes workplace culture permanently.",
      "Most violence begins with control — financial, digital, social. Recognising coercive control early prevents escalation.",
      "Bengaluru's night-economy employs lakhs of women; safe commute protocols keep livelihoods alive.",
      "When one woman reports, the deterrent effect protects her whole community — silence is the abuser's best defence.",
    ],
    playbook: [
      {
        title: "Memorise your three numbers",
        desc: "112 for any emergency (police/fire/medical, works from any phone), 181 Sakhi for counselling and legal guidance, 1091 for the women's police helpline. Save all three AND the 112 India app with SOS permissions.",
      },
      {
        title: "Build your safety net at home",
        desc: "Keep a go-bag: ID copies, some cash, medicines, a spare phone. Share your live location with two trusted people. Agree a code word with a neighbour that means 'call the police now'.",
      },
      {
        title: "Travel smart at night",
        desc: "Verify cab plate and driver photo before boarding; sit behind the driver; share trip status with family; keep your phone charged and the door unlocked only at drop-off. Prefer well-lit, populated routes even if longer.",
      },
      {
        title: "If violence happens — document and report",
        desc: "Get injuries examined and photographed; preserve abusive messages. File a DV complaint with the Protection Officer or directly at a One Stop Centre. For assault, file an FIR — 112 or the nearest police station, women's desk if available.",
      },
      {
        title: "Use the law that fits",
        desc: "Domestic violence → DV Act 2005 via Protection Officer/OSC. Workplace harassment → POSH Internal Committee (or Local Committee) within 3 months of the incident. Stalking → Section 354D. Dowry demands → Dowry Prohibition Act.",
      },
      {
        title: "Walk into a One Stop Centre",
        desc: "OSC Sakhi centres provide medical aid, police facilitation, legal aid, psychosocial counselling and temporary shelter in one visit — no appointment needed. UAR volunteers can accompany you the first time.",
      },
      {
        title: "Build the circle that sustains you",
        desc: "Recovery and courage need people: join or form a Suraksha Safe Circle in your ward — 5 to 10 women who check on each other, share rides, and rehearse 'what would you do' scenarios twice a year.",
      },
    ],
    dosDonts: {
      dos: [
        "Save 112, 181 and 1091 in your phone and in the memory of someone you trust.",
        "In danger, give a short, loud, specific instruction — 'BACK OFF!' — rather than a scream; it attracts help faster.",
        "Keep documents (ID, marriage certificate, bank details, medical records) scanned in cloud storage only you can access.",
        "Report stalking behaviour early — Section 354D covers following, contacting and monitoring.",
        "Attend POSH Internal Committee orientation when you join any workplace; ask who the members are.",
      ],
      donts: [
        "Don't confront a violent partner alone when emotions are high — leave first, talk later, from safety.",
        "Don't share live location or home address on social media; audit old posts for landmarks.",
        "Don't accept food/drinks you didn't see being prepared at unfamiliar places.",
        "Don't drop a POSH complaint midway due to pressure — the Act prohibits retaliation; report it to the Local Committee.",
        "Don't believe threats that 'no one will believe you' — One Stop Centres and 181 exist to be believed.",
      ],
    },
    mythsFacts: [
      {
        myth: "Domestic violence is a private family matter.",
        fact: "The DV Act 2005 makes it a legal wrong with protection orders, residence rights and monetary relief. The state — via Protection Officers and One Stop Centres — is mandated to intervene.",
      },
      {
        myth: "Reporting violence will automatically end the marriage.",
        fact: "A DV complaint is a civil remedy for safety and support — many women use it to stop violence while deciding their future at their own pace.",
      },
      {
        myth: "Stalking is a form of love and persistence.",
        fact: "Section 354D criminalises following, contacting and monitoring a woman despite disinterest. First conviction carries up to 3 years' imprisonment.",
      },
      {
        myth: "Small workplaces don't need to bother about POSH.",
        fact: "Every workplace with 10+ employees must have an Internal Committee; smaller ones fall under the Local Committee at the district level. Both are legal mandates, not options.",
      },
    ],
    toolkit: [
      {
        title: "Night travel & cabs",
        items: [
          "Match cab number plate + driver photo before entering",
          "Sit behind the driver; keep your bag on your lap, not in the boot",
          "Share live trip status with family for every night ride",
          "Keep phone charged; carry a small power bank always",
          "Note landmarks during the ride; if route deviates, call 112 and share location",
        ],
      },
      {
        title: "Home safety plan",
        items: [
          "Go-bag packed: IDs, cash, medicines, charger, spare keys",
          "Code word agreed with one neighbour and one friend",
          "Documents scanned and stored in cloud only you access",
          "Nearest One Stop Centre and women's police station saved on maps",
          "Emergency contacts written on a card inside your wardrobe",
        ],
      },
      {
        title: "Workplace (POSH)",
        items: [
          "Find your Internal Committee members' names — they must be displayed",
          "Write down incidents with date, time, place and witnesses while fresh",
          "Keep emails/chat evidence in a personal (not office) account",
          "File within 3 months of the incident — extensions possible with reasons",
          "Fewer than 10 employees? File with the district Local Committee",
        ],
      },
    ],
    faqs: [
      {
        q: "What exactly happens when I call 181 in Bengaluru?",
        a: "A trained Sakhi counsellor answers, hears your situation, offers immediate guidance, and can connect you to the nearest One Stop Centre, legal aid, shelter or women's police help desk. Calls are confidential and can be made by anyone on the woman's behalf.",
      },
      {
        q: "Can I get protection without filing a criminal case against my husband?",
        a: "Yes. The Domestic Violence Act 2005 is a civil law — a Protection Officer or magistrate can issue protection orders, residence orders and monetary relief without a criminal prosecution.",
      },
      {
        q: "My workplace has only 7 employees. Does POSH apply to us?",
        a: "Yes — workplaces with fewer than 10 employees fall under the district Local Committee. The complaint route exists; ask at your nearest One Stop Centre or the district office for the current members.",
      },
      {
        q: "A stranger keeps messaging me on Instagram despite being blocked on WhatsApp. What can I do?",
        a: "Screenshot everything, don't engage, and report — continued contact after clear disinterest is stalking under Section 354D. File on cybercrime.gov.in (women/child-related category) and inform 181 for support.",
      },
      {
        q: "I'm a colleague witnessing harassment. Can I complain for her?",
        a: "POSH allows a complainant's friend/relative/colleague to file with her written consent. At minimum, offer to sit with her when she reports, and never promise secrecy you cannot keep — timelines protect her.",
      },
    ],
    links: [
      { label: "National Commission for Women — complaints & schemes", href: "https://ncw.nic.in" },
      { label: "One Stop Centre (Sakhi) — Ministry of WCD", href: "https://wcd.gov.in" },
      { label: "Emergency Response Support System — 112 India", href: "https://112.gov.in" },
      { label: "Karnataka State Commission for Women", href: "https://kscw.karnataka.gov.in" },
      { label: "Cybercrime portal — online harassment against women", href: "https://cybercrime.gov.in" },
    ],
  },

  /* ------------------------------------------------------------
   * 4) CHILD-SAFETY — Little Angels Shield
   * ------------------------------------------------------------ */
  "child-safety": {
    slug: "child-safety",
    title: "Child Safety & Protection",
    heroTag:
      "Body-safety taught early is abuse prevented late. Little Angels Shield gives every child five trusted adults and every parent one clear protocol.",
    accent: "amber",
    icon: "baby",
    helpline: "1098",
    overview: [
      "Roughly 90% of child abuse in India is committed by people the child knows and trusts — family members, neighbours, coaches, tuition teachers, older cousins. That statistic rewrites the safety conversation: danger rarely arrives from dark alleys; it arrives with familiar smiles. Little Angels Shield teaches age-appropriate body safety from age 3 — the underwear rule (body parts covered by underwear are private), the five-finger rule (every child should be able to name five adults they can tell anything), and the NO-GO-TELL drill for unsafe situations.",
      "The POCSO Act 2012 stands behind every child: reporting known abuse is mandatory (Section 21 — failing to report is itself punishable), the child's identity is protected by law, testimony is recorded by magistrates in child-friendly courts, and cases must be completed within one year. CHANNEL 1098 — CHILDLINE — answers free, 24×7, in Kannada and every major language. The POCSO e-Box on cybercrime.gov.in allows anonymous digital reporting of online exploitation.",
      "Our school toolkit is practical: background verification of all staff and drivers, the two-adult rule (no adult is ever alone with one child), open-door classroom and washroom-corridor design, safe pickup protocols, and a cyberbullying curriculum for classes 5–10. For parents we run evening workshops on listening without panic — because the first response a child receives decides whether they ever tell again.",
    ],
    keyFacts: [
      {
        value: "90%",
        label: "of child abuse is committed by someone the child knows and trusts — 'stranger danger' is the wrong lesson",
      },
      {
        value: "1098",
        label: "CHILDLINE — free, 24×7 national helpline for any child in distress",
      },
      {
        value: "Sec 21",
        label: "POCSO Act 2012: not reporting known child abuse is itself a punishable offence",
      },
      {
        value: "1",
        suffix: "year",
        label: "the legal limit for completing a POCSO trial from the date of recording the child's testimony",
      },
      {
        value: "5",
        label: "trusted adults every child should be able to name — the five-finger safe-adults rule",
      },
    ],
    charts: [
      {
        title: "Who abuses children",
        desc: "Share of child sexual abuse cases by relationship of offender to child — the uncomfortable truth behind prevention education.",
        type: "pie",
        data: [
          { name: "Known & trusted persons", value: 90 },
          { name: "Strangers", value: 10 },
        ],
        nameKey: "name",
        valueKey: "value",
        colors: AMBER,
      },
      {
        title: "How distress shows up first",
        desc: "Early warning signals caregivers report noticing first — none of these mean abuse, but each one deserves a gentle question.",
        type: "bar",
        data: [
          { signal: "Withdrawal & mood swings", share: 38 },
          { signal: "Falling grades", share: 24 },
          { signal: "Fear of a person or place", share: 21 },
          { signal: "Unexplained gifts or money", share: 9 },
          { signal: "Physical complaints", share: 8 },
        ],
        nameKey: "signal",
        valueKey: "share",
        colors: AMBER,
      },
    ],
    whyItMatters: [
      "Children rarely lie about abuse — they more often stay silent for years; a single believing adult changes the whole outcome.",
      "Body-safety education from age 3 measurably reduces risk and shortens the duration of ongoing abuse.",
      "Mandatory reporting (POCSO Sec 21) makes every adult part of the child-protection system — silence has legal consequences.",
      "Schools are the highest-leverage venue: staff verification and the two-adult rule eliminate most opportunity structures.",
      "Online grooming now begins in class 5–6 gaming chats; digital safety must be taught with the same seriousness as road safety.",
    ],
    playbook: [
      {
        title: "Teach the underwear rule by age 3",
        desc: "Private parts are those covered by underwear. Nobody may look, touch or photograph them; nobody should ask the child to look at theirs. Games, doctor visits and bathing have safe versions — name them plainly.",
      },
      {
        title: "Build the five-finger circle",
        desc: "Help your child name five adults they can tell anything — one finger at a time: a parent, an aunt, a teacher, a neighbour, YOUR chosen backup. Rehearse 'I need to tell you something' out loud so the words exist before they're needed.",
      },
      {
        title: "Drill NO-GO-TELL",
        desc: "Say NO loudly; GO away from the person; TELL a circle adult — even if you were told it's a secret, even if something was a gift. Teach that secrets about bodies or gifts are NEVER allowed, while surprises (birthdays) are fine.",
      },
      {
        title: "Audit the school & activities",
        desc: "Ask three questions: Are all staff and van drivers police-verified? Is the two-adult rule followed everywhere, including tuition and sports? Are washrooms and corridors visible from staffed areas? If answers are vague, escalate to the principal in writing.",
      },
      {
        title: "Set digital guardrails by class level",
        desc: "Class 5–6: no unsupervised gaming chats; accept-friend rules; nightly device check-in WITH the child. Class 7–10: privacy lockdown on profiles, discuss sextortion scripts, save the POCSO e-Box link together — co-browsing beats spying.",
      },
      {
        title: "If a child discloses — the first 10 minutes",
        desc: "Stay calm (your shock reads as blame to a child). Say: 'You did the right thing. This is not your fault. I believe you.' Write down their exact words. Do not interrogate or promise secrecy. Contact 1098 and, where applicable, the police — reporting is mandatory under POCSO.",
      },
      {
        title: "Protect the child through the process",
        desc: "The child's identity must never be disclosed (POCSO Sec 23 — this includes school WhatsApp groups). Request a Support Person under the Act, use child-friendly court procedures, and arrange counselling. UAR volunteers can accompany families through this.",
      },
    ],
    dosDonts: {
      dos: [
        "Believe the child immediately — false disclosures by children are extremely rare.",
        "Use correct anatomical names for body parts; nicknames can hinder legal testimony.",
        "Report known or suspected abuse within 24 hours — to 1098, the police, or the POCSO e-Box on cybercrime.gov.in.",
        "Reassure the child the disclosure was brave and right, and that they are safe with you.",
        "Keep normal routines going — meals, school, play — stability is therapeutic.",
      ],
      donts: [
        "Don't interrogate with leading questions ('Did he touch you THERE?') — record free-recall words instead.",
        "Don't confront the accused person yourself; that endangers the child and destroys evidence.",
        "Don't make the child repeat the story to relatives, neighbours or multiple officials.",
        "Don't promise 'this will be our secret' — promise honesty about what happens next instead.",
        "Don't discuss the case in school or apartment WhatsApp groups — identity disclosure is an offence.",
      ],
    },
    mythsFacts: [
      {
        myth: "Child abuse happens mainly in dark alleys, by strangers.",
        fact: "About 90% of abusers are people the child knows and trusts. Prevention therefore means teaching body safety, not just avoiding strangers.",
      },
      {
        myth: "Boys can't be abused — and if they are, it's less harmful.",
        fact: "Boys face significant abuse and are disclosed to even less. POCSO protects every child below 18, regardless of gender.",
      },
      {
        myth: "Talking about body safety will 'sexualise' my child.",
        fact: "Age-appropriate body-safety talk is protective education, like fire drills. Children who know the vocabulary are both less targeted and quicker to disclose.",
      },
      {
        myth: "The child is young and will forget and move on.",
        fact: "Unaddressed abuse drives depression, self-harm and trust issues well into adulthood. Early disclosure, belief and counselling change the trajectory.",
      },
    ],
    toolkit: [
      {
        title: "Teach at home",
        items: [
          "Underwear rule practised with bath-time and dressing routines",
          "Safe touch vs unsafe touch vs confusing touch — discuss the 'confusing' category openly",
          "Secrets vs surprises: secrets about bodies or gifts are never allowed",
          "Five-finger circle drawn on the child's palm with five named adults",
          "NO-GO-TELL role-played twice a year, including with 'friendly uncles'",
        ],
      },
      {
        title: "School & activity safety",
        items: [
          "Police verification certificates for every staff member, driver and attendant",
          "Two-adult rule for all classrooms, vans, tuition and sports settings",
          "CCTV at entry/exit/corridors with retention of footage",
          "Safe pickup list with photo ID verification, updated every term",
          "Child-protection policy displayed; POCSO compliance officer named",
        ],
      },
      {
        title: "Digital safety",
        items: [
          "Privacy lockdown on all profiles; location sharing off by default",
          "No unsupervised in-game chats below class 6",
          "Discuss sextortion scripts: never send images, block, preserve, tell",
          "Save cybercrime.gov.in / POCSO e-Box as a home-screen shortcut",
          "Weekly 10-minute 'what happened online this week' chat WITH, not AT, the child",
        ],
      },
    ],
    faqs: [
      {
        q: "My child just told me something about a relative. What do I do first?",
        a: "Stay calm and say: 'You did the right thing. It is not your fault. I believe you.' Write their exact words, do not interrogate, and call 1098 for immediate guidance. Reporting known abuse is mandatory under POCSO Section 21.",
      },
      {
        q: "Can I report anonymously if I'm afraid?",
        a: "Yes — the POCSO e-Box on cybercrime.gov.in accepts complaints, and 1098 allows callers to seek guidance without identifying themselves. For offline cases, you may approach the Child Welfare Committee or a One Stop Centre.",
      },
      {
        q: "What is the two-adult rule?",
        a: "No adult is ever alone with a single child behind closed doors — classrooms, vans, tuitions and sports always have two adults or an open, observable setting. It protects children AND false-accused staff alike.",
      },
      {
        q: "Someone is bullying my daughter in her class group chat. Is that a police matter?",
        a: "Start with the school's anti-bullying process in writing. If there are threats, sexual content or blackmail, file on cybercrime.gov.in (child-related category) and inform 1098. Preserve screenshots before blocking.",
      },
      {
        q: "Will my child have to appear in court repeatedly?",
        a: "POCSO mandates child-friendly procedure: statements recorded by magistrates in a child-friendly setting, in-camera testimony, and trials completed within one year of testimony. A Support Person can accompany the child throughout.",
      },
    ],
    links: [
      { label: "POCSO e-Box / report online crimes against children", href: "https://cybercrime.gov.in" },
      { label: "National Commission for Protection of Child Rights", href: "https://ncpcr.gov.in" },
      { label: "CHILDLINE 1098 — Childline India Foundation", href: "https://childlineindia.org.in" },
      { label: "Ministry of Women & Child Development — child schemes", href: "https://wcd.gov.in" },
      { label: "Karnataka State Commission for Protection of Child Rights", href: "https://kscpcr.karnataka.gov.in" },
    ],
  },

  /* ------------------------------------------------------------
   * 5) MEDICINE-ADOPTION — Adopt-a-Medicine
   * ------------------------------------------------------------ */
  "medicine-adoption": {
    slug: "medicine-adoption",
    title: "Adopt-a-Medicine",
    heroTag:
      "₹850 a month keeps a grandmother's blood pressure silent. Skip it, and one night in the ICU costs ₹1,50,000. Adoption is the cheapest medicine India has.",
    accent: "teal",
    icon: "pill",
    overview: [
      "A family managing chronic illness in Bengaluru spends ₹800–2,500 every month on medicines alone — blood pressure, diabetes, thyroid, cardiac or asthma regimens that must never be interrupted. For a daily-wage household, that is the difference between the pharmacy and the school fee. When the month runs short, tablets get cut in half, doses get skipped, and the 'silent' disease returns as a stroke, a kidney failure or a cardiac emergency that costs 100× more than the tablets ever did.",
      "Adopt-a-Medicine matches donors to real, verified patients — each carries a UAR-MED code (e.g. UAR-MED-0001) with their condition, monthly cost and duration. You can adopt a full regimen, take a partial share of it, or sponsor just one month. Every refill cycle, you receive proof: the dispensed prescription and pharmacy bill shared with you directly. And because UAR is a registered trust, every rupee earns an 80G tax-deductible receipt.",
      "We also fix the price problem at the source. Jan Aushadhi Kendras — the government's generic-pharmacy network — sell the same CDSCO-approved molecules 50–90% cheaper than branded equivalents. Our volunteers map every adopted patient to their nearest Kendra, teach generic substitution, and typically cut the adoption cost per patient dramatically before a single rupee of donation is spent. Efficiency first, generosity second — that is how ₹1,200 a month becomes a life sustained.",
    ],
    keyFacts: [
      {
        value: "₹800–2,500",
        label: "typical monthly medicine cost for a chronic patient in Bengaluru — the cliff families fall off every month",
      },
      {
        value: "50–90%",
        label: "cheaper at Jan Aushadhi Kendras — same molecule, same effect, government-certified generics",
      },
      {
        value: "₹1,50,000+",
        label: "cost of one cardiac ICU admission — what skipping ₹1,200 of tablets for months can lead to",
      },
      {
        value: "3",
        label: "ways to adopt — full regimen, partial share, or one month at a time; pause anytime",
      },
      {
        value: "80G",
        label: "tax-deductible receipt issued for every contribution, with refill proof shared to you each cycle",
      },
    ],
    charts: [
      {
        title: "Monthly medicine cost by condition",
        desc: "Average monthly out-of-pocket cost per chronic patient in Bengaluru (indicative pharmacy averages, branded medicines).",
        type: "bar",
        data: [
          { condition: "Blood pressure", inr: 850 },
          { condition: "Diabetes", inr: 1200 },
          { condition: "Thyroid", inr: 600 },
          { condition: "Cardiac", inr: 2400 },
          { condition: "Asthma", inr: 950 },
        ],
        nameKey: "condition",
        valueKey: "inr",
        colors: TEAL,
      },
      {
        title: "The cost of skipping",
        desc: "Monthly adherence vs the crisis it prevents — the most lopsided maths in healthcare (indicative Bengaluru private rates).",
        type: "bar",
        data: [
          { item: "Monthly medicines", inr: 1200 },
          { item: "ER visit after skips", inr: 12000 },
          { item: "Cardiac ICU admission", inr: 150000 },
        ],
        nameKey: "item",
        valueKey: "inr",
        colors: TEAL,
      },
      {
        title: "Adoption is accelerating",
        desc: "Cumulative patients with fully funded medicine regimens under UAR Adopt-a-Medicine (rolling 6 months).",
        type: "area",
        data: [
          { month: "Jan", adopted: 40 },
          { month: "Feb", adopted: 85 },
          { month: "Mar", adopted: 140 },
          { month: "Apr", adopted: 210 },
          { month: "May", adopted: 280 },
          { month: "Jun", adopted: 340 },
        ],
        xKey: "month",
        nameKey: "month",
        valueKey: "adopted",
        colors: TEAL,
      },
    ],
    whyItMatters: [
      "Medicine non-adherence is India's quietest emergency — chronic patients skip doses in the last week of every month, and crises follow.",
      "A stroke or kidney failure costs 100–150× the cost of the tablets that would have prevented it; adherence is the highest-ROI care in existence.",
      "Jan Aushadhi generics cut the same bill by 50–90%, meaning your adopted rupee treats more months per patient.",
      "Refill proof creates a transparent loop: donors see the actual pharmacy bill, patients never feel 'audited', trust compounds monthly.",
      "Consistent treatment keeps breadwinners working and elders independent — medicine adoption is poverty prevention, not charity.",
    ],
    playbook: [
      {
        title: "Browse verified causes",
        desc: "Each patient carries a UAR-MED code with condition, monthly cost and duration — e.g. UAR-MED-0007, cardiac, ₹2,400/month, 12 months. Every listing is verified against a live prescription.",
      },
      {
        title: "Choose your adoption style",
        desc: "Adopt a full regimen, fund a partial share (even ₹300/month matters), or sponsor a single month. Set it as recurring, or keep it one-time — you control the cadence.",
      },
      {
        title: "Pledge & pay",
        desc: "Pay via UPI, card or bank transfer through the donate flow tagged to your chosen cause. You receive an immediate 80G-eligible receipt.",
      },
      {
        title: "We dispense against the prescription",
        desc: "UAR's pharmacy partner fills the regimen monthly; where possible we route refills through Jan Aushadhi Kendras to stretch every rupee.",
      },
      {
        title: "Refill proof lands with you",
        desc: "Each cycle you receive the dispensed prescription and bill for the patient you adopted — the loop of trust that makes monthly giving sustainable.",
      },
      {
        title: "Track the patient's stability",
        desc: "Watch the cause status move SEEKING → PARTIAL → ADOPTED, with quarterly condition notes (no private details — dignity is part of the design).",
      },
      {
        title: "Pause or exit anytime",
        desc: "Life changes. Pledges can be paused or cancelled from your donor dashboard — the patient is automatically re-listed as SEEKING, never left stranded mid-regimen without notice.",
      },
    ],
    dosDonts: {
      dos: [
        "Ask your doctor about generic substitution and Jan Aushadhi alternatives at every visit.",
        "Keep a one-page medicine card: drug, dose, timing, prescriber — show it at every appointment.",
        "Set refill alarms 5 days before the strip ends; running out 'for a day' becomes running out for a week.",
        "Store medicines cool, dry and out of children's reach; check expiry dates monthly.",
        "Donate with the 80G receipt in hand — generosity should also be tax-efficient.",
      ],
      donts: [
        "Don't stop BP or thyroid medicines when you 'feel fine' — these diseases are silent by definition.",
        "Don't split or skip doses to stretch a strip without asking the prescriber — undertreatment causes the crisis.",
        "Don't buy prescription medicines from unlicensed online sellers or social-media forwards.",
        "Don't share one family member's prescription with another, even with 'same symptoms'.",
        "Don't use expired medicines — potency loss isn't visible, especially for insulin and inhalers.",
      ],
    },
    mythsFacts: [
      {
        myth: "Generic medicines are weaker or less safe than branded ones.",
        fact: "Jan Aushadhi generics contain the same CDSCO-approved molecule and strength. They cost 50–90% less because there is no branding, marketing or packaging markup.",
      },
      {
        myth: "If sugar/pressure readings are normal, the medicine worked and can be stopped.",
        fact: "Readings are normal BECAUSE of the medicine. Stopping without a doctor's advice causes rebound crises within weeks.",
      },
      {
        myth: "Natural remedies and lifestyle change can replace cardiac medicines.",
        fact: "Diet and exercise are powerful adjoints — but established hypertension, diabetes and cardiac disease need prescribed regimens. Talk to your doctor before any switch.",
      },
      {
        myth: "One month of skipping won't matter.",
        fact: "For cardiac and diabetic regimens, a single missed month can destabilise control and trigger the emergency you were preventing all along.",
      },
    ],
    toolkit: [
      {
        title: "Before you pledge",
        items: [
          "Pick a cause by condition you care about — BP, diabetes, thyroid, cardiac, asthma",
          "Decide full / partial / single-month adoption to match your budget",
          "Set up recurring payment if monthly — it stabilises the patient's supply",
          "Confirm the 80G receipt lands in your email after payment",
          "Opt in to refill-proof updates to see your rupee at work",
        ],
      },
      {
        title: "For patients & families",
        items: [
          "Build a one-page medicine card for every chronic patient at home",
          "Locate your nearest Jan Aushadhi Kendra and compare the bill once",
          "Use a weekly dose box (Mon–Sun) to make skipped doses visible",
          "Set refill reminders 5 days before strips end",
          "Keep a 2-week buffer stock before travel or festival seasons",
        ],
      },
      {
        title: "Talk to your doctor",
        items: [
          "Ask: 'Is a generic/Jan Aushadhi version available for this?'",
          "Ask for 90-day prescriptions where stable — fewer refill gaps",
          "Carry the full medicine list to every appointment to catch interactions",
          "Ask which readings mean 'call immediately' vs 'next visit'",
          "Request a written action plan for festival/travel months",
        ],
      },
    ],
    faqs: [
      {
        q: "How do I know my money actually bought medicines?",
        a: "Every refill cycle, the dispensed prescription and pharmacy bill for your adopted patient are shared with you as refill proof. UAR's QR-audited dispensing pipeline means every rupee is traceable.",
      },
      {
        q: "Can I adopt just for one month, or must it be a yearly commitment?",
        a: "One month, partial share, full regimen or recurring — all work. Pauses and exits are allowed anytime; the patient is automatically re-listed so their supply never silently breaks.",
      },
      {
        q: "Are Jan Aushadhi medicines genuinely the same quality?",
        a: "Yes. They are CDSCO-approved, made by licensed manufacturers and meet the same pharmacopoeia standards as branded drugs. The price gap comes from the absence of marketing and brand margins.",
      },
      {
        q: "Is my donation tax-deductible?",
        a: "Yes — United Angel Reach is a registered charitable trust and issues an 80G tax-deductible receipt for every contribution, delivered to your email instantly.",
      },
      {
        q: "Who are the patients, and how are they verified?",
        a: "Patients are registered through UAR field volunteers and partner clinics with a live prescription, condition and duration. Each carries a unique UAR-MED code; status moves SEEKING → PARTIAL → ADOPTED publicly.",
      },
    ],
    links: [
      { label: "Pradhan Mantri Jan Aushadhi Kendras — locate & compare", href: "https://janaushadhi.gov.in" },
      { label: "NPPA — ceiling prices of scheduled medicines", href: "https://nppa.gov.in" },
      { label: "CDSCO — drug approvals & quality standards", href: "https://cdsco.gov.in" },
      { label: "Ministry of Health & Family Welfare", href: "https://mohfw.gov.in" },
      { label: "Anemia Mukt Bharat — nutrition & iron support", href: "https://anemiamuktbharat.info" },
    ],
  },

  /* ------------------------------------------------------------
   * 6) ANIMAL-WELFARE — Angel Paws
   * ------------------------------------------------------------ */
  "animal-welfare": {
    slug: "animal-welfare",
    title: "Animal Welfare & Rescue",
    heroTag:
      "Adopt, don't shop. Feed, don't chase. Call, don't look away. Angel Paws makes Bengaluru kinder one street, one shelter, one bowl at a time.",
    accent: "lime",
    icon: "paw-print",
    helpline: "1962",
    overview: [
      "Bengaluru's streets are shared with lakhs of community dogs and cats, and their wellbeing is written into law: the Prevention of Cruelty to Animals Act 1960 criminalises cruelty, the Animal Birth Control (ABC) Rules 2023 mandate the sterilise–vaccinate–return protocol for street dogs, and the Animal Welfare Board of India — founded in 1962, whose helpline number 1962 still serves today — sets the standards every municipal body must follow. Healthy street dogs cannot be relocated or removed; feeding them at hygienic designated spots is protected by AWBI guidelines.",
      "Angel Paws runs a Bengaluru-first operation: daily feeding routes (a community dog costs about ₹900/month to feed, a cat ₹700, a cow ₹2,500, a bird ₹400), vaccination and ABC drives with BBMP-empanelled vets, a rescue network trained in first-response (never move a spine-injured animal; use a flat board), and an adoption programme built on one conviction — Indian street dogs ('Indies') are hardier, smarter and more adoption-worthy than any imported breed.",
      "We work alongside Bengaluru's established shelters — CUPA (Compassion Unlimited Plus Action) and BAWA — for kennel care, veterinary treatment and rehoming. Donors can sponsor a specific animal's food (with photo updates), fund vaccinations, or adopt. Every rupee and every rescue is logged, because compassion deserves administration too.",
    ],
    keyFacts: [
      {
        value: "1962",
        label: "the year AWBI was founded — and the number of its animal-cruelty helpline, still active today",
      },
      {
        value: "₹900",
        label: "feeds one vaccinated, sterilised community dog for a full month (₹700 cat · ₹2,500 cow · ₹400 bird)",
      },
      {
        value: "ABC",
        label: "Rules 2023: sterilise, vaccinate, return — the legally mandated protocol for street dogs",
      },
      {
        value: "0",
        label: "healthy street dogs may be relocated or removed — it is against the law, everywhere in India",
      },
      {
        value: "5",
        label: "freedoms every animal is owed — food, water, shelter, health care, freedom from fear (PCA Act 1960 + AWBI)",
      },
    ],
    charts: [
      {
        title: "What a month of kindness costs",
        desc: "Monthly food cost per animal under UAR feeding routes (Bengaluru bulk-procurement rates).",
        type: "bar",
        data: [
          { species: "Dog", inr: 900 },
          { species: "Cat", inr: 700 },
          { species: "Cow", inr: 2500 },
          { species: "Bird", inr: 400 },
        ],
        nameKey: "species",
        valueKey: "inr",
        colors: LIME,
      },
      {
        title: "Where our rescues end up",
        desc: "Outcome mix of animals handled by Angel Paws over the last year — adoption and foster are the goal; care is the promise.",
        type: "pie",
        data: [
          { name: "Adopted", value: 42 },
          { name: "Fostered", value: 26 },
          { name: "Still waiting for a home", value: 24 },
          { name: "Critical care", value: 8 },
        ],
        nameKey: "name",
        valueKey: "value",
        colors: LIME,
      },
    ],
    whyItMatters: [
      "Sterilisation, not removal, is the only proven population control — ABC Rules 2023 make it law and it works when funded consistently.",
      "Fed and vaccinated community dogs are calm, territorial guardians of their lanes; hungry ones are where conflict begins.",
      "Rabies is 100% fatal and 100% preventable — every vaccinated street dog is a public-health shield for the whole street.",
      "Indie dogs are evolution-tuned for Indian climates and diseases: adopters get hardier companions and break the puppy-mill trade.",
      "Kindness to animals is measurable civic health — the same volunteers who feed lanes also spot fires, accidents and neighbours in need.",
    ],
    playbook: [
      {
        title: "Assess before you act",
        desc: "Is the animal bleeding, immobile, hit by a vehicle, unable to stand, or a pup/kitten alone for hours? Visible injury + immobility = emergency. Healthy sunbathing = leave alone, feed at the usual spot and time.",
      },
      {
        title: "Call the right line",
        desc: "1962 (AWBI cruelty helpline) for cruelty and guidance; your area's empanelled shelter (CUPA/BAWA/BBMP vets) for rescue pickup; 112 if the animal's condition endangers people or traffic. Photograph the animal and note the exact landmark.",
      },
      {
        title: "Protect, don't worsen, the injury",
        desc: "Spinal injuries: do NOT lift by legs or tail — slide the animal gently onto a flat board or stiff cardboard. Keep it warm, quiet and horizontal. For bleeding, press clean cloth on the wound. Transport in a crate or on the board, never loose on a bike tank.",
      },
      {
        title: "Feed like a professional",
        desc: "Fixed spot, fixed time, clean bowls, away from traffic and school gates. Roti-milk is a myth — dogs need balanced dry/wet food, cats are lactose-intolerant, never feed cooked bones. Always keep water down, especially April–June.",
      },
      {
        title: "Sterilise & vaccinate your lane",
        desc: "Get your community dogs onto the BBMP/Angel Paws ABC list: sterilisation stops litters, rabies vaccination stops tragedy. One ₹900/month sponsor covers food; one camp covers a whole street's vaccination.",
      },
      {
        title: "Adopt, don't shop",
        desc: "Visit CUPA/BAWA/Angel Paws adoption drives. Indie pups and adult dogs are vaccinated, sterilised and temperament-assessed. Say no to pet shops and 'free puppies' markets that fuel unregulated breeding.",
      },
      {
        title: "Sustain with a pledge",
        desc: "Sponsor an animal's food (₹400–2,500/month by species) or a shelter fund line — FOOD, MEDICAL, VACCINATION or SHELTER. Monthly pledges get photo updates; every pledge is receipted for 80G.",
      },
    ],
    dosDonts: {
      dos: [
        "Keep the AWBI cruelty helpline 1962 and your area shelter's number saved in the family phone.",
        "Feed at fixed spots and times, and clean up bowls after the meal.",
        "Spay/neuter your own pet — one unspayed female cat and offspring can produce thousands in a few years.",
        "Report cruelty — beating, burning, relocation attempts — with video evidence to 1962 and local police (PCA Act 1960).",
        "Slow down and let animals cross; honking doesn't hurry them, patience does.",
      ],
      donts: [
        "Don't move a possibly spine-injured animal by hand or tail — use a flat board, always.",
        "Don't feed cooked bones, spicy leftovers, or milk to adult cats (lactose intolerance).",
        "Don't 'rescue' healthy pups away from their mother — observe from distance; mom is usually hunting nearby.",
        "Don't abandon a pet 'in nature' — abandonment is cruelty under the PCA Act and the animal rarely survives.",
        "Don't buy from pet shops or online breeders without licensing papers — demand is the engine of cruelty.",
      ],
    },
    mythsFacts: [
      {
        myth: "Street dogs are dangerous and should be removed.",
        fact: "Community dogs are territorial, not predatory — they calm down dramatically once fed, vaccinated and sterilised. Removal is also illegal; ABC return is the law.",
      },
      {
        myth: "Feeding strays is illegal and makes you liable.",
        fact: "Feeding community animals at hygienic designated spots is protected under AWBI guidelines and court orders. Only unhygienic, obstructive feeding can be regulated.",
      },
      {
        myth: "Pedigree breeds make better pets than Indies.",
        fact: "Indies are hardier, low-maintenance and climate-adapted; imported breeds in Bengaluru heat often suffer skin and respiratory problems. Adoption saves two lives — the animal's and the shop puppy's replacement.",
      },
      {
        myth: "An injured cow or dog is the municipality's job alone.",
        fact: "Municipal ABC ambulances exist, but response is fastest when citizens call, stabilize and guide rescuers to the exact landmark. First response is everyone's job.",
      },
    ],
    toolkit: [
      {
        title: "Street feeding done right",
        items: [
          "Choose a shaded, low-traffic, well-drained feeding spot",
          "Fixed time daily — animals learn the schedule and wait calmly",
          "Balanced dog food; water bowl filled and cleaned daily",
          "No cooked bones, no spicy food, no milk for adult cats",
          "Wash bowls and remove leftovers to keep the spot hygienic and dispute-free",
        ],
      },
      {
        title: "Rescue 101",
        items: [
          "Photograph the animal + exact landmark before calling",
          "Call 1962 (cruelty/guidance) or your empanelled shelter for pickup",
          "Spine-injury protocol: flat board, horizontal, quiet, warm",
          "Bleeding: clean-cloth pressure; broken limb: don't splint tightly",
          "Transport in a crate or box with air holes — never loose on a bike",
        ],
      },
      {
        title: "Adoption prep",
        items: [
          "Puppy-proof one room: wires up, no small objects, no balcony access",
          "Budget for vaccines, sterilisation and quality food before adoption day",
          "Choose an Indie from a shelter drive — vaccinated and assessed",
          "First 2 weeks: routine, quiet, short walks; no visiting crowds",
          "Identify your nearest 24×7 vet BEFORE the first emergency",
        ],
      },
    ],
    faqs: [
      {
        q: "A dog in my lane looks injured. Whom exactly do I call?",
        a: "Photograph the animal with a landmark, then call 1962 (AWBI helpline) for cruelty cases or your nearest BBMP-empanelled shelter/CUPA rescue line for pickup. If it can't stand, follow the flat-board protocol while help arrives.",
      },
      {
        q: "My apartment association wants street dogs removed. What's the legal position?",
        a: "Healthy community dogs cannot be relocated or removed — the ABC Rules 2023 and AWBI guidelines are binding. The lawful, effective path is sterilisation + vaccination + designated feeding. Share this page with the association and we'll help conduct the drive.",
      },
      {
        q: "How much does it cost to sponsor an animal?",
        a: "By species per month: dog ₹900, cat ₹700, cow ₹2,500, bird ₹400. You can also pledge to shelter funds for FOOD, MEDICAL, VACCINATION or SHELTER — monthly sponsors receive photo updates.",
      },
      {
        q: "Can I feed dogs near my gate if a neighbour objects?",
        a: "Yes — feeding at hygienic, designated spots is protected. Keep bowls clean, feed away from entrances, and invite the objector to meet the animals; most disputes dissolve over a sterilisation certificate and a vaccination card.",
      },
      {
        q: "I want a pet but a purebred appeals to me. Why choose an Indie?",
        a: "Indies are healthier in Indian conditions, lower-maintenance, and every adoption from a shelter reduces demand on unregulated breeders. Meet one at an Angel Paws drive — temperament will settle the argument.",
      },
    ],
    links: [
      { label: "Animal Welfare Board of India — helpline 1962", href: "https://awbi.gov.in" },
      { label: "PCA Act 1960 & ABC Rules 2023 — India Code", href: "https://www.indiacode.nic.in" },
      { label: "CUPA Bengaluru — rescue & adoption", href: "https://cupabangalore.org" },
      { label: "Department of Animal Husbandry & Dairying", href: "https://dahd.gov.in" },
      { label: "BBMP — Bengaluru civic animal services", href: "https://bbmp.gov.in" },
    ],
  },

  /* ------------------------------------------------------------
   * 7) GREEN-CORRIDOR — AI Green Corridor
   * ------------------------------------------------------------ */
  "green-corridor": {
    slug: "green-corridor",
    title: "AI Green Corridor",
    heroTag:
      "An ambulance crawls at 11 km/h through Bengaluru traffic while cardiac survival drains 10–15% every minute. Our four-layer AI alert mesh gives the siren a right of way.",
    accent: "red",
    icon: "siren",
    helpline: "108",
    overview: [
      "In peak Bengaluru traffic an ambulance averages 11 km/h — slower than a bicycle. For cardiac arrest, every minute of delay costs 10–15% of survival; for trauma and stroke, the 'golden hour' decides whether the patient walks again. The state's 108 Arogya Kavacha fleet responds bravely, but hardware alone cannot argue with gridlock. The missing layer is communication: thousands of vehicles ahead that simply cannot hear a siren over sealed windows and traffic noise.",
      "UAR's AI Green Corridor is a four-layer alert mesh that reaches every vehicle type. Layer 1: 5G/4G V2X and cell broadcast push a corridor alert to connected cars and phones roughly 2 km ahead of the ambulance (needs internet). Layer 2: roadside units and BLE mesh nodes on signals, buses and volunteer bikes relay alerts hop-by-hop — fully offline. Layer 3: FM-RDS break-in reaches legacy cars on any radio band. Layer 4: the ambulance's smart adaptive siren, phase-tuned to intersections, clears the final 200 metres. The result: 40–60% shorter run times on corridor-active missions.",
      "This is software and coordination, not concrete: no new roads, no demolition, no VIP exception. Every 108 emergency qualifies — cardiac, accident, maternity, burn, respiratory or transfer. The mission dashboard tracks route segments by congestion, vehicles alerted by method, and minutes saved per mission, so the city can literally watch its kindness compound.",
    ],
    keyFacts: [
      {
        value: "11 km/h",
        label: "average ambulance speed in peak Bengaluru traffic — the corridor exists to break this number",
      },
      {
        value: "10–15%",
        label: "of cardiac-arrest survival lost for every minute of delayed response",
      },
      {
        value: "40–60%",
        label: "reduction in ambulance run time when a green corridor is active",
      },
      {
        value: "4",
        label: "alert layers — 5G/4G V2X + cell broadcast, offline BLE mesh, FM-RDS, adaptive siren",
      },
      {
        value: "108",
        label: "Arogya Kavacha — Karnataka's free ambulance network; always the first call in a medical emergency",
      },
      {
        value: "2 km",
        label: "how far ahead Layer-1 V2X/cell broadcast warns connected vehicles of the incoming ambulance",
      },
    ],
    charts: [
      {
        title: "Minutes saved at every congestion level",
        desc: "Average end-to-end run time for a 9 km cross-city Bengaluru mission, with vs without an active corridor.",
        type: "bar",
        data: [
          { level: "Moderate", mode: "Without corridor", minutes: 22 },
          { level: "Moderate", mode: "With corridor", minutes: 11 },
          { level: "Heavy", mode: "Without corridor", minutes: 35 },
          { level: "Heavy", mode: "With corridor", minutes: 16 },
          { level: "Gridlock", mode: "Without corridor", minutes: 48 },
          { level: "Gridlock", mode: "With corridor", minutes: 22 },
        ],
        xKey: "level",
        nameKey: "mode",
        valueKey: "minutes",
        colors: RED,
      },
      {
        title: "Why every minute is a cliff",
        desc: "Approximate survival probability after cardiac arrest by minutes without defibrillation — the corridor is buying these minutes back.",
        type: "line",
        data: [
          { minutes: "0", survival: 90 },
          { minutes: "1", survival: 78 },
          { minutes: "2", survival: 65 },
          { minutes: "3", survival: 52 },
          { minutes: "4", survival: 40 },
          { minutes: "5", survival: 28 },
          { minutes: "6", survival: 15 },
        ],
        xKey: "minutes",
        nameKey: "minutes",
        valueKey: "survival",
        colors: RED,
      },
      {
        title: "How vehicles hear the ambulance",
        desc: "Vehicles alerted on a typical corridor-active mission, by method — the mesh is layered by design: internet, offline, legacy, siren.",
        type: "bar",
        data: [
          { method: "V2X 5G/4G + cell broadcast", vehicles: 420 },
          { method: "BLE mesh (offline)", vehicles: 260 },
          { method: "FM-RDS break-in", vehicles: 130 },
          { method: "Adaptive siren (last 200 m)", vehicles: 40 },
        ],
        nameKey: "method",
        valueKey: "vehicles",
        colors: RED,
      },
    ],
    whyItMatters: [
      "Cardiac survival falls 10–15% per minute of delay — no hospital technology can buy back time lost on ORR at 6 pm.",
      "40–60% shorter run times mean the difference between discharge and disability for stroke, trauma and burns patients.",
      "Sirens alone fail in sealed, air-conditioned, noise-insulated traffic — layered digital alerts reach drivers before their ears can.",
      "The mesh works offline: BLE hops through signals, buses and volunteer bikes keep the corridor alive even in dead zones.",
      "It is equitably digital: every 108 mission qualifies — a workshop labourer's emergency rides the same corridor as anyone's.",
    ],
    playbook: [
      {
        title: "Call 108 — first, fast, factual",
        desc: "Arogya Kavacha dispatch asks for pickup landmark, patient condition and destination hospital. Speak the landmark precisely ('gate 2 of Soyuz apartment, Hennur main road') — the corridor is only as good as its pickup point.",
      },
      {
        title: "Mission created & route segmented",
        desc: "The AI segments the route into congestion segments (LOW/MODERATE/HEAVY/GRIDLOCK), assigns the nearest BLS/ALS/PTV ambulance, and estimates the baseline run time the corridor will attack.",
      },
      {
        title: "Corridor armed — Layer 1 fires ahead",
        desc: "5G/4G V2X plus cell broadcast pushes alerts ~2 km ahead: connected cars and phones receive 'ambulance approaching — prepare left lane', with live ETA of the vehicle.",
      },
      {
        title: "Layer 2 — offline BLE mesh carries the torch",
        desc: "Roadside units at signals, BLE nodes on BMTC buses and volunteer bikes relay alerts hop-by-hop where internet is dead. Traffic police consoles at junctions light up with green-wave timing.",
      },
      {
        title: "Layer 3 — FM-RDS reaches legacy cars",
        desc: "A break-in text on the FM band ('GREEN CORRIDOR: ambulance, Old Airport Road, km 3–7') reaches every radio — the 2012 hatchback gets the same warning as the connected SUV.",
      },
      {
        title: "Layer 4 — the adaptive siren finishes the job",
        desc: "Phase-tuned siren output concentrates at the intersection the ambulance approaches; the last 200 metres clear faster. Drivers pull left and hold — never brake-check in front of a moving ambulance.",
      },
      {
        title: "Measured, logged, improved",
        desc: "Every mission logs vehicles-alerted by method, time-saved per segment, and corridor-active status — visible on the operations dashboard and feeding back into the AI's route model.",
      },
    ],
    dosDonts: {
      dos: [
        "Call 108 immediately for any cardiac, accident, maternity, burn or respiratory emergency — corridor eligibility is universal.",
        "When you hear/see the alert: steer left, slow gradually, and hold position until the ambulance passes.",
        "At junctions, leave the right lane clear and obey the green-wave signal timing.",
        "Volunteer your bike or car as a BLE-mesh node if you commute a regular route daily.",
        "Give precise landmarks on 108 calls — corridor accuracy starts with the pickup point.",
      ],
      donts: [
        "Don't brake suddenly in front of an ambulance — a controlled left pull is faster and safer for everyone.",
        "Don't crowd the ambulance at the hospital entrance; gawkers cost the next patient their minutes.",
        "Don't assume sirens alone will clear traffic — that assumption is exactly the problem the mesh solves.",
        "Don't misuse corridor alerts: they are generated only for verified 108 missions, never for VIP movement.",
        "Don't film the emergency; a blocked lane filmed in portrait is still a blocked lane.",
      ],
    },
    mythsFacts: [
      {
        myth: "Green corridors are for VIP convoys.",
        fact: "UAR's AI Green Corridor activates only for 108 emergency missions — cardiac, accident, maternity, burns, respiratory. No VIP mode exists in the system.",
      },
      {
        myth: "Building a corridor means building roads.",
        fact: "It's a software and mesh deployment: V2X broadcasts, BLE nodes on existing signals and buses, FM-RDS text, adaptive siren tuning. Zero demolition, weeks to deploy on a route.",
      },
      {
        myth: "A siren is enough if people just listen.",
        fact: "Sealed cars, music, and traffic noise defeat sirens constantly — Layer 1–3 alerts reach drivers digitally up to 2 km ahead, before sound can.",
      },
      {
        myth: "One vehicle not giving way doesn't matter.",
        fact: "Corridors work on flow, not heroics — a single right-lane block at a junction can cost the exact 10–15% survival that the minute was worth.",
      },
    ],
    toolkit: [
      {
        title: "In the first 60 seconds of an emergency",
        items: [
          "Call 108 — state condition, exact pickup landmark, destination hospital",
          "Keep the phone on loud; answer dispatch callbacks immediately",
          "Start CPR if trained and the patient is unresponsive (108 guides you live)",
          "Clear the pickup point: unlock gates, move vehicles, switch on lights at night",
          "Send one person to the road with a torch/phone-flash to flag the ambulance",
        ],
      },
      {
        title: "For every driver",
        items: [
          "Alert on dash/phone = steer left and slow gradually — do not stop in a lane",
          "Hold your pulled-left position until the full convoy passes",
          "At signals, right lane stays empty when the corridor console lights up",
          "Keep FM radio audible on city drives — RDS alerts are free and offline",
          "Never tailgate an ambulance closely or brake-check it",
        ],
      },
      {
        title: "Volunteer on the mesh",
        items: [
          "Register your daily commute as a volunteer BLE-relay route",
          "Attend a 30-minute corridor-briefing (signals, lanes, alert meanings)",
          "Keep a charged power bank and the 108 speed-dial in your vehicle",
          "Report dead mesh nodes via the mission dashboard heat map",
          "Recruit your office cab fleet — buses carry the best mesh nodes",
        ],
      },
    ],
    faqs: [
      {
        q: "Do I need a 5G phone or connected car for the corridor to reach me?",
        a: "No. Layer 1 targets connected vehicles and smartphones with internet, but Layer 2 (BLE mesh) and Layer 3 (FM-RDS) deliberately reach offline and legacy vehicles — the mesh is layered precisely so no one is left out.",
      },
      {
        q: "Is the corridor only for cardiac emergencies?",
        a: "Every 108 Arogya Kavacha emergency qualifies — cardiac, accident, maternity, burn, respiratory and hospital transfers. The system sees no VIP flag and no priority class beyond clinical urgency.",
      },
      {
        q: "How much time does the corridor actually save?",
        a: "Corridor-active missions cut run times by 40–60% depending on congestion. At gridlock that is often 20+ minutes recovered — the difference between full recovery and permanent disability for many conditions.",
      },
      {
        q: "What should I do the moment I receive a corridor alert?",
        a: "Steer left, slow gradually and hold until the ambulance passes. If you're at a junction, keep the right lane clear. Never brake suddenly in front of the vehicle.",
      },
      {
        q: "Who do I call first if someone collapses — 108 or the hospital?",
        a: "Always 108 first. Arogya Kavacha dispatches the nearest ambulance and pre-alerts the hospital; calling the hospital before the ambulance only delays dispatch.",
      },
    ],
    links: [
      { label: "Emergency Response Support System — 112 India", href: "https://112.gov.in" },
      { label: "Karnataka — Arogya Kavacha 108 & health services", href: "https://karnataka.gov.in" },
      { label: "National Health Mission — emergency care frameworks", href: "https://nhm.gov.in" },
      { label: "MoRTH — road safety rules & giving way", href: "https://morth.nic.in" },
      { label: "Ministry of Health & Family Welfare", href: "https://mohfw.gov.in" },
    ],
  },

  /* ------------------------------------------------------------
   * 8) RATION-KITS — Ration Kit Mission
   * ------------------------------------------------------------ */
  "ration-kits": {
    slug: "ration-kits",
    title: "Ration Kit Mission",
    heroTag:
      "Every kit carries a QR code — UAR-RK-2026-XXXXXX — so generosity can be traced from the packing table to the family's doorstep.",
    accent: "emerald",
    icon: "package",
    overview: [
      "Hunger in a city like Bengaluru is rarely dramatic — it is the quiet end of the month when rice runs out before salary arrives, the widow who eats once a day, the daily-wage family that loses three days of work to rain. The Ration Kit Mission answers with a sealed, standardised basket: rice, atta, dal, oil, sugar, salt, spices and hygiene essentials — a full ₹950 kit designed by nutrition volunteers to carry a family of four through roughly three weeks.",
      "Transparency is engineered into the kit itself. Each unit carries a unique QR-coded label (UAR-RK-2026-XXXXXX). The pipeline: create a kit template → cut a batch of 100 units, which instantly generates 100 printed labels → volunteers pack and seal → at the beneficiary's doorstep, the volunteer scans the code → status flips READY → SCANNED and stock auto-decrements across the live dashboard. Nothing sits unaccounted: no double-counting, no diversion, no 'donation disappeared' doubts.",
      "Donors can fund kits by the unit, batch or month, and every scan event is timestamped with location and volunteer identity — an audit trail worthy of the trust placed in us. For corporate partners, batch sponsorship (100 kits = ₹95,000) comes with a full distribution report and impact photographs, collected with dignity: no queues on camera, no beneficiaries treated as props.",
    ],
    keyFacts: [
      {
        value: "₹950",
        label: "one sealed family ration kit — staples and hygiene for ~3 weeks for a family of four",
      },
      {
        value: "QR-coded",
        label: "every kit carries UAR-RK-2026-XXXXXX — scan-to-verify at the door, status flips READY → SCANNED",
      },
      {
        value: "100",
        label: "units per batch — creating a batch auto-generates 100 unique printed labels",
      },
      {
        value: "100%",
        label: "of scans auto-decrement live inventory — the dashboard is the truth, not the paperwork",
      },
      {
        value: "₹95,000",
        label: "sponsors a full 100-unit batch with a complete distribution report for CSR partners",
      },
    ],
    charts: [
      {
        title: "What's inside a ₹950 kit",
        desc: "Cost composition of one standard family ration kit (bulk procurement, Bengaluru wholesale rates).",
        type: "pie",
        data: [
          { name: "Rice & atta", value: 340 },
          { name: "Dal & pulses", value: 180 },
          { name: "Cooking oil", value: 150 },
          { name: "Sugar, salt & spices", value: 110 },
          { name: "Soap & hygiene", value: 90 },
          { name: "Packing & label", value: 80 },
        ],
        nameKey: "name",
        valueKey: "value",
        colors: EMERALD,
      },
      {
        title: "Distribution is scaling",
        desc: "Kits distributed per month through door-step QR scans (rolling 6 months).",
        type: "area",
        data: [
          { month: "Jul", kits: 320 },
          { month: "Aug", kits: 480 },
          { month: "Sep", kits: 610 },
          { month: "Oct", kits: 740 },
          { month: "Nov", kits: 900 },
          { month: "Dec", kits: 1150 },
        ],
        xKey: "month",
        nameKey: "month",
        valueKey: "kits",
        colors: EMERALD,
      },
    ],
    whyItMatters: [
      "A standardised basket beats cash-for-groceries in crisis months: nutrition is guaranteed, and market price shocks don't shrink the plate.",
      "QR-audited distribution eliminates the leakage that makes donors distrust food charities — every unit is scannable, every scan is timestamped.",
      "The last week of the month is when school attendance dips and families skip meals; kits land precisely in that gap.",
      "Batch efficiency means 100 families are served with the same logistics effort as 10 — scale here is nearly free.",
      "Dignity is a feature: sealed kits, door-step delivery, and no photographs without consent.",
    ],
    playbook: [
      {
        title: "Create the kit template",
        desc: "Admin defines the basket — items, quantities, unit costs — in the KitTemplate library (e.g. 'Family Staple Kit', ₹950/unit). Templates keep nutrition standards consistent across every batch.",
      },
      {
        title: "Cut a batch of 100",
        desc: "One click creates a KitBatch of 100 units and auto-generates 100 unique QR labels (UAR-RK-2026-XXXXXX…). Labels print for the packing table.",
      },
      {
        title: "Pack, seal, label",
        desc: "Volunteers assemble against the checklist, seal each kit, and apply its label. Batches move to status READY with a live count in inventory.",
      },
      {
        title: "Assign distribution routes",
        desc: "Ward-level volunteer leads receive routes and beneficiary lists (verified via our field teams). Kits are loaded batch-wise so scan order matches route order.",
      },
      {
        title: "Scan at the door",
        desc: "At handover, the volunteer scans the kit's QR — status flips READY → SCANNED, timestamp and location are logged, and the beneficiary verifies the code on their own phone if they wish.",
      },
      {
        title: "Stock auto-decrements",
        desc: "Every scan updates inventory and the dashboard in real time. Depleted batches archive with full scan history — the audit trail builds itself.",
      },
      {
        title: "Close the loop",
        desc: "Donors and CSR partners receive the batch report: scans per ward, dates, volunteer names, and impact notes — collected respectfully, published with consent.",
      },
    ],
    dosDonts: {
      dos: [
        "Verify the kit's seal and QR label before handing it over — a scanned kit is an accountable kit.",
        "Follow FIFO (first-in-first-out) on packing shelves; check date codes on every item.",
        "Log beneficiary feedback (family size, preferences, gaps) on the distribution form after each drop.",
        "Photograph only with explicit consent, and never publish faces of beneficiaries without approval.",
        "Report damaged seals or mismatched labels to the batch lead immediately — they are quarantined, not distributed.",
      ],
      donts: [
        "Don't open or repack sealed kits midway 'to check' — integrity of the seal is the integrity of the programme.",
        "Don't resell or divert kit contents for events; every unit is QR-traceable and diversion is fraud.",
        "Don't scan a kit before it reaches the beneficiary's door — premature scans corrupt the audit trail.",
        "Don't share beneficiary lists or locations publicly — data protection is part of dignity.",
        "Don't promise delivery dates beyond batch capacity — overpromising breaks the trust the QR exists to build.",
      ],
    },
    mythsFacts: [
      {
        myth: "Donations to food charities vanish somewhere in the middle.",
        fact: "Each kit carries a unique QR code scanned at the beneficiary's door; the scan history builds a tamper-evident audit trail from batch to doorstep.",
      },
      {
        myth: "The poor get whatever expired stock is lying around.",
        fact: "Batch packing follows FIFO with expiry checks at template level — kits are built fresh, sealed, and rotated out if seals are compromised.",
      },
      {
        myth: "Cash is always better than kits.",
        fact: "Cash is flexible, but in crisis months it is vulnerable to price shocks and diversion pressure. Kits guarantee the nutrition basket — both models have their place; ours is the basket.",
      },
      {
        myth: "Ration drives are only for festivals.",
        fact: "Hunger peaks in the last week of every ordinary month. Our distribution calendar targets those gaps, not photo-op dates.",
      },
    ],
    toolkit: [
      {
        title: "Pack a batch",
        items: [
          "Print batch labels and match count to units (100 labels = 100 kits)",
          "Check every item's date code; FIFO the older stock first",
          "Seal and label each kit; record damaged units for quarantine",
          "Confirm batch status flips to READY with the live count",
          "Stage kits route-wise for loading — scan order equals route order",
        ],
      },
      {
        title: "Volunteer scan-day",
        items: [
          "Carry the route sheet + charged phone with the scanner app",
          "Verify beneficiary by name and area before handover",
          "Scan the QR at the doorstep — never before",
          "Note family feedback and any refused items on the form",
          "Close the route in the app; unserved kits return to stock, not homes",
        ],
      },
      {
        title: "Donor transparency",
        items: [
          "Request the batch report for your sponsored kits (ward-wise scan log)",
          "Track your batch from READY → IN_PROGRESS → DEPLETED on the dashboard",
          "Prefer batch sponsorship (₹95,000 = 100 families) for CSR reporting",
          "Ask for consent-based impact photographs only",
          "Subscribe to the monthly scan-summary email for continuous proof",
        ],
      },
    ],
    faqs: [
      {
        q: "How can I verify a kit my donation funded was actually delivered?",
        a: "Every kit's QR (UAR-RK-2026-XXXXXX) is scanned at the beneficiary's doorstep with timestamp and location. Batch reports show the full scan log — ask for the report tied to your donation or batch sponsorship.",
      },
      {
        q: "What exactly is inside the ₹950 kit?",
        a: "Rice and atta (₹340), dal and pulses (₹180), cooking oil (₹150), sugar/salt/spices (₹110), soap and hygiene (₹90), packing and label (₹80) — about three weeks of staples for a family of four.",
      },
      {
        q: "Can I sponsor a batch for my company's CSR?",
        a: "Yes — a 100-unit batch is ₹95,000 and comes with a complete distribution report (scan log, ward coverage, dates) plus consent-based impact photographs. Contact us via the donate page and we'll set up the sponsorship.",
      },
      {
        q: "How do you make sure kits reach real beneficiaries, not middlemen?",
        a: "Beneficiary lists are verified by our field teams and ward volunteers; the door-step scan ties each unit to a specific handover event, and route leads sign off on unserved returns. Divergence is instantly visible.",
      },
      {
        q: "Can a beneficiary check the kit themselves?",
        a: "Yes — the QR code is not a secret. Anyone with a phone can scan the label to see the kit's batch, contents and packing date. Transparency belongs to the family too.",
      },
    ],
    links: [
      { label: "Department of Food & Public Distribution", href: "https://dfpd.gov.in" },
      { label: "National Food Security Act (NFSA) portal", href: "https://nfsa.gov.in" },
      { label: "Food Corporation of India — buffer stocks", href: "https://fci.gov.in" },
      { label: "FSSAI — food safety standards", href: "https://fssai.gov.in" },
      { label: "BBMP — Bengaluru civic services", href: "https://bbmp.gov.in" },
    ],
  },

  /* ------------------------------------------------------------
   * 9) SANITARY-PADS — Project Dignity
   * ------------------------------------------------------------ */
  "sanitary-pads": {
    slug: "sanitary-pads",
    title: "Project Dignity — Sanitary Pads",
    heroTag:
      "Period poverty keeps girls out of school 3–5 days every month. A pad bank in every school ends that sentence — for ₹18,000 a year.",
    accent: "pink",
    icon: "flower-2",
    overview: [
      "Ask a headmistress in a Bengaluru government school and she will tell you quietly: every month, girls disappear for 3–5 days. Not because of illness — because they cannot afford pads, the school toilet lacks a dispenser, and silence feels safer than stains. NFHS-5 reports 57% of Indian women aged 15–49 are anaemic, compounding the exhaustion; and every missed week of school compounds into dropped years. Period poverty is an education emergency wearing a whisper.",
      "Project Dignity installs and sustains pad banks in schools: a free dispenser, an emergency kit in the staff room, biodegradable pads stocked monthly, and a student-run Dignity Club that manages the refill roster — girls lead, boys learn respect alongside. Each pad bank also brings a menstrual-health awareness session (myths, hygiene, cycle tracking) and an anemia screening camp with referral to iron-folic-acid supplementation through the nearest PHC.",
      "The economics are disarmingly small: ₹18,000 sponsors one school's pad bank for a full year — pads, dispenser upkeep, two awareness sessions, one anemia camp and a monthly impact report to the sponsor. Sponsors receive the school's refill log and attendance notes, so the impact is not a feeling; it is a ledger of girls who stopped disappearing.",
    ],
    keyFacts: [
      {
        value: "3–5",
        label: "school days many girls lose EVERY month to period poverty — up to two months of learning a year",
      },
      {
        value: "₹18,000",
        label: "sponsors a complete pad bank for one school for a year — dispenser, biodegradable pads, sessions, anemia camp",
      },
      {
        value: "57%",
        label: "of Indian women aged 15–49 are anaemic (NFHS-5) — why every pad bank includes a screening camp",
      },
      {
        value: "100%",
        label: "biodegradable pads stocked in UAR pad banks — dignity for girls, gentler landfills for the city",
      },
      {
        value: "4",
        label: "parts of every pad bank: dispenser + emergency kit + awareness club + refill roster",
      },
    ],
    charts: [
      {
        title: "The attendance cliff, and the fix",
        desc: "Average school days missed per month due to menstruation, before vs after a pad bank is installed (UAR school data, indicative).",
        type: "bar",
        data: [
          { group: "Before pad bank", days: 4.5 },
          { group: "After pad bank", days: 1.2 },
        ],
        nameKey: "group",
        valueKey: "days",
        colors: PINK,
      },
      {
        title: "Pad banks are multiplying",
        desc: "Cumulative schools with active UAR pad banks, year end (2026 = current year target).",
        type: "area",
        data: [
          { year: "2022", schools: 12 },
          { year: "2023", schools: 34 },
          { year: "2024", schools: 78 },
          { year: "2025", schools: 140 },
          { year: "2026", schools: 220 },
        ],
        xKey: "year",
        nameKey: "year",
        valueKey: "schools",
        colors: PINK,
      },
      {
        title: "Anemia: the silent co-conspirator",
        desc: "Share of Indian women aged 15–49 by anemia status (NFHS-5) — screening camps catch and refer the majority who never knew.",
        type: "pie",
        data: [
          { name: "Anaemic", share: 57 },
          { name: "Not anaemic", share: 43 },
        ],
        nameKey: "name",
        valueKey: "share",
        colors: PINK,
      },
    ],
    whyItMatters: [
      "Every month of missed school in class 7–10 compounds into dropout risk — pad banks attack dropout at its most preventable root.",
      "Anemia (57% of women) turns periods into exhaustion; screening + iron-folic-acid referral restores energy that tuition never can.",
      "Silence and shame are the true enemies — awareness sessions that include boys change school culture, not just supply chains.",
      "Biodegradable pads matter: a school of 400 girls generates tonnes of period waste a year; our pads cut landfill load sharply.",
      "₹18,000 is less than one month of many families' lifestyle spends — yet it buys a full year of attendance for an entire school.",
    ],
    playbook: [
      {
        title: "Identify the school & the need",
        desc: "UAR field teams shortlist government/aided schools with girls in classes 6–10, confirm toilet infrastructure, and get the headmistress's written buy-in — no pad bank survives without the principal's ownership.",
      },
      {
        title: "Sponsor ₹18,000 for the year",
        desc: "One sponsor (individual, family, or company) adopts the school. The 80G receipt lands instantly, and the school enters the monthly refill calendar.",
      },
      {
        title: "Install dispenser + emergency kit",
        desc: "A free-dispense unit goes into the girls' toilet block; the staff room gets an emergency kit (pads, hot-water bag, pain-relief guidance card, spare underwear pouches).",
      },
      {
        title: "Run the awareness session",
        desc: "A trained facilitator conducts the menstrual-health class — cycle basics, myths busted, hygiene, when to see a doctor — with boys included. Questions are anonymous on chits; no girl is put on the spot.",
      },
      {
        title: "Hold the anemia screening camp",
        desc: "A hemoglobin camp screens willing students and staff; anaemic girls are referred for iron-folic-acid supplementation via the nearest PHC, and the school nurse tracks follow-ups.",
      },
      {
        title: "Hand the roster to the Dignity Club",
        desc: "Student volunteers (girls lead, boys assist) manage refill checks, stock counts and the discreet 'request a pad' protocol. Ownership is what makes the dispenser last.",
      },
      {
        title: "Report, refill, repeat",
        desc: "Sponsors receive a monthly report — pads stocked, refills used, attendance notes, camp outcomes. Refills continue through the academic year; the ledger shows the girls who stopped disappearing.",
      },
    ],
    dosDonts: {
      dos: [
        "Stock biodegradable pads and provide covered bins in every toilet block.",
        "Include boys in awareness sessions — respect is taught in the same room as biology.",
        "Normalise the emergency kit the way schools normalise first-aid boxes.",
        "Track attendance dips by month; data makes the invisible visible for the headmistress.",
        "Refer severe pain or very heavy bleeding to a doctor — dysmenorrhea deserves treatment, not tolerance.",
      ],
      donts: [
        "Don't run sessions that segregate or shame; no girl should feel her body is a problem to hide.",
        "Don't install a dispenser without a refill plan — an empty dispenser teaches disappointment.",
        "Don't treat pads as charity tokens; they are education infrastructure, like desks.",
        "Don't publish photos of girls with pads or sessions without explicit parental consent.",
        "Don't dismiss period pain as drama — endometriosis and anemia are real and common.",
      ],
    },
    mythsFacts: [
      {
        myth: "Menstruating girls are impure and should avoid the kitchen or temple.",
        fact: "Menstruation is a normal biological process. Restrictions are social conditioning with real costs — girls internalise shame that follows them into adulthood.",
      },
      {
        myth: "Girls should rest and skip school during periods.",
        fact: "Normal periods don't prevent activity. The 3–5 day absence is driven by lack of pads and facilities — exactly what a pad bank removes.",
      },
      {
        myth: "Severe period pain is normal; all girls just suffer through it.",
        fact: "Mild discomfort is common; pain that stops attendance needs medical evaluation — conditions like dysmenorrhea, endometriosis and anemia are treatable.",
      },
      {
        myth: "Used pads can be flushed or thrown open.",
        fact: "Pads never go into toilets. Wrap, bin in the covered bin, and dispose with dry waste — biodegradable pads make that disposal gentler on landfills.",
      },
    ],
    toolkit: [
      {
        title: "Pad bank operations",
        items: [
          "Monthly stock count with the Dignity Club roster",
          "Dispenser check: mechanism, load, cleanliness every refill",
          "Emergency kit in staff room: pads, hot-water bag, guidance card",
          "Covered bins + disposal bags in every girls' toilet block",
          "Attendance tracker noting monthly dips — report to sponsor",
        ],
      },
      {
        title: "Menstrual health session",
        items: [
          "Cycle basics with diagrams; average lengths and variation",
          "Myth-busting chits: anonymous questions answered openly",
          "Hygiene practice: change interval, washing, disposal",
          "When to see a doctor: severe pain, very heavy flow, irregular cycles",
          "Boys' segment: what periods are, and how to be decent about them",
        ],
      },
      {
        title: "For parents & teachers",
        items: [
          "Talk about periods before menarche, not after — prepare the girl, prepare the home",
          "Keep a small pouch in her school bag: pad, spare underwear, wet wipe",
          "Track her cycle together the first year; irregularity early is normal",
          "Watch for monthly absence patterns and pain — then ask, gently",
          "Support the Dignity Club's requests — ownership keeps the bank alive",
        ],
      },
    ],
    faqs: [
      {
        q: "What exactly does ₹18,000 cover?",
        a: "One school for one year: biodegradable pad refills, dispenser upkeep, the staff-room emergency kit, two awareness sessions (with boys included), one anemia screening camp with PHC referrals, and a monthly impact report to you.",
      },
      {
        q: "Are the pads really biodegradable?",
        a: "Yes — UAR pad banks stock certified biodegradable pads. A school of 400 girls generates tonnes of period waste yearly; biodegradable stock cuts that landfill load substantially.",
      },
      {
        q: "Why include boys in the sessions?",
        a: "Because shame survives on ignorance. Boys who understand periods stop the teasing that keeps girls home — culture change in one classroom pays forward for a generation.",
      },
      {
        q: "How is the anemia camp run?",
        a: "A qualified phlebotomist screens willing students and staff via a finger-prick hemoglobin test; anaemic participants are referred for iron-folic-acid supplementation through the nearest PHC, and the school nurse tracks follow-ups.",
      },
      {
        q: "What proof do sponsors receive?",
        a: "A monthly report: pads stocked and used (refill log), attendance notes, session and camp outcomes — a ledger of impact, not a vibe.",
      },
    ],
    links: [
      { label: "Ministry of Health & Family Welfare — Menstrual Hygiene Scheme", href: "https://mohfw.gov.in" },
      { label: "NFHS-5 — national health survey data", href: "http://rchiips.org/nfhs" },
      { label: "Anemia Mukt Bharat — iron-folic-acid programme", href: "https://anemiamuktbharat.info" },
      { label: "Ministry of Education — girl-child education", href: "https://education.gov.in" },
      { label: "Ministry of WCD — schemes for adolescent girls", href: "https://wcd.gov.in" },
    ],
  },
};

/* ============================================================
 * ROUND-2 ENRICHMENT (still pure data — no imports, no side effects)
 * - ACCENT_SOFT: dark-mode-safe accent tokens (bg-x-500/10 pattern)
 * - DONATION_TIERS: per-campaign "what your gift buys" ladder
 * - GENERIC_IMPACT_HINTS: fallback ladder for the general fund
 * - IMPACT_BULLETS: per-campaign outcome bullets for Impact tabs
 * - DONOR_FAQS: standard giving questions for any programme page
 * - ORG_DEFAULTS: org identity fallbacks until /api/settings/public answers
 * ============================================================ */

export interface AccentSoft {
  chip: string; // tinted icon/background chip
  text: string; // accent text (dark-safe)
  border: string; // accent border
  solid: string; // solid accent button bg
  ring: string; // focus ring
}

export const ACCENT_SOFT: Record<string, AccentSoft> = {
  orange: {
    chip: "bg-orange-500/10",
    text: "text-orange-600 dark:text-orange-400",
    border: "border-orange-500/25",
    solid: "bg-orange-500 hover:bg-orange-600",
    ring: "ring-orange-500/30",
  },
  cyan: {
    chip: "bg-cyan-500/10",
    text: "text-cyan-600 dark:text-cyan-400",
    border: "border-cyan-500/25",
    solid: "bg-cyan-500 hover:bg-cyan-600",
    ring: "ring-cyan-500/30",
  },
  fuchsia: {
    chip: "bg-fuchsia-500/10",
    text: "text-fuchsia-600 dark:text-fuchsia-400",
    border: "border-fuchsia-500/25",
    solid: "bg-fuchsia-500 hover:bg-fuchsia-600",
    ring: "ring-fuchsia-500/30",
  },
  amber: {
    chip: "bg-amber-500/10",
    text: "text-amber-600 dark:text-amber-400",
    border: "border-amber-500/25",
    solid: "bg-amber-500 hover:bg-amber-600",
    ring: "ring-amber-500/30",
  },
  teal: {
    chip: "bg-teal-500/10",
    text: "text-teal-600 dark:text-teal-400",
    border: "border-teal-500/25",
    solid: "bg-teal-500 hover:bg-teal-600",
    ring: "ring-teal-500/30",
  },
  lime: {
    chip: "bg-lime-500/10",
    text: "text-lime-600 dark:text-lime-400",
    border: "border-lime-500/25",
    solid: "bg-lime-500 hover:bg-lime-600",
    ring: "ring-lime-500/30",
  },
  red: {
    chip: "bg-red-500/10",
    text: "text-red-600 dark:text-red-400",
    border: "border-red-500/25",
    solid: "bg-red-500 hover:bg-red-600",
    ring: "ring-red-500/30",
  },
  emerald: {
    chip: "bg-emerald-500/10",
    text: "text-emerald-600 dark:text-emerald-400",
    border: "border-emerald-500/25",
    solid: "bg-emerald-500 hover:bg-emerald-600",
    ring: "ring-emerald-500/30",
  },
  pink: {
    chip: "bg-pink-500/10",
    text: "text-pink-600 dark:text-pink-400",
    border: "border-pink-500/25",
    solid: "bg-pink-500 hover:bg-pink-600",
    ring: "ring-pink-500/30",
  },
};

export function accentSoft(accent?: string | null): AccentSoft {
  return ACCENT_SOFT[accent ?? ""] ?? ACCENT_SOFT.emerald;
}

export interface DonationTier {
  amount: number;
  impact: string;
}

export const DONATION_TIERS: Record<string, DonationTier[]> = {
  "anti-drug": [
    { amount: 500, impact: "funds an awareness pack for one classroom — recovery workbooks, screening cards and 14446 helpline stickers" },
    { amount: 1000, impact: "sponsors confidential screening for 10 students at a campus camp, with a trained counsellor present" },
    { amount: 2500, impact: "pays for a family-counselling block of three sessions alongside a Tele-MANAS-empanelled therapist" },
    { amount: 10000, impact: "underwrites a full year of monthly follow-ups for one person in recovery — the window when relapse risk peaks" },
  ],
  "cyber-crime": [
    { amount: 500, impact: "prints 250 “golden hour” fraud-rescue cards for a neighbourhood watch — what to dial in the first 60 minutes" },
    { amount: 1000, impact: "runs a cyber-safety session for 50 senior citizens with a live 1930 complaint walkthrough" },
    { amount: 2500, impact: "funds a school UPI-safety workshop for 100 students, including how to freeze a stolen payment" },
    { amount: 10000, impact: "keeps the fraud-rescue desk staffed for a month of golden-hour interventions with bank nodal officers" },
  ],
  "women-safety": [
    { amount: 500, impact: "stocks a Sakhi-centre dignity kit — essentials plus a legal-aid card — for one survivor" },
    { amount: 1000, impact: "funds safe transport for five survivors to a One-Stop Centre, any hour of the day" },
    { amount: 2500, impact: "pays for a self-defence and legal-rights workshop for 40 women, conducted by certified trainers" },
    { amount: 10000, impact: "runs a 181-awareness drive across ten wards — posters, volunteer marshals and auto-stand audio spots" },
  ],
  "child-safety": [
    { amount: 500, impact: "prints POCSO and 1098 classroom posters plus take-home cards for one school" },
    { amount: 1000, impact: "funds a child-safety session for 60 children with trained, background-verified facilitators" },
    { amount: 2500, impact: "sponsors a teacher-training block on safe-touch disclosure and mandated reporting for two schools" },
    { amount: 10000, impact: "keeps a school child-safety desk running for a term across five schools, with counsellor referrals" },
  ],
  "medicine-adoption": [
    { amount: 500, impact: "covers one month of BP or thyroid medicines for an elderly patient at Jan Aushadhi rates" },
    { amount: 1000, impact: "covers one month of diabetes-plus-BP medicines for a chronic patient, QR-delivered to their door" },
    { amount: 2500, impact: "covers a cardiac patient's monthly medicines with pharmacist verification and adherence notes" },
    { amount: 10000, impact: "adopts a full six-month medicine plan for a patient still waiting for a monthly pledge" },
  ],
  "animal-welfare": [
    { amount: 500, impact: "feeds two street dogs for a month at volunteer-run feeding points" },
    { amount: 1000, impact: "funds vaccination for five community animals, logged with batch numbers" },
    { amount: 2500, impact: "sponsors a sterilisation (ABC) camp slot with a partner veterinary clinic" },
    { amount: 10000, impact: "stockpiles a month of feed for the shelter — dogs, cats, cows and birds" },
  ],
  "green-corridor": [
    { amount: 500, impact: "installs one roadside BLE beacon on a corridor junction — offline-proof alerting" },
    { amount: 1000, impact: "funds junction mapping and congestion baselining for a 2 km corridor stretch" },
    { amount: 2500, impact: "equips one patient-transport ambulance with a corridor transponder kit" },
    { amount: 10000, impact: "runs a live corridor drill across five Bengaluru junctions, every event logged to the second" },
  ],
  "ration-kits": [
    { amount: 500, impact: "assembles one full ration kit for a family of four — rice, dal, oil, staples — QR-traced to their door" },
    { amount: 1000, impact: "assembles 2 ration kits for a family of four" },
    { amount: 2500, impact: "assembles 5 ration kits and restocks the community pantry shelf behind them" },
    { amount: 10000, impact: "sponsors a 20-kit distribution lane for a week, with doorstep scans and a family register" },
  ],
  "sanitary-pads": [
    { amount: 500, impact: "restocks a school pad-bank dispenser for 25 girls" },
    { amount: 1000, impact: "funds an awareness session plus pad-bank restock for one classroom of girls" },
    { amount: 2500, impact: "adopts a school's pad bank for a full term, refills included" },
    { amount: 10000, impact: "runs menstrual-health sessions across 10 schools with take-home booklets for every girl" },
  ],
};

export const GENERIC_IMPACT_HINTS: DonationTier[] = [
  { amount: 10000, impact: "installs a 10-beacon BLE cluster on a 2 km corridor stretch — or assembles 20 ration kits" },
  { amount: 5000, impact: "assembles 10 ration kits, or funds a month of medicines for three chronic patients" },
  { amount: 2500, impact: "runs a full school awareness session — anti-drug, cyber-safety or menstrual health" },
  { amount: 1000, impact: "assembles 2 ration kits for a family of four" },
  { amount: 500, impact: "assembles a full ration kit for a family of four — QR-traced to their door" },
  { amount: 0, impact: "every rupee is QR-traced to a doorstep and reconciled in the monthly public report" },
];

export const IMPACT_BULLETS: Record<string, string[]> = {
  "anti-drug": [
    "Every screening camp feeds referrals into the national 14446 de-addiction network and Tele-MANAS (14416) — no dead ends.",
    "Under NDPS Section 64A, voluntary treatment grants immunity from prosecution — our volunteers carry that card in every campus kit.",
    "Recovery support runs a full 12 months, because most relapses happen in the first year, not the first week.",
    "Nasha Mukt Bharat Abhiyaan covers 372 districts — our playbook plugs straight into it instead of reinventing it.",
  ],
  "cyber-crime": [
    "The 1930 helpline can freeze stolen money within the golden hour — our sessions teach the exact call script and the cybercrime.gov.in portal flow.",
    "Senior citizens and first-jobbers are the most-defrauded groups; every workshop is designed around their real scam messages.",
    "Every complaint walkthrough ends with the acknowledge-number follow-up step most victims miss.",
    "Awareness material is refreshed each quarter against the latest RBI fraud advisories.",
  ],
  "women-safety": [
    "181 (Sakhi) and 1091 (women police) are printed on every card we distribute — one call routes medical, legal and shelter under one roof.",
    "One-Stop Centres under the Nirbhaya framework provide the infrastructure; we provide the reach, transport and follow-up.",
    "Legal-aid cards cite the Bharatiya Nyaya Sanhita provisions volunteers are trained to explain at first contact.",
    "Self-defence workshops are free for schools and anganwadis — funded entirely by donations like yours.",
  ],
  "child-safety": [
    "1098 CHILDLINE reaches every district — we teach children the number the way they learn their own name.",
    "POCSO makes every adult a mandated protector; our teacher trainings turn that legal duty into practical steps.",
    "Every facilitator is background-verified and signs the child-protection charter — no exceptions.",
    "Sessions are age-graded, in the school's medium of instruction, with take-home cards for parents.",
  ],
  "medicine-adoption": [
    "Jan Aushadhi (PMBJP) pricing cuts chronic-medicine costs by 50–90% — your donation buys wholesale, not retail.",
    "Every adopted patient's prescription is verified by a registered pharmacist before purchase.",
    "Deliveries carry a QR receipt and an adherence log the patient's clinic can read.",
    "Adopt a patient fully, or share a monthly pledge — both are tracked in the same public ledger.",
  ],
  "animal-welfare": [
    "ABC (Animal Birth Control) programmes under AWBI rules are the proven, humane way to stabilise street-dog populations.",
    "1962 (AWBI) and local SOS lines route rescues to trained handlers — never to untrained good intentions.",
    "Every rescue is vaccinated and sterilised before adoption or return, with batch numbers logged.",
    "Feeding points are fixed, mapped and volunteer-rostered so no animal depends on one person's memory.",
  ],
  "green-corridor": [
    "Cardiac survival drops 10–15% every minute lost; a 25-minute saving is not convenience, it is a life.",
    "Four alert layers — V2X/5G, cell broadcast, offline BLE mesh, FM-RDS — back each other up; the adaptive siren is the last resort.",
    "BLE beacons cost ~₹500 each and work with no internet, no SIM, no tower — exactly when floods kill networks.",
    "Every corridor event is timestamped per segment and auditable — savings are measured, never claimed.",
  ],
  "ration-kits": [
    "Kits follow the PDS basket a family actually cooks — rice, dal, oil, salt, staples — not a photo-op hamper.",
    "Every kit carries a QR that is scanned at the beneficiary's door; no scan, no closure, an audit instead.",
    "Assembly cost stays at ~₹500 per kit for a family of four through wholesale procurement.",
    "Distribution lanes run weekly so a family never waits more than seven days for the next kit.",
  ],
  "sanitary-pads": [
    "NFHS-5 shows large gaps in menstrual-hygiene access — school pad banks close it where girls actually are.",
    "Certified biodegradable pads cut the landfill load a school of 400 girls would otherwise generate.",
    "Sessions include boys — shame survives on ignorance, and culture change starts in one classroom.",
    "Anemia screening camps partner with PHCs and follow the Anemia Mukt Bharat supplementation protocol.",
  ],
};

export const DONOR_FAQS: { q: string; a: string }[] = [
  {
    q: "Is my donation 80G eligible?",
    a: "Yes. United Angel Reach Trust is registered under Section 80G of the Income-tax Act — donors get a 50% tax deduction on qualifying gifts. Add your PAN while donating and the receipt is issued in a tax-ready format automatically.",
  },
  {
    q: "How do I get a receipt?",
    a: "Instantly. Every gift gets a unique receipt number (UAR-RCPT-…) on the thank-you screen, with a print-ready 80G receipt you can download right away. The same receipt is emailed to you, and it lives in your Donor Portal forever.",
  },
  {
    q: "Can I donate monthly?",
    a: "Yes — choose “Monthly” on the amount step. Monthly giving is the most powerful kind: it lets us commit to a patient's medicines or a family's kits for a full year, not just one distribution. You can pause or stop any time from your Donor Portal.",
  },
  {
    q: "Where does my money actually go?",
    a: "At least 92% of every rupee reaches programmes — the rest is a lean, audited ops desk. Kits, pads and medicines carry a QR that is scanned at the beneficiary's door, and monthly public reports reconcile money against scans. If we can't evidence it, we don't claim it.",
  },
];

export const ORG_DEFAULTS = {
  orgName: "United Angel Reach",
  orgHq: "Bengaluru, Karnataka",
  orgAddress: "United Angel Reach Trust, Indiranagar, Bengaluru, Karnataka 560038, India",
  orgEmail: "care@unitedangelreach.org",
  orgPhone: "",
  org80g: "",
  orgPan: "",
  orgReg12a: "",
  orgDarpan: "",
  upiId: "unitedangelreach@upi",
  signatoryName: "Managing Trustee",
  signatoryRole: "United Angel Reach Trust",
  vision:
    "A country where help is one call away — and provable. Bengaluru is our laboratory; India is the mission: every playbook that works in one ward scales to the next hundred cities.",
};

export type OrgFallbacks = typeof ORG_DEFAULTS;

/** Merge a (possibly partial) /api/settings/public payload over the defaults. */
export function orgWithFallbacks(payload: Partial<OrgFallbacks> | null | undefined): OrgFallbacks {
  return { ...ORG_DEFAULTS, ...(payload ?? {}) };
}

/* ============================================================
 * END — campaign-data.ts (pure data; no side effects, no imports)
 * ============================================================ */
