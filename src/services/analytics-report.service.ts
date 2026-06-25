import { getAccessToken } from '../utils/google-auth'
import { sendEmail }      from './gmail.service'

const SPREADSHEET_ID = '1x2jqCRMBSguFjQXYdMc1SZMyGHVyZOVIt_zUZaht2TM'
const PROJECT_ID     = '963603495843'
const GEMINI_URL     = `https://us-central1-aiplatform.googleapis.com/v1/projects/${PROJECT_ID}/locations/us-central1/publishers/google/models/gemini-2.5-flash:generateContent`

// Column indices in "Nimbus Shipping" tab (A:R = cols 0–17)
const COL_ORDER_ID       = 0
const COL_ORDER_DATE     = 1
const COL_STATUS         = 2
const COL_PHONE          = 4
const COL_CITY           = 7
const COL_STATE          = 8
const COL_EVENT          = 11
const COL_AMOUNT         = 12
const COL_AWB            = 13
const COL_COURIER        = 14
const COL_SHIPPED_DATE   = 16
const COL_DELIVERED_DATE = 17

// ── Types ─────────────────────────────────────────────────────────────────────

interface ShipRow {
  orderId:       string
  orderDate:     string
  status:        string
  phone:         string
  city:          string
  state:         string
  event:         string
  amount:        number
  awb:           string
  courier:       string
  shippedDate:   string
  deliveredDate: string
}

interface CourierStat { total: number; delivered: number; rto: number; lost: number }

interface DispatchSLA    { within1: number; within2: number; within3: number; beyond3: number; total: number }
interface LoyaltyStat    { uniqueCustomers: number; single: number; double: number; tripleplus: number }
interface EventRevenue   { event: string; count: number; revenue: number; avg: number }
interface CityRisk       { city: string; total: number; rtoRate: number; lostRate: number }
interface SpeedEntry     { state: string; bestCourier: string; avgDays: number }
interface EventCityRow   { event: string; topCities: [string, number][] }
interface WeeklyEventStat { event: string; thisWeek: number; lastWeek: number; growth: number; revenue: number }
interface EventPipeline  { event: string; total: number; shipped: number; pending: number }

interface Metrics {
  total:            number
  dispatched:       number
  delivered:        number
  inTransit:        number
  pending:          number
  rto:              number
  lost:             number
  deliveryRate:     string
  topCities:        [string, number][]
  topStates:        [string, number][]
  byCourier:        Record<string, CourierStat>
  dispatchSLA:      DispatchSLA
  deliverySpeed:    Record<string, number>
  speedByState:     SpeedEntry[]
  revenueByEvent:   EventRevenue[]
  totalRevenue:     number
  loyalty:          LoyaltyStat
  highRtoCities:    CityRisk[]
  eventCityMatrix:  EventCityRow[]
  byEvent:          [string, number][]
  staleOrders:      { orderId: string; event: string; city: string; ageDays: number }[]
  weeklyEvents:     WeeklyEventStat[]
  weeklyTopCities:  [string, number][]
  weeklyRevenue:    number
  topEventThisWeek: string
  eventPipeline:    EventPipeline[]
}

// ── Normalisers ───────────────────────────────────────────────────────────────

function normalizeCity(raw: string): string {
  const s = raw.trim()
  if (!s) return ''
  if (/^bangalore$/i.test(s)) return 'Bengaluru'
  return s.split(' ').map(w => w ? w[0].toUpperCase() + w.slice(1).toLowerCase() : '').join(' ')
}

function normalizeState(raw: string): string {
  const s = raw.trim()
  if (!s) return ''
  return s.split(' ').map(w => w ? w[0].toUpperCase() + w.slice(1).toLowerCase() : '').join(' ')
}

function normalizeEvent(raw: string): string {
  const s = (raw || '').toLowerCase().trim()
  if (!s || s === 'watch') return ''  // physical product, not a virtual event
  if (s.includes('momentum'))                               return 'Momentum Run'
  if (s.includes('10k steps') || s.includes('10,000'))     return '10K Steps'
  if (s.includes('women'))                                  return "Women's Run"
  if (s.includes('miles for mom') || s.includes('mother')) return 'Miles for Mom'
  if (s.includes('conquest'))                               return 'Conquest Ride'
  if (s.includes('100') && s.includes('km'))               return '100KM Challenge'
  if (s.includes('progress pack'))                         return 'Progress Pack'
  if (s.includes('endurance'))                             return 'Endurance Pack'
  if (s.includes('performance'))                           return 'Performance Pack'
  return raw.trim() || 'Other'
}

// ── Date helpers ──────────────────────────────────────────────────────────────

function serialDiff(a: string, b: string): number | null {
  const na = parseFloat(a); const nb = parseFloat(b)
  if (isNaN(na) || isNaN(nb) || na < 40000 || nb < 40000) return null
  const diff = nb - na
  return diff >= 0 && diff <= 60 ? diff : null
}

function daysSinceSerial(raw: string): number {
  if (!raw) return 0
  const n = parseFloat(raw)
  if (!isNaN(n) && n > 40000) return (Date.now() - (n - 25569) * 86400000) / 86400000
  const d = new Date(raw)
  return isNaN(d.getTime()) ? 0 : (Date.now() - d.getTime()) / 86400000
}

// ── Sheet reader ──────────────────────────────────────────────────────────────

