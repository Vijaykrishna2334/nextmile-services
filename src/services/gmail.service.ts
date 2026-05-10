const BASE = 'https://gmail.googleapis.com/gmail/v1/users/me'

export interface EmailMessage {
  id:        string
  threadId:  string
  from:      string
  fromName:  string
  subject:   string
  body:      string
  messageId: string
  date:      string
}

export async function getGmailToken(): Promise<string | null> {
  const clientId     = process.env.GMAIL_CLIENT_ID
  const clientSecret = process.env.GMAIL_CLIENT_SECRET
  const refreshToken = process.env.GMAIL_REFRESH_TOKEN
  if (!clientId || !clientSecret || !refreshToken) {
    console.error('[gmail] Missing GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET or GMAIL_REFRESH_TOKEN')
    return null
  }
  try {
    const res  = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id:     clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
        grant_type:    'refresh_token',
      }),
    })
    const data = await res.json() as { access_token?: string; error?: string }
    if (!data.access_token) { console.error('[gmail] Token error:', data.error); return null }
    return data.access_token
  } catch (e) {
    console.error('[gmail] Token fetch failed:', e)
    return null
  }
}

export async function getUnreadEmails(token: string, max = 15): Promise<{ id: string; threadId: string }[]> {
  const res  = await fetch(`${BASE}/messages?q=is:unread+in:inbox&maxResults=${max}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  const data = await res.json() as { messages?: { id: string; threadId: string }[] }
  return data.messages || []
}

export async function getEmailContent(token: string, messageId: string): Promise<EmailMessage | null> {
  const res = await fetch(`${BASE}/messages/${messageId}?format=full`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  const msg = await res.json() as GmailMessage
  if (!msg?.payload) return null

  const headers   = msg.payload.headers || []
  const get       = (name: string) => headers.find(h => h.name.toLowerCase() === name.toLowerCase())?.value || ''
  const fromRaw   = get('From')
  const fromMatch = fromRaw.match(/^(.*?)\s*<(.+?)>$/)

  return {
    id:        messageId,
    threadId:  msg.threadId,
    from:      fromMatch?.[2]?.trim() || fromRaw,
    fromName:  fromMatch?.[1]?.trim() || fromRaw.split('@')[0],
    subject:   get('Subject'),
    body:      cleanBody(extractBody(msg.payload)),
    messageId: get('Message-ID'),
    date:      get('Date'),
  }
}

export async function createDraft(token: string, opts: {
  to:        string
  subject:   string
  htmlBody:  string
  threadId:  string
  inReplyTo: string
}): Promise<string> {
  const subject = opts.subject.match(/^Re:/i) ? opts.subject : `Re: ${opts.subject}`
  const lines   = [
    `From: NextMile Support <${process.env.GMAIL_USER}>`,
    `To: ${opts.to}`,
    `Subject: ${subject}`,
    `In-Reply-To: ${opts.inReplyTo}`,
    `References: ${opts.inReplyTo}`,
    'MIME-Version: 1.0',
    'Content-Type: text/html; charset=UTF-8',
    '',
    opts.htmlBody,
  ]
  const raw = Buffer.from(lines.join('\r\n')).toString('base64url')

  const res  = await fetch(`${BASE}/drafts`, {
    method:  'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body:    JSON.stringify({ message: { threadId: opts.threadId, raw } }),
  })
  const data = await res.json() as { id?: string }
  if (!data.id) throw new Error(`Draft creation failed: ${JSON.stringify(data)}`)
  return data.id
}

export async function markEmailRead(token: string, messageId: string): Promise<void> {
  await fetch(`${BASE}/messages/${messageId}/modify`, {
    method:  'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body:    JSON.stringify({ removeLabelIds: ['UNREAD'] }),
  })
}

// ── Helpers ───────────────────────────────────────────────────────────────────

interface GmailPayload {
  mimeType?: string
  body?:     { data?: string }
  parts?:    GmailPayload[]
  headers?:  { name: string; value: string }[]
}
interface GmailMessage { threadId: string; payload?: GmailPayload }

function extractBody(payload: GmailPayload): string {
  if (payload.body?.data) {
    const text = Buffer.from(payload.body.data, 'base64url').toString('utf-8')
    return payload.mimeType === 'text/html' ? stripHtml(text) : text
  }
  if (payload.parts) {
    for (const mime of ['text/plain', 'text/html']) {
      const part = payload.parts.find(p => p.mimeType === mime)
      if (part?.body?.data) {
        const text = Buffer.from(part.body.data, 'base64url').toString('utf-8')
        return mime === 'text/html' ? stripHtml(text) : text
      }
    }
    for (const part of payload.parts) {
      const body = extractBody(part)
      if (body) return body
    }
  }
  return ''
}

function stripHtml(html: string): string {
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/\s{3,}/g, '\n\n')
    .trim()
}

function cleanBody(text: string): string {
  text = text.split(/^On .+wrote:\s*/m)[0]
  text = text.split('\n').filter(l => !l.trim().startsWith('>')).join('\n')
  text = text.split(/^--\s*$/m)[0]
  return text.replace(/\s{3,}/g, '\n\n').trim().slice(0, 3000)
}
