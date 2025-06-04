// middleware/authMiddleware.js
const mainLogger = require("../config/logger"); // عدل المسار
const logger = mainLogger.child({ service: "AuthMiddleware" });

function authenticateApiKey(req, res, next) {
  const apiKeyFromHeader = req.headers["x-api-key"]; // اسم الـ header المتعارف عليه أو أي اسم تختاره
  const expectedApiKey = process.env.API_KEY;

  // التحقق الأول: هل الـ API Key موجود في .env أصلاً؟
  if (!expectedApiKey) {
    logger.error("API_KEY is not set in the environment variables.");
    return res
      .status(500)
      .json({ message: "Server configuration error: API Key not set." });
  }

  // التحقق الثاني: هل العميل أرسل API Key في الـ header؟
  if (!apiKeyFromHeader) {
    return res
      .status(401)
      .json({ message: "Unauthorized: API Key is missing from headers." });
  }

  // التحقق الثالث: هل الـ API Key المرسل صحيح؟
  if (apiKeyFromHeader === expectedApiKey) {
    // الـ API Key صحيح، اسمح للطلب بالمرور للـ controller التالي
    next();
  } else {
    // الـ API Key غير صحيح
    return res.status(401).json({ message: "Unauthorized: Invalid API Key." });
  }
}

module.exports = authenticateApiKey;
