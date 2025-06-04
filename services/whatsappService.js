// services/whatsappService.js
const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  // makeInMemoryStore, // معمل له كومنت حالياً، يمكن تفعيله لو احتجته
  Browsers,
} = require("@whiskeysockets/baileys");
const P = require("pino"); // مكتبة Pino للـ logging الخاص بـ Baileys
const { sendTelegramNotification } = require("./telegramNotifier"); // افترضنا إن الملف اسمه telegramNotifier.js

const path = require("path");
const fs = require("fs");
const { getDB } = require("../database/dbManager");
const mainLogger = require("../config/logger"); // Winston logger بتاعنا
const logger = mainLogger.child({ service: "BaileysSvc" }); // Child logger خاص بهذا الـ service

// --- إعدادات أساسية ---
const SESSION_DIR_NAME =
  process.env.BAILEYS_SESSION_DIR_NAME || "baileys_auth_info";
const SESSION_DATA_PATH = path.join(__dirname, "../database", SESSION_DIR_NAME);
const WHATSAPP_SVC_KEY_DB = "baileys_connection"; // مفتاح حالة الخدمة في الداتابيز

let sock = null; // سيتم تهيئته لاحقاً
let currentQRForAdmin = null;
let connectionState = "CLOSED"; // الحالة المبدئية

// --- متغيرات نظام إعادة المحاولة للاتصال ---
let retryCount = 0;
const MAX_RETRIES = parseInt(process.env.BAILEYS_MAX_RETRIES) || 5;
const INITIAL_RETRY_DELAY_MS =
  parseInt(process.env.BAILEYS_INITIAL_RETRY_DELAY_MS) || 7000;
let currentRetryDelayMs = INITIAL_RETRY_DELAY_MS;

/**
 * دالة لتحديث حالة خدمة الواتساب في قاعدة البيانات.
 * @param {string} status - الحالة الجديدة للخدمة.
 * @param {string|object|null} details - تفاصيل إضافية (مثل QR code أو رسالة خطأ).
 */
async function updateServiceStatus(status, details = null) {
  try {
    const db = getDB();
    const sql = `INSERT OR REPLACE INTO service_status (service_key, status, details, last_updated) VALUES (?, ?, ?, ?)`;
    const detailsString =
      typeof details === "string"
        ? details
        : details
        ? JSON.stringify(details)
        : null;

    await new Promise((resolve, reject) => {
      db.run(
        sql,
        [WHATSAPP_SVC_KEY_DB, status, detailsString, new Date().toISOString()],
        function (err) {
          if (err) {
            // استخدام logger.error وتمرير الـ error object كاملاً
            logger.error(
              `BAILEYS_SVC_DB: Error updating status in DB for ${WHATSAPP_SVC_KEY_DB}`,
              err
            );
            return reject(err);
          }
          logger.debug(
            `BAILEYS_SVC_DB: Status updated - Key: ${WHATSAPP_SVC_KEY_DB}, Status: ${status}`
          );
          resolve();
        }
      );
    });
  } catch (error) {
    logger.error(
      "BAILEYS_SVC_DB: Critical error in updateServiceStatus",
      error
    );
  }
}

/**
 * يقوم بتهيئة Baileys client والاتصال بواتساب.
 */
