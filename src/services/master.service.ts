import { getAccessToken } from '../utils/google-auth'

const SPREADSHEET_ID = '1x2jqCRMBSguFjQXYdMc1SZMyGHVyZOVIt_zUZaht2TM'

// Column indices in the MASTER sheet (0-based, matches CSV header)
const COL_SOURCE          = 0
const COL_ORDER_ID        = 1
const COL_AWB             = 3
const COL_FULL_NAME       = 4
const COL_EMAIL           = 7
const COL_PHONE           = 8
const COL_PRODUCT         = 9
const COL_PAYMENT_STATUS  = 12
const COL_DELIVERY_STATUS = 13
const COL_VERIFY_STATUS   = 18
const COL_CERT_LINK       = 19
const COL_SUBMISSION_LINK = 22  // "Submission Link" column W

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

async function fetchMasterRows(): Promise<string[][]> {
  const token = await getAccessToken(
    'GOOGLE_SERVICE_ACCOUNT_JSON',
    'https://www.googleapis.com/auth/spreadsheets.readonly'
  )
  if (!token) return []

  const metaRes = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}?fields=sheets.properties`,
    { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(8000) }
  )
  const meta = await metaRes.json() as { sheets?: { properties: { title: string } }[] }
  const allTabs = (meta.sheets || []).map(s => s.properties.title)

  const sheetTitle =
    allTabs.find(t => t === 'MASTER') ||
    allTabs.find(t => /^master$/i.test(t)) ||
    allTabs.find(t => /master/i.test(t)) || ''

  if (!sheetTitle) return []

  const range    = `${sheetTitle}!A:W`
  const sheetRes = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values/${encodeURIComponent(range)}`,
    { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(8000) }
  )
  const data = await sheetRes.json() as { values?: string[][] }
  return data.values || []
}

function normalizePhone(p: string): string {
  return p.replace(/\D/g, '').replace(/^91/, '').slice(-10)
}

function rowToRecord(row: string[]): MasterRecord {
  return {
    source:             row[COL_SOURCE]          || '',
    orderId:            row[COL_ORDER_ID]         || '',
    awb:                row[COL_AWB]              || '',
    fullName:           row[COL_FULL_NAME]        || '',
    email:              row[COL_EMAIL]            || '',
    phone:              row[COL_PHONE]            || '',
    product:            row[COL_PRODUCT]          || '',
    paymentStatus:      row[COL_PAYMENT_STATUS]   || '',
    deliveryStatus:     row[COL_DELIVERY_STATUS]  || '',
    verificationStatus: row[COL_VERIFY_STATUS]    || '',
    certLink:           row[COL_CERT_LINK]        || '',
    submissionLink:     row[COL_SUBMISSION_LINK]  || '',
  }
}

export async function lookupByEmail(email: string): Promise<MasterRecord[]> {
  const rows = await fetchMasterRows()
  const headerIdx = rows.findIndex(r => /email/i.test(String(r[COL_EMAIL] || '')))
  const dataStart = headerIdx >= 0 ? headerIdx + 1 : 1
  const needle = email.trim().toLowerCase()
  return rows
    .slice(dataStart)
    .filter(r => String(r[COL_EMAIL] || '').trim().toLowerCase() === needle)
    .map(rowToRecord)
}

export async function lookupByPhone(phone: string): Promise<MasterRecord[]> {
  const rows = await fetchMasterRows()
  const headerIdx = rows.findIndex(r => /phone/i.test(String(r[COL_PHONE] || '')))
  const dataStart = headerIdx >= 0 ? headerIdx + 1 : 1
  const needle = normalizePhone(phone)
  return rows
    .slice(dataStart)
    .filter(r => normalizePhone(String(r[COL_PHONE] || '')) === needle)
    .map(rowToRecord)
}
