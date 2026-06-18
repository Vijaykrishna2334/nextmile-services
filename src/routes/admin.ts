import { Router, Request, Response } from 'express'
import { requireOpsAuth } from '../utils/ops-auth'
import { lookupByEmail, lookupByPhone, type MasterRecord } from '../services/master.service'
import { trackOrder } from '../services/track.service'

export const adminRouter = Router()

adminRouter.use(requireOpsAuth)

async function enrich(orders: MasterRecord[]) {
  return Promise.all(orders.map(async (o) => {
    let tracking: Awaited<ReturnType<typeof trackOrder>> | null = null
    const key = o.awb || o.orderId
    if (key) tracking = await trackOrder(key).catch(() => null)
    return {
      orderId:            o.orderId,
      event:              o.product,
      source:             o.source,
      paymentStatus:      o.paymentStatus,
      submissionLink:     o.submissionLink,
      verificationStatus: o.verificationStatus || '(not verified)',
      certificateLink:    o.certLink || '',
      certIssued:         !!o.certLink,
      awb:                o.awb || '',
      nimbusPushed:       !!o.awb,
      deliveryStatus:     tracking?.found ? tracking.status : (o.deliveryStatus || ''),
      trackingLink:       tracking?.found ? tracking.trackUrl : '',
      courier:            tracking?.found ? tracking.courier : '',
    }
  }))
}

// Customer 360 — search by phone, email, or order id; see EVERYTHING in one place:
// orders, submission status, certificate status, Nimbus/AWB push status, live tracking.
adminRouter.get('/customer-360', async (req: Request, res: Response) => {
  const q = String(req.query.q || '').trim()
  if (!q) { res.status(400).json({ error: 'Provide ?q= phone, email, or order id' }); return }

  let orders: MasterRecord[] = []
  if (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(q)) {
    orders = await lookupByEmail(q).catch(() => [])
  } else if (/^\d{6,}$/.test(q.replace(/\D/g, '')) && q.replace(/\D/g, '').length >= 10) {
    orders = await lookupByPhone(q).catch(() => [])
  } else {
    // treat as order id — look it up via tracking, then try phone/email fallback
    const t = await trackOrder(q).catch(() => null)
    if (t?.found) {
      // tracking found; build a minimal record set around the order id
      orders = await lookupByPhone(q).catch(() => [])
    }
  }

  if (!orders.length) {
    res.json({ found: false, query: q, message: 'No customer found for that input.' })
    return
  }

  const enriched = await enrich(orders)
  res.json({
    found: true,
    query: q,
    name: orders[0].fullName,
    email: orders[0].email,
    phone: orders[0].phone,
    orderCount: enriched.length,
    orders: enriched,
  })
})
