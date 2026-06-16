# WhatsApp Support Bot + Phase 1 Automation Platform — Design

## Problem

Customer support on WhatsApp (via Interakt, Growth plan) is currently 100% manual — an agent reads every incoming message and types every reply by hand. Beyond support, NextMile has no automated WhatsApp touchpoints for the customer journey at all: no order confirmations, no shipping alerts, no deadline reminders. The team already has an AI-powered support bot for the website chat widget and email drafts, using the same NextMile knowledge base and Google Discovery Engine. WhatsApp should get the same intelligence plus a foundation for the broader transactional/marketing automation Interakt's API enables.

## Strategy: Build All, Activate Free First

Build every automation in Phase 1, but **only the genuinely free paths are ON by default**. Every feature that costs Meta money (template-initiated messages) is gated behind a per-feature env flag that defaults to `false`. Flipping any of them on later is a one-line `.env` change and a restart — no code redeploy. This lets us measure value before paying.

**Free paths (ON by default):** anything where the customer messages first and we reply inside the 24-hour window, plus pure data-push APIs that don't send a message at all.
**Paid paths (OFF by default):** anything we initiate to the customer (templates).

## Goals

### Customer-facing chat agent (ON, free)
- Auto-reply instantly (no human) to generic, factual questions about events, submission rules, policies — using the existing knowledge base.
- Auto-reply to order-ID lookups (same path the website widget uses).
- Never auto-reply to anything involving a specific customer's order/account data beyond the order lookup, or sensitive/liability topics (age/minors, injury, legal, discounts) — route these to a human instead.
- Look up the customer's order data automatically by their WhatsApp phone number (reusing the existing, currently-unused `lookupByPhone()` in `master.service.ts`).
- Give the human reviewer a head start: a suggested reply and the customer's order context, surfaced on an internal page — not written for them to blindly send, but enough to act on quickly.

### Customer enrichment / Interakt-as-second-CRM (ON, free)
- On every webhook event (customer messages in) AND on demand from a background sync job, push the customer's NextMile order data as Interakt user traits (`Track User API`) and log key events (`Track Events API`). Lets a human agent in Interakt see full order history at a glance and lets future Interakt-side segmentation work.

### Transactional notifications (built, OFF by default — toggle when ready to pay)
- `ENABLE_ORDER_CONFIRMATION` — instant template after Shopify registration.
- `ENABLE_SHIPPING_ALERT` — template when order moves to "Dispatched" in Nimbus Shipping sheet.
- `ENABLE_CERT_READY` — template when submission is verified / certificate generated.
- `ENABLE_DEADLINE_REMINDERS` — day-20 and day-27 nudges if customer hasn't submitted.
- `ENABLE_OWNER_ALERTS` — owner WhatsApp ping for refund requests, flagged reviews, RTO/lost shipments. (Same code path also powers the chat-bot review-page notification to the owner.)

### Marketing / engagement (built, OFF by default — wired to existing approved templates)
- `ENABLE_NEW_EVENT_BROADCAST` — send approved "new event launched" template to a segment.
- `ENABLE_ABANDONED_CART` — recover Shopify abandoned carts.
- `ENABLE_WIN_BACK` — nudge past finishers who haven't registered in 60+ days.

Template names for marketing features will be configured via env vars at activation time (`TEMPLATE_NEW_EVENT_NAME`, etc.), not hardcoded — since these are existing approved templates in your Interakt account.

## Non-Goals

- Posting an internal/private note directly inside Interakt (no confirmed API for this — Chat Assignment is used instead).
- Auto-sending order-specific support replies (refunds, special status questions) — deliberate safety choice, even though data lookup is available.
- Multi-agent assignment routing/load balancing — v1 assumes a single reviewer (the business owner).
- Designing/submitting new marketing templates to Meta — we use what's already approved in your Interakt account.
- Auto-flipping any paid feature ON without explicit operator action.

## Architecture / Data Flow

