import express from "express"
import { ObjectId } from "mongodb"

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

// ========================================================
// GET /api/menu/my-menu-count — Count active/pending items for logged-in vendor
// ========================================================
router.get(["/my-menu-count", "/menu-count"], verifyJWT, verifyVendor, async (req, res) => {
  try {
    const db = getDB()
    const vendorEmail = req.user.email

    // Fast MongoDB query: count non-rejected menu items for this vendor
    const count = await db.collection("menuItems").countDocuments({
      vendorEmail,
      status: { $ne: "rejected" },
    })

    return res.json({
      success: true,
      count,
    })
  } catch (error) {
    console.error("Error counting vendor menu items:", error)
    return res.status(500).json({
      message: "Server error while counting menu items.",
    })
  }
})

// ========================================================
// GET /api/menu/subscription-status — Live check if vendor is Free or Premium
// ========================================================
router.get("/subscription-status", verifyJWT, verifyVendor, async (req, res) => {
  try {
    const db = getDB()
    const vendorEmail = req.user.email

    // 1. Get real-time user record from MongoDB (always fresh)
    const hasUserCol = await db.listCollections({ name: "user" }).hasNext()
    const userCollection = hasUserCol ? db.collection("user") : db.collection("users")
    const user = await userCollection.findOne({ email: vendorEmail })

    const subscriptionPlan = user?.subscriptionPlan === "premium" ? "premium" : "free"
    const isPremium = subscriptionPlan === "premium"

    // 2. Count active non-rejected menu items for this vendor
    const activeItemCount = await db.collection("menuItems").countDocuments({
      vendorEmail,
      status: { $ne: "rejected" },
    })

    // 3. Premium vendors have unlimited items; Free vendors have max 3 items
    const canAddMore = isPremium || activeItemCount < 3

    return res.json({
      success: true,
      subscriptionPlan,
      isPremium,
      activeItemCount,
      maxAllowed: isPremium ? "unlimited" : 3,
      canAddMore,
    })
  } catch (error) {
    console.error("Error checking vendor subscription status:", error)
    return res.status(500).json({
      message: "Server error while checking subscription status.",
    })
  }
})

// ========================================================
// GET /api/menu — Public Browse Menu (Approved items only)
// ========================================================
router.get("/", async (req, res) => {
  try {
    const db = getDB()

    // Fetch strictly approved items, sorted newest first
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
    console.error("Error fetching public menu items:", error)
    return res.status(500).json({
      message: "Server error while fetching menu.",
    })
  }
})

// ========================================================
// GET /api/menu/:id — Get a single menu item by ID
// ========================================================
router.get("/:id", async (req, res) => {
  try {
    const { id } = req.params

    if (!ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Invalid item ID format." })
    }

    const db = getDB()
    const item = await db
      .collection("menuItems")
      .findOne({ _id: new ObjectId(id) })

    if (!item) {
      return res.status(404).json({ message: "Menu item not found." })
    }

    // Lookup vendor details & subscription status
    let vendor = null
    if (item.vendorEmail) {
      const hasUserCol = await db.listCollections({ name: "user" }).hasNext()
      const userCollection = hasUserCol ? db.collection("user") : db.collection("users")
      const vendorUser = await userCollection.findOne({ email: item.vendorEmail })

      if (vendorUser) {
        vendor = {
          name: vendorUser.name || "Local Pizza Shop",
          businessName: vendorUser.businessName || vendorUser.name || "Local Pizza Shop",
          email: vendorUser.email,
          subscriptionPlan: vendorUser.subscriptionPlan || "free",
          isPremium: vendorUser.subscriptionPlan === "premium",
          image: vendorUser.image || null,
        }
      }
    }

    return res.json({ success: true, item: { ...item, vendor } })
  } catch (error) {
    console.error("Error fetching menu item:", error)
    return res.status(500).json({
      message: "Server error while fetching menu item.",
    })
  }
})

// ========================================================
// PATCH /api/menu/:id — Update a menu item (Vendor only, owner check)
// ========================================================
router.patch("/:id", verifyJWT, verifyVendor, async (req, res) => {
  try {
    const { id } = req.params

    if (!ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Invalid item ID format." })
    }

    const db = getDB()
    const menuCollection = db.collection("menuItems")

    // 1. Find existing item to verify ownership
    const existingItem = await menuCollection.findOne({ _id: new ObjectId(id) })

    if (!existingItem) {
      return res.status(404).json({ message: "Menu item not found." })
    }

    // 2. Strict Security: A vendor can ONLY edit their own items
    if (existingItem.vendorEmail !== req.user.email) {
      return res.status(403).json({
        message: "Forbidden: You do not have permission to edit this item.",
      })
    }

    // 3. Extract updated fields
    const { itemName, category, price, location, description, images } = req.body

    const updateDoc = {
      updatedAt: new Date(),
      status: "pending", // Re-submit for review upon edit
    }

    if (itemName) updateDoc.itemName = itemName.trim()
    if (category) updateDoc.category = category.trim()
    if (price !== undefined) updateDoc.price = Number(price)
    if (location) updateDoc.location = location.trim()
    if (description) updateDoc.description = description.trim()
    if (images && Array.isArray(images) && images.length > 0) {
      updateDoc.images = images
    }

    // 4. Update in MongoDB
    await menuCollection.updateOne(
      { _id: new ObjectId(id) },
      { $set: updateDoc }
    )

    return res.json({
      success: true,
      message: "Menu item updated successfully! Pending admin re-review.",
    })
  } catch (error) {
    console.error("Error updating menu item:", error)
    return res.status(500).json({
      message: "Server error while updating menu item.",
    })
  }
})

// ========================================================
// DELETE /api/menu/:id — Delete a menu item (Vendor only, owner check)
// ========================================================
router.delete("/:id", verifyJWT, verifyVendor, async (req, res) => {
  try {
    const { id } = req.params

    if (!ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Invalid item ID format." })
    }

    const db = getDB()
    const menuCollection = db.collection("menuItems")

    // 1. Find existing item to verify ownership
    const existingItem = await menuCollection.findOne({ _id: new ObjectId(id) })

    if (!existingItem) {
      return res.status(404).json({ message: "Menu item not found." })
    }

    // 2. Strict Security: A vendor can ONLY delete their own items
    if (existingItem.vendorEmail !== req.user.email) {
      return res.status(403).json({
        message: "Forbidden: You do not have permission to delete this item.",
      })
    }

    // 3. Delete from MongoDB
    await menuCollection.deleteOne({ _id: new ObjectId(id) })

    return res.json({
      success: true,
      message: "Menu item deleted successfully.",
    })
  } catch (error) {
    console.error("Error deleting menu item:", error)
    return res.status(500).json({
      message: "Server error while deleting menu item.",
    })
  }
})

export default router
