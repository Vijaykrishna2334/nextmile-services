import { Schema, model } from 'mongoose'

const CustomerOtpSchema = new Schema({
  email:     { type: String, required: true, index: true },
  codeHash:  { type: String, required: true }, // sha256 of the 6-digit code
  expiresAt: { type: Date,   required: true },
  attempts:  { type: Number, default: 0 },      // wrong-code attempts (cap to prevent brute force)
  consumed:  { type: Boolean, default: false },
  createdAt: { type: Date,   default: Date.now },
})

// Auto-expire docs 30 min after creation (TTL index)
CustomerOtpSchema.index({ createdAt: 1 }, { expireAfterSeconds: 1800 })

export const CustomerOtp = model('CustomerOtp', CustomerOtpSchema)