1. Customer messages the NextMile WhatsApp Business number.
2. Interakt POSTs a `message_received` webhook event to a new endpoint: `POST /api/whatsapp/webhook`. Payload includes customer phone number, message text, timestamp.
3. The route verifies the `Interakt-Signature` header (HMAC-SHA256 over the raw body, using a webhook secret) before trusting the payload. Invalid signature → reject with 401, log it.
4. Look up the customer via `lookupByPhone(phone)` (existing function in `master.service.ts`) to retrieve any matching order record(s).
5. Classify the message into one of three buckets:
   - **Generic FAQ** — event details, submission rules, dates, policies, comparisons between events. No order lookup needed to answer.
   - **Order-specific** — anything referencing the customer's own order, delivery, certificate, refund, cancellation. Detected via the same tracking-intent keyword pattern already used in `chat.ts`, OR if the message pairs with an existing order record AND personal-status language.
   - **Sensitive/liability topic** — age/minors, injury/medical, legal, discount/promo-code requests, trust/scam concerns. Same category the website bot already treats as "out of scope, redirect to support" in the knowledge base.
6. **Generic FAQ branch:** call the same Discovery Engine `:answer` endpoint the website bot uses (same `KNOWLEDGE`/`PREAMBLE`), get the answer, send it back to the customer via Interakt's session-message send API (valid within the 24-hour customer-service window). Log the interaction.
7. **Order-specific or Sensitive branch:** do NOT auto-send. Instead:
   - Generate a suggested reply using the order-aware prompt pattern from `draft.service.ts` (reusing the customer's order records as context, if any).
   - Call Interakt's Chat Assignment API to assign/tag the chat for human attention.
   - Save a record (see Data Model) so it shows up on the review page.
   - Send a short WhatsApp notification to the business owner's personal number ("1 new chat needs review") with a link to the review page, via the same Interakt session-message send API.
8. **Failure safety net:** any error in classification, the LLM call, or the Interakt API always falls through to the review branch (step 7) — auto-send only happens on a clean, confident generic-FAQ path. Never auto-send an empty, failed, or low-confidence answer.

## Components

**Core (used by everything):**
- `src/services/interakt.service.ts` — wraps Interakt API calls: `sendTextMessage`, `sendTemplate`, `assignChat`, `trackUser`, `trackEvent`, `verifyWebhookSignature`, `getUserByPhone`. Mirrors the existing `gmail.service.ts` pattern. Every paid call (`sendTemplate`) checks its feature flag first and no-ops with a logged "skipped (flag off)" if disabled — so even a buggy caller can't accidentally send a paid message.

**Chat agent (free, ON):**
- `src/routes/whatsapp.ts` — webhook endpoint: signature verification, classification, dispatch to auto-reply or flag-for-review. Also fires the customer-enrichment push to Interakt (Track User + Track Event) on every inbound message — this is free.
- `src/db/models/WhatsAppLog.ts` — Mongoose model. Fields: `phone`, `customerName`, `messageText`, `classification` (`generic` | `order-specific` | `sensitive`), `status` (`auto-replied` | `flagged` | `reviewed`), `suggestedReply`, `orderRecordsSnapshot`, `createdAt`, `reviewedAt`.
- `src/routes/whatsapp-review.ts` — protected API backing the review page: list flagged chats, mark as reviewed.
- `public/ops/whatsapp-review.html` — the review page itself, password-gated.

**Transactional notifications (built, flag-OFF):**
- `src/services/notifications.service.ts` — one function per notification type (`sendOrderConfirmation(phone, orderData)`, `sendShippingAlert(phone, awb)`, `sendCertReady(phone, certLink)`, `sendDeadlineReminder(phone, daysLeft)`, `sendOwnerAlert(reason, payload)`). Each is a thin wrapper over `interakt.service.sendTemplate()` with its specific template name + variable mapping. Each checks its own feature flag before sending.
- `src/cron/notification-triggers.ts` — periodic job that scans the master sheet for state changes (new orders → confirmation, status changed to Dispatched → shipping alert, registration_date + 20 days reached → reminder, etc.) and calls the matching notification function. Idempotent: uses `WhatsAppLog` or a sibling `NotificationLog` model to record what's been sent so it never double-sends.
- `src/db/models/NotificationLog.ts` — records every notification fired or skipped: `phone`, `type`, `orderId`, `templateUsed`, `status` (`sent` | `skipped-flag-off` | `failed`), `createdAt`.

**Marketing (built, flag-OFF, uses your pre-approved templates):**
- `src/routes/marketing.ts` — protected endpoints behind the same ops-page auth: `POST /api/marketing/new-event-broadcast` (kicks off a broadcast to a segment), `POST /api/marketing/abandoned-cart-sweep`, `POST /api/marketing/winback-sweep`. Each requires its own env flag AND an explicit operator action — never auto-fires on a schedule.
- `public/ops/marketing.html` — page in the ops area where the operator can pick a segment + template, preview the count, and click Send. (Built but reachable only when at least one marketing flag is on.)

## Auth for the Review Page

No session/auth library exists in this codebase yet. To stay minimal (no new dependencies):
- A single `ADMIN_PASSWORD` environment variable.
- A login form posts the password to a new endpoint; on success, the server sets a signed cookie (HMAC over a payload + expiry, using Node's built-in `crypto` — no new packages).
- Middleware on all `/api/whatsapp-review/*` routes checks that cookie before allowing access.

## Error Handling

- Webhook signature mismatch → 401, logged, no further processing.
- Any failure in lookup, classification, or LLM call during the generic-FAQ path → falls back to the review branch instead of auto-sending a broken or generic fallback message.
- Interakt API failures when sending the owner notification → logged but does not block saving the flagged record (the review page is always the source of truth even if the ping fails).
- A paid `sendTemplate` call with its flag off → logs `skipped-flag-off`, returns success without hitting Interakt. Caller does not need to know about the flag.
- Notification cron crashes mid-batch → next run resumes from where it stopped, using `NotificationLog` for dedup.

## Cost Safety (defense in depth)

Three layers of protection against accidentally sending paid messages:

1. **Per-feature env flags** check at the top of every `sendTemplate` call. Default OFF.
2. **`NotificationLog` dedup** — even with flags on, the same notification for the same order ID can't fire twice.
3. **Daily send cap** — single env var `MAX_TEMPLATE_SENDS_PER_DAY` (default 50). When the daily count is hit, all further `sendTemplate` calls log `skipped-cap-reached` and return. Resets at IST midnight. Stops a bug from accidentally blasting thousands of messages.

## Testing

- Since real WhatsApp messages can't be triggered on demand, support POSTing a fake `message_received` payload directly to `/api/whatsapp/webhook` (matching Interakt's documented shape) to exercise classification, auto-reply, and flagging logic end-to-end without a live customer message.
- Manually verify: a generic-FAQ message triggers an auto-sent reply; an order-specific message (for a phone number with existing order records) gets flagged with no auto-send; a sensitive-topic message gets flagged with no auto-send; an invalid signature gets rejected.

## Confirmed Interakt API Endpoints

Verified directly from Interakt's Postman documentation (`https://documenter.getpostman.com/view/14760594/2sA2r7zibM`), all use `Authorization: Basic {{API_KEY}}` and `Content-Type: application/json`:

**Send Text Message**
```
POST https://api.interakt.ai/v1/public/message/
{
  "userId": "",
  "fullPhoneNumber": "919999999999",
  "callbackData": "some_callback_data",
  "type": "Text",
  "data": { "message": "your reply text" }
}
```
Success: `201 CREATED`, `{ "result": true, "message": "Message queued for sending via Interakt. Check webhook for delivery status", "id": "..." }`

**Chat Assignment**
```
POST https://api.interakt.ai/v1/public/assignment/
{
  "user_phone_number": "919876543210",
  "agent_email": "agent@example.com"
}
```
Success: `{ "result": true, "message": "Chat Assigned Successfully" }`

**Get User via Phone Number** (optional — Interakt's own customer record, separate from our Google Sheet order data)
```
GET https://api.interakt.ai/v1/public/apis/users/phone_number/9999999999
```
(phone number without country code)

## Open Items Resolved During Design

- Interakt plan confirmed as Growth — API/webhook access available.
- No confirmed private-note API in Interakt — review surface is a custom internal page instead.
- Sensitive/liability topics (age, injury, legal, discounts) are treated as a third "needs human" bucket, not lumped into "order-specific," and not auto-sent even though they don't require an order lookup.
- Chat Assignment API confirmed and brought back into v1 scope (previously deferred as unconfirmed).
