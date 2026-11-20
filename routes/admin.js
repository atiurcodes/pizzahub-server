import express from "express"
import { ObjectId } from "mongodb"

import { getDB } from "../config/db.js"
import { verifyJWT } from "../middleware/verifyJWT.js"
import { verifyAdmin } from "../middleware/verifyRole.js"

const router = express.Router()

// All routes in this router require verified Admin access
router.use(verifyJWT, verifyAdmin)

// ========================================================
// 1. GET /api/admin/stats — Fetch real-time overview counts
// ========================================================
router.get("/stats", async (req, res) => {
  try {
    const db = getDB()

    // 1. User collection (Better Auth uses "user" or "users")
    const userCollection =
      (await db.listCollections({ name: "user" }).hasNext())
        ? db.collection("user")
        : db.collection("users")

    const totalUsers = await userCollection.countDocuments()
    const totalVendors = await userCollection.countDocuments({ role: "vendor" })
    const totalCustomers = await userCollection.countDocuments({
      role: "customer",
    })

    // 2. Menu Items collection
    const menuCollection = db.collection("menuItems")
    const totalMenuItems = await menuCollection.countDocuments()
    const pendingMenuItems = await menuCollection.countDocuments({
      status: "pending",
    })
    const approvedMenuItems = await menuCollection.countDocuments({
      status: "approved",
    })

    // 3. Transactions collection
    let totalTransactions = 0
    try {
      totalTransactions = await db.collection("transactions").countDocuments()
    } catch {
      totalTransactions = 0
    }

    return res.json({
      success: true,
      stats: {
        totalUsers,
        totalVendors,
        totalCustomers,
        totalMenuItems,
        pendingMenuItems,
        approvedMenuItems,
        totalTransactions,
      },
    })
  } catch (error) {
    console.error("Error fetching admin stats:", error)
    return res.status(500).json({
      message: "Server error while fetching stats.",
    })
  }
})

// ========================================================
// 2. GET /api/admin/menu-items — Fetch all menu items for admin review
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

// ========================================================
// 2. PATCH /api/admin/menu-items/:id/status — Approve or reject an item
// ========================================================
router.patch("/menu-items/:id/status", async (req, res) => {
  try {
    const { id } = req.params
    const { status } = req.body

    // 1. Validate ID format
    if (!ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Invalid menu item ID." })
    }

    // 2. Validate status input
    const allowedStatuses = ["approved", "rejected", "pending", "inactive"]
    if (!status || !allowedStatuses.includes(status)) {
      return res.status(400).json({
        message:
          "Status must be either 'approved', 'rejected', 'pending', or 'inactive'.",
      })
    }

    const db = getDB()
    const menuCollection = db.collection("menuItems")

    // 3. Check if the item exists
    const existingItem = await menuCollection.findOne({ _id: new ObjectId(id) })
    if (!existingItem) {
      return res.status(404).json({ message: "Menu item not found." })
    }

    // 4. Update status in MongoDB
    await menuCollection.updateOne(
      { _id: new ObjectId(id) },
      {
        $set: {
          status,
          reviewedAt: new Date(),
          reviewedBy: req.user.email,
        },
      }
    )

    return res.json({
      success: true,
      message: `Menu item has been marked as ${status}.`,
      status,
    })
  } catch (error) {
    console.error("Error updating menu item status:", error)
    return res.status(500).json({
      message: "Server error while updating menu item status.",
    })
  }
})

// ========================================================
// 3. DELETE /api/admin/menu-items/:id — Delete any inappropriate item
// ========================================================
router.delete("/menu-items/:id", async (req, res) => {
  try {
    const { id } = req.params

    if (!ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Invalid menu item ID." })
    }

    const db = getDB()
    const result = await db
      .collection("menuItems")
      .deleteOne({ _id: new ObjectId(id) })

    if (result.deletedCount === 0) {
      return res.status(404).json({ message: "Menu item not found." })
    }

    return res.json({
      success: true,
      message: "Menu item deleted successfully by admin.",
    })
  } catch (error) {
    console.error("Error deleting menu item:", error)
    return res.status(500).json({
      message: "Server error while deleting menu item.",
    })
  }
})

export default router
