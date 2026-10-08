/**
 * Build docs/process-map.html — the call flow, after-call flow, the three
 * showcase conversations (verbatim from eval/simulations/*.json) and every
 * endpoint.  npm run docs:map
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { toolDeclarations } from "../agent/tools";

/** Which env keys are set — names only, values are never read into the page. */
const envSet = new Set(
  existsSync(".env.local")
    ? readFileSync(".env.local", "utf8")
        .split("\n")
        .filter((l) => /^[A-Z_][A-Z0-9_]*=\S/.test(l))
        .map((l) => l.split("=")[0])
    : [],
);

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

interface Sim {
  durationS: number;
  state: {
    transcript: { speaker: "agent" | "caller"; text: string }[];
    evaluation: { outcome: string; declineReason: string | null } | null;
    scope: { status: string } | null;
    booking: { label: string; designer: string | null } | null;
    callbackWindow: string | null;
    message: { forPerson: string | null } | null;
    toolLog: { name: string }[];
  };
}
const load = (id: string) => JSON.parse(readFileSync(`eval/simulations/${id}.json`, "utf8")) as Sim;

const CASES = [
  {
    id: "T01",
    title: "Qualified and booked",
    chip: "Approved",
    tone: "good",
    who: "Priya · 3BHK in Kothrud · referred by a past client · calls at 11 pm",
    after: [
      "Server: hard rules pass, in-scope → qualified; intake sheet complete (incl. the carpet area being worked on)",
      "No budget given → agent shares the typical range once (server-written), says it depends on locality and requirements, and asks if she's comfortable — she is, so it books",
      "Slots fetched, consultation booked, SMS confirmation logged",
      "Deal health scored (referral, decider on the call, timeline, booked) → shown on the dashboard and as HubSpot priority",
      "Designer gets the Telegram note; HubSpot deal → Booked",
    ],
  },
  {
    id: "T19",
    title: "Declined: out of scope",
    chip: "Rejected",
    tone: "bad",
    who: "Rahul · wants a restaurant fit-out in Koregaon Park",
    after: [
      "Server hard rule: restaurants are an excluded category → declined (no AI judgement involved)",
      "Agent reads the server's figure-free close line and ends the call",
      "Stored as declined (category); counted under Declines by reason; HubSpot deal → Declined; no designer note",
    ],
  },
  {
    id: "T18",
    title: "Uncertain scope → designer review",
    chip: "Review",
    tone: "warn",
    who: "Sameer · a 180 sq ft coworking pod in Baner",
    after: [
      "Below the (unconfirmed) 500 sq ft commercial minimum is a soft fail → review, never an auto-decline",
      "No budget given → server-written typical range for ~180 sq ft with the disclaimer and comfort check; asking again gets a short repeat",
      "Agent asks when he's generally free and says the team will get back to him as soon as possible — no promised time",
      "Designers' Telegram note with Approve / Reject / Needs admin review; HubSpot deal → Service review",
      "Approve → booking call back (during his usual free times) · Reject → polite closing SMS",
    ],
  },
] as const;

function transcript(id: string) {
  const s = load(id);
  return s.state.transcript
    .map((t) => `<div class="turn ${t.speaker}"><span class="who">${t.speaker === "agent" ? "Agent" : "Caller"}</span>${esc(t.text)}</div>`)
    .join("\n");
}

function outcomeLine(id: string) {
  const s = load(id).state;
  const sim = load(id);
  const dur = `${Math.floor(sim.durationS / 60)}:${String(Math.round(sim.durationS % 60)).padStart(2, "0")}`;
  const bits = [
    s.evaluation?.outcome ?? s.scope?.status ?? "—",
    s.booking ? `booked ${s.booking.label}${s.booking.designer ? ` with ${s.booking.designer}` : ""}` : null,
    s.callbackWindow ? `call back: ${s.callbackWindow}` : null,
    `${dur} simulated`,
    `${s.toolLog.length} tool calls`,
  ].filter(Boolean);
  return bits.join(" · ");
}

