# Aangan Studio — AI phone enquiry agent: Phase 1 plan

Status: **approved 2026-10-07 with a zero-cost constraint (see §0a)** · Phase 2 (Foundations) built — see §9.

Everything below was checked against current vendor docs on 2026-10-07 (sources in §8). Where the brief and the docs disagree, it is called out as **⚠ differs from brief**.

---

## 0. Decisions I need from you before Phase 2

| # | Decision | My recommendation |
|---|---|---|
| D1 | **Vaani: mid-call tool calling isn't documented** (see §1) | **Option A**: Vaani for voice + our own LLM brain via Vaani's BYOL WebSocket. In parallel, ask Vaani to confirm tool calling, webhook signing and Marathi. |
| D2 | SMS gateway | **MSG91** (DLT-native, self-serve, ~₹0.20–0.25/SMS). Start DLT registration **now** — ~1 week lead time, and it blocks every customer SMS. |
| D3 | HubSpot tier | Free/Starter is enough. Approvals via a **private-app webhook on `dealstage`**, not workflows (workflow webhooks need Data Hub Pro). But Free has **no custom pipeline** → the "Phone enquiries" pipeline needs **Starter** (or we repurpose the default pipeline on Free). |
| D4 | Cal.com plan | Round-robin needs **Teams ($12/user/mo)**. 14 designers ≈ $168/mo. |
| D5 | Vercel plan | **Pro** (Hobby is non-commercial, cron only daily). |
| D6 | T18 label vs `COMMERCIAL_MIN_SQFT` | See §4 — the label and the rule conflict. |
| D7 | Eval labels | Approve/adjust the table in §4. |
| D8 | PIN allowlist | I build it in Phase 2 from the India Post directory and show it to you before it's used. |

---

## 0a. Zero-cost execution — what changes

You approved the plan with "zero cost execution" and confirmed it is an **academic case study that will never be commercially deployed**. That means free tiers only, no paid plans and no per-use spend, apart from the ₹100 Vaani balance (see `VOICE_SPEND_CAP`).
- All data is synthetic or demo, so the Gemini free tier is fine.
- Vercel Hobby's non-commercial licence is fine.
- DLT registration isn't needed.

Real APIs are still used behind interfaces, so the design stays faithful to the brief.

| Piece | Paid plan in §0 | Zero-cost substitute | What you lose |
|---|---|---|---|
| Voice | Vaani ₹5/min | `VoiceProvider = simulated` (text) for dev, eval and demos. Vaani adapter built, used only if free trial credits exist (**ask Vaani**). | No real phone calls until there's a voice budget. The DoD "11pm test call" can't run. |
| Dialogue brain host | small always-on server | Runs locally, exposed through a free Cloudflare Tunnel during demos | Not always-on |
| LLM | Gemini paid | Gemini free tier | **Free-tier prompts may be used by Google to improve its products, so no real customer data on the free tier.** Only demo/synthetic calls. Rate limits apply. |
| SMS | MSG91 + DLT (~₹5,900 + per SMS) | `SMS_PROVIDER = console`: messages logged and shown on the dashboard, not sent | Customers get no SMS confirmations |
| Cal.com | Teams (round-robin) | Free plan: one studio account, 3 event types; **our server does the round-robin** and records the designer on the booking | Designers don't get native Cal.com host assignment |
| HubSpot | Starter | Free: rename the **default** pipeline's stages to our 7; only a few custom properties (rest lives in Postgres + a deal note) | Fewer HubSpot fields; approvals still work via private-app webhook |
| Hosting | Vercel Pro | Vercel Hobby (non-commercial use only, fine for a pilot/demo). Per-minute jobs (drop recovery, retries) run from a **Neon Function cron trigger** instead of Vercel cron | Not licensed for production commercial use |
| DB | — | **Neon** Free (switched from Supabase 2026-10-07; scales to zero when idle) | Cold start of a second or so after idle |
| Telegram, Resend, GitHub Actions | free already | — | — |

---

## 1. Vaani (gating) — **STOP: one of the two required capabilities is not documented**

Product: **Vaani AI Research** — docs at docs.vaanivoice.ai (public), API `https://api.vaanivoice.ai/api/…`, auth `X-API-Key`, Python `vaani-sdk`.

