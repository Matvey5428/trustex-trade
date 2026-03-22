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
async function verifyAndGetUser(initData, refCode = null) {
  if (!initData) {
    throw new ValidationError('initData is required');
  }

  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!botToken) {
    console.error('❌ TELEGRAM_BOT_TOKEN is not configured!');
    throw new Error('TELEGRAM_BOT_TOKEN not configured');
  }

  // Verify initData signature
  const verification = verifyInitData(initData, botToken);

  let userData = verification.user;

  // If verification failed, reject authentication
  if (!verification.valid) {
    console.warn('⚠️ Invalid initData - Error:', verification.error);
    throw new UnauthorizedError('Invalid initData: ' + verification.error);
  }
  
  if (!userData?.telegram_id) {
    throw new ValidationError('telegram_id not found in initData');
  }

  // Check if user exists
  let user = await getUserByTelegramId(userData.telegram_id);

  if (user) {
    // User exists - check if blocked
    if (user.is_blocked) {
      throw new ForbiddenError('User is blocked');
    }

    // If user has no manager, try to link them
      console.log('[REFERRAL-AUTH] User exists, refCode:', refCode, 'telegram_id:', userData.telegram_id, 'has manager:', !!user.manager_id, 'has referred_by:', !!user.referred_by);
    if (!user.manager_id) {
      let linkRefCode = refCode;
      
      // Check pending_refs if no refCode passed
      if (!linkRefCode) {
        const pendingRef = await pool.query(
          'SELECT ref_code FROM pending_refs WHERE telegram_id = $1',
          [userData.telegram_id]
        );
        if (pendingRef.rows.length > 0) {
          linkRefCode = pendingRef.rows[0].ref_code;
          await pool.query('DELETE FROM pending_refs WHERE telegram_id = $1', [userData.telegram_id]);
        }
      }
      
      if (linkRefCode) {
        // Check for friend referral
        if (linkRefCode.startsWith('friend_')) {
          const friendId = linkRefCode.replace('friend_', '');
          if (!user.referred_by && /^\d+$/.test(friendId) && friendId !== String(userData.telegram_id)) {
            await pool.query(
              'UPDATE users SET referred_by = $1 WHERE id = $2 AND referred_by IS NULL',
              [parseInt(friendId), user.id]
            );
          }
        } else {
          const managerResult = await pool.query(
            'SELECT id FROM managers WHERE ref_code = $1',
            [linkRefCode]
          );
          if (managerResult.rows.length > 0) {
            await pool.query(
              'UPDATE users SET manager_id = $1 WHERE id = $2',
              [managerResult.rows[0].id, user.id]
            );
          } else if (!user.referred_by && /^\d+$/.test(linkRefCode) && linkRefCode !== String(userData.telegram_id)) {
            // Direct numeric refCode — friend referral
            const friendCheck = await pool.query(
              'SELECT telegram_id FROM users WHERE telegram_id = $1', [linkRefCode]
            );
            if (friendCheck.rows.length > 0) {
              await pool.query(
                'UPDATE users SET referred_by = $1 WHERE id = $2 AND referred_by IS NULL',
                [parseInt(linkRefCode), user.id]
              );
            }
          }
        }
      }
    }

    return user;
  }

  // Create new user with optional manager link
  user = await createUser(userData, refCode);

  return user;
}

/**
 * Get user by telegram_id
 */
