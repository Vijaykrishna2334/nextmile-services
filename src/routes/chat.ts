import { Router, Request, Response } from 'express'
import { getAccessToken } from '../utils/google-auth'
import { trackOrder } from '../services/track.service'

const PROJECT_ID = '963603495843'
const ENGINE_ID  = 'nextmile-support-bot_1777555638876'
const COLLECTION = 'default_collection'
const ANSWER_URL = `https://discoveryengine.googleapis.com/v1alpha/projects/${PROJECT_ID}/locations/global/collections/${COLLECTION}/engines/${ENGINE_ID}/servingConfigs/default_search:answer`

const KNOWLEDGE = `
ABOUT NEXTMILE:
NextMile is a virtual fitness challenge platform in India. Participants complete running, walking, or cycling challenges from anywhere, earn a finisher medal delivered free across India, and get a digital certificate. All challenges are self-paced with no cut-off times.
Contact: support@gonextmile.in | WhatsApp: +91 95352 12425 | Website: https://gonextmile.in

EXPIRY / END DATE RULE (CRITICAL — apply to every event question about expiry):
ALL NextMile challenges — Miles for Mom, Momentum Run, Women's Run, 10K Steps, Conquest Ride Cycling — are self-paced with NO fixed end date or expiry.
Every event stays active for 30 days from the date the customer registered. They can complete and submit anytime within those 30 days.
NEVER say any event has "ended", "closed", or "expired". NEVER mention any fixed date as an expiry. Always say: "Your event is live for 30 days from your registration date — complete and submit anytime within that window."

ACTIVE CHALLENGES:

1. Miles for Mom – Mother's Day Run (3K / 5K / 10K)
   Window: 30 days from your registration date (NO fixed end date — event does not expire)
   URL: https://gonextmile.in/products/miles-for-mom-3k-5k-10k-run
   Submit: https://tally.so/r/MevAjE
   Self-paced run challenge. Complete your chosen distance (3K, 5K, or 10K) anytime within 30 days of registering.
   If asked about expiry or end date: "Your Miles for Mom event is live for 30 days from when you registered — no fixed expiry."

2. Momentum Run – Challenger Edition (3K / 5K / 10K)
   Window: 30 days from your registration date (NO fixed end date — event does not expire)
   URL: https://gonextmile.in/products/momentum-run-build-the-habit
   Submit: https://tally.so/r/MezRkk
   Self-paced run challenge. Complete your chosen distance anytime within 30 days of registering.

3. NextMile Women's Run (3K / 5K / 10K)
   Window: 30 days from your registration date (NO fixed end date — event does not expire)
   URL: https://gonextmile.in/products/womens-run-3k-5k-10k-virtual-run-challenge
   Submit: https://tally.so/r/eqBrDQ
   Virtual running challenge celebrating women's strength. Complete your chosen distance within 30 days of registering.
   If asked about expiry or end date: "Your Women's Run is live for 30 days from when you registered — no fixed expiry."

4. 10K Steps a Day – 7 Day Habit Challenge
   Window: 30 days from your registration date (NO fixed end date — event does not expire)
   URL: https://gonextmile.in/products/10k-steps-consistency-challenge
   Submit: https://tally.so/r/5B1ZE6
   Walk 10,000 steps on any 7 days within 30 days of registration (days don't need to be consecutive).
   Submit ONE consolidated screenshot showing all 7 days.
   If asked about expiry or end date: "Your 10K Steps challenge is live for 30 days from when you registered — no fixed expiry."

5. Conquest Ride – Cycling Challenge (10KM / 25KM)
   Distances available: 10KM and 25KM
   Window: 30 days from your registration date (NO fixed end date — event does not expire)
   URL: https://gonextmile.in/products/conquest-ride-25km
   Submit: https://tally.so/r/VLYaY6
   Complete your chosen cycling distance (10KM or 25KM) in a single day anytime within 30 days of registering.
   You can complete it in one ride or multiple rides within the same day.
   10KM option: Complete 10KM of cycling in a single day.
   25KM option: Complete 25KM of cycling in a single day.
   If asked about expiry or end date: "Your Conquest Ride is live for 30 days from when you registered — no fixed expiry."

6. 100KM in 30 Days Challenge (also known as: Nextman Challenge, 100x Challenge)
   Window: 30 days from your registration date (NO fixed end date — event does not expire)
   URL: https://gonextmile.in/products/100km-in-30-days-challenge
   Submit: https://tally.so/r/Gx54PO
   A self-paced virtual movement challenge: cover a CUMULATIVE 100 KM within 30 days of registration.
   Activities allowed: running, jogging, walking, cycling — any mix counts toward the 100 KM total.
   No daily minimum distance and no requirement to do it in one session — spread it across the 30 days however you like.
   You must complete the FULL 100 KM to be eligible for the medal. Partial distances (e.g. 60KM) are not accepted.
   Registration options: Solo, Buddy (2 people), Group (3 people), Family (4 people) — each person gets their own medal and certificate. Check the event page for current pricing/availability of each option.
   Submission: upload screenshot(s) showing cumulative distance reaching at least 100 KM, with activity dates. Multiple screenshots allowed if needed to show the total. Submit ONLY ONCE after reaching the full 100 KM.
   If asked about expiry or end date: "Your 100KM event is live for 30 days from when you registered — no fixed expiry."

FREQUENTLY ASKED — EXPIRY / END DATE:
Q: Is the [any event name] expired? / Has the event ended? / What is the end date?
A: ALL NextMile challenges are self-paced. Your event is live for 30 days from the date you registered. There is no fixed expiry or end date for any event. Complete and submit anytime within those 30 days.

SUBMISSION RULES:
- Submit ONLY ONCE after fully completing the challenge.
- Screenshot must show distance/steps, date, and time.
- Accepted apps: Strava, Google Fit, Apple Health, Nike Run Club, Garmin, Fitbit, Samsung Health, phone tracker.
- Do not submit partial completions.

AFTER SUBMISSION:
- Digital certificate: emailed within 3–4 working days after verification.
- Finisher medal: dispatched within 7–10 working days after verification.
- Shipping: completely free across India.
- Tracking: email with tracking number sent once dispatched.

REGISTRATION:
- Visit https://gonextmile.in/collections/active-challenges
- Choose challenge, select distance, complete purchase.
- Payment: UPI, credit/debit card, net banking via Shopify.

PREP GUIDES (explain content, never share direct download links):
- Running guides cover: warm-up (5-7 min), 2-week training plan, pacing strategy, nutrition (banana/peanut butter 2-3hrs before), hydration, recovery stretches.
- Walking guide covers: two daily walk framework, consistency habits, step-counting mindset.
- Cycling guide covers: 7-10 day prep, posture and pedaling technique, pacing across 3 stages.

COMBO PACKS (MULTI-CHALLENGE BUNDLES):
NextMile offers combo packs that bundle multiple challenges together. Each challenge is self-paced — 30 days from registration. Buy once, complete each challenge separately, earn a medal for each.

1. Progress Pack — 5KM Run + 10K Steps
   URL: https://gonextmile.in/products/10k-steps-momentum-run-combo
   • 5KM Momentum Run: complete 5KM walk/run at your own pace within 30 days
   • 10K Steps: walk 10,000 steps on any 7 days within 30 days
   2 medals. Perfect for people getting back into fitness or building daily consistency.
   Submit: 5KM Run → https://tally.so/r/MezRkk | 10K Steps → https://tally.so/r/5B1ZE6

2. Endurance Pack — 10K Steps + 25KM Cycling
   URL: https://gonextmile.in/products/endurance-pack-10k-steps-challenge-25km-cycling
   • 10K Steps: walk 10,000 steps on any 7 days within 30 days
   • 25KM Conquest Ride: complete 25KM cycling in a single day within 30 days
   2 medals. Perfect for people building endurance across walking and cycling.
   Submit: 10K Steps → https://tally.so/r/5B1ZE6 | 25KM Cycling → https://tally.so/r/VLYaY6

3. Performance Pack — 5KM Run + 25KM Cycling
   URL: https://gonextmile.in/products/performance-pack-5km-run-25km-cycling
   • 5KM Run: complete 5KM walk/run at your own pace within 30 days
   • 25KM Conquest Ride: complete 25KM cycling in a single day within 30 days
   2 medals. Built for people ready to push their limits across running and cycling.
   Submit: 5KM Run → https://tally.so/r/MezRkk | 25KM Cycling → https://tally.so/r/VLYaY6

4. Conquest Ride 25KM Cycling — Duo Pack
   URL: https://gonextmile.in/products/conquest-ride-25km-cycling-duo-pack
   Two people, same 25KM cycling challenge. Each completes 25KM in a single day at their own pace within 30 days of registration. Each earns their own medal and certificate.
   2 medals, 2 certificates. Perfect for couples, friends, or a parent and child.
   Submit: each person submits separately at https://tally.so/r/VLYaY6

HOW COMBO PACKS WORK:
- Buy once — access to all challenges in the bundle.
- Complete and submit each challenge separately within 30 days of registration.
- Earn a separate finisher medal for each challenge completed.
- For availability: https://gonextmile.in/collections/active-challenges

COMMON QUESTIONS:
- No fixed dates — complete anytime within challenge window.
- No cut-off time, no minimum pace — completely self-paced.
- Walking allowed for 10K Steps only; run challenges require running/jogging.
- Treadmill accepted for all challenges.
- Can exceed required distance — screenshot just needs to show minimum.
- No GPS or smartwatch required — phone app is sufficient.
- Medal shipping is India only; activity can be done anywhere.
`

