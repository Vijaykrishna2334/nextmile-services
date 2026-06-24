import cron from 'node-cron'
import { runShippingAlerts } from '../services/shipping-alert.service'

export function startShippingAlertCron(): void {
  // Runs at 8am and 8pm IST every day
  cron.schedule('0 2,14 * * *', () => {
    console.log('[cron/shipping-alert] Checking shipments...')
    runShippingAlerts().catch(err => console.error('[cron/shipping-alert] Fatal:', err))
  }, { timezone: 'Asia/Kolkata' })

  console.log('[cron] Shipping alert job scheduled — 8am & 8pm IST daily')
}
