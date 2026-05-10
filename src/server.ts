import express from 'express'
import cors from 'cors'
import path from 'path'
import { config } from 'dotenv'
import { chatRouter } from './routes/chat'
import { trackRouter } from './routes/track'
import { supportRouter } from './routes/support'
import { startCronJobs } from './cron/email-drafts'
import { connectDB } from './db/connect'

config()

const app  = express()
const PORT = parseInt(process.env.PORT || '3001')

app.use(cors({
  origin: [
    'https://gonextmile.in',
    'https://ops.gonextmile.live',
    'https://api.gonextmile.live',
    'http://localhost:3000',
    'http://localhost:3001',
  ],
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-cron-secret'],
}))

// /api/chat must accept requests from any origin (public widget)
app.use('/api/chat', cors({ origin: '*', methods: ['POST', 'OPTIONS'] }))

app.use(express.json())
app.use(express.static(path.join(__dirname, '../public')))

app.get('/health', (_, res) => res.json({ status: 'ok', ts: new Date().toISOString() }))

app.use('/api/chat',    chatRouter)
app.use('/api/track',   trackRouter)
app.use('/api/support', supportRouter)

async function main() {
  try {
    await connectDB()
    console.log('[server] MongoDB connected')
  } catch (err) {
    console.error('[server] MongoDB connection failed — email features will not work:', err)
  }

  startCronJobs()

  app.listen(PORT, () => console.log(`[server] Running on port ${PORT}`))
}

main()