async function readSheet(): Promise<ShipRow[]> {
  const token = await getAccessToken('GOOGLE_SERVICE_ACCOUNT_JSON', 'https://www.googleapis.com/auth/spreadsheets.readonly')
  if (!token) { console.error('[analytics] Sheet token failed'); return [] }

  const metaRes  = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}?fields=sheets.properties`,
    { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10000) },
  )
  const meta  = await metaRes.json() as { sheets?: { properties: { title: string } }[] }
  const title = (meta.sheets || []).map(s => s.properties.title).find(t => /nimbus shipping/i.test(t)) || ''
  if (!title) { console.error('[analytics] Nimbus Shipping tab not found'); return [] }

  const sheetRes = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values/${encodeURIComponent(`${title}!A:R`)}`,
    { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(20000) },
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
      phone:         String(r[COL_PHONE]          || '').trim().slice(-10),
      city:          normalizeCity(String(r[COL_CITY]     || '')),
      state:         normalizeState(String(r[COL_STATE]   || '')),
      event:         normalizeEvent(String(r[COL_EVENT]   || '')),
      amount:        parseFloat(r[COL_AMOUNT]     || '0') || 0,
      awb:           String(r[COL_AWB]            || '').trim(),
      courier:       String(r[COL_COURIER]        || '').trim(),
      shippedDate:   String(r[COL_SHIPPED_DATE]   || '').trim(),
      deliveredDate: String(r[COL_DELIVERED_DATE] || '').trim(),
    }))
    .filter(r => r.event)  // exclude Watch and unmapped physical products
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

  // ── City / State / Event tallies ──
  const cityMap:  Record<string, number> = {}
  const stateMap: Record<string, number> = {}
  const eventMap: Record<string, number> = {}
  active.forEach(r => {
    if (r.city)  cityMap[r.city]   = (cityMap[r.city]  || 0) + 1
    if (r.state) stateMap[r.state] = (stateMap[r.state]|| 0) + 1
    if (r.event) eventMap[r.event] = (eventMap[r.event]|| 0) + 1
  })
  const topCities = (Object.entries(cityMap)  as [string, number][]).sort((a, b) => b[1] - a[1]).slice(0, 10)
  const topStates = (Object.entries(stateMap) as [string, number][]).sort((a, b) => b[1] - a[1]).slice(0, 8)
  const byEvent   = (Object.entries(eventMap) as [string, number][]).sort((a, b) => b[1] - a[1])

  // ── Courier performance ──
  const byCourier: Record<string, CourierStat> = {}
  active.filter(r => r.courier).forEach(r => {
    if (!byCourier[r.courier]) byCourier[r.courier] = { total: 0, delivered: 0, rto: 0, lost: 0 }
    byCourier[r.courier].total++
    if (r.status === 'delivered') byCourier[r.courier].delivered++
    if (r.status === 'rto')       byCourier[r.courier].rto++
    if (r.status === 'lost')      byCourier[r.courier].lost++
  })

  // ── Dispatch SLA (Order Date → Shipped Date) ──
  const dispatchSLA: DispatchSLA = { within1: 0, within2: 0, within3: 0, beyond3: 0, total: 0 }
  active.filter(r => r.shippedDate && r.orderDate).forEach(r => {
    const diff = serialDiff(r.orderDate, r.shippedDate)
    if (diff === null) return
    dispatchSLA.total++
    if (diff <= 1)      dispatchSLA.within1++
    else if (diff <= 2) dispatchSLA.within2++
    else if (diff <= 3) dispatchSLA.within3++
    else                dispatchSLA.beyond3++
  })

  // ── Delivery speed per courier (Shipped → Delivered) ──
  const courierDaysMap: Record<string, number[]> = {}
  active.filter(r => r.status === 'delivered' && r.shippedDate && r.deliveredDate && r.courier).forEach(r => {
    const diff = serialDiff(r.shippedDate, r.deliveredDate)
    if (diff === null) return
    if (!courierDaysMap[r.courier]) courierDaysMap[r.courier] = []
    courierDaysMap[r.courier].push(diff)
  })
  const deliverySpeed: Record<string, number> = {}
  Object.entries(courierDaysMap).forEach(([c, arr]) => {
    deliverySpeed[c] = parseFloat((arr.reduce((s, v) => s + v, 0) / arr.length).toFixed(1))
  })

  // ── Best courier per state ──
  const stateCourierDays: Record<string, Record<string, number[]>> = {}
  active.filter(r => r.status === 'delivered' && r.shippedDate && r.deliveredDate && r.state && r.courier).forEach(r => {
    const diff = serialDiff(r.shippedDate, r.deliveredDate)
    if (diff === null) return
    if (!stateCourierDays[r.state]) stateCourierDays[r.state] = {}
    if (!stateCourierDays[r.state][r.courier]) stateCourierDays[r.state][r.courier] = []
    stateCourierDays[r.state][r.courier].push(diff)
  })
  const speedByState: SpeedEntry[] = []
  Object.entries(stateCourierDays).forEach(([state, couriers]) => {
    const candidates = (Object.entries(couriers) as [string, number[]][])
      .map(([c, days]) => ({ courier: c, avg: days.reduce((s, v) => s + v, 0) / days.length, n: days.length }))
      .filter(x => x.n >= 10)
      .sort((a, b) => a.avg - b.avg)
    if (candidates.length > 0) {
      const best = candidates[0]
      speedByState.push({ state, bestCourier: best.courier, avgDays: parseFloat(best.avg.toFixed(1)) })
    }
  })
  speedByState.sort((a, b) => a.state.localeCompare(b.state))

  // ── Revenue by event ──
  const evRevMap: Record<string, { count: number; revenue: number }> = {}
  active.filter(r => r.event && r.amount).forEach(r => {
    if (!evRevMap[r.event]) evRevMap[r.event] = { count: 0, revenue: 0 }
    evRevMap[r.event].count++
    evRevMap[r.event].revenue += r.amount
  })
  const revenueByEvent: EventRevenue[] = Object.entries(evRevMap)
    .map(([event, s]) => ({ event, count: s.count, revenue: s.revenue, avg: Math.round(s.revenue / s.count) }))
    .sort((a, b) => b.revenue - a.revenue)
  const totalRevenue = revenueByEvent.reduce((s, e) => s + e.revenue, 0)

  // ── Customer loyalty (by phone) ──
  const phoneEventsMap: Record<string, Set<string>> = {}
  active.filter(r => r.phone && r.phone.length === 10).forEach(r => {
    if (!phoneEventsMap[r.phone]) phoneEventsMap[r.phone] = new Set()
    if (r.event) phoneEventsMap[r.phone].add(r.event)
  })
  const phoneList = Object.values(phoneEventsMap)
  const loyalty: LoyaltyStat = {
    uniqueCustomers: phoneList.length,
    single:          phoneList.filter(e => e.size === 1).length,
    double:          phoneList.filter(e => e.size === 2).length,
    tripleplus:      phoneList.filter(e => e.size >= 3).length,
  }

  // ── High-RTO cities ──
  const cityRiskMap: Record<string, { total: number; rto: number; lost: number }> = {}
  active.forEach(r => {
    if (!r.city) return
    if (!cityRiskMap[r.city]) cityRiskMap[r.city] = { total: 0, rto: 0, lost: 0 }
    cityRiskMap[r.city].total++
    if (r.status === 'rto')  cityRiskMap[r.city].rto++
    if (r.status === 'lost') cityRiskMap[r.city].lost++
  })
  const highRtoCities: CityRisk[] = (Object.entries(cityRiskMap) as [string, { total: number; rto: number; lost: number }][])
    .filter(([, s]) => s.total >= 10 && (s.rto + s.lost) / s.total >= 0.05)
    .map(([city, s]) => ({
      city,
      total:    s.total,
      rtoRate:  parseFloat(((s.rto  / s.total) * 100).toFixed(1)),
      lostRate: parseFloat(((s.lost / s.total) * 100).toFixed(1)),
    }))
    .sort((a, b) => (b.rtoRate + b.lostRate) - (a.rtoRate + a.lostRate))
    .slice(0, 10)

  // ── Event × City matrix ──
  const evCityMap: Record<string, Record<string, number>> = {}
  active.forEach(r => {
    if (!r.event || !r.city) return
    if (!evCityMap[r.event]) evCityMap[r.event] = {}
    evCityMap[r.event][r.city] = (evCityMap[r.event][r.city] || 0) + 1
  })
  const mainEvents = ['Momentum Run', '10K Steps', "Women's Run", 'Miles for Mom', 'Conquest Ride', '100KM Challenge', 'Progress Pack', 'Endurance Pack', 'Performance Pack']
  const eventCityMatrix: EventCityRow[] = mainEvents
    .filter(ev => evCityMap[ev])
    .map(ev => ({
      event: ev,
      topCities: (Object.entries(evCityMap[ev]) as [string, number][])
        .sort((a, b) => b[1] - a[1]).slice(0, 3),
    }))

  // ── Stale pending orders (>3 days since order date) ──
  const staleOrders = active
    .filter(r => ['new', 'pending pickup'].includes(r.status) && r.orderDate)
    .map(r => ({ orderId: r.orderId, event: r.event, city: r.city, ageDays: Math.floor(daysSinceSerial(r.orderDate)) }))
    .filter(r => r.ageDays > 3)
    .sort((a, b) => b.ageDays - a.ageDays)
    .slice(0, 20)

  // ── Weekly breakdown (this week vs last 7–14 days) ──
  const TODAY_SERIAL    = Date.now() / 86400000 + 25569
  const THIS_WEEK_START = TODAY_SERIAL - 7
  const LAST_WEEK_START = TODAY_SERIAL - 14

  const thisWeekRows = active.filter(r => { const s = parseFloat(r.orderDate); return !isNaN(s) && s > 40000 && s >= THIS_WEEK_START })
  const lastWeekRows = active.filter(r => { const s = parseFloat(r.orderDate); return !isNaN(s) && s > 40000 && s >= LAST_WEEK_START && s < THIS_WEEK_START })

  const twEvMap: Record<string, { count: number; revenue: number }> = {}
  thisWeekRows.forEach(r => {
    if (!r.event) return
    if (!twEvMap[r.event]) twEvMap[r.event] = { count: 0, revenue: 0 }
    twEvMap[r.event].count++
    twEvMap[r.event].revenue += r.amount
  })
  const lwEvMap: Record<string, number> = {}
  lastWeekRows.forEach(r => { if (r.event) lwEvMap[r.event] = (lwEvMap[r.event] || 0) + 1 })

  const weeklyEvents: WeeklyEventStat[] = (Object.entries(twEvMap) as [string, { count: number; revenue: number }][])
    .sort((a, b) => b[1].count - a[1].count)
    .map(([event, s]) => ({
      event,
      thisWeek: s.count,
      lastWeek: lwEvMap[event] || 0,
      growth:   lwEvMap[event] > 0 ? Math.round(((s.count - lwEvMap[event]) / lwEvMap[event]) * 100) : 100,
      revenue:  s.revenue,
    }))

  const topEventThisWeek = weeklyEvents[0]?.event || '—'
  const weeklyRevenue    = thisWeekRows.reduce((s, r) => s + r.amount, 0)

  const twCityMap: Record<string, number> = {}
  thisWeekRows.forEach(r => { if (r.city) twCityMap[r.city] = (twCityMap[r.city] || 0) + 1 })
  const weeklyTopCities: [string, number][] = (Object.entries(twCityMap) as [string, number][])
    .sort((a, b) => b[1] - a[1]).slice(0, 8)

  // ── Event pipeline (registered → shipped → pending) ──
  const pipelineMap: Record<string, { total: number; shipped: number; pending: number }> = {}
  active.forEach(r => {
    if (!r.event) return
    if (!pipelineMap[r.event]) pipelineMap[r.event] = { total: 0, shipped: 0, pending: 0 }
    pipelineMap[r.event].total++
    if (['new', 'pending pickup'].includes(r.status)) pipelineMap[r.event].pending++
    else pipelineMap[r.event].shipped++
  })
  const eventPipeline: EventPipeline[] = (Object.entries(pipelineMap) as [string, { total: number; shipped: number; pending: number }][])
    .map(([event, s]) => ({ event, ...s }))
    .sort((a, b) => b.pending - a.pending)

  return {
    total: active.length, dispatched, delivered, inTransit, pending, rto, lost, deliveryRate,
    topCities, topStates, byEvent, byCourier,
    dispatchSLA, deliverySpeed, speedByState,
    revenueByEvent, totalRevenue,
    loyalty, highRtoCities, eventCityMatrix,
    staleOrders,
    weeklyEvents, weeklyTopCities, weeklyRevenue, topEventThisWeek,
    eventPipeline,
  }
}

