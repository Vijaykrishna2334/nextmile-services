import { Schema, model } from 'mongoose'

const LoginAttemptSchema = new Schema({
  email:     { type: String, required: true },
  ip:        { type: String, default: '' },
  success:   { type: Boolean, required: true },
  createdAt: { type: Date,    default: Date.now },
})

LoginAttemptSchema.index({ createdAt: -1 })

export const LoginAttempt = model('LoginAttempt', LoginAttemptSchema)
