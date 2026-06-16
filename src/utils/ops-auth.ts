import crypto from 'crypto'
import type { Request, Response, NextFunction } from 'express'

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000

function b64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function sign(payload: object, secret: string): string {
  const body = b64url(Buffer.from(JSON.stringify(payload)))
  const sig  = b64url(crypto.createHmac('sha256', secret).update(body).digest())
  return `${body}.${sig}`
}

function verify(token: string, secret: string): { email: string; exp: number } | null {
  const [body, sig] = token.split('.')
  if (!body || !sig) return null
  const expected = b64url(crypto.createHmac('sha256', secret).update(body).digest())
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64').toString('utf8'))
    if (!payload?.email || typeof payload?.exp !== 'number') return null
    if (Date.now() > payload.exp) return null
    return payload
  } catch {
    return null
  }
}

export function issueSessionToken(email: string): string {
  const secret = process.env.SESSION_SECRET
  if (!secret) throw new Error('SESSION_SECRET not configured')
  return sign({ email, exp: Date.now() + SESSION_TTL_MS }, secret)
}

export function checkCredentials(email: string, password: string): boolean {
  const adminEmail    = process.env.ADMIN_EMAIL
  const adminPassword = process.env.ADMIN_PASSWORD
  if (!adminEmail || !adminPassword) return false
  const emailMatch    = email.trim().toLowerCase() === adminEmail.trim().toLowerCase()
  const passwordMatch = password === adminPassword
  return emailMatch && passwordMatch
}

export function requireOpsAuth(req: Request, res: Response, next: NextFunction): void {
  const secret = process.env.SESSION_SECRET
  if (!secret) { res.status(500).json({ error: 'Server auth misconfigured' }); return }

  const header = req.headers.authorization || ''
  const bearer = header.startsWith('Bearer ') ? header.slice(7) : null
  const token  = bearer || (req.cookies?.['ops-session'] as string | undefined) || null

  if (!token) { res.status(401).json({ error: 'Not authenticated' }); return }
  const payload = verify(token, secret)
  if (!payload) { res.status(401).json({ error: 'Invalid or expired session' }); return }
  ;(req as Request & { opsUser?: { email: string } }).opsUser = { email: payload.email }
  next()
}
