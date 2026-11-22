import express from "express"
import { ObjectId } from "mongodb"

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

// ========================================================
// 2. POST /api/customer/orders — Submit Customer Pizza Order
// ========================================================
router.post("/orders", verifyJWT, verifyCustomer, async (req, res) => {
  try {
    const { itemId, deliveryDate, deliveryAddress, message, quantity = 1 } = req.body

    // 1. Validation: required fields
    if (!itemId || !deliveryDate || !deliveryAddress) {
      return res.status(400).json({
        message: "Pizza item, delivery date, and delivery address are required.",
      })
    }

    if (!ObjectId.isValid(itemId)) {
      return res.status(400).json({ message: "Invalid item ID." })
    }

    const trimmedAddress = String(deliveryAddress).trim()
    if (trimmedAddress.length < 5) {
      return res.status(400).json({
        message: "Please enter a valid, complete delivery address (at least 5 characters).",
      })
    }

    const db = getDB()

    // 2. Fetch the target pizza menu item
    const item = await db.collection("menuItems").findOne({ _id: new ObjectId(itemId) })

    if (!item) {
      return res.status(404).json({ message: "Pizza item not found." })
    }

    if (item.status !== "approved") {
      return res.status(400).json({
        message: "This pizza is not available for ordering (item is pending review or inactive).",
      })
    }

    // 3. Strict Security Rule: Prevent vendors from ordering their own item
    if (item.vendorEmail === req.user.email) {
      return res.status(403).json({
        message: "Forbidden: Vendors cannot place orders for their own menu items.",
      })
    }

    // 4. Validate Delivery Date (cannot be in the past)
    const formattedDeliveryDate = new Date(deliveryDate).toISOString().split("T")[0]
    const today = new Date().toISOString().split("T")[0]

    if (formattedDeliveryDate < today) {
      return res.status(400).json({
        message: "Delivery date cannot be in the past. Please select today or a future date.",
      })
    }

    // 5. Strict Security Rule: Prevent duplicate active orders for the same itemId + deliveryDate by the same customer
    const existingActiveOrder = await db.collection("orders").findOne({
      itemId: new ObjectId(itemId),
      customerEmail: req.user.email,
      deliveryDate: formattedDeliveryDate,
      status: { $in: ["pending", "accepted"] },
    })

    if (existingActiveOrder) {
      return res.status(409).json({
        message:
          "You already have an active order for this pizza on this delivery date. Please check your orders in the dashboard.",
      })
    }

    // 6. Look up vendor user info to attach vendor name & id
    const hasUserCol = await db.listCollections({ name: "user" }).hasNext()
    const userCollection = hasUserCol ? db.collection("user") : db.collection("users")
    const vendorUser = await userCollection.findOne({ email: item.vendorEmail })

    const qty = Math.max(1, Math.min(50, Number(quantity) || 1))
    const unitPrice = Number(item.price)
    const totalPrice = Number((unitPrice * qty).toFixed(2))

    // 7. Auto-bind server-side identity & construct the order document
    const newOrder = {
      itemId: new ObjectId(itemId),
      itemName: item.itemName,
      itemImage: item.images?.[0] || null,
      category: item.category,
      unitPrice,
      quantity: qty,
      totalPrice,
      vendorId: vendorUser ? vendorUser._id.toString() : (item.vendorId || null),
      vendorEmail: item.vendorEmail,
      vendorName: vendorUser?.businessName || vendorUser?.name || "Local Pizza Shop",
      customerId: req.user.id,
      customerName: req.user.name,
      customerEmail: req.user.email,
      deliveryDate: formattedDeliveryDate,
      deliveryAddress: trimmedAddress,
      message: message ? String(message).trim() : "",
      status: "pending", // Default status per AGENTS.md
      createdAt: new Date(),
    }

    const result = await db.collection("orders").insertOne(newOrder)

    return res.status(201).json({
      success: true,
      message: "Order placed successfully! Pizzeria has received your order.",
      orderId: result.insertedId.toString(),
      order: { ...newOrder, _id: result.insertedId },
    })
  } catch (error) {
    console.error("Error creating customer order:", error)
    return res.status(500).json({
      message: "Server error while placing order.",
    })
  }
})

// ========================================================
// 3. GET /api/customer/orders — Fetch Logged-in Customer's Orders
// ========================================================
router.get("/orders", verifyJWT, verifyCustomer, async (req, res) => {
  try {
    const db = getDB()

    const orders = await db
      .collection("orders")
      .find({
        $or: [
          { customerEmail: req.user.email },
          { customerId: req.user.id },
        ],
      })
      .sort({ createdAt: -1 })
      .toArray()

    return res.json({
      success: true,
      count: orders.length,
      orders,
    })
  } catch (error) {
    console.error("Error fetching customer orders:", error)
    return res.status(500).json({
      message: "Server error while fetching your orders.",
    })
  }
})

// ========================================================
// 4. PATCH /api/customer/orders/:id/cancel — Cancel Customer's Own Pending Order
// ========================================================
router.patch("/orders/:id/cancel", verifyJWT, verifyCustomer, async (req, res) => {
  try {
    const { id } = req.params

    if (!ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Invalid order ID format." })
    }

    const db = getDB()
    const orderCollection = db.collection("orders")

    const order = await orderCollection.findOne({ _id: new ObjectId(id) })

    if (!order) {
      return res.status(404).json({ message: "Order not found." })
    }

    // Ownership check: Customer can ONLY cancel their own order
    const isOwner =
      order.customerEmail === req.user.email ||
      String(order.customerId) === String(req.user.id)

    if (!isOwner) {
      return res.status(403).json({
        message: "Forbidden: You do not have permission to cancel this order.",
      })
    }

    // Rule: Can ONLY cancel 'pending' orders
    if (order.status !== "pending") {
      return res.status(400).json({
        message: `Cannot cancel an order that has already been ${order.status}. Only pending orders can be cancelled.`,
      })
    }

    await orderCollection.updateOne(
      { _id: new ObjectId(id) },
      {
        $set: {
          status: "cancelled",
          cancelledAt: new Date(),
        },
      }
    )

    return res.json({
      success: true,
      message: "Order cancelled successfully.",
    })
  } catch (error) {
    console.error("Error cancelling customer order:", error)
    return res.status(500).json({
      message: "Server error while cancelling order.",
    })
  }
})

export default router
