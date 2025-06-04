const fetch = require('node-fetch');
const os = require('os');
const mainLogger = require('../config/logger');
const logger = mainLogger.child({ service: 'EnhancedTelegramService' });

class EnhancedTelegramService {
  constructor() {
    this.botToken = process.env.TELEGRAM_BOT_TOKEN;
    this.defaultChatId = process.env.TELEGRAM_CHAT_ID;
    this.baseUrl = `https://api.telegram.org/bot${this.botToken}`;
    
    // Resource monitoring thresholds
    this.cpuThreshold = 80; // 80% CPU usage warning
    this.memoryThreshold = 85; // 85% memory usage warning
  }

  async sendAlert(type, details) {
    if (!this.botToken || !this.defaultChatId) {
      logger.warn('Telegram credentials not configured. Alert not sent.');
      return false;
    }

    const timestamp = new Date().toISOString();
    const systemInfo = await this.getSystemInfo();
    
    let message = `🚨 *${type.toUpperCase()} ALERT*\n\n`;
    message += `⏰ *Timestamp:* ${timestamp}\n`;
    message += `📍 *Component:* ${details.component || 'System'}\n\n`;
    
    if (details.error) {
      message += `❌ *Error:* ${details.error}\n`;
      message += `📝 *Details:* ${details.message || 'No additional details'}\n`;
      if (details.resolution) {
        message += `🔧 *Resolution:* ${details.resolution}\n`;
      }
    } else {
      message += `ℹ️ *Details:* ${details.message}\n`;
    }

    message += `\n📊 *System Status:*\n${systemInfo}`;

    try {
      const response = await fetch(`${this.baseUrl}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: this.defaultChatId,
          text: message,
          parse_mode: 'Markdown'
        })
      });

      const data = await response.json();
      
      if (!response.ok) {
        logger.error('Failed to send Telegram alert:', data);
        return false;
      }

      logger.info(`Telegram alert sent successfully: ${type}`);
      return true;
    } catch (error) {
      logger.error('Error sending Telegram alert:', error);
      return false;
    }
  }

  async getSystemInfo() {
    const cpuUsage = os.loadavg()[0] * 100 / os.cpus().length;
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const memUsage = ((totalMem - freeMem) / totalMem) * 100;

    let info = '';
    info += `CPU Usage: ${cpuUsage.toFixed(1)}%\n`;
    info += `Memory Usage: ${memUsage.toFixed(1)}%\n`;
    info += `Uptime: ${Math.floor(os.uptime() / 3600)}h ${Math.floor((os.uptime() % 3600) / 60)}m\n`;

    // Add warnings if thresholds are exceeded
    if (cpuUsage > this.cpuThreshold) {
      info += `⚠️ High CPU usage warning!\n`;
    }
    if (memUsage > this.memoryThreshold) {
      info += `⚠️ High memory usage warning!\n`;
    }

    return info;
  }

  // Specific alert methods for different scenarios
  async alertServiceStatus(status, details) {
    return this.sendAlert('SERVICE_STATUS', {
      component: 'WhatsApp Service',
      message: `Service ${status}: ${details}`
    });
  }

  async alertConnectionEvent(event, details) {
    return this.sendAlert('CONNECTION', {
      component: 'WhatsApp Connection',
      message: `${event}: ${details}`
    });
  }

  async alertError(error, component = 'System') {
    return this.sendAlert('ERROR', {
      component,
      error: error.name || 'Error',
      message: error.message,
      resolution: 'Check logs for more details and contact system administrator if issue persists.'
    });
  }

  async alertAuthFailure(details) {
    return this.sendAlert('AUTH_FAILURE', {
      component: 'Authentication',
      message: details
    });
  }

  async alertRateLimit(details) {
    return this.sendAlert('RATE_LIMIT', {
      component: 'API',
      message: `Rate limit warning: ${details}`,
      resolution: 'Consider implementing request throttling or increasing rate limits.'
    });
  }
}

// Export singleton instance
module.exports = new EnhancedTelegramService();