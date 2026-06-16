import { Schema, model } from 'mongoose'

const WhatsAppActivitySchema = new Schema({
  fullPhone:            { type: String, required: true, index: true },
  customerName:         { type: String, default: '' },
  interaktUserId:       { type: String, default: '' },
  interaktModifiedAt:   { type: Date,   required: true },
  // Snapshot of order data at the time of the alert
  orderRecordsSnapshot: { type: Schema.Types.Mixed, default: [] },
  // Interakt-side metadata pulled from user record
  interaktTraits:       { type: Schema.Types.Mixed, default: {} },
  tagNames:             { type: [String], default: [] },
  // Operator workflow
  status:               { type: String, enum: ['new', 'reviewed', 'replied', 'ignored'], default: 'new', index: true },
  pastedMessage:        { type: String, default: '' },
  generatedReply:       { type: String, default: '' },
  generatedAt:          { type: Date,   default: null },
  classification:       { type: String, default: '' },
  // Owner-ping delivery tracking
  ownerPingSent:        { type: Boolean, default: false },
  ownerPingMessageId:   { type: String, default: '' },
  ownerPingError:       { type: String, default: '' },
  createdAt:            { type: Date,   default: Date.now },
  reviewedAt:           { type: Date,   default: null },
})

WhatsAppActivitySchema.index({ createdAt: -1 })
WhatsAppActivitySchema.index({ fullPhone: 1, interaktModifiedAt: -1 })

export const WhatsAppActivity = model('WhatsAppActivity', WhatsAppActivitySchema)
