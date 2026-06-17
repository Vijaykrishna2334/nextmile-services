# NextMile — Session Handoff / Memory

> **Read this first when resuming work on this project.** It captures the full state as of 2026-06-17 so a fresh session has continuity. Owner: Vijay Krishna (Vijaykrishna2334@gmail.com).

## The big picture

NextMile is a virtual fitness-challenge business (gonextmile.in, Shopify storefront). This repo (`nextmile-services`) is an Express/TypeScript backend on a DigitalOcean droplet (`68.183.81.123`, `/var/www/nextmile-services`, PM2 process `nextmile-services`, deployed via `git checkout origin/master -- <files>` + `pm2 restart nextmile-services --update-env`). Repo: https://github.com/Vijaykrishna2334/nextmile-services.

We are building a **WhatsApp support automation + admin hub** on top of the existing chatbot/email infrastructure.

## What's LIVE and working (as of this session)

1. **Sam — website chat widget** on gonextmile.in. Backend `/api/chat` (Discovery Engine, Gemini). Fully updated KB incl. the **100KM in 30 Days Challenge** (aka "Nextman" / "100x"), age-policy deferral, per-day submission rules, "newest event" detection. Knowledge lives in TWO places that must BOTH be updated: inline `KNOWLEDGE` const in `src/routes/chat.ts` AND `nextmile_chatbot_knowledge_base.txt` (the latter must also be re-uploaded to Google Discovery Engine console to take effect there).
2. **Email auto-drafts** — `src/cron/email-drafts.ts`, every 30 min, drafts Gmail replies. Working (MongoDB + Gmail token both fixed this session).
3. **NextMile Hub** (admin UI, built in Lovable, project = "NextMile Hub") — login + dashboard + WhatsApp review + Inbox Alerts tabs. Talks to backend `/api/ops/*` with a Bearer JWT. UI source to paste into Lovable: `docs/superpowers/nextmile-hub-paste-into-lovable.tsx`.
4. **Smart WhatsApp polling + owner alerts** — `src/cron/whatsapp-poll.ts`. Polls Interakt every 30s for users whose `modified_at_utc` changed, sends the owner a WhatsApp alert ("X messaged you, phone, orders"). CONFIRMED WORKING (caught a real message from Rahul Kumar, owner ping ok=true).
5. **Chat origin lockdown** — `/api/chat` restricted to gonextmile.in origins to stop LLM-cost abuse.

## The CRITICAL constraint we discovered (don't re-investigate — it's settled)

**Interakt Growth plan CANNOT receive inbound message content via API.** Confirmed by exhaustive testing + web research:
- `message_received` webhook → locked behind Advanced plan
- Workflow → "Trigger Webhook" step → locked behind Advanced plan
- No REST endpoint returns message text on any tier
- Polling `modified_at_utc` DOES detect that a customer messaged (timestamp updates on real messages — proven), but NOT what they said.
- No add-on unlocks it. Confirmed via direct API tests with the live key.

**Therefore the current design is "alert-assist", not full auto-reply:**
Customer messages → poller detects activity → owner gets WhatsApp alert with name+phone+orders → owner opens Interakt to READ the message → owner pastes it into the Hub → Hub generates an AI reply (with order context) → owner copies it back into Interakt and sends. Human stays in the loop because we cannot read message content.

