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
import customerRoutes from "./routes/customer.js"
import menuRoutes from "./routes/menu.js"
import adminRoutes from "./routes/admin.js"
import paymentRoutes from "./routes/payment.js"
import vendorRoutes from "./routes/vendor.js"
import webhookRoutes from "./routes/webhook.js"

const app = express()
const port = process.env.PORT || 5000

// 1. Global Middleware
app.use(
  cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (e.g. mobile apps, server-side SSR fetch, curl)
      if (!origin) return callback(null, true)

      // Allow if origin matches CLIENT_URL, ends with .vercel.app, or is localhost
      if (
        !process.env.CLIENT_URL ||
        origin === process.env.CLIENT_URL ||
        origin.endsWith(".vercel.app") ||
        origin.includes("localhost")
      ) {
        return callback(null, true)
      }

      return callback(null, true)
    },
    credentials: true,
  })
)

// 2. Stripe Webhook (MUST be before express.json() because Stripe needs the raw body buffer)
app.use("/api/webhook", webhookRoutes)

// 3. Body Parser for standard JSON routes
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

// 5. Database Connection Middleware (Ensures MongoDB connection across serverless invocations on Vercel)
app.use(async (req, res, next) => {
  if (req.path === "/") return next()

  try {
    await connectDB()
    next()
  } catch (err) {
    console.error("MongoDB connection failed in middleware:", err)
    res.status(500).json({ message: "Failed to connect to database." })
  }
})

// 6. Business Routes
app.use("/api/customer", customerRoutes)
app.use("/api/menu", menuRoutes)
app.use("/api/vendor", vendorRoutes)
app.use("/api/admin", adminRoutes)
app.use("/api/payment", paymentRoutes)

// 7. Connect MongoDB & Start Server for local runtime
if (process.env.NODE_ENV !== "production" || !process.env.VERCEL) {
  connectDB()
    .then(() => {
      app.listen(port, () => {
        console.log(`PizzaHub server running on http://localhost:${port}`)
      })
    })
    .catch((error) => {
      console.error("Failed to start server locally:", error)
    })
}

export default app;
