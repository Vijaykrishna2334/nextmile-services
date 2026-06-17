# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

> **⚡ RESUMING WORK? READ `docs/superpowers/SESSION-HANDOFF.md` FIRST.**
> It has the full current state of the WhatsApp automation + admin hub project:
> what's live, the Interakt Growth-plan inbound-message limitation (settled — don't
> re-investigate), the cost model, all files added, and the next actions. As of 2026-06-17.

## Commands

```bash
npm run dev        # Development — tsx watch (hot reload)
npm run start      # Production — tsx src/server.ts
```

No build step — `tsx` runs TypeScript directly. No test runner configured.

TypeScript is strict mode (`"strict": true`). No linter configured in package.json.

---

## Architecture

Express.js backend (TypeScript, Node 22, `tsx`). No compilation to dist — runs source directly via `tsx`.

### Request Flow

```
POST /api/chat  →  chatRouter  →  trackOrder() [if order ID detected]
                               →  Google Discovery Engine [all other Q&A]

POST /api/track →  trackRouter →  trackOrder() [direct lookup]
```

### Key Cross-File Concepts

**Google Auth (`src/utils/google-auth.ts`)** — Single shared utility used by every service that calls a Google API. Takes an env var name (e.g. `'CHATBOT_SERVICE_ACCOUNT_JSON'`) and a scope string, builds a self-signed JWT, exchanges it for a Bearer token. Two separate service accounts are used:
- `CHATBOT_SERVICE_ACCOUNT_JSON` — Discovery Engine + Sheets (chat + tracking)
- `GOOGLE_SERVICE_ACCOUNT_JSON` — Sheets + Gmail (email pipeline)

**Chat bot (`src/routes/chat.ts`)** — The main bot logic. Three-phase dispatch:
1. Greeting → instant hardcoded reply
2. Order ID detected → `trackOrder()` → feed result to Gemini for natural language response
3. Everything else → Google Discovery Engine (`gemini-2.5-flash/answer_gen/v1`)

The bot has two knowledge layers:
- `KNOWLEDGE` constant (inline in chat.ts) — injected as preamble into every Discovery Engine request
- `nextmile_chatbot_knowledge_base.txt` — uploaded to Discovery Engine data store separately

Both must be updated when challenge info changes. Updating only `chat.ts` doesn't update the Discovery Engine KB and vice versa.

**Tracking (`src/services/track.service.ts`)** — Looks up order ID or AWB in the "Nimbus Shipping" tab of Google Sheet `1x2jqCRMBSguFjQXYdMc1SZMyGHVyZOVIt_zUZaht2TM`. Column indices are hardcoded constants at the top of the file (`COL_ORDER_ID=0`, `COL_AWB=13`, etc.) — if sheet columns shift, update those constants.

**Email pipeline (`src/services/draft.service.ts`, `src/cron/email-drafts.ts`)** — Cron job runs every 30 min (Asia/Kolkata). Reads support inbox via Gmail API, auto-drafts replies. Uses `GOOGLE_SERVICE_ACCOUNT_JSON` with domain-wide delegation (subject = support@gonextmile.in).

**MongoDB (`src/db/`)** — Used only for the email/registration pipeline. Not used by chat or tracking. Mongoose models: `Registration`, `Event`, `EmailLog`, `Submission`, `StravaConnection`. If MongoDB is unavailable, the server still starts — chat and tracking work without it.

### CORS Split

`/api/chat` and `/api/strava/webhook` and webhook endpoints use `origin: '*'`. All other routes restrict to specific origins (gonextmile.in, ops.gonextmile.live, localhost). This is intentional — the chat widget is embedded on the Shopify storefront.

---

## Deployment

- **Server:** DigitalOcean — `/var/www/nextmile-services` (not /root/)
- **Process:** PM2 (`pm2 restart nextmile-services`, `pm2 logs nextmile-services`)
- **Repo:** `https://github.com/Vijaykrishna2334/nextmile-services.git`
- **Deploy:** `git fetch origin master && git checkout origin/master -- src/routes/chat.ts && pm2 restart nextmile-services`

---

## Environment Variables

| Variable | Used By |
|---|---|
| `CHATBOT_SERVICE_ACCOUNT_JSON` | chat.ts (Discovery Engine + Sheets) |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | track.service.ts, gmail.service.ts |
| `MONGODB_URI` | db/connect.ts |
| `PORT` | server.ts (default 3001) |

---

## Google Discovery Engine (Chatbot KB)

- Project: `963603495843`
- Engine: `nextmile-support-bot_1777555638876`
- Collection: `default_collection`
- To update KB: edit `nextmile_chatbot_knowledge_base.txt` → upload to GCS → re-import in Discovery Engine console

---

## Bot Rules (Never Change Without Review)

- **No prices** — never state a price, redirect to event page
- **No sold out / expired** — all events are 30 days from registration, no fixed end date
- **Conquest Ride** — always mention both 10KM and 25KM options
- **Tracking** — handles Shopify (4-5 digit), Townscript, and IndiaRunning (6-digit) order IDs via same regex `\d{4,}`

---

## Active Challenge URLs

Base: `https://gonextmile.in`

| Challenge | Path | Tally Submit |
|---|---|---|
| Miles for Mom | /products/miles-for-mom-3k-5k-10k-run | tally.so/r/MevAjE |
| Momentum Run | /products/momentum-run-build-the-habit | tally.so/r/MezRkk |
| Women's Run | /products/womens-run-3k-5k-10k-virtual-run-challenge | tally.so/r/eqBrDQ |
| 10K Steps | /products/10k-steps-consistency-challenge | tally.so/r/5B1ZE6 |
| Conquest Ride | /products/conquest-ride-25km | tally.so/r/VLYaY6 |
| Progress Pack | /products/10k-steps-momentum-run-combo | — |
| Endurance Pack | /products/endurance-pack-10k-steps-challenge-25km-cycling | — |
| Performance Pack | /products/performance-pack-5km-run-25km-cycling | — |
| Duo Pack | /products/conquest-ride-25km-cycling-duo-pack | — |