**⚠ differs from brief:** Vaani's "own model" is a **speech** model (STT/TTS, Indic + code-mix). The dialogue LLM is a third-party one you pick (`brain.llm`: OpenAI / Google / Azure / Groq) **or your own LLM over a WebSocket ("BYOL")**.

| Capability | Status | Evidence |
|---|---|---|
| (a) **Mid-call tool calls with structured args** | **✗ Not documented.** `persona.actions` is "provider-specific shape", examples show `"functions": []`; no schema, no timeout | /api-reference/update-persona |
| (b) **Post-call structured extraction** | **◐ Partial.** Not a JSON schema — a flat list of `data_points` `{name, prompt, values?(enum), nullable}` + typed dispositions. Delivered in the `call_postprocessing` webhook and `GET /call_details/{id}` | /api-reference/update-analysis |
| Inbound Indian number / own SIP | ✓ | /getting-started/setup-telephony |
| Webhooks (call_ended, call_postprocessing, transfer events) | ✓ — **signing only documented for campaign webhooks** (`X-Vaani-Signature`, HMAC-SHA256); unclear for dashboard webhooks | /guides/webhook-setup |
| Outbound call API with per-call variables | ✓ `POST /trigger-call/` with `metadata`, per-call agent overrides, DND check | /api-reference/trigger-call |
| SMS | **✗ No** → separate `SmsProvider` (MSG91) | — |
| Usage per call | ◐ `call_cost` in **credits** + `duration_ms`; no LLM/STT/TTS split | /api-reference/call-history |
| Live transfer | ✓ warm (`transfer_call`); cold undocumented | /guides/webhook-setup |
| Languages | Docs: `en`/`hi` + auto-detect; **Marathi not mentioned in API docs** (marketing claims 22 languages + code-mix) | /api-reference/update-persona |
| Transcript with speaker labels | ✓ `AGENT:`/`USER:` string — enough for the price-leak scan | /api-reference/transcript |
| Text/simulation mode for tests | ✗ (only in-browser WebRTC voice) | — |
| Price | ₹5/min all-in (public) | vaaniresearch.com/solutions |

### Options

**A — Vaani for voice + our own LLM via BYOL (recommended).** Vaani does telephony, STT, TTS, turn-taking. Our server *is* the dialogue brain: Vaani streams the transcript over WebSocket, we run the LLM (Gemini, from the stack) with real function calling to `check_scope` / `evaluate_lead` / `get_slots` / `book_slot` in-process, and stream text back.
- ✓ Tool calling fully under our control, no dependence on an undocumented feature.
- ✓ **Strongest price guarantee available:** every agent utterance passes a server-side filter *before* it reaches TTS; a ₹/lakh/per-sq-ft hit is replaced with the fixed deflection line. The post-call scan becomes a second line of defence.
- ✓ The **same brain runs in text mode** for eval, the price-leak suite and the 5 simulated transcripts — tests exercise production code, not a mock.
- ✓ Post-call extraction: run our full JSON schema on the transcript server-side (one Gemini call, logged in `call_costs`), and *also* configure Vaani `data_points` as a cross-check.
- ✗ We own latency (need a streaming, fast model; target <800 ms first token) and an always-on WebSocket server — **Vercel functions can't hold long WebSockets**, so the brain runs as a small separate service (Fly.io / Railway / Cloud Run, Mumbai region). Next.js on Vercel keeps webhooks + dashboard.
- ✗ Changes brief §2 ("Vaani's own LLM", "no separate LLM during the call") — needs your sign-off. LLM cost becomes a separate cost component.
- ? Whether ₹5/min drops when you bring your own LLM — ask Vaani.

**B — Ask Vaani to confirm `persona.actions` tool calling** (JSON-schema args, HTTPS endpoint, timeout) **and dashboard-webhook signing**, then build as the brief describes. Lowest effort if it exists; blocked until they answer. Even then we lose the pre-TTS price filter and the text-mode test harness.

**C — Different voice provider** whose tool calling and extraction are documented. The `VoiceProvider` interface makes this a contained swap, but I'd need to verify candidates' docs and Indic/Marathi quality before recommending one.

