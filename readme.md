# WhatsApp OTP Sender & Admin Dashboard (Powered by Baileys)

## 📜 Overview

This project is a Node.js application designed to send One-Time Passwords (OTPs) via WhatsApp using the Baileys library. It includes an API endpoint for requesting OTPs and a basic web-based admin dashboard for monitoring the WhatsApp service status, viewing queued jobs, and managing the WhatsApp session. The system uses SQLite as a database for an OTP job queue and to store service status.

This project was developed iteratively, transitioning from `whatsapp-web.js` to Baileys for better performance and resource management, making it more suitable for various hosting environments, including VPS.

## ✨ Features

- **OTP Sending via WhatsApp:** Leverages Baileys for robust WhatsApp communication.
- **API Endpoint:** A secure endpoint (`POST /api/v1/otp/send`) for client applications to request OTPs.
  - Requires API Key authentication.
  - Validates international phone numbers.
  - Returns the generated OTP and its expiration time in the response.
- **Job Queue:** Uses an SQLite database to queue OTP sending requests, ensuring no requests are lost during high load or temporary service unavailability.
- **Background Worker:** An integrated worker (part of the main `app.js` process) processes the job queue asynchronously.
  - Handles WhatsApp connection (QR/Pairing, session management, auto-reconnect).
  - Sends OTP messages with random delays between messages.
  - Updates job statuses (pending, processing, sent, failed).
- **Admin Dashboard (`/admin/status`):**
  - **Session Protected:** Requires admin login (username/password stored in `.env`).
  - **WhatsApp Service Status:** Displays the current connection status of the Baileys client (e.g., READY, QR_REQUIRED, DISCONNECTED) and any relevant details (like QR string for scanning if needed, or error messages).
  - **Job Statistics:** Shows counts of jobs by status (Pending, Processing, Sent, Failed).
  - **Recent Jobs Table:** Displays recent OTP jobs with their details (ID, phone, status, timestamps, errors).
    - Supports **Pagination** to handle a large number of jobs.
    - Basic **Filtering** by job status and **Searching** by phone number, OTP, message, or error.
  - **Admin Actions:**
    - **Retry Failed Job:** Allows admins to re-queue a failed OTP job.
    - **Reload Session:** Attempts to re-initialize the Baileys client using the existing session.
    - **Logout WA & New Scan:** Logs out the current WhatsApp session, clears session files, and forces Baileys to request a new QR/Pairing.
  - **Dynamic Updates:** The dashboard uses JavaScript Fetch API to periodically refresh data (status, stats, jobs) without full page reloads.
- **OTP Expiry:** Generated OTPs have a defined validity period (e.g., 5 minutes), and the expiration time is returned in the API response.
- **Rate Limiting:** The admin login form (`POST /admin/login`) is protected against brute-force attacks.
- **Structured Logging:** Uses Winston for structured logging to console and files (errors, combined logs, exceptions, rejections), making debugging and monitoring easier.
- **Graceful Shutdown:** Handles `SIGINT` and `SIGTERM` signals to close server, database connections, and WhatsApp client воду (if possible) HTMLScleanly.
- **Telegram Alert (Optional):** Includes a service (`telegramNotifier.js`) to send alerts to a specified Telegram chat if the WhatsApp service disconnects critically and cannot auto-reconnect.

## ⚙️ Tech Stack

- **Backend:** Node.js, Express.js
- **WhatsApp Integration:** `@whiskeysockets/baileys`
- **Database:** SQLite (for job queue, service status, and admin sessions via `connect-sqlite3`)
- **Templating (Admin Dashboard):** EJS (Embedded JavaScript templates)
- **Logging:** Winston
- **Session Management (Admin):** `express-session` with `connect-sqlite3`
- **API Authentication (Admin Login):** Form-based (username/password)
- **API Authentication (OTP Endpoint):** API Key in header
- **Rate Limiting (Admin Login):** `express-rate-limit`
- **QR Code Display (Admin):** `qrcode.min.js` (frontend library via CDN)
- **Telegram Notifications (Optional):** `node-fetch` (or native `Workspace` in Node.js 18+)

## 🚀 Getting Started

### Prerequisites

- Node.js (v16.x or higher recommended, v18+ for native fetch)
- NPM (comes with Node.js)
- A dedicated WhatsApp account/number for the bot.
- (Optional for Telegram Alerts) A Telegram Bot Token and your Chat ID.
- (Optional for Production) PM2 or a similar process manager.
- (Optional for Production) Nginx or a similar reverse proxy.

### Installation