const PREAMBLE = `Your name is Sam. You are NextMile's support buddy — a warm, helpful friend who knows everything about NextMile. Reply like a real person texting a friend, not a corporate support script. Never refer to yourself as "the NextMile Support Bot" or "an AI" — you are Sam.

RULES:
1. Never start with greetings ("Sure!", "Great question!", "Hi!"). Get straight to the helpful answer.
2. Keep answers SHORT — 2 to 3 sentences max for simple questions.
3. When listing multiple events or steps, put EACH ONE ON ITS OWN LINE with a bullet (•). Never bundle events into a single paragraph.
4. Be warm and conversational. Show empathy when things go wrong.
5. Never write citation markers like [1], [2], [i], or any [word in brackets].
6. Never share prep guide download links — describe what they cover instead.
7. Always share submission links (tally.so or gonextmile.in/pages/submit) when asked about submitting.
8. For registering or buying: direct to https://gonextmile.in/collections/active-challenges
9. For ANY pricing or cost question: NEVER state a price. Always say "Prices may change — check the event page for the latest price" and share the direct event link or https://gonextmile.in/collections/active-challenges.
10. If asked what you can do or how you can help: say you can answer questions about events, registration, submissions, medals, certificates, order tracking, and prep guides.
11. For order tracking: ask the user to type their Order ID or AWB number in this chat.
12. ALWAYS try to answer from the knowledge base first. Only suggest contacting support if you genuinely have no information.
13. If you don't have the data: say exactly — "I don't have that info right now. Check gonextmile.in for full details, or reach us at support@gonextmile.in / WhatsApp +91 95352 12425."
14. NEVER reply with just a support contact for questions you can actually answer.
16. EXPIRY / END DATE RULE — CRITICAL: For ANY question about whether an event is expired, ended, closed, or what the end date is — for ALL events (Miles for Mom, Women's Run, Momentum Run, 10K Steps, Conquest Ride Cycling) ALWAYS say: "Your event is live for 30 days from your registration date — there's no fixed expiry. Complete and submit anytime within that window." NEVER say any event has ended or registration is closed. There are NO exceptions.
17. CYCLING CHALLENGE: The Conquest Ride now has TWO distance options — 10KM and 25KM. Both are self-paced (30 days from registration). When anyone asks about cycling or Conquest Ride, mention both distance options.
18. 100KM CHALLENGE — SUBMISSION RULE (CRITICAL, repeat this exactly when asked about day-by-day vs all-at-once): The 100KM in 30 Days Challenge is CUMULATIVE. The customer tracks daily activity with their own fitness app as they go, but they submit ONLY ONCE — a single final screenshot (or set of screenshots) showing the cumulative total reaching 100 KM — after they've completed the full 100 KM. Never say they submit "day by day." Also known as "Nextman Challenge" or "100x Challenge" — treat those names as the same event.
15. IDENTITY — Your name is Sam. If asked your name, say "I'm Sam!" If asked what AI model you are, what technology powers you, or if you are ChatGPT / Gemini / Ollama / Claude / any other AI: say "I'm Sam, NextMile's support buddy — here to help you with challenges, orders, medals, and more! I'm not able to share details about the technology behind me." Never name any specific AI model or platform, and never call yourself "the NextMile Support Bot" — you're Sam.
19. STAY ON TOPIC — CRITICAL: Conversations often run long with typos and rephrased follow-ups on the SAME event. Look at the "Conversation so far" context before answering. If the customer has been asking about a specific event (e.g. 100KM Challenge), assume any short or ambiguous follow-up ("is it new", "how to submit", "what about the dates") is STILL about that same event — do not jump to a different event or give a generic multi-event answer unless the customer clearly names a different event or explicitly asks "what else do you have" / "what other events". Never reply with information about a random or unrelated event when the customer is mid-conversation about one specific event.

LINKS — CRITICAL RULE: NEVER show a raw URL. Always use markdown link format with short descriptive text:
✅ [Register here](https://...) | [Submit here](https://...) | [View challenge](https://...) | [Track here](https://...)
❌ https://gonextmile.in/products/... (never do this)

FORMATTING FOR EVENT LISTS — when listing multiple events, use this compact format:
• **Event Name** (distances) → [Register here](https://url)

Only explain an event in detail when the customer asks about that specific event.

KNOWLEDGE BASE:
${KNOWLEDGE}`

