import { Router, Request, Response } from 'express'
import { requireOpsAuth } from '../utils/ops-auth'
import { WhatsAppLog } from '../db/models/WhatsAppLog'

export const whatsappReviewRouter = Router()

whatsappReviewRouter.use(requireOpsAuth)

whatsappReviewRouter.get('/flagged', async (_req: Request, res: Response) => {
  const items = await WhatsAppLog.find({ status: 'flagged' }).sort({ createdAt: -1 }).limit(100).lean()
  res.json({ items })
})

whatsappReviewRouter.get('/recent', async (_req: Request, res: Response) => {
  const items = await WhatsAppLog.find({}).sort({ createdAt: -1 }).limit(100).lean()
  res.json({ items })
})

whatsappReviewRouter.post('/:id/reviewed', async (req: Request, res: Response) => {
  const user = (req as Request & { opsUser?: { email: string } }).opsUser
  const updated = await WhatsAppLog.findByIdAndUpdate(
    req.params.id,
    { $set: { status: 'reviewed', reviewedAt: new Date(), reviewedBy: user?.email || '' } },
    { new: true }
  ).lean()
  if (!updated) { res.status(404).json({ error: 'not found' }); return }
  res.json({ ok: true })
})

whatsappReviewRouter.get('/stats/today', async (_req: Request, res: Response) => {
  const start = new Date()
  start.setHours(0, 0, 0, 0)
  const [total, autoReplied, flagged, failed] = await Promise.all([
    WhatsAppLog.countDocuments({ createdAt: { $gte: start } }),
    WhatsAppLog.countDocuments({ createdAt: { $gte: start }, status: 'auto-replied' }),
    WhatsAppLog.countDocuments({ createdAt: { $gte: start }, status: 'flagged' }),
    WhatsAppLog.countDocuments({ createdAt: { $gte: start }, status: 'failed' }),
  ])
  res.json({ total, autoReplied, flagged, failed })
})
