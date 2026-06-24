import { getAccessToken } from '../utils/google-auth'
import { sendEmail }      from './gmail.service'

const SPREADSHEET_ID = '1x2jqCRMBSguFjQXYdMc1SZMyGHVyZOVIt_zUZaht2TM'
const PROJECT_ID     = '963603495843'
const GEMINI_URL     = `https://us-central1-aiplatform.googleapis.com/v1/projects/${PROJECT_ID}/locations/us-central1/publishers/google/models/gemini-2.5-flash:generateContent`

// Column indices in "Nimbus Shipping" tab
const COL_ORDER_ID       = 0
const COL_ORDER_DATE     = 1
const COL_STATUS         = 2
const COL_CITY           = 7
const COL_STATE          = 8
const COL_EVENT          = 11
const COL_AWB            = 13
const COL_COURIER        = 14
const COL_DELIVERED_DATE = 17

interface ShipRow {
  orderId:       string
  orderDate:     string
  status:        string
  city:          string
  state:         string
  event:         string
  awb:           string
  courier:       string
  deliveredDate: string
}

interface CourierStat { total: number; delivered: number; rto: number; lost: number }

interface Metrics {
  total:        number
  dispatched:   number
  delivered:    number
  inTransit:    number
  pending:      number
  rto:          number
  lost:         number
  deliveryRate: string
  topCities:    [string, number][]
  topStates:    [string, number][]
  byEvent:      [string, number][]
  byCourier:    Record<string, CourierStat>
  staleOrders:  { orderId: string; event: string; city: string; ageDays: number }[]
}

// ── Normalisers ───────────────────────────────────────────────────────────────

function normalizeCity(raw: string): string {
  const s = raw.trim()
  if (!s) return ''
  if (/^bangalore$/i.test(s) || /^Bangalore$/i.test(s)) return 'Bengaluru'
  return s.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ')
}

function normalizeEvent(raw: string): string {
  const s = (raw || '').toLowerCase()
  if (s.includes('momentum'))                                   return 'Momentum Run'
  if (s.includes('10k steps') || s.includes('10,000'))         return '10K Steps'
  if (s.includes('women'))                                      return "Women's Run"
  if (s.includes('miles for mom') || s.includes('mother'))     return 'Miles for Mom'
  if (s.includes('conquest'))                                   return 'Conquest Ride'
  if (s.includes('100') && s.includes('km'))                   return '100KM Challenge'
  if (s.includes('progress pack'))                             return 'Progress Pack'
  if (s.includes('endurance'))                                 return 'Endurance Pack'
  if (s.includes('performance'))                               return 'Performance Pack'
  return raw.trim() || 'Other'
}

// ── Date helpers ──────────────────────────────────────────────────────────────

function daysSinceRaw(raw: string): number {
  if (!raw) return 0
  const num = parseFloat(raw)
  if (!isNaN(num) && num > 40000) {
    // Excel / Sheets serial date (days since 1900-01-01, with leap-year offset)
    return (Date.now() - (num - 25569) * 86400000) / 86400000
  }
  const d = new Date(raw)
  return isNaN(d.getTime()) ? 0 : (Date.now() - d.getTime()) / 86400000
}

// ── Sheet reader ──────────────────────────────────────────────────────────────

async function readSheet(): Promise<ShipRow[]> {
  const token = await getAccessToken('GOOGLE_SERVICE_ACCOUNT_JSON', 'https://www.googleapis.com/auth/spreadsheets.readonly')
  if (!token) { console.error('[analytics] Sheet token failed'); return [] }

  const metaRes = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}?fields=sheets.properties`,
    { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10000) },
  )
  const meta   = await metaRes.json() as { sheets?: { properties: { title: string } }[] }
  const title  = (meta.sheets || []).map(s => s.properties.title).find(t => /nimbus shipping/i.test(t)) || ''
  if (!title) { console.error('[analytics] Nimbus Shipping tab not found'); return [] }

  const sheetRes = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values/${encodeURIComponent(`${title}!A:R`)}`,
    { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15000) },
  )
  const data    = await sheetRes.json() as { values?: string[][] }
  const rows    = data.values || []
  const hIdx    = rows.findIndex(r => /order.?id/i.test(String(r[0] || '')))
  const dataRows = rows.slice(hIdx >= 0 ? hIdx + 1 : 1)

  return dataRows
    .filter(r => String(r[COL_ORDER_ID] || '').trim())
    .map(r => ({
      orderId:       String(r[COL_ORDER_ID]       || '').trim(),
      orderDate:     String(r[COL_ORDER_DATE]     || '').trim(),
      status:        String(r[COL_STATUS]         || '').toLowerCase().trim(),
      city:          normalizeCity(String(r[COL_CITY]   || '')),
      state:         String(r[COL_STATE]          || '').trim(),
      event:         normalizeEvent(String(r[COL_EVENT] || '')),
      awb:           String(r[COL_AWB]            || '').trim(),
      courier:       String(r[COL_COURIER]        || '').trim(),
      deliveredDate: String(r[COL_DELIVERED_DATE] || '').trim(),
    }))
}