const callFlow = `flowchart TD
  A(["Call to the studio number"]) --> B{"Staff free?<br/>office hours"}
  B -- "yes" --> FD["Front desk answers<br/>no AI, no cost"]
  B -- "busy / no answer / after hours" --> V["Forwarded to the Vaani number"]
  V --> G["Greeting: AI assistant + call is recorded<br/>Asks name"]
  G --> I{"What can I help you with today?"}
  I -- "existing project problem" --> C["Apologise · senior will call back ASAP<br/>ask free times · URGENT to seniors"]
  I -- "update / a named designer / other" --> M["Take a message + when they're free<br/>no promised time"]
  I -- "new project" --> S["Intake sheet<br/>what work · home or office · area + PIN · size<br/>site ready · deadline · who decides<br/>ballpark budget · seen our website"]
  S --> TB["No budget given?<br/>typical range, depends on locality + requirements<br/>Are you comfortable going ahead on that basis?"]
  S --> H{"Hard rules<br/>area · category · engagement · size · timeline"}
  H -- "fails" --> D["Kind close, no figures · Declined"]
  H -- "pass / unclear" --> E{"evaluate_lead<br/>server decides"}
  E -- "qualified" --> Q["Offer 2–3 slots · book · SMS confirmation"]
  E -- "review" --> R["Ask free times · ASAP · designer review"]
  E -- "too little captured" --> K["Ask free times · ASAP · helpdesk callback"]
  E -- "unsure they want a project" --> X["Front-desk callback task"]
  E -- "budget well below scope" --> D`;

const afterFlow = `flowchart LR
  W["Vaani webhooks<br/>call_started · call_ended · call_postprocessing"] --> P["Post-call pipeline"]
  B["Brain session<br/>facts, booking, tools"] --> P
  P --> P1["Price-leak scan"] --> P2["Gemini extraction<br/>stored version"] --> P3["evaluateLead + routing"]
  P3 --> L["Neon: call, lead, criteria, booking, costs"]
  P3 --> DH["Deal health 0–100<br/>qualified leads only, no AI"]
  L --> HS["HubSpot<br/>contact + deal stage + priority"]
  L --> TG["Telegram<br/>designers · seniors · helpdesk"]
  L --> SMS["SMS to customer<br/>booking confirmation"]
  TG --> RV{"Review / callback decision<br/>Telegram · HubSpot · dashboard"}
  HS --> RV
  RV -- "approve / qualified" --> OB["Booking call back<br/>retries, then SMS booking link"]
  RV -- "reject / decline" --> RS["Closing SMS"]
  RV -- "designer / admin / callback" --> RV
  L --> DB["Founder dashboard + Gemini weekly brief"]`;

const inbound: [string, string, string, string, string][] = [
  ["WSS", "/chat/stream/&lt;call_id&gt;", "Vaani (BYOL)", "Bearer BRAIN_AUTH_TOKEN", "One agent turn per frame: Gemini + tools + price guard. Runs on the brain server (port 8090)."],
  ["POST", "/api/voice/events?token=…", "Vaani webhooks", "Secret token, or HMAC if Vaani signs", "call_started (caller number), call_ended, call_postprocessing → post-call pipeline. Idempotent."],
  ["POST", "/api/telegram/callback", "Telegram buttons", "X-Telegram-Bot-Api-Secret-Token", "Approve · Reject · Designer review · Admin review on review and callback leads."],
  ["POST", "/api/hubspot/webhook", "HubSpot private app", "X-HubSpot-Signature-v3 (5-min window)", "Deal stage moves: New qualified = approve, Declined = reject, Service / Admin review / Callback needed = route. Held / Won / Lost feed the funnel."],
  ["POST", "/api/calcom/webhook", "Cal.com", "x-cal-signature-256", "Booking created / cancelled / rescheduled / meeting ended → bookings, HubSpot stage, deal health."],
  ["GET", "/api/cron/sweep", "Scheduler, every minute", "Bearer CRON_SECRET", "Dropped-call callback (1 attempt), approval booking calls, retries, SMS booking link."],
  ["GET", "/api/cron/insights", "Daily 7:30 am", "Bearer CRON_SECRET", "SQL metrics → Gemini weekly brief (figures checked)."],
  ["GET", "/api/cron/digest", "Daily 8:00 am", "Bearer CRON_SECRET", "Founder email digest via Resend."],
  ["GET", "/b/&lt;lead id&gt;", "Customer (SMS link)", "—", "Redirects to the Cal.com booking page with the lead reference."],
  ["*", "/api/auth/…", "Dashboard", "Neon Auth", "Sign-in / sign-up / session."],
];

