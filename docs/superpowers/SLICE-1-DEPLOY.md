# Slice 1 Deploy — Auth + Dashboard + WhatsApp Review

## What this slice ships

**Backend (this repo):**
- `POST /api/ops/login` — sign in, returns JWT
- `GET /api/ops/me` — verify session
- `POST /api/ops/logout`
- `POST /api/whatsapp/webhook` — Interakt inbound message handler
- `GET /api/ops/whatsapp/flagged` — list flagged chats (protected)
- `GET /api/ops/whatsapp/recent` — list recent chats (protected)
- `POST /api/ops/whatsapp/:id/reviewed` — mark a chat reviewed (protected)
- `GET /api/ops/whatsapp/stats/today` — today's counters (protected)
- `POST /api/whatsapp/test-webhook?testKey=...` — local test helper
- Origin lockdown on `/api/chat` (LLM cost protection)

**UI (Lovable, paste from `nextmile-hub-paste-into-lovable.tsx`):**
- Login screen
- Dashboard (today's stats)
- WhatsApp Review (flagged + recent tabs)

## New env vars on the droplet

```bash
nano /var/www/nextmile-services/.env
```

Add these lines:

```
ADMIN_EMAIL=Vijaykrishna2334@gmail.com
ADMIN_PASSWORD=<choose a strong password>
SESSION_SECRET=<generate a long random string, see below>
INTERAKT_API_KEY=<from Interakt Developer Settings → Secret Key>
INTERAKT_WEBHOOK_SECRET=<set this when configuring webhook in Interakt; leave blank to skip signature check during testing>
TEST_HOOK_KEY=<any random string for triggering /api/whatsapp/test-webhook>
```

Generate `SESSION_SECRET`:
```
openssl rand -hex 32
```

Save (Ctrl+O, Enter, Ctrl+X).

## Deploy

```
cd /var/www/nextmile-services
git fetch origin master
git checkout origin/master -- src/server.ts src/routes/chat.ts src/routes/ops-auth.ts src/routes/whatsapp.ts src/routes/whatsapp-review.ts src/services/interakt.service.ts src/services/whatsapp-classifier.ts src/db/models/WhatsAppLog.ts src/db/models/LoginAttempt.ts src/utils/ops-auth.ts src/utils/origin-lock.ts
pm2 restart nextmile-services --update-env
pm2 logs nextmile-services --lines 30 --nostream
```

Look for `[server] Running on port 3001` and no errors. If you see a TypeScript error, the imports may need adjusting — paste the error here and I'll fix.

## Configure Interakt webhook

1. Interakt dashboard → **Developer Settings → Configure Webhook**
2. Webhook URL: `https://api.gonextmile.live/api/whatsapp/webhook`
3. Subscribe to: `message_received` event
4. Save. (Optional: if Interakt prompts for a secret, copy it and set `INTERAKT_WEBHOOK_SECRET` to match.)

## Build the Lovable UI

1. Go to https://lovable.dev → create new project named **NextMile Hub**
2. Open the project, paste contents of `nextmile-hub-paste-into-lovable.tsx` into `src/App.tsx`
3. Lovable auto-installs deps and renders the login screen
4. Set environment variable `VITE_API_BASE=https://api.gonextmile.live` in Lovable Settings → Environment
5. Test login with the credentials you set in `.env`
6. Publish the Lovable app — you'll get a public URL (e.g. `https://nextmile-hub.lovable.app`)

## End-to-end test

1. Send a WhatsApp message to your business number: "What is the 100KM event?"
2. Within seconds, you should get an auto-reply on WhatsApp
3. Open NextMile Hub → Dashboard → today's count should tick up by 1
4. Send: "I'm hurt during the challenge" → should NOT auto-reply, should appear in Hub → WhatsApp Review → Needs review
5. Click "Mark reviewed" → it disappears from the list

## Slice 2 (next)

Feature flag toggles UI + spend tracker + order lookup + actual template-sending wiring. Comes after you confirm Slice 1 is working in production.
