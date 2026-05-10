import { getAccessToken } from '../utils/google-auth'
import { MasterRecord } from './master.service'

const PROJECT_ID = '963603495843'
const ENGINE_ID  = 'nextmile-support-bot_1777555638876'
const ANSWER_URL = `https://discoveryengine.googleapis.com/v1alpha/projects/${PROJECT_ID}/locations/global/collections/default_collection/engines/${ENGINE_ID}/servingConfigs/default_search:answer`

export interface LLMDraftInput {
  senderName:      string
  customerMessage: string
  records:         MasterRecord[]
  relevantRecords: MasterRecord[]
}

function formatRecordsForPrompt(records: MasterRecord[]): string {
  if (!records.length) return '(none)'
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

export async function generateEmailDraft(input: LLMDraftInput): Promise<string> {
  const { senderName, customerMessage, records, relevantRecords } = input
  const firstName  = (senderName || 'there').split(' ')[0]
  const hasOrders  = records.length > 0
  const focusData  = relevantRecords.length > 0 ? relevantRecords : records

  const customerDataBlock = hasOrders
    ? `CUSTOMER ORDER DATA (from master sheet — use this as ground truth):
${formatRecordsForPrompt(focusData)}
${records.length > relevantRecords.length ? `\nOther orders this customer has (not the focus of this query):\n${formatRecordsForPrompt(records.filter(r => !focusData.includes(r)))}` : ''}`
    : `CUSTOMER ORDER DATA: No orders found for this contact.`

  const preamble = `You are the NextMile Email Support Agent. Write a professional, warm, human-sounding email reply to a customer.

STRICT RULES:
1. Address the customer by first name: ${firstName}
2. Use the customer order data below as ground truth — never invent or assume any data
3. Sound warm and human — like a real support person, not a data printout
4. Address ONLY what the customer asked — don't dump all fields if not relevant
5. ALWAYS include the full certificate link if certLink is available
6. ALWAYS include the full AWB tracking link if AWB is available
7. NEVER include submission links or proof upload links
8. If no orders found, ask for their registered email/phone or Order ID
9. Use 1-2 emojis max — keep it professional
10. End EXACTLY with:
Warm regards,
NextMile Support Team
support@gonextmile.in | WhatsApp: +91 95352 12425

${customerDataBlock}

Customer's name: ${firstName}
Customer's message: "${customerMessage || 'general inquiry'}"

Now write the email reply:`

  const token = await getAccessToken('CHATBOT_SERVICE_ACCOUNT_JSON', 'https://www.googleapis.com/auth/cloud-platform')
  if (!token) throw new Error('Could not get access token for Discovery Engine')

  const body = {
    query: { text: customerMessage || 'order status', queryId: '' },
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
  }

  const res  = await fetch(ANSWER_URL, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body:    JSON.stringify(body),
    signal:  AbortSignal.timeout(15000),
  })

  const data = await res.json() as { answer?: { answerText?: string }; summary?: { summaryText?: string } }
  const raw  = data?.answer?.answerText || data?.summary?.summaryText || ''
  const text = raw.replace(/\[\d+\]/g, '').trim()

  if (!text || text.toLowerCase().startsWith('a summary could not')) {
    // Fallback: simple template if Discovery Engine fails
    return buildFallbackDraft(firstName, records, relevantRecords, customerMessage)
  }

  return text
}

function buildFallbackDraft(
  firstName:       string,
  records:         MasterRecord[],
  relevantRecords: MasterRecord[],
  customerMessage: string,
): string {
  const focus = relevantRecords.length > 0 ? relevantRecords : records
  if (!focus.length) {
    return `Hi ${firstName},\n\nThank you for reaching out to NextMile! 🏃‍♂️\n\nWe couldn't find an order linked to your contact details. Could you please share your registered email/phone or Order ID? We'll get back to you right away.\n\nWarm regards,\nNextMile Support Team\nsupport@gonextmile.in | WhatsApp: +91 95352 12425`
  }
  const lines = [`Hi ${firstName},`, '', "Thank you for writing to us! Here's the latest on your order(s):"]
  focus.forEach(r => {
    lines.push('', `📋 ${r.product || `Order #${r.orderId}`}`)
    if (r.deliveryStatus) lines.push(`   Medal: ${r.deliveryStatus}`)
    if (r.awb)            lines.push(`   Track: https://ship.nimbuspost.com/shipping/tracking/${r.awb}`)
    if (r.certLink)       lines.push(`   Certificate: ${r.certLink}`)
  })
  lines.push('', 'Warm regards,', 'NextMile Support Team', 'support@gonextmile.in | WhatsApp: +91 95352 12425')
  return lines.join('\n')
}
