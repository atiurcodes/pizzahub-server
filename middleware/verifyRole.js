export function verifyRole(...allowedRoles) {
  return (req, res, next) => {
    if (!allowedRoles.includes(req.user?.role)) {
      return res.status(403).json({ message: "Forbidden access" })
    }
    next()
  }
}

export const verifyAdmin = verifyRole("admin")
export const verifyVendor = verifyRole("vendor")
export const verifyCustomer = verifyRole("customer")