const outbound: [string, string, string][] = [
  ["Vaani", "POST /trigger-call/ · GET /call-history", "Outbound booking and recovery calls (spend-capped at ₹20) · call usage"],
  ["Gemini", "POST models/…:generateContent", "Agent turns, post-call extraction, weekly brief (free tier)"],
  ["Cal.com v2", "GET /v2/slots · POST /v2/bookings", "Open slots · book (placeholder attendee email, phone on the booking)"],
  ["HubSpot", "CRM v3/v4: contacts search/create, deals, notes, pipelines", "Lead sync, deal stage, priority = deal health band"],
  ["Telegram", "sendMessage · answerCallbackQuery · editMessageText", "Staff notes and buttons, never customers"],
  ["MSG91", "POST /api/v5/flow", "Customer SMS once DLT templates exist (logged only until then)"],
  ["Resend", "POST /emails", "Daily digest"],
];

const pages = [
  ["/dashboard", "Founder overview: calls (after hours vs staff busy), funnel, approvals, deal health, bookings, declines, cost, quality, weekly brief"],
  ["/dashboard/review", "Queues: designer review · admin review · callback needed"],
  ["/dashboard/leads", "All leads with status and deal health"],
  ["/dashboard/leads/&lt;id&gt;", "Intake sheet, criteria, deal-health breakdown, transcript, actions"],
  ["/dashboard/messages", "Non-enquiry calls: messages for designers / helpdesk"],
  ["/dashboard/settings", "Thresholds, flags, office hours, rates, SMS templates (founder)"],
];


// ---- Tools the agent can call (from agent/tools.ts) + what the server enforces --------
const ENFORCED: Record<string, string> = {
  lookup_caller: "Run by the server on the first reply (no model round). Finds existing clients in HubSpot.",
  escalate_complaint: "Only for an existing Aangan client's own project; otherwise refused. Seniors alerted; no time promised.",
  take_message: "Free times must be quoted from the caller's words. Delivered to the named designer / helpdesk.",
  check_scope: "Hard rules (area, category, engagement, size, timeline) decide; returns the next intake question.",
  evaluate_lead: "Blocks until scope is known and required intake fields are asked (≤2 nudges); confirms a volunteered budget was repeated back; routes to qualified / review / callback / declined.",
  typical_budget: "Server writes the range + disclaimer; repeats are shorter. The only figures the agent may speak.",
  get_slots: "Only after 'qualified'; waits for the caller's answer to the comfort check.",
  book_slot: "Only a slot get_slots returned; books in Cal.com (or the mock calendar).",
  request_callback: "Free times must be quoted from the caller's words.",
  transfer_to_front_desk: "In overflow mode: a callback task when the office opens — no promised time.",
  end_call: "Refused once on review / callback leads until free times are recorded. Server adds 'Have a good day!'.",
};
const tools = toolDeclarations().map((t) => ({ name: t.name, what: t.description, enforced: ENFORCED[t.name] ?? "" }));

const stack: [string, string, string][] = [
  ["Vaani", "Phone line, speech-to-text, text-to-speech, call recording", "Paid per minute — ₹20 cap"],
  ["Brain server (ours)", "The agent: Gemini + tools + price guard, over Vaani's bring-your-own-LLM socket", "Runs locally / any Node host"],
  ["Gemini", "Agent turns, post-call extraction, weekly brief", "Free tier"],
  ["Next.js app", "Webhooks, post-call pipeline, dashboard", "Local now; any Node host"],
  ["Neon Postgres + Neon Auth", "System of record (RLS) and dashboard login", "Free"],
  ["Cal.com", "Designer slots and bookings", "Free (mock calendar until keys)"],
  ["HubSpot", "Contacts, deals, stages, priority = deal health", "Free (mock CRM until keys)"],
  ["Telegram bot", "Staff notes, Approve / Reject / route buttons, ops alerts", "Free (console until keys)"],
  ["Resend", "Founder's daily digest email", "Free tier (console until keys)"],
  ["MSG91", "Customer SMS once DLT templates are registered", "Not used — SMS is logged only"],
  ["Cloudflare tunnel", "Public URL so Vaani can reach the brain + webhooks", "Free — not installed yet"],
];

