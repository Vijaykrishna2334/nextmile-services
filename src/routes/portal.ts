import { Router, Request, Response } from 'express'
import { CustomerOtp } from '../db/models/CustomerOtp'
import { lookupByEmail } from '../services/master.service'
import { sendEmail } from '../services/gmail.service'
import { trackOrder } from '../services/track.service'
import { issueCustomerToken, hashOtp, generateOtp, requireCustomerAuth } from '../utils/customer-auth'

export const portalRouter = Router()

const OTP_TTL_MS = 10 * 60 * 1000   // 10 minutes
const MAX_ATTEMPTS = 5

function otpEmailHtml(code: string): string {
  return `<!DOCTYPE html><html><body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;background:#0a0a0f;">
<div style="max-width:480px;margin:0 auto;padding:40px 24px;">
  <div style="background:#111118;border:1px solid rgba(255,255,255,0.08);border-radius:16px;padding:32px;text-align:center;">
    <div style="font-weight:800;font-size:18px;color:#f1f5f9;margin-bottom:8px;">NextMile</div>
    <p style="color:#94a3b8;font-size:14px;margin:0 0 24px;">Your login code</p>
    <div style="font-size:40px;font-weight:800;letter-spacing:10px;color:#818cf8;margin:16px 0;">${code}</div>
    <p style="color:#475569;font-size:13px;margin:24px 0 0;">This code expires in 10 minutes. If you didn't request it, ignore this email.</p>
  </div>
</div></body></html>`
}

// Step 1: request an OTP to your registered email
portalRouter.post('/request-otp', async (req: Request, res: Response) => {
  const email = String((req.body || {}).email || '').trim().toLowerCase()
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    res.status(400).json({ error: 'Valid email required' }); return
  }

  // Only send a code if this email actually has registrations (don't leak which emails exist —
  // always return ok, but only email a code to real customers).
  const orders = await lookupByEmail(email).catch(() => [])
  if (orders.length > 0) {
    const code = generateOtp()
    await CustomerOtp.create({
      email,
      codeHash: hashOtp(code, email),
      expiresAt: new Date(Date.now() + OTP_TTL_MS),
    })
    await sendEmail(email, `Your NextMile login code: ${code}`, otpEmailHtml(code)).catch(() => {})
  }

  res.json({ ok: true, message: 'If that email is registered, a code has been sent.' })
})

// Step 2: verify the OTP, get a customer session token
portalRouter.post('/verify-otp', async (req: Request, res: Response) => {
  const email = String((req.body || {}).email || '').trim().toLowerCase()
  const code  = String((req.body || {}).code  || '').trim()
  if (!email || !code) { res.status(400).json({ error: 'Email and code required' }); return }

  const otp = await CustomerOtp.findOne({ email, consumed: false }).sort({ createdAt: -1 })
  if (!otp) { res.status(401).json({ error: 'No active code. Request a new one.' }); return }
  if (otp.expiresAt.getTime() < Date.now()) { res.status(401).json({ error: 'Code expired. Request a new one.' }); return }
  if (otp.attempts >= MAX_ATTEMPTS) { res.status(429).json({ error: 'Too many attempts. Request a new code.' }); return }

  if (otp.codeHash !== hashOtp(code, email)) {
    otp.attempts += 1
    await otp.save()
    res.status(401).json({ error: 'Incorrect code' }); return
  }

  otp.consumed = true
  await otp.save()
  res.json({ token: issueCustomerToken(email), email })
})

// Customer's full picture — all registrations, submission/cert status, tracking
portalRouter.get('/me', requireCustomerAuth, async (req: Request, res: Response) => {
  const email = (req as Request & { customer?: { email: string } }).customer!.email
  const orders = await lookupByEmail(email).catch(() => [])

  // Enrich each order with live tracking if an AWB / order ID exists
  const enriched = await Promise.all(orders.map(async (o) => {
    let tracking: Awaited<ReturnType<typeof trackOrder>> | null = null
    const key = o.awb || o.orderId
    if (key) tracking = await trackOrder(key).catch(() => null)
    return {
      orderId:            o.orderId,
      event:              o.product,
      paymentStatus:      o.paymentStatus,
      verificationStatus: o.verificationStatus,
      certificateLink:    o.certLink,
      awb:                o.awb,
      deliveryStatus:     tracking?.found ? tracking.status : (o.deliveryStatus || ''),
      trackingLink:       tracking?.found ? tracking.trackUrl : '',
      submissionLink:     o.submissionLink,
    }
  }))

  const name = orders[0]?.fullName || ''
  res.json({
    name,
    email,
    totalEvents: enriched.length,
    completed: enriched.filter(e => /verified|complete|approved/i.test(e.verificationStatus)).length,
    medalsShipped: enriched.filter(e => /ship|dispatch|transit|deliver/i.test(e.deliveryStatus)).length,
    orders: enriched,
  })
})