// ── Metrics ───────────────────────────────────────────────────────────────────

function computeMetrics(rows: ShipRow[]): Metrics {
  const active = rows.filter(r => r.status !== 'cancelled' && r.status !== 'damaged')

  const delivered  = active.filter(r => r.status === 'delivered').length
  const rto        = active.filter(r => r.status === 'rto').length
  const lost       = active.filter(r => r.status === 'lost').length
  const inTransit  = active.filter(r => ['picked', 'in transit', 'rad'].includes(r.status)).length
  const pending    = active.filter(r => ['new', 'pending pickup'].includes(r.status)).length
  const dispatched = active.length - pending
  const deliveryRate = active.length > 0 ? ((delivered / active.length) * 100).toFixed(1) : '0.0'

  // City / State / Event tallies
  const cityMap:  Record<string, number> = {}
  const stateMap: Record<string, number> = {}
  const eventMap: Record<string, number> = {}

  active.forEach(r => {
    if (r.city)  cityMap[r.city]   = (cityMap[r.city]   || 0) + 1
    if (r.state) stateMap[r.state] = (stateMap[r.state] || 0) + 1
    if (r.event) eventMap[r.event] = (eventMap[r.event] || 0) + 1
  })

  const topCities = (Object.entries(cityMap)  as [string, number][]).sort((a, b) => b[1] - a[1]).slice(0, 10)
  const topStates = (Object.entries(stateMap) as [string, number][]).sort((a, b) => b[1] - a[1]).slice(0, 8)
  const byEvent   = (Object.entries(eventMap) as [string, number][]).sort((a, b) => b[1] - a[1])

  // Courier performance
  const byCourier: Record<string, CourierStat> = {}
  active.filter(r => r.courier).forEach(r => {
    if (!byCourier[r.courier]) byCourier[r.courier] = { total: 0, delivered: 0, rto: 0, lost: 0 }
    byCourier[r.courier].total++
    if (r.status === 'delivered') byCourier[r.courier].delivered++
    if (r.status === 'rto')       byCourier[r.courier].rto++
    if (r.status === 'lost')      byCourier[r.courier].lost++
  })

  // Pending orders stale >3 days
  const staleOrders = active
    .filter(r => ['new', 'pending pickup'].includes(r.status) && r.orderDate)
    .map(r => ({ orderId: r.orderId, event: r.event, city: r.city, ageDays: Math.floor(daysSinceRaw(r.orderDate)) }))
    .filter(r => r.ageDays > 3)
    .sort((a, b) => b.ageDays - a.ageDays)
    .slice(0, 20)

  return { total: active.length, dispatched, delivered, inTransit, pending, rto, lost, deliveryRate, topCities, topStates, byEvent, byCourier, staleOrders }
}

// ── Gemini insight ────────────────────────────────────────────────────────────

