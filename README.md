# PizzaHub — Server (Backend API)

> Express.js + MongoDB REST API backend and Stripe webhook service powering **PizzaHub — Pizza Ordering & Delivery Platform**.

---

## 🔗 Project Links

- **Server Repository:** [https://github.com/your-username/pizzahub-server](https://github.com/your-username/pizzahub-server)
- **Client Repository:** [https://github.com/your-username/pizzahub-client](https://github.com/your-username/pizzahub-client)
- **Live API Endpoint:** [https://pizzahub-server.onrender.com](https://pizzahub-server.onrender.com) *(Update with your live URL)*

---

## 🏛️ Architecture & Database Collections

PizzaHub uses **strictly 4 business collections** with relational references:

### 1. `users` (Managed/Extended via Better Auth)
- `name`: string
- `email`: string (unique)
- `image`: string (optional)
- `role`: `"vendor" | "customer" | "admin"`
- `isBlocked`: boolean (default: `false`)
- `businessName`: string (vendor only)
- `subscriptionPlan`: `"free" | "premium"` (default: `"free"`)
- `subscriptionExpiresAt`: Date | null

### 2. `menuItems`
- `vendorId`: ObjectId / string (ref: `users`)
- `itemName`: string
- `category`: `"Classic Pizzas" | "Vegetarian Pizzas" | "Meat Lovers" | "Specialty / Gourmet Pizzas" | "Sides & Appetizers" | "Beverages & Desserts"`
- `description`: string
- `price`: number
- `location`: string (city / area)
- `images`: string[] (ImgBB URLs; at least 1 required)
- `status`: `"pending" | "approved" | "rejected" | "inactive"` (default: `"pending"`)
- `createdAt`: Date

### 3. `orders`
- `itemId`: ObjectId / string (ref: `menuItems`)
- `itemName`: string
- `itemImage`: string | null
- `vendorId`: ObjectId / string (ref: `users`)
- `vendorEmail`: string
- `customerId`: ObjectId / string (ref: `users`)
- `customerName`: string
- `customerEmail`: string
- `deliveryDate`: Date / ISO string
- `deliveryAddress`: string
- `message`: string (optional special instructions)
- `status`: `"pending" | "accepted" | "rejected" | "cancelled"` (default: `"pending"`)
- `createdAt`: Date

### 4. `transactions`
- `vendorId`: ObjectId / string (ref: `users`)
- `vendorEmail`: string
- `plan`: `"premium"`
- `amount`: number
- `currency`: string
- `stripeSessionId`: string
- `stripePaymentIntentId`: string | null
- `status`: string (e.g., `"paid"`)
- `createdAt`: Date

---

## 🔒 Authentication & JWT Middleware Flow (Challenge Requirement)

1. **Token Ingestion:** Incoming requests pass JWT Bearer token in the `Authorization` header (`Authorization: Bearer <token>`).
2. **Signature Verification (`middleware/verifyJWT.js`):**
   - Decodes and validates the HS256 JWT using `BETTER_AUTH_SECRET`.
   - Rejects missing, invalid, or expired tokens with `401 Unauthorized`.
   - Derives verified `req.user` (`id`, `email`, `role`, `isBlocked`, `subscriptionPlan`).
3. **Role Enforcement (`middleware/verifyRole.js`):**
   - `verifyAdmin`: Rejects non-admin users with `403 Forbidden`.
   - `verifyVendor`: Enforces vendor ownership and blocks access if `isBlocked: true`.
   - `verifyCustomer`: Enforces customer role and blocks access if `isBlocked: true`.
4. **Security Hardening:**
   - Client identity is never trusted. All IDs and roles are derived from the verified token and MongoDB database lookups.
   - Vendors cannot order their own items.
   - Customers can only cancel their own `pending` orders.
   - Duplicate active orders for the same item and delivery date by the same customer are strictly blocked.

---

## 🍕 API Endpoints & Query Parameters (Challenge Requirement)

### Public / Customer Menu API
`GET /api/customer/menu`

```http
GET /api/customer/menu?search=margherita&category=Classic%20Pizzas&location=Brooklyn&sort=price-asc
```

| Parameter | Type | Description |
| :--- | :--- | :--- |
| `search` | string | Case-insensitive regex search in `itemName` and `description` |
| `category` | string | Filters by exact pizza category |
| `location` | string | Case-insensitive substring match on pizzeria location |
| `sort` | string | `price-asc` (Price Low-to-High), `price-desc` (Price High-to-Low), `name-asc`, `newest` |
| `sortBy` & `sortOrder` | string | `sortBy=price&sortOrder=asc` or `desc` (Alternative syntax) |

`GET /api/customer/menu/featured`
- Returns top 6 approved items, **strictly prioritizing Premium vendor items** (`isPremium: true`) first.

### Customer Order APIs
- `POST /api/customer/orders` — Place delivery order (Validates approved status, blocks self-ordering, blocks duplicate active orders).
- `GET /api/customer/orders` — List logged-in customer's orders (Newest first).
- `PATCH /api/customer/orders/:id/cancel` — Cancel own order (Strictly for `pending` orders only).
- `GET /api/customer/stats` — Real-time customer order counts.

### Vendor APIs
- `GET /api/vendor/orders` — List incoming customer orders for vendor's items (with search & status filter).
- `PATCH /api/vendor/orders/:id/status` — Accept or reject incoming orders (Vendor's own orders only, strictly once per pending order).
- `GET /api/vendor/stats` — Vendor dashboard statistics and accepted revenue.
- `POST /api/menu` — Add menu item (Enforces Free limit: max 3 active items, Premium: unlimited).
- `GET /api/menu/my-items` — List vendor's own menu items.
- `PATCH /api/menu/:id` — Update menu item.
- `DELETE /api/menu/:id` — Delete menu item.

### Admin APIs
- `GET /api/admin/stats` — Platform-wide statistics.
- `GET /api/admin/users` — List all users (with search and role filter).
- `PATCH /api/admin/users/:id/block` — Block or unblock a user.
- `GET /api/admin/menu-items` — Moderation list of all menu items.
- `PATCH /api/admin/menu-items/:id/status` — Approve or reject menu items.
- `DELETE /api/admin/menu-items/:id` — Delete inappropriate menu items.
- `GET /api/admin/transactions` — **Read-only** ledger of verified Stripe subscription transactions.

---

## 💳 Stripe Checkout & Webhook Integration

Stripe is used **exclusively for Vendor Free → Premium upgrades**.

1. Vendor clicks `Upgrade to Premium` → Next.js generates Stripe Checkout Session.
2. Webhook Route (`POST /api/webhook`):
   - Uses `express.raw({ type: "application/json" })` for cryptographic signature verification.
   - Verifies Stripe signature with `stripe.webhooks.constructEvent(rawBody, sig, endpointSecret)`.
   - On `checkout.session.completed`: Upgrades vendor in MongoDB (`subscriptionPlan: "premium"`) and writes verified transaction record to `transactions` collection.
   - Frontend routes never mutate subscription status directly.

---

## ⚙️ Environment Variables (`.env`)

```env
PORT=5000
CLIENT_URL=http://localhost:3000

# MongoDB URI
MONGODB_URI=mongodb+srv://<username>:<password>@cluster0.mongodb.net/pizzahubdb?retryWrites=true&w=majority

# Better Auth Secret (Shared with Client for JWT Verification)
BETTER_AUTH_SECRET=your_super_secret_jwt_key

# Stripe Secret & Webhook Secret
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
```

---

## 🚀 Local Run Instructions

```bash
# 1. Install dependencies
npm install

# 2. Start API server in dev mode
npm run dev

# 3. Start API server in production mode
npm start
```

Server runs on [http://localhost:5000](http://localhost:5000).