// ── Gemini insight ────────────────────────────────────────────────────────────

async function getGeminiInsight(metrics: Metrics, type: 'daily' | 'weekly'): Promise<string> {
  const token = await getAccessToken('CHATBOT_SERVICE_ACCOUNT_JSON', 'https://www.googleapis.com/auth/cloud-platform')
  if (!token) return ''

  const courierSummary = Object.entries(metrics.byCourier)
    .map(([c, s]) => `${c}: ${((s.delivered/s.total)*100).toFixed(0)}% delivery, ${s.rto} RTO, ${s.lost} lost, avg ${metrics.deliverySpeed[c] ?? '?'}d`)
    .join(' | ')

  const stateSummary = metrics.speedByState.slice(0, 8)
    .map(x => `${x.state}: ${x.bestCourier} (${x.avgDays}d)`)
    .join(', ')

  const revSummary = metrics.revenueByEvent.slice(0, 5)
    .map(e => `${e.event}: ₹${Math.round(e.revenue/1000)}K (${e.count} orders, avg ₹${e.avg})`)
    .join(' | ')

  const loyaltySummary = `${metrics.loyalty.uniqueCustomers} unique customers — ${metrics.loyalty.double} did 2 events, ${metrics.loyalty.tripleplus} did 3+`

  const prompt = type === 'daily'
    ? `You are a logistics analyst for NextMile, an Indian virtual fitness medal company.
Daily snapshot:
- Pending dispatch: ${metrics.pending} | In transit: ${metrics.inTransit} | Delivered: ${metrics.delivered} (${metrics.deliveryRate}%)
- RTO: ${metrics.rto} | Lost: ${metrics.lost}
- Dispatch SLA: ${metrics.dispatchSLA.within1} dispatched same day, ${metrics.dispatchSLA.beyond3} took >3 days (out of ${metrics.dispatchSLA.total})
- Stale orders >3 days: ${metrics.staleOrders.length}
- Courier summary: ${courierSummary}

Write 2-3 short, specific, actionable bullet points for the ops team. Highlight risks. Plain English only. No headers or markdown.`

    : `You are a logistics analyst for NextMile, an Indian virtual fitness medal company.
FULL DATA:
- Pipeline: ${metrics.total} active orders | ${metrics.delivered} delivered (${metrics.deliveryRate}%) | ${metrics.rto} RTO | ${metrics.lost} lost
- Dispatch SLA: ${metrics.dispatchSLA.within1} same-day, ${metrics.dispatchSLA.within1+metrics.dispatchSLA.within2} within 2d, ${metrics.dispatchSLA.beyond3} beyond 3d (total ${metrics.dispatchSLA.total})
- Courier performance: ${courierSummary}
- Best courier per state: ${stateSummary}
- Revenue: Total ₹${Math.round(metrics.totalRevenue/1000)}K | ${revSummary}
- Customer loyalty: ${loyaltySummary}
- High-RTO cities: ${metrics.highRtoCities.slice(0,5).map(c=>`${c.city} (${c.rtoRate+c.lostRate}% problem rate)`).join(', ')}
- THIS WEEK: ${metrics.weeklyEvents.reduce((s,e)=>s+e.thisWeek,0)} registrations | ₹${Math.round(metrics.weeklyRevenue/1000)}K revenue | #1: ${metrics.topEventThisWeek}
- Week-over-week: ${metrics.weeklyEvents.slice(0,4).map(e=>`${e.event} ${e.thisWeek} vs ${e.lastWeek} (${e.growth>0?'+':''}${e.growth}%)`).join(' | ')}
- Pending to dispatch: ${metrics.eventPipeline.slice(0,3).map(e=>`${e.event}:${e.pending}`).join(', ')}

Write 5 specific logistics/ops insights. Be specific with numbers. Plain English. Each point on its own line starting with •`

  try {
    const res = await fetch(GEMINI_URL, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        contents:         [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: { maxOutputTokens: 500, temperature: 0.4 },
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

async function getMarketingTips(metrics: Metrics): Promise<string> {
  const token = await getAccessToken('CHATBOT_SERVICE_ACCOUNT_JSON', 'https://www.googleapis.com/auth/cloud-platform')
  if (!token) return ''

  const loyaltyPct = metrics.loyalty.uniqueCustomers > 0
    ? Math.round(((metrics.loyalty.double + metrics.loyalty.tripleplus) / metrics.loyalty.uniqueCustomers) * 100)
    : 0

  const prompt = `You are a growth marketer for NextMile, an Indian virtual fitness medal brand (gonextmile.in).
Customers register for virtual challenges (5K run, 10K cycling, etc.), complete them, and get a physical medal shipped home.

THIS WEEK'S DATA:
- Registrations this week: ${metrics.weeklyEvents.reduce((s,e)=>s+e.thisWeek,0)} | Revenue: ₹${Math.round(metrics.weeklyRevenue/1000)}K
- #1 event this week: ${metrics.topEventThisWeek} (${metrics.weeklyEvents[0]?.thisWeek||0} registrations)
- Hot cities buying right now: ${metrics.weeklyTopCities.slice(0,5).map(([c,n])=>`${c}(${n})`).join(', ')}
- Week-over-week: ${metrics.weeklyEvents.slice(0,5).map(e=>`${e.event}: ${e.thisWeek} (${e.growth>0?'+':''}${e.growth}%)`).join(' | ')}
- Medals still pending dispatch: ${metrics.eventPipeline.slice(0,4).map(e=>`${e.event}=${e.pending} pending`).join(', ')}
- Customer loyalty: ${metrics.loyalty.uniqueCustomers} customers, ${loyaltyPct}% are repeat buyers (${metrics.loyalty.double} did 2 events, ${metrics.loyalty.tripleplus} did 3+)
- Event × city leaders: ${metrics.eventCityMatrix.slice(0,4).map(e=>`${e.event}→${e.topCities[0]?.[0]||'?'}`).join(', ')}
- Avoid spending in (high RTO): ${metrics.highRtoCities.slice(0,3).map(c=>c.city).join(', ')}

Give 4 sharp, specific marketing action items for this week. Use real numbers. Each starts with • on its own line.
1. Which exact city + event to target RIGHT NOW in Instagram/WhatsApp ads and why
2. One WhatsApp message idea to re-engage repeat customers (mention their past event, cross-sell another)
3. One FOMO/urgency message based on pipeline data (e.g. "X medals dispatched this week")
4. One growth move based on which city or event is growing fastest this week`

  try {
    const res = await fetch(GEMINI_URL, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        contents:         [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: { maxOutputTokens: 600, temperature: 0.6 },
      }),
      signal: AbortSignal.timeout(20000),
    })
    const data = await res.json() as { candidates?: { content?: { parts?: { text?: string }[] } }[] }
    return data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || ''
  } catch (e) {
    console.error('[analytics] Gemini marketing tips failed:', e)
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

function sectionHead(emoji: string, title: string): string {
  return `<h3 style="font-size:14px;font-weight:700;color:#0f172a;margin:28px 0 8px;padding-bottom:6px;border-bottom:1px solid #e2e8f0;">${emoji} ${title}</h3>`
}

function tableHead(...cols: string[]): string {
  return `<thead><tr style="background:#f1f5f9;">${cols.map(c =>
    `<th style="padding:8px 12px;text-align:left;font-size:11px;text-transform:uppercase;color:#64748b;white-space:nowrap;">${c}</th>`
  ).join('')}</tr></thead>`
}

function slaBar(label: string, count: number, total: number, color: string): string {
  const pct = total > 0 ? Math.round((count / total) * 100) : 0
  return `<tr>
    <td style="padding:7px 12px;font-size:13px;white-space:nowrap;width:120px;">${label}</td>
    <td style="padding:7px 12px;width:200px;">
      <div style="background:#e2e8f0;border-radius:4px;height:8px;">
        <div style="background:${color};border-radius:4px;height:8px;width:${pct}%;"></div>
      </div>
    </td>
    <td style="padding:7px 12px;font-size:13px;font-weight:700;color:${color};">${pct}%</td>
    <td style="padding:7px 12px;font-size:13px;color:#64748b;">${count} orders</td>
  </tr>`
}

function insightBox(text: string): string {
  if (!text) return ''
  return `<div style="background:#f0f9ff;border:1px solid #bae6fd;border-radius:8px;padding:16px 20px;margin:24px 0;">
  <div style="font-weight:700;font-size:13px;color:#0369a1;margin-bottom:10px;">🤖 Gemini AI — Logistics Insights</div>
  <div style="font-size:13px;color:#0f172a;line-height:1.8;white-space:pre-line;">${text}</div>
</div>`
}

function marketingBox(text: string): string {
  if (!text) return ''
  return `<div style="background:#fdf4ff;border:1px solid #e9d5ff;border-radius:8px;padding:16px 20px;margin:24px 0;">
  <div style="font-weight:700;font-size:13px;color:#7c3aed;margin-bottom:10px;">💡 Gemini — Marketing Intelligence</div>
  <div style="font-size:13px;color:#0f172a;line-height:1.8;white-space:pre-line;">${text}</div>
</div>`
}

function emailShell(title: string, accentColor: string, date: string, body: string): string {
  return `<!DOCTYPE html><html><body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;background:#ffffff;">
<div style="max-width:860px;margin:0 auto;padding:32px 24px;">
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

// ── Daily email ───────────────────────────────────────────────────────────────

function buildDailyEmail(m: Metrics, insight: string): { subject: string; html: string } {
  const today   = new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' })
  const slaTotal = m.dispatchSLA.total

  const staleHtml = m.staleOrders.length
    ? `${sectionHead('⚠️', `Pending Orders Stale >3 Days (${m.staleOrders.length})`)}
<table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
${tableHead('Order ID', 'Event', 'City', 'Days Pending')}
<tbody>${m.staleOrders.map(o =>
  `<tr>
    <td style="padding:8px 12px;border-bottom:1px solid #f1f5f9;font-size:13px;">${o.orderId}</td>
    <td style="padding:8px 12px;border-bottom:1px solid #f1f5f9;font-size:13px;">${o.event}</td>
    <td style="padding:8px 12px;border-bottom:1px solid #f1f5f9;font-size:13px;">${o.city || '—'}</td>
    <td style="padding:8px 12px;border-bottom:1px solid #f1f5f9;font-size:13px;font-weight:700;color:#ef4444;">${o.ageDays}d</td>
  </tr>`).join('')}
</tbody></table>`
    : `<p style="color:#16a34a;font-size:13px;margin:16px 0;">✅ No stale pending orders.</p>`

  const body = `
<table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
  <tr>
    ${statCell('Pending Dispatch', m.pending,   '#f59e0b')}
    ${statCell('In Transit',       m.inTransit, '#3b82f6')}
    ${statCell('Delivered',        m.delivered, '#10b981')}
  </tr>
  <tr>
    ${statCell('RTO',          m.rto,              '#ef4444')}
    ${statCell('Lost',         m.lost,             '#dc2626')}
    ${statCell('Delivery Rate',m.deliveryRate + '%','#8b5cf6')}
  </tr>
</table>
${insightBox(insight)}
${sectionHead('📦', 'Dispatch SLA (Order Date → Shipped)')}
<table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
  <tbody>
    ${slaBar('Same Day',     m.dispatchSLA.within1, slaTotal, '#10b981')}
    ${slaBar('Within 2 Days', m.dispatchSLA.within2, slaTotal, '#3b82f6')}
    ${slaBar('Within 3 Days', m.dispatchSLA.within3, slaTotal, '#f59e0b')}
    ${slaBar('Beyond 3 Days', m.dispatchSLA.beyond3, slaTotal, '#ef4444')}
  </tbody>
</table>
${staleHtml}`

  return {
    subject: `📦 NextMile Daily Dispatch — ${today}`,
    html:    emailShell('NextMile — Daily Dispatch Report', '#3b82f6', today, body),
  }
}

// ── Weekly email ──────────────────────────────────────────────────────────────

function buildWeeklyEmail(m: Metrics, insight: string, marketingTips: string): { subject: string; html: string } {
  const today = new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' })

  // Revenue table
  const revRows = m.revenueByEvent.slice(0, 8).map(e =>
    `<tr>
      <td style="padding:9px 12px;border-bottom:1px solid #f1f5f9;font-size:13px;font-weight:600;">${e.event}</td>
      <td style="padding:9px 12px;border-bottom:1px solid #f1f5f9;font-size:13px;">${e.count}</td>
      <td style="padding:9px 12px;border-bottom:1px solid #f1f5f9;font-size:13px;font-weight:700;color:#059669;">₹${Math.round(e.revenue/1000)}K</td>
      <td style="padding:9px 12px;border-bottom:1px solid #f1f5f9;font-size:13px;color:#64748b;">₹${e.avg}</td>
    </tr>`
  ).join('')

  // Courier table
  const courierRows = Object.entries(m.byCourier).sort((a, b) => b[1].total - a[1].total).map(([name, s]) => {
    const rate  = s.total > 0 ? ((s.delivered / s.total) * 100).toFixed(1) : '0.0'
    const rColor = parseFloat(rate) >= 92 ? '#16a34a' : parseFloat(rate) >= 85 ? '#d97706' : '#dc2626'
    const speed  = m.deliverySpeed[name] ?? '—'
    return `<tr>
      <td style="padding:9px 12px;border-bottom:1px solid #f1f5f9;font-size:13px;font-weight:600;">${name}</td>
      <td style="padding:9px 12px;border-bottom:1px solid #f1f5f9;font-size:13px;">${s.total}</td>
      <td style="padding:9px 12px;border-bottom:1px solid #f1f5f9;font-size:13px;font-weight:700;color:${rColor};">${rate}%</td>
      <td style="padding:9px 12px;border-bottom:1px solid #f1f5f9;font-size:13px;">${speed}d</td>
      <td style="padding:9px 12px;border-bottom:1px solid #f1f5f9;font-size:13px;">${s.rto}</td>
      <td style="padding:9px 12px;border-bottom:1px solid #f1f5f9;font-size:13px;${s.lost > 0 ? 'color:#ef4444;font-weight:700;' : 'color:#16a34a;'}">${s.lost}</td>
    </tr>`
  }).join('')

  // Best courier per state
  const stateRows = m.speedByState.slice(0, 14).map(x =>
    `<tr>
      <td style="padding:8px 12px;border-bottom:1px solid #f1f5f9;font-size:13px;">${x.state}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #f1f5f9;font-size:13px;font-weight:700;color:#4f46e5;">${x.bestCourier}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #f1f5f9;font-size:13px;color:#059669;">${x.avgDays}d avg</td>
    </tr>`
  ).join('')

  // Loyalty cards
  const loyaltyPct = m.loyalty.uniqueCustomers > 0
    ? ((( m.loyalty.double + m.loyalty.tripleplus) / m.loyalty.uniqueCustomers) * 100).toFixed(0)
    : '0'

  // Top cities
  const cityRows = m.topCities.map(([city, count], i) =>
    `<tr><td style="padding:7px 12px;border-bottom:1px solid #f1f5f9;font-size:13px;">${i + 1}. ${city}</td><td style="padding:7px 12px;border-bottom:1px solid #f1f5f9;font-size:13px;font-weight:700;">${count}</td></tr>`
  ).join('')

  // Orders by event
  const eventRows = m.byEvent.slice(0, 8).map(([event, count]) =>
    `<tr><td style="padding:7px 12px;border-bottom:1px solid #f1f5f9;font-size:13px;">${event}</td><td style="padding:7px 12px;border-bottom:1px solid #f1f5f9;font-size:13px;font-weight:700;">${count}</td></tr>`
  ).join('')

  // High-RTO cities
  const rtoRows = m.highRtoCities.map(c => {
    const combined = (c.rtoRate + c.lostRate).toFixed(1)
    const color = parseFloat(combined) >= 10 ? '#dc2626' : '#d97706'
    return `<tr>
      <td style="padding:8px 12px;border-bottom:1px solid #f1f5f9;font-size:13px;">${c.city}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #f1f5f9;font-size:13px;">${c.total}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #f1f5f9;font-size:13px;color:#d97706;font-weight:700;">${c.rtoRate}%</td>
      <td style="padding:8px 12px;border-bottom:1px solid #f1f5f9;font-size:13px;color:#dc2626;font-weight:700;">${c.lostRate}%</td>
      <td style="padding:8px 12px;border-bottom:1px solid #f1f5f9;font-size:13px;font-weight:700;color:${color};">${combined}%</td>
    </tr>`
  }).join('')

  // Event × City matrix
  const matrixRows = m.eventCityMatrix.map(e =>
    `<tr>
      <td style="padding:8px 12px;border-bottom:1px solid #f1f5f9;font-size:13px;font-weight:600;white-space:nowrap;">${e.event}</td>
      ${e.topCities.map(([city, n], i) =>
        `<td style="padding:8px 12px;border-bottom:1px solid #f1f5f9;font-size:13px;">${i===0?'🥇':''}${city} <span style="color:#94a3b8;">(${n})</span></td>`
      ).join('')}
      ${Array(3 - e.topCities.length).fill('<td style="padding:8px 12px;border-bottom:1px solid #f1f5f9;"></td>').join('')}
    </tr>`
  ).join('')

  // State breakdown
  const stateDistRows = m.topStates.map(([state, count]) =>
    `<tr><td style="padding:7px 12px;border-bottom:1px solid #f1f5f9;font-size:13px;">${state}</td><td style="padding:7px 12px;border-bottom:1px solid #f1f5f9;font-size:13px;font-weight:700;">${count}</td></tr>`
  ).join('')

  // This week vs last week table
  const weeklyEventRows = m.weeklyEvents.map(e => {
    const growthColor = e.growth > 0 ? '#16a34a' : e.growth < 0 ? '#dc2626' : '#64748b'
    const growthSign  = e.growth > 0 ? '+' : ''
    return `<tr>
      <td style="padding:9px 12px;border-bottom:1px solid #f1f5f9;font-size:13px;font-weight:600;">${e.event}</td>
      <td style="padding:9px 12px;border-bottom:1px solid #f1f5f9;font-size:13px;font-weight:700;">${e.thisWeek}</td>
      <td style="padding:9px 12px;border-bottom:1px solid #f1f5f9;font-size:13px;color:#64748b;">${e.lastWeek}</td>
      <td style="padding:9px 12px;border-bottom:1px solid #f1f5f9;font-size:13px;font-weight:700;color:${growthColor};">${growthSign}${e.growth}%</td>
      <td style="padding:9px 12px;border-bottom:1px solid #f1f5f9;font-size:13px;color:#059669;">₹${Math.round(e.revenue/1000)}K</td>
    </tr>`
  }).join('')

  // Event pipeline rows
  const pipelineRows = m.eventPipeline.map(e => {
    const pct    = e.total > 0 ? Math.round((e.shipped / e.total) * 100) : 0
    const pColor = e.pending > 100 ? '#dc2626' : e.pending > 30 ? '#d97706' : '#16a34a'
    return `<tr>
      <td style="padding:9px 12px;border-bottom:1px solid #f1f5f9;font-size:13px;font-weight:600;">${e.event}</td>
      <td style="padding:9px 12px;border-bottom:1px solid #f1f5f9;font-size:13px;">${e.total}</td>
      <td style="padding:9px 12px;border-bottom:1px solid #f1f5f9;font-size:13px;color:#059669;">${e.shipped} <span style="color:#94a3b8;font-weight:400;">(${pct}%)</span></td>
      <td style="padding:9px 12px;border-bottom:1px solid #f1f5f9;font-size:13px;font-weight:700;color:${pColor};">${e.pending} ⏳</td>
    </tr>`
  }).join('')

  // This week's target cities
  const weekCityRows = m.weeklyTopCities.map(([city, count], i) =>
    `<tr>
      <td style="padding:8px 12px;border-bottom:1px solid #f1f5f9;font-size:13px;color:#94a3b8;">${i + 1}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #f1f5f9;font-size:13px;font-weight:600;">${city}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #f1f5f9;font-size:13px;font-weight:700;color:#7c3aed;">${count} orders</td>
    </tr>`
  ).join('')

  const thisWeekTotal = m.weeklyEvents.reduce((s, e) => s + e.thisWeek, 0)
  const topEvRev      = m.weeklyEvents[0]

  const slaTotal = m.dispatchSLA.total

  const body = `
<!-- Summary Stats -->
<table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:8px;">
  <tr>
    ${statCell('Total Orders',   m.total,              '#8b5cf6')}
    ${statCell('Delivered',      m.delivered,          '#10b981')}
    ${statCell('Delivery Rate',  m.deliveryRate + '%', '#3b82f6')}
  </tr>
  <tr>
    ${statCell('In Transit',     m.inTransit,          '#f59e0b')}
    ${statCell('RTO',            m.rto,                '#ef4444')}
    ${statCell('Lost',           m.lost,               '#dc2626')}
  </tr>
</table>

<!-- This Week Snapshot -->
${sectionHead('📅', `This Week vs Last Week — ${thisWeekTotal} registrations | ₹${Math.round(m.weeklyRevenue/1000)}K revenue`)}
<div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:10px 16px;margin-bottom:10px;">
  <strong style="font-size:13px;color:#15803d;">🏆 This Week's #1 Event: ${m.topEventThisWeek}</strong>
  ${topEvRev ? ` — ${topEvRev.thisWeek} registrations | ₹${Math.round(topEvRev.revenue/1000)}K | vs ${topEvRev.lastWeek} last week` : ''}
</div>
<table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
  ${tableHead('Event', 'This Week', 'Last Week', 'Growth', 'Revenue This Week')}
  <tbody>${weeklyEventRows || '<tr><td colspan="5" style="padding:12px;color:#64748b;font-size:13px;">No orders in last 7 days</td></tr>'}</tbody>
</table>

<!-- Revenue by Event -->
${sectionHead('💰', `Revenue Intelligence — Total ₹${Math.round(m.totalRevenue/1000)}K`)}
<table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
  ${tableHead('Event', 'Orders', 'Total Revenue', 'Avg Ticket')}
  <tbody>${revRows}</tbody>
</table>

<!-- Gemini Insight -->
${insightBox(insight)}

<!-- Dispatch SLA -->
${sectionHead('📦', 'Dispatch SLA (Order Date → Shipped Date)')}
<table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin-bottom:4px;">
  <tbody>
    ${slaBar('Same Day',      m.dispatchSLA.within1, slaTotal, '#10b981')}
    ${slaBar('Within 2 Days', m.dispatchSLA.within2, slaTotal, '#3b82f6')}
    ${slaBar('Within 3 Days', m.dispatchSLA.within3, slaTotal, '#f59e0b')}
    ${slaBar('Beyond 3 Days', m.dispatchSLA.beyond3, slaTotal, '#ef4444')}
  </tbody>
</table>

<!-- Courier Performance -->
${sectionHead('🚚', 'Courier Performance')}
<table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
  ${tableHead('Courier', 'Total', 'Delivery %', 'Avg Speed', 'RTO', 'Lost')}
  <tbody>${courierRows}</tbody>
</table>

<!-- Best Courier Per State -->
${sectionHead('🗺️', 'Best Courier Per State (by delivery speed)')}
<table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
  ${tableHead('State', 'Best Courier', 'Avg Delivery Time')}
  <tbody>${stateRows}</tbody>
</table>

<!-- Customer Loyalty -->
${sectionHead('👥', 'Customer Loyalty')}
<table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:4px;">
  <tr>
    ${statCell('Unique Customers',  m.loyalty.uniqueCustomers, '#6366f1')}
    ${statCell('Repeat Customers',  m.loyalty.double + m.loyalty.tripleplus, '#0891b2')}
    ${statCell('Loyalty Rate',      loyaltyPct + '%', '#059669')}
  </tr>
</table>
<p style="font-size:12px;color:#64748b;margin:8px 0 0;padding:0;">
  ${m.loyalty.tripleplus} superfans registered 3+ events · ${m.loyalty.double} customers did exactly 2 events
</p>

<!-- Top Cities + Events side by side -->
<table width="100%" cellpadding="0" cellspacing="0" style="margin-top:28px;">
  <tr>
    <td width="50%" style="vertical-align:top;padding-right:16px;">
      ${sectionHead('🏙️', 'Top Cities')}
      <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
        <tbody>${cityRows}</tbody>
      </table>
    </td>
    <td width="50%" style="vertical-align:top;">
      ${sectionHead('🎽', 'Orders by Event')}
      <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
        <tbody>${eventRows}</tbody>
      </table>
    </td>
  </tr>
</table>

<!-- High-RTO Cities -->
${m.highRtoCities.length > 0 ? `
${sectionHead('⚠️', 'High-Risk Cities (>5% RTO or Lost rate)')}
<div style="background:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:10px 16px;margin-bottom:8px;font-size:12px;color:#991b1b;">
  Avoid assigning Xpressbees in cities with high lost rate. Consider Ekart/Bluedart for these zones.
</div>
<table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
  ${tableHead('City', 'Total Orders', 'RTO %', 'Lost %', 'Problem Rate')}
  <tbody>${rtoRows}</tbody>
</table>` : ''}

<!-- Event × City Matrix -->
${sectionHead('🎯', 'Event × City Demand Matrix')}
<table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
  ${tableHead('Event', '#1 City', '#2 City', '#3 City')}
  <tbody>${matrixRows}</tbody>
</table>

<!-- Event Pipeline — Remaining Registrations -->
${sectionHead('📦', 'Event Registration Pipeline — Remaining to Dispatch')}
<table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
  ${tableHead('Event', 'Total Registered', 'Dispatched', 'Pending ⏳')}
  <tbody>${pipelineRows}</tbody>
</table>

<!-- This Week's Target Cities for Marketing -->
${m.weeklyTopCities.length > 0 ? `
${sectionHead('🏙️', "This Week's Target Cities (Focus ad spend here)")}
<div style="background:#fef9c3;border:1px solid #fde68a;border-radius:8px;padding:10px 16px;margin-bottom:8px;font-size:12px;color:#92400e;">
  These cities are actively buying this week — run WhatsApp and Instagram campaigns here for maximum conversion.
</div>
<table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
  ${tableHead('#', 'City', 'Orders This Week')}
  <tbody>${weekCityRows}</tbody>
</table>` : ''}

<!-- Marketing Intelligence -->
${marketingBox(marketingTips)}

<!-- State Breakdown -->
${sectionHead('📊', 'State Breakdown')}
<table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
  <tbody>${stateDistRows}</tbody>
</table>`

  return {
    subject: `📊 NextMile Weekly Analytics — ${today}`,
    html:    emailShell('NextMile — Weekly Analytics Report', '#8b5cf6', today, body),
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
  const [insight, marketingTips] = await Promise.all([
    getGeminiInsight(metrics, 'weekly'),
    getMarketingTips(metrics),
  ])

  const { subject, html } = buildWeeklyEmail(metrics, insight, marketingTips)
  const to   = process.env.ALERT_EMAIL || 'support@gonextmile.in'
  const sent = await sendEmail(to, subject, html)
  console.log(`[analytics] Weekly → ${to}: ${sent ? 'sent' : 'failed'} | total=${metrics.total} revenue=₹${Math.round(metrics.totalRevenue/1000)}K rate=${metrics.deliveryRate}% thisWeek=${metrics.weeklyEvents.reduce((s,e)=>s+e.thisWeek,0)}`)
}
