export type Classification = 'generic' | 'order-specific' | 'sensitive' | 'order-lookup'

const ORDER_ID_REGEX     = /[#\w-]*\d{4,}[\w-]*/
const TRACKING_INTENT    = /track|parcel|shipment|deliver|where.*order|order.*status|awb|courier|check.*order|order.*check|received|haven.t received|not received|still waiting|where is my|medal not|no medal|missing.*order|order.*missing|my order|status.*order/i
const SENSITIVE_INTENT   = /minor|child|children|kid|under\s*18|age\s*limit|injur|hurt|medic|hospital|sick|illness|lawyer|legal|sue|liabilit|refund|discount|promo|coupon|scam|fraud|fake/i

export interface ClassifyResult {
  classification: Classification
  orderIdMatch?: string
}

export function classifyMessage(messageText: string): ClassifyResult {
  const text = messageText.trim()

  if (SENSITIVE_INTENT.test(text)) {
    return { classification: 'sensitive' }
  }

  const numberMatch = ORDER_ID_REGEX.exec(text)
  const hasFourPlusDigit = !!numberMatch && /\d{4,}/.test(numberMatch[0])
  if (hasFourPlusDigit && (TRACKING_INTENT.test(text) || /^[#\w-]*\d{4,}[\w-]*$/.test(text))) {
    return { classification: 'order-lookup', orderIdMatch: numberMatch[0].replace(/^#/, '') }
  }

  if (TRACKING_INTENT.test(text)) {
    return { classification: 'order-specific' }
  }

  return { classification: 'generic' }
}
