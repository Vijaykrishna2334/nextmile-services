import { Router, Request, Response } from 'express'
import { connectDB } from '../db/connect'
import { EmailLog } from '../db/models/EmailLog'
import { lookupByEmail, lookupByPhone, MasterRecord } from '../services/master.service'

export const emailsRouter = Router()

// ── Intent detection ──────────────────────────────────────────────────────────

type Intent = 'tracking' | 'certificate' | 'verification' | 'general'

function detectIntent(msg: string): Intent {
  const m = msg.toLowerCase()
  if (/track|awb|courier|ship|deliver|medal.*status|where.*medal|dispatch|parcel/i.test(m)) return 'tracking'
  // Match certificate even with common typos (certficate, certifcate, cert)
  if (/cert/i.test(m)) return 'certificate'
  if (/verif|verified|pending/i.test(m)) return 'verification'
  return 'general'
}

// ── Draft builder ─────────────────────────────────────────────────────────────

function buildPreviewDraft(name: string, records: MasterRecord[], customerMsg: string): string {
  const first  = (name || 'there').split(' ')[0]
  const intent = detectIntent(customerMsg)

  if (!records.length) {
    return `Hi ${first},\n\nThank you for reaching out to NextMile! 🏃‍♂️\n\nWe looked up your details but couldn't find an order linked to this email. Could you please share the email or phone number you used when registering? We'll get back to you right away.\n\nBest regards,\nNextMile Support Team\nsupport@gonextmile.in | WhatsApp: +91 95352 12425`
  }

  const lines: string[] = [`Hi ${first},`, '']

  if (intent === 'tracking') {
    lines.push("Thanks for reaching out! Here's the latest update on your medal delivery:")
  } else if (intent === 'certificate') {
    lines.push("Thanks for reaching out! Here are your certificate details:")
  } else if (intent === 'verification') {
    lines.push("Thanks for reaching out! Here's your verification status:")
  } else {
    lines.push("Thanks for writing to us! Here's a summary of your order(s) with NextMile:")
  }

  lines.push('')

  records.forEach((r, i) => {
    if (records.length > 1) lines.push(`**${r.product || `Order #${r.orderId}`}**`)

    if (intent === 'tracking') {
      const s = (r.deliveryStatus || '').toLowerCase()
      const label = s.includes('deliver') ? 'Your medal has been delivered ✅'
                  : s.includes('transit') ? 'Your medal is on the way 🚚'
                  : s.includes('cancel')  ? 'This order was cancelled/returned ❌'
                  : 'Your medal is being processed 📦'
      lines.push(label)
      if (r.awb) {
        lines.push(`You can track it here: https://ship.nimbuspost.com/shipping/tracking/${r.awb}`)
      } else {
        lines.push('The AWB number is not yet assigned — your medal will be dispatched soon.')
      }
    }

    if (intent === 'certificate' || intent === 'verification') {
      if (r.certLink) {
        lines.push('Great news — your certificate is ready! 🎉 You can download it here:')
        lines.push(r.certLink)
      } else {
        const vs = (r.verificationStatus || '').trim()
        if (/verified/i.test(vs)) {
          lines.push('Your submission has been verified ✅ and your certificate is being prepared. You will receive it shortly.')
        } else {
          lines.push("Your certificate hasn't been issued yet. Your submission is currently under review — we'll send it to you as soon as it's verified.")
        }
      }
    }

    if (intent === 'general') {
      const s = (r.deliveryStatus || '').toLowerCase()
      lines.push(`Medal Status: ${s.includes('deliver') ? 'Delivered ✅' : s.includes('transit') ? 'In Transit 🚚' : 'Processing 📦'}`)
      if (r.awb) lines.push(`Track your medal: https://ship.nimbuspost.com/shipping/tracking/${r.awb}`)
      if (r.certLink) lines.push(`Certificate: ${r.certLink}`)
    }

    if (i < records.length - 1) lines.push('')
  })

  lines.push(
    '',
    'If you have any other questions, feel free to reply to this email or reach us on WhatsApp.',
    '',
    'Warm regards,',
    'NextMile Support Team',
    'support@gonextmile.in | WhatsApp: +91 95352 12425',
  )

  return lines.join('\n')
}

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

    let records: MasterRecord[] = []
    if (senderEmail)                           records = await lookupByEmail(senderEmail)
    if (!records.length && senderPhone)        records = await lookupByPhone(senderPhone)

    const name  = senderName || records[0]?.fullName || 'there'
    const draft = buildPreviewDraft(name, records, customerMessage)

    // Convert plain text to HTML for the iframe preview
    const html = `<!DOCTYPE html><html><head><meta charset="UTF-8">
<style>body{font-family:Arial,sans-serif;font-size:15px;line-height:1.7;color:#1a1a1a;padding:24px;max-width:600px}
a{color:#4f46e5}strong{font-weight:700}</style></head><body>
${draft.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>').replace(/\n/g, '<br>').replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1">$1</a>')}
</body></html>`

    res.json({
      reply: draft,   // plain text — what UI reads as data.reply
      html,           // HTML version — what UI reads as data.html
      draft,          // alias for /api/support/reply consumers
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
