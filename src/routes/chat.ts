import { Router, Request, Response } from 'express'
import { getAccessToken } from '../utils/google-auth'
import { trackOrder } from '../services/track.service'

const PROJECT_ID  = '963603495843'
const ENGINE_ID   = 'nextmile-support-bot_1777555638876'
const COLLECTION  = 'default_collection'
const ANSWER_URL  = `https://discoveryengine.googleapis.com/v1alpha/projects/${PROJECT_ID}/locations/global/collections/${COLLECTION}/engines/${ENGINE_ID}/servingConfigs/default_search:answer`

const PREAMBLE = `You are the NextMile Support Bot. Follow these rules STRICTLY:
1. NEVER start with greetings like "Hey there", "Hello there", or "Great question!". Jump straight to the answer.
2. Keep answers SHORT — 2 to 3 sentences maximum. Only use bullet points if there are 3+ steps.
3. Be friendly and warm but concise. No filler phrases.
4. Never show citation numbers like [1] or [2].
5. NEVER share prep guide download links. Instead briefly explain what the prep guide covers.
6. DO share submission links (tally.so, gonextmile.in/pages/submit) when asked where to submit.
7. For buying or registering: always say visit https://gonextmile.in
8. For order tracking: tell the user to type their Order ID or AWB number in this chat.
9. If unsure, say: Contact support@gonextmile.in or WhatsApp +91 95352 12425.`

interface ChatMessage { type: 'user' | 'bot'; text: string }

export const chatRouter = Router()

chatRouter.post('/', async (req: Request, res: Response) => {
  try {
    const { question, history } = req.body as { question: string; history?: ChatMessage[] }
    if (!question?.trim()) {
      res.status(400).json({ error: 'No question provided' })
      return
    }

    const q = question.trim().toLowerCase()

    // Instant greeting reply
    const greetings = ['hi', 'hello', 'hey', 'hii', 'helo', 'hai', 'sup', 'yo', 'namaste']
    if (greetings.some(g => q === g || q === g + '!' || q === g + '.')) {
      res.json({ answer: 'Hi! 👋 Ask me anything about NextMile events, submissions, medals, or prep guides!' })
      return
    }

    // Order tracking intent
    const hasNumber      = /\d{4,}/.test(q)
    const trackingIntent = /track|parcel|shipment|deliver|where.*order|order.*status|awb|courier/i.test(question)
    if (hasNumber && (trackingIntent || /^#?\d{4,}$/.test(q.trim()))) {
      const numMatch    = question.match(/\d{4,}/)
      const searchTerm  = numMatch?.[0] || question.trim()
      try {
        const trackData = await trackOrder(searchTerm)
        if (trackData.found) {
          const s     = (trackData.status || '').toLowerCase()
          const emoji = s.includes('deliver') ? '✅' : s.includes('transit') ? '🚚' : s.includes('return') ? '↩️' : '📦'
          const parts = [`${emoji} **${trackData.status || 'Processing'}**`]
          if (trackData.location) parts.push(`📍 ${trackData.location}`)
          if (trackData.awb)      parts.push(`AWB: ${trackData.awb} (${trackData.courier})`)
          if (trackData.updated)  parts.push(`🕐 Updated: ${trackData.updated}`)
          if (trackData.trackUrl) parts.push(`🔗 [Track on NimbusPost](${trackData.trackUrl})`)
          res.json({ answer: parts.join('\n') })
        } else {
          res.json({ answer: trackData.message || 'Order not found. Contact support@gonextmile.in' })
        }
      } catch {
        res.json({ answer: 'Could not reach tracking. Please try again or contact support@gonextmile.in' })
      }
      return
    }

    // Discovery Engine Q&A
    const token = await getAccessToken('CHATBOT_SERVICE_ACCOUNT_JSON', 'https://www.googleapis.com/auth/cloud-platform')
    if (!token) {
      res.json({ answer: 'Service unavailable. Contact support@gonextmile.in or WhatsApp +91 95352 12425.' })
      return
    }

    let conversationContext = ''
    if (Array.isArray(history) && history.length > 0) {
      const recent = history.slice(-6)
      conversationContext = '\n\nPrevious conversation:\n' +
        recent.map(m => `${m.type === 'user' ? 'Runner' : 'Bot'}: ${m.text}`).join('\n') +
        '\n\nNow answer the runner\'s latest question:'
    }

    const deRes = await fetch(ANSWER_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        query: { text: question.trim(), queryId: '' },
        session: '',
        relatedQuestionsSpec: { enable: false },
        answerGenerationSpec: {
          ignoreAdversarialQuery: false,
          ignoreNonAnswerSeekingQuery: true,
          ignoreLowRelevantContent: false,
          multimodalSpec: {},
          includeCitations: false,
          promptSpec: { preamble: PREAMBLE + conversationContext },
          modelSpec: { modelVersion: 'gemini-2.5-flash/answer_gen/v1' },
        },
        queryUnderstandingSpec: {
          queryClassificationSpec: {
            types: ['NON_ANSWER_SEEKING_QUERY', 'NON_ANSWER_SEEKING_QUERY_V2'],
          },
        },
      }),
    })

    const data = await deRes.json() as { answer?: { answerText?: string }; summary?: { summaryText?: string } }
    if (!deRes.ok) {
      res.json({ answer: 'Contact support@gonextmile.in or WhatsApp +91 95352 12425.' })
      return
    }

    const raw    = data?.answer?.answerText || data?.summary?.summaryText || null
    const clean  = raw ? raw.replace(/\[\d+\]/g, '').replace(/\s+/g, ' ').trim() : null
    const answer = clean?.toLowerCase().startsWith('a summary could not') ? null : clean

    res.json({ answer })
  } catch (err) {
    console.error('[chat] Error:', err)
    res.status(500).json({ answer: 'Something went wrong. Contact support@gonextmile.in or WhatsApp +91 95352 12425.' })
  }
})
