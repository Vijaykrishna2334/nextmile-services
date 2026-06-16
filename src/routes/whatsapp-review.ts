import { Router, Request, Response } from 'express'
import { requireOpsAuth } from '../utils/ops-auth'
import { WhatsAppLog } from '../db/models/WhatsAppLog'
import { WhatsAppActivity } from '../db/models/WhatsAppActivity'
import { classifyMessage } from '../services/whatsapp-classifier'
import { lookupByPhone } from '../services/master.service'
import { getAccessToken } from '../utils/google-auth'

export const whatsappReviewRouter = Router()

whatsappReviewRouter.use(requireOpsAuth)

const PROJECT_ID = '963603495843'
const ENGINE_ID  = 'nextmile-support-bot_1777555638876'
const COLLECTION = 'default_collection'
const ANSWER_URL = `https://discoveryengine.googleapis.com/v1alpha/projects/${PROJECT_ID}/locations/global/collections/${COLLECTION}/engines/${ENGINE_ID}/servingConfigs/default_search:answer`

const REPLY_PREAMBLE = `You are Sam, NextMile's WhatsApp support buddy. The operator will paste a customer's WhatsApp message and you will draft a reply they can copy-paste back. Reply in 1-3 short sentences. Be warm, conversational, no formal greetings. Never write [citation markers] or [bracket text]. Never share prep guide download links. Never state a price — say "check the event page for the latest price" instead. If the operator's note says the question is about minors/age/injury/refunds/discounts/legal: do not make up policy; suggest replying that you'll get back to them after checking with the team.`

async function generateReplyText(question: string): Promise<string | null> {
  try {
    const token = await getAccessToken('CHATBOT_SERVICE_ACCOUNT_JSON', 'https://www.googleapis.com/auth/cloud-platform')
    if (!token) return null
    const res = await fetch(ANSWER_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        query: { text: question, queryId: '' },
        session: '',
        relatedQuestionsSpec: { enable: false },
        answerGenerationSpec: {
          ignoreAdversarialQuery: false,
          ignoreNonAnswerSeekingQuery: false,
          ignoreLowRelevantContent: false,
          multimodalSpec: {},
          includeCitations: false,
          promptSpec: { preamble: REPLY_PREAMBLE },
          modelSpec: { modelVersion: 'gemini-2.5-flash/answer_gen/v1' },
        },
      }),
      signal: AbortSignal.timeout(10000),
    })
    const data = await res.json() as { answer?: { answerText?: string }; summary?: { summaryText?: string } }
    const raw  = data?.answer?.answerText || data?.summary?.summaryText || null
    if (!raw) return null
    const clean = raw.replace(/\[[^\]]*\](?!\s*\()/g, '').replace(/  +/g, ' ').trim()
    return (clean && !clean.toLowerCase().startsWith('a summary could not')) ? clean : null
  } catch {
    return null
  }
}

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
  const [total, autoReplied, flagged, failed, activityNew, activityReplied] = await Promise.all([
    WhatsAppLog.countDocuments({ createdAt: { $gte: start } }),
    WhatsAppLog.countDocuments({ createdAt: { $gte: start }, status: 'auto-replied' }),
    WhatsAppLog.countDocuments({ createdAt: { $gte: start }, status: 'flagged' }),
    WhatsAppLog.countDocuments({ createdAt: { $gte: start }, status: 'failed' }),
    WhatsAppActivity.countDocuments({ createdAt: { $gte: start }, status: 'new' }),
    WhatsAppActivity.countDocuments({ createdAt: { $gte: start }, status: 'replied' }),
  ])
  res.json({ total, autoReplied, flagged, failed, activityNew, activityReplied })
})

// Inbox Alerts (smart-polling activity stream)
whatsappReviewRouter.get('/inbox/new', async (_req: Request, res: Response) => {
  const items = await WhatsAppActivity.find({ status: 'new' }).sort({ createdAt: -1 }).limit(100).lean()
  res.json({ items })
})

whatsappReviewRouter.get('/inbox/all', async (_req: Request, res: Response) => {
  const items = await WhatsAppActivity.find({}).sort({ createdAt: -1 }).limit(100).lean()
  res.json({ items })
})

// Compose flow — paste a message, get an AI reply with order context, log it.
// Works without any activity record (you can also paste a phone+message manually).
whatsappReviewRouter.post('/inbox/generate-reply', async (req: Request, res: Response) => {
  const { phone, message, activityId } = (req.body || {}) as { phone?: string; message?: string; activityId?: string }
  if (!message?.trim()) { res.status(400).json({ error: 'message is required' }); return }

  const cleanPhone = (phone || '').replace(/\D/g, '')
  const cls = classifyMessage(message)
  const orders = cleanPhone ? await lookupByPhone(cleanPhone).catch(() => []) : []

  const orderContext = orders.length
    ? `\n\n[Internal context — do NOT mention this is from a system. Use it to write a more helpful reply.]\nCustomer's orders: ${orders.slice(0, 3).map(o => `${o.product} (#${o.orderId}) — ${o.deliveryStatus || 'no status'}${o.awb ? ` · AWB ${o.awb}` : ''}`).join(' · ')}`
    : ''

  const reply = await generateReplyText(`Customer asked: "${message.trim()}"${orderContext}`)

  if (activityId) {
    await WhatsAppActivity.findByIdAndUpdate(activityId, {
      $set: {
        pastedMessage: message.trim(),
        generatedReply: reply || '',
        generatedAt: new Date(),
        classification: cls.classification,
        status: 'reviewed',
      },
    }).catch(() => {})
  }

  res.json({
    classification: cls.classification,
    reply: reply || '',
    orders,
  })
})

whatsappReviewRouter.post('/inbox/:id/mark-replied', async (req: Request, res: Response) => {
  const user = (req as Request & { opsUser?: { email: string } }).opsUser
  const updated = await WhatsAppActivity.findByIdAndUpdate(
    req.params.id,
    { $set: { status: 'replied', reviewedAt: new Date(), reviewedBy: user?.email || '' } },
    { new: true }
  ).lean()
  if (!updated) { res.status(404).json({ error: 'not found' }); return }
  res.json({ ok: true })
})

whatsappReviewRouter.post('/inbox/:id/ignore', async (req: Request, res: Response) => {
  const updated = await WhatsAppActivity.findByIdAndUpdate(
    req.params.id,
    { $set: { status: 'ignored', reviewedAt: new Date() } },
    { new: true }
  ).lean()
  if (!updated) { res.status(404).json({ error: 'not found' }); return }
  res.json({ ok: true })
})
