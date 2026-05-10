import { getAccessToken } from '../utils/google-auth'
import { getGmailToken, getUnreadEmails, getEmailContent, createDraft, markEmailRead } from './gmail.service'
import { lookupByEmail } from './master.service'
import { connectDB } from '../db/connect'
import { EmailLog } from '../db/models/EmailLog'
import type { MasterRecord } from './master.service'

const PROJECT_ID = '963603495843'
const ENGINE_ID  = 'nextmile-support-bot_1777555638876'
const COLLECTION = 'default_collection'
const ANSWER_URL = `https://discoveryengine.googleapis.com/v1alpha/projects/${PROJECT_ID}/locations/global/collections/${COLLECTION}/engines/${ENGINE_ID}/servingConfigs/default_search:answer`

function formatOrders(records: MasterRecord[]): string {
  if (!records.length) return '(no orders found for this email)'
  return records.map((r, i) => {
    const parts = [`Order ${i + 1}:`]
    if (r.orderId)            parts.push(`  Order ID: ${r.orderId}`)
    if (r.product)            parts.push(`  Event: ${r.product}`)
    if (r.deliveryStatus)     parts.push(`  Medal Delivery Status: ${r.deliveryStatus}`)
    if (r.awb)                parts.push(`  AWB: ${r.awb}  →  Track: https://ship.nimbuspost.com/shipping/tracking/${r.awb}`)
    if (r.certLink)           parts.push(`  Certificate Link: ${r.certLink}`)
    if (r.verificationStatus) parts.push(`  Verification Status: ${r.verificationStatus}`)
    if (r.paymentStatus)      parts.push(`  Payment Status: ${r.paymentStatus}`)
    return parts.join('\n')
  }).join('\n\n')
}

function buildPreamble(firstName: string, records: MasterRecord[]): string {
  const hasOrders   = records.length > 0
  const orderBlock  = hasOrders
    ? `CUSTOMER ORDER DATA (live from master sheet — use as ground truth):\n${formatOrders(records)}`
    : `CUSTOMER ORDER DATA: No orders found for this email address.`

  return `You are drafting a support reply on behalf of NextMile Support Team.

RULES:
1. Write a professional but warm email reply — like a caring, knowledgeable team member.
2. Address the customer by first name: ${firstName}
3. Answer their question using BOTH the knowledge base (from search results) AND the customer order data below.
4. Keep it concise: 2-4 sentences for simple questions, max 3 short paragraphs for complex ones.
5. ALWAYS include the full certificate link if certLink is available in the order data.
6. ALWAYS include the full AWB tracking link if AWB is available in the order data.
7. NEVER include submission links or proof upload links in the reply.
8. For tracking queries: give the actual delivery status and AWB link from order data.
9. For certificate queries: give the cert link directly if available, else say it's being prepared.
10. If no orders found: ask for their registered email/phone or Order ID to look them up.
11. Write ONLY the email body — no subject line, no headers.
12. Start with: Hi ${firstName},
13. End with exactly:
Warm regards,
NextMile Support Team
support@gonextmile.in | WhatsApp: +91 95352 12425

${orderBlock}`
}

async function generateReply(emailBody: string, firstName: string, records: MasterRecord[], token: string): Promise<string | null> {
  const query    = `Customer email: ${emailBody.slice(0, 1500)}`
  const preamble = buildPreamble(firstName, records)
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
      signal: AbortSignal.timeout(15000),
    })
    const data = await res.json() as { answer?: { answerText?: string }; summary?: { summaryText?: string } }
    const raw  = data?.answer?.answerText || data?.summary?.summaryText || null
    if (!raw) return null
    return raw.replace(/\[[^\]]*\](?!\s*\()/g, '').replace(/  +/g, ' ').trim() || null
  } catch {
    return null
  }
}