async function initializeWhatsAppClient() {
  // إعداد الـ logger الداخلي لـ Baileys (Pino)
  const baileysInternalLogger = P({
    level: process.env.BAILEYS_INTERNAL_LOG_LEVEL || "warn", // 'silent', 'fatal', 'error', 'warn', 'info', 'debug', 'trace'
  });

  if (connectionState === "CONNECTING" && retryCount > 0) {
    logger.warn(
      "BAILEYS_SVC: Already in a connecting/retrying state, skipping new initialize call for now."
    );
    return;
  }

  logger.info(
    `BAILEYS_SVC: Initializing Baileys (Attempt: ${
      retryCount + 1
    }/${MAX_RETRIES})...`
  );
  await updateServiceStatus("INITIALIZING", `Attempt ${retryCount + 1}`);
  currentQRForAdmin = null;
  logger.debug("BAILEYS_SVC_INIT: Top of initializeWhatsAppClient.");

  // تنظيف أي instance قديم للـ socket
  if (sock) {
    logger.info(
      "BAILEYS_SVC: Previous socket instance exists. Attempting to clean it up..."
    );
    try {
      sock.ev.removeAllListeners(); // إزالة كل الـ event listeners
      if (
        sock.ws &&
        (sock.ws.readyState === sock.ws.OPEN ||
          sock.ws.readyState === sock.ws.CONNECTING)
      ) {
        logger.info("BAILEYS_SVC: Forcing close of existing websocket.");
        sock.ws.close();
      }
      // sock.end(new Error('Client re-initializing by new call')); // بديل لإغلاق الـ socket
    } catch (e) {
      logger.warn(
        "BAILEYS_SVC: Error during old socket cleanup (might be already closed or problematic)",
        e
      );
    } finally {
      sock = null;
      connectionState = "CLOSED"; // إعادة الحالة للافتراضي
    }
  }

  // --- التأكد من وجود مجلد الـ session وإنشائه بشكل آمن قبل استخدامه ---
  try {
    //  استخدم fs.promises.mkdir للعمليات الـ async/await بشكل أفضل لو ممكن،
    //  لكن بما أننا في دالة async، الـ sync versions مقبولة هنا لو أبسط.
    if (!fs.existsSync(SESSION_DATA_PATH)) {
      logger.info(
        `BAILEYS_SVC: Session directory ${SESSION_DATA_PATH} does not exist. Creating...`
      );
      fs.mkdirSync(SESSION_DATA_PATH, { recursive: true });
      logger.info(
        `BAILEYS_SVC: Session directory CREATED: ${SESSION_DATA_PATH}`
      );
    } else {
      logger.debug(
        `BAILEYS_SVC: Session directory already exists: ${SESSION_DATA_PATH}`
      );
    }
  } catch (mkdirError) {
    logger.error(
      `BAILEYS_SVC: CRITICAL ERROR - Could not ensure session directory exists: ${SESSION_DATA_PATH}`,
      mkdirError
    );
    await updateServiceStatus(
      "SESSION_DIR_ERROR",
      `Failed to ensure/create ${SESSION_DATA_PATH}`
    );
    // هذا خطأ حرج، يجب إيقاف التهيئة
    throw new Error(
      `Failed to ensure/create session directory: ${mkdirError.message}`
    );
  }
  // --- نهاية التأكد من المجلد ---

  const { state, saveCreds } = await useMultiFileAuthState(SESSION_DATA_PATH);
  const { version, isLatest } = await fetchLatestBaileysVersion();
  logger.info(
    `BAILEYS_SVC: Using Baileys version: ${version.join(
      "."
    )}, isLatest: ${isLatest}`
  );

  sock = makeWASocket({
    version,
    logger: baileysInternalLogger, // استخدام الـ Pino logger المعدل
    auth: state,
    browser: Browsers.macOS("Desktop"),
    generateHighQualityLinkPreview: true,
    // printQRInTerminal: false, // نعتمد على الـ event لعرض الـ QR
    // أي إعدادات أخرى ضرورية لـ makeWASocket
  });

  // معالج حدث تحديثات الاتصال (أهم معالج)
  sock.ev.on("connection.update", async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      logger.info(
        `BAILEYS_SVC: QR code received. String for admin (first 40 chars): ${qr.substring(
          0,
          40
        )}...`,
        { fullQR: qr }
      );
      await updateServiceStatus("QR_REQUIRED", qr);
      connectionState = "QR_REQUIRED";
      currentQRForAdmin = qr; // تخزين الـ QR للعرض في الأدمن
    }

    if (connection === "close") {
      connectionState = "CLOSED";
      currentQRForAdmin = null; // مسح أي QR قديم عند الإغلاق
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      const shouldReconnect =
        statusCode !== DisconnectReason.loggedOut &&
        statusCode !== DisconnectReason.connectionReplaced &&
        retryCount < MAX_RETRIES;

      const reasonMsg = `Connection closed. Reason: ${
        DisconnectReason[statusCode] || statusCode || "Unknown"
      }. Error: ${lastDisconnect?.error?.message || "N/A"}`;
      logger.info(
        `BAILEYS_SVC: ${reasonMsg}. Should Reconnect: ${shouldReconnect}`
      );
      await updateServiceStatus("DISCONNECTED", reasonMsg);

      if (shouldReconnect) {
        retryCount++;
        const delayMsg = `Reconnecting in ${
          currentRetryDelayMs / 1000
        }s (Attempt ${retryCount}/${MAX_RETRIES})...`;
        logger.info(`BAILEYS_SVC: ${delayMsg}`);
        await updateServiceStatus("RECONNECTING", delayMsg);
        setTimeout(initializeWhatsAppClient, currentRetryDelayMs);
        currentRetryDelayMs = Math.min(currentRetryDelayMs * 1.5, 60000); // زيادة التأخير بشكل تدريجي (حد أقصى دقيقة)
      } else if (statusCode === DisconnectReason.loggedOut) {
        logger.warn(
          "BAILEYS_SVC: Connection logged out by WhatsApp. Session is invalid. Clearing session..."
        );
        await updateServiceStatus(
          "LOGGED_OUT",
          "Session logged out by WhatsApp. Requires new QR scan."
        );
        await clearBaileysSessionAndRestart(false); // false لعدم محاولة إعادة الاتصال الفوري
      } else if (statusCode === DisconnectReason.connectionReplaced) {
        logger.warn(
          "BAILEYS_SVC: Connection replaced, another session was opened. Closing this one."
        );
        await updateServiceStatus(
          "CONNECTION_REPLACED",
          "Another session was opened."
        );
        // لا تحاول إعادة الاتصال هنا، أغلق الـ socket الحالي إذا لم يكن قد أُغلق بالفعل
        if (sock) sock.end(new Error("Connection replaced"));
      } else {
        logger.error(
          `BAILEYS_SVC: Max retries reached or unrecoverable error (${
            DisconnectReason[statusCode] || statusCode
          }). Stopping automatic reconnections.`
        );
        await updateServiceStatus(
          "MAX_RETRIES_REACHED",
          `After ${retryCount} attempts. Last error: ${
            lastDisconnect?.error?.message || "N/A"
          }`
        );
      }
    } else if (connection === "open") {
      connectionState = "OPEN";
      retryCount = 0; // إعادة تعيين عداد المحاولات
      currentRetryDelayMs = INITIAL_RETRY_DELAY_MS; // إعادة تعيين تأخير المحاولة
      currentQRForAdmin = null;
      logger.info(
        "BAILEYS_SVC: Connection opened successfully! Ready to send messages."
      );
      await updateServiceStatus("READY");
    } else if (connection === "connecting") {
      connectionState = "CONNECTING";
      logger.info("BAILEYS_SVC: Connection is connecting...");
      await updateServiceStatus("CONNECTING");
    }
  });

  // معالج حدث حفظ الـ credentials (الـ session)
  sock.ev.on("creds.update", saveCreds);

  // (اختياري) أي معالجات أحداث أخرى من Baileys
  // sock.ev.on('messages.upsert', async m => { /* ... */ });

  return sock;
}