// ---- Setup checklist ------------------------------------------------------------
type Item = { key: string; what: string; how: string; who: "you" | "me" | "done" };
const groups: { title: string; note: string; items: Item[] }[] = [
  {
    title: "Already in place",
    note: "Nothing to do.",
    items: [
      { key: "DATABASE_URL", what: "Neon database", how: "Linked with the Neon CLI", who: "done" },
      { key: "NEON_AUTH_BASE_URL", what: "Dashboard login (Neon Auth)", how: "Enabled in neon.ts", who: "done" },
      { key: "GEMINI_API_KEYS", what: "Gemini (3 of 4 keys work)", how: "You added them", who: "done" },
      { key: "VAANI_API_KEY", what: "Vaani API", how: "You added it", who: "done" },
      { key: "CRON_SECRET", what: "Cron auth", how: "Generated", who: "done" },
      { key: "VAANI_WEBHOOK_TOKEN", what: "Vaani webhook auth", how: "Generated", who: "done" },
      { key: "BRAIN_AUTH_TOKEN", what: "Brain socket auth", how: "Generated", who: "done" },
      { key: "FOUNDER_EMAILS", what: "Your founder login", how: "Set to your email", who: "done" },
    ],
  },
  {
    title: "For one live Vaani test call (≤ ₹20)",
    note: "Everything else falls back to console / mock, so this is the minimum.",
    items: [
      { key: "cloudflared", what: "Tunnel tool", how: "brew install cloudflared — I can install it with your OK", who: "me" },
      { key: "APP_BASE_URL", what: "Public https URL of the app", how: "From the tunnel — I set it", who: "me" },
      { key: "BRAIN_WS_URL", what: "Public wss URL of the brain", how: "From the tunnel — I set it", who: "me" },
      { key: "VAANI_AGENT_ID", what: "The Vaani agent", how: "npm run vaani:setup -- --apply (check your balance after)", who: "you" },
      { key: "Vaani dashboard", what: "Phone number on the agent + webhook URL + BYOL auth token", how: "Agent → Deployment; Settings → Webhooks; Brain → BYOL", who: "you" },
    ],
  },
  {
    title: "To make handoffs real (all free)",
    note: "Until these are set, notes print to the console and bookings use the mock calendar / CRM.",
    items: [
      { key: "TELEGRAM_BOT_TOKEN", what: "Telegram bot", how: "@BotFather → /newbot (also gives TELEGRAM_BOT_USERNAME)", who: "you" },
      { key: "TELEGRAM_DESIGNERS_CHAT_ID", what: "Designers' group", how: "Create the group, add the bot — I'll read the ID", who: "you" },
      { key: "TELEGRAM_SENIOR_CHAT_ID", what: "Seniors' group (complaints)", how: "Same as above", who: "you" },
      { key: "TELEGRAM_HELPDESK_CHAT_ID", what: "Helpdesk group (callbacks, messages)", how: "Same as above", who: "you" },
      { key: "TELEGRAM_OPS_CHAT_ID", what: "Ops alerts group", how: "Same as above (can be your own chat)", who: "you" },
      { key: "TELEGRAM_WEBHOOK_SECRET", what: "Button callback auth", how: "I generate it and register the webhook", who: "me" },
      { key: "HUBSPOT_PRIVATE_APP_TOKEN", what: "HubSpot Free", how: "Settings → Integrations → Private apps (CRM read/write scopes)", who: "you" },
      { key: "HUBSPOT_CLIENT_SECRET", what: "HubSpot webhook signature", how: "Same private app → Auth tab", who: "you" },
      { key: "HUBSPOT_PORTAL_ID", what: "Account ID (deal links)", how: "Top-right account menu", who: "you" },
      { key: "HubSpot stages", what: "9 deal stages", how: "Rename the default pipeline's stages (list in README §3)", who: "you" },
      { key: "CALCOM_API_KEY", what: "Cal.com Free", how: "Settings → Developer → API keys", who: "you" },
      { key: "CALCOM_EVENT_TYPE_RESIDENTIAL", what: "3 event types", how: "Create residential consult, commercial consult, site visit — send me the IDs", who: "you" },
      { key: "CALCOM_WEBHOOK_SECRET", what: "Booking webhook", how: "Set when you add the webhook (or I generate it)", who: "me" },
      { key: "CALCOM_BOOKING_URL", what: "Public booking link (SMS fallback)", how: "Your Cal.com page URL", who: "you" },
    ],
  },
  {
    title: "Optional",
    note: "Nice to have; not needed to test.",
    items: [
      { key: "DESIGNER_EMAILS", what: "Designer logins + real designer names", how: "email:Name pairs (replaces the 4 demo designers)", who: "you" },
      { key: "FRONT_DESK_NUMBER", what: "Front desk number", how: "Used in SMS text", who: "you" },
      { key: "STUDIO_DOMAIN", what: "Studio domain", how: "Placeholder booking emails and short links", who: "you" },
      { key: "RESEND_API_KEY", what: "Daily digest email", how: "resend.com + a verified domain (also DIGEST_FROM, DIGEST_TO)", who: "you" },
      { key: "VAANI_WEBHOOK_SECRET", what: "Signed Vaani webhooks", how: "Only if Vaani shows a signing secret", who: "you" },
      { key: "MSG91_AUTH_KEY", what: "Real customer SMS", how: "Needs DLT registration — skipped for zero cost", who: "you" },
    ],
  },
];
const status = (i: Item) =>
  i.who === "done" || envSet.has(i.key) ? `<span class="chip good">set</span>` : i.who === "me" ? `<span class="chip warn">I'll do</span>` : `<span class="chip bad">needed</span>`;

