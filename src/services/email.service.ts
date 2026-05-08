import * as Brevo from '@getbrevo/brevo'
import { connectDB } from '../db/connect'
import { Registration, IRegistration } from '../db/models/Registration'
import { EmailLog } from '../db/models/EmailLog'
import { Event, IEvent } from '../db/models/Event'
import { renderWelcomeEmail } from '../templates/emails/welcome'
import { renderCertificateEmail } from '../templates/emails/certificate'

function getBrevoClient() {
  const api = new Brevo.TransactionalEmailsApi()
  api.setApiKey(Brevo.TransactionalEmailsApiApiKeys.apiKey, process.env.BREVO_API_KEY!)
  return api
}

export async function sendWelcomeEmail(reg: IRegistration, event: IEvent): Promise<void> {
  await connectDB()
  const api  = getBrevoClient()
  const html = renderWelcomeEmail({
    firstName:         reg.firstName,
    eventName:         event.name,
    category:          reg.category,
    prepGuideUrl:      event.welcomeEmailTemplate?.prepGuideUrl ?? '',
    submissionFormUrl: event.welcomeEmailTemplate?.submissionFormUrl ?? event.tallyFormUrl ?? '',
  })

  const subject = event.welcomeEmailTemplate?.subject || `Welcome to ${event.name} | You're In! 🎉`

  let brevoMessageId: string | undefined
  let errorMessage:   string | undefined
  let status: 'sent' | 'failed' = 'sent'

  try {
    const result = await api.sendTransacEmail({
      sender: { name: process.env.EMAIL_FROM_NAME || 'NextMile', email: process.env.EMAIL_FROM! },
      to: [{ email: reg.email, name: reg.firstName }],
      subject,
      htmlContent: html,
    })
    brevoMessageId = (result.body as { messageId?: string })?.messageId
  } catch (err: unknown) {
    status       = 'failed'
    errorMessage = err instanceof Error ? err.message : String(err)
    console.error(`[email] Failed welcome to ${reg.email}:`, errorMessage)
  }

  await Registration.findByIdAndUpdate(reg._id, {
    welcomeSentAt:      status === 'sent' ? new Date() : reg.welcomeSentAt,
    welcomeEmailStatus: status,
  })

  await EmailLog.create({
    registrationId: reg._id,
    type: 'welcome',
    recipientEmail: reg.email,
    subject,
    status,
    brevoMessageId,
    sentAt:       status === 'sent' ? new Date() : undefined,
    errorMessage,
  })

  if (status === 'failed') throw new Error(errorMessage)
}

export async function sendCertificateEmail(reg: IRegistration, certUrl: string, event: IEvent): Promise<void> {
  await connectDB()
  const api  = getBrevoClient()
  const html = renderCertificateEmail({
    firstName: reg.firstName,
    eventName: event.name,
    category:  reg.category,
    certLink:  certUrl,
  })

  const subject = `You Did It! 🏅 Your ${event.name} Certificate is Ready`

  let brevoMessageId: string | undefined
  let errorMessage:   string | undefined
  let status: 'sent' | 'failed' = 'sent'

  try {
    const result = await api.sendTransacEmail({
      sender: { name: process.env.EMAIL_FROM_NAME || 'NextMile', email: process.env.EMAIL_FROM! },
      to: [{ email: reg.email, name: reg.firstName }],
      subject,
      htmlContent: html,
    })
    brevoMessageId = (result.body as { messageId?: string })?.messageId
  } catch (err: unknown) {
    status       = 'failed'
    errorMessage = err instanceof Error ? err.message : String(err)
    console.error(`[email] Failed certificate to ${reg.email}:`, errorMessage)
  }

  await Registration.findByIdAndUpdate(reg._id, {
    certSentAt:      status === 'sent' ? new Date() : reg.certSentAt,
    certEmailStatus: status,
  })

  await EmailLog.create({
    registrationId: reg._id,
    type: 'certificate',
    recipientEmail: reg.email,
    subject,
    status,
    brevoMessageId,
    sentAt:       status === 'sent' ? new Date() : undefined,
    errorMessage,
  })

  if (status === 'failed') throw new Error(errorMessage)
}

export async function resendEmail(emailLogId: string): Promise<void> {
  await connectDB()
  const log = await EmailLog.findById(emailLogId)
  if (!log) throw new Error('Email log not found')

  const reg   = await Registration.findById(log.registrationId)
  if (!reg)   throw new Error('Registration not found')

  const event = await Event.findById(reg.eventId)
  if (!event) throw new Error('Event not found')

  if (log.type === 'welcome') {
    await sendWelcomeEmail(reg, event as IEvent)
  } else if (log.type === 'certificate') {
    if (!reg.certLink) throw new Error('Certificate link not found on registration')
    await sendCertificateEmail(reg, reg.certLink, event as IEvent)
  } else {
    throw new Error(`Resend not supported for type: ${log.type}`)
  }

  await EmailLog.findByIdAndUpdate(emailLogId, {
    status: 'sent',
    retryCount: (log.retryCount ?? 0) + 1,
    sentAt: new Date(),
    errorMessage: undefined,
  })
}
