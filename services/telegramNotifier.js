// services/telegramNotifier.js
const fetch = require("node-fetch");
const logger = require("../config/logger").child({
  service: "TelegramNotifier",
});

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const DEFAULT_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

/**
 * Sends a text message to a Telegram chat using the bot API.
 * @param {string} messageText - The message text to send.
 * @param {string} [chatId] - Optional chat ID to send the message to. If not provided, uses the default from env.
 * @returns {Promise<boolean>} - true if the request was sent successfully.
 */
async function sendTelegramMessage(messageText, chatId = null) {
  const targetChatId = chatId || DEFAULT_CHAT_ID;

  if (!TELEGRAM_BOT_TOKEN) {
    logger.warn("Telegram Bot Token is missing in .env. Cannot send message.");
    return false;
  }

  if (!targetChatId) {
    logger.warn("Telegram Chat ID is missing. Cannot send message.");
    return false;
  }

  const telegramApiUrl = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;

  const payload = {
    chat_id: targetChatId,
    text: messageText,
    parse_mode: "Markdown",
  };

  try {
    logger.info(
      `Attempting to send Telegram message to Chat ID: ${targetChatId}`
    );
    const response = await fetch(telegramApiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    const responseData = await response.json();

    if (response.ok && responseData.ok) {
      logger.info("Telegram message sent successfully!", {
        result: responseData.result,
      });
      return true;
    } else {
      logger.error("Failed to send Telegram message.", {
        statusCode: response.status,
        statusText: response.statusText,
        telegramResponse: responseData,
      });
      return false;
    }
  } catch (error) {
    logger.error(
      "Error sending Telegram message (fetch failed or non-JSON response):",
      error
    );
    return false;
  }
}

/**
 * Sends a notification message to the default alert chat ID.
 * @param {string} messageText - The message text to send.
 * @returns {Promise<boolean>} - true if the request was sent successfully.
 */
async function sendTelegramNotification(messageText) {
  return sendTelegramMessage(messageText, DEFAULT_CHAT_ID);
}

module.exports = {
  sendTelegramNotification,
  sendTelegramMessage,
};
