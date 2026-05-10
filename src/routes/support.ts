import { Router, Request, Response } from 'express'
import { lookupByEmail, lookupByPhone, MasterRecord } from '../services/master.service'

export const supportRouter = Router()

// ─── Intent detection ────────────────────────────────────────────────────────

type QueryIntent = 'tracking' | 'certificate' | 'submission' | 'verification' | 'order_status' | 'general'

function detectIntent(message: string): QueryIntent {
  const m = message.toLowerCase()
  if (/track|awb|parcel|courier|ship|deliver|medal.*status|where.*medal|medal.*where|dispatch/i.test(m)) return 'tracking'
  if (/submit|submission|upload|proof|photo|evidence|how.*submit|where.*submit/i.test(m)) return 'submission'
  if (/verif|verified|verification|pending.*verif|verif.*pending|not.*verified|check.*verif/i.test(m)) return 'verification'
  if (/certif|certificate/i.test(m)) return 'certificate'
  if (/order|payment|status|register/i.test(m)) return 'order_status'
  return 'general'
}

// Returns indices of records that match the event/product keywords in the message.
// If no specific event is mentioned, returns all indices.
function matchEventRecords(message: string, records: MasterRecord[]): MasterRecord[] {
  if (!message.trim() || records.length <= 1) return records

  const m = message.toLowerCase()

  // Build per-record score — higher = better match
  const scored = records.map((r, i) => {
    const product = r.product.toLowerCase()
    let score = 0

    // Exact product-name keyword hits
    if (/10k|10,000|10000|ten thousand|steps/i.test(m) && /10k|steps/i.test(product)) score += 3
    if (/5\s?km|5k\b/i.test(m) && /5\s?km|5k/i.test(product)) score += 3
    if (/25\s?km|25k\b/i.test(m) && /25\s?km|25k/i.test(product)) score += 3
    if (/progress\s?pack/i.test(m) && /progress/i.test(product)) score += 3
    if (/momentum\s?pack/i.test(m) && /momentum/i.test(product)) score += 3
    if (/endurance\s?pack/i.test(m) && /endurance/i.test(product)) score += 3
    if (/performance\s?pack/i.test(m) && /performance/i.test(product)) score += 3

    // Order ID hit
    const orderMatch = m.match(/\b(\d{3,})\b/)
    if (orderMatch && r.orderId === orderMatch[1]) score += 10

    // AWB hit
    if (r.awb && m.includes(r.awb.toLowerCase())) score += 10

    return { record: r, score, i }
  })

  const maxScore = Math.max(...scored.map(s => s.score))
  if (maxScore === 0) return records // no event keywords — return all

  return scored.filter(s => s.score === maxScore).map(s => s.record)
}

// ─── Reply builder ────────────────────────────────────────────────────────────

function deliveryLabel(status: string): string {
  const s = (status || '').toLowerCase()
  if (s.includes('deliver'))           return '✅ Delivered'
  if (s.includes('cancel'))            return '❌ Cancelled / Returned'
  if (s.includes('transit'))           return '🚚 In Transit'
  if (s.includes('new') || s === '')   return '📦 Not yet shipped'
  return `📦 ${status}`
}

