import express from "express"

import { getDB } from "../config/db.js"
import { verifyJWT } from "../middleware/verifyJWT.js"
import { verifyCustomer } from "../middleware/verifyRole.js"

const router = express.Router()

// ========================================================
// 1. GET /api/customer/menu — Public Browse Menu (Approved items only)
// ========================================================
router.get("/menu", async (req, res) => {
  try {
    const db = getDB()

    // Public customer menu displays strictly approved items
    const items = await db
      .collection("menuItems")
      .find({ status: "approved" })
      .sort({ createdAt: -1 })
      .toArray()

    return res.json({
      success: true,
      count: items.length,
      items,
    })
  } catch (error) {
    console.error("Error fetching customer menu items:", error)
    return res.status(500).json({
      message: "Server error while fetching menu.",
    })
  }
})

export default router
