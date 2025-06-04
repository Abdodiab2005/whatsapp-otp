// controllers/otpController.js
const otpService = require("../services/otpService");
const queueService = require("../services/queueService");

const mainLogger = require("../config/logger");
const logger = mainLogger.child({ service: "OtpController" });

async function sendOtp(req, res) {
  try {
    // 1. التحقق من المدخلات (رقم الهاتف)
    const { phoneNumber } = req.body;
    if (!phoneNumber) {
      return res.status(400).json({
        message: 'Bad Request: "phoneNumber" is required in the request body.',
      });
    }

    const receivedPhoneNumber = phoneNumber.toString().trim();
    const internationalPhoneRegex = /^\+[1-9]\d{7,14}$/;

    if (!internationalPhoneRegex.test(receivedPhoneNumber)) {
      logger.warn(
        `Invalid international phone number format received: ${receivedPhoneNumber}. Expected format like +XXXXXXXXXXX.`
      );
      return res.status(400).json({
        message:
          "Bad Request: Invalid phone number format. Please provide the number in international format starting with + and country code (e.g., +966XXXXXXXXX).",
      });
    }

    const generatedOtp = otpService.generateOtp(4);
    const messageBody = otpService.prepareMessage(generatedOtp);

    // --- هنا يتم حساب وقت انتهاء الصلاحية ---
    const otpLifetimeMinutes = 5; // مدة صلاحية الـ OTP بـ 5 دقائق
    const now = new Date();
    const expirationTime = new Date(
      now.getTime() + otpLifetimeMinutes * 60 * 1000
    );
    // تحويل وقت الانتهاء إلى صيغة ISO 8601 (UTC)
    const otpExpiresAtISO = expirationTime.toISOString();
    // --- نهاية حساب وقت انتهاء الصلاحية ---

    // إضافة المهمة للطابور مع وقت انتهاء صلاحية الـ OTP
    const jobId = await queueService.addJobToQueue(
      receivedPhoneNumber,
      generatedOtp,
      messageBody,
      otpExpiresAtISO
    );

    logger.info(
      `OTP Controller: Request for ${receivedPhoneNumber} processed. OTP: ${generatedOtp}. Job ID: ${jobId} added to queue. Expires at: ${otpExpiresAtISO}`
    );

    // إرجاع الـ OTP ووقت انتهاء الصلاحية للعميل
    res.status(202).json({
      message: "OTP request accepted and has been queued for sending.",
      otp: generatedOtp,
      jobId: jobId,
      otp_expires_at: otpExpiresAtISO, // <-- هذا هو وقت انتهاء الصلاحية الذي يُرسل للعميل
      // يمكنك أيضاً إرسال الـ timestamp كرقم إذا كان العميل يفضل ذلك:
      // otp_expires_at_timestamp: expirationTime.getTime() // Unix timestamp بالمللي ثانية (UTC)
    });
  } catch (error) {
    logger.error("Error in sendOtp controller:", error);
    // يمكنك تحسين معالجة الأخطاء هنا بناءً على نوع الخطأ
    if (error.message && error.message.includes("queue")) {
      // مثال بسيط
      return res.status(503).json({
        message:
          "Service temporarily unavailable due to a queueing issue. Please try again shortly.",
      });
    }
    res
      .status(500)
      .json({ message: "Internal Server Error while processing OTP request." });
  }
}

module.exports = {
  sendOtp,
};
