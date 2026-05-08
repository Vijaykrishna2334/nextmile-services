import { getAccessToken } from '../utils/google-auth'

const SPREADSHEET_ID = '1x2jqCRMBSguFjQXYdMc1SZMyGHVyZOVIt_zUZaht2TM'
const SHEET_GID      = 228096252

const COL_ORDER_ID = 0
const COL_STATUS   = 2
const COL_AWB      = 13
const COL_COURIER  = 14
const COL_LOCATION = 19
const COL_UPDATED  = 20

export interface TrackResult {
  found: boolean
  orderId?: string
  awb?: string
  courier?: string
  status?: string
  location?: string
  updated?: string
  trackUrl?: string
  message?: string
}

export async function trackOrder(searchInput: string): Promise<TrackResult> {
  const token = await getAccessToken(
    'GOOGLE_SERVICE_ACCOUNT_JSON',
    'https://www.googleapis.com/auth/spreadsheets.readonly'
  )
  if (!token) {
    return { found: false, message: 'Tracking service not configured.' }
  }

  // Resolve tab name
  const metaRes = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}?fields=sheets.properties`,
    { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(8000) }
  )
  const meta = await metaRes.json() as { sheets?: { properties: { sheetId: number; title: string } }[]; error?: unknown }
  if (!metaRes.ok || meta.error) {
    return { found: false, message: 'Tracking service unavailable. Contact support@gonextmile.in' }
  }

  const allTabs = (meta.sheets || []).map(s => s.properties.title)
  const byGid   = (meta.sheets || []).find(s => s.properties.sheetId === SHEET_GID)?.properties?.title || ''
  const sheetTitle =
    allTabs.find(t => t === 'Nimbus Shipping') ||
    allTabs.find(t => /nimbus shipping/i.test(t)) ||
    byGid ||
    allTabs.find(t => /nimbus/i.test(t)) || ''

  if (!sheetTitle) {
    return { found: false, message: 'Could not find shipping data. Contact support@gonextmile.in' }
  }

  const range    = `${sheetTitle}!A:U`
  const sheetRes = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values/${encodeURIComponent(range)}`,
    { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(8000) }
  )
  const sheetData = await sheetRes.json() as { values?: string[][]; error?: unknown }
  const rows: string[][] = sheetData.values || []

  const headerIdx = rows.findIndex(r => String(r[0] || '').trim().toLowerCase() === 'order id')
  const dataStart = headerIdx >= 0 ? headerIdx + 1 : 1
  const dataRows  = rows.slice(dataStart)

  const searchTerm = searchInput.replace('#', '').trim().toLowerCase()
  const row = dataRows.find(r => {
    const rowOrderId = String(r[COL_ORDER_ID] || '').trim().toLowerCase()
    const rowAwb     = String(r[COL_AWB]      || '').trim().toLowerCase()
    return rowOrderId === searchTerm || rowAwb === searchTerm
  })

  if (!row) {
    return {
      found:   false,
      message: `Order #${searchTerm} not found. Check your Order ID or AWB, or contact support@gonextmile.in`,
    }
  }

  const status   = row[COL_STATUS]   || 'Processing'
  const awb      = row[COL_AWB]      || ''
  const courier  = row[COL_COURIER]  || ''
  const location = row[COL_LOCATION] || ''
  const updated  = row[COL_UPDATED]  || ''

  if (!awb) {
    return {
      found:   true,
      status,
      courier,
      message: `Order #${searchTerm} is being processed. AWB not yet assigned. Status: ${status}`,
    }
  }

  return {
    found:    true,
    orderId:  searchTerm,
    awb,
    courier,
    status,
    location,
    updated,
    trackUrl: `https://ship.nimbuspost.com/shipping/tracking/${awb}`,
  }
}
