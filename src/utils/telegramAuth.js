/**
 * src/utils/telegramAuth.js
 * Verify Telegram Mini App initData signature
 */

const crypto = require('crypto');

/**
 * Verify initData signature
 * @param {string} initData - Raw initData from Telegram.WebApp.initData
 * @param {string} botToken - Telegram bot token
 * @returns {Object} { valid: boolean, data: object }
 */
function verifyInitData(initData, botToken) {
  try {
    if (!initData || !botToken) {
      return { valid: false, error: 'Missing initData or botToken' };
    }

    // Parse the initData string
    const params = new URLSearchParams(initData);
    const signature = params.get('hash');
    
    if (!signature) {
      return { valid: false, error: 'No signature found' };
    }

    // Remove hash from params
    params.delete('hash');

    // Sort parameters alphabetically
    const sortedParams = Array.from(params.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, value]) => `${key}=${value}`)
      .join('\n');

    // Create secret key
    const secretKey = crypto
      .createHmac('sha256', 'WebAppData')
      .update(botToken)
      .digest();

    // Create hash
    const hash = crypto
      .createHmac('sha256', secretKey)
      .update(sortedParams)
      .digest('hex');

    // Verify signature
    const isValid = hash === signature;

    if (!isValid) {
      return { valid: false, error: 'Invalid signature' };
    }

    // Parse user data
    const userDataStr = params.get('user');
    let user = null;

    if (userDataStr) {
      try {
        user = JSON.parse(userDataStr);
      } catch (e) {
        return { valid: false, error: 'Invalid user data' };
      }
    }

    // Get auth_date
    const authDate = params.get('auth_date');

    // Check if auth_date is fresh (not older than 5 minutes)
    if (authDate) {
      const authTimestamp = parseInt(authDate) * 1000;
      const now = Date.now();
      const fiveMinutesInMs = 5 * 60 * 1000;

      if (now - authTimestamp > fiveMinutesInMs) {
        return { valid: false, error: 'Auth data too old' };
      }
    }

    return {
      valid: true,
      user: {
        telegram_id: user?.id,
        username: user?.username,
        first_name: user?.first_name,
        last_name: user?.last_name,
        is_premium: user?.is_premium || false,
        photo_url: user?.photo_url,
        language_code: user?.language_code
      }
    };
  } catch (error) {
    console.error('❌ Error verifying initData:', error.message);
    return { valid: false, error: error.message };
  }
}

/**
 * Extract telegram_id from initData
 */
function getTelegramId(initData) {
  try {
    const params = new URLSearchParams(initData);
    const userDataStr = params.get('user');
    if (userDataStr) {
      const user = JSON.parse(userDataStr);
      return user.id;
    }
    return null;
  } catch (e) {
    return null;
  }
}

module.exports = {
  verifyInitData,
  getTelegramId
};