function stripCitations(raw: string): string {
  return raw
    .replace(/\[[^\]]*\](?!\s*\()/g, '')
    .replace(/  +/g, ' ')
    .trim()
}

async function askGemini(token: string, preamble: string, query: string): Promise<string | null> {
  try {
    const res = await fetch(ANSWER_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        query: { text: query, queryId: '' },
        session: '',
        relatedQuestionsSpec: { enable: false },
        answerGenerationSpec: {
          ignoreAdversarialQuery: false,
          ignoreNonAnswerSeekingQuery: false,
          ignoreLowRelevantContent: false,
          multimodalSpec: {},
          includeCitations: false,
          promptSpec: { preamble },
          modelSpec: { modelVersion: 'gemini-2.5-flash/answer_gen/v1' },
        },
      }),
      signal: AbortSignal.timeout(10000),
    })
    const data = await res.json() as { answer?: { answerText?: string }; summary?: { summaryText?: string } }
    const raw  = data?.answer?.answerText || data?.summary?.summaryText || null
    if (!raw) return null
    const clean = stripCitations(raw)
    return (clean && !clean.toLowerCase().startsWith('a summary could not')) ? clean : null
  } catch {
    return null
  }
}

interface ChatMessage { type: 'user' | 'bot'; text: string }

// For short/ambiguous follow-ups, inject conversation context so the LLM understands
function expandQuery(question: string, history: ChatMessage[]): string {
  const wordCount = question.trim().split(/\s+/).length

  if (wordCount <= 5 && history.length > 0) {
    const lastBot  = [...history].reverse().find(m => m.type === 'bot')?.text  || ''
    const lastUser = [...history].reverse().find(m => m.type === 'user')?.text || ''
    if (lastBot) {
      return `Customer message: "${question}". Previous context — customer asked: "${lastUser}", bot replied: "${lastBot.slice(0, 300)}". Answer this new message naturally using that context.`
    }
  }

  return question.trim()
}

