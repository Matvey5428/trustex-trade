const pool = require('../config/database');

async function areBotNotificationsEnabled(telegramId) {
  try {
    const result = await pool.query("SELECT value FROM platform_settings WHERE key = 'bot_notifications_enabled'");
    if (result.rows[0]?.value === 'false') return false;
    if (telegramId) {
      const userResult = await pool.query('SELECT notifications_enabled FROM users WHERE telegram_id = $1', [String(telegramId)]);
      if (userResult.rows[0]?.notifications_enabled === false) return false;
    }
    return true;
  } catch (e) {
    return true;
  }
}

module.exports = { areBotNotificationsEnabled };