async function getGeminiInsight(metrics: Metrics, type: 'daily' | 'weekly'): Promise<string> {
  const token = await getAccessToken('CHATBOT_SERVICE_ACCOUNT_JSON', 'https://www.googleapis.com/auth/cloud-platform')
  if (!token) return ''

  const courierSummary = Object.entries(metrics.byCourier)
    .map(([c, s]) => `${c}: ${((s.delivered / s.total) * 100).toFixed(0)}% delivery, ${s.rto} RTO, ${s.lost} lost`)
    .join(' | ')

  const prompt = type === 'daily'
    ? `You are a logistics analyst for NextMile, an Indian virtual fitness challenge company that ships medals to customers.
Daily snapshot:
- Total active orders: ${metrics.total} | Pending dispatch: ${metrics.pending} | In transit: ${metrics.inTransit}
- Delivered: ${metrics.delivered} (${metrics.deliveryRate}% rate) | RTO: ${metrics.rto} | Lost: ${metrics.lost}
- Stale pending orders (>3 days without dispatch): ${metrics.staleOrders.length}
- Couriers: ${courierSummary}

Write 2-3 short, specific, actionable bullet points for the ops team. Highlight any risks. Plain English only. No headers or markdown.`
    : `You are a logistics analyst for NextMile, an Indian virtual fitness challenge company that ships medals to customers.
Weekly analytics:
- Total active orders (all time): ${metrics.total} | Delivery rate: ${metrics.deliveryRate}%
- Pending: ${metrics.pending} | In transit: ${metrics.inTransit} | RTO: ${metrics.rto} | Lost: ${metrics.lost}
- Top 5 cities: ${metrics.topCities.slice(0, 5).map(([c, n]) => `${c} (${n})`).join(', ')}
- Top 5 states: ${metrics.topStates.slice(0, 5).map(([s, n]) => `${s} (${n})`).join(', ')}
- Events: ${metrics.byEvent.slice(0, 6).map(([e, n]) => `${e}: ${n}`).join(', ')}
- Courier performance: ${courierSummary}

Write 4 specific insights for the ops and marketing team covering:
1. Best courier recommendation per region based on the data
2. Which event is strongest and which city to target next
3. Any risk or anomaly that needs attention
4. One growth opportunity based on city/state demand patterns
Be specific with numbers. Plain English bullet points only. No markdown headers.`

  try {
    const res = await fetch(GEMINI_URL, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        contents:         [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: { maxOutputTokens: 450, temperature: 0.4 },
      }),
      signal: AbortSignal.timeout(20000),
    })
    const data = await res.json() as { candidates?: { content?: { parts?: { text?: string }[] } }[] }
    return data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || ''
  } catch (e) {
    console.error('[analytics] Gemini call failed:', e)
    return ''
  }
}

// ── HTML helpers ──────────────────────────────────────────────────────────────

function statCell(label: string, value: string | number, color: string): string {
  return `<td width="33%" style="padding:6px;">
  <div style="background:#f8fafc;border-radius:10px;padding:14px 16px;border-top:3px solid ${color};text-align:center;">
    <div style="font-size:24px;font-weight:800;color:${color};">${value}</div>
    <div style="font-size:11px;color:#64748b;margin-top:4px;text-transform:uppercase;letter-spacing:.04em;">${label}</div>
  </div></td>`
}

function tableHead(...cols: string[]): string {
  return `<thead><tr style="background:#f1f5f9;">${cols.map(c =>
    `<th style="padding:8px 12px;text-align:left;font-size:11px;text-transform:uppercase;color:#64748b;white-space:nowrap;">${c}</th>`
  ).join('')}</tr></thead>`
}

function insightBox(text: string): string {
  if (!text) return ''
  return `<div style="background:#f0f9ff;border:1px solid #bae6fd;border-radius:8px;padding:16px 18px;margin:24px 0;">
  <div style="font-weight:700;font-size:13px;color:#0369a1;margin-bottom:10px;">🤖 Gemini AI Analysis</div>
  <div style="font-size:13px;color:#0f172a;line-height:1.75;white-space:pre-line;">${text}</div>
</div>`
}

function emailShell(title: string, accentColor: string, date: string, body: string): string {
  return `<!DOCTYPE html><html><body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;background:#ffffff;">
<div style="max-width:820px;margin:0 auto;padding:32px 24px;">
  <table width="100%" cellpadding="0" cellspacing="0" style="border-bottom:2px solid ${accentColor};margin-bottom:24px;padding-bottom:16px;">
    <tr>
      <td>
        <span style="display:inline-block;width:28px;height:28px;background:${accentColor};border-radius:6px;text-align:center;line-height:28px;font-weight:800;color:#fff;font-size:14px;margin-right:10px;vertical-align:middle;">N</span>
        <span style="font-weight:700;font-size:16px;color:#0f172a;vertical-align:middle;">${title}</span>
      </td>
      <td style="text-align:right;font-size:12px;color:#94a3b8;">${date}</td>
    </tr>
  </table>
  ${body}
  <div style="border-top:1px solid #e2e8f0;padding-top:14px;margin-top:28px;font-size:11px;color:#94a3b8;">
    Auto-generated by NextMile analytics engine · support@gonextmile.in
  </div>
</div></body></html>`
}

