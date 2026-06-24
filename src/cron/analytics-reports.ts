import cron from 'node-cron'
import { runDailyAnalyticsReport, runWeeklyAnalyticsReport } from '../services/analytics-report.service'

export function startAnalyticsCron(): void {
  // Daily at 8am IST
  cron.schedule('0 8 * * *', () => {
    console.log('[cron/analytics] Running daily report...')
    runDailyAnalyticsReport().catch(e => console.error('[cron/analytics] Daily error:', e))
  }, { timezone: 'Asia/Kolkata' })

  // Weekly: every Monday at 8am IST (runs in addition to daily)
  cron.schedule('0 8 * * 1', () => {
    console.log('[cron/analytics] Running weekly report...')
    runWeeklyAnalyticsReport().catch(e => console.error('[cron/analytics] Weekly error:', e))
  }, { timezone: 'Asia/Kolkata' })

  console.log('[cron] Analytics scheduled — daily 8am IST + weekly Monday 8am IST')
}
