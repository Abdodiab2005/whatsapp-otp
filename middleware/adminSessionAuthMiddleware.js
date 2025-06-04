// middleware/adminSessionAuthMiddleware.js
const logger = require("../config/logger").child({
  service: "AdminAuthMiddleware",
});

/**
 * Middleware to check if the admin is logged in via session
 */
function adminSessionAuth(req, res, next) {
  logger.debug(`Checking admin session auth for path: ${req.path}`);

  // Check if the session exists and the admin is logged in
  if (req.session && req.session.isAdminLoggedIn === true) {
    logger.debug(`Admin authenticated: ${req.session.adminUsername}`);
    return next(); // Allow access to the route
  }

  // If this is an AJAX request, return a 401 status
  if (
    req.xhr ||
    (req.headers.accept && req.headers.accept.includes("application/json"))
  ) {
    logger.warn(`Unauthenticated AJAX request to ${req.path}`);
    return res.status(401).json({
      success: false,
      message: "Authentication required",
      redirectTo: "/admin/login",
    });
  }

  // For regular requests, redirect to login
  logger.warn(
    `Unauthenticated access attempt to ${req.path}, redirecting to login`
  );

  // Store the original URL they were trying to access
  req.session.redirectTo = req.originalUrl;

  // Make sure the session is saved before redirecting
  req.session.save((err) => {
    if (err) {
      logger.error("Error saving session before redirect:", err);
    }
    return res.redirect("/admin/login");
  });
}

module.exports = adminSessionAuth;
