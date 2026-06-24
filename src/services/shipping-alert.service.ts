import { getAccessToken }    from '../utils/google-auth'
import { sendEmail }         from './gmail.service'
import { sendTextMessage }   from './interakt.service'
import { connectDB }         from '../db/connect'
import { ShippingAlertLog }  from '../db/models/ShippingAlertLog'
import type { AlertType }    from '../db/models/ShippingAlertLog'

const SPREADSHEET_ID = '1x2jqCRMBSguFjQXYdMc1SZMyGHVyZOVIt_zUZaht2TM'

// Column indices in "Nimbus Shipping" sheet
const COL_ORDER_ID = 0
const COL_STATUS   = 2
const COL_AWB      = 13
const COL_LOCATION = 19
const COL_UPDATED  = 20

// Days thresholds
const TRANSIT_STUCK_DAYS  = 5
const DELIVERY_STUCK_DAYS = 2
const NOT_PICKED_DAYS     = 1

// Only alert on shipments updated within the last N days — ignore old/stale records
const MAX_STALENESS_DAYS = 20

// Re-alert cooldown — don't send same alert for same AWB within 24 hours
const ALERT_COOLDOWN_HOURS = 24

// ── Status classifiers ────────────────────────────────────────────────────────

function classifyStatus(status: string): AlertType | null {
  const s = status.toLowerCase().trim()

  const exceptionKeywords = [
    'exception', 'ndr', 'undelivered', 'failed delivery',
    'rto initiated', 'rto in transit', 'return to origin', 'lost', 'damage',
    'misrouted', 'address not found', 'refused', 'cancelled by',
  ]
  if (exceptionKeywords.some(k => s.includes(k))) return 'exception'

  const notPickedKeywords = ['not picked', 'pickup pending', 'pending pickup', 'shipment booked', 'booked']
  if (notPickedKeywords.some(k => s.includes(k))) return 'not_picked'

  const deliveryKeywords = ['out for delivery', 'ofd', 'reached at delivery', 'reached destination', 'at destination hub', 'with delivery']
  if (deliveryKeywords.some(k => s.includes(k))) return 'stuck_delivery'

  const transitKeywords = ['in transit', 'transit', 'picked up', 'hub', 'in-transit']
  if (transitKeywords.some(k => s.includes(k))) return 'stuck_transit'

  return null
}

// ── Date parsing ──────────────────────────────────────────────────────────────

function parseDate(raw: string): Date | null {
  if (!raw) return null
  const s = raw.trim()

  // DD/MM/YYYY
  const dmy = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (dmy) {
    const d = new Date(`${dmy[3]}-${dmy[2].padStart(2, '0')}-${dmy[1].padStart(2, '0')}T12:00:00Z`)
    if (!isNaN(d.getTime())) return d
  }

  // DD-MM-YYYY
  const dmyDash = s.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/)
  if (dmyDash) {
    const d = new Date(`${dmyDash[3]}-${dmyDash[2].padStart(2, '0')}-${dmyDash[1].padStart(2, '0')}T12:00:00Z`)
    if (!isNaN(d.getTime())) return d
  }

  // Native (handles YYYY-MM-DD, "18 Jun 2026", etc.)
  const native = new Date(s)
  if (!isNaN(native.getTime())) return native

  return null
}

function daysSince(date: Date): number {
  return (Date.now() - date.getTime()) / (1000 * 60 * 60 * 24)
}

// ── Sheet reader ──────────────────────────────────────────────────────────────

interface ShipRow {
  orderId:  string
  awb:      string
  status:   string
  location: string
  updated:  string
}