function buildHtml(replyText: string): string {
  const paragraphs = replyText
    .split('\n\n')
    .filter(Boolean)
    .map(p => `<p style="margin:0 0 14px;font-size:15px;line-height:1.6;color:#1e293b;">${p.replace(/\n/g, '<br>').replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" style="color:#FF6B35;">$1</a>')}</p>`)
    .join('')

  return `<!DOCTYPE html><html><body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;background:#ffffff;">
<div style="max-width:600px;margin:0 auto;padding:32px 24px;">
  <div style="display:flex;align-items:center;margin-bottom:28px;padding-bottom:20px;border-bottom:2px solid #FF6B35;">
    <span style="display:inline-block;width:28px;height:28px;background:#FF6B35;border-radius:6px;text-align:center;line-height:28px;font-weight:800;color:#fff;font-size:14px;margin-right:10px;">N</span>
    <span style="font-weight:700;font-size:16px;color:#0f172a;">NextMile Support</span>
  </div>
  <div style="margin-bottom:28px;">${paragraphs}</div>
  <div style="border-top:1px solid #e2e8f0;padding-top:18px;font-size:12px;color:#94a3b8;">
    This is an AI-generated draft. Please review before sending.
  </div>
</div>
</body></html>`
}

export async function previewDraft(body: string, fromName: string, fromEmail = ''): Promise<{ reply: string | null; html: string | null }> {
  const llmToken = await getAccessToken('CHATBOT_SERVICE_ACCOUNT_JSON', 'https://www.googleapis.com/auth/cloud-platform')
  if (!llmToken) return { reply: null, html: null }
  const records  = fromEmail ? await lookupByEmail(fromEmail) : []
  const firstName = (fromName || records[0]?.fullName || 'there').split(' ')[0]
  const reply    = await generateReply(body, firstName, records, llmToken)
  if (!reply) return { reply: null, html: null }
  return { reply, html: buildHtml(reply) }
}

export interface DraftResult {
  processed: number
  drafted:   number
  failed:    number
  skipped:   number
  errors:    string[]
}

export async function processInboxEmails(): Promise<DraftResult> {
  await connectDB()

  const gmailToken = await getGmailToken()
  if (!gmailToken) return { processed: 0, drafted: 0, failed: 0, skipped: 0, errors: ['Gmail token failed — check GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, GMAIL_REFRESH_TOKEN'] }

  const llmToken = await getAccessToken('CHATBOT_SERVICE_ACCOUNT_JSON', 'https://www.googleapis.com/auth/cloud-platform')
  if (!llmToken) return { processed: 0, drafted: 0, failed: 0, skipped: 0, errors: ['LLM token failed'] }

  const messages = await getUnreadEmails(gmailToken, 20)
  if (!messages.length) {
    console.log('[drafts] No unread emails')
    return { processed: 0, drafted: 0, failed: 0, skipped: 0, errors: [] }
  }

  let drafted = 0, failed = 0, skipped = 0
  const errors: string[] = []

  for (const { id } of messages) {
    const existing = await EmailLog.findOne({ gmailMessageId: id })
    if (existing) { skipped++; continue }

    const email = await getEmailContent(gmailToken, id).catch(() => null)
    if (!email || !email.body.trim()) { skipped++; continue }

    if (email.from.includes(process.env.GMAIL_USER || 'support@gonextmile.in')) { skipped++; continue }

    try {
      // Look up sender's orders from master sheet
      const records   = await lookupByEmail(email.from).catch(() => [])
      const firstName = (records[0]?.fullName || email.fromName || 'there').split(' ')[0]

      const replyText = await generateReply(email.body, firstName, records, llmToken)
      if (!replyText) throw new Error('LLM returned no reply')

      const htmlBody = buildHtml(replyText)
      const draftId  = await createDraft(gmailToken, {
        to:        email.from,
        subject:   email.subject,
        htmlBody,
        threadId:  email.threadId,
        inReplyTo: email.messageId,
      })

      await markEmailRead(gmailToken, id)

      await EmailLog.create({
        gmailMessageId: id,
        threadId:       email.threadId,
        from:           email.from,
        subject:        email.subject,
        status:         'drafted',
        draftId,
        processedAt:    new Date(),
      })

      console.log(`[drafts] Drafted reply for: ${email.from} — "${email.subject}" (${records.length} orders found)`)
      drafted++
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      errors.push(`${email.from}: ${msg}`)
      await EmailLog.create({
        gmailMessageId: id,
        threadId:       email.threadId,
        from:           email.from,
        subject:        email.subject,
        status:         'failed',
        errorMessage:   msg,
        processedAt:    new Date(),
      })
      failed++
    }

    await new Promise(r => setTimeout(r, 300))
  }

  console.log(`[drafts] Done — Drafted: ${drafted}, Failed: ${failed}, Skipped: ${skipped}`)
  return { processed: messages.length, drafted, failed, skipped, errors }
}
