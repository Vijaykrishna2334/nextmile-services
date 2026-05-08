import { createSign } from 'crypto'

interface ServiceAccount {
  client_email: string
  private_key: string
}

function makeJWT(sa: ServiceAccount, scope: string): string {
  const header  = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url')
  const now     = Math.floor(Date.now() / 1000)
  const payload = Buffer.from(JSON.stringify({
    iss: sa.client_email, sub: sa.client_email,
    aud: 'https://oauth2.googleapis.com/token',
    iat: now, exp: now + 3600, scope,
  })).toString('base64url')
  const data   = `${header}.${payload}`
  const signer = createSign('RSA-SHA256')
  signer.update(data)
  return `${data}.${signer.sign(sa.private_key, 'base64url')}`
}

export async function getAccessToken(envVar: string, scope: string): Promise<string | null> {
  const raw = process.env[envVar]
  if (!raw) { console.error(`[auth] ${envVar} not set`); return null }
  try {
    const sa  = JSON.parse(raw) as ServiceAccount
    const jwt = makeJWT(sa, scope)
    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`,
    })
    const data = await res.json() as { access_token?: string }
    if (!data.access_token) console.error(`[auth] Token error from ${envVar}:`, JSON.stringify(data))
    return data.access_token || null
  } catch (e) {
    console.error(`[auth] Error getting token for ${envVar}:`, e)
    return null
  }
}