/**
 * يرسل رسالة واتساب.
 */
async function sendWhatsAppMessage(phoneNumberWithPlus, messageBody) {
  if (connectionState !== "OPEN" || !sock) {
    const errMsg =
      "BAILEYS_SVC: Client is not connected or open. Cannot send message.";
    logger.warn(errMsg); // استخدام warn هنا
    await updateServiceStatus("SEND_ERROR_NOT_READY", errMsg);
    throw new Error(errMsg); // لإعلام الـ Worker بالفشل
  }

  const sanitizedNumber = phoneNumberWithPlus.replace(/\D/g, "");
  if (!sanitizedNumber) {
    logger.error("BAILEYS_SVC: Invalid phone number for JID creation.", {
      original: phoneNumberWithPlus,
    });
    throw new Error("Invalid phone number provided.");
  }
  const jid = `${sanitizedNumber}@s.whatsapp.net`;

  try {
    logger.info(
      `BAILEYS_SVC: Attempting to send message to ${jid}: "${messageBody.substring(
        0,
        30
      )}..."`
    );
    const result = await sock.sendMessage(jid, { text: messageBody });
    logger.info(
      `BAILEYS_SVC: Message sent successfully to ${jid}. Msg ID: ${result?.key?.id}`
    );
    return true;
  } catch (error) {
    logger.error(`BAILEYS_SVC: Error sending message to ${jid}`, error);
    await updateServiceStatus(
      "SEND_ERROR",
      `Failed to send to ${jid}: ${error.message}`
    );
    throw error; // إعادة رمي الخطأ ليتم التعامل معه بواسطة الـ Worker
  }
}

/**
 * يتحقق من جاهزية Baileys client.
 */
