import express from "express"
import Stripe from "stripe"

const router = express.Router()
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY)

/**
 * Stripe Webhook Handler (POST /api/webhook)
 * Listens for events sent directly from Stripe servers when a payment succeeds.
 */
router.post(
  "/",
  express.raw({ type: "application/json" }),
  async (req, res) => {
    const sig = req.headers["stripe-signature"]
    const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET

    let event

    // 1. Verify that this request really came from Stripe (Signature Check)
    try {
      if (endpointSecret && sig) {
        event = stripe.webhooks.constructEvent(req.body, sig, endpointSecret)
      } else {
        // Fallback for initial local testing if webhook secret is not yet set
        console.warn(
          "⚠️ STRIPE_WEBHOOK_SECRET is not configured. Parsing raw event without signature verification."
        )
        event = JSON.parse(req.body.toString())
      }
    } catch (err) {
      console.error("❌ Webhook Signature Verification Failed:", err.message)
      return res.status(400).send(`Webhook Error: ${err.message}`)
    }

    // 2. Handle the specific Stripe event
    console.log(`\n========================================`)
    console.log(`🔔 Stripe Webhook Received: [${event.type}]`)
    console.log(`========================================`)

    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object

        const customerEmail =
          session.customer_details?.email || session.customer_email || "N/A"
        const amountPaid = session.amount_total
          ? session.amount_total / 100
          : 0
        const currency = session.currency?.toUpperCase() || "USD"

        console.log("✅ Payment Succeeded!")
        console.log(`👤 Customer Email: ${customerEmail}`)
        console.log(`💵 Amount Paid: $${amountPaid} ${currency}`)
        console.log(`🆔 Stripe Session ID: ${session.id}`)
        console.log(`📦 Payment Status: ${session.payment_status}`)
        console.log(`========================================\n`)

        // Next Step: We will update MongoDB users and transactions here.
        break
      }

      default:
        console.log(`ℹ️ Received unhandled event: ${event.type}`)
    }

    // 3. Return 200 OK so Stripe knows the webhook succeeded
    return res.status(200).json({ received: true })
  }
)

export default router
