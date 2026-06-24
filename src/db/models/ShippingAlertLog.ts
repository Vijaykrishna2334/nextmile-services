import mongoose, { Schema, Document } from 'mongoose'

export type AlertType = 'stuck_transit' | 'stuck_delivery' | 'exception' | 'not_picked'

export interface IShippingAlertLog extends Document {
  awb:       string
  orderId:   string
  alertType: AlertType
  status:    string
  location:  string
  alertedAt: Date
}

const ShippingAlertLogSchema = new Schema<IShippingAlertLog>({
  awb:       { type: String, required: true },
  orderId:   { type: String, default: '' },
  alertType: { type: String, required: true },
  status:    { type: String, default: '' },
  location:  { type: String, default: '' },
  alertedAt: { type: Date,   default: Date.now },
})

ShippingAlertLogSchema.index({ awb: 1, alertType: 1, alertedAt: -1 })

export const ShippingAlertLog = mongoose.model<IShippingAlertLog>('ShippingAlertLog', ShippingAlertLogSchema)