1.  **Clone the repository (if applicable) or copy the project files.**
2.  **Navigate to the project directory:**
    ```bash
    cd whatsapp-otp
    ```
3.  **Install dependencies:**
    ```bash
    npm install
    ```
4.  **Set up Environment Variables:**

    - Rename `config/.env.example` (if provided) to `config/.env` or create a new `config/.env` file.
    - Fill in the required environment variables:

      ```env
      # Application Port
      PORT=3000
      NODE_ENV=development # or production

      # Secret API Key for OTP endpoint
      API_KEY=YOUR_VERY_SECRET_OTP_API_KEY

      # Admin Dashboard Credentials
      ADMIN_USERNAME=your_admin_username
      ADMIN_PASSWORD=your_admin_password

      # Session Secret (a long random string)
      SESSION_SECRET=a_very_long_and_random_session_secret_string

      # SQLite Database Filename (relative to project root)
      DB_FILENAME=./database/app_data.db

      # Baileys Session Configuration
      BAILEYS_SESSION_DIR_NAME=baileys_auth_info # Folder name inside 'database' for Baileys session
      WHATSAPP_CLIENT_ID=leviropath # Used by Baileys LocalAuth (will create session-leviropath or similar)

      # Logging Levels
      LOG_LEVEL=info # For Winston (error, warn, info, http, verbose, debug, silly)
      BAILEYS_INTERNAL_LOG_LEVEL=warn # For Baileys' internal logger (fatal, error, warn, info, debug, trace, silent)

      # Worker Configuration (milliseconds)
      WORKER_POLLING_INTERVAL_MS=7000
      WORKER_WHATSAPP_CHECK_INTERVAL_MS=15000
      WORKER_MIN_SEND_DELAY_MS=5000
      WORKER_MAX_SEND_DELAY_MS=20000
      BAILEYS_MAX_RETRIES=5
      BAILEYS_INITIAL_RETRY_DELAY_MS=7000

      # (Optional) Telegram Alert Configuration
      TELEGRAM_BOT_TOKEN=YOUR_TELEGRAM_BOT_TOKEN_IF_USING_ALERTS
      TELEGRAM_CHAT_ID=YOUR_TELEGRAM_CHAT_ID_IF_USING_ALERTS
      ```

### Running the Application (Local Development)

The application now runs as a single Node.js process, with the worker logic integrated into `app.js`.

1.  **Start the application:**

    ```bash
    npm start
    ```

    or for development with auto-restart (if `nodemon` is configured in `package.json` scripts and `nodemon.json` is set up):

    ```bash
    npm run dev
    ```

    or directly:

    ```bash
    node app.js
    ```

2.  **First Run - WhatsApp Pairing:**

    - On the first run, or if the Baileys session is cleared, the application (via the integrated worker logic) will attempt to connect to WhatsApp.
    - Check the console/terminal where `app.js` is running. A **QR code** (or pairing code instructions) should appear.
    - Open WhatsApp on your phone, go to Linked Devices, and scan the QR code (or follow pairing code instructions).

3.  **Accessing the API:**

    - The OTP API endpoint will be available at `http://localhost:PORT/api/v1/otp/send`.

4.  **Accessing the Admin Dashboard:**
    - Open `http://localhost:PORT/admin/status` in your browser.
    - You will be prompted for the admin username and password (from your `.env` file).

### Running in Production (Example with PM2)

1.  **Ensure all dependencies are installed on your VPS.**
2.  **Install PM2 globally (if not already installed):**
    ```bash
    npm install pm2 -g
    ```
3.  **Create an `ecosystem.config.js` file in your project root:**
    ```javascript
    // ecosystem.config.js
    module.exports = {
      apps: [
        {
          name: "otp-app", // Your main application (API + Integrated Worker)
          script: "app.js",
          watch: false, // Set to true or use nodemon if needed, but ensure proper ignore for DB/logs
          // ignore_watch: ["node_modules", "database/baileys_auth_info", "database/*.db*", "logs"], // More specific if watch is true
          max_memory_restart: "300M", // Example: Restart if it exceeds 300MB
          env_development: {
            NODE_ENV: "development",
            // Add other dev-specific env vars here
          },
          env_production: {
            NODE_ENV: "production",
            PORT: 8080, // Or your desired production port
            // Define all production environment variables here or ensure they are set on the server
            // It's often better to manage production .env files securely on the server
          },
        },
      ],
    };
    ```
