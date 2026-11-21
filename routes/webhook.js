import express from "express"
import { ObjectId } from "mongodb"
import Stripe from "stripe"

import { getDB } from "../config/db.js"

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

        // Extract vendor info from metadata or session customer details
        const vendorEmail =
          session.metadata?.vendorEmail ||
          session.customer_details?.email ||
          session.customer_email
        const vendorId = session.metadata?.vendorId
        const amountPaid = session.amount_total
          ? session.amount_total / 100
          : 19.99
        const currency = session.currency?.toUpperCase() || "USD"

        console.log("✅ Checkout Session Succeeded!")
        console.log(`👤 Vendor Email: ${vendorEmail}`)
        console.log(`💵 Amount Paid: $${amountPaid} ${currency}`)
        console.log(`🆔 Stripe Session ID: ${session.id}`)
        console.log(`📦 Payment Status: ${session.payment_status}`)

        if (!vendorEmail) {
          console.error("❌ No vendor email found in session. Cannot update database.")
          break
        }

        try {
          const db = getDB()

          // 2.1 Find user collection (Better Auth uses "user" or "users")
          const hasUserCol = await db.listCollections({ name: "user" }).hasNext()
          const userCollection = hasUserCol
            ? db.collection("user")
            : db.collection("users")

          // 2.2 Upgrade vendor to "premium"
          const query =
            vendorId && ObjectId.isValid(vendorId)
              ? { $or: [{ _id: new ObjectId(vendorId) }, { email: vendorEmail }] }
              : { email: vendorEmail }

          const updateResult = await userCollection.updateOne(query, {
            $set: {
              subscriptionPlan: "premium",
              updatedAt: new Date(),
            },
          })

          if (updateResult.matchedCount > 0) {
            console.log(
              `🎉 SUCCESS: Vendor [${vendorEmail}] has been upgraded to PREMIUM in MongoDB!`
            )
          } else {
            console.warn(
              `⚠️ Vendor with email [${vendorEmail}] was not found in users collection.`
            )
          }

          // 2.3 Record payment into "payments" and "transactions" collections
          const paymentData = {
            vendorEmail,
            vendorId: vendorId || null,
            plan: "premium",
            amount: amountPaid,
            currency,
            stripeSessionId: session.id,
            stripePaymentIntentId: session.payment_intent || null,
            status: "paid",
            createdAt: new Date(),
          }

          // Save to payments
          await db.collection("payments").updateOne(
            { stripeSessionId: session.id },
            { $setOnInsert: paymentData },
            { upsert: true }
          )

          // Save to transactions
          await db.collection("transactions").updateOne(
            { stripeSessionId: session.id },
            { $setOnInsert: paymentData },
            { upsert: true }
          )
          console.log(`📝 Payment record created in payments & transactions for session [${session.id}].`)
        } catch (dbError) {
          console.error("❌ Database update error in webhook:", dbError)
        }

        console.log(`========================================\n`)
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
