import { Router, Request, Response } from 'express'
import { connectDB } from '../db/connect'
import { EmailLog } from '../db/models/EmailLog'
import { lookupByEmail, lookupByPhone } from '../services/master.service'
import { generateEmailDraft } from '../services/llm.service'

export const emailsRouter = Router()

// ── Routes ────────────────────────────────────────────────────────────────────

// POST /api/emails/preview — ops UI calls this to generate a draft reply
emailsRouter.post('/preview', async (req: Request, res: Response) => {
  try {
    const b = req.body as Record<string, string>

    // UI sends { fromName: "email@x.com", body: "customer message" }
    const senderEmail     = b.senderEmail || b.from || b.email || b.fromEmail || b.sender || b.fromName || ''
    const senderPhone     = b.senderPhone || b.phone || b.mobile || ''
    const senderName      = b.senderName  || b.name || ''
    const customerMessage = b.customerMessage || b.body || b.message || b.emailBody || ''

    if (!senderEmail && !senderPhone) {
      res.status(400).json({ error: 'Provide senderEmail or senderPhone' })
      return
    }

    let records = await (senderEmail ? lookupByEmail(senderEmail) : Promise.resolve([]))
    if (!records.length && senderPhone) records = await lookupByPhone(senderPhone)

    const name  = senderName || records[0]?.fullName || 'there'
    const draft = await generateEmailDraft({
      senderName: name,
      customerMessage,
      records,
      relevantRecords: records,
    })

    // Convert plain text to HTML for the iframe preview
    const html = `<!DOCTYPE html><html><head><meta charset="UTF-8">
<style>body{font-family:Arial,sans-serif;font-size:15px;line-height:1.7;color:#1a1a1a;padding:24px;max-width:600px}
a{color:#4f46e5}strong{font-weight:700}</style></head><body>
${draft.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>').replace(/\n/g, '<br>').replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1">$1</a>')}
</body></html>`

    res.json({
      reply: draft,
      html,
      draft,
      found: records.length > 0,
      totalOrders: records.length,
      records,
    })
  } catch (err) {
    console.error('[emails/preview] Error:', err)
    res.status(500).json({ error: 'Preview failed' })
  }
})

// GET /api/emails/stats — email log counts
emailsRouter.get('/stats', async (_req: Request, res: Response) => {
  try {
    await connectDB()
    const [total, sent, failed] = await Promise.all([
      EmailLog.countDocuments(),
      EmailLog.countDocuments({ status: 'sent' }),
      EmailLog.countDocuments({ status: 'failed' }),
    ])
    res.json({ total, sent, failed, queued: 0 })
  } catch {
    res.json({ total: 0, sent: 0, failed: 0, queued: 0 })
  }
})

// GET /api/emails/logs — recent email logs
emailsRouter.get('/logs', async (_req: Request, res: Response) => {
  try {
    await connectDB()
    const logs = await EmailLog.find().sort({ createdAt: -1 }).limit(20).lean()
    res.json({ logs })
  } catch {
    res.json({ logs: [] })
  }
})