**My recommendation:** send Vaani the questions in B today (it costs nothing), and plan on **A** unless their answer is clearly better. Either way, ask them to confirm Marathi and whether dashboard webhooks are signed; until confirmed, I'll protect `/api/voice/events` with a secret URL token *and* re-fetch `GET /call_details/{id}` from Vaani rather than trusting the payload.

Smaller Vaani notes: `call_duration` is seconds in `call_ended` but ms in `call_postprocessing`; call cost is in credits → `rates` gets a `vaani_credit` → INR row; max call length is configurable (set 5 min hard cap + a soft wrap-up at 4:15).

---

## 2. Other APIs — what I found

### Cal.com API v2
- Slots: `GET /v2/slots` (`cal-api-version: 2024-09-04`), `eventTypeId`, `start`/`end` UTC, `timeZone=Asia/Kolkata`. Works for team round-robin event types.
- **⚠ differs from brief:** slots don't say *which* designer is free; the assigned host is only known after booking (`booking.hosts[]`). Fine for round-robin, but the agent can't say "with Priya on Thursday" — only the time.
- Booking: `POST /v2/bookings` — **attendee `email` is required** (confirmed) → `leads+<lead_id>@<STUDIO_DOMAIN>` placeholder as the brief planned. `attendee.phoneNumber` (E.164), `bookingFieldsResponses` and `metadata` (lead_id, call_id) supported.
- Webhooks: BOOKING_CREATED / CANCELLED / RESCHEDULED / NO_SHOW_UPDATED / MEETING_ENDED etc. Signature: `x-cal-signature-256` = HMAC-SHA256(raw body, secret).
- Cal.com's own SMS workflows go via Twilio with generic templates — **not DLT-registered, won't reliably deliver in India.** We send all SMS ourselves. Turn off Cal.com SMS reminders on the event types (or `phoneNumber` becomes mandatory and SMS gets blocked).
- "Consultation held" for the funnel: use `MEETING_ENDED` (Cal Video only) or, more reliably, the designer moving the HubSpot deal to "Consultation held". I'll use HubSpot as source of truth for held/won.

### HubSpot
- Private app token: contacts, deals, pipelines, properties via CRM v3.
- **Webhooks from a standalone (legacy) private app are GA** — subscribe to `deal.propertyChange` on `dealstage`. Subscriptions are configured in the HubSpot UI (one-time setup step in the runbook). Signature: v3 (`X-HubSpot-Signature-v3` + timestamp, HMAC-SHA256 with client secret, reject >5 min). I'll verify the actual version header on the first test delivery.
- **⚠ differs from brief:** workflows need Pro, and the workflow "Send webhook" action needs **Data Hub Pro**. We don't need workflows at all — the private-app webhook covers review approvals.
- **⚠ Pipelines:** Free = default pipeline only; Starter = 15 pipelines. Custom deal properties: Free is very limited, Starter ~1,000. I need ~15 custom properties → **Starter**.
- Phone lookup: HubSpot search matches on normalised national numbers — search without `+91`. I'll also store a custom unique property `aangan_phone_e164` and use `batch/upsert` with `idProperty` = that, which avoids duplicate contacts.

### Telegram Bot API
- Inline keyboards → `callback_query` on our webhook; verify `X-Telegram-Bot-Api-Secret-Token` (set via `setWebhook secret_token`). `callback_data` ≤ 64 bytes → `apr:<lead_id>` / `rej:<lead_id>`; details in Postgres.
- Reviewer attribution: `callback_query.from.id` → mapped to a designer row.
- **A bot cannot DM a designer who hasn't pressed Start.** Onboarding = each designer opens `t.me/<bot>?start=<token>` once; we store their `chat_id`. Until then, notes go to the designers' group.

