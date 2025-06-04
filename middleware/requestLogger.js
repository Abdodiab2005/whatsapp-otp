// middleware/requestLogger.js
const logger = require("../config/logger").child({ service: "RequestLogger" })

/**
 * Middleware to log request and response details
 */
function requestLogger(req, res, next) {
  // Generate a unique request ID
  const requestId = Math.random().toString(36).substring(2, 15)
  req.requestId = requestId

  // Log request details
  const startTime = Date.now()
  const requestLog = {
    id: requestId,
    method: req.method,
    url: req.originalUrl || req.url,
    ip: req.ip || req.connection.remoteAddress,
    userAgent: req.get("User-Agent"),
    timestamp: new Date().toISOString(),
  }

  logger.info(`Request: ${requestLog.method} ${requestLog.url}`, requestLog)

  // Capture response details
  const originalEnd = res.end

  res.end = function (chunk, encoding) {
    // Restore original end function
    res.end = originalEnd

    // Calculate response time
    const responseTime = Date.now() - startTime
    const responseLog = {
      id: requestId,
      statusCode: res.statusCode,
      responseTime: `${responseTime}ms`,
      timestamp: new Date().toISOString(),
    }

    // Log response details
    try {
      if (res.statusCode >= 400) {
        logger.warn(`Response: ${res.statusCode} ${req.method} ${req.url} (${responseTime}ms)`, responseLog)
      } else {
        logger.info(`Response: ${res.statusCode} ${req.method} ${req.url} (${responseTime}ms)`, responseLog)
      }

      // Call the original end function
      return originalEnd.call(this, chunk, encoding)
    } catch (error) {
      // If there's an error (like EPIPE), log it but don't crash
      logger.error(`Error logging response for ${req.method} ${req.url}: ${error.message}`, {
        error: error.message,
        code: error.code,
        stack: error.stack,
      })

      // Try to call the original end function, but catch any errors
      try {
        return originalEnd.call(this, chunk, encoding)
      } catch (endError) {
        // If we can't even call the original end, just log it
        logger.error(`Failed to call original res.end: ${endError.message}`)
        return this
      }
    }
  }

  next()
}

module.exports = requestLogger