// ── Email builders ────────────────────────────────────────────────────────────

function buildDailyEmail(metrics: Metrics, insight: string): { subject: string; html: string } {
  const today = new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' })

  const staleSection = metrics.staleOrders.length
    ? `<h3 style="font-size:14px;font-weight:700;color:#b45309;margin:24px 0 8px;">⚠️ Pending Orders Stale &gt;3 Days (${metrics.staleOrders.length})</h3>
<table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
${tableHead('Order ID', 'Event', 'City', 'Days Pending')}
<tbody>${metrics.staleOrders.map(o =>
  `<tr>
    <td style="padding:8px 12px;border-bottom:1px solid #f1f5f9;font-size:13px;">${o.orderId}</td>
    <td style="padding:8px 12px;border-bottom:1px solid #f1f5f9;font-size:13px;">${o.event}</td>
    <td style="padding:8px 12px;border-bottom:1px solid #f1f5f9;font-size:13px;">${o.city || '—'}</td>
    <td style="padding:8px 12px;border-bottom:1px solid #f1f5f9;font-size:13px;font-weight:700;color:#ef4444;">${o.ageDays}d</td>
  </tr>`).join('')}
</tbody></table>`
    : '<p style="color:#16a34a;font-size:13px;margin:0;">✅ No stale pending orders — all recent dispatches are within 3 days.</p>'

  const body = `
<table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
  <tr>
    ${statCell('Pending Dispatch', metrics.pending,    '#f59e0b')}
    ${statCell('In Transit',       metrics.inTransit,  '#3b82f6')}
    ${statCell('Delivered',        metrics.delivered,  '#10b981')}
  </tr>
  <tr>
    ${statCell('RTO',             metrics.rto,          '#ef4444')}
    ${statCell('Lost',            metrics.lost,         '#dc2626')}
    ${statCell('Delivery Rate',   metrics.deliveryRate + '%', '#8b5cf6')}
  </tr>
</table>
${insightBox(insight)}
${staleSection}`

  return {
    subject: `📦 NextMile Daily Dispatch — ${today}`,
    html: emailShell('NextMile — Daily Dispatch Report', '#3b82f6', today, body),
  }
}

