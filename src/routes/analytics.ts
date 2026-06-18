import { Router, Request, Response } from 'express'
import { requireOpsAuth } from '../utils/ops-auth'
import { getRegistrationAnalytics } from '../services/master.service'

export const analyticsRouter = Router()

analyticsRouter.use(requireOpsAuth)

// Full registration analytics: counts per event + 100KM registrant list
analyticsRouter.get('/registrations', async (_req: Request, res: Response) => {
  try {
    const data = await getRegistrationAnalytics()
    res.json(data)
  } catch (err) {
    console.error('[analytics] error:', err)
    res.status(500).json({ error: 'Failed to compute analytics' })
  }
})

// Just the 100KM count + summary (lightweight)
analyticsRouter.get('/100km/summary', async (_req: Request, res: Response) => {
  try {
    const data = await getRegistrationAnalytics()
    const km100 = data.km100Registrants
    const paid = km100.filter(r => /paid|success|complete|captured/i.test(r.paymentStatus)).length
    res.json({
      totalRegistrants: km100.length,
      paidRegistrants: paid,
      events: data.byEvent.filter(e => /100\s*km|100km|nextman|100x|hundred\s*km/i.test(e.product)),
    })
  } catch (err) {
    console.error('[analytics] error:', err)
    res.status(500).json({ error: 'Failed to compute 100km summary' })
  }
})

// 100KM registrant phone list — campaign-ready (deduped, 10-digit)
analyticsRouter.get('/100km/registrants', async (_req: Request, res: Response) => {
  try {
    const data = await getRegistrationAnalytics()
    res.json({
      count: data.km100Registrants.length,
      registrants: data.km100Registrants,
      phones: data.km100Registrants.map(r => r.phone).filter(Boolean),
    })
  } catch (err) {
    console.error('[analytics] error:', err)
    res.status(500).json({ error: 'Failed to fetch 100km registrants' })
  }
})

// A valid Indian mobile is 10 digits starting 6-9.
function isValidIndianMobile(phone: string): boolean {
  return /^[6-9]\d{9}$/.test(phone)
}

function csvEscape(v: string): string {
  const s = (v ?? '').toString()
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

// 100KM registrants as a downloadable CSV — VALID 10-digit numbers only.
// Open in a browser while logged in (token in query) to download.
// Columns: name, phone, country_phone, email, pack, paymentStatus
analyticsRouter.get('/100km/export.csv', async (_req: Request, res: Response) => {
  try {
    const data = await getRegistrationAnalytics()
    const valid = data.km100Registrants.filter(r => isValidIndianMobile(r.phone))
    const rows = [
      'name,phone,country_phone,email,pack,paymentStatus',
      ...valid.map(r => [
        csvEscape(r.name),
        csvEscape(r.phone),
        csvEscape('91' + r.phone),
        csvEscape(r.email),
        csvEscape(r.product),
        csvEscape(r.paymentStatus),
      ].join(',')),
    ]
    res.setHeader('Content-Type', 'text/csv; charset=utf-8')
    res.setHeader('Content-Disposition', 'attachment; filename="100km-registrants.csv"')
    res.send(rows.join('\n'))
  } catch (err) {
    console.error('[analytics] csv error:', err)
    res.status(500).json({ error: 'Failed to export CSV' })
  }
})

// Data-quality report — which registrants have invalid/short phone numbers
analyticsRouter.get('/100km/invalid-phones', async (_req: Request, res: Response) => {
  try {
    const data = await getRegistrationAnalytics()
    const invalid = data.km100Registrants.filter(r => !isValidIndianMobile(r.phone))
    res.json({
      validCount: data.km100Registrants.length - invalid.length,
      invalidCount: invalid.length,
      invalid: invalid.map(r => ({ name: r.name, phone: r.phone, orderId: r.orderId })),
    })
  } catch (err) {
    console.error('[analytics] error:', err)
    res.status(500).json({ error: 'Failed to check phones' })
  }
})
