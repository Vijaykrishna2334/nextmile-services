import { getAccessToken } from '../utils/google-auth'

const SPREADSHEET_ID = '1zzYje4p5hoEzyw5CRIShYx-alSCaOcUBRI0zkNnTBeU'

export interface MasterRecord {
  source: string
  orderId: string
  awb: string
  fullName: string
  email: string
  phone: string
  product: string
  paymentStatus: string
  deliveryStatus: string
  verificationStatus: string
  certLink: string
  submissionLink: string
}

// Finds a column index by matching header name (case-insensitive, partial match)
function colIdx(headers: string[], ...candidates: string[]): number {
  for (const c of candidates) {
    const i = headers.findIndex(h => h.trim().toLowerCase().includes(c.toLowerCase()))
    if (i >= 0) return i
  }
  return -1
}

async function fetchMasterRows(): Promise<{ headers: string[]; rows: string[][] }> {
  const token = await getAccessToken(
    'GOOGLE_SERVICE_ACCOUNT_JSON',
    'https://www.googleapis.com/auth/spreadsheets.readonly'
  )
  if (!token) return { headers: [], rows: [] }

  const metaRes = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}?fields=sheets.properties`,
    { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(8000) }
  )
  const meta = await metaRes.json() as { sheets?: { properties: { title: string } }[] }
  const allTabs = (meta.sheets || []).map(s => s.properties.title)

  const sheetTitle =
    allTabs.find(t => t === 'All Orders') ||
    allTabs.find(t => /all orders/i.test(t)) ||
    allTabs.find(t => t === 'MASTER') ||
    allTabs.find(t => /master/i.test(t)) || ''

  if (!sheetTitle) return { headers: [], rows: [] }

  const sheetRes = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values/${encodeURIComponent(sheetTitle)}`,
    { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10000) }
  )
  const data = await sheetRes.json() as { values?: string[][] }
  const allRows: string[][] = data.values || []
  if (allRows.length === 0) return { headers: [], rows: [] }

  const headers = allRows[0].map(h => h.trim())
  return { headers, rows: allRows.slice(1) }
}

function normalizePhone(p: string): string {
  return p.replace(/\D/g, '').replace(/^91/, '').slice(-10)
}

function buildRecord(row: string[], h: string[]): MasterRecord {
  const g = (col: number) => (col >= 0 ? row[col] || '' : '')
  return {
    source:             g(colIdx(h, 'source')),
    orderId:            g(colIdx(h, 'order id', 'order_id', 'orderid')),
    awb:                g(colIdx(h, 'awb')),
    fullName:           g(colIdx(h, 'full name', 'fullname', 'name')),
    email:              g(colIdx(h, 'email')),
    phone:              g(colIdx(h, 'phone', 'mobile')),
    product:            g(colIdx(h, 'product', 'ticket', 'event')),
    paymentStatus:      g(colIdx(h, 'payment status', 'payment')),
    deliveryStatus:     g(colIdx(h, 'delivery', 'shipping status')),
    verificationStatus: g(colIdx(h, 'verification status', 'verification')),
    certLink:           g(colIdx(h, 'certificate link', 'cert')),
    submissionLink:     g(colIdx(h, 'submission link', 'submission')),
  }
}

function isValidOrder(r: MasterRecord): boolean {
  // Must have an order ID and a product/event name — skip pure submission rows
  return r.orderId.trim() !== '' && r.product.trim() !== ''
}

export async function lookupByEmail(email: string): Promise<MasterRecord[]> {
  const { headers, rows } = await fetchMasterRows()
  if (!headers.length) return []
  const emailCol = colIdx(headers, 'email')
  if (emailCol < 0) return []
  const needle = email.trim().toLowerCase()
  return rows
    .filter(r => (r[emailCol] || '').trim().toLowerCase() === needle)
    .map(r => buildRecord(r, headers))
    .filter(isValidOrder)
}

export async function lookupByPhone(phone: string): Promise<MasterRecord[]> {
  const { headers, rows } = await fetchMasterRows()
  if (!headers.length) return []
  const phoneCol = colIdx(headers, 'phone', 'mobile')
  if (phoneCol < 0) return []
  const needle = normalizePhone(phone)
  return rows
    .filter(r => normalizePhone(r[phoneCol] || '') === needle)
    .map(r => buildRecord(r, headers))
    .filter(isValidOrder)
}

export interface EventStat {
  product: string
  orders: number          // total order rows for this product
  uniqueCustomers: number // distinct phone numbers
}

export interface Registrant {
  name: string
  phone: string           // 10-digit, no country code
  email: string
  orderId: string
  product: string
  paymentStatus: string
}

export interface RegistrationAnalytics {
  totalRows: number
  totalValidOrders: number
  uniqueCustomers: number
  byEvent: EventStat[]
  // Registrants matching a 100KM-style event, deduped by phone — campaign-ready
  km100Registrants: Registrant[]
}

const KM100_PATTERN = /100\s*km|100km|nextman|100x|hundred\s*km/i

export async function getRegistrationAnalytics(): Promise<RegistrationAnalytics> {
  const { headers, rows } = await fetchMasterRows()
  if (!headers.length) {
    return { totalRows: 0, totalValidOrders: 0, uniqueCustomers: 0, byEvent: [], km100Registrants: [] }
  }

  const records = rows.map(r => buildRecord(r, headers)).filter(isValidOrder)

  // Group by product
  const eventMap = new Map<string, { orders: number; phones: Set<string> }>()
  const allPhones = new Set<string>()
  const km100ByPhone = new Map<string, Registrant>()

  for (const rec of records) {
    const product = rec.product.trim() || '(unknown)'
    const phoneKey = normalizePhone(rec.phone) || rec.email.trim().toLowerCase() || rec.orderId

    const entry = eventMap.get(product) || { orders: 0, phones: new Set<string>() }
    entry.orders += 1
    if (phoneKey) entry.phones.add(phoneKey)
    eventMap.set(product, entry)

    if (phoneKey) allPhones.add(phoneKey)

    if (KM100_PATTERN.test(product) && phoneKey && !km100ByPhone.has(phoneKey)) {
      km100ByPhone.set(phoneKey, {
        name: rec.fullName,
        phone: normalizePhone(rec.phone),
        email: rec.email,
        orderId: rec.orderId,
        product: rec.product,
        paymentStatus: rec.paymentStatus,
      })
    }
  }

  const byEvent: EventStat[] = Array.from(eventMap.entries())
    .map(([product, v]) => ({ product, orders: v.orders, uniqueCustomers: v.phones.size }))
    .sort((a, b) => b.orders - a.orders)

  return {
    totalRows: rows.length,
    totalValidOrders: records.length,
    uniqueCustomers: allPhones.size,
    byEvent,
    km100Registrants: Array.from(km100ByPhone.values()),
  }
}
