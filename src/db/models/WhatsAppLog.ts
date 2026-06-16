import { Schema, model } from 'mongoose'

const WhatsAppLogSchema = new Schema({
  fullPhone:            { type: String, required: true, index: true },
  customerName:         { type: String, default: '' },
  messageText:          { type: String, required: true },
  classification:       { type: String, enum: ['generic', 'order-specific', 'sensitive', 'order-lookup'], required: true },
  status:               { type: String, enum: ['auto-replied', 'flagged', 'reviewed', 'failed'], required: true },
  botReply:             { type: String, default: '' },
  suggestedReply:       { type: String, default: '' },
  orderRecordsSnapshot: { type: Schema.Types.Mixed, default: [] },
  interaktMessageId:    { type: String, default: '' },
  errorMessage:         { type: String, default: '' },
  createdAt:            { type: Date,   default: Date.now },
  reviewedAt:           { type: Date,   default: null },
  reviewedBy:           { type: String, default: '' },
})

WhatsAppLogSchema.index({ createdAt: -1 })
WhatsAppLogSchema.index({ status: 1, createdAt: -1 })

export const WhatsAppLog = model('WhatsAppLog', WhatsAppLogSchema)
