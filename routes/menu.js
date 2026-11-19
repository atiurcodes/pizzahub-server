import express from "express"

import { getDB } from "../config/db.js"
import { verifyJWT } from "../middleware/verifyJWT.js"
import { verifyVendor } from "../middleware/verifyRole.js"

const router = express.Router()

router.post("/", verifyJWT, verifyVendor, async (req, res) => {
  try {
    const { itemName, category, price, location, description, images } = req.body

    // 1. Basic validation: check all required fields
    if (!itemName || !category || !price || !location || !description) {
      return res.status(400).json({
        message: "All fields (name, category, price, location, description) are required.",
      })
    }

    // 2. Validate images
    if (!images || !Array.isArray(images) || images.length === 0) {
      return res.status(400).json({
        message: "At least one item image is required.",
      })
    }

    const db = getDB()
    const menuCollection = db.collection("menuItems")

    // 3. Plan Limit Check: Free plan = max 3 items, Premium = unlimited
    const vendorEmail = req.user.email
    const subscriptionPlan = req.user.subscriptionPlan || "free"

    if (subscriptionPlan === "free") {
      const activeCount = await menuCollection.countDocuments({
        vendorEmail,
        status: { $ne: "rejected" },
      })

      if (activeCount >= 3) {
        return res.status(403).json({
          message:
            "Free plan limit reached (maximum 3 items). Upgrade to Premium for unlimited menu items.",
        })
      }
    }

    // 4. Construct the menu item document
    const newMenuItem = {
      itemName: itemName.trim(),
      category: category.trim(),
      price: Number(price),
      location: location.trim(),
      description: description.trim(),
      images,
      vendorEmail, // Sole vendor identifier
      status: "pending", // Default status for admin review
      createdAt: new Date(),
    }

    // 5. Insert into MongoDB
    const result = await menuCollection.insertOne(newMenuItem)

    // 6. Return response
    return res.status(201).json({
      success: true,
      message: "Menu item submitted successfully! Pending admin approval.",
      insertedId: result.insertedId,
      item: { ...newMenuItem, _id: result.insertedId },
    })
  } catch (error) {
    console.error("Error creating menu item:", error)
    return res.status(500).json({
      message: "Server error while creating menu item.",
    })
  }
})

// ========================================================
// GET /api/menu/my-items — Get all items for logged-in vendor
// ========================================================
router.get("/my-items", verifyJWT, verifyVendor, async (req, res) => {
  try {
    const db = getDB()
    const vendorEmail = req.user.email

    // Fetch all items created by this vendor, sorted newest first
    const items = await db
      .collection("menuItems")
      .find({ vendorEmail })
      .sort({ createdAt: -1 })
      .toArray()

    return res.json({
      success: true,
      count: items.length,
      items,
    })
  } catch (error) {
    console.error("Error fetching vendor menu items:", error)
    return res.status(500).json({
      message: "Server error while fetching menu items.",
    })
  }
})

export default router
