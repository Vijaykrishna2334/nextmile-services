import Anthropic from '@anthropic-ai/sdk'
import { MasterRecord } from './master.service'

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

export interface LLMDraftInput {
  senderName: string
  customerMessage: string
  records: MasterRecord[]
  relevantRecords: MasterRecord[]
}

function formatRecordsForPrompt(records: MasterRecord[]): string {
  if (!records.length) return 'No orders found for this contact.'
  return records.map((r, i) => {
    const lines = [`Order ${i + 1}:`]
    if (r.orderId)            lines.push(`  Order ID: ${r.orderId}`)
    if (r.product)            lines.push(`  Event/Product: ${r.product}`)
    if (r.deliveryStatus)     lines.push(`  Medal Delivery Status: ${r.deliveryStatus}`)
    if (r.awb)                lines.push(`  AWB Number: ${r.awb}`)
    if (r.verificationStatus) lines.push(`  Verification Status: ${r.verificationStatus}`)
    if (r.certLink)           lines.push(`  Certificate Link: ${r.certLink}`)
    if (r.paymentStatus)      lines.push(`  Payment Status: ${r.paymentStatus}`)
    return lines.join('\n')
  }).join('\n\n')
}

export async function generateEmailDraft(input: LLMDraftInput): Promise<string> {
  const { senderName, customerMessage, records, relevantRecords } = input
  const firstName = (senderName || 'there').split(' ')[0]

  const noOrders = records.length === 0

  const systemPrompt = `You are a warm, helpful customer support agent for NextMile — a virtual fitness challenge brand in India that sends physical medals to participants who complete running/fitness challenges.

Your job is to write a professional yet friendly email reply to a customer inquiry. The reply must:
- Sound human, warm, and conversational — NOT like a data dump
- Address only what the customer asked about
- Be concise but complete — no unnecessary padding
- Use a friendly tone with light emoji where appropriate (1–2 max, not excessive)
- NEVER include submission links or proof upload links
- ALWAYS include certificate download links if available
- ALWAYS include AWB tracking links in format: https://ship.nimbuspost.com/shipping/tracking/{AWB}
- If the customer has multiple orders, present each one clearly with the event name as a natural subheading
- End with the standard sign-off

Sign-off format (always end with this exactly):
Warm regards,
NextMile Support Team
support@gonextmile.in | WhatsApp: +91 95352 12425`

  const userPrompt = noOrders
    ? `Customer name: ${firstName}
Customer's message: "${customerMessage || 'general inquiry'}"

No orders found for this contact. Write a friendly reply asking them to share their registered email/phone or Order ID so we can look them up.`
    : `Customer name: ${firstName}
Customer's message: "${customerMessage || 'general inquiry'}"

All orders for this customer:
${formatRecordsForPrompt(records)}
${relevantRecords.length < records.length ? `\nOrders relevant to their query (focus your reply on these):
${formatRecordsForPrompt(relevantRecords)}` : ''}

Write a helpful email reply addressing their query. Use the data above — don't invent or assume anything not listed.`

  const message = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 600,
    messages: [{ role: 'user', content: userPrompt }],
    system: systemPrompt,
  })

  const text = message.content.find(b => b.type === 'text')?.text || ''
  // Ensure reply always starts with "Hi <name>"
  if (!text.trim().startsWith('Hi')) {
    return `Hi ${firstName},\n\n${text.trim()}`
  }
  return text.trim()
}