**To get TRUE auto-reply, two options (user undecided, no rush):**
- (A) Upgrade Interakt to Advanced (~₹5k/mo, zero code change, unlocks the webhook our code already handles at `/api/whatsapp/webhook`).
- (B) Migrate the WhatsApp number to **Meta Cloud API direct** (free forever, native inbound webhooks; one-time ~1-2hr migration; loses Interakt's inbox UI but the Hub replaces it). A WhatsApp number can only be on ONE platform at a time, so this means leaving Interakt — OR testing on a SECOND number first.

## Cost reality (important)

- Polling + the alerts = FREE, **but** owner alerts only deliver while the 24h WhatsApp window with the owner number is open. Keep it open by messaging the business number from the owner phone once/day (an automatic "keep-alive" was offered but NOT yet built).
- "Generate AI reply" = tiny Google Discovery Engine cost (same as the website bot), not a new subscription.
- Interakt API SEND works on Growth (outbound). Only INBOUND is locked.

## Interakt facts

- Plan: **Growth** (₹~6,897/quarter). Wallet ~₹1,100.
- Business WhatsApp number connected to Interakt: **919535213606**.
- Owner alert number: **919182583307** (also appears as "Vijay krishna" in Interakt).
- Public API base: `https://api.interakt.ai/v1/public`. Auth: `Authorization: Basic <INTERAKT_API_KEY>`.
- Confirmed working endpoints on Growth: Send Text (`/message/` type Text), Chat Assignment (`/assignment/`), Get User by phone (`/apis/users/phone_number/<digits>`), Get Users Bulk (`/apis/users/?offset=&limit=` with `modified_at_utc` filter), Track User/Events.
- `.env` has: INTERAKT_API_KEY ends with `=` (don't split on `=` in bash — broke us once), INTERAKT_WEBHOOK_SECRET, INTERAKT_WORKFLOW_SECRET, OWNER_WHATSAPP (no `+`!), WHATSAPP_POLL_ENABLED=true, WHATSAPP_POLL_VERBOSE=true, ADMIN_EMAIL, ADMIN_PASSWORD, SESSION_SECRET, TEST_HOOK_KEY=test123, plus tunables WHATSAPP_ALERT_COOLDOWN_MIN(15), WHATSAPP_BULK_THRESHOLD(6).

## Backend files added this session

- `src/utils/ops-auth.ts` — JWT-ish signed token + `requireOpsAuth` middleware
- `src/utils/origin-lock.ts` — chat origin allowlist
- `src/routes/ops-auth.ts` — `/api/ops/login`, `/me`, `/logout`
- `src/routes/whatsapp.ts` — `/api/whatsapp/webhook` (for if Advanced is ever unlocked) + `/workflow-callback` + `/test-webhook`; shared `processInbound()`
- `src/routes/whatsapp-review.ts` — `/api/ops/whatsapp/*` (flagged, recent, stats/today, inbox/new, inbox/all, inbox/generate-reply, inbox/:id/mark-replied, inbox/:id/ignore, inbox/debug)
- `src/services/interakt.service.ts` — sendTextMessage, assignChat, getUserByPhone, getUsersModifiedSince, sendTemplate (flag-gated stub), verifyWebhookSignature, normalizeInbound
- `src/services/whatsapp-classifier.ts` — generic / order-lookup / order-specific / sensitive
- `src/cron/whatsapp-poll.ts` — the smart poller (cooldown + bulk-suppression)
- `src/db/models/WhatsAppLog.ts`, `WhatsAppActivity.ts`, `LoginAttempt.ts`

## Design docs

- Spec: `docs/superpowers/specs/2026-06-17-whatsapp-support-bot-design.md` (full Phase-1 platform plan: 15 hub features, all 12 Interakt-API use cases, build-all/activate-free-first strategy, flag-gated paid features).
- Deploy guides: `docs/superpowers/SLICE-1-DEPLOY.md`, `SLICE-1.5-SMART-POLLING-DEPLOY.md`.

## Planned but NOT yet built (the "build all, activate free first" roadmap)

Outbound features (all work on Growth, all flag-OFF by default): order confirmation, shipping/dispatch alert, certificate-ready notification, day-20/27 deadline reminders, owner ops-alerts, marketing broadcasts (user has some pre-approved templates), abandoned-cart, win-back. Plus hub features: feature-flag toggle UI, spend tracker, order lookup, KB editor, audit log, health check, scheduled broadcasts, segment builder. Cost-safety: per-feature flags + NotificationLog dedup + MAX_TEMPLATE_SENDS_PER_DAY cap.

## Known loose ends

- There WAS a long-standing uncommitted git mess in the working tree (deleted email templates, modified server.ts/emails.ts from an old stash) — server.ts/emails.ts were reset to committed HEAD this session per user's choice ("keep only what's running"). Other untracked files (strava.ts, registrations.ts, submissions.ts, etc.) remain on disk, unrelated, left alone.
- MCP servers registered globally this session: **firecrawl** (key in ~/.claude.json) and **lovable** (OAuth, needs browser auth on first use in a fresh session).
- Lovable Hub UI: latest `.tsx` (with Inbox Alerts tab) may not yet be pasted into the live Lovable project — verify on resume.

## Next actions when resuming (tomorrow)

1. Message business number (919535213606) from owner phone (919182583307) to reopen the 24h alert window.
2. Paste latest `nextmile-hub-paste-into-lovable.tsx` into the Lovable "NextMile Hub" project; verify Inbox Alerts tab works.
3. Send a test WhatsApp message; confirm ONE clean alert arrives with name + phone, no duplicates.
4. Decide: build outbound Slice 2 (order confirm / shipping alerts — high ROI, free on Growth) and/or the daily keep-alive, and/or the Meta-direct migration for true auto-reply.
