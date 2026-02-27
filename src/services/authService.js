/**
 * src/services/authService.js
 * Authentication business logic
 */

const pool = require('../config/database');
const { v4: uuidv4 } = require('uuid');
const { verifyInitData } = require('../utils/telegramAuth');
const { generateToken } = require('../utils/jwt');
const { UnauthorizedError, ValidationError, ForbiddenError } = require('../utils/errors');

/**
 * Verify initData and get or create user
 */
async function verifyAndGetUser(initData) {
  if (!initData) {
    throw new ValidationError('initData is required');
  }

  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!botToken) {
    console.error('❌ TELEGRAM_BOT_TOKEN is not configured!');
    throw new Error('TELEGRAM_BOT_TOKEN not configured');
  }

  console.log('🔐 Verifying initData signature...');
  // Verify initData signature
  const verification = verifyInitData(initData, botToken);

  if (!verification.valid) {
    console.warn('⚠️ Invalid initData - Error:', verification.error);
    console.warn('📝 User data from initData:', verification.user);
    throw new UnauthorizedError('Invalid initData: ' + verification.error);
  }

  const userData = verification.user;
  
  if (!userData.telegram_id) {
    throw new ValidationError('telegram_id not found in initData');
  }

  // Check if user exists
  let user = await getUserByTelegramId(userData.telegram_id);

  if (user) {
    // User exists - check if blocked
    if (user.status === 'blocked') {
      throw new ForbiddenError('User is blocked');
    }

    console.log('✅ User found:', user.id);
    return user;
  }

  // Create new user
  console.log('👤 Creating new user with telegram_id:', userData.telegram_id);
  user = await createUser(userData);

  return user;
}

/**
 * Get user by telegram_id
 */
async function getUserByTelegramId(telegramId) {
  const result = await pool.query(
    `SELECT 
      id, telegram_id, username, first_name, last_name, photo_url,
      balance_usdt, balance_btc, balance_rub,
      verified, status, is_admin,
      created_at, updated_at
     FROM users 
     WHERE telegram_id = $1`,
    [telegramId]
  );

  return result.rows[0] || null;
}

/**
 * Get user by id
 */
async function getUserById(id) {
  const result = await pool.query(
    `SELECT 
      id, telegram_id, username, first_name, last_name, photo_url,
      balance_usdt, balance_btc, balance_rub,
      verified, status, is_admin,
      created_at, updated_at
     FROM users 
     WHERE id = $1`,
    [id]
  );

  return result.rows[0] || null;
}

/**
 * Create new user
 */
async function createUser(userData) {
  const {
    telegram_id,
    username,
    first_name,
    last_name,
    photo_url
  } = userData;

  const id = uuidv4();

  const result = await pool.query(
    `INSERT INTO users 
      (id, telegram_id, username, first_name, last_name, photo_url, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
     RETURNING 
      id, telegram_id, username, first_name, last_name, photo_url,
      balance_usdt, balance_btc, balance_rub,
      verified, status, is_admin,
      created_at, updated_at,
      created_at`,
    [id, telegram_id, username || null, first_name || null, last_name || null, photo_url || null]
  );

  const user = result.rows[0];
  console.log('✅ User created:', user.id);

  return user;
}

/**
 * Generate auth response with token
 */
function getAuthResponse(user) {
  const token = generateToken({
    userId: user.id,
    telegramId: user.telegram_id,
    username: user.username,
    isAdmin: user.is_admin
  });

  return {
    token,
    user: {
      id: user.id,
      telegram_id: user.telegram_id,
      username: user.username,
      first_name: user.first_name,
      last_name: user.last_name,
      photo_url: user.photo_url,
      balance_usdt: user.balance_usdt,
      balance_btc: user.balance_btc,
      balance_rub: user.balance_rub,
      verified: user.verified,
      status: user.status,
      is_admin: user.is_admin,
      created_at: user.created_at
    }
  };
}

module.exports = {
  verifyAndGetUser,
  getUserByTelegramId,
  getUserById,
  createUser,
  getAuthResponse
};