4.  **Start the application using PM2:**
    - For development environment (uses `env_development` from ecosystem file):
      ```bash
      pm2 start ecosystem.config.js --env development
      ```
    - For production environment:
      ```bash
      pm2 start ecosystem.config.js --env production
      ```
      _(Ensure your `.env` file for production is correctly configured on the server, or all variables are set in `env_production`)_
5.  **Manage the application:**

    - `pm2 list` - Show all running processes.
    - `pm2 logs otp-app` - View logs for your app.
    - `pm2 stop otp-app` - Stop the app.
    - `pm2 restart otp-app` - Restart the app.
    - `pm2 delete otp-app` - Remove the app from PM2.
    - `pm2 startup` - To make PM2 auto-start on server reboot.
    - `pm2 save` - Save current PM2 process list.

6.  **(Recommended for Production) Configure a Reverse Proxy (e.g., Nginx):**
    - To handle HTTPS (SSL/TLS).
    - To serve your application on port 80/443.
    - For load balancing (if you scale).

## 📂 Project Structure (Key Files)

```
whatsapp-otp/
├── config/
│   ├── logger.js         # Winston logger configuration
│   ├── .env              # Environment variables (ignored by git)
│   └── .env.example      # Example environment variables
├── controllers/
│   ├── otpController.js  # Logic for OTP API endpoint
│   └── adminController.js # Logic for admin actions (e.g., retry job)
├── database/
│   ├── dbManager.js      # SQLite database initialization and connection
│   ├── app_data.db       # SQLite database file (jobs, service_status, sessions) (ignored by git)
│   └── baileys_auth_info/ # Baileys session files (created automatically, ignored by git)
├── middleware/
│   ├── adminSessionAuthMiddleware.js # Protects admin routes (checks session)
│   └── authMiddleware.js             # Protects OTP API (checks API Key - if you still use a separate one)
├── node_modules/
├── public/                 # (Optional) For static assets if needed
├── routes/
│   ├── otpRoutes.js      # Express routes for /api/v1/otp
│   └── adminPageRoutes.js # Express routes for /admin pages and APIs
├── services/
│   ├── otpService.js     # OTP generation and message preparation
│   ├── queueService.js   # SQLite job queue management (add, fetch, update)
│   ├── whatsappService.js # Baileys client initialization, sending, status
│   └── telegramNotifier.js # Service for sending Telegram alerts
├── views/
│   ├── login.ejs         # Admin login form page
│   └── admin_status.ejs  # Admin dashboard page
├── app.js                  # Main Express application, integrated worker startup
├── worker.js               # (Now integrated into app.js) Original standalone worker logic
├── package.json
├── package-lock.json
├── README.md               # This file
└── ecosystem.config.js     # (Optional) PM2 configuration file
```

## 🔗 API Endpoint Details

_(Refer to section 3 of the previous Markdown documentation for detailed API endpoint information. It remains largely the same: `POST /api/v1/otp/send` with `X-API-KEY` and `phoneNumber`, returning OTP and `otp_expires_at`)_

Make sure to update the `README.md` section for API Endpoint details if any changes were made to the request/response structure.

## 🛠️ Admin Dashboard Features

- **View WhatsApp Connection Status:** Real-time (via polling) status from Baileys.
- **View QR Code/Pairing Info:** If Baileys requires QR/Pairing, it's displayed for scanning.
- **View Job Statistics:** Counts of pending, processing, sent, and failed jobs.
- **View Recent Jobs:** Paginated table of OTP jobs with details.
- **Filter & Search Jobs:** Filter by status, search by phone, OTP, etc.
- **Retry Failed Jobs:** Button to re-queue a failed job.
- **WhatsApp Session Management:**
  - "Reload Session": Attempts to re-initialize Baileys with the current session.
  - "Logout WA & New Scan": Logs out the current session, clears session files, and forces a new QR/Pairing.
- **Admin Authentication:** Protected by username/password login.

## 🔧 How to Modify & Extend

- **WhatsApp Logic:** Primarily in `services/whatsappService.js`.
- **Admin Panel UI:** In `views/admin_status.ejs` and its JavaScript.
- **Admin Panel Backend:** In `routes/adminPageRoutes.js` and `controllers/adminController.js`.
- **OTP Generation:** In `services/otpService.js`.
- **Job Queue:** In `services/queueService.js` and `database/dbManager.js`.
- **Logging Configuration:** In `config/logger.js`.

## ❗ Important Considerations

