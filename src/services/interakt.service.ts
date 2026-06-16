import crypto from 'crypto'

const BASE = 'https://api.interakt.ai/v1/public'

function authHeader(): string {
  const key = process.env.INTERAKT_API_KEY
  if (!key) throw new Error('INTERAKT_API_KEY not configured')
  return `Basic ${key}`
}

export interface InteraktWebhookMessage {
  type: string
  data?: {
    customer_phone_number?: string
    full_phone_number?: string
    customer_name?: string
    message?: { message?: string; text?: string }
  }
  customer?: { phone_number?: string; full_phone_number?: string; traits?: { name?: string } }
  message?: { text?: string; message?: string }
}

// Interakt's webhook payload shape varies slightly across event types — this normalizes it
export interface NormalizedInbound {
  fullPhone: string
  customerName: string
  messageText: string
  rawEventType: string
}

export function normalizeInbound(payload: InteraktWebhookMessage): NormalizedInbound | null {
  const fullPhone =
    payload.data?.full_phone_number ||
    payload.customer?.full_phone_number ||
    payload.data?.customer_phone_number ||
    payload.customer?.phone_number ||
    ''
  const customerName =
    payload.data?.customer_name ||
    payload.customer?.traits?.name ||
    ''
  const messageText =
    payload.data?.message?.message ||
    payload.data?.message?.text ||
    payload.message?.text ||
    payload.message?.message ||
    ''
  if (!fullPhone || !messageText) return null
  return {
    fullPhone: fullPhone.replace(/\D/g, ''),
    customerName: customerName.trim(),
    messageText: messageText.trim(),
    rawEventType: payload.type,
  }
}

export function verifyWebhookSignature(rawBody: string, signatureHeader: string | undefined): boolean {
  const secret = process.env.INTERAKT_WEBHOOK_SECRET
  if (!secret || !signatureHeader) return false
  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex')
  const a = Buffer.from(signatureHeader, 'utf8')
  const b = Buffer.from(expected, 'utf8')
  if (a.length !== b.length) return false
  return crypto.timingSafeEqual(a, b)
}

export interface SendTextResult { ok: boolean; messageId?: string; error?: string }

export async function sendTextMessage(fullPhone: string, message: string): Promise<SendTextResult> {
  try {
    const res = await fetch(`${BASE}/message/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: authHeader() },
      body: JSON.stringify({
        userId: '',
        fullPhoneNumber: fullPhone,
        callbackData: 'nextmile-bot',
        type: 'Text',
        data: { message },
      }),
      signal: AbortSignal.timeout(10000),
    })
    const data = await res.json() as { result?: boolean; message?: string; id?: string }
    if (!data?.result) return { ok: false, error: data?.message || 'Send failed' }
    return { ok: true, messageId: data.id }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

export async function assignChat(fullPhone: string, agentEmail: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch(`${BASE}/assignment/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: authHeader() },
      body: JSON.stringify({ user_phone_number: fullPhone, agent_email: agentEmail }),
      signal: AbortSignal.timeout(8000),
    })
    const data = await res.json() as { result?: boolean; message?: string }
    if (!data?.result) return { ok: false, error: data?.message || 'Assignment failed' }
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

// Per spec — flag-gated wrapper. Real template-sending logic comes in Slice 2/3.
export async function sendTemplate(_fullPhone: string, _templateName: string, _vars: string[], flagEnvVar: string): Promise<SendTextResult> {
  const flag = process.env[flagEnvVar]
  if (flag !== 'true') {
    return { ok: false, error: `skipped (flag ${flagEnvVar} off)` }
  }
  return { ok: false, error: 'sendTemplate not implemented in slice 1' }
}

export interface InteraktCustomer {
  id: string
  phone_number: string
  country_code: string
  channel_phone_number?: string
  created_at_utc: string
  modified_at_utc: string
  traits?: Record<string, unknown>
  tags?: string[]
  tag_names?: string[]
}

// Returns users whose modified_at_utc is greater than the given ISO timestamp.
// Used by the smart-polling job to detect any recent activity (incl. inbound messages).
export async function getUsersModifiedSince(sinceIsoUtc: string, limit = 50): Promise<InteraktCustomer[]> {
  try {
    const res = await fetch(`${BASE}/apis/users/?offset=0&limit=${limit}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: authHeader() },
      body: JSON.stringify({
        filters: [{ trait: 'modified_at_utc', op: 'gt', val: sinceIsoUtc }],
      }),
      signal: AbortSignal.timeout(10000),
    })
    const data = await res.json() as { result?: boolean; data?: { customers?: InteraktCustomer[] } }
    if (!data?.result) return []
    return data?.data?.customers || []
  } catch {
    return []
  }
}

export async function getUserByPhone(rawPhoneWithoutCountry: string): Promise<InteraktCustomer | null> {
  try {
    const res = await fetch(`${BASE}/apis/users/phone_number/${encodeURIComponent(rawPhoneWithoutCountry)}`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json', Authorization: authHeader() },
      signal: AbortSignal.timeout(8000),
    })
    const data = await res.json() as { result?: boolean; data?: { customers?: InteraktCustomer[] } }
    if (!data?.result) return null
    return data?.data?.customers?.[0] || null
  } catch {
    return null
  }
}
