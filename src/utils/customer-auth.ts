import crypto from 'crypto'
import type { Request, Response, NextFunction } from 'express'

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000 // 30-day customer session

function b64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function secret(): string {
  // Reuse SESSION_SECRET but namespace the payload so customer tokens can't be
  // used as admin tokens and vice-versa (different `aud`).
  const s = process.env.SESSION_SECRET
  if (!s) throw new Error('SESSION_SECRET not configured')
  return s + ':customer'
}

export function issueCustomerToken(email: string): string {
  const body = b64url(Buffer.from(JSON.stringify({ email, aud: 'customer', exp: Date.now() + SESSION_TTL_MS })))
  const sig  = b64url(crypto.createHmac('sha256', secret()).update(body).digest())
  return `${body}.${sig}`
}

function verify(token: string): { email: string } | null {
  const [body, sig] = token.split('.')
  if (!body || !sig) return null
  const expected = b64url(crypto.createHmac('sha256', secret()).update(body).digest())
  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null
  try {
    const p = JSON.parse(Buffer.from(body, 'base64').toString('utf8'))
    if (p?.aud !== 'customer' || typeof p?.exp !== 'number' || Date.now() > p.exp || !p?.email) return null
    return { email: p.email }
  } catch { return null }
}

export function hashOtp(code: string, email: string): string {
  // Bind the hash to the email so a code for one email can't verify another.
  return crypto.createHash('sha256').update(`${email.toLowerCase()}:${code}`).digest('hex')
}

export function generateOtp(): string {
  return String(crypto.randomInt(0, 1_000_000)).padStart(6, '0')
}

export function requireCustomerAuth(req: Request, res: Response, next: NextFunction): void {
  const header = req.headers.authorization || ''
  const bearer = header.startsWith('Bearer ') ? header.slice(7) : null
  if (!bearer) { res.status(401).json({ error: 'Not authenticated' }); return }
  const payload = verify(bearer)
  if (!payload) { res.status(401).json({ error: 'Invalid or expired session' }); return }
  ;(req as Request & { customer?: { email: string } }).customer = { email: payload.email }
  next()
}
