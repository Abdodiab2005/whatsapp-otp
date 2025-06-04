// routes/adminPageRoutes.js
const express = require("express")
const router = express.Router()
const { generateToken, verifyToken } = require("../middleware/jwtAuthMiddleware")
const { getDB } = require("../database/dbManager")
const adminController = require("../controllers/adminController")
const logger = require("../config/logger").child({ service: "AdminRoutes" })

// استدعاء whatsappService لاستخدام دواله مباشرة
const waService = require("../services/whatsappService")

const rateLimit = require("express-rate-limit")
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // Limit each IP to 5 login requests per windowMs
  message: {
    message: "Too many login attempts from this IP, please try again after 15 minutes.",
  },
  standardHeaders: true,
  legacyHeaders: false,
})

// Route لعرض فورم تسجيل الدخول
router.get("/login", (req, res) => {
  // Check if already authenticated via cookie
  if (req.cookies && req.cookies.adminToken) {
    return res.redirect("/admin/status")
  }

  res.render("login", {
    error: null,
    pageTitle: "Admin Login",
  })
})

// Route لمعالجة بيانات تسجيل الدخول
router.post("/login", loginLimiter, (req, res) => {
  const ADMIN_USERNAME = process.env.ADMIN_USERNAME || "admin"
  const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "password"
  const { username, password } = req.body

  logger.info(`Admin login attempt: User "${username}"`)

  // Check if request expects JSON response (AJAX request)
  const isAjaxRequest = req.headers.accept && req.headers.accept.includes("application/json")

  if (username === ADMIN_USERNAME && password === ADMIN_PASSWORD) {
    // Generate JWT token
    const token = generateToken(username)

    logger.info(`Admin user "${username}" logged in successfully. Token generated.`)

    // Set cookie for browser-based navigation
    res.cookie("adminToken", token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
      maxAge: 24 * 60 * 60 * 1000, // 24 hours
    })

    if (isAjaxRequest) {
      return res.status(200).json({
        success: true,
        token: token,
        redirectTo: "/admin/status",
      })
    } else {
      return res.redirect("/admin/status")
    }
  } else {
    logger.warn(`Admin login failed for user "${username}".`)

    if (isAjaxRequest) {
      return res.status(401).json({
        success: false,
        message: "Invalid username or password",
      })
    } else {
      return res.render("login", {
        error: "Invalid username or password.",
        pageTitle: "Admin Login",
      })
    }
  }
})

// Route لعرض الهيكل الأساسي لصفحة الأدمن
router.get("/status", verifyToken, (req, res) => {
  logger.info(`ADMIN_ROUTES: Rendering base admin page shell for /admin/status by user: ${req.user.username}`)

  res.render("admin_status", {
    pageTitle: "Admin Dashboard",
    adminUser: req.user.username,
    adminFlashMessage: null,
  })
})

// API Endpoint لجلب بيانات حالة الواتساب والإحصائيات
router.get("/api/status-and-stats", verifyToken, async (req, res, next) => {
  logger.debug("ADMIN_ROUTES: API request for /admin/api/status-and-stats received.")
  try {
    const db = getDB()
    const whatsappStatusPromise = new Promise((resolve, reject) => {
      db.get(
        "SELECT status, details, last_updated FROM service_status WHERE service_key = ?",
        ["baileys_connection"],
        (err, row) => {
          if (err) {
            logger.error("DB Error fetching whatsapp status for API:", err)
            return reject(err)
          }
          resolve(row)
        },
      )
    })

    const jobStatsPromise = new Promise((resolve, reject) => {
      const stats = {
        pending: 0,
        sent: 0,
        failed: 0,
        processing: 0,
        unknown: 0,
      }
      db.each(
        "SELECT status, COUNT(*) as count FROM jobs GROUP BY status",
        [],
        (err, row) => {
          if (err) {
            logger.error("DB Error iterating job stats for API:", err)
            return
          }
          if (row && row.status) {
            const statusKey = row.status.toLowerCase().replace(/[\s:]/g, "_")
            if (typeof stats[statusKey] !== "undefined") {
              stats[statusKey] = row.count
            } else {
              stats.unknown += row.count
            }
          }
        },
        (err, totalRows) => {
          if (err) logger.error("DB Error completing job stats query for API:", err)
          resolve(stats)
        },
      )
    })

    const [whatsappStatusRow, jobStats] = await Promise.all([whatsappStatusPromise, jobStatsPromise])

    res.json({
      whatsappStatus: whatsappStatusRow ? whatsappStatusRow.status : "N/A",
      statusDetails: whatsappStatusRow ? whatsappStatusRow.details || "No details" : "N/A",
      lastUpdated: whatsappStatusRow ? new Date(whatsappStatusRow.last_updated).toISOString() : "N/A",
      stats: jobStats || {
        pending: 0,
        sent: 0,
        failed: 0,
        processing: 0,
        unknown: 0,
      },
    })
  } catch (error) {
    logger.error("ADMIN_ROUTES: /api/status-and-stats - Error in API handler:", error)
    if (!res.headersSent) {
      res.status(500).json({
        error: "Failed to fetch admin status and stats data.",
        details: error.message,
      })
    } else {
      next(error)
    }
  }
})