async function getUserByTelegramId(telegramId) {
  const result = await pool.query(
    `SELECT 
      id, telegram_id, username, first_name, last_name, photo_url,
      balance_usdt, balance_btc, balance_rub, balance_eur, balance_eth, balance_ton,
      verified, status, is_admin, is_blocked, manager_id, referred_by,
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
      balance_usdt, balance_btc, balance_rub, balance_eur, balance_eth, balance_ton,
      verified, status, is_admin, is_blocked,
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
async function createUser(userData, refCode = null) {
  const {
    telegram_id,
    username,
    first_name,
    last_name,
    photo_url
  } = userData;

  const id = uuidv4();
  
  // Find manager or sub-admin by ref_code
  let managerId = null;
  let subAdminId = null;
  let subAdminTelegramId = null;
  let referredBy = null;
  let usedRefCode = refCode;
  
  // 1. First check passed refCode
  console.log('[REFERRAL-CREATE] createUser called with refCode:', refCode, 'telegram_id:', telegram_id);
  if (refCode) {
    const managerResult = await pool.query(
      'SELECT id FROM managers WHERE ref_code = $1',
      [refCode]
    );
    if (managerResult.rows.length > 0) {
      managerId = managerResult.rows[0].id;
    } else if (/^\d+$/.test(refCode) && refCode !== String(telegram_id)) {
      // refCode is a numeric telegram_id — friend referral
      const friendCheck = await pool.query(
        'SELECT telegram_id FROM users WHERE telegram_id = $1',
        [refCode]
      );
      if (friendCheck.rows.length > 0) {
        referredBy = parseInt(refCode);
      }
    }
  }
  
  // 2. If no refCode passed, check pending_refs table
  if (!managerId && !subAdminId) {
    const pendingRef = await pool.query(
      'SELECT ref_code FROM pending_refs WHERE telegram_id = $1',
      [telegram_id]
    );
    if (pendingRef.rows.length > 0) {
      usedRefCode = pendingRef.rows[0].ref_code;
      
      // Check if it's a sub-admin ref (prefixed with 'sa_')
      if (usedRefCode.startsWith('sa_')) {
        const actualRefCode = usedRefCode.replace('sa_', '');
        const subAdminResult = await pool.query(
          'SELECT id, telegram_id FROM sub_admins WHERE ref_code = $1',
          [actualRefCode]
        );
        if (subAdminResult.rows.length > 0) {
          subAdminId = subAdminResult.rows[0].id;
          subAdminTelegramId = subAdminResult.rows[0].telegram_id;
        }
      } else if (usedRefCode.startsWith('friend_')) {
        // Friend referral
        console.log('[REFERRAL-CREATE] Found friend referral in pending_refs:', usedRefCode);
        const friendTelegramId = usedRefCode.replace('friend_', '');
        if (/^\d+$/.test(friendTelegramId)) {
          const friendCheck = await pool.query(
            'SELECT telegram_id FROM users WHERE telegram_id = $1',
            [friendTelegramId]
          );
          if (friendCheck.rows.length > 0) {
            referredBy = parseInt(friendTelegramId);
          }
        }
      } else {
        // Regular manager ref
        const managerResult = await pool.query(
          'SELECT id FROM managers WHERE ref_code = $1',
          [usedRefCode]
        );
        if (managerResult.rows.length > 0) {
          managerId = managerResult.rows[0].id;
        }
      }
      
      // Clean up pending ref
      await pool.query('DELETE FROM pending_refs WHERE telegram_id = $1', [telegram_id]);
    }
  }

  const result = await pool.query(
    `INSERT INTO users 
      (id, telegram_id, username, first_name, last_name, photo_url, manager_id, sub_admin_id, sub_admin_telegram_id, referred_by, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW(), NOW())
     ON CONFLICT (telegram_id) DO UPDATE SET
       username = EXCLUDED.username,
       first_name = EXCLUDED.first_name,
       last_name = EXCLUDED.last_name,
       photo_url = EXCLUDED.photo_url,
       manager_id = COALESCE(users.manager_id, EXCLUDED.manager_id),
       sub_admin_id = COALESCE(users.sub_admin_id, EXCLUDED.sub_admin_id),
       sub_admin_telegram_id = COALESCE(users.sub_admin_telegram_id, EXCLUDED.sub_admin_telegram_id),
       referred_by = COALESCE(users.referred_by, EXCLUDED.referred_by),
       updated_at = NOW()
     RETURNING 
      id, telegram_id, username, first_name, last_name, photo_url,
      balance_usdt, balance_btc, balance_rub,
      verified, status, is_admin, manager_id, sub_admin_id,
      created_at, updated_at`,
    [id, telegram_id, username || null, first_name || null, last_name || null, photo_url || null, managerId, subAdminId, subAdminTelegramId, referredBy]
  );

  const user = result.rows[0];

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
