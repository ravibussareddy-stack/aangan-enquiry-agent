# Aangan Studio — AI phone enquiry agent

An AI voice agent that answers every enquiry call to Aangan Studio, Pune. It qualifies the caller against the founder's rubric and books a designer consultation during the call. It sends the designer a handoff note and logs every call, with its cost, to a founder dashboard.

> **Academic case study, built at zero cost.** Calls are text-simulated by default (`VOICE_PROVIDER=simulated`). Real Vaani calls are capped at ₹20 in total (`VOICE_SPEND_CAP`). Customer SMS is logged, not sent. Nothing is deployed.

## How it works

```
caller ─► Vaani (phone, STT, TTS) ──BYOL WebSocket──► functions/brain (Neon Function: our dialogue brain)
                │                                       │  Gemini + function calling
                │                                       │  tools: lib/brain/tools.ts → lib/qualify (server decides)
                │                                       │  pre-speech price guard → never speaks a price
                │ webhooks                              ▼
                └──────────────► app/api/voice/events ─► lib/calls/postcall.ts
                                                         price-leak scan → LLM extraction → evaluateLead
                                                         → Neon (calls, leads, criteria, bookings, costs)
                                                         → handoff: HubSpot + staff email (Gmail) + customer SMS
Email action links / HubSpot stage / dashboard ─► lib/review/decide.ts ─► outbound booking call (sweep)
```

Vaani documents neither mid-call tool calling nor JSON-schema extraction (see [PLAN.md §1](PLAN.md)). So the dialogue runs in our own brain over Vaani's bring-your-own-LLM (BYOL) WebSocket, and extraction runs server-side.

| Path | What |
|---|---|
| `agent/` | Voice agent prompt (versioned, no prices) and tool schemas |
| `lib/qualify/` | Hard rules, service area, budget floor and gate, decision bands |
| `lib/deal-health/` | **Deal health**: a deterministic 0–100 rubric for qualified/approved leads, shown on the dashboard and as the HubSpot deal priority ([docs/deal-health-rubric.md](docs/deal-health-rubric.md)) |
| `lib/qualify/routing.ts` | Not enough captured on the call → **Callback needed** for the helpdesk |
| `lib/intake/sheet.ts` | **Intake sheet**: every field a call must capture, with its question; drives the agent, the gating, the designer note and [docs/intake-sheet.md](docs/intake-sheet.md) |
| `lib/schema/lead.ts` | Shared lead extraction schema (agent, server, eval) |
| `lib/brain/` | Dialogue turn loop, tool executor, pre-speech price guard |
| `lib/voice/` | `VoiceProvider` interface, Vaani adapter, simulated provider |
| `lib/calls/postcall.ts` | Post-call pipeline |
| `lib/handoff/`, `lib/staff/`, `lib/integrations/` | Staff email notes with signed action links (Gmail), HubSpot, Cal.com, Resend; Telegram as a legacy fallback |
| `lib/sms/` | `SmsProvider` (console or MSG91); Vaani has no SMS |
| `lib/cost/` | Usage → ₹ from the effective-dated `rates` table; Vaani spend cap |
| `lib/insights/` | SQL metrics, Gemini narrative (figures checked against the snapshot), daily digest |
| `app/dashboard/` | Founder dashboard, review queue, leads, settings |
| `app/api/` | Webhooks (voice, HubSpot, Cal.com, legacy Telegram) and cron routes. `app/r/[token]` is the confirm page for emailed action links |
| `db/` | Migrations, seed config and rates (Neon Postgres) |
| `eval/` | 20 real and 8 synthetic labelled cases, runner, price-leak suite, simulations |

## Setup runbook

### 1. Local

```bash
npm install
```

Neon is already linked (`.neon`). `neon env pull` writes `DATABASE_URL*` and `NEON_AUTH_*` into `.env.local`. Copy any remaining keys from `.env.example` into `.env.local`; it is git-ignored, so never paste keys anywhere else.

```bash
npm run db:migrate
```

```bash
npm run dev
```

Open http://localhost:3000. Sign up with the email in `FOUNDER_EMAILS` to get the founder role. Designers sign up with an email listed in `DESIGNER_EMAILS` (`email:Designer Name`).

### 2. Check everything

```bash
npm test
```

```bash
npm run eval
```

```bash
npm run eval -- --mode llm
```

