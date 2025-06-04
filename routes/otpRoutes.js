// routes/otpRoutes.js
const express = require("express");
const router = express.Router();

// استدعاء الـ Controller اللي فيه منطق معالجة الطلب
const otpController = require("../controllers/otpController");

// استدعاء الـ Middleware بتاع التحقق من الـ API Key
const authenticateApiKey = require("../middleware/authMiddleware");

// === تعريف الـ Routes الخاصة بالـ OTP ===

// Route: POST /api/v1/otp/send (المسار الكامل هيتحدد في app.js)
// - authenticateApiKey: أولاً، يتم التحقق من الـ API Key.
// - otpController.sendOtp: إذا كان الـ API Key صحيحاً، يتم استدعاء دالة sendOtp من الـ Controller.
router.post("/send", authenticateApiKey, otpController.sendOtp);
/*
 مثال لـ Route مستقبلي لو حبيت تعمل endpoint للتحقق من الـ OTP
   هنا هيكون منطق التحقق من الـ OTP اللي أدخله المستخدم
   (هتحتاج تخزن الـ OTP المولّد بشكل مؤقت وآمن عشان تقارنه)
*/

router.post("/verify", authenticateApiKey, (req, res) => {
  res
    .status(501)
    .json({ message: "OTP verification endpoint not implemented yet." });
});

module.exports = router;