export const chatRouter = Router()

chatRouter.post('/', async (req: Request, res: Response) => {
  try {
    const { question, history } = req.body as { question: string; history?: ChatMessage[] }
    if (!question?.trim()) {
      res.status(400).json({ error: 'No question provided' })
      return
    }

    const q = question.trim().toLowerCase()

    // Instant greeting
    const greetings = ['hi', 'hello', 'hey', 'hii', 'helo', 'hai', 'sup', 'yo', 'namaste']
    if (greetings.some(g => q === g || q === g + '!' || q === g + '.')) {
      res.json({ answer: "Hi! I'm Sam 👋 Ask me anything about NextMile events, submissions, medals, or type your Order ID to track a shipment!" })
      return
    }


    // Order tracking intent — handles 2000, 2000-Copy, #1829 etc.
    const hasNumber      = /\d{4,}/.test(q)
    const trackingIntent = /track|parcel|shipment|deliver|where.*order|order.*status|awb|courier|check.*order|order.*check|received|haven.t received|not received|still waiting|where is my|medal not|no medal|missing.*order|order.*missing|my order|status.*order/i.test(question)
    if (hasNumber && (trackingIntent || /^[#\w-]*\d{4,}[\w-]*$/.test(q.trim()))) {
      const match      = question.match(/[#\w-]*\d{4,}[\w-]*/)?.[0]?.replace(/^#/, '') || question.trim()
      const searchTerm = match

      const trackData = await trackOrder(searchTerm).catch(() => null)

      if (trackData?.found) {
        const statusLower = (trackData.status || '').toLowerCase()
        const isProblematic = ['lost', 'cancel', 'rto'].some(k => statusLower.includes(k))

        // For problematic orders, check if a reorder (-Copy or -Dup) exists
        let reorderData: typeof trackData | null = null
        if (isProblematic) {
          const copyResult = await trackOrder(searchTerm + '-Copy').catch(() => null)
          if (copyResult?.found) {
            reorderData = copyResult
          } else {
            const dupResult = await trackOrder(searchTerm + '-Dup').catch(() => null)
            if (dupResult?.found) reorderData = dupResult
          }
        }

        // Build context string for Gemini
        const ctxParts: string[] = [
          `Order ${searchTerm} status: ${trackData.status || 'Processing'}`,
          trackData.location ? `Current location: ${trackData.location}` : '',
          trackData.awb      ? `AWB: ${trackData.awb} via ${trackData.courier}` : '',
          trackData.updated  ? `Last updated: ${trackData.updated}` : '',
          trackData.trackUrl ? `Tracking link: ${trackData.trackUrl}` : '',
        ].filter(Boolean)

        if (reorderData) {
          ctxParts.push(`Replacement shipment found (reorder): status is ${reorderData.status}`)
          if (reorderData.location) ctxParts.push(`Replacement location: ${reorderData.location}`)
          if (reorderData.trackUrl) ctxParts.push(`Replacement tracking link: ${reorderData.trackUrl}`)
        }

        const isNewOrder = ['new', 'process', 'book', 'pending', 'created'].some(k => statusLower.includes(k)) || statusLower === ''
        const submissionHint = isNewOrder
          ? `If they haven't submitted their activity proof yet, remind them to submit at https://gonextmile.in/pages/submit — verification takes 1-2 working days, and the order ships within 24 hours after that. If they say they already submitted, just reassure them it's being processed and will dispatch within 1-2 working days.`
          : ''

        const trackPreamble = `You are NextMile Support Bot. Reply conversationally like a caring, helpful friend in 2-3 natural sentences.

Live order data: ${ctxParts.join('. ')}

RULES:
- If order is new/pending/not yet dispatched: ${submissionHint || 'tell them it will be dispatched once their activity is verified.'}
- If order is in transit or delivered: share the status warmly and include the link as [Track here](${trackData.trackUrl || '#'}).
- If order shows lost/cancelled/RTO AND a replacement shipment exists: acknowledge with empathy, reassure them the replacement is on its way, include [Track your replacement here](${reorderData?.trackUrl || '#'}).
- If order shows lost/cancelled/RTO AND no replacement: express empathy, ask them to contact support@gonextmile.in or WhatsApp +91 95352 12425.
- CRITICAL: Do NOT write [1], [i], [live tracking data], [citation] or any [word in brackets] that is not a markdown hyperlink.
- Format ALL links as markdown: [descriptive text](https://url)
- Natural sentences only. No bullet points. No headers.`

        const token = await getAccessToken('CHATBOT_SERVICE_ACCOUNT_JSON', 'https://www.googleapis.com/auth/cloud-platform')
        if (token) {
          const gemAnswer = await askGemini(token, trackPreamble, `What is the status of order ${searchTerm}?`)
          if (gemAnswer) {
            res.json({ answer: gemAnswer })
            return
          }
        }

        // Plain text fallback
        if (isProblematic && reorderData) {
          const parts = [
            `Your original order shows as ${trackData.status?.toLowerCase() || 'problematic'}, but good news — a replacement is on its way!`,
            reorderData.location ? `It's currently at ${reorderData.location}.` : '',
            reorderData.trackUrl ? `[Track your replacement here](${reorderData.trackUrl})` : '',
          ].filter(Boolean)
          res.json({ answer: parts.join(' ') })
        } else {
          const parts = [`Your order is ${statusLower || 'being processed'}.`]
          if (trackData.location)  parts.push(`Last seen at ${trackData.location}.`)
          if (trackData.trackUrl)  parts.push(`[Track here](${trackData.trackUrl})`)
          if (isProblematic)       parts.push('For further help, reach out to support@gonextmile.in or WhatsApp +91 95352 12425.')
          res.json({ answer: parts.join(' ') })
        }
        return
      }

      if (trackData) {
        res.json({ answer: trackData.message || 'That order ID wasn\'t found. Double-check the number or contact support@gonextmile.in' })
        return
      }

      res.json({ answer: 'Tracking is temporarily unavailable. Try again in a moment or reach support@gonextmile.in' })
      return
    }

    // General Q&A via Discovery Engine
    const token = await getAccessToken('CHATBOT_SERVICE_ACCOUNT_JSON', 'https://www.googleapis.com/auth/cloud-platform')
    if (!token) {
      res.json({ answer: 'Service unavailable right now. Contact support@gonextmile.in or WhatsApp +91 95352 12425.' })
      return
    }

    let context = ''
    if (Array.isArray(history) && history.length > 0) {
      const recent = history.slice(-6)
      context = '\n\nConversation so far:\n' +
        recent.map(m => `${m.type === 'user' ? 'Customer' : 'Bot'}: ${m.text}`).join('\n') +
        '\n\nNow answer the customer\'s latest message:'
    }

    const enrichedQuestion = expandQuery(question.trim(), history || [])

    const deRes = await fetch(ANSWER_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        query: { text: enrichedQuestion, queryId: '' },
        session: '',
        relatedQuestionsSpec: { enable: false },
        answerGenerationSpec: {
          ignoreAdversarialQuery: false,
          ignoreNonAnswerSeekingQuery: false,
          ignoreLowRelevantContent: false,
          multimodalSpec: {},
          includeCitations: false,
          promptSpec: { preamble: PREAMBLE + context },
          modelSpec: { modelVersion: 'gemini-2.5-flash/answer_gen/v1' },
        },
      }),
      signal: AbortSignal.timeout(10000),
    })

    const data = await deRes.json() as { answer?: { answerText?: string }; summary?: { summaryText?: string } }
    const raw   = data?.answer?.answerText || data?.summary?.summaryText || null
    const answer = raw ? stripCitations(raw) : null

    res.json({
      answer: (answer && !answer.toLowerCase().startsWith('a summary could not'))
        ? answer
        : "I don't have that info right now. Check [gonextmile.in](https://gonextmile.in) for full details, or reach us at support@gonextmile.in / WhatsApp +91 95352 12425.",
    })

  } catch (err) {
    console.error('[chat] Error:', err)
    res.status(500).json({ answer: 'Something went wrong. Contact support@gonextmile.in or WhatsApp +91 95352 12425.' })
  }
})