```bash
npm run eval:price
```

```bash
npm run sim -- --showcase
```

```bash
npm run preflight
```

```bash
npm run rehearsal
```

- `npm test`: unit tests plus migrations/RLS on an in-process Postgres.
- `npm run eval`: fixture mode. Deterministic, runs in CI.
- `--mode llm`: extracts from the raw transcripts with Gemini (free tier). Prints accuracy and the confidence calibration table.
- `eval:price`: 10 adversarial "tell me the price" lines.
- `sim -- --showcase`: the 5 review transcripts, written to `eval/simulations/`.
- `preflight`: read-only readiness checklist for a live call. It never places a call.
- `rehearsal`: a full live-call dress rehearsal without Vaani. It drives the BYOL protocol and the webhooks, and needs `npm run dev`.

Add `--persist` to `npm run sim` to push simulated calls through the real pipeline into Neon, so the dashboard has data.

### 3. Integrations (all optional; each falls back to a console log or mock)

| Service | Set | Notes |
|---|---|---|
| Gmail (staff email) | `GMAIL_USER`, `GMAIL_APP_PASSWORD`, `DESIGNER_EMAILS`, optional `STAFF_EMAIL_*` | Turn on 2-Step Verification for the sending Gmail account, then create an App Password (Google Account → Security → App passwords). Designers get their own leads; review, callback, complaint and ops emails go to the groups in `.env.example`. Approve / Reject / route links open a confirm page, so a mail scanner opening a link changes nothing. Also sends the daily digest. Telegram (`TELEGRAM_*`) is only used if no email is configured. |
| HubSpot (Free) | `HUBSPOT_PRIVATE_APP_TOKEN`, `HUBSPOT_CLIENT_SECRET`, `HUBSPOT_PORTAL_ID` | Rename the default deal pipeline's stages to: New qualified, Callback needed, Service review, Admin review, Booked, Consultation held, Won, Lost, Declined. Moving a deal between New qualified, Service review (designers), Admin review, Callback needed (helpdesk) and Declined routes the lead. Deal health is written to the built-in Priority field. In the private app, subscribe to deal property change → `dealstage` → `<APP_BASE_URL>/api/hubspot/webhook`. |
| Cal.com (Free) | `CALCOM_API_KEY`, `CALCOM_EVENT_TYPE_*`, `CALCOM_WEBHOOK_SECRET`, `CALCOM_BOOKING_URL` | Three event types: residential consult, commercial consult, site visit. Webhook → `/api/calcom/webhook`. Turn off Cal.com's own SMS reminders (no DLT). |
| Resend | `RESEND_API_KEY`, `DIGEST_FROM`, `DIGEST_TO` | Daily digest at 8am IST. |
| SMS | `SMS_PROVIDER=msg91` + `MSG91_*` | Only after DLT registration: entity, header, the 4 templates, and a whitelisted URL domain. |

### 3a. Deploy the app and dashboard on Vercel

1. **Import the repo** in Vercel (Framework: Next.js; the defaults are fine). Vercel Hobby works because this is non-commercial, and the two daily crons in `vercel.json` fit Hobby: the AI summary at 10 pm IST (16:30 UTC) and the email digest at 8 am IST. Hobby runs a cron at some point within its scheduled hour, so the summary lands between 10 and 11 pm.
2. **Environment variables.** Copy these from `.env.local` into Vercel → Settings → Environment Variables:
   - **Always:** `DATABASE_URL`, `DATABASE_URL_UNPOOLED`, `NEON_AUTH_BASE_URL`, `NEON_AUTH_JWKS_URL`, `NEON_AUTH_COOKIE_SECRET`, `FOUNDER_EMAILS`, `GEMINI_API_KEYS`, `GEMINI_MODEL`, `CRON_SECRET`, `VAANI_WEBHOOK_TOKEN`, `VOICE_PROVIDER` (`simulated` until the live test).
   - **`APP_BASE_URL`:** your Vercel URL, e.g. `https://aangan.vercel.app`.
   - **When you have them:** the Gmail, HubSpot, Cal.com and Vaani (`VAANI_API_KEY`, `VAANI_AGENT_ID`) keys.
   - **Never set `DEV_VIEWER_ROLE` on Vercel.** It only works under `next dev`, but leave it out regardless.