const html = `<title>Aangan Call Map</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Instrument+Sans:wght@400;500;600&family=Instrument+Serif&family=JetBrains+Mono:wght@400;500&display=swap">
<style>
/* Layout: one reading column; diagrams and tables scroll inside their own frames. */
:root {
  --bg: #f5f5f2; --surface: #ffffff; --surface-2: #ecece7; --line: #dcdcd4;
  --ink: #17191c; --ink-2: #4a4e55; --muted: #787c84;
  --accent: #1f5f8b; --good: #1d7a3a; --warn: #9a6a00; --bad: #b3372f;
  --agent: #ecece7; --caller: #dde8f1;
  --display: "Instrument Serif", Georgia, serif;
  --body: "Instrument Sans", system-ui, -apple-system, "Segoe UI", sans-serif;
  --mono: "JetBrains Mono", ui-monospace, Menlo, monospace;
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    --bg: #121315; --surface: #1a1c1f; --surface-2: #24272b; --line: #33373c;
    --ink: #f1f1ee; --ink-2: #c4c6c9; --muted: #8c9096;
    --accent: #7db3dc; --good: #5cc27a; --warn: #e0b04a; --bad: #ef7b72;
    --agent: #24272b; --caller: #1d2d3b; color-scheme: dark;
  }
}
:root[data-theme="dark"] {
  --bg: #121315; --surface: #1a1c1f; --surface-2: #24272b; --line: #33373c;
  --ink: #f1f1ee; --ink-2: #c4c6c9; --muted: #8c9096;
  --accent: #7db3dc; --good: #5cc27a; --warn: #e0b04a; --bad: #ef7b72;
  --agent: #24272b; --caller: #1d2d3b; color-scheme: dark;
}
body { background: var(--bg); color: var(--ink); font: 15px/1.6 var(--body); }
.wrap { max-width: 980px; margin: 0 auto; padding-inline: 20px; padding-block: 32px 64px; display: grid; gap: 40px; }
h1 { font: 400 2.6rem/1.05 var(--display); margin: 0; text-wrap: balance; letter-spacing: -0.01em; }
h2 { font: 400 1.7rem/1.2 var(--display); margin: 0 0 6px; text-wrap: balance; }
h3 { font-size: 1rem; margin: 0; }
p { margin: 0; max-width: 68ch; color: var(--ink-2); }
.eyebrow { font: 500 0.72rem/1 var(--mono); letter-spacing: 0.08em; text-transform: uppercase; color: var(--muted); }
header { display: grid; gap: 10px; }
.note { font-size: 0.85rem; color: var(--muted); }
.frame { background: var(--surface); border: 1px solid var(--line); border-radius: 10px; padding: 16px; overflow-x: auto; }
.frame pre.mermaid { margin: 0; min-width: 640px; background: transparent; }
section { display: grid; gap: 14px; min-width: 0; }
.cases { display: grid; gap: 22px; }
.case { background: var(--surface); border: 1px solid var(--line); border-radius: 10px; padding: 18px; display: grid; gap: 14px; min-width: 0; }
.case-head { display: flex; flex-wrap: wrap; align-items: baseline; gap: 8px 14px; }
.chip { font: 500 0.72rem/1 var(--mono); letter-spacing: 0.06em; text-transform: uppercase; padding: 5px 9px; border-radius: 999px; border: 1px solid currentColor; }
.chip.good { color: var(--good); } .chip.bad { color: var(--bad); } .chip.warn { color: var(--warn); }
.meta { font: 0.8rem/1.4 var(--mono); color: var(--muted); }
.convo { display: grid; gap: 6px; max-height: 420px; overflow-y: auto; padding-right: 4px; }
.turn { padding: 8px 12px; border-radius: 10px; max-width: 86%; font-size: 0.92rem; color: var(--ink); }
.turn.agent { background: var(--agent); justify-self: start; }
.turn.caller { background: var(--caller); justify-self: end; }
.who { display: block; font: 500 0.66rem/1.4 var(--mono); letter-spacing: 0.06em; text-transform: uppercase; color: var(--muted); }
.after { margin: 0; padding-left: 18px; color: var(--ink-2); font-size: 0.9rem; display: grid; gap: 4px; }
.table-wrap { overflow-x: auto; background: var(--surface); border: 1px solid var(--line); border-radius: 10px; }
table { border-collapse: collapse; width: 100%; font-size: 0.86rem; }
th, td { text-align: left; vertical-align: top; padding: 9px 12px; border-bottom: 1px solid var(--line); }
th { font: 500 0.72rem/1.3 var(--mono); letter-spacing: 0.05em; text-transform: uppercase; color: var(--muted); background: var(--surface-2); }
tr:last-child td { border-bottom: 0; }
td.mono, code { font-family: var(--mono); font-size: 0.8rem; white-space: nowrap; color: var(--accent); }
.method { font: 500 0.72rem/1 var(--mono); color: var(--ink-2); }
.two { display: grid; gap: 14px; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); }
@media (max-width: 520px) { h1 { font-size: 2rem; } .turn { max-width: 94%; } }
</style>

<div class="wrap">
  <header>
    <span class="eyebrow">Aangan Studio · AI phone enquiries</span>
    <h1>How a call flows</h1>
    <p>The AI only picks up when the front desk is busy, doesn't answer, or the office is closed. It finds out why the person is calling, works through the intake sheet for new projects, and lets the server, never the model, decide the outcome. Price questions, and callers with no budget in mind, get the typical range for their scope (server-written, indicative, depends on locality and requirements) and a check that they're comfortable going ahead. The agent never says a figure of its own, and every call ends with "Have a good day!". It never promises when someone will call back: callers hear "as soon as possible" and are asked when they're generally free. Everything after the call happens automatically within seconds.</p>
    <p class="note">The three conversations below are text simulations: Gemini played the caller, from the studio's real September enquiries, against the live agent code. No Vaani credit was used.</p>
  </header>

  <section id="call">
    <span class="eyebrow">1 · During the call</span>
    <h2>Call routing and decisions</h2>
    <div class="frame"><pre class="mermaid">${callFlow}</pre></div>
  </section>

  <section id="after">
    <span class="eyebrow">2 · After the call</span>
    <h2>What happens next</h2>
    <div class="frame"><pre class="mermaid">${afterFlow}</pre></div>
  </section>

  <section id="conversations">
    <span class="eyebrow">3 · Three simulated calls</span>
    <h2>Approved, rejected, and uncertain</h2>
    <div class="cases">
      ${CASES.map(
        (c) => `<article class="case" id="${c.id}">
        <div class="case-head"><span class="chip ${c.tone}">${c.chip}</span><h3>${c.title}</h3><span class="meta">${c.id}</span></div>
        <p>${esc(c.who)}</p>
        <div class="meta">Result: ${esc(outcomeLine(c.id))}</div>
        <div class="convo">${transcript(c.id)}</div>
        <div><span class="eyebrow">Then</span><ul class="after">${c.after.map((a) => `<li>${esc(a)}</li>`).join("")}</ul></div>
      </article>`,
      ).join("\n")}
      <article class="case" id="S11">
        <div class="case-head"><span class="chip warn">Message</span><h3>Not an enquiry: asks for her designer</h3><span class="meta">S11</span></div>
        <p>Meenal · existing client · wants Rohan about tile samples</p>
        <div class="meta">Result: ${esc(outcomeLine("S11").replace(/^uncertain/, "message"))}</div>
        <div class="convo">${transcript("S11")}</div>
        <div><span class="eyebrow">Then</span><ul class="after"><li>No lead is created, so the sales funnel stays clean</li><li>Message matched to designer Rohan Joshi → Telegram DM (or the designers' group); caller told "as soon as possible", her free times noted</li><li>Listed on Dashboard → Messages</li></ul></div>
      </article>
    </div>
  </section>

  <section id="endpoints">
    <span class="eyebrow">4 · Endpoints</span>
    <h2>What calls us</h2>
    <div class="table-wrap"><table>
      <thead><tr><th>Method</th><th>Path</th><th>Called by</th><th>Verified with</th><th>What it does</th></tr></thead>
      <tbody>${inbound.map(([m, p, by, auth, what]) => `<tr><td class="method">${m}</td><td class="mono">${p}</td><td>${by}</td><td>${auth}</td><td>${what}</td></tr>`).join("")}</tbody>
    </table></div>
    <h2>What we call</h2>
    <div class="table-wrap"><table>
      <thead><tr><th>Service</th><th>Endpoint</th><th>Used for</th></tr></thead>
      <tbody>${outbound.map(([s, e, u]) => `<tr><td>${s}</td><td class="mono">${e}</td><td>${u}</td></tr>`).join("")}</tbody>
    </table></div>
    <h2>Dashboard pages</h2>
    <div class="table-wrap"><table>
      <thead><tr><th>Page</th><th>Shows</th></tr></thead>
      <tbody>${pages.map(([p, s]) => `<tr><td class="mono">${p}</td><td>${s}</td></tr>`).join("")}</tbody>
    </table></div>
    <p class="note">Every inbound webhook is processed once (duplicates ignored), failures alert the ops Telegram group, and outbound calls retry with backoff. Real voice spend is capped at ₹20 in total.</p>
  </section>
  <section id="tools">
    <span class="eyebrow">5 · Tools used</span>
    <h2>What the agent can do on a call</h2>
    <p>The model chooses when to call these; the server decides the result and enforces the rules on the right.</p>
    <div class="table-wrap"><table>
      <thead><tr><th>Tool</th><th>Used when</th><th>What the server enforces</th></tr></thead>
      <tbody>${tools.map((t) => `<tr><td class="mono">${t.name}</td><td>${esc(t.what)}</td><td>${esc(t.enforced)}</td></tr>`).join("")}</tbody>
    </table></div>
    <h2>Services in the stack</h2>
    <div class="table-wrap"><table>
      <thead><tr><th>Service</th><th>Role</th><th>Cost / status</th></tr></thead>
      <tbody>${stack.map(([a, b, c]) => `<tr><td>${a}</td><td>${b}</td><td>${c}</td></tr>`).join("")}</tbody>
    </table></div>
  </section>

  <section id="setup">
    <span class="eyebrow">6 · Setup checklist</span>
    <h2>Keys and accounts</h2>
    <p>Status is read from <code>.env.local</code> when this page is generated (names only — no values). Put keys there, never in chat.</p>
    ${groups
      .map(
        (g) => `<h3 style="margin-top:6px">${g.title}</h3><p class="note">${g.note}</p>
    <div class="table-wrap"><table>
      <thead><tr><th>Status</th><th>Key / step</th><th>For</th><th>How to get it</th></tr></thead>
      <tbody>${g.items.map((i) => `<tr><td>${status(i)}</td><td class="mono">${i.key}</td><td>${i.what}</td><td>${i.how}</td></tr>`).join("")}</tbody>
    </table></div>`,
      )
      .join("\n")}
  </section>
</div>
`;

writeFileSync("docs/process-map.html", html);
console.log("Wrote docs/process-map.html");
