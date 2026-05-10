import cron from 'node-cron'
import { processInboxEmails } from '../services/draft.service'

export function startCronJobs(): void {
  cron.schedule('*/30 * * * *', () => {
    console.log('[cron/drafts] Checking inbox...')
    processInboxEmails().catch(err => console.error('[cron/drafts] Fatal:', err))
  }, { timezone: 'Asia/Kolkata' })

  console.log('[cron] Email draft job scheduled — every 30 minutes')
}
