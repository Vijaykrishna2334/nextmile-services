import { getUsersModifiedSince, sendTextMessage, type InteraktCustomer } from '../services/interakt.service'
import { WhatsAppActivity } from '../db/models/WhatsAppActivity'
import { lookupByPhone } from '../services/master.service'

const POLL_INTERVAL_MS = 30_000
// We poll for users modified in the last (POLL_INTERVAL + lookback) seconds. The
// lookback covers brief job pauses or restarts so we don't miss anything; the
// per-record dedup (interaktModifiedAt + phone) makes overlap safe.
const LOOKBACK_SECONDS = 90
const POLL_LIMIT = 50

// FALSE-POSITIVE CONTROLS (all tunable via env)
// 1. Cooldown: don't send a second alert for the same phone within this window —
//    collapses a burst of messages into ONE alert.
const COOLDOWN_MINUTES = parseInt(process.env.WHATSAPP_ALERT_COOLDOWN_MIN || '15')
// 2. Bulk suppression: if a single poll tick finds more than this many modified
//    records, it's almost certainly a CSV upload / bulk Shopify sync, not real
//    messages — skip the whole batch.
const BULK_THRESHOLD = parseInt(process.env.WHATSAPP_BULK_THRESHOLD || '6')

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

    // Bulk-operation guard — a CSV upload or mass sync touches many records at once.
    // Real customer messages trickle in ones and twos. If we see a flood, skip it.
    if (customers.length > BULK_THRESHOLD) {
      console.log(`[whatsapp-poll] bulk activity detected (${customers.length} records > ${BULK_THRESHOLD}) — likely CSV/sync, skipping batch`)
      return
    }

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

function formatPhone(fullPhone: string): string {
  // 919304728686 -> +91 93047 28686  (best-effort pretty format for Indian numbers)
  if (fullPhone.length === 12 && fullPhone.startsWith('91')) {
    return `+91 ${fullPhone.slice(2, 7)} ${fullPhone.slice(7)}`
  }
  return `+${fullPhone}`
}

async function handleActivity(c: InteraktCustomer): Promise<void> {
  const fullPhone = (c.channel_phone_number || `${(c.country_code || '').replace('+', '')}${c.phone_number}`).replace(/\D/g, '')
  if (!fullPhone) return
  const modifiedAt = new Date(c.modified_at_utc)

  // Dedup — exact same (phone, modifiedAt) means we already processed this update
  const existing = await WhatsAppActivity.findOne({ fullPhone, interaktModifiedAt: modifiedAt }).lean()
  if (existing) {
    if (process.env.WHATSAPP_POLL_VERBOSE === 'true') {
      console.log(`[whatsapp-poll] dedup skip: ${fullPhone} modifiedAt=${modifiedAt.toISOString()}`)
    }
    return
  }

  // Cooldown — collapse a burst of messages from the same person into one alert.
  // We still RECORD the activity (so the Hub sees it), but we don't re-ping the owner.
  const cooldownCutoff = new Date(Date.now() - COOLDOWN_MINUTES * 60 * 1000)
  const recentForPhone = await WhatsAppActivity.findOne({
    fullPhone,
    createdAt: { $gte: cooldownCutoff },
  }).lean()
  const withinCooldown = !!recentForPhone

  const traits = (c.traits || {}) as Record<string, unknown>
  const customerName = String(traits.name || traits.first_name || '').trim()
  const orderRecords = await lookupByPhone(fullPhone).catch(() => [])

  console.log(`[whatsapp-poll] new activity: ${fullPhone} (${customerName || 'unknown'}) modifiedAt=${modifiedAt.toISOString()} cooldown=${withinCooldown}`)

  let sendResult: { ok: boolean; messageId?: string; error?: string } = { ok: false, error: withinCooldown ? 'suppressed (cooldown)' : 'OWNER_WHATSAPP not set' }

  if (!withinCooldown && process.env.OWNER_WHATSAPP) {
    const orderSummary = orderRecords.length
      ? orderRecords.slice(0, 2).map(o => `${o.product || 'order'} (#${o.orderId})${o.deliveryStatus ? ' · ' + o.deliveryStatus : ''}`).join(' | ')
      : 'no order on file'
    const ping =
      `📥 New WhatsApp message\n\n` +
      `${customerName || 'Unknown'}\n` +
      `${formatPhone(fullPhone)}\n\n` +
      `Orders: ${orderSummary}\n\n` +
      `Open Interakt to read their message, then use the Hub to generate a reply.`
    sendResult = await sendTextMessage(process.env.OWNER_WHATSAPP, ping)
    console.log(`[whatsapp-poll] owner ping result: ok=${sendResult.ok} ${sendResult.error || ''}`)
  } else if (withinCooldown) {
    console.log(`[whatsapp-poll] owner ping suppressed (cooldown): ${fullPhone}`)
  }

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
  console.log(`[whatsapp-poll] started — polling every ${POLL_INTERVAL_MS / 1000}s (cooldown=${COOLDOWN_MINUTES}m, bulkThreshold=${BULK_THRESHOLD})`)
  pollOnce().catch(err => console.error('[whatsapp-poll] initial poll error:', err))
}
