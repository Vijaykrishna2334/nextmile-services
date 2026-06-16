import { Router, Request, Response } from 'express'
import { normalizeInbound, verifyWebhookSignature, sendTextMessage, type InteraktWebhookMessage, type NormalizedInbound } from '../services/interakt.service'
import { classifyMessage } from '../services/whatsapp-classifier'
import { lookupByPhone } from '../services/master.service'
import { WhatsAppLog } from '../db/models/WhatsAppLog'
import { trackOrder } from '../services/track.service'
import { getAccessToken } from '../utils/google-auth'

export const whatsappRouter = Router()

const PROJECT_ID = '963603495843'
const ENGINE_ID  = 'nextmile-support-bot_1777555638876'
const COLLECTION = 'default_collection'
const ANSWER_URL = `https://discoveryengine.googleapis.com/v1alpha/projects/${PROJECT_ID}/locations/global/collections/${COLLECTION}/engines/${ENGINE_ID}/servingConfigs/default_search:answer`

const WHATSAPP_PREAMBLE = `You are Sam, NextMile's WhatsApp support buddy. Reply in 1-3 short sentences (this is WhatsApp, not email). Be warm, conversational, no formal greetings. Never write [citation markers] or [bracket text]. Never share prep guide download links. Never state a price — say "check the event page for the latest price" instead. If asked about minors/age/injury/refunds/discounts, say you don't have that info and ask them to email support@gonextmile.in or WhatsApp +91 95352 12425 — but those should never reach this code path; the classifier filters them first.`

