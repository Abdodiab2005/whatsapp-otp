// controllers/adminController.js (أو أي اسم تختاره)
const queueService = require("../services/queueService");
const { getDB } = require("../database/dbManager");
const mainLogger = require("../config/logger"); // عدل المسار
const logger = mainLogger.child({ service: "AdminController" });

async function retryJob(req, res) {
  const jobId = parseInt(req.params.jobId, 10);

  if (isNaN(jobId)) {
    return res.status(400).json({ message: "Invalid Job ID." });
  }

  try {
    // (اختياري) التحقق من أن المهمة موجودة وحالتها failed قبل إعادة المحاولة
    const db = getDB();
    const job = await new Promise((resolve, reject) => {
      db.get(
        "SELECT id, status FROM jobs WHERE id = ?",
        [jobId],
        (err, row) => {
          if (err) return reject(err);
          resolve(row);
        }
      );
    });

    if (!job) {
      return res
        .status(404)
        .json({ message: `Job with ID ${jobId} not found.` });
    }

    if (job.status !== "failed") {
      // يمكنك السماح بإعادة محاولة أي مهمة، أو فقط الفاشلة.
      // return res.status(400).json({ message: `Job with ID ${jobId} is not in 'failed' state. Current status: ${job.status}` });
      logger.warn(
        `Admin: Retrying job ${jobId} which is currently in '${job.status}' state.`
      );
    }

    // تغيير حالة المهمة إلى 'pending'
    // (اختياري: يمكن أيضاً إعادة تعيين عمود 'attempts' إلى 0 أو قيمة أقل إذا أردت)
    await queueService.updateJobStatus(jobId, "pending");

    logger.info(`Admin: Job ${jobId} has been re-queued for processing.`);
    res
      .status(200)
      .json({ message: `Job ${jobId} has been successfully re-queued.` });
  } catch (error) {
    logger.error(`Admin: Error retrying job ${jobId}:`, error);
    res.status(500).json({ message: "Failed to retry job." });
  }
}

module.exports = {
  retryJob,
};
