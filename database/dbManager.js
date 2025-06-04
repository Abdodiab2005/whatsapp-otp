// database/dbManager.js
const sqlite3 = require("sqlite3").verbose();
const path = require("path");

// نقرأ مسار ملف قاعدة البيانات من .env أو نستخدم قيمة افتراضية
// المسار اللي في .env (config/.env) كان DB_FILENAME=./database/app_data.db
// وهو مسار نسبي من الـ root directory للمشروع
const dbRelativePath = process.env.DB_FILENAME || "database/app_data.db"; // مسار افتراضي لو مش موجود
const dbPath = path.resolve(
  __dirname,
  `../${
    dbRelativePath.startsWith("./")
      ? dbRelativePath.substring(2)
      : dbRelativePath
  }`
);
// __dirname هنا هيكون /project-root/database
// لو dbRelativePath هو './database/app_data.db', هيتحول ل /project-root/database/app_data.db
// لو dbRelativePath هو 'database/app_data.db', هيتحول ل /project-root/database/app_data.db

let db; // سيتم تهيئة قاعدة البيانات هنا

/**
 * يقوم بتهيئة الاتصال بقاعدة البيانات وإنشاء الجداول اللازمة.
 * @returns {Promise<void>}
 */
function initializeDB() {
  return new Promise((resolve, reject) => {
    // نتصل بقاعدة البيانات (سيتم إنشاؤها إذا لم تكن موجودة)
    db = new sqlite3.Database(dbPath, (err) => {
      if (err) {
        console.error("Error connecting to SQLite database:", err.message);
        return reject(err);
      }
      console.log(`Successfully connected to SQLite database at: ${dbPath}`);

      // نستخدم db.serialize لضمان تنفيذ الأوامر بالترتيب
      db.serialize(() => {
        const createJobsTableSQL = `
          CREATE TABLE IF NOT EXISTS jobs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            phone_number TEXT NOT NULL,
            otp TEXT NOT NULL,
            message_body TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'pending',
            attempts INTEGER DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            processed_at DATETIME NULL,
            error_message TEXT NULL,
            otp_expires_at DATETIME NULL
          );
        `;

        db.run(createJobsTableSQL, (err) => {
          if (err) {
            console.error('Error creating "jobs" table:', err.message);
            return reject(err);
          }
          console.log('"jobs" table created or already exists.');
          resolve(); // تم تهيئة قاعدة البيانات بنجاح
        });

        const createServiceStatusTableSQL = `
          CREATE TABLE IF NOT EXISTS service_status (
            service_key TEXT PRIMARY KEY, -- مفتاح فريد للخدمة (مثلاً 'whatsapp_connection')
            status TEXT NOT NULL,         -- الحالة (e.g., 'INITIALIZING', 'READY', 'DISCONNECTED', 'QR_REQUIRED', 'AUTH_FAILURE')
            details TEXT NULL,            -- أي تفاصيل إضافية (مثل سبب الانقطاع، أو الـ QR code string)
            last_updated DATETIME NOT NULL -- وقت آخر تحديث للحالة
          );
        `;

        db.run(createServiceStatusTableSQL, (err) => {
          if (err) {
            console.error(
              'Error creating "service_status" table:',
              err.message
            );
            return reject(err); // هنا ممكن نعمل reject لو الجدول ده أساسي جداً
          }
          console.log('"service_status" table created or already exists.');
          // --- نهاية الجزء الجديد ---

          // يمكنك إضافة تهيئة مبدئية للحالة هنا إذا أردت
          const initialStatusSQL = `
            INSERT OR IGNORE INTO service_status (service_key, status, last_updated, details)
            VALUES (?, ?, ?, ?)
          `;
          // نفترض أن الحالة الأولية "UNKNOWN" أو "NOT_INITIALIZED" حتى يبدأ الـ worker بتحديثها
          db.run(
            initialStatusSQL,
            [
              "whatsapp_connection",
              "UNKNOWN",
              new Date().toISOString(),
              "Service status not yet reported by worker.",
            ],
            (initErr) => {
              if (initErr) {
                console.error(
                  "Error inserting initial whatsapp_connection status:",
                  initErr.message
                );
                // لا نعتبر هذا خطأ حرجاً يوقف التهيئة
              } else {
                console.log(
                  'Initial "whatsapp_connection" status set or already exists.'
                );
              }
              resolve(); // تم تهيئة كل الجداول (أو محاولة تهيئتها)
            }
          );
        });
      });
    });
  });
}

/**
 * دالة للحصول على instance قاعدة البيانات بعد تهيئتها.
 * @returns {sqlite3.Database} instance قاعدة البيانات.
 * @throws {Error} إذا لم يتم تهيئة قاعدة البيانات بعد.
 */
function getDB() {
  if (!db) {
    throw new Error("Database not initialized. Call initializeDB() first.");
  }
  return db;
}

module.exports = {
  initializeDB,
  getDB,
};
