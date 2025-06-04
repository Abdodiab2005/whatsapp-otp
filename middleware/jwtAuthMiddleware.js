// middleware/jwtAuthMiddleware.js
const jwt = require("jsonwebtoken")
const logger = require("../config/logger").child({ service: "JWTAuthMiddleware" })

const JWT_SECRET = process.env.JWT_SECRET || "your-super-secret-jwt-key-change-this-in-production"
const JWT_EXPIRY = process.env.JWT_EXPIRY || "24h"

/**
 * Generates a JWT token for the admin user
 */
function generateToken(username) {
  return jwt.sign(
    {
      username: username,
      isAdmin: true,
      timestamp: Date.now(),
    },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRY },
  )
}

/**
 * Middleware to verify JWT token
 */
function verifyToken(req, res, next) {
  logger.debug(`Checking JWT auth for path: ${req.path}`)

  // Get token from various sources
  let token = null

  // 1. Check Authorization header
  const authHeader = req.headers.authorization
  if (authHeader && authHeader.startsWith("Bearer ")) {
    token = authHeader.substring(7)
  }

  // 2. Check cookie (for non-AJAX requests)
  if (!token && req.cookies && req.cookies.adminToken) {
    token = req.cookies.adminToken
  }

  // 3. Check query parameter (for special cases)
  if (!token && req.query.token) {
    token = req.query.token
  }

  if (!token) {
    logger.warn(`No token provided for ${req.path}`)

    // If this is an AJAX request, return 401
    if (req.xhr || (req.headers.accept && req.headers.accept.includes("application/json"))) {
      return res.status(401).json({
        success: false,
        message: "Authentication required",
        redirectTo: "/admin/login",
      })
    }

    // For regular requests, redirect to login
    return res.redirect("/admin/login")
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET)
    req.user = decoded
    logger.debug(`Token verified for user: ${decoded.username}`)
    next()
  } catch (error) {
    logger.error("JWT verification error:", error)

    if (req.xhr || (req.headers.accept && req.headers.accept.includes("application/json"))) {
      return res.status(401).json({
        success: false,
        message: "Invalid or expired token",
        redirectTo: "/admin/login",
      })
    }

    // Clear the invalid token cookie
    res.clearCookie("adminToken")
    return res.redirect("/admin/login")
  }
}

module.exports = {
  generateToken,
  verifyToken,
  JWT_SECRET,
  JWT_EXPIRY,
}
