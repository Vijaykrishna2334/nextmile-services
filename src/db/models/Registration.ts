import mongoose, { Document, Schema } from 'mongoose'

export interface IRegistration extends Document {
  eventId: mongoose.Types.ObjectId
  eventSlug: string
  source: 'townscript' | 'shopify' | 'manual'
  firstName: string
  lastName?: string
  email: string
  phone?: string
  category?: string
  welcomeSentAt?: Date
  welcomeEmailStatus?: 'pending' | 'sent' | 'failed' | 'bounced'
  certLink?: string
  certSentAt?: Date
  certEmailStatus?: 'pending' | 'sent' | 'failed'
  registeredAt: Date
  createdAt: Date
  updatedAt: Date
}

const RegistrationSchema = new Schema<IRegistration>(
  {
    eventId:    { type: Schema.Types.ObjectId, ref: 'Event', required: true },
    eventSlug:  { type: String },
    source:     { type: String, enum: ['townscript', 'shopify', 'manual'], required: true },
    firstName:  { type: String, required: true },
    lastName:   { type: String },
    email:      { type: String, required: true, lowercase: true, trim: true },
    phone:      { type: String },
    category:   { type: String },
    welcomeSentAt:      { type: Date },
    welcomeEmailStatus: { type: String, enum: ['pending', 'sent', 'failed', 'bounced'] },
    certLink:        { type: String },
    certSentAt:      { type: Date },
    certEmailStatus: { type: String, enum: ['pending', 'sent', 'failed'] },
    registeredAt: { type: Date, required: true },
  },
  { timestamps: true }
)

RegistrationSchema.index({ email: 1, eventId: 1 })
RegistrationSchema.index({ welcomeEmailStatus: 1 })

export const Registration =
  mongoose.models.Registration ??
  mongoose.model<IRegistration>('Registration', RegistrationSchema)
