const express = require("express")
const path = require("path")
const { initializeDB, getDB } = require("./database/dbManager")
const adminRoutes = require("./routes/adminRoutes")
const logger = require("./config/logger")
const bodyParser = require("body-parser")
const cookieParser = require("cookie-parser")
const helmet = require("helmet")
const http = require("http")
const fs = require("fs")

// Try to require the requestLogger, but don't fail if it doesn't exist
let requestLogger
try {
  requestLogger = require("./middleware/requestLogger")
} catch (error) {
  logger.warn("requestLogger middleware not found, continuing without it")
}

require("dotenv").config({ path: path.resolve(__dirname, "config/.env") })

// Global error handlers
process.on("unhandledRejection", (reason, promise) => {
  logger.error("!!!!!!!!!! UNHANDLED REJECTION !!!!!!!!!", { reason, promise })
})

process.on("uncaughtException", (error) => {
  logger.error("!!!!!!!!!! UNCAUGHT EXCEPTION !!!!!!!!!", error)
  // For uncaught exceptions, it's usually best to exit after logging
  process.exit(1)
})

// Import worker functions
const { runWorker, stopWorker } = require("./worker")

const app = express()
const PORT = process.env.PORT || 3001

// Security headers (configured for non-SSL/HTTP environment)
app.use(
  helmet({
    contentSecurityPolicy: false, // Disable CSP
    hsts: false, // Disable HSTS since no SSL
    crossOriginOpenerPolicy: false, // Disable COOP to avoid HTTPS warnings
    originAgentCluster: false, // Disable Origin-Agent-Cluster to avoid warnings
    crossOriginEmbedderPolicy: false, // Disable COEP
  }),
)

// Trust proxy for potential future SSL termination
app.set("trust proxy", 1)

// Body parsing middleware with increased limits
app.use(bodyParser.json({ limit: "1mb" }))
app.use(bodyParser.urlencoded({ extended: true, limit: "1mb" }))
app.use(cookieParser())

// Request logging middleware
app.use((req, res, next) => {
  logger.debug(`Request: ${req.method} ${req.path}`)
  logger.debug(`Protocol: ${req.protocol}`)
  logger.debug(`Secure: ${req.secure}`)
  logger.debug(`X-Forwarded-Proto: ${req.get("X-Forwarded-Proto")}`)
  logger.debug(`Cookies: ${JSON.stringify(req.cookies)}`)
  next()
})

// Additional request logging middleware if available
if (typeof requestLogger === "function") {
  app.use(requestLogger)
}

// Set up view engine
app.set("view engine", "ejs")
app.set("views", path.join(__dirname, "views"))

// Health check endpoint
app.get("/", (req, res) => {
  res.status(200).json({
    message: "OTP WhatsApp Sender API (Job Producer) is up and running!",
    status: "success",
    timestamp: new Date().toISOString(),
  })
})

// Routes
const otpRoutes = require("./routes/otpRoutes")
let monitoringRoutes
try {
  monitoringRoutes = require("./routes/monitoringRoutes")
} catch (error) {
  logger.warn("monitoringRoutes not found, continuing without it")
}

app.use("/api/v1/otp", otpRoutes)
if (monitoringRoutes) {
  app.use("/monitoring", monitoringRoutes)
}
app.use("/admin", adminRoutes)

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    error: "Not Found",
    message: `Cannot ${req.method} ${req.path}`,
  })
})

// Global error handler
app.use((err, req, res, next) => {
  logger.error(`Global Error Handler caught an error for path: ${req.originalUrl}`, err)

  if (res.headersSent) {
    return next(err)
  }

  res.status(err.status || 500).json({
    message: err.message || "An unexpected error occurred in the API.",
    error: process.env.NODE_ENV === "development" ? err.stack : undefined,
  })
})

// Create HTTP server with proper configuration
const server = http.createServer(app)

// Configure server timeouts
server.timeout = 60000 // 60 seconds
server.keepAliveTimeout = 65000 // Slightly higher than timeout
server.headersTimeout = 66000 // Slightly higher than keepAliveTimeout

// Add request timeout handling at the server level
server.on("request", (req, res) => {
  // Set a timeout for each request
  req.setTimeout(30000) // 30 seconds

  // Handle timeout
  req.on("timeout", () => {
    logger.error(`Request timeout: ${req.method} ${req.url}`)
    if (!res.headersSent) {
      try {
        res.writeHead(503, { "Content-Type": "application/json" })
        res.end(JSON.stringify({ error: "Service Unavailable - Request Timeout" }))
      } catch (error) {
        logger.error(`Error sending timeout response: ${error.message}`)
      }
    }
    try {
      req.destroy()
    } catch (error) {
      logger.error(`Error destroying request: ${error.message}`)
    }
  })
})

// Handle server errors
server.on("error", (error) => {
  logger.error("Server error:", error)
})

// Handle client errors (broken pipe, etc.)
server.on("clientError", (err, socket) => {
  logger.error("Client error:", err)
  if (err.code === "ECONNRESET" || !socket.writable) {
    return
  }
  try {
    socket.end("HTTP/1.1 400 Bad Request\r\n\r\n")
  } catch (error) {
    logger.error(`Error sending error response to client: ${error.message}`)
  }
})

// Start server function
async function startAppServer() {
  try {
    // Initialize database first
    await initializeDB()
    logger.info("App.js: Database initialized successfully.")

    // Start listening
    server.listen(PORT, () => {
      logger.info(`App.js (API Server) is listening on http://localhost:${PORT}`)
      logger.info("App.js is ready to accept API requests.")

      // Start the worker after server is ready
      logger.info("App.js: Attempting to start the integrated worker...")
      if (typeof runWorker === "function") {
        runWorker()
          .then(() => {
            logger.info("App.js: Integrated worker started successfully.")
          })
          .catch((err) => {
            logger.error("App.js: Error starting worker:", err)
          })
      } else {
        logger.error("App.js: runWorker is not a function!")
      }
    })
  } catch (error) {
    logger.error("App.js: Critical error during startup:", error)
    process.exit(1)
  }
}

// Graceful shutdown function
async function gracefulShutdownApp(signal) {
  logger.info(`\n${signal} signal received. Starting graceful shutdown...`)

  // Stop accepting new connections
  server.close(() => {
    logger.info("App.js: HTTP server closed.")
  })

  // Stop the worker
  if (typeof stopWorker === "function") {
    try {
      stopWorker()
      logger.info("App.js: Worker stopped.")
    } catch (err) {
      logger.error("App.js: Error stopping worker:", err)
    }
  }

  // Close database connection
  try {
    const db = getDB()
    if (db) {
      await new Promise((resolve, reject) => {
        db.close((err) => {
          if (err) {
            logger.error("App.js: Error closing database:", err)
            reject(err)
          } else {
            logger.info("App.js: Database connection closed.")
            resolve()
          }
        })
      })
    }
  } catch (dbError) {
    logger.error("App.js: Error during database closure:", dbError)
  }

  // Force exit after timeout
  setTimeout(() => {
    logger.error("App.js: Forced shutdown after timeout.")
    process.exit(1)
  }, 10000) // 10 seconds

  logger.info("App.js: Graceful shutdown complete.")
  process.exit(0)
}

// Handle shutdown signals
process.on("SIGINT", () => gracefulShutdownApp("SIGINT"))
process.on("SIGTERM", () => gracefulShutdownApp("SIGTERM"))

// Start the server
startAppServer()

module.exports = { app, server }
