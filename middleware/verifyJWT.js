import jwt from "jsonwebtoken"
import { getDB } from "../config/db.js"

// Small helper to read a cookie value from req.headers.cookie
function getCookie(req, name) {
  const raw = req.headers.cookie || ""
  const match = raw
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`))

  return match ? decodeURIComponent(match.split("=").slice(1).join("=")) : null
}

export async function verifyJWT(req, res, next) {
  // 1. Read Better Auth session JWT from Bearer header OR directly from session cookie
  const authHeader = req.headers.authorization
  const token = authHeader?.startsWith("Bearer ")
    ? authHeader.split(" ")[1]
    : getCookie(req, "better-auth.session_data") ||
      getCookie(req, "__Secure-better-auth.session_data")

  if (!token) {
    return res.status(401).json({ message: "Unauthorized: token missing" })
  }

  try {
    // 2. Verify Better Auth session cookie JWT using BETTER_AUTH_SECRET
    const decoded = jwt.verify(token, process.env.BETTER_AUTH_SECRET)
    const email = decoded.user?.email

    if (!email) {
      return res.status(401).json({ message: "Invalid session token" })
    }

    // 3. Get real user from MongoDB (never trust stale cookie or client role)
    const db = getDB()
    const dbUser =
      (await db.collection("user").findOne({ email })) ||
      (await db.collection("users").findOne({ email }))

    if (!dbUser) {
      return res.status(401).json({ message: "User not found" })
    }

    if (dbUser.isBlocked) {
      return res.status(403).json({ message: "Account is blocked" })
    }

    // 4. Attach verified user to req.user
    req.user = {
      id: dbUser._id.toString(),
      name: dbUser.name,
      email: dbUser.email,
      role: dbUser.role || "customer",
      subscriptionPlan: dbUser.subscriptionPlan || "free",
    }

    next()
  } catch {
    return res.status(401).json({ message: "Invalid or expired token" })
  }
}
