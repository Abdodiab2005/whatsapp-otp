// worker.js
const path = require("path");
// require("dotenv").config({ path: path.resolve(__dirname, "config/.env") });
const fs = require("fs").promises;

const mainLogger = require("./config/logger");
const logger = mainLogger.child({ service: "Worker" }); // <--- عملنا child logger

// مسارات ملفات الإشارة (ستظل كما هي مبدئياً)
const REINITIALIZE_SIGNAL_FILE_WORKER = path.resolve(
  __dirname,
  "signals/REINITIALIZE_WHATSAPP.signal"
);
const LOGOUT_SESSION_SIGNAL_FILE_WORKER = path.resolve(
  __dirname,
  "signals/LOGOUT_WHATSAPP_SESSION.signal"
);

const { initializeDB, getDB } = require("./database/dbManager");
const queueService = require("./services/queueService");
// --- استيراد الدوال من Baileys Service الجديد ---
const {
  initializeWhatsAppClient, // لتهيئة/إعادة تهيئة Baileys client
  sendWhatsAppMessage, // لإرسال الرسائل عبر Baileys
  isClientSvcReady, // لمعرفة حالة جاهزية Baileys client
  clearBaileysSessionAndRestart, // لمسح الـ session وطلب QR/Pairing جديد
  // getCurrentQrForAdmin,      // (سنحتاجها لاحقاً في admin routes إذا الـ QR يُمرر عبر DB/Redis)
  // updateServiceStatus,       // (الـ service هو من يحدث حالته في DB الآن)
} = require("./services/whatsappService");

// إعدادات الـ Worker (يمكن تعديلها من .env)
const POLLING_INTERVAL_MS =
  parseInt(process.env.WORKER_POLLING_INTERVAL_MS) || 5000;
const WHATSAPP_READY_CHECK_INTERVAL_MS =
  parseInt(process.env.WORKER_WHATSAPP_CHECK_INTERVAL_MS) || 10000;
const MIN_DELAY_MS = parseInt(process.env.WORKER_MIN_SEND_DELAY_MS) || 5000;
const MAX_DELAY_MS = parseInt(process.env.WORKER_MAX_SEND_DELAY_MS) || 20000;

let workerIntervalId = null; // لحفظ الـ ID بتاع setInterval عشان نقدر نوقفه لو لزم

let isWorkerRunning = true;

/**
 * يعالج مهمة OTP واحدة من الطابور (تأخير عشوائي ثم إرسال).
 * @param {object} job - بيانات المهمة من قاعدة البيانات.
 * @returns {Promise<boolean>} - true إذا تمت المعالجة بنجاح، false إذا فشلت.
 */
async function processJob(job) {
  if (!job) {
    return false;
  }

  logger.info(
    `Worker: Processing Job ID: ${job.id}, Phone: ${job.phone_number}, Attempt from DB: ${job.attempts}`
  );
  try {
    const randomDelay =
      Math.floor(Math.random() * (MAX_DELAY_MS - MIN_DELAY_MS + 1)) +
      MIN_DELAY_MS;
    logger.info(
      `Worker: Job ID ${job.id} - Delaying for ${randomDelay / 1000} seconds...`
    );
    await new Promise((resolve) => setTimeout(resolve, randomDelay));

    logger.info(
      `Worker: Job ID ${job.id} - Attempting to send WhatsApp message via Baileys Service...`
    );
    await sendWhatsAppMessage(job.phone_number, job.message_body); // استخدام دالة الإرسال الجديدة

    await queueService.updateJobStatus(job.id, "sent");
    logger.info(
      `Worker: Job ID ${job.id} - Successfully sent and status updated to 'sent'.`
    );
    return true;
  } catch (error) {
    logger.error(
      `Worker: Job ID ${job.id} - Error processing job:`,
      error.message
    );
    await queueService.updateJobStatus(
      job.id,
      "failed",
      error.message || "Unknown error during Baileys send"
    );
    logger.info(`Worker: Job ID ${job.id} - Status updated to 'failed'.`);
    return false;
  }
}

// لا حاجة لدالة clearWhatsAppSessionFilesForWorker() هنا، لأن clearBaileysSessionAndRestart في الـ service تقوم بذلك.

/**
 * الـ Loop الرئيسي للـ Worker: يتحقق من الإشارات، جاهزية الواتساب، ويسحب ويعالج المهام.
 */