function isClientSvcReady() {
  return connectionState === "OPEN" && sock;
}

/**
 * للحصول على الـ QR Code string الحالي.
 */
function getCurrentQrForAdmin() {
  return currentQRForAdmin;
}

/**
 * يقوم بمحاولة تسجيل الخروج، مسح ملفات الـ session، ثم إعادة تهيئة الاتصال.
 */
async function clearBaileysSessionAndRestart(attemptReconnect = true) {
  logger.info(
    "BAILEYS_SVC: Attempting to clear Baileys session and restart..."
  );
  await updateServiceStatus(
    "CLEARING_SESSION",
    `Attempting to logout and clear session files. Reconnect: ${attemptReconnect}`
  );

  if (sock) {
    try {
      await sock.logout();
      logger.info("BAILEYS_SVC: sock.logout() called successfully.");
    } catch (e) {
      logger.warn(
        "BAILEYS_SVC: Error during sock.logout() (might be already disconnected or session invalid)",
        e
      );
    }
    // تأكد من إغلاق الـ WebSocket تماماً
    try {
      if (
        sock.ws &&
        (sock.ws.readyState === sock.ws.OPEN ||
          sock.ws.readyState === sock.ws.CONNECTING)
      ) {
        sock.ws.close();
      }
    } catch (e) {
      logger.warn(
        "BAILEYS_SVC: Error trying to close websocket during clear (may already be closed)",
        e
      );
    }
    sock.ev.removeAllListeners();
    sock = null;
    connectionState = "CLOSED";
  }

  try {
    if (fs.existsSync(SESSION_DATA_PATH)) {
      logger.info(
        `BAILEYS_SVC: Deleting session directory: ${SESSION_DATA_PATH}`
      );
      // استخدام fs.promises.rm لعملية async/await أنظف لو أمكن، أو التأكد من الـ error handling مع rmSync
      fs.rmSync(SESSION_DATA_PATH, { recursive: true, force: true });
      logger.info(`BAILEYS_SVC: Session directory DELETED successfully.`);
    } else {
      logger.info(
        `BAILEYS_SVC: Session directory not found at ${SESSION_DATA_PATH}, nothing to delete.`
      );
    }
  } catch (e) {
    logger.error(
      `BAILEYS_SVC: Error deleting session directory ${SESSION_DATA_PATH}`,
      e
    );
    // حتى لو فشل المسح، حاول تكمل التهيئة
  }

  currentQRForAdmin = null;
  retryCount = 0; // إعادة تعيين عداد المحاولات للتهيئة الجديدة
  currentRetryDelayMs = INITIAL_RETRY_DELAY_MS;

  // إضافة تأخير بسيط قبل محاولة إعادة التهيئة
  // هذا قد يساعد نظام الملفات على "الاستيعاب" بعد المسح
  logger.debug(
    "BAILEYS_SVC: Short delay after session clear before potential re-init..."
  );
  await new Promise((resolve) => setTimeout(resolve, 300)); // تأخير 300 مللي ثانية

  if (attemptReconnect) {
    logger.info("BAILEYS_SVC: Re-initializing after clearing session...");
    return initializeWhatsAppClient(); // سيتطلب QR جديد
  } else {
    await updateServiceStatus(
      "SESSION_CLEARED_AWAITING_MANUAL_INIT",
      "Session cleared. Start worker or trigger init to get new QR."
    );
    logger.info(
      "BAILEYS_SVC: Session cleared. Not attempting immediate reconnect as per request."
    );
  }
}

/**
 * يعالج انقطاع الاتصال الخاص بـ Baileys client ويطبق نظام إعادة المحاولة،
 * ويرسل تنبيه تليجرام إذا توقفت المحاولات.
 * @param {string} reason - سبب انقطاع الاتصال.
 */
