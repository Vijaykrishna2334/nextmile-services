# Slice 1.5 — Smart Polling + AI-Assisted Reply (Growth-plan workaround)

## What this ships

Inbound auto-reply is impossible on Interakt Growth plan (confirmed via direct API testing). This slice gives you the next-best thing — totally free on Growth:

1. **Polling cron** — runs every 30 seconds, asks Interakt "any users modified recently?" When yes, treats it as a new-message signal.
2. **Owner ping** — auto-WhatsApps YOU (the operator) with the customer's name, phone, and order data. You see the alert on your own WhatsApp the instant a customer messages you on the business number.
3. **Inbox Alerts page in the Hub** — list of every ping, "paste their message" form, "Generate AI reply" button that uses the same LLM + knowledge base + order context the bot would have used.
4. **One-click copy → paste into Interakt → send.** You stay 100% in the loop, bot does 90% of the thinking.

## New env vars on the droplet

```bash
nano /var/www/nextmile-services/.env
```

Add these lines:

```
WHATSAPP_POLL_ENABLED=true
OWNER_WHATSAPP=917718048575
```

- `WHATSAPP_POLL_ENABLED=true` — turns on the poller. Set to `false` to stop polling without redeploying.
- `OWNER_WHATSAPP` — your full WhatsApp number WITH country code, no `+`, no spaces. The number that receives the alert pings. (Make sure this number has messaged your business number at least once in the last 24h, otherwise WhatsApp will block our session-message ping — once you've messaged it once, the 24h window stays rolling as long as you reply.)

Save: Ctrl+O, Enter, Ctrl+X.

## Also fix the stale TEST_HOOK_KEY (cosmetic)

Earlier the test key got overwritten. If you want the test-webhook endpoint to work, also fix:

```
TEST_HOOK_KEY=test123
```

## Deploy

```
cd /var/www/nextmile-services
git fetch origin master
git checkout origin/master -- src/server.ts src/routes/whatsapp-review.ts src/services/interakt.service.ts src/db/models/WhatsAppActivity.ts src/cron/whatsapp-poll.ts
pm2 restart nextmile-services --update-env
pm2 logs nextmile-services --lines 20 --nostream
```

Look for `[whatsapp-poll] started — polling every 30s`. If you see `[whatsapp-poll] disabled`, you missed setting `WHATSAPP_POLL_ENABLED=true`.

## Re-paste the Hub UI in Lovable

The Hub now has an "Inbox Alerts" tab.

1. Open your Lovable project.
2. Replace `App.tsx` (or whatever file holds the main UI) with the full updated contents of `docs/superpowers/nextmile-hub-paste-into-lovable.tsx`.
3. Lovable will auto-add a Textarea component if it's missing.
4. Publish.

## How it works end-to-end

1. Customer WhatsApps you "What is the 100KM event?"
2. Interakt updates that customer's `modified_at_utc`.
3. Within 30s, our poller sees the new modified time, looks up their order, and sends YOU a WhatsApp ping: "📥 Om Nanavare just messaged you. Orders: 100KM (#3205) · Processing. Check Interakt to read."
4. You open Interakt (manually, as you do today), read what they actually wrote.
5. Open the Hub → Inbox Alerts → click "Generate AI reply" on their card → paste their message → click Generate.
6. Hub returns the suggested reply with their order context baked in.
7. Copy the reply, paste into Interakt's reply box, send.
8. Click "Mark replied" in the Hub to clear it from the queue.

Time per reply drops from "whenever you happen to check" to roughly 30 seconds end-to-end.

## End-to-end test

1. Send yourself a WhatsApp message to the NextMile business number (from a different phone).
2. Within 30s, you should receive a ping on `OWNER_WHATSAPP`.
3. Open Hub → Inbox Alerts → you'll see the activity card.
4. Click "Generate AI reply", paste the test message, click Generate.
5. Reply appears with a Copy button.
6. Click "Mark replied".

If step 2 (the ping) doesn't fire, check `pm2 logs nextmile-services --lines 30 --nostream` for `[whatsapp-poll]` errors.
