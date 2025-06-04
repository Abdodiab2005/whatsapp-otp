// config/logger.js
const winston = require("winston");
const DailyRotateFile = require("winston-daily-rotate-file"); // <--- 1. استدعاء DailyRotateFile
const path = require("path");
const fs = require("fs");
// لا حاجة لـ require("winston-daily-rotate-file"); مرة أخرى هنا

const logDir = path.resolve(__dirname, "../logs");

if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir);
}

const logFormat = winston.format.combine(
  winston.format.timestamp({ format: "YYYY-MM-DD HH:mm:ss.SSS" }),
  winston.format.errors({ stack: true }),
  winston.format.splat(),
  winston.format.printf(
    ({ level, message, timestamp, stack, service, ...metadata }) => {
      // --- 3. تعديل الفورمات لإزالة HTML ---
      let log = `${timestamp} [${
        service || "APP"
      }] ${level.toUpperCase()}: ${message}`;
      if (stack) {
        log += `\n${stack}`;
      }
      if (Object.keys(metadata).length > 0 && !(metadata instanceof Error)) {
        const metaString = JSON.stringify(metadata, null, 2);
        if (metaString !== "{}") {
          log += `\nMeta: ${metaString}`;
        }
      }
      return log;
    }
  )
);

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || "info",
  format: logFormat,
  defaultMeta: { service: "general-app" },
  transports: [
    new winston.transports.Console({
      format: winston.format.combine(winston.format.colorize(), logFormat),
      // --- 1. تعديل هنا: سنجعل level الـ console ثابت (مثلاً debug) ونعتمد على level الـ logger الرئيسي للفلترة ---
      // level: process.env.NODE_ENV === "development" ? "debug" : "info",
      // أو نتركها بدون level هنا لترث الـ level من الـ logger الرئيسي
      // إذا كان مستوى الـ logger الرئيسي 'info', فلن تطبع الـ debug messages في الـ console
      // إذا أردت أن تطبع الـ console دائماً debug messages (إذا كان مستوى الـ logger يسمح)، ضع level: 'debug' هنا
      // للتبسيط، دعها ترث المستوى الرئيسي أو اجعلها 'debug' دائماً إذا أردت رؤية كل شيء في الـ console وقت التطوير
      level: "debug", // سيطبع debug وما فوقه، طالما مستوى الـ logger الرئيسي يسمح بذلك
    }),
    new winston.transports.File({
      filename: path.join(logDir, "error.log"),
      level: "error",
    }),
    new winston.transports.File({
      filename: path.join(logDir, "combined.log"),
      // level: 'silly', //  يمكنك تفعيل هذا إذا أردت تسجيل كل شيء
    }),
    // --- 2. استخدام DailyRotateFile بالشكل الصحيح ---
    new DailyRotateFile({
      filename: path.join(logDir, "application-%DATE%.log"),
      datePattern: "YYYY-MM-DD",
      zippedArchive: true,
      maxSize: "20m",
      maxFiles: "14d",
      level: "info", // (اختياري) حدد مستوى للملفات المؤرشفة
    }),
  ],
  exceptionHandlers: [
    new winston.transports.File({
      filename: path.join(logDir, "exceptions.log"),
    }),
  ],
  rejectionHandlers: [
    new winston.transports.File({
      filename: path.join(logDir, "rejections.log"),
    }),
  ],
});

// --- 1. حذف هذا الجزء بالكامل لأنه مكرر ويسبب طباعة الـ log مرتين في الـ console ---
// if (process.env.NODE_ENV !== "production") {
//   logger.add(
//     new winston.transports.Console({
//       format: winston.format.simple(),
//       level: "debug",
//     })
//   );
// }

module.exports = logger;