async function workerLoop() {
  if (!isWorkerRunning) {
    logger.info("Worker: Stopping loop.");
    return;
  }

  // logger.info(`DEBUG_WORKER_LOOP: Top of loop at ${new Date().toLocaleTimeString()}.`); // للـ debugging لو احتجت

  try {
    // --- 1. التحقق من إشارة "تسجيل الخروج ومسح السيشن" (الأولوية القصوى) ---
    try {
      await fs.access(LOGOUT_SESSION_SIGNAL_FILE_WORKER); // يفحص إذا كان الملف موجود
      logger.info(`WORKER: LOGOUT session signal file found! Processing...`);
      await fs.unlink(LOGOUT_SESSION_SIGNAL_FILE_WORKER); // يحذف الملف بعد قراءته

      await clearBaileysSessionAndRestart(); // دالة من whatsappService.js (تفترض أنها تقوم بالـ logout, destroy, clear files, then init)

      logger.info(
        "WORKER: Logout and re-init process initiated via service. Waiting for new QR/connection."
      );
      setTimeout(workerLoop, WHATSAPP_READY_CHECK_INTERVAL_MS); // يعطي فرصة للتهيئة الجديدة
      return; // يخرج من هذه الدورة ليبدأ التهيئة الجديدة
    } catch (signalError) {
      if (signalError.code !== "ENOENT") {
        // ENOENT = ملف غير موجود (وهذا طبيعي معظم الوقت)
        logger.error(
          "WORKER: Error checking for LOGOUT signal file:",
          signalError
        );
      }
    }

    // --- 2. التحقق من إشارة "إعادة التهيئة/تحميل السيشن" ---
    try {
      await fs.access(REINITIALIZE_SIGNAL_FILE_WORKER);
      logger.info(
        `WORKER: REINITIALIZE session signal file found! Processing...`
      );
      await fs.unlink(REINITIALIZE_SIGNAL_FILE_WORKER);

      logger.info(
        "WORKER: Calling initializeWhatsAppClient (for re-init/reload) from service..."
      );
      await initializeWhatsAppClient(); // دالة من whatsappService.js (ستستخدم السيشن الموجودة إن أمكن)

      logger.info(
        "WORKER: Re-initialization process initiated via service. Waiting for connection."
      );
      setTimeout(workerLoop, WHATSAPP_READY_CHECK_INTERVAL_MS); // يعطي فرصة للتهيئة
      return;
    } catch (signalError) {
      if (signalError.code !== "ENOENT") {
        logger.error(
          "WORKER: Error checking for REINITIALIZE signal file:",
          signalError
        );
      }
    }

    // --- 3. التحقق من جاهزية خدمة الواتساب (إذا لم يتم التعامل مع إشارة) ---
    if (!isClientSvcReady()) {
      logger.info(
        "Worker: WhatsApp client (via service) is not ready. Waiting..."
      );
      // initializeWhatsAppClient() في whatsappService.js لديها نظام retry خاص بها.
      // الـ Worker ينتظر هنا حتى يصبح الـ service جاهزاً.
      setTimeout(workerLoop, WHATSAPP_READY_CHECK_INTERVAL_MS);
      return;
    }

    // --- 4. إذا كان كل شيء تمام والخدمة جاهزة، اسحب وعالج المهام ---
    // logger.info("Worker: WhatsApp client is ready. Checking for jobs..."); // للـ debugging
    const job = await queueService.fetchNextJob();

    if (job) {
      const processedSuccessfully = await processJob(job);
      // استدعاء فوري للـ loop لمعالجة المهمة التالية إذا نجحت المعالجة،
      // أو انتظر قليلاً إذا فشلت أو لم تتم المعالجة (مثلاً بسبب فصل الواتساب أثناء processJob)
      setTimeout(workerLoop, processedSuccessfully ? 0 : POLLING_INTERVAL_MS);
    } else {
      // لا توجد مهام، انتظر الفترة المحددة
      // logger.info("Worker: No jobs in queue. Waiting..."); // للـ debugging
      setTimeout(workerLoop, POLLING_INTERVAL_MS);
    }
  } catch (error) {
    logger.error("Worker: Unhandled error in workerLoop:", error);
    // انتظر فترة أطول قليلاً في حالة حدوث خطأ غير متوقع في اللوب الرئيسي لتجنب استهلاك الموارد
    setTimeout(workerLoop, POLLING_INTERVAL_MS * 2); // زيادة مدة الانتظار عند الخطأ
  }
}