function buildWeeklyEmail(metrics: Metrics, insight: string): { subject: string; html: string } {
  const today = new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' })

  const courierRows = Object.entries(metrics.byCourier)
    .sort((a, b) => b[1].total - a[1].total)
    .map(([name, s]) => {
      const rate = s.total > 0 ? ((s.delivered / s.total) * 100).toFixed(1) : '0.0'
      const rateColor = parseFloat(rate) >= 92 ? '#16a34a' : parseFloat(rate) >= 85 ? '#d97706' : '#dc2626'
      return `<tr>
        <td style="padding:10px 12px;border-bottom:1px solid #f1f5f9;font-weight:600;font-size:13px;">${name}</td>
        <td style="padding:10px 12px;border-bottom:1px solid #f1f5f9;font-size:13px;">${s.total}</td>
        <td style="padding:10px 12px;border-bottom:1px solid #f1f5f9;font-size:13px;font-weight:700;color:${rateColor};">${rate}%</td>
        <td style="padding:10px 12px;border-bottom:1px solid #f1f5f9;font-size:13px;">${s.rto}</td>
        <td style="padding:10px 12px;border-bottom:1px solid #f1f5f9;font-size:13px;${s.lost > 0 ? 'color:#ef4444;font-weight:700;' : 'color:#16a34a;'}">${s.lost}</td>
      </tr>`
    }).join('')

  const cityRows = metrics.topCities.map(([city, count], i) =>
    `<tr><td style="padding:7px 12px;border-bottom:1px solid #f1f5f9;font-size:13px;">${i + 1}. ${city}</td><td style="padding:7px 12px;border-bottom:1px solid #f1f5f9;font-size:13px;font-weight:700;">${count}</td></tr>`
  ).join('')

  const eventRows = metrics.byEvent.slice(0, 8).map(([event, count]) =>
    `<tr><td style="padding:7px 12px;border-bottom:1px solid #f1f5f9;font-size:13px;">${event}</td><td style="padding:7px 12px;border-bottom:1px solid #f1f5f9;font-size:13px;font-weight:700;">${count}</td></tr>`
  ).join('')

  const stateRows = metrics.topStates.map(([state, count]) =>
    `<tr><td style="padding:7px 12px;border-bottom:1px solid #f1f5f9;font-size:13px;">${state}</td><td style="padding:7px 12px;border-bottom:1px solid #f1f5f9;font-size:13px;font-weight:700;">${count}</td></tr>`
  ).join('')

  const body = `
<table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:8px;">
  <tr>
    ${statCell('Total Orders',   metrics.total,                '#8b5cf6')}
    ${statCell('Delivered',      metrics.delivered,            '#10b981')}
    ${statCell('Delivery Rate',  metrics.deliveryRate + '%',   '#3b82f6')}
  </tr>
  <tr>
    ${statCell('In Transit',     metrics.inTransit,            '#f59e0b')}
    ${statCell('RTO',            metrics.rto,                  '#ef4444')}
    ${statCell('Lost',           metrics.lost,                 '#dc2626')}
  </tr>
</table>
${insightBox(insight)}
<h3 style="font-size:14px;font-weight:700;color:#0f172a;margin:24px 0 8px;">🚚 Courier Performance</h3>
<table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
  ${tableHead('Courier', 'Total', 'Delivery %', 'RTO', 'Lost')}
  <tbody>${courierRows}</tbody>
</table>
<table width="100%" cellpadding="0" cellspacing="0" style="margin-top:24px;">
  <tr>
    <td width="50%" style="vertical-align:top;padding-right:16px;">
      <h3 style="font-size:14px;font-weight:700;color:#0f172a;margin:0 0 8px;">🏙️ Top Cities</h3>
      <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
        <tbody>${cityRows}</tbody>
      </table>
    </td>
    <td width="50%" style="vertical-align:top;">
      <h3 style="font-size:14px;font-weight:700;color:#0f172a;margin:0 0 8px;">🎽 Orders by Event</h3>
      <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
        <tbody>${eventRows}</tbody>
      </table>
    </td>
  </tr>
</table>
<h3 style="font-size:14px;font-weight:700;color:#0f172a;margin:24px 0 8px;">🗺️ State Breakdown</h3>
<table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
  <tbody>${stateRows}</tbody>
</table>`

  return {
    subject: `📊 NextMile Weekly Analytics — ${today}`,
    html: emailShell('NextMile — Weekly Analytics Report', '#8b5cf6', today, body),
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

export async function runDailyAnalyticsReport(): Promise<void> {
  const rows    = await readSheet()
  const metrics = computeMetrics(rows)
  const insight = await getGeminiInsight(metrics, 'daily')

  const { subject, html } = buildDailyEmail(metrics, insight)
  const to   = process.env.ALERT_EMAIL || 'support@gonextmile.in'
  const sent = await sendEmail(to, subject, html)
  console.log(`[analytics] Daily → ${to}: ${sent ? 'sent' : 'failed'} | pending=${metrics.pending} transit=${metrics.inTransit} rate=${metrics.deliveryRate}%`)
}

export async function runWeeklyAnalyticsReport(): Promise<void> {
  const rows    = await readSheet()
  const metrics = computeMetrics(rows)
  const insight = await getGeminiInsight(metrics, 'weekly')

  const { subject, html } = buildWeeklyEmail(metrics, insight)
  const to   = process.env.ALERT_EMAIL || 'support@gonextmile.in'
  const sent = await sendEmail(to, subject, html)
  console.log(`[analytics] Weekly → ${to}: ${sent ? 'sent' : 'failed'} | total=${metrics.total} rate=${metrics.deliveryRate}%`)
}
