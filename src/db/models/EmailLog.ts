import mongoose, { Document, Schema } from 'mongoose'

export interface IEmailLog extends Document {
  registrationId?: mongoose.Types.ObjectId
  type: 'welcome' | 'certificate' | 'reminder' | 'custom'
  recipientEmail: string
  subject: string
  status: 'queued' | 'sent' | 'failed' | 'bounced'
  brevoMessageId?: string
  sentAt?: Date
  errorMessage?: string
  retryCount: number
}

const EmailLogSchema = new Schema<IEmailLog>(
  {
    registrationId: { type: Schema.Types.ObjectId, ref: 'Registration' },
    type:           { type: String, enum: ['welcome', 'certificate', 'reminder', 'custom'], required: true },
    recipientEmail: { type: String, required: true, lowercase: true, trim: true },
    subject:        { type: String, required: true },
    status:         { type: String, enum: ['queued', 'sent', 'failed', 'bounced'], default: 'queued' },
    brevoMessageId: { type: String },
    sentAt:         { type: Date },
    errorMessage:   { type: String },
    retryCount:     { type: Number, default: 0 },
  },
  { timestamps: true }
)

EmailLogSchema.index({ registrationId: 1 })
EmailLogSchema.index({ status: 1 })
EmailLogSchema.index({ type: 1 })
EmailLogSchema.index({ recipientEmail: 1 })

export const EmailLog =
  mongoose.models.EmailLog ??
  mongoose.model<IEmailLog>('EmailLog', EmailLogSchema)