function buildDraft(
  senderName:      string,
  allRecords:      MasterRecord[],
  relevantRecords: MasterRecord[],
  intent:          QueryIntent,
): string {
  const firstName = (senderName || 'there').split(' ')[0]

  // ── Not found ──
  if (allRecords.length === 0) {
    return [
      `Hi ${firstName},`,
      '',
      "Thank you for reaching out to NextMile! 🏃‍♂️",
      '',
      "We couldn't find any order linked to your email/phone in our system. Could you please share:",
      '• Your Order ID (found in your confirmation email)',
      '• Or the email / phone number used during registration',
      '',
      "We'll sort this out right away!",
      '',
      'Best regards,',
      'NextMile Support Team',
      'support@gonextmile.in | WhatsApp: +91 95352 12425',
    ].join('\n')
  }

  const lines: string[] = [`Hi ${firstName},`, '', 'Thank you for writing to us! 🏃‍♂️']

  // If customer has multiple events but only some are relevant, acknowledge that
  if (allRecords.length > 1 && relevantRecords.length < allRecords.length) {
    const otherEvents = allRecords
      .filter(r => !relevantRecords.includes(r))
      .map(r => r.product || `Order #${r.orderId}`)
    lines.push('', `We can see you're registered for multiple events with us (${otherEvents.join(', ')} as well). Here are the details for your enquiry:`)
  } else if (allRecords.length > 1 && relevantRecords.length === allRecords.length) {
    lines.push('', `We can see you're registered for ${allRecords.length} events with us. Here are all your details:`)
  } else {
    lines.push('')
  }

  // ── Per-record block ──
  relevantRecords.forEach((r, i) => {
    if (relevantRecords.length > 1) lines.push(`**${r.product || `Order #${r.orderId}`}:**`)

    lines.push(`📋 Order ID: #${r.orderId}`)
    if (r.product) lines.push(`🎽 Event: ${r.product}`)

    // ── Tracking ──
    if (intent === 'tracking' || intent === 'general') {
      lines.push(`📦 Medal / Shipping Status: ${deliveryLabel(r.deliveryStatus)}`)
      if (r.awb) {
        lines.push(`🔢 AWB Number: ${r.awb}`)
        lines.push(`🔗 Track your medal: https://ship.nimbuspost.com/shipping/tracking/${r.awb}`)
      } else {
        lines.push('🔢 AWB not yet assigned — your medal will be dispatched soon.')
      }
    }

    // ── Verification status ──
    if (intent === 'verification' || intent === 'general') {
      const vs = (r.verificationStatus || '').trim()
      if (/verified/i.test(vs)) {
        lines.push(`✅ Verification Status: Verified`)
      } else if (vs) {
        lines.push(`⏳ Verification Status: ${vs}`)
        if (r.submissionLink) {
          lines.push(`📎 If you haven't submitted your proof yet, you can do so here: ${r.submissionLink}`)
        }
      }
    }

    // ── Certificate ──
    if (intent === 'certificate' || intent === 'general') {
      if (r.certLink) {
        lines.push(`🏅 Your Certificate: ${r.certLink}`)
      } else {
        const vs = (r.verificationStatus || '').trim()
        if (/verified/i.test(vs)) {
          lines.push(`🏅 Certificate: Being prepared — you'll receive it shortly.`)
        } else {
          lines.push(`🏅 Certificate: Not yet issued. Your submission is pending verification.`)
          if (r.submissionLink) {
            lines.push(`📎 Submit your completion proof here: ${r.submissionLink}`)
          }
        }
      }
    }

    // ── Submission link ──
    if (intent === 'submission') {
      if (r.submissionLink) {
        lines.push(`📎 Submission Link: ${r.submissionLink}`)
        lines.push(`Please upload your completion proof (photos/screenshots) using the link above.`)
      } else {
        lines.push(`📎 Submission: Please reach out to support@gonextmile.in and we'll share the correct submission link for your event.`)
      }
      const vs = (r.verificationStatus || '').trim()
      if (vs) lines.push(`⏳ Current Verification Status: ${vs}`)
      if (r.certLink) lines.push(`🏅 Certificate (already issued): ${r.certLink}`)
    }

    // ── Order / payment status ──
    if (intent === 'order_status' || intent === 'general') {
      lines.push(`💳 Payment: ${r.paymentStatus || 'N/A'}`)
    }

    if (i < relevantRecords.length - 1) lines.push('')
  })

  lines.push(
    '',
    'If you have any other questions, just reply to this email or reach us on WhatsApp.',
    '',
    'Best regards,',
    'NextMile Support Team',
    'support@gonextmile.in | WhatsApp: +91 95352 12425',
  )

  return lines.join('\n')
}

// ─── Routes ───────────────────────────────────────────────────────────────────

/**
 * POST /api/support/reply
 * Body: { senderEmail?, senderPhone?, senderName?, customerMessage? }
 *
 * Returns a DRAFT email reply — never sends anything.
 * Used exclusively by the email bot (not the chat widget).
 */
supportRouter.post('/reply', async (req: Request, res: Response) => {
  try {
    const { senderEmail, senderPhone, senderName, customerMessage = '' } = req.body as {
      senderEmail?: string
      senderPhone?: string
      senderName?: string
      customerMessage?: string
    }

    if (!senderEmail && !senderPhone) {
      res.status(400).json({ error: 'Provide senderEmail or senderPhone' })
      return
    }

    // Lookup all records for this contact
    let allRecords: MasterRecord[] = []
    if (senderEmail)                             allRecords = await lookupByEmail(senderEmail)
    if (allRecords.length === 0 && senderPhone)  allRecords = await lookupByPhone(senderPhone)

    const intent          = detectIntent(customerMessage)
    const relevantRecords = matchEventRecords(customerMessage, allRecords)
    const resolvedName    = senderName || allRecords[0]?.fullName || 'there'
    const draft           = buildDraft(resolvedName, allRecords, relevantRecords, intent)

    res.json({
      draft,                          // ready-to-paste email body
      found:           allRecords.length > 0,
      totalOrders:     allRecords.length,
      matchedOrders:   relevantRecords.length,
      intent,
      allRecords,                     // full data for ops use
      relevantRecords,                // filtered subset used for the draft
    })
  } catch (err) {
    console.error('[support/reply] Error:', err)
    res.status(500).json({ error: 'Lookup failed. Please try again.' })
  }
})

/**
 * GET /api/support/debug — shows sheet headers + sample row (remove after debugging)
 */
supportRouter.get('/debug', async (_req: Request, res: Response) => {
  try {
    const { getAccessToken } = await import('../utils/google-auth')
    const token = await getAccessToken('GOOGLE_SERVICE_ACCOUNT_JSON', 'https://www.googleapis.com/auth/spreadsheets.readonly')
    if (!token) { res.json({ error: 'No token' }); return }

    const metaRes = await fetch(
      'https://sheets.googleapis.com/v4/spreadsheets/1zzYje4p5hoEzyw5CRIShYx-alSCaOcUBRI0zkNnTBeU?fields=sheets.properties',
      { headers: { Authorization: `Bearer ${token}` } }
    )
    const meta = await metaRes.json() as { sheets?: { properties: { sheetId: number; title: string } }[] }
    const allSheets = (meta.sheets || []).map(s => ({ id: s.properties.sheetId, title: s.properties.title }))

    res.json({ allSheets })
  } catch (err) {
    res.status(500).json({ error: String(err) })
  }
})

/**
 * GET /api/support/lookup?email=...&phone=...
 * Raw record lookup for the ops dashboard — returns all orders for that contact.
 */
supportRouter.get('/lookup', async (req: Request, res: Response) => {
  try {
    const { email, phone } = req.query as { email?: string; phone?: string }

    if (!email && !phone) {
      res.status(400).json({ error: 'Provide email or phone query param' })
      return
    }

    let records: MasterRecord[] = []
    if (email)                            records = await lookupByEmail(email)
    if (records.length === 0 && phone)    records = await lookupByPhone(phone)

    res.json({ found: records.length > 0, count: records.length, records })
  } catch (err) {
    console.error('[support/lookup] Error:', err)
    res.status(500).json({ error: 'Lookup failed.' })
  }
})
