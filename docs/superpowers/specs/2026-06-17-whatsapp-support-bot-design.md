# WhatsApp Support Bot — Design

## Problem

Customer support on WhatsApp (via Interakt, Growth plan) is currently 100% manual — an agent reads every incoming message and types every reply by hand. The team already has an AI-powered support bot for the website chat widget and email drafts, using the same NextMile knowledge base and Google Discovery Engine. WhatsApp should get the same intelligence, but because mistakes on a live channel are riskier than a draft email, replies must be auto-sent only when safe, and routed to a human otherwise.

## Goals

- Auto-reply instantly (no human) to generic, factual questions about events, submission rules, policies — using the existing knowledge base.
- Never auto-reply to anything involving a specific customer's order/account data, or sensitive/liability topics (age/minors, injury, legal, discounts) — route these to a human instead.
- Look up the customer's order data automatically by their WhatsApp phone number (reusing the existing, currently-unused `lookupByPhone()` in `master.service.ts`).
- Give the human reviewer a head start: a suggested reply and the customer's order context, surfaced on an internal page — not written for them to blindly send, but enough to act on quickly.
- Notify the business owner's personal WhatsApp number when a chat is flagged for review, in addition to the review page.

## Non-Goals

- Posting an internal/private note directly inside Interakt (no confirmed API for this — out of scope for v1; can revisit if Interakt's API turns out to support it).
- Auto-sending order-specific replies (e.g. tracking, refunds) even though the underlying data lookup is technically available — this is a deliberate safety choice, not a technical limitation.
- Multi-agent assignment routing/load balancing — v1 assumes a single reviewer (the business owner).

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

- `src/routes/whatsapp.ts` — webhook endpoint: signature verification, classification, dispatch.
- `src/services/interakt.service.ts` — wraps Interakt API calls: send session message, assign chat, verify webhook signature. Mirrors the existing `gmail.service.ts` pattern.
- `src/db/models/WhatsAppLog.ts` — new Mongoose model. Fields: `phone`, `customerName`, `messageText`, `classification` (`generic` | `order-specific` | `sensitive`), `status` (`auto-replied` | `flagged` | `reviewed`), `suggestedReply`, `orderRecordsSnapshot`, `createdAt`, `reviewedAt`.
- `src/routes/whatsapp-review.ts` — protected API backing the review page: list flagged chats, mark as reviewed.
- `public/ops/whatsapp-review.html` — the review page itself, password-gated (see Auth below).

## Auth for the Review Page

No session/auth library exists in this codebase yet. To stay minimal (no new dependencies):
- A single `ADMIN_PASSWORD` environment variable.
- A login form posts the password to a new endpoint; on success, the server sets a signed cookie (HMAC over a payload + expiry, using Node's built-in `crypto` — no new packages).
- Middleware on all `/api/whatsapp-review/*` routes checks that cookie before allowing access.

## Error Handling

- Webhook signature mismatch → 401, logged, no further processing.
- Any failure in lookup, classification, or LLM call during the generic-FAQ path → falls back to the review branch instead of auto-sending a broken or generic fallback message.
- Interakt API failures when sending the owner notification → logged but does not block saving the flagged record (the review page is always the source of truth even if the ping fails).

## Testing

- Since real WhatsApp messages can't be triggered on demand, support POSTing a fake `message_received` payload directly to `/api/whatsapp/webhook` (matching Interakt's documented shape) to exercise classification, auto-reply, and flagging logic end-to-end without a live customer message.
- Manually verify: a generic-FAQ message triggers an auto-sent reply; an order-specific message (for a phone number with existing order records) gets flagged with no auto-send; a sensitive-topic message gets flagged with no auto-send; an invalid signature gets rejected.

## Open Items Resolved During Design

- Interakt plan confirmed as Growth — API/webhook access available.
- No confirmed private-note API in Interakt — review surface is a custom internal page instead.
- Sensitive/liability topics (age, injury, legal, discounts) are treated as a third "needs human" bucket, not lumped into "order-specific," and not auto-sent even though they don't require an order lookup.
