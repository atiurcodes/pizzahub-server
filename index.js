import "dotenv/config"
import cors from "cors"
import express from "express"

import { connectDB } from "./config/db.js"
import { verifyJWT } from "./middleware/verifyJWT.js"
import {
  verifyAdmin,
  verifyCustomer,
  verifyVendor,
} from "./middleware/verifyRole.js"

const app = express()
const port = process.env.PORT || 5000

// 1. Global Middleware
app.use(
  cors({
    origin: process.env.CLIENT_URL || "http://localhost:3000",
    credentials: true,
  })
)
app.use(express.json())

// 2. Public Health Check Route
app.get("/", (req, res) => {
  res.json({ message: "PizzaHub API Server is running" })
})

// 3. Protected Route Example (Any logged-in user with a valid JWT)
app.get("/api/auth/me", verifyJWT, (req, res) => {
  res.json({
    message: "JWT verified successfully",
    user: req.user,
  })
})

// 4. Role-Protected Starter Routes (verifyJWT + role middleware)
app.get("/api/admin/check", verifyJWT, verifyAdmin, (req, res) => {
  res.json({ message: "Welcome Admin", user: req.user })
})

app.get("/api/vendor/check", verifyJWT, verifyVendor, (req, res) => {
  res.json({ message: "Welcome Vendor", user: req.user })
})

app.get("/api/customer/check", verifyJWT, verifyCustomer, (req, res) => {
  res.json({ message: "Welcome Customer", user: req.user })
})

// 5. Connect MongoDB & Start Server
connectDB()
  .then(() => {
    app.listen(port, () => {
      console.log(`PizzaHub server running on http://localhost:${port}`)
    })
  })
  .catch((error) => {
    console.error("Failed to start server:", error)
    process.exit(1)
  })
