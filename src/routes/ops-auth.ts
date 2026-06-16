import { Router, Request, Response } from 'express'
import { checkCredentials, issueSessionToken, requireOpsAuth } from '../utils/ops-auth'
import { LoginAttempt } from '../db/models/LoginAttempt'

export const opsAuthRouter = Router()

opsAuthRouter.post('/login', async (req: Request, res: Response) => {
  const { email, password } = (req.body || {}) as { email?: string; password?: string }
  const ip = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.ip || ''

  if (!email || !password) {
    res.status(400).json({ error: 'email and password required' })
    return
  }

  const ok = checkCredentials(email, password)
  LoginAttempt.create({ email: email.trim().toLowerCase(), ip, success: ok }).catch(() => {})

  if (!ok) {
    await new Promise(r => setTimeout(r, 1500))
    res.status(401).json({ error: 'Invalid email or password' })
    return
  }

  const token = issueSessionToken(email.trim().toLowerCase())
  res.json({ token, email: email.trim().toLowerCase() })
})

opsAuthRouter.get('/me', requireOpsAuth, (req: Request, res: Response) => {
  const user = (req as Request & { opsUser?: { email: string } }).opsUser
  res.json({ email: user?.email })
})

opsAuthRouter.post('/logout', requireOpsAuth, (_req: Request, res: Response) => {
  res.json({ ok: true })
})
