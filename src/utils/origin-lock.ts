import type { Request, Response, NextFunction } from 'express'

const ALLOWED_ORIGINS = new Set([
  'https://gonextmile.in',
  'https://www.gonextmile.in',
  'http://localhost:3000',
  'http://localhost:3001',
])

export function chatOriginLock(req: Request, res: Response, next: NextFunction): void {
  // Preflights pass — CORS layer handles them
  if (req.method === 'OPTIONS') { next(); return }
  const origin   = (req.headers.origin || '') as string
  const referer  = (req.headers.referer || '') as string

  if (origin && ALLOWED_ORIGINS.has(origin)) { next(); return }

  // Some browsers strip Origin on same-origin / direct fetch — fall back to referer host check
  if (referer) {
    try {
      const u = new URL(referer)
      const ref = `${u.protocol}//${u.host}`
      if (ALLOWED_ORIGINS.has(ref)) { next(); return }
    } catch { /* ignore */ }
  }

  res.status(403).json({ error: 'Forbidden — chat API restricted to authorized origins' })
}
