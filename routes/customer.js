import express from "express"
import { ObjectId } from "mongodb"

import { getDB } from "../config/db.js"
import { verifyJWT } from "../middleware/verifyJWT.js"
import { verifyCustomer } from "../middleware/verifyRole.js"

const router = express.Router()

// ========================================================
// 1. GET /api/customer/menu — Public Browse Menu with Search, Filter & Sort
// ========================================================
router.get("/menu", async (req, res) => {
  try {
    const { search, category, location, sortBy, sortOrder, sort } = req.query
    const db = getDB()

    // 1. Base query: strictly approved items for public customers
    const query = { status: "approved" }

    // 2. Search by item name or description keywords
    if (search && typeof search === "string" && search.trim() !== "") {
      const searchRegex = new RegExp(search.trim(), "i")
      query.$or = [
        { itemName: { $regex: searchRegex } },
        { description: { $regex: searchRegex } },
      ]
    }

    // 3. Filter by Category
    if (
      category &&
      typeof category === "string" &&
      category.trim() !== "" &&
      category.trim().toLowerCase() !== "all"
    ) {
      query.category = category.trim()
    }

    // 4. Filter by Location (case-insensitive substring)
    if (
      location &&
      typeof location === "string" &&
      location.trim() !== "" &&
      location.trim().toLowerCase() !== "all"
    ) {
      query.location = { $regex: new RegExp(location.trim(), "i") }
    }

    // 5. Sort Criteria (Challenge Requirement: Sort by price ascending and descending)
    let sortCriteria = { createdAt: -1 } // default newest

    const sortParam = (sort || "").toLowerCase()
    const sortByParam = (sortBy || "").toLowerCase()
    const sortOrderParam = (sortOrder || "").toLowerCase()

    if (
      sortParam === "price-asc" ||
      sortParam === "price_asc" ||
      (sortByParam === "price" && sortOrderParam === "asc")
    ) {
      sortCriteria = { price: 1, createdAt: -1 }
    } else if (
      sortParam === "price-desc" ||
      sortParam === "price_desc" ||
      (sortByParam === "price" && sortOrderParam === "desc")
    ) {
      sortCriteria = { price: -1, createdAt: -1 }
    } else if (sortParam === "name-asc") {
      sortCriteria = { itemName: 1 }
    } else if (sortParam === "newest") {
      sortCriteria = { createdAt: -1 }
    }

    const items = await db
      .collection("menuItems")
      .find(query)
      .sort(sortCriteria)
      .toArray()

    // 6. Enrich items with vendor information (including isPremium status)
    const hasUserCol = await db.listCollections({ name: "user" }).hasNext()
    const userCollection = hasUserCol ? db.collection("user") : db.collection("users")

    const vendorEmails = [...new Set(items.map((i) => i.vendorEmail).filter(Boolean))]
    const vendors = await userCollection
      .find({ email: { $in: vendorEmails } })
      .project({ name: 1, businessName: 1, email: 1, subscriptionPlan: 1, image: 1 })
      .toArray()

    const vendorMap = new Map()
    vendors.forEach((v) => {
      vendorMap.set(v.email, {
        name: v.name,
        businessName: v.businessName || v.name,
        email: v.email,
        subscriptionPlan: v.subscriptionPlan || "free",
        isPremium: v.subscriptionPlan === "premium",
        image: v.image || null,
      })
    })

    const enrichedItems = items.map((item) => ({
      ...item,
      vendor: vendorMap.get(item.vendorEmail) || null,
    }))

    // 7. Get distinct approved locations for the frontend filter dropdown
    const availableLocations = await db
      .collection("menuItems")
      .distinct("location", { status: "approved" })

    return res.json({
      success: true,
      count: enrichedItems.length,
      items: enrichedItems,
      locations: availableLocations.filter(Boolean),
    })
  } catch (error) {
    console.error("Error fetching customer menu items:", error)
    return res.status(500).json({
      message: "Server error while fetching menu.",
    })
  }
})

// ========================================================
// 1.1 GET /api/customer/menu/featured — Featured Menu Items (Prioritizing Premium Vendors)
// ========================================================
router.get("/menu/featured", async (req, res) => {
  try {
    const db = getDB()

    // 1. Strictly approved items
    const items = await db
      .collection("menuItems")
      .find({ status: "approved" })
      .sort({ createdAt: -1 })
      .toArray()

    // 2. Enrich with vendor profile & isPremium status
    const hasUserCol = await db.listCollections({ name: "user" }).hasNext()
    const userCollection = hasUserCol ? db.collection("user") : db.collection("users")

    const vendorEmails = [...new Set(items.map((i) => i.vendorEmail).filter(Boolean))]
    const vendors = await userCollection
      .find({ email: { $in: vendorEmails } })
      .project({ name: 1, businessName: 1, email: 1, subscriptionPlan: 1, image: 1 })
      .toArray()

    const vendorMap = new Map()
    vendors.forEach((v) => {
      vendorMap.set(v.email, {
        name: v.name,
        businessName: v.businessName || v.name,
        email: v.email,
        subscriptionPlan: v.subscriptionPlan || "free",
        isPremium: v.subscriptionPlan === "premium",
        image: v.image || null,
      })
    })

    const enrichedItems = items.map((item) => ({
      ...item,
      vendor: vendorMap.get(item.vendorEmail) || null,
    }))

    // 3. Priority Sort: Items from Premium vendors come FIRST, then newest items
    enrichedItems.sort((a, b) => {
      const aPrem = a.vendor?.isPremium ? 1 : 0
      const bPrem = b.vendor?.isPremium ? 1 : 0
      if (bPrem !== aPrem) return bPrem - aPrem
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    })

    const limit = Math.max(6, parseInt(req.query.limit, 10) || 6)
    const featured = enrichedItems.slice(0, limit)

    return res.json({
      success: true,
      count: featured.length,
      items: featured,
    })
  } catch (error) {
    console.error("Error fetching featured customer menu items:", error)
    return res.status(500).json({
      message: "Server error while fetching featured items.",
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

// ========================================================
// 5. GET /api/customer/stats — Customer Dashboard Analytics (Live)
// ========================================================
router.get("/stats", verifyJWT, verifyCustomer, async (req, res) => {
  try {
    const db = getDB()
    const customerFilter = {
      $or: [
        { customerEmail: req.user.email },
        { customerId: req.user.id },
      ],
    }

    const totalOrders = await db.collection("orders").countDocuments(customerFilter)
    const pendingOrders = await db.collection("orders").countDocuments({
      ...customerFilter,
      status: "pending",
    })
    const acceptedOrders = await db.collection("orders").countDocuments({
      ...customerFilter,
      status: "accepted",
    })
    const rejectedOrders = await db.collection("orders").countDocuments({
      ...customerFilter,
      status: "rejected",
    })
    const cancelledOrders = await db.collection("orders").countDocuments({
      ...customerFilter,
      status: "cancelled",
    })

    return res.json({
      success: true,
      stats: {
        totalOrders,
        pendingOrders,
        acceptedOrders,
        rejectedOrders,
        cancelledOrders,
      },
    })
  } catch (error) {
    console.error("Error fetching customer stats:", error)
    return res.status(500).json({
      message: "Server error while fetching customer stats.",
    })
  }
})

export default router