- **WhatsApp Business Platform API:** For official, scalable, and ToS-compliant solutions, consider using the official WhatsApp Business Platform API. Libraries like Baileys are unofficial and may carry risks (e.g., account banning), especially with heavy usage or if not used responsibly.
- **Session Stability:** Baileys sessions can sometimes become invalid. The admin panel tools help manage this.
- **Error Handling & Monitoring:** Continuously monitor logs and improve error handling for a robust system.
- **Security:** Regularly update dependencies, use strong secrets, and consider further security measures for a production environment (firewall, HTTPS, etc.).

---

# Usage

This part provides instructions for developers on how to use the OTP (One-Time Password) WhatsApp Sender API. This API allows you to request sending OTPs to specified phone numbers via WhatsApp.

## 1. Base URL

The base URL for the API is:

- **Production/VPS:** `http://185.213.24.149:3000/api/v1`
- **Local Development:** `http://localhost:3000/api/v1`

## 2. Authentication

All API requests must be authenticated using a secret API Key provided in the request headers.

- **Header Name:** `X-API-KEY`
- **Header Value:** Your secret API Key.

If the API Key is missing or incorrect, the server will respond with a `401 Unauthorized` error.

## 3. Endpoints

### Send OTP

This endpoint is used to request sending an OTP to a specific phone number via WhatsApp. The OTP is generated by the server.

- **Path:** `/otp/send`
- **Method:** `POST`
- **Full URL (Example):** `POST http://185.213.24.149:3000/api/v1/otp/send`

#### Required Headers

| Header         | Value                 |
| :------------- | :-------------------- |
| `Content-Type` | `application/json`    |
| `X-API-KEY`    | `YOUR_SECRET_API_KEY` |

#### Request Body (JSON)

```json
{
  "phoneNumber": "+201001234567"
}
```

- **`phoneNumber`** (string, required): The recipient's phone number.
  - **Format:** Must be in full international format, including the `+` sign and the country code (e.g., `+966XXXXXXXXX` for Saudi Arabia, `+971XXXXXXXXX` for UAE, `+20XXXXXXXXX` for Egypt).

#### Responses

- **Success Response (Status Code `202 Accepted`)**

  Indicates that the request has been accepted and the OTP generation and queuing for sending via WhatsApp has been initiated. The OTP itself is returned in the response for immediate use by the client application.

  ```json
  {
    "message": "OTP request accepted and has been queued for sending.",
    "otp": "1234", // The 4-digit OTP generated by the server
    "jobId": 123, // (Optional) The ID of the job in the sending queue
    "otp_expires_at": "2025-05-22T10:43:40.123Z" // OTP expiration time in ISO 8601 format (UTC)
  }
  ```

* **Error Responses**

  - **`400 Bad Request`**:

    - If `phoneNumber` is missing from the request body:
      ```json
      {
        "message": "Bad Request: \"phoneNumber\" is required in the request body."
      }
      ```
    - If the `phoneNumber` format is invalid:
      ```json
      {
        "message": "Bad Request: Invalid phone number format. Please provide the number in international format starting with + and country code (e.g., +966XXXXXXXXX)."
      }
      ```

  - **`401 Unauthorized`**:

    - If the `X-API-KEY` header is missing:
      ```json
      {
        "message": "Unauthorized: API Key is missing from headers."
      }
      ```
    - If the provided `X-API-KEY` is invalid:
      ```json
      {
        "message": "Unauthorized: Invalid API Key."
      }
      ```

  - **`500 Internal Server Error`**:

    - For any other unexpected server-side errors during request processing.
      ```json
      {
        "message": "Internal Server Error while processing OTP request."
        // "error": "STACK_TRACE_IN_DEVELOPMENT_MODE" (only in development)
      }
      ```

  - **`503 Service Unavailable`**:

    - (Rare) Indicates a temporary issue with the service, possibly related to the job queue.
      ```json
      {
        "message": "Service temporarily unavailable due to a queueing issue. Please try again shortly."
      }
      ```

## 4\. Important Notes for Developers

- **Rate Limiting:** Currently, no explicit rate limiting is enforced on this API. Please use the API responsibly to avoid overloading the service. Future versions may include rate limiting.
- **OTP Delivery:** The API responds immediately with the generated OTP and queues the WhatsApp message for sending. The actual delivery of the WhatsApp message to the end-user is handled asynchronously by a background worker and may experience a slight delay (due to queue processing and intentional random delays between messages).
- **API Key Security:** The `X-API-KEY` is a secret credential. It must be protected and should **not** be embedded directly in client-side code that is publicly accessible. Manage it securely on your server-side application that makes requests to this API.
- **Phone Number Format:** Strictly adhere to the international phone number format (`+<country_code><number>`) for the `phoneNumber` field to ensure successful message delivery.
