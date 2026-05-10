import { Router, Request, Response } from 'express'
import { connectDB } from '../db/connect'
import { EmailLog } from '../db/models/EmailLog'
import { lookupByEmail, lookupByPhone, MasterRecord } from '../services/master.service'

export const emailsRouter = Router()

// ── Shared draft builder (mirrors support.ts logic) ───────────────────────────

function deliveryLabel(s: string) {
  const v = (s || '').toLowerCase()
  if (v.includes('deliver')) return '✅ Delivered'
  if (v.includes('cancel'))  return '❌ Cancelled / Returned'
  if (v.includes('transit')) return '🚚 In Transit'
  return '📦 Not yet shipped'
}

function buildPreviewDraft(name: string, records: MasterRecord[]): string {
  const first = (name || 'there').split(' ')[0]
  if (!records.length) {
    return [
      `Hi ${first},`,
      '',
      "Thank you for reaching out to NextMile! 🏃‍♂️",
      '',
      "We couldn't find any order linked to your contact details. Could you please share your Order ID or the email/phone used during registration?",
      '',
      'Best regards,\nNextMile Support Team\nsupport@gonextmile.in | WhatsApp: +91 95352 12425',
    ].join('\n')
  }

  const lines = [`Hi ${first},`, '', `Thank you for writing to us! 🏃‍♂️`, '']
  if (records.length > 1) lines.push(`We can see you're registered for ${records.length} events with us:`, '')

  records.forEach((r, i) => {
    if (records.length > 1) lines.push(`**${r.product || `Order #${r.orderId}`}:**`)
    lines.push(`📋 Order ID: #${r.orderId}`)
    if (r.product) lines.push(`🎽 Event: ${r.product}`)
    lines.push(`📦 Medal Status: ${deliveryLabel(r.deliveryStatus)}`)
    if (r.awb) {
      lines.push(`🔢 AWB: ${r.awb}`)
      lines.push(`🔗 Track: https://ship.nimbuspost.com/shipping/tracking/${r.awb}`)
    }
    if (r.certLink) lines.push(`🏅 Certificate: ${r.certLink}`)
    if (r.submissionLink) lines.push(`📎 Submission: ${r.submissionLink}`)
    const vs = (r.verificationStatus || '').trim()
    if (vs) lines.push(`✔️ Verification: ${vs}`)
    if (i < records.length - 1) lines.push('')
  })

  lines.push('', 'If you have any other questions, just reply or reach us on WhatsApp.', '', 'Best regards,', 'NextMile Support Team', 'support@gonextmile.in | WhatsApp: +91 95352 12425')
  return lines.join('\n')
}

// ── Routes ────────────────────────────────────────────────────────────────────

// POST /api/emails/preview — ops UI calls this to generate a draft reply
emailsRouter.post('/preview', async (req: Request, res: Response) => {
  try {
    const b = req.body as Record<string, string>

    // Accept any field name the UI might send for email/phone
    const senderEmail   = b.senderEmail || b.from || b.email || b.fromEmail || b.sender || ''
    const senderPhone   = b.senderPhone || b.phone || b.mobile || ''
    const senderName    = b.senderName  || b.fromName || b.name || ''
    const customerMessage = b.customerMessage || b.body || b.message || b.emailBody || ''

    if (!senderEmail && !senderPhone) {
      res.status(400).json({ error: 'Provide senderEmail or senderPhone' })
      return
    }

    let records: MasterRecord[] = []
    if (senderEmail)                           records = await lookupByEmail(senderEmail)
    if (!records.length && senderPhone)        records = await lookupByPhone(senderPhone)

    const name  = senderName || records[0]?.fullName || 'there'
    const draft = buildPreviewDraft(name, records)

    res.json({ draft, found: records.length > 0, totalOrders: records.length, records })
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
