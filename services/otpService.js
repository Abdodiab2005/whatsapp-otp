// services/otpService.js
const crypto = require("crypto");

/**
 * يولد كود OTP رقمي آمن بطول محدد.
 * @param {number} length - طول الـ OTP المطلوب (الافتراضي 6).
 * @returns {string} - الـ OTP كسلسلة نصية.
 */
function generateOtp(length = 4) {
  if (length <= 0) {
    throw new Error("OTP length must be a positive number.");
  }
  // الحد الأقصى للقيمة بناءً على الطول (مثلاً لو الطول 6، يبقى 10^6 = 1,000,000)
  // crypto.randomInt لا يشمل الحد الأقصى، لذا نستخدمه مباشرة
  const max = Math.pow(10, length);
  const randomNumber = crypto.randomInt(0, max); // يولد رقم بين 0 و max-1

  // تحويل الرقم إلى سلسلة نصية وتعبئة الأصفار البادئة إذا لزم الأمر
  return randomNumber.toString().padStart(length, "0");
}

/**
 * يجهز نص رسالة OTP عشوائي من مجموعة قوالب.
 * @param {string} otp - كود الـ OTP الذي سيتم إدراجه في الرسالة.
 * @returns {string} - نص الرسالة النهائي.
 */
function prepareMessage(otp) {
  const messageTemplates = [
    "كود التحقق الخاص بك لـ سفري هو: {OTP}. لا تشاركه مع أحد.",
    "رمزك لتأكيد حسابك في سفري هو: {OTP}. صلاحية الرمز 5 دقائق.",
    "استخدم {OTP} لإكمال عملية تسجيل الدخول في تطبيق سفري.",
    "سفري OTP: {OTP}. هذا الرمز مخصص للاستخدام مرة واحدة فقط.",
    "لتأمين حسابك، نرجو إدخال الرمز التالي: {OTP} لخدمة سفري. شكراً لك.",
  ];

  // اختيار قالب عشوائي من المصفوفة
  const randomIndex = Math.floor(Math.random() * messageTemplates.length);
  const selectedTemplate = messageTemplates[randomIndex];

  // استبدال placeholder الـ {OTP} بالكود الفعلي
  const finalMessage = selectedTemplate.replace("{OTP}", otp);

  return finalMessage;
}

module.exports = {
  generateOtp,
  prepareMessage,
};
