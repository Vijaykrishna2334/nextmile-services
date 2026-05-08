import { Router, Request, Response } from 'express'
import { trackOrder } from '../services/track.service'

export const trackRouter = Router()

trackRouter.post('/', async (req: Request, res: Response) => {
  try {
    const { orderId, awb } = req.body as { orderId?: string; awb?: string }
    const searchInput = orderId || awb
    if (!searchInput) {
      res.status(400).json({ found: false, message: 'Please provide an Order ID or AWB number.' })
      return
    }
    const result = await trackOrder(String(searchInput))
    res.json(result)
  } catch (err) {
    console.error('[track] Error:', err)
    res.status(500).json({ found: false, message: 'Tracking error. Try again or contact support@gonextmile.in' })
  }
})