3. **Trust the domain in Neon Auth**, or sign-in fails with "invalid domain":

   ```bash
   neon neon-auth domain add https://<your-app>.vercel.app
   ```
4. **Sign in** at `https://<your-app>.vercel.app` with the email in `FOUNDER_EMAILS`.
5. **Webhooks point at the Vercel URL:**
   - Vaani: `/api/voice/events?token=<VAANI_WEBHOOK_TOKEN>`
   - HubSpot: `/api/hubspot/webhook`
   - Cal.com: `/api/calcom/webhook`
6. **The brain runs on a Neon Function, not Vercel** (Vercel can't hold a WebSocket open for a whole call). It is declared in `neon.ts` and deployed with `neon deploy --env .env.local`, which gives a permanent `wss://<branch>-brain.compute.…neon.tech` address next to the database — no laptop or tunnel. Point Vaani's BYOL URL at `wss://…/chat/stream` with `BRAIN_AUTH_TOKEN` as the auth token. Free plan: 10 active / 400 waiting capacity-hours and 1M invocations a month. `npm run brain` still runs the same handler locally for offline work.
7. **The per-minute sweep** (`/api/cron/sweep`) isn't in `vercel.json`, because Hobby only allows daily crons. Call it from a free scheduler, such as a Neon Function cron trigger or cron-job.org, with `Authorization: Bearer <CRON_SECRET>`.

### 3b. Phone line (overflow only)

Set conditional forwarding on the office line so the AI only takes calls when staff are busy, don't answer, or the office is closed. See [docs/telephony-overflow.md](docs/telephony-overflow.md).

### 4. Live voice (spends Vaani credit — capped at ₹20)

1. Deploy the brain (Neon Function) and note its URL:

   ```bash
   neon deploy --env .env.local
   ```

   Set `BRAIN_WS_URL=wss://<function-host>/chat/stream` in `.env.local`, and `BRAIN_AUTH_TOKEN`.
2. Dry-run the agent setup:

   ```bash
   npm run vaani:setup
   ```

   Then apply it:

   ```bash
   npm run vaani:setup -- --apply --byol wss://<tunnel>/chat/stream
   ```

   Put the printed id in `VAANI_AGENT_ID`. If the BYOL URL doesn't stick, set it in the Vaani dashboard: Agent → Brain → LLM → BYOL, with the auth token.
3. In Vaani → Settings → Webhooks, add `<public app url>/api/voice/events?token=<VAANI_WEBHOOK_TOKEN>`.
4. Set `VOICE_PROVIDER=vaani`. The spend cap blocks every call once ₹20 of logged voice cost is reached.
5. Run the sweep every minute: a Neon Function cron trigger, or any scheduler, calling `GET /api/cron/sweep` with `Authorization: Bearer $CRON_SECRET`.

### 5. Hardening (Phase 6)

- **Signed, expiring action links** in staff emails (HMAC, 14 days, confirm before acting).
- **Signatures and tokens on every webhook:** Vaani (HMAC or secret path token), HubSpot (v3 HMAC, 5-minute window), Cal.com (HMAC-SHA256), and cron (bearer).
- **Idempotency:** each delivery is processed once (`webhook_events`), failures are recorded and retried, and the post-call pipeline never creates two leads for one call.
- **Retries:** outbound HTTP retries with backoff and `Retry-After`. Gemini falls back across `GEMINI_API_KEYS`.
- **Ops alerts:** a failed webhook, handoff, outbound call or brain turn emails the ops group (`STAFF_EMAIL_OPS`, default the founder), or logs to the console when Gmail is unset.
- **Two layers of authorization:** checks in the server code, then Postgres RLS (`app_user` + `app.user_id`) as defence in depth.

## Rules this system enforces

1. **Never states a price.**
   - Prices are never in the prompt.
   - Every reply passes a pre-speech guard.
   - A post-call leak scan sets `price_leak`, which shows on the dashboard.
   - CI checks that pricing figures never enter `/agent`.
2. **States it is an AI and that the call is recorded**, in the first sentence.
3. **No auto-decline on uncertainty.** Declines only on a hard rule, out-of-scope confidence ≥ 0.80, or 2+ failed criteria.
4. **Staff get email, customers get SMS.** Customers are never emailed or messaged on Telegram.
5. **Secrets only in env vars.** Every webhook is verified.