// API Endpoint لجلب بيانات المهام مع الـ Pagination والفلترة والبحث
router.get("/api/jobs", verifyToken, async (req, res, next) => {
  logger.debug(`ADMIN_ROUTES: API request for /admin/api/jobs received. Query: ${JSON.stringify(req.query)}`)
  try {
    const db = getDB()
    const currentPage = Number.parseInt(req.query.page) || 1
    const jobsPerPage = Number.parseInt(req.query.limit) || 10
    const offset = (currentPage - 1) * jobsPerPage

    const filterStatus = req.query.filterStatus || null
    const searchQuery = req.query.searchQuery || null

    const conditions = []
    const queryParams = []

    if (filterStatus && filterStatus !== "all") {
      conditions.push("status = ?")
      queryParams.push(filterStatus)
    }

    if (searchQuery) {
      const searchLike = `%${searchQuery}%`
      conditions.push("(phone_number LIKE ? OR otp LIKE ? OR message_body LIKE ? OR error_message LIKE ?)")
      for (let i = 0; i < 4; i++) queryParams.push(searchLike)
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : ""

    const baseQuery = `FROM jobs ${whereClause}`
    const countQuery = `SELECT COUNT(*) as count ${baseQuery}`

    const paginatedJobsPromise = new Promise((resolve, reject) => {
      const sql = `SELECT id, phone_number, otp, status, created_at, processed_at, error_message, attempts, otp_expires_at 
                   ${baseQuery} 
                   ORDER BY created_at DESC 
                   LIMIT ? OFFSET ?`
      db.all(sql, [...queryParams, jobsPerPage, offset], (err, jobs) => {
        if (err) {
          logger.error("DB Error fetching paginated jobs for API:", err)
          return reject(err)
        }
        resolve(jobs)
      })
    })

    const totalJobsCountPromise = new Promise((resolve, reject) => {
      db.get(countQuery, queryParams, (err, row) => {
        if (err) {
          logger.error("DB Error fetching total jobs count for API:", err)
          return reject(err)
        }
        resolve(row ? row.count : 0)
      })
    })

    const [paginatedJobs, totalJobs] = await Promise.all([paginatedJobsPromise, totalJobsCountPromise])

    const totalPages = Math.ceil(totalJobs / jobsPerPage)

    res.json({
      jobs: paginatedJobs || [],
      pagination: {
        currentPage: currentPage,
        totalPages: totalPages > 0 ? totalPages : 1,
        limit: jobsPerPage,
        totalJobs: totalJobs,
      },
    })
  } catch (error) {
    logger.error("ADMIN_ROUTES: /api/jobs - Error in API handler:", error)
    if (!res.headersSent) {
      res.status(500).json({ error: "Failed to fetch jobs data.", details: error.message })
    } else {
      next(error)
    }
  }
})

// Route لإعادة محاولة مهمة فاشلة
router.post("/jobs/retry/:jobId", verifyToken, async (req, res) => {
  const jobId = Number.parseInt(req.params.jobId, 10)

  if (isNaN(jobId)) {
    return res.status(400).json({ success: false, message: "Invalid Job ID." })
  }

  try {
    await adminController.retryJob(req, res)
  } catch (error) {
    logger.error(`Error retrying job ${jobId}:`, error)
    return res.status(500).json({ success: false, message: "Failed to retry job." })
  }
})

// Route لطلب إعادة تهيئة/تحميل الـ Session الحالية للواتساب
router.post("/whatsapp/reinitialize", verifyToken, async (req, res) => {
  logger.info(`ADMIN_ROUTES: User "${req.user.username}" requested REINITIALIZE WhatsApp session.`)

  const isAjaxRequest = req.headers.accept && req.headers.accept.includes("application/json")

  try {
    await waService.initializeWhatsAppClient()
    logger.info("ADMIN_ROUTES: WhatsApp client re-initialization process triggered successfully by admin.")

    const message = "WhatsApp re-initialization triggered. Monitor status."

    if (isAjaxRequest) {
      return res.status(200).json({
        success: true,
        message: message,
      })
    } else {
      return res.redirect("/admin/status")
    }
  } catch (error) {
    logger.error("ADMIN_ROUTES: Error triggering WhatsApp re-initialization:", error)

    const message = "Failed to trigger re-initialization."

    if (isAjaxRequest) {
      return res.status(500).json({
        success: false,
        message: message,
      })
    } else {
      return res.redirect("/admin/status")
    }
  }
})

// Route لطلب تسجيل الخروج من جلسة الواتساب ومسحها وطلب QR جديد
router.post("/whatsapp/logout-session", verifyToken, async (req, res) => {
  logger.info(`ADMIN_ROUTES: User "${req.user.username}" requested LOGOUT WhatsApp session.`)

  const isAjaxRequest = req.headers.accept && req.headers.accept.includes("application/json")

  try {
    await waService.clearBaileysSessionAndRestart(true)
    logger.info(
      "ADMIN_ROUTES: WhatsApp client logout, session clear, and re-initialization process triggered by admin.",
    )

    const message = "WhatsApp logout and re-scan process initiated. Check page/logs for QR."

    if (isAjaxRequest) {
      return res.status(200).json({
        success: true,
        message: message,
      })
    } else {
      return res.redirect("/admin/status")
    }
  } catch (error) {
    logger.error("ADMIN_ROUTES: Error triggering WhatsApp logout and session clear:", error)

    const message = "Failed to trigger logout process."

    if (isAjaxRequest) {
      return res.status(500).json({
        success: false,
        message: message,
      })
    } else {
      return res.redirect("/admin/status")
    }
  }
})

// Route لتسجيل الخروج من لوحة الأدمن
router.get("/logout", (req, res) => {
  const adminUsername = req.user ? req.user.username : "Admin"
  logger.info(`Admin user "${adminUsername}" logging out.`)

  // Clear the JWT cookie
  res.clearCookie("adminToken")
  res.redirect("/admin/login")
})

module.exports = router
