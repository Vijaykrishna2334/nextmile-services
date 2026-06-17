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