### SMS (India) — needs a separate `SmsProvider`
- **TRAI DLT is mandatory:** entity registration (PAN/GST), a 6-char header (e.g. `AANGAN`), and every template registered with `{#var#}` placeholders. Since Oct 2024 **any URL in an SMS must be whitelisted** — so the Cal.com booking link must be on a whitelisted domain (I'll serve it as `https://<STUDIO_DOMAIN>/b/<code>` redirecting to Cal.com). ~1 week end-to-end.
- Templates to register: booking confirmation, booking link (after 2 failed callbacks), review-reject close, complaint callback acknowledgement. Exact text needs founder sign-off because it's frozen once registered.
- Recommendation **MSG91** (REST, template_id + vars, DLR webhook, ₹0.20–0.25 + GST). Exotel is a fine alternative if you'd rather also use them for telephony. Twilio works but ~30× the price.

### Gemini
- `usageMetadata`: `promptTokenCount`, `candidatesTokenCount`, `thoughtsTokenCount`, `cachedContentTokenCount`, `totalTokenCount`. **Thinking tokens bill as output** → cost = prompt × in_rate + (candidates + thoughts) × out_rate. Rates come from the `rates` table.
- Structured output via `responseMimeType: application/json` + `responseJsonSchema` — I'll have Gemini return `{claims:[{text, metric_key, panel}]}` so each sentence links to a panel and we can check its figures against the snapshot.
- Model from `GEMINI_MODEL`; default suggestion `gemini-3.5-flash-lite` (cheap; this is a ~2k-token job). `gemini-2.5-*` is legacy — don't use.

### Resend
- Needs a verified sending domain (SPF/DKIM on `STUDIO_DOMAIN`). Free tier (100/day) is plenty for one digest/day.

### Vercel
- Use `after()` (Next.js ≥15.1) so the webhook acks Vaani immediately and the handoff (HubSpot + Telegram) runs right after — well inside the 2-min SLA and the 300 s function limit.
- Cron: daily 8am digest + daily insights fit Hobby, but **Pro** is needed (commercial use, and the drop-recovery/retry sweeper wants a per-minute cron).
- Note: Vercel cron runs in UTC → 8am IST = `30 2 * * *`.

---

## 3. Architecture

```
caller ──► Vaani (telephony/STT/LLM/TTS)
              │  tool calls (HTTPS, signed)          post-call webhook (signed)
              ▼                                        ▼
        /api/voice/tools/*  ──► lib/qualify      /api/voice/events
              │                 lib/integrations     │  store call+transcript+extraction
              │                 (calcom, hubspot)    │  price-leak scan · cost rows
              ▼                                      ▼  after(): HubSpot upsert → Telegram note
        Neon Postgres ◄──────────────────────────────────┘
              ▲     ▲                          ▲
  /api/telegram/callback   /api/hubspot/webhook   /api/calcom/webhook
              │
   approve → Cal.com slots → VoiceProvider.placeOutboundCall (×3) → SMS link fallback
```

Key design points
- **Channel-agnostic core.** `lib/qualify`, `lib/schema`, booking and handoff take a `LeadInput` (no Vaani types). Vaani-specific code lives only in `lib/voice/vaani.ts`.
- **The server decides, the agent proposes.** `check_scope` and `evaluate_lead` run hard rules + budget gate server-side and return `{outcome, say_hint}`. The agent never sees pricing; the server only returns e.g. `budget_misaligned: true` and a fixed, number-free script line.
- **pricing.md is never in the agent bundle.** `/agent` is built from `seed/services.md` + `seed/qualified.md` only; a CI test fails if any pricing figure (₹1,800, 2,400, "3.5 lakh", etc.) appears anywhere under `/agent` or in the deployed agent config.
- **Idempotency.** Every webhook keyed on the provider's event id (`webhook_events` table, unique constraint) so retries are no-ops.
- **Time.** All times stored UTC, displayed and reasoned in `Asia/Kolkata`. Office hours / after-hours from `config`.

### Extra table (beyond §7 of the brief)
- `webhook_events (provider, event_id, received_at, status)` — idempotency + retry visibility.
- `designers (id, name, telegram_chat_id, calcom_user_id, hubspot_owner_id, role)` — reviewer attribution and "by designer" panel.
- `insights` (as specified in brief §8).
- `outbound_attempts (lead_id, purpose, attempt_no, provider_call_id, result)` — drop-recovery and approval callbacks.

---

## 4. Qualification — issues found while reading the seed data

1. **Budget floor for partial homes.** The brief's T10 example (₹1.5 L vs ₹7 L floor) only works with the **per-room** rule (kitchen + bedroom = 2 × ₹3.5 L), not "residential partial = sq ft × ₹1,800" (550 × 1,800 = ₹9.9 L — and 550 is the whole flat, not the designed area). Proposed rule:
   - full home → `carpet_sqft × 1,800`
   - partial with rooms enumerated → `rooms × 3,50,000` (kitchen counts as a room)
   - partial with only an area given → `area × 1,800`
   - commercial → `sqft × 1,200`
   T10: 1.5 / 7 = 0.21 → **reject at 0.70** ✓ (and would wrongly pass at 0.20, as the brief warned).
2. **T18 label vs rule.** With `COMMERCIAL_MIN_SQFT=500` as a hard rule, T18 (180 sq ft pod) is **declined**, not review. Since the minimum is unconfirmed, I propose: below-minimum commercial → **`review`** (hard-rule *soft fail*) until the founder confirms 500; then flip it to a hard decline and relabel T18. The front desk actually declined it.
3. **Service area isn't a closed list.** `services.md` says "and adjoining areas". **T10 is in Kharadi**, which isn't named. Locality + PIN must both be checked: PIN in allowlist → in area; locality on denylist (Talegaon, Lonavala, Nashik, Mumbai, other cities) → hard decline; neither matches → `in_area = unclear` → agent asks one direct question (rubric) → still unclear → `review`, never auto-decline.
4. **Timeline rule has two parts.** I'll encode (a) required completion date ≥ today + 6 weeks, else hard fail; (b) caller can make the site available within 8–10 weeks of consultation. T07 (Diwali in 3 weeks) fails (a) — but the front desk then offered a November start. The agent will do the same: offer a later start once; if accepted, re-evaluate. Label stays **declined** for the as-recorded call.
5. **T04** is both "advice-only" (hard rule) and "just exploring" (redirect). Hard rule wins → **declined** ✓.
6. **`ASK_BUDGET=true` conflicts with the rubric** ("Don't quote. Don't probe."). Default kept per brief; settings page flags it as "needs founder sign-off". I recommend the founder sets it to `false`.
7. **Eval coverage gaps.** No phone case exercises `redirect`, "uncertain area", budget-tight, after-hours booking, Hindi/Marathi, or a price-pushing caller beyond T02/T13. I'll add **synthetic cases** (clearly marked `synthetic: true`, separate score) adapted from W10 (redirect), F03 (Talegaon), F08 (3-week deadline), F06 (budget tight-ish), plus code-mixed Hindi/Marathi rewrites of T01/T17. Real-transcript accuracy and synthetic accuracy are reported separately.

### Proposed eval labels (phone, T01–T20)

| Case | Label | Notes / flags |
|---|---|---|
| T01 | qualified | Kothrud, 1,400 sq ft, March |
| T02 | qualified | asked about price twice → `asked_price=yes`; Wakad |
| T03 | declined | area (Nashik) |
| T04 | declined | advice-only |
| T05 | qualified | decision-maker unclear (referral caller) → flag; site visit event type |
| T06 | qualified | commercial 800 sq ft, Baner; founder |
| T07 | declined | timeline (Diwali, 3 weeks) |
| T08 | excluded | no content |
| T09 | complaint | → senior callback, URGENT |
| T10 | declined | budget (₹1.5 L vs ₹7 L floor); Kharadi must resolve as in-area |
| T11 | qualified | rented, no structural |
| T12 | qualified | 5,500 sq ft villa; site visit |
| T13 | qualified | asked about price |
| T14 | qualified | decision-maker flag (son for parents) |
| T15 | qualified | possession in 6 weeks |
| T16 | qualified | repeat caller, frustrated → Watch for; timeline unclear |
| T17 | qualified | dropped call → callback path |
| T18 | review | 180 sq ft pod (see issue 2) |
| T19 | declined | restaurant |
| T20 | qualified | Magarpatta |

---

## 5. Cost model
Per call: `voice_minutes` (+ Vaani LLM/extraction line items if billed separately), `telephony` (if separate), `sms` (count × rate). Per insights run: `gemini_insights` from `usageMetadata`. All rates from `rates` (effective-dated); raw usage jsonb kept. Dashboard: cost per call / qualified lead / booking.

---

## 6. Phases (unchanged from brief, with what you'll review at each stop)

| Phase | Deliverable you review |
|---|---|
| 2 Foundations | repo, CI, migrations, config + rates seed, `lib/qualify` + unit tests, PIN allowlist, eval harness on labelled cases (text-simulation mode) |
| 3 Voice agent | agent prompt + tool schemas, webhook routes, `check_scope`, extraction, booking; **5 simulated transcripts**; price-leak adversarial suite |
| 4 Handoff/review | HubSpot sync, Telegram note + buttons, approve → outbound call → SMS fallback, reject SMS |
| 5 Cost/dashboard | cost rows, all panels, Gemini insights, settings, digest |
| 6 Hardening | retries/idempotency, ops alerts, README runbook |

## 7. Things to start in parallel (long lead times, outside code)
1. **DLT registration** (entity, `AANGAN` header, 4 templates, URL whitelist) — ~1 week.
2. HubSpot **Starter**, private app + webhook subscription.
3. Cal.com **Teams**, 3 round-robin event types, designers added.
4. Vaani account + Indian number (see §1).
5. Verified domain for Resend + SMS short links.
6. Each designer presses Start on the Telegram bot.

## 8. Sources
- Cal.com: cal.com/docs/api-reference/v2/slots, …/v2/bookings/create-a-booking, cal.com/docs/developing/guides/automation/webhooks, cal.com/pricing, cal.com/help/workflows/credits
- HubSpot: developers.hubspot.com/docs/apps/legacy-apps/private-apps/create-and-edit-webhook-subscriptions-in-private-apps, …/authentication/validating-requests, knowledge.hubspot.com/workflows/how-do-i-use-webhooks-with-hubspot-workflows, knowledge.hubspot.com/object-settings/set-up-and-customize-pipelines, developers.hubspot.com/docs/api-reference/search/guide
- Telegram: core.telegram.org/bots/api
- DLT/SMS: msg91.com/in/pricing/sms, docs.msg91.com/sms, developer.exotel.com/api/sms, twilio.com/en-us/sms/pricing/in
- Gemini: ai.google.dev/gemini-api/docs/models, …/pricing, …/structured-output
- Resend: resend.com/pricing, resend.com/docs/dashboard/emails/schedule-email
- Vercel: vercel.com/docs/cron-jobs/usage-and-pricing, vercel.com/docs/functions/limitations, vercel.com/docs/plans/hobby

---

## 9. Phase 2 — Foundations (built, awaiting your review)

| Item | Where | Status |
|---|---|---|
| Repo, Next.js 16 (App Router, TS), lint, typecheck | root | ✓ |
| CI: lint, typecheck, unit tests, seed-SQL drift check, eval | `.github/workflows/ci.yml` | ✓ (not yet run on GitHub — no remote) |
| Postgres schema on **Neon** (brief §7 + designers, profiles, webhook_events, outbound_attempts, insights) | `db/migrations/`, `npm run db:migrate` | ✓ applied to Neon `production`; RLS tested in PGlite **and** verified on Neon |
| RLS: founder all; designer = review queue + own leads (role `app_user` + `app.user_id`; Neon Auth ids) | `db/migrations/…_rls.sql`, `lib/db/as-user.ts`, `tests/db.test.ts` | ✓ |
| Config + rates seed (single source → `seed.sql`) | `db/seed/*.json`, `db/seed.sql` | ✓ |
| Shared lead extraction schema (+ JSON Schema export for LLMs) | `lib/schema/lead.ts` | ✓ |
| Qualification: hard rules, service area, budget floor/gate, decision bands | `lib/qualify/` | ✓ |
| PIN allowlist for review | `docs/service-area-review.md` | ✓ — **needs your review** |
| Price-leak scan (agent turns only, budget-echo exemption) | `lib/compliance/price-scan.ts` | ✓ |
| Pricing isolation guard (no figures / floor imports under `/agent`, `lib/voice`) | `tests/pricing-isolation.test.ts` | ✓ (active once Phase 3 adds those dirs) |
| Eval: 19 labelled real + 8 synthetic cases, confusion matrix, CI gate | `eval/` | ✓ fixture mode — **labels need your approval** (`eval/LABELS.md`) |

Commands: `npm test` · `npm run eval` · `npm run typecheck` · `npm run lint` · `npm run seed:sql`

---

## 10. Phases 3–6 — built 2026-10-07 (no Vaani credit used, nothing deployed)

| Phase | What's in place | Verified by |
|---|---|---|
| 3 Voice agent | Prompt v1 (`agent/prompt.ts`), 9 tools (`agent/tools.ts`), dialogue brain with Gemini function calling (`lib/brain/`), pre-speech price guard, Vaani BYOL WebSocket server (`server/brain-server.ts`), `VoiceProvider` + Vaani adapter + simulated provider, post-call LLM extraction, booking via Cal.com or mock | Unit tests; the BYOL server tested over its real protocol with a fake Vaani client; 5 review transcripts in `eval/simulations/`; LLM eval; price-leak suite |
| 4 Handoff/review | HubSpot sync (Free tier: default pipeline, lead fields in the description and a note), Telegram note in the brief's exact format with Approve/Reject buttons, senior URGENT path for complaints, review decisions from Telegram, HubSpot or the dashboard, approval → outbound booking call (with retries) → SMS link fallback, Cal.com webhook, console SMS log | Note-format tests; review/RLS tests; webhook route tested end to end on the local server |
| 5 Cost/dashboard | Cost rows per call (voice minutes, telephony, dialogue LLM, extraction LLM, SMS) from effective-dated rates; ₹20 Vaani spend cap; SQL metrics for every panel; Gemini weekly narrative with figure verification; founder dashboard, review queue, leads, lead detail, settings; daily digest; Neon Auth login | Cost tests; metrics run against Neon; dashboard checked in the browser |
| 6 Hardening | Signature or token checks on every webhook; idempotency (`webhook_events`, no duplicate leads); retries with backoff; Gemini key fallback; ops alerts to Telegram; README runbook; CI (fixture eval always, LLM eval and price suite when a key secret is set) | Duplicate-delivery and bad-token checks against the running route |

### Results (Gemini free tier, text simulation)
- **LLM eval on the 19 real transcripts:**
  - Outcome correct on 18 of 19.
  - All checks passed on 16 of 19. The other two misses were flag-only (T02, T05).
  - **No labelled decline or complaint flipped.**
  - The one wrong outcome is T16, which I relabelled to review; the model says qualified.
  - Synthetic cases: 8 of 8.
- **Price-leak suite (10 adversarial lines):** 0 drafts contained a price, and 0 prices were spoken.
- **Simulated calls:** 5 showcase calls plus 16 more. Median simulated length is about 1:45, with none over 5 minutes, so the ≤3.5-minute median and ≤5-minute maximum targets are met in simulation. Handoff note sent about 7 s after the call ended (target: within 2 minutes).
- **Turn latency is about 3 s on the free tier, too slow for natural voice.** See the open issues below.

### Bugs found by testing and fixed
1. A confirmed low budget was sent to review instead of declined (unit test).
2. The server overrode an agent's timeline "fail" when it couldn't resolve a date ("before Diwali").
3. Budget confirmation was left to the model's judgement; it's now checked against the transcript.
4. The agent declined on budget without first repeating the figure back (T10 simulation). This is now enforced server-side.
5. The price guard blocked a legitimate budget confirmation because it only looked at the caller's last turn.
6. The agent put the possession date into "completion by" and couldn't correct it afterwards (T15).
7. A frustrated new caller was escalated as an existing-client complaint (T16).
8. Handoff latency came out negative for simulated calls. It's now measured from when the pipeline received the call.
9. Postgres 16 role membership (`app_user`), caught only on real Neon.

### Open issues / decisions for you
- **Latency:** each turn takes about 3 s (the model is often called 2–3 times per turn, and the free tier is slow). For real calls: stream tokens, cache the prompt, use a faster key or tier, and reduce tool rounds.
- **Timeline rule (T07):** with the real Diwali date, "before Diwali" passes the 6-week rule. The founder should decide whether to require design time plus minimum execution time (about 11 weeks).
- **Confidence calibration:** the model's self-reported confidences are mostly 1.0 or 0.0, so 0.80 is not a calibrated threshold. The structured rules and criteria carry the decisions. Track the review approval rate before tuning.
- **Transfer to the front desk:** Vaani's warm transfer is a native tool. It isn't documented as callable from BYOL, so redirect callers get a callback task.
- **Language mirroring:** a Hindi adversarial line got an English reply. Hinglish callers in simulation were understood.
- **Unconfirmed in Vaani's docs:** webhook signing for dashboard webhooks, Marathi support, and whether creating an agent costs credit.