async function askLLM(question: string): Promise<string | null> {
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
          promptSpec: { preamble: WHATSAPP_PREAMBLE },
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

// Shared processor — used by webhook AND workflow-callback paths.
// Always returns; never throws.
async function processInbound(inbound: NormalizedInbound): Promise<void> {
  const cls = classifyMessage(inbound.messageText)

  // ORDER LOOKUP — free path, auto-reply using existing tracking
  if (cls.classification === 'order-lookup' && cls.orderIdMatch) {
    const data = await trackOrder(cls.orderIdMatch).catch(() => null)
    let reply = ''
    if (data?.found) {
      const parts = [`Your order is ${(data.status || 'being processed').toLowerCase()}.`]
      if (data.location) parts.push(`Last seen at ${data.location}.`)
      if (data.trackUrl) parts.push(`Track here: ${data.trackUrl}`)
      reply = parts.join(' ')
    } else {
      reply = data?.message || `Order #${cls.orderIdMatch} wasn't found. Double-check the number or email support@gonextmile.in.`
    }
    const send = await sendTextMessage(inbound.fullPhone, reply)
    await WhatsAppLog.create({
      fullPhone: inbound.fullPhone,
      customerName: inbound.customerName,
      messageText: inbound.messageText,
      classification: 'order-lookup',
      status: send.ok ? 'auto-replied' : 'failed',
      botReply: reply,
      interaktMessageId: send.messageId,
      errorMessage: send.error,
    })
    return
  }

  // SENSITIVE / ORDER-SPECIFIC — never auto-send; flag for review
  if (cls.classification === 'sensitive' || cls.classification === 'order-specific') {
    const orderRecords = await lookupByPhone(inbound.fullPhone).catch(() => [])
    const suggested    = await askLLM(inbound.messageText)
    await WhatsAppLog.create({
      fullPhone: inbound.fullPhone,
      customerName: inbound.customerName,
      messageText: inbound.messageText,
      classification: cls.classification,
      status: 'flagged',
      suggestedReply: suggested || '',
      orderRecordsSnapshot: orderRecords,
    })
    return
  }

  // GENERIC — auto-reply
  const reply = await askLLM(inbound.messageText)
  if (!reply) {
    await WhatsAppLog.create({
      fullPhone: inbound.fullPhone,
      customerName: inbound.customerName,
      messageText: inbound.messageText,
      classification: 'generic',
      status: 'flagged',
      errorMessage: 'LLM returned no answer',
    })
    return
  }
  const send = await sendTextMessage(inbound.fullPhone, reply)
  await WhatsAppLog.create({
    fullPhone: inbound.fullPhone,
    customerName: inbound.customerName,
    messageText: inbound.messageText,
    classification: 'generic',
    status: send.ok ? 'auto-replied' : 'failed',
    botReply: reply,
    interaktMessageId: send.messageId,
    errorMessage: send.error,
  })
}

// Native Interakt webhook (Advanced/Enterprise plans only)
whatsappRouter.post('/webhook', async (req: Request, res: Response) => {
  res.status(200).json({ received: true })
  try {
    const rawBody  = JSON.stringify(req.body || {})
    const sigHeader = req.headers['interakt-signature'] as string | undefined
    if (process.env.INTERAKT_WEBHOOK_SECRET) {
      if (!verifyWebhookSignature(rawBody, sigHeader)) {
        await WhatsAppLog.create({
          fullPhone: 'invalid-signature',
          messageText: rawBody.slice(0, 500),
          classification: 'generic',
          status: 'failed',
          errorMessage: 'signature mismatch',
        }).catch(() => {})
        return
      }
    }
    const payload = req.body as InteraktWebhookMessage
    if (payload?.type !== 'message_received') return
    const inbound = normalizeInbound(payload)
    if (!inbound) return
    await processInbound(inbound)
  } catch (err) {
    console.error('[whatsapp/webhook] processing error:', err)
  }
})

// Interakt Workflows callback (Growth-plan workaround for inbound messages)
// Requires ?secret= matching INTERAKT_WORKFLOW_SECRET env var (since Workflows
// can't sign requests like webhooks can — we use a shared secret in the URL).
// Accepts a flat JSON payload with fields the Workflow's API-call step sends:
//   { phone, name, message }
// Field names can be tweaked in the Workflow builder; this handler also accepts
// fullPhoneNumber/customer_phone_number/text/messageText as aliases.
whatsappRouter.post('/workflow-callback', async (req: Request, res: Response) => {
  res.status(200).json({ received: true })
  try {
    const expected = process.env.INTERAKT_WORKFLOW_SECRET
    if (!expected || req.query.secret !== expected) {
      console.warn('[whatsapp/workflow-callback] missing or invalid secret')
      return
    }
    const body = (req.body || {}) as Record<string, unknown>
    const phone = String(
      body.phone || body.fullPhoneNumber || body.full_phone_number || body.customer_phone_number || ''
    ).replace(/\D/g, '')
    const name = String(body.name || body.customer_name || body.full_name || '').trim()
    const text = String(body.message || body.messageText || body.text || body.message_text || '').trim()
    if (!phone || !text) {
      console.warn('[whatsapp/workflow-callback] missing phone or message text', { body })
      return
    }
    await processInbound({ fullPhone: phone, customerName: name, messageText: text, rawEventType: 'workflow' })
  } catch (err) {
    console.error('[whatsapp/workflow-callback] processing error:', err)
  }
})

// Test endpoint — POST a fake payload to exercise the full pipeline
whatsappRouter.post('/test-webhook', async (req: Request, res: Response) => {
  if (req.query.testKey !== process.env.TEST_HOOK_KEY) {
    res.status(401).json({ error: 'invalid testKey' }); return
  }
  const body = (req.body || {}) as Record<string, unknown>
  const phone = String(body.phone || body.fullPhoneNumber || '').replace(/\D/g, '')
  const name  = String(body.name  || '').trim()
  const text  = String(body.message || body.messageText || '').trim()
  if (!phone || !text) { res.status(400).json({ error: 'phone and message required' }); return }
  await processInbound({ fullPhone: phone, customerName: name, messageText: text, rawEventType: 'test' })
  res.json({ ok: true, processed: { phone, name, text } })
})
