// services/queueService.js
const { getDB } = require("../database/dbManager"); // لاستيراد دالة الحصول على instance قاعدة البيانات
const mainLogger = require("../config/logger"); // عدل المسار
const logger = mainLogger.child({ service: "QueueSvc" });

/**
 * يضيف مهمة جديدة (إرسال OTP) إلى طابور الانتظار في قاعدة البيانات.
 * @param {string} phoneNumber - رقم الهاتف المراد إرسال الـ OTP إليه.
 * @param {string} otp - كود الـ OTP.
 * @param {string} messageBody - نص الرسالة الكامل الذي يحتوي على الـ OTP.
 * @returns {Promise<number>} - Promise يحمل الـ ID الخاص بالمهمة الجديدة التي تم إضافتها.
 */
function addJobToQueue(phoneNumber, otp, messageBody) {
  return new Promise((resolve, reject) => {
    const db = getDB();
    const sql = `
      INSERT INTO jobs (phone_number, otp, message_body, status, attempts)
      VALUES (?, ?, ?, 'pending', 0)
    `;

    db.run(sql, [phoneNumber, otp, messageBody], function (err) {
      if (err) {
        logger.error("Error adding job to queue:", err.message);
        return reject(err);
      }
      logger.info(
        `Job added to queue with ID: ${this.lastID}, Phone: ${phoneNumber}`
      );
      resolve(this.lastID); // this.lastID يعطي الـ ID الخاص بالصف المدرج
    });
  });
}

/**
 * يسحب أقدم مهمة في حالة 'pending' من الطابور ويحدث حالتها إلى 'processing'.
 * @returns {Promise<object|null>} - Promise يحمل بيانات المهمة إذا وجدت، أو null إذا كان الطابور فارغاً.
 */
function fetchNextJob() {
  return new Promise((resolve, reject) => {
    const db = getDB();
    const selectSQL = `
      SELECT * FROM jobs
      WHERE status = 'pending'
      ORDER BY created_at ASC
      LIMIT 1
    `;

    db.get(selectSQL, [], (err, job) => {
      if (err) {
        logger.error("Error fetching next job from queue:", err.message);
        return reject(err);
      }

      if (!job) {
        // لا توجد مهام pending في الطابور
        return resolve(null);
      }

      // إذا وجدت مهمة، قم بتحديث حالتها إلى 'processing' وزيادة عدد المحاولات
      const updateSQL = `
        UPDATE jobs
        SET status = 'processing', attempts = attempts + 1, processed_at = CURRENT_TIMESTAMP
        WHERE id = ? AND status = 'pending' 
      `;
      //  الشرط AND status = 'pending' هنا مهم لتجنب race conditions بسيطة
      //  في حال كان هناك worker آخر (نظرياً) قد سحب المهمة للتو.
      db.run(updateSQL, [job.id], function (updateErr) {
        if (updateErr) {
          logger.error(
            `Error updating job ${job.id} to processing:`,
            updateErr.message
          );
          return reject(updateErr);
        }
        // التحقق مما إذا كان التحديث قد أثر فعلياً على أي صف
        // هذا يعني أننا نجحنا في "حجز" هذه المهمة
        if (this.changes > 0) {
          logger.info(
            `Job ${job.id} fetched and status updated to processing. Attempt: ${
              job.attempts + 1
            }`
          );
          // إرجاع المهمة الأصلية مع إضافة المحاولة الجديدة يدوياً لأن job object قديم
          resolve({ ...job, status: "processing", attempts: job.attempts + 1 });
        } else {
          // لم يتم تحديث أي صف، هذا يعني أن المهمة ربما تم سحبها بواسطة عملية أخرى للتو
          // أو أن حالتها لم تعد 'pending' لسبب ما
          logger.info(
            `Job ${job.id} was likely picked up by another process or its status changed.`
          );
          resolve(null); // عاملها كأن الطابور فارغ لهذه المحاولة
        }
      });
    });
  });
}

/**
 * يحدث حالة مهمة معينة في الطابور.
 * @param {number} jobId - الـ ID الخاص بالمهمة.
 * @param {string} newStatus - الحالة الجديدة للمهمة (e.g., 'sent', 'failed').
 * @param {string|null} [errorMessage=null] - رسالة الخطأ إذا كانت الحالة 'failed'.
 * @returns {Promise<void>}
 */
async function updateJobStatus(jobId, newStatus, errorMessage = null) {
  return new Promise((resolve, reject) => {
    const db = getDB();
    let sql;
    const params = [];

    if (newStatus === "failed") {
      sql = `UPDATE jobs SET status = ?, error_message = ?, processed_at = CURRENT_TIMESTAMP WHERE id = ?`;
      params.push(newStatus, errorMessage, jobId);
    } else if (newStatus === "sent") {
      sql = `UPDATE jobs SET status = ?, error_message = NULL, processed_at = CURRENT_TIMESTAMP WHERE id = ?`;
      params.push(newStatus, jobId);
    } else if (newStatus === "pending") {
      // <--- الجزء المضاف/المعدل هنا
      // عند إعادة الجدولة لـ pending، نزيل رسالة الخطأ ووقت المعالجة السابق
      // ويمكن إعادة تعيين عدد المحاولات إذا أردنا (مثلاً لـ 0 أو job.attempts - 1)
      // حالياً، fetchNextJob هي التي تزيد الـ attempts، لذا تركها كما هي سيجعلها محاولة جديدة.
      // أو يمكننا تقليلها بواحد هنا إذا أردنا أن يبدأ الـ attempt counter من القيمة التي فشلت عندها
      // للتبسيط، سنجعلها pending فقط، وسيعتبرها الـ worker محاولة جديدة بالـ attempt counter الحالي + 1
      sql = `UPDATE jobs SET status = ?, error_message = NULL, processed_at = NULL WHERE id = ?`;
      params.push(newStatus, jobId);
    } else {
      // لأي حالات أخرى (مثل 'processing' لو احتجنا نغيرها يدوياً)
      sql = `UPDATE jobs SET status = ? WHERE id = ?`;
      params.push(newStatus, jobId);
    }

    db.run(sql, params, function (err) {
      if (err) {
        logger.error(
          `Error updating job ${jobId} status to ${newStatus}:`,
          err.message
        );
        return reject(err);
      }
      if (this.changes === 0) {
        logger.warn(
          `Job ${jobId} not found or status not updated to ${newStatus}.`
        );
      } else {
        logger.info(`Job ${jobId} status updated to ${newStatus}.`);
      }
      resolve();
    });
  });
}

module.exports = {
  addJobToQueue,
  fetchNextJob,
  updateJobStatus,
};