async function readShippingSheet(): Promise<ShipRow[]> {
  const token = await getAccessToken('GOOGLE_SERVICE_ACCOUNT_JSON', 'https://www.googleapis.com/auth/spreadsheets.readonly')
  if (!token) { console.error('[shipping-alert] Sheet token failed'); return [] }

  // Resolve tab name
  const metaRes = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}?fields=sheets.properties`,
    { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10000) }
  )
  const meta = await metaRes.json() as { sheets?: { properties: { sheetId: number; title: string } }[] }
  const tabs  = (meta.sheets || []).map(s => s.properties.title)
  const title = tabs.find(t => /nimbus shipping/i.test(t)) || tabs.find(t => /nimbus/i.test(t)) || ''
  if (!title) { console.error('[shipping-alert] Nimbus Shipping tab not found'); return [] }

  const range    = `${title}!A:U`
  const sheetRes = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values/${encodeURIComponent(range)}`,
    { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10000) }
  )
  const sheetData = await sheetRes.json() as { values?: string[][] }
  const rows: string[][] = sheetData.values || []

  const headerIdx = rows.findIndex(r => String(r[0] || '').trim().toLowerCase() === 'order id')
  const dataRows  = rows.slice(headerIdx >= 0 ? headerIdx + 1 : 1)

  return dataRows
    .filter(r => r[COL_AWB]?.trim())
    .map(r => ({
      orderId:  String(r[COL_ORDER_ID] || '').trim(),
      awb:      String(r[COL_AWB]      || '').trim(),
      status:   String(r[COL_STATUS]   || '').trim(),
      location: String(r[COL_LOCATION] || '').trim(),
      updated:  String(r[COL_UPDATED]  || '').trim(),
    }))
}

// ── Alert detection ───────────────────────────────────────────────────────────

interface AlertRow extends ShipRow { alertType: AlertType }

function detectAlerts(rows: ShipRow[]): AlertRow[] {
  const alerts: AlertRow[] = []
  const seen   = new Set<string>() // dedupe same AWB+type within the sheet

  for (const row of rows) {
    if (!row.status) continue
    const type = classifyStatus(row.status)
    if (!type) continue

    // Skip already-delivered / RTO delivered / cancelled
    const s = row.status.toLowerCase()
    if (s.includes('delivered') && !s.includes('undelivered') && !s.includes('out for')) continue
    if (s.includes('rto delivered')) continue

    const lastUpdate = parseDate(row.updated)
    const ageDays    = lastUpdate ? daysSince(lastUpdate) : null

    // Skip stale records — only alert on shipments updated within past MAX_STALENESS_DAYS
    // If no date at all, include (assume recent)
    if (ageDays !== null && ageDays > MAX_STALENESS_DAYS) continue

    const dedupeKey = `${row.awb}::${type}`
    if (seen.has(dedupeKey)) continue
    seen.add(dedupeKey)

    if (type === 'exception') {
      alerts.push({ ...row, alertType: 'exception' })
    } else if (type === 'not_picked' && ageDays !== null && ageDays >= NOT_PICKED_DAYS) {
      alerts.push({ ...row, alertType: 'not_picked' })
    } else if (type === 'stuck_delivery' && ageDays !== null && ageDays >= DELIVERY_STUCK_DAYS) {
      alerts.push({ ...row, alertType: 'stuck_delivery' })
    } else if (type === 'stuck_transit' && ageDays !== null && ageDays >= TRANSIT_STUCK_DAYS) {
      alerts.push({ ...row, alertType: 'stuck_transit' })
    }
  }

  return alerts
}

// ── Dedupe via MongoDB ────────────────────────────────────────────────────────

async function filterNewAlerts(alerts: AlertRow[]): Promise<AlertRow[]> {
  const cutoff = new Date(Date.now() - ALERT_COOLDOWN_HOURS * 60 * 60 * 1000)
  const recent = await ShippingAlertLog.find({ alertedAt: { $gte: cutoff } }).lean()
  const sentKeys = new Set(recent.map(r => `${r.awb}::${r.alertType}`))
  return alerts.filter(a => !sentKeys.has(`${a.awb}::${a.alertType}`))
}