async function handleClientDisconnection(reason) {
  logger.info(`BAILEYS_SVC: Client disconnected. Reason: ${reason}`);
  connectionState = "CLOSED"; // مهم تحديث الحالة الداخلية أولاً
  currentQRForAdmin = null; // مسح أي QR قديم
  // isClientInstanceReady = false; // لا نستخدم هذا المتغير الآن

  // تحديث الحالة في الداتابيز أولاً
  let statusToLog = "DISCONNECTED";
  let detailsForDB = reason;

  const statusCode = sock?.lastDisconnect?.error?.output?.statusCode; // استخدم optional chaining

  if (statusCode === DisconnectReason.loggedOut) {
    statusToLog = "LOGGED_OUT";
    detailsForDB = "Session logged out by WhatsApp. Requires new QR scan.";
  } else if (statusCode === DisconnectReason.connectionReplaced) {
    statusToLog = "CONNECTION_REPLACED";
    detailsForDB = "Another session was opened.";
  } else if (
    reason &&
    reason.toString().toLowerCase().includes("authentication failure")
  ) {
    statusToLog = "AUTH_FAILURE";
  } else if (
    reason &&
    reason.toString().toLowerCase().includes("initialization error")
  ) {
    statusToLog = "INITIALIZATION_ERROR";
  }

  await updateServiceStatus(statusToLog, detailsForDB);

  const shouldReconnect =
    statusCode !== DisconnectReason.loggedOut &&
    statusCode !== DisconnectReason.connectionReplaced &&
    retryCount < MAX_RETRIES;

  if (shouldReconnect) {
    retryCount++;
    const delayMsg = `Reconnecting in ${
      currentRetryDelayMs / 1000
    }s (Attempt ${retryCount}/${MAX_RETRIES})...`;
    logger.info(`BAILEYS_SVC: ${delayMsg}`);
    await updateServiceStatus("RECONNECTING", `${detailsForDB}. ${delayMsg}`);
    setTimeout(initializeWhatsAppClient, currentRetryDelayMs);
    currentRetryDelayMs = Math.min(currentRetryDelayMs * 1.5, 60000);
  } else {
    // وصلنا للحد الأقصى للمحاولات أو سبب يمنع إعادة الاتصال التلقائي
    const alertMessage = `🚨 WhatsApp Service Alert 🚨\n\nClient disconnected and will NOT automatically reconnect.\nReason: ${statusToLog}\nDetails: ${detailsForDB}\nLast State: ${connectionState}\nAttempts: ${retryCount}/${MAX_RETRIES}\nTimestamp: ${new Date().toLocaleString(
      "en-GB",
      { timeZone: "Africa/Cairo" }
    )}`;

    logger.error(
      `BAILEYS_SVC: Max retries reached or unrecoverable error. ${alertMessage}`
    );
    await updateServiceStatus(
      "CRITICAL_DISCONNECT",
      `Max retries or unrecoverable. ${detailsForDB}`
    );

    // --- 2. إرسال تنبيه تليجرام ---
    logger.info("BAILEYS_SVC: Sending disconnect alert via Telegram...");
    const telegramSent = await sendTelegramNotification(alertMessage);
    if (telegramSent) {
      logger.info("BAILEYS_SVC: Telegram disconnect alert sent successfully.");
    } else {
      logger.warn("BAILEYS_SVC: Failed to send Telegram disconnect alert.");
    }
    // --- نهاية إرسال التنبيه ---

    // (اختياري) محاولة أخيرة بعد فترة طويلة جداً
    if (
      statusCode !== DisconnectReason.loggedOut &&
      statusCode !== DisconnectReason.connectionReplaced
    ) {
      setTimeout(async () => {
        logger.info(
          "BAILEYS_SVC: Attempting a major client re-initialization after long cooldown and alert..."
        );
        retryCount = 0; // Reset retries for this major attempt
        currentRetryDelayMs = INITIAL_RETRY_DELAY_MS * 3; // ابدأ بتأخير أطول
        await updateServiceStatus(
          "MAJOR_RECONNECT_ATTEMPT",
          "After critical disconnect and alert."
        );
        initializeWhatsAppClient();
      }, 3 * 60 * 60 * 1000); // محاولة بعد 3 ساعات مثلاً
    } else if (statusCode === DisconnectReason.loggedOut) {
      // إذا كان loggedOut، لا تحاول إعادة الاتصال، اطلب QR جديد
      logger.info(
        "BAILEYS_SVC: Session logged out. Clearing session files to force new QR on next manual init."
      );
      await clearBaileysSessionAndRestart(false); // false لعدم محاولة إعادة الاتصال الفوري
    }
  }
}

module.exports = {
  initializeWhatsAppClient,
  sendWhatsAppMessage,
  isClientSvcReady,
  getCurrentQrForAdmin,
  clearBaileysSessionAndRestart,
  logoutAndRestartWhatsAppClient: clearBaileysSessionAndRestart,
};
