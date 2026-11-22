import express from "express"
import { ObjectId } from "mongodb"

import { getDB } from "../config/db.js"
import { verifyJWT } from "../middleware/verifyJWT.js"
import { verifyVendor } from "../middleware/verifyRole.js"

const router = express.Router()

/**
 * 1. GET /api/vendor/orders — Fetch Incoming Customer Orders for the Logged-in Vendor
 * Supports optional search & status filter query params: ?status=pending&search=pepperoni
 */
router.get("/orders", verifyJWT, verifyVendor, async (req, res) => {
  try {
    const db = getDB()
    const vendorEmail = req.user.email
    const vendorId = req.user.id

    // Match orders belonging to this vendor
    const vendorCondition = {
      $or: [
        { vendorEmail: vendorEmail },
        { vendorId: vendorId },
        ...(ObjectId.isValid(vendorId) ? [{ vendorId: new ObjectId(vendorId) }] : []),
      ],
    }

    const { status, search } = req.query
    const filter = { ...vendorCondition }

    if (status && status !== "all") {
      filter.status = status.toLowerCase()
    }

    if (search && String(search).trim() !== "") {
      const regex = new RegExp(String(search).trim(), "i")
      filter.$and = [
        vendorCondition,
        {
          $or: [
            { itemName: regex },
            { customerName: regex },
            { customerEmail: regex },
            { deliveryAddress: regex },
          ],
        },
      ]
    }

    const orders = await db
      .collection("orders")
      .find(filter)
      .sort({ createdAt: -1 })
      .toArray()

    return res.json({
      success: true,
      count: orders.length,
      orders,
    })
  } catch (error) {
    console.error("Error fetching vendor customer orders:", error)
    return res.status(500).json({
      message: "Server error while fetching incoming customer orders.",
    })
  }
})

/**
 * 2. PATCH /api/vendor/orders/:id/status — Accept or Reject an Incoming Order
 * Strict Rules (AGENTS.md):
 * - Vendor can only accept/reject their OWN orders
 * - Can ONLY update 'pending' orders
 * - Action can only be executed ONCE (status becomes 'accepted' or 'rejected')
 */
router.patch("/orders/:id/status", verifyJWT, verifyVendor, async (req, res) => {
  try {
    const { id } = req.params
    const { status } = req.body

    // 1. Validate status value
    const normalizedStatus = String(status || "").toLowerCase().trim()
    if (!["accepted", "rejected"].includes(normalizedStatus)) {
      return res.status(400).json({
        message: "Invalid status. Allowed values are 'accepted' or 'rejected'.",
      })
    }

    if (!ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Invalid order ID format." })
    }

    const db = getDB()
    const orderCollection = db.collection("orders")

    // 2. Fetch the existing order
    const order = await orderCollection.findOne({ _id: new ObjectId(id) })
    if (!order) {
      return res.status(404).json({ message: "Order not found." })
    }

    // 3. Ownership Verification: Ensure order belongs to this vendor
    const vendorEmail = req.user.email
    const vendorId = req.user.id
    const isOwner =
      order.vendorEmail === vendorEmail ||
      order.vendorId === vendorId ||
      (ObjectId.isValid(vendorId) && String(order.vendorId) === String(vendorId))

    if (!isOwner) {
      return res.status(403).json({
        message: "Forbidden: You are not authorized to manage orders for other pizzerias.",
      })
    }

    // 4. Strict AGENTS.md Rule: Only 'pending' orders can be accepted or rejected
    if (order.status !== "pending") {
      return res.status(400).json({
        message: `This order is already '${order.status}' and cannot be modified again.`,
      })
    }

    // 5. Update order status
    const updateResult = await orderCollection.updateOne(
      { _id: new ObjectId(id) },
      {
        $set: {
          status: normalizedStatus,
          updatedAt: new Date(),
          processedAt: new Date(),
        },
      }
    )

    if (updateResult.modifiedCount === 0) {
      return res.status(500).json({ message: "Failed to update order status." })
    }

    return res.json({
      success: true,
      message: `Order successfully ${normalizedStatus}!`,
      status: normalizedStatus,
      orderId: id,
    })
  } catch (error) {
    console.error("Error updating vendor order status:", error)
    return res.status(500).json({
      message: "Server error while updating order status.",
    })
  }
})

/**
 * 3. GET /api/vendor/stats — Live Analytics for Vendor Dashboard
 * Returns counts of menu items and orders
 */
router.get("/stats", verifyJWT, verifyVendor, async (req, res) => {
  try {
    const db = getDB()
    const vendorEmail = req.user.email
    const vendorId = req.user.id

    const vendorOrderCondition = {
      $or: [
        { vendorEmail: vendorEmail },
        { vendorId: vendorId },
        ...(ObjectId.isValid(vendorId) ? [{ vendorId: new ObjectId(vendorId) }] : []),
      ],
    }

    // Menu counts
    const totalMenuItems = await db.collection("menuItems").countDocuments({
      vendorEmail,
      status: { $ne: "rejected" },
    })

    const activeMenuItems = await db.collection("menuItems").countDocuments({
      vendorEmail,
      status: "approved",
    })

    const pendingMenuItems = await db.collection("menuItems").countDocuments({
      vendorEmail,
      status: "pending",
    })

    // Order counts
    const totalOrders = await db.collection("orders").countDocuments(vendorOrderCondition)

    const pendingOrders = await db.collection("orders").countDocuments({
      ...vendorOrderCondition,
      status: "pending",
    })

    const acceptedOrders = await db.collection("orders").countDocuments({
      ...vendorOrderCondition,
      status: "accepted",
    })

    const rejectedOrders = await db.collection("orders").countDocuments({
      ...vendorOrderCondition,
      status: "rejected",
    })

    const cancelledOrders = await db.collection("orders").countDocuments({
      ...vendorOrderCondition,
      status: "cancelled",
    })

    // Calculate total revenue from accepted orders
    const acceptedOrdersList = await db
      .collection("orders")
      .find({
        ...vendorOrderCondition,
        status: "accepted",
      })
      .toArray()

    const totalRevenue = acceptedOrdersList.reduce((sum, o) => sum + (Number(o.totalPrice) || 0), 0)

    return res.json({
      success: true,
      stats: {
        totalMenuItems,
        activeMenuItems,
        pendingMenuItems,
        totalOrders,
        pendingOrders,
        acceptedOrders,
        rejectedOrders,
        cancelledOrders,
        totalRevenue: Number(totalRevenue.toFixed(2)),
      },
    })
  } catch (error) {
    console.error("Error fetching vendor stats:", error)
    return res.status(500).json({
      message: "Server error while fetching vendor statistics.",
    })
  }
})

export default router