async function logAlerts(alerts: AlertRow[]): Promise<void> {
  if (!alerts.length) return
  await ShippingAlertLog.insertMany(alerts.map(a => ({
    awb:       a.awb,
    orderId:   a.orderId,
    alertType: a.alertType,
    status:    a.status,
    location:  a.location,
    alertedAt: new Date(),
  })))
}

// ── Email builder ─────────────────────────────────────────────────────────────

function buildAlertEmail(alerts: AlertRow[]): { subject: string; html: string } {
  const groups: Record<AlertType, AlertRow[]> = {
    exception:      alerts.filter(a => a.alertType === 'exception'),
    not_picked:     alerts.filter(a => a.alertType === 'not_picked'),
    stuck_delivery: alerts.filter(a => a.alertType === 'stuck_delivery'),
    stuck_transit:  alerts.filter(a => a.alertType === 'stuck_transit'),
  }

  const today   = new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' })
  const subject = `🚨 Shipping Alert — ${alerts.length} issue${alerts.length > 1 ? 's' : ''} found (${today})`

  const sectionHtml = (title: string, emoji: string, rows: AlertRow[]) => {
    if (!rows.length) return ''
    const rowsHtml = rows.map(r => `
      <tr>
        <td style="padding:8px 12px;border-bottom:1px solid #f1f5f9;font-family:monospace;font-size:13px;color:#4f46e5;">${r.awb}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #f1f5f9;font-size:13px;">${r.orderId || '—'}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #f1f5f9;font-size:13px;">${r.status}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #f1f5f9;font-size:13px;color:#64748b;">${r.location || '—'}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #f1f5f9;font-size:13px;color:#64748b;">${r.updated || '—'}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #f1f5f9;font-size:13px;">
          <a href="https://ship.nimbuspost.com/shipping/tracking/${r.awb}" style="color:#4f46e5;">Track</a>
        </td>
      </tr>`).join('')

    return `
      <div style="margin-bottom:28px;">
        <div style="background:#f8fafc;padding:10px 16px;border-left:4px solid #ef4444;margin-bottom:0;font-weight:700;font-size:14px;">${emoji} ${title} (${rows.length})</div>
        <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:13px;">
          <thead>
            <tr style="background:#f1f5f9;">
              <th style="padding:8px 12px;text-align:left;font-size:11px;text-transform:uppercase;color:#64748b;">AWB</th>
              <th style="padding:8px 12px;text-align:left;font-size:11px;text-transform:uppercase;color:#64748b;">Order</th>
              <th style="padding:8px 12px;text-align:left;font-size:11px;text-transform:uppercase;color:#64748b;">Status</th>
              <th style="padding:8px 12px;text-align:left;font-size:11px;text-transform:uppercase;color:#64748b;">Location</th>
              <th style="padding:8px 12px;text-align:left;font-size:11px;text-transform:uppercase;color:#64748b;">Last Update</th>
              <th style="padding:8px 12px;text-align:left;font-size:11px;text-transform:uppercase;color:#64748b;">Link</th>
            </tr>
          </thead>
          <tbody>${rowsHtml}</tbody>
        </table>
      </div>`
  }

  const html = `<!DOCTYPE html><html><body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;background:#ffffff;">
<div style="max-width:800px;margin:0 auto;padding:32px 24px;">
  <div style="display:flex;align-items:center;margin-bottom:24px;padding-bottom:16px;border-bottom:2px solid #ef4444;">
    <span style="display:inline-block;width:28px;height:28px;background:#ef4444;border-radius:6px;text-align:center;line-height:28px;font-weight:800;color:#fff;font-size:14px;margin-right:10px;">N</span>
    <span style="font-weight:700;font-size:16px;color:#0f172a;">NextMile — Shipping Alert Report</span>
    <span style="margin-left:auto;font-size:12px;color:#94a3b8;">${today}</span>
  </div>
  <div style="background:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:14px 18px;margin-bottom:28px;font-size:14px;color:#b91c1c;">
    ⚠️ <strong>${alerts.length} shipment${alerts.length > 1 ? 's require' : ' requires'} attention.</strong> Please review and take action.
  </div>
  ${sectionHtml('NDR / Exceptions', '🔴', groups.exception)}
  ${sectionHtml('Not Picked Up (>' + NOT_PICKED_DAYS + ' day)', '🟠', groups.not_picked)}
  ${sectionHtml('Stuck at Delivery (>' + DELIVERY_STUCK_DAYS + ' days)', '🟡', groups.stuck_delivery)}
  ${sectionHtml('Stuck in Transit (>' + TRANSIT_STUCK_DAYS + ' days)', '🔵', groups.stuck_transit)}
  <div style="border-top:1px solid #e2e8f0;padding-top:14px;font-size:11px;color:#94a3b8;">
    Auto-generated by NextMile shipping monitor. Alerts fire every 12 hours. Same AWB won't re-alert for 24 hours.
  </div>
</div>
</body></html>`

  return { subject, html }
}

