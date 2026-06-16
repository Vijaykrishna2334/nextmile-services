import { getUsersModifiedSince, sendTextMessage, type InteraktCustomer } from '../services/interakt.service'
import { WhatsAppActivity } from '../db/models/WhatsAppActivity'
import { lookupByPhone } from '../services/master.service'

const POLL_INTERVAL_MS = 30_000
// We poll for users modified in the last (POLL_INTERVAL + lookback) seconds. The
// lookback covers brief job pauses or restarts so we don't miss anything; the
// per-record dedup (interaktModifiedAt + phone) makes overlap safe.
const LOOKBACK_SECONDS = 90
const POLL_LIMIT = 50

let pollTimer: NodeJS.Timeout | null = null
let running = false

async function pollOnce(): Promise<void> {
  if (running) return
  running = true
  try {
    if (!process.env.INTERAKT_API_KEY) {
      console.warn('[whatsapp-poll] tick: INTERAKT_API_KEY missing, skipping')
      return
    }
    const since = new Date(Date.now() - LOOKBACK_SECONDS * 1000).toISOString()
    const customers = await getUsersModifiedSince(since, POLL_LIMIT)
    if (process.env.WHATSAPP_POLL_VERBOSE === 'true') {
      console.log(`[whatsapp-poll] tick: since=${since} found=${customers.length}`)
    }
    if (!customers.length) return

    for (const c of customers) {
      try {
        await handleActivity(c)
      } catch (err) {
        console.error('[whatsapp-poll] error handling customer', c.phone_number, err)
      }
    }
  } finally {
    running = false
  }
}

async function handleActivity(c: InteraktCustomer): Promise<void> {
  const fullPhone = (c.channel_phone_number || `${(c.country_code || '').replace('+', '')}${c.phone_number}`).replace(/\D/g, '')
  if (!fullPhone) return
  const modifiedAt = new Date(c.modified_at_utc)

  // Dedup — same (phone, modifiedAt) means we've already alerted for this update
  const existing = await WhatsAppActivity.findOne({ fullPhone, interaktModifiedAt: modifiedAt }).lean()
  if (existing) {
    if (process.env.WHATSAPP_POLL_VERBOSE === 'true') {
      console.log(`[whatsapp-poll] dedup skip: ${fullPhone} modifiedAt=${modifiedAt.toISOString()}`)
    }
    return
  }
  console.log(`[whatsapp-poll] new activity: ${fullPhone} (${c.traits?.name || 'unknown'}) modifiedAt=${modifiedAt.toISOString()}`)

  // Filter out activity that is clearly just our own outbound (e.g. trait pushes,
  // tag changes triggered by the cron itself). For Slice 1 we only filter
  // "abandoned cart only" updates with zero whatsapp_opted_in change — keep it
  // simple and let real human messages through. We can tighten later.
  const traits = (c.traits || {}) as Record<string, unknown>
  const customerName = String(traits.name || traits.first_name || '').trim()

  const orderRecords = await lookupByPhone(fullPhone).catch(() => [])

  // Compose the owner-ping message
  const orderSummary = orderRecords.length
    ? orderRecords.slice(0, 2).map(o => `${o.product || 'order'} (#${o.orderId})${o.deliveryStatus ? ' · ' + o.deliveryStatus : ''}`).join(' | ')
    : 'no order on file'
  const ping = `📥 New WhatsApp activity\n\n${customerName || fullPhone} just messaged you on WhatsApp.\n\nOrders: ${orderSummary}\n\nCheck Interakt to read the message, then open the Hub to generate a reply.`

  let sendResult: { ok: boolean; messageId?: string; error?: string } = { ok: false, error: 'OWNER_WHATSAPP not set' }
  if (process.env.OWNER_WHATSAPP) {
    sendResult = await sendTextMessage(process.env.OWNER_WHATSAPP, ping)
  }

  console.log(`[whatsapp-poll] owner ping result: ok=${sendResult.ok} ${sendResult.error || ''}`)

  await WhatsAppActivity.create({
    fullPhone,
    customerName,
    interaktUserId:     c.id,
    interaktModifiedAt: modifiedAt,
    orderRecordsSnapshot: orderRecords,
    interaktTraits: traits,
    tagNames: c.tag_names || [],
    status: 'new',
    ownerPingSent: sendResult.ok,
    ownerPingMessageId: sendResult.messageId,
    ownerPingError: sendResult.error,
  })
}

export function startWhatsAppPoll(): void {
  if (pollTimer) return
  if (process.env.WHATSAPP_POLL_ENABLED !== 'true') {
    console.log('[whatsapp-poll] disabled (set WHATSAPP_POLL_ENABLED=true to enable)')
    return
  }
  pollTimer = setInterval(() => {
    pollOnce().catch(err => console.error('[whatsapp-poll] poll error:', err))
  }, POLL_INTERVAL_MS)
  console.log(`[whatsapp-poll] started — polling every ${POLL_INTERVAL_MS / 1000}s`)
  // Fire one immediately on startup
  pollOnce().catch(err => console.error('[whatsapp-poll] initial poll error:', err))
}
