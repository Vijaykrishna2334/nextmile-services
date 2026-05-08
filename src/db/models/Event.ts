import mongoose, { Document, Schema } from 'mongoose'

export interface IEvent extends Document {
  name: string
  slug: string
  status: 'active' | 'closed' | 'archived'
  tallyFormUrl?: string
  welcomeEmailTemplate: {
    subject: string
    htmlBody: string
    prepGuideUrl: string
    submissionFormUrl: string
  }
  categories: string[]
  createdAt: Date
  updatedAt: Date
}

const EventSchema = new Schema<IEvent>(
  {
    name:   { type: String, required: true },
    slug:   { type: String, required: true, unique: true, lowercase: true, trim: true },
    status: { type: String, enum: ['active', 'closed', 'archived'], default: 'active' },
    tallyFormUrl: { type: String },
    welcomeEmailTemplate: {
      subject:           { type: String, default: '' },
      htmlBody:          { type: String, default: '' },
      prepGuideUrl:      { type: String, default: '' },
      submissionFormUrl: { type: String, default: '' },
    },
    categories: [{ type: String }],
  },
  { timestamps: true }
)

export const Event =
  mongoose.models.Event ?? mongoose.model<IEvent>('Event', EventSchema)
