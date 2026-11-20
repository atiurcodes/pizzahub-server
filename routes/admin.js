import express from "express"
import { ObjectId } from "mongodb"

import { getDB } from "../config/db.js"
import { verifyJWT } from "../middleware/verifyJWT.js"
import { verifyAdmin } from "../middleware/verifyRole.js"

const router = express.Router()

// All routes in this router require verified Admin access
router.use(verifyJWT, verifyAdmin)

// ========================================================
// 1. GET /api/admin/menu-items — Fetch all menu items for admin review
// ========================================================
router.get("/menu-items", async (req, res) => {
  try {
    const { status } = req.query
    const db = getDB()

    // Optional filter: ?status=pending or fetch all
    const filter = {}
    if (status) {
      filter.status = status
    }

    // Fetch items sorted newest first
    const items = await db
      .collection("menuItems")
      .find(filter)
      .sort({ createdAt: -1 })
      .toArray()

    return res.json({
      success: true,
      count: items.length,
      items,
    })
  } catch (error) {
    console.error("Error fetching admin menu items:", error)
    return res.status(500).json({
      message: "Server error while fetching menu items.",
    })
  }
})



export default router
