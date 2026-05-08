import { Router, Request, Response } from 'express'
import { connectDB } from '../db/connect'
import { EmailLog } from '../db/models/EmailLog'
import { resendEmail } from '../services/email.service'
import { runWelcomeEmailBatch } from '../cron/welcome-emails'

export const emailsRouter = Router()

function checkCronSecret(req: Request, res: Response): boolean {
  const secret = process.env.CRON_SECRET
  const provided =
    req.headers['x-cron-secret'] as string ||
    (req.headers['authorization'] as string || '').replace('Bearer ', '')
  if (secret && provided !== secret) {
    res.status(401).json({ error: 'Unauthorized' })
    return false
  }
  return true
}

// GET /api/emails/run-cron — manually trigger welcome email batch
emailsRouter.get('/run-cron', async (req: Request, res: Response) => {
  if (!checkCronSecret(req, res)) return
  try {
    const result = await runWelcomeEmailBatch()
    res.json({ success: true, ...result })
  } catch (err) {
    console.error('[emails/run-cron] Error:', err)
    res.status(500).json({ error: 'Cron job failed' })
  }
})

// GET /api/emails/stats — email log stats
emailsRouter.get('/stats', async (req: Request, res: Response) => {
  if (!checkCronSecret(req, res)) return
  try {
    await connectDB()
    const [total, sent, failed, queued] = await Promise.all([
      EmailLog.countDocuments(),
      EmailLog.countDocuments({ status: 'sent' }),
      EmailLog.countDocuments({ status: 'failed' }),
      EmailLog.countDocuments({ status: 'queued' }),
    ])
    res.json({ total, sent, failed, queued })
  } catch (err) {
    res.status(500).json({ error: 'Stats query failed' })
  }
})

// POST /api/emails/:id/resend
emailsRouter.post('/:id/resend', async (req: Request, res: Response) => {
  if (!checkCronSecret(req, res)) return
  try {
    await resendEmail(req.params.id)
    res.json({ success: true })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    res.status(500).json({ error: msg })
  }
})
