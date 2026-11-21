import express from "express"
import { getDB } from "../config/db.js"
import { verifyJWT } from "../middleware/verifyJWT.js"

const router = express.Router()

/**
 * POST /api/payment/confirm
 * Simple & direct: Upgrades vendor to "premium" and records payment info
 */
router.post("/confirm", verifyJWT, async (req, res) => {
  try {
    const db = getDB()
    const { sessionId, amount } = req.body
    const vendorEmail = req.user.email

    if (!vendorEmail) {
      return res.status(400).json({ message: "Vendor email is missing." })
    }

    // 1. Update user collection: change subscriptionPlan from "free" to "premium"
    const hasUserCol = await db.listCollections({ name: "user" }).hasNext()
    const userCollection = hasUserCol
      ? db.collection("user")
      : db.collection("users")

    await userCollection.updateOne(
      { email: vendorEmail },
      {
        $set: {
          subscriptionPlan: "premium",
          updatedAt: new Date(),
        },
      }
    )

    // 2. Prepare payment info document
    const paymentData = {
      vendorEmail,
      plan: "premium",
      amount: Number(amount) || 19.99,
      currency: "USD",
      stripeSessionId: sessionId || `session_${Date.now()}`,
      status: "paid",
      createdAt: new Date(),
    }

    // 3. Save into "payments" collection
    await db.collection("payments").updateOne(
      { stripeSessionId: paymentData.stripeSessionId },
      { $setOnInsert: paymentData },
      { upsert: true }
    )

    // Also save into "transactions" collection
    await db.collection("transactions").updateOne(
      { stripeSessionId: paymentData.stripeSessionId },
      { $setOnInsert: paymentData },
      { upsert: true }
    )

    console.log(`✅ [Payment Confirmed]: ${vendorEmail} upgraded to PREMIUM!`)

    return res.json({
      success: true,
      message: "Payment recorded and subscription upgraded to premium!",
      plan: "premium",
    })
  } catch (error) {
    console.error("Error confirming payment:", error)
    return res.status(500).json({
      message: "Server error while confirming payment.",
    })
  }
})

export default router
