import express from 'express'
import cors from 'cors'
import path from 'path'
import { config } from 'dotenv'
import { chatRouter } from './routes/chat'
import { trackRouter } from './routes/track'
import { emailsRouter } from './routes/emails'
import { supportRouter } from './routes/support'
import { opsAuthRouter } from './routes/ops-auth'
import { whatsappRouter } from './routes/whatsapp'
import { whatsappReviewRouter } from './routes/whatsapp-review'
import { analyticsRouter } from './routes/analytics'
import { chatOriginLock } from './utils/origin-lock'
import { startCronJobs } from './cron/email-drafts'
import { startWhatsAppPoll } from './cron/whatsapp-poll'
import { connectDB } from './db/connect'

config()

const app  = express()
const PORT = parseInt(process.env.PORT || '3001')

// Global CORS — applies to all routes EXCEPT chat (which is locked tighter below)
// Includes the Lovable preview / app domains for the admin hub
const ALLOWED_OPS_ORIGINS = [
  'https://gonextmile.in',
  'https://ops.gonextmile.live',
  'https://api.gonextmile.live',
  /\.lovable\.app$/,
  /\.lovableproject\.com$/,
  'http://localhost:3000',
  'http://localhost:3001',
  'http://localhost:5173',
  'http://localhost:8080',
]

app.use(cors({
  origin: (origin, cb) => {
    if (!origin) return cb(null, true)
    for (const o of ALLOWED_OPS_ORIGINS) {
      if (typeof o === 'string' && o === origin) return cb(null, true)
      if (o instanceof RegExp && o.test(origin)) return cb(null, true)
    }
    return cb(null, false)
  },
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-cron-secret'],
  credentials: true,
}))

// /api/chat allows any origin at the CORS layer (so Shopify storefront can reach it),
// but is then origin-locked at the route layer to allowlisted referrers only.
app.use('/api/chat', cors({ origin: '*', methods: ['POST', 'OPTIONS'] }), chatOriginLock)

// Webhooks accept any origin (server-to-server, signature-verified inside the handler)
app.use('/api/whatsapp/webhook', cors({ origin: '*', methods: ['POST', 'OPTIONS'] }))

app.use(express.json())
app.use(express.static(path.join(__dirname, '../public')))

app.get('/health', (_, res) => res.json({ status: 'ok', ts: new Date().toISOString() }))

app.use('/api/chat',             chatRouter)
app.use('/api/track',            trackRouter)
app.use('/api/emails',           emailsRouter)
app.use('/api/support',          supportRouter)
app.use('/api/ops',              opsAuthRouter)
app.use('/api/whatsapp',         whatsappRouter)
app.use('/api/ops/whatsapp',     whatsappReviewRouter)
app.use('/api/ops/analytics',    analyticsRouter)

async function main() {
  try {
    await connectDB()
    console.log('[server] MongoDB connected')
  } catch (err) {
    console.error('[server] MongoDB connection failed — email features will not work:', err)
  }

  startCronJobs()
  startWhatsAppPoll()

  app.listen(PORT, () => console.log(`[server] Running on port ${PORT}`))
}

main()