// ── WhatsApp summary ──────────────────────────────────────────────────────────

function buildWhatsAppSummary(alerts: AlertRow[]): string {
  const exc  = alerts.filter(a => a.alertType === 'exception').length
  const np   = alerts.filter(a => a.alertType === 'not_picked').length
  const sd   = alerts.filter(a => a.alertType === 'stuck_delivery').length
  const st   = alerts.filter(a => a.alertType === 'stuck_transit').length
  const today = new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', timeZone: 'Asia/Kolkata' })

  const lines = [
    `🚨 *NextMile Shipping Alert — ${today}*`,
    `${alerts.length} shipment${alerts.length > 1 ? 's need' : ' needs'} attention:\n`,
  ]
  if (exc) lines.push(`🔴 ${exc} NDR/Exception${exc > 1 ? 's' : ''}`)
  if (np)  lines.push(`🟠 ${np} Not Picked Up`)
  if (sd)  lines.push(`🟡 ${sd} Stuck at Delivery (>${DELIVERY_STUCK_DAYS}d)`)
  if (st)  lines.push(`🔵 ${st} Stuck in Transit (>${TRANSIT_STUCK_DAYS}d)`)
  lines.push('\nCheck support@gonextmile.in for full details.')

  return lines.join('\n')
}

// ── Main export ───────────────────────────────────────────────────────────────

export interface AlertRunResult {
  checked:  number
  detected: number
  alerted:  number
  skipped:  number
}

export async function runShippingAlerts(): Promise<AlertRunResult> {
  await connectDB()

  const rows     = await readShippingSheet()
  const detected = detectAlerts(rows)
  const newAlerts = await filterNewAlerts(detected)

  if (!newAlerts.length) {
    console.log(`[shipping-alert] Checked ${rows.length} AWBs — ${detected.length} issues found, all already alerted`)
    return { checked: rows.length, detected: detected.length, alerted: 0, skipped: detected.length }
  }

  const { subject, html } = buildAlertEmail(newAlerts)
  const alertEmail = process.env.ALERT_EMAIL || process.env.GMAIL_USER || 'support@gonextmile.in'

  const emailSent = await sendEmail(alertEmail, subject, html)
  console.log(`[shipping-alert] Email to ${alertEmail}: ${emailSent ? 'sent' : 'failed'}`)

  // WhatsApp (optional — only fires if ALERT_WHATSAPP env var is set)
  const alertPhone = process.env.ALERT_WHATSAPP
  if (alertPhone) {
    const msg    = buildWhatsAppSummary(newAlerts)
    const result = await sendTextMessage(alertPhone, msg)
    console.log(`[shipping-alert] WhatsApp to ${alertPhone}: ${result.ok ? 'sent' : result.error}`)
  }

  await logAlerts(newAlerts)

  console.log(`[shipping-alert] Done — Checked: ${rows.length}, Detected: ${detected.length}, Alerted: ${newAlerts.length}`)
  return { checked: rows.length, detected: detected.length, alerted: newAlerts.length, skipped: detected.length - newAlerts.length }
}