/**
 * دالة بدء تشغيل الـ Worker: تهيئة الداتابيز وخدمة الواتساب ثم بدء الـ Loop.
 */
async function startWorker() {
  logger.info("Worker: Starting with Baileys service...");
  isWorkerRunning = true;
  try {
    await initializeDB();
    logger.info("Worker: Database initialized.");

    // تهيئة Baileys client من خلال whatsappService
    // نظام إعادة المحاولة مدمج داخل initializeWhatsAppClient في الـ service
    await initializeWhatsAppClient();
    logger.info(
      "Worker: Baileys client initialization process (via service) started."
    );

    workerLoop();
  } catch (error) {
    logger.error("Worker: Critical error during startup:", error);
    process.exit(1);
  }
}

/**
 * الـ Loop الرئيسي للـ Worker: يتحقق من الإشارات، جاهزية الواتساب، ويسحب ويعالج المهام.
 */
async function performWorkerCycle() {
  // logger.debug('Worker Cycle: Starting new cycle...'); // للـ debugging لو احتجت

  // ملفات الإشارة لم نعد بحاجة لها بنفس الطريقة إذا الـ admin routes هتنادي دوال الـ service مباشرة
  // لكن لو لسه عايزها، ممكن الـ app.js هو اللي يكتبها والـ worker يقرأها، أو نستخدم طريقة تانية للتواصل الداخلي

  try {
    if (!isClientSvcReady()) {
      logger.info(
        "Worker Cycle: WhatsApp client (via service) is not ready. Waiting or service is retrying..."
      );
      // initializeWhatsAppClient لديها نظام retry داخلي.
      // الـ Worker هنا سينتظر حتى يصبح الـ service جاهزاً.
      // لا نستدعي initializeWhatsAppClient من هنا بشكل متكرر، هي تُستدعى مرة عند بدء الـ worker.
      return; // اخرج من الدورة دي، setInterval هتشتغل تاني
    }

    const job = await queueService.fetchNextJob();
    if (job) {
      logger.info(`Worker Cycle: Fetched Job ID: ${job.id}. Processing...`);
      await processJob(job);
    } else {
      // logger.debug("Worker Cycle: No jobs in queue.");
    }
  } catch (error) {
    logger.error("Worker Cycle: Unhandled error in performWorkerCycle:", error);
  }
}

/**
 * دالة بدء تشغيل الـ Worker (ستُستدعى من app.js).
 */
async function runWorker() {
  logger.info("Integrated Worker: runWorker function CALLED.");
  try {
    logger.info("Integrated Worker: --- BEFORE initializeDB ---");
    await initializeDB();
    logger.info(
      "Integrated Worker: --- AFTER initializeDB. Database checked/initialized."
    );

    logger.info("Integrated Worker: --- BEFORE initializeWhatsAppClient ---");
    await initializeWhatsAppClient(); // يتم تهيئة الـ client المركزي في whatsappService
    logger.info(
      "Integrated Worker: --- AFTER initializeWhatsAppClient. WhatsApp client initialization process (via service) started/completed."
    );

    logger.info(
      "Integrated Worker: --- BEFORE starting workerLoop interval ---"
    );
    if (workerIntervalId) clearInterval(workerIntervalId);
    workerIntervalId = setInterval(performWorkerCycle, POLLING_INTERVAL_MS);
    logger.info(
      `Integrated Worker: Worker cycle started with interval: ${POLLING_INTERVAL_MS}ms.`
    );
    logger.info(
      "Integrated Worker: runWorker function COMPLETED SUCCESSFULLY."
    ); // <--- هل بتوصل هنا؟
  } catch (error) {
    logger.error(
      "Integrated Worker: CRITICAL error during runWorker startup:",
      error
    );
    // لا نعمل process.exit(1) هنا لأننا جزء من app.js
    // نرمي الخطأ عشان الـ catch في app.js يمسكه
    throw error;
  }
}
function stopWorker() {
  if (workerIntervalId) {
    clearInterval(workerIntervalId);
    workerIntervalId = null;
    logger.info("Integrated Worker: Worker cycle stopped.");
  }
}

module.exports = { runWorker, stopWorker };
