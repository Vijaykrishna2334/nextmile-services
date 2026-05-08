import cron from 'node-cron'
import { connectDB } from '../db/connect'
import { Registration } from '../db/models/Registration'
import { Event, IEvent } from '../db/models/Event'
import { sendWelcomeEmail } from '../services/email.service'

const BATCH_SIZE = 50

export async function runWelcomeEmailBatch(): Promise<{ processed: number; sent: number; failed: number; errors?: string[] }> {
  await connectDB()

  const pending = await Registration.find({
    $or: [
      { welcomeEmailStatus: null },
      { welcomeEmailStatus: { $exists: false } },
      { welcomeEmailStatus: 'pending' },
    ],
    welcomeSentAt: { $exists: false },
    email: { $exists: true, $ne: '' },
  }).limit(BATCH_SIZE).lean()

  if (pending.length === 0) {
    console.log('[cron/welcome] No pending emails')
    return { processed: 0, sent: 0, failed: 0 }
  }

  const eventIds = [...new Set(pending.map(r => String(r.eventId)))]
  const events   = await Event.find({ _id: { $in: eventIds } }).lean()
  const eventMap = new Map<string, IEvent>(events.map(e => [String(e._id), e as unknown as IEvent]))

  let sent = 0, failed = 0
  const errors: string[] = []

  for (const regData of pending) {
    const event = eventMap.get(String(regData.eventId))
    if (!event) { failed++; continue }

    try {
      const reg = await Registration.findById(regData._id)
      if (!reg) continue
      await sendWelcomeEmail(reg, event)
      sent++
    } catch (err) {
      failed++
      errors.push(`${regData.email}: ${err instanceof Error ? err.message : String(err)}`)
    }

    await new Promise(r => setTimeout(r, 200))
  }

  console.log(`[cron/welcome] Processed: ${pending.length}, Sent: ${sent}, Failed: ${failed}`)
  return { processed: pending.length, sent, failed, errors: errors.length > 0 ? errors : undefined }
}

export function startCronJobs(): void {
  // 6 AM IST daily (UTC+5:30 → 0:30 UTC)
  cron.schedule('30 0 * * *', () => {
    console.log('[cron] Running welcome email batch...')
    runWelcomeEmailBatch().catch(err => console.error('[cron] Fatal:', err))
  }, { timezone: 'Asia/Kolkata' })

  console.log('[cron] Welcome email job scheduled — 6 AM IST daily')
}
