/**
 * src/routes/admin.js
 * Admin API endpoints for Mini App
 */

const express = require('express');
const router = express.Router();
const pool = require('../config/database');

// Main Admin ID from environment (single admin)
const MAIN_ADMIN_ID = (process.env.ADMIN_IDS || '').split(',')[0]?.trim();

/**
 * Check if user is main admin
 */
function isMainAdmin(telegramId) {
  return String(telegramId) === MAIN_ADMIN_ID;
}

/**
 * Check if user is sub-admin (async)
 */
async function getSubAdminInfo(telegramId) {
  try {
    const result = await pool.query(
      'SELECT id, ref_code FROM sub_admins WHERE telegram_id = $1',
      [String(telegramId)]
    );
    return result.rows[0] || null;
  } catch (e) {
    return null;
  }
}

/**
 * Check if user is manager (async)
 * Returns manager info including sub_admin_id if exists
 */
async function getManagerInfo(telegramId) {
  try {
    const result = await pool.query(
      'SELECT id, sub_admin_id FROM managers WHERE telegram_id = $1',
      [String(telegramId)]
    );
    return result.rows[0] || null;
  } catch (e) {
    return null;
  }
}

/**
 * Admin middleware - allows main admin, sub-admins, or managers
 */
async function adminCheck(req, res, next) {
  const adminId = req.query.adminId || req.body.adminId;
  
  if (!adminId) {
    return res.status(403).json({ success: false, error: 'Доступ запрещён' });
  }
  
  // Check if main admin
  if (isMainAdmin(adminId)) {
    req.adminId = adminId;
    req.isMainAdmin = true;
    req.isSubAdmin = false;
    req.subAdminId = null;
    req.managerId = null;
    return next();
  }
  
  // Check if sub-admin
  const subAdminInfo = await getSubAdminInfo(adminId);
  if (subAdminInfo) {
    req.adminId = adminId;
    req.isMainAdmin = false;
    req.isSubAdmin = true;
    req.subAdminId = subAdminInfo.id;
    req.subAdminRefCode = subAdminInfo.ref_code;
    req.managerId = null;
    return next();
  }
  
  // Check if manager
  const managerInfo = await getManagerInfo(adminId);
  if (managerInfo) {
    req.adminId = adminId;
    req.isMainAdmin = false;
    req.isSubAdmin = false;
    req.subAdminId = managerInfo.sub_admin_id; // Manager's parent sub_admin
    req.managerId = managerInfo.id;
    return next();
  }
  
  return res.status(403).json({ success: false, error: 'Доступ запрещён' });
}

/**
 * Middleware for main admin only actions
 */
function mainAdminOnly(req, res, next) {
  if (!req.isMainAdmin) {
    return res.status(403).json({ success: false, error: 'Только для главного админа' });
  }
  next();
}

/**
 * GET /api/admin/role
 * Get current user role
 */
router.get('/role', adminCheck, (req, res) => {
  let role = 'manager';
  if (req.isMainAdmin) role = 'admin';
  else if (req.isSubAdmin) role = 'subadmin';
  
  res.json({
    success: true,
    data: {
      role,
      managerId: req.managerId,
      subAdminId: req.subAdminId,
      isSubAdmin: req.isSubAdmin || false
    }
  });
});

/**
 * GET /api/admin/stats
 * Get overall statistics
 */
router.get('/stats', adminCheck, async (req, res) => {
  try {
    let query;
    let params = [];
    
    if (req.isMainAdmin) {
      // Main admin sees all users
      query = `
        SELECT 
          COUNT(*) as total_users,
          COALESCE(SUM(balance_usdt), 0) as total_balance,
          COUNT(*) FILTER (WHERE trade_mode = 'win') as win_mode_count,
          COUNT(*) FILTER (WHERE COALESCE(trade_mode, 'loss') = 'loss') as loss_mode_count
        FROM users
      `;
    } else if (req.isSubAdmin) {
      // Sub-admin sees users of their managers + users attracted directly
      query = `
        SELECT 
          COUNT(*) as total_users,
          COALESCE(SUM(balance_usdt), 0) as total_balance,
          COUNT(*) FILTER (WHERE trade_mode = 'win') as win_mode_count,
          COUNT(*) FILTER (WHERE COALESCE(trade_mode, 'loss') = 'loss') as loss_mode_count
        FROM users u
        WHERE u.sub_admin_id = $1
           OR u.manager_id IN (SELECT id FROM managers WHERE sub_admin_id = $1)
      `;
      params = [req.subAdminId];
    } else {
      // Manager sees only their users
      query = `
        SELECT 
          COUNT(*) as total_users,
          COALESCE(SUM(balance_usdt), 0) as total_balance,
          COUNT(*) FILTER (WHERE trade_mode = 'win') as win_mode_count,
          COUNT(*) FILTER (WHERE COALESCE(trade_mode, 'loss') = 'loss') as loss_mode_count
        FROM users
        WHERE manager_id = $1
      `;
      params = [req.managerId];
    }
    
    const result = await pool.query(query, params);
    const stats = result.rows[0];
    
    res.json({
      success: true,
      data: {
        totalUsers: parseInt(stats.total_users),
        totalBalance: parseFloat(stats.total_balance),
        winModeCount: parseInt(stats.win_mode_count),
        lossModeCount: parseInt(stats.loss_mode_count)
      }
    });
  } catch (error) {
    console.error('Admin stats error:', error);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

/**
 * GET /api/admin/users
 * Get all users (or manager's users only)
 */
router.get('/users', adminCheck, async (req, res) => {
  try {
    let query;
    let params = [];
    
    if (req.isMainAdmin) {
      // Main admin sees all users
      query = `
        SELECT 
          u.id, u.telegram_id, u.username, u.first_name, u.last_name,
          u.balance_usdt, u.balance_btc, u.balance_rub,
          COALESCE(u.trade_mode, 'loss') as trade_mode,
          u.created_at,
          m.name as manager_name,
          sa.name as sub_admin_name
        FROM users u
        LEFT JOIN managers m ON u.manager_id = m.id
        LEFT JOIN sub_admins sa ON u.sub_admin_id = sa.id
        ORDER BY u.created_at DESC 
        LIMIT 100
      `;
    } else if (req.isSubAdmin) {
      // Sub-admin sees users of their managers + users attracted directly
      query = `
        SELECT 
          u.id, u.telegram_id, u.username, u.first_name, u.last_name,
          u.balance_usdt, u.balance_btc, u.balance_rub,
          COALESCE(u.trade_mode, 'loss') as trade_mode,
          u.created_at,
          m.name as manager_name
        FROM users u
        LEFT JOIN managers m ON u.manager_id = m.id
        WHERE u.sub_admin_id = $1
           OR u.manager_id IN (SELECT id FROM managers WHERE sub_admin_id = $1)
        ORDER BY u.created_at DESC 
        LIMIT 100
      `;
      params = [req.subAdminId];
    } else {
      // Manager sees only their users
      query = `
        SELECT 
          id, telegram_id, username, first_name, last_name,
          balance_usdt, balance_btc, balance_rub,
          COALESCE(trade_mode, 'loss') as trade_mode,
          created_at
        FROM users 
        WHERE manager_id = $1
        ORDER BY created_at DESC 
        LIMIT 100
      `;
      params = [req.managerId];
    }
    
    const result = await pool.query(query, params);
    
    res.json({
      success: true,
      data: result.rows
    });
  } catch (error) {
    console.error('Admin users error:', error);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

/**
 * GET /api/admin/user/:telegramId
 * Get specific user details
 */
router.get('/user/:telegramId', adminCheck, async (req, res) => {
  try {
    const { telegramId } = req.params;
    
    // Ensure is_blocked column exists
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS is_blocked BOOLEAN DEFAULT FALSE`);
    
    // Build query based on role
    let userResult;
    if (req.isMainAdmin) {
      userResult = await pool.query(
        'SELECT * FROM users WHERE telegram_id = $1',
        [telegramId]
      );
    } else if (req.isSubAdmin) {
      // Sub-admin can view users of their managers or directly attracted users
      userResult = await pool.query(
        `SELECT * FROM users 
         WHERE telegram_id = $1 
           AND (sub_admin_id = $2 OR manager_id IN (SELECT id FROM managers WHERE sub_admin_id = $2))`,
        [telegramId, req.subAdminId]
      );
    } else {
      // Manager can only view their users
      userResult = await pool.query(
        'SELECT * FROM users WHERE telegram_id = $1 AND manager_id = $2',
        [telegramId, req.managerId]
      );
    }
    
    if (userResult.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'User not found' });
    }
    
    const user = userResult.rows[0];
    
    // Get trades count
    const tradesResult = await pool.query(
      'SELECT COUNT(*) as count FROM orders WHERE user_id = $1',
      [user.id]
    );
    
    res.json({
      success: true,
      data: {
        ...user,
        trade_mode: user.trade_mode || 'loss',
        trades_count: parseInt(tradesResult.rows[0].count),
        is_blocked: user.is_blocked || false
      }
    });
  } catch (error) {
    console.error('Admin user error:', error);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

/**
 * GET /api/admin/user/:telegramId/invoices
 * Get user's payment history
 */
router.get('/user/:telegramId/invoices', adminCheck, async (req, res) => {
  try {
    const { telegramId } = req.params;
    
    // Get user with role check
    let userResult;
    if (req.isMainAdmin) {
      userResult = await pool.query('SELECT id FROM users WHERE telegram_id = $1', [telegramId]);
    } else if (req.isSubAdmin) {
      userResult = await pool.query(
        `SELECT id FROM users WHERE telegram_id = $1 
         AND (sub_admin_id = $2 OR manager_id IN (SELECT id FROM managers WHERE sub_admin_id = $2))`,
        [telegramId, req.subAdminId]
      );
    } else {
      userResult = await pool.query('SELECT id FROM users WHERE telegram_id = $1 AND manager_id = $2', [telegramId, req.managerId]);
    }
    
    if (userResult.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'User not found' });
    }
    
    const userId = userResult.rows[0].id;
    
    // Get invoices
    const result = await pool.query(
      `SELECT invoice_id, amount, asset, status, pay_url, created_at, paid_at
       FROM crypto_invoices
       WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT 20`,
      [userId]
    );
    
    res.json({
      success: true,
      data: result.rows
    });
  } catch (error) {
    console.error('User invoices error:', error);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

/**
 * GET /api/admin/user/:telegramId/history
 * Get user's full activity history (deposits, withdrawals, trades)
 */
router.get('/user/:telegramId/history', adminCheck, async (req, res) => {
  try {
    const { telegramId } = req.params;
    
    // Get user with role check
    let userResult;
    if (req.isMainAdmin) {
      userResult = await pool.query('SELECT id FROM users WHERE telegram_id = $1', [telegramId]);
    } else if (req.isSubAdmin) {
      // Sub-admin can view users from their direct ref or their managers
      userResult = await pool.query(
        `SELECT id FROM users WHERE telegram_id = $1 
         AND (sub_admin_id = $2 OR manager_id IN (SELECT id FROM managers WHERE sub_admin_id = $2))`,
        [telegramId, req.subAdminId]
      );
    } else {
      // Manager can only view their users
      userResult = await pool.query('SELECT id FROM users WHERE telegram_id = $1 AND manager_id = $2', [telegramId, req.managerId]);
    }
    
    if (userResult.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'User not found' });
    }
    
    const userId = userResult.rows[0].id;
    
    // Get deposits (crypto_invoices)
    const depositsResult = await pool.query(
      `SELECT 'deposit' as type, invoice_id as id, amount, asset, status, created_at, paid_at as completed_at
       FROM crypto_invoices
       WHERE user_id = $1
       ORDER BY created_at DESC`,
      [userId]
    );
    
    // Get withdrawals
    const withdrawalsResult = await pool.query(
      `SELECT 'withdrawal' as type, id, amount, 'USDT' as asset, status, wallet, created_at, NULL as completed_at
       FROM withdraw_requests
       WHERE user_id = $1
       ORDER BY created_at DESC`,
      [userId]
    );
    
    // Get trades (orders)
    const tradesResult = await pool.query(
      `SELECT 'trade' as type, id, amount, symbol as asset, status, direction, result, profit, duration, created_at, NULL as completed_at
       FROM orders
       WHERE user_id = $1
       ORDER BY created_at DESC`,
      [userId]
    );
    
    // Combine and sort by date
    const allHistory = [
      ...depositsResult.rows,
      ...withdrawalsResult.rows,
      ...tradesResult.rows
    ].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    
    res.json({
      success: true,
      data: allHistory
    });
  } catch (error) {
    console.error('User history error:', error);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

/**
 * POST /api/admin/withdrawal/:id/return
 * Return withdrawal to user (refund balance)
 */
router.post('/withdrawal/:id/return', adminCheck, async (req, res) => {
  const client = await pool.connect();
  try {
    const { id } = req.params;
    
    await client.query('BEGIN');
    
    // Get withdrawal with user info - lock both rows
    let withdrawalResult;
    if (req.isMainAdmin) {
      withdrawalResult = await client.query(
        `SELECT wr.*, u.id as user_internal_id, u.telegram_id, u.balance_usdt, u.balance_rub, u.first_name
         FROM withdraw_requests wr 
         JOIN users u ON wr.user_id = u.id 
         WHERE wr.id = $1
         FOR UPDATE OF wr, u`,
        [id]
      );
    } else if (req.isSubAdmin) {
      withdrawalResult = await client.query(
        `SELECT wr.*, u.id as user_internal_id, u.telegram_id, u.balance_usdt, u.balance_rub, u.first_name
         FROM withdraw_requests wr 
         JOIN users u ON wr.user_id = u.id 
         WHERE wr.id = $1 
           AND (u.sub_admin_id = $2 OR u.manager_id IN (SELECT id FROM managers WHERE sub_admin_id = $2))
         FOR UPDATE OF wr, u`,
        [id, req.subAdminId]
      );
    } else {
      withdrawalResult = await client.query(
        `SELECT wr.*, u.id as user_internal_id, u.telegram_id, u.balance_usdt, u.balance_rub, u.first_name
         FROM withdraw_requests wr 
         JOIN users u ON wr.user_id = u.id 
         WHERE wr.id = $1 AND u.manager_id = $2
         FOR UPDATE OF wr, u`,
        [id, req.managerId]
      );
    }
    
    if (withdrawalResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ success: false, error: 'Withdrawal not found' });
    }
    
    const withdrawal = withdrawalResult.rows[0];
    
    if (withdrawal.status !== 'pending') {
      await client.query('ROLLBACK');
      return res.status(400).json({ success: false, error: 'Withdrawal already processed' });
    }
    
    // Determine currency from wallet field (format: "RUB: card" or "USDT: address")
    const isRub = withdrawal.wallet && withdrawal.wallet.toUpperCase().startsWith('RUB');
    const currency = isRub ? 'RUB' : 'USDT';
    const balanceField = isRub ? 'balance_rub' : 'balance_usdt';
    const currentBalance = parseFloat(isRub ? withdrawal.balance_rub : withdrawal.balance_usdt) || 0;
    
    // Return balance to user
    const newBalance = currentBalance + parseFloat(withdrawal.amount);
    
    const updateResult = await client.query(
      `UPDATE users SET ${balanceField} = $1, updated_at = NOW() WHERE id = $2 RETURNING ${balanceField}`,
      [newBalance, withdrawal.user_internal_id]
    );
    
    console.log('💰 Balance updated:', {
      userId: withdrawal.user_internal_id,
      telegramId: withdrawal.telegram_id,
      balanceField,
      newBalance,
      updateResult: updateResult.rows[0]
    });
    
    // Update withdrawal status to rejected
    await client.query(
      'UPDATE withdraw_requests SET status = $1 WHERE id = $2',
      ['rejected', id]
    );
    
    // Send message to user's support chat
    const returnMessage = `❌ Ваша заявка на вывод ${parseFloat(withdrawal.amount).toFixed(2)} ${currency} была отклонена.\n\nСредства возвращены на ваш баланс.\n\nЕсли у вас есть вопросы, напишите нам.`;
    
    await client.query(
      `INSERT INTO support_messages (user_id, sender, message, is_read, created_at) 
       VALUES ($1, 'support', $2, FALSE, NOW())`,
      [withdrawal.user_internal_id, returnMessage]
    );
    
    await client.query('COMMIT');
    
    res.json({
      success: true,
      message: 'Withdrawal returned',
      newBalance,
      currency
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Return withdrawal error:', error);
    res.status(500).json({ success: false, error: 'Server error' });
  } finally {
    client.release();
  }
});

/**
 * PUT /api/admin/user/:telegramId
 * Update user balance and mode (admin or manager for their users)
 */
router.put('/user/:telegramId', adminCheck, async (req, res) => {
  try {
    const { telegramId } = req.params;
    const { balance_usdt, balance_rub, trade_mode, trading_blocked, needs_verification, verified, min_deposit, min_withdraw, min_withdraw_rub, profit_multiplier, expected_balance_usdt } = req.body;
    
    // Check user belongs to admin/sub-admin/manager
    if (!req.isMainAdmin) {
      let userCheck;
      if (req.isSubAdmin) {
        userCheck = await pool.query(
          `SELECT id FROM users WHERE telegram_id = $1 
             AND (sub_admin_id = $2 OR manager_id IN (SELECT id FROM managers WHERE sub_admin_id = $2))`,
          [telegramId, req.subAdminId]
        );
      } else {
        userCheck = await pool.query(
          'SELECT id FROM users WHERE telegram_id = $1 AND manager_id = $2',
          [telegramId, req.managerId]
        );
      }
      if (userCheck.rows.length === 0) {
        return res.status(403).json({ success: false, error: 'Доступ запрещён. Пользователь не принадлежит вам.' });
      }
    }
    
    // Validate
    if (balance_usdt !== undefined && (isNaN(balance_usdt) || balance_usdt < 0)) {
      return res.status(400).json({ success: false, error: 'Invalid balance' });
    }
    
    if (trade_mode && !['win', 'loss'].includes(trade_mode)) {
      return res.status(400).json({ success: false, error: 'Invalid trade mode' });
    }

    if (expected_balance_usdt !== undefined && (isNaN(expected_balance_usdt) || expected_balance_usdt < 0)) {
      return res.status(400).json({ success: false, error: 'Invalid expected balance' });
    }
    
    // Build update query
    const updates = [];
    const values = [];
    let paramIndex = 1;
    
    if (balance_usdt !== undefined) {
      updates.push(`balance_usdt = $${paramIndex++}`);
      values.push(balance_usdt);
    }
    
    if (balance_rub !== undefined) {
      updates.push(`balance_rub = $${paramIndex++}`);
      values.push(parseFloat(balance_rub) || 0);
    }
    
    if (trade_mode) {
      updates.push(`trade_mode = $${paramIndex++}`);
      values.push(trade_mode);
    }
    
    if (trading_blocked !== undefined) {
      updates.push(`trading_blocked = $${paramIndex++}`);
      values.push(trading_blocked);
    }
    
    if (needs_verification !== undefined) {
      updates.push(`needs_verification = $${paramIndex++}`);
      values.push(needs_verification);
    }
    
    if (verified !== undefined) {
      updates.push(`verified = $${paramIndex++}`);
      values.push(verified);
      // Reset pending status when verification is set
      updates.push(`verification_pending = $${paramIndex++}`);
      values.push(false);
    }
    
    if (min_deposit !== undefined) {
      updates.push(`min_deposit = $${paramIndex++}`);
      values.push(parseFloat(min_deposit) || 0);
    }
    
    if (min_withdraw !== undefined) {
      updates.push(`min_withdraw = $${paramIndex++}`);
      values.push(parseFloat(min_withdraw) || 0);
    }
    
    if (min_withdraw_rub !== undefined) {
      updates.push(`min_withdraw_rub = $${paramIndex++}`);
      values.push(parseFloat(min_withdraw_rub) || 0);
    }
    
    if (profit_multiplier !== undefined) {
      const mult = parseFloat(profit_multiplier);
      if (mult >= 0 && mult <= 10) {
        updates.push(`profit_multiplier = $${paramIndex++}`);
        values.push(mult);
      }
    }
    
    if (updates.length === 0) {
      return res.status(400).json({ success: false, error: 'No updates provided' });
    }
    
    updates.push(`updated_at = NOW()`);

    const whereParts = [`telegram_id = $${paramIndex++}`];
    values.push(telegramId);

    // Prevent stale admin forms from overwriting a newer trade settlement balance.
    if (balance_usdt !== undefined && expected_balance_usdt !== undefined) {
      whereParts.push(`ABS(COALESCE(balance_usdt, 0) - $${paramIndex++}) < 0.0000001`);
      values.push(parseFloat(expected_balance_usdt));
    }
    
    const result = await pool.query(
      `UPDATE users SET ${updates.join(', ')} WHERE ${whereParts.join(' AND ')} RETURNING *`,
      values
    );
    
    if (result.rows.length === 0) {
      const existsResult = await pool.query('SELECT id FROM users WHERE telegram_id = $1', [telegramId]);
      if (existsResult.rows.length === 0) {
        return res.status(404).json({ success: false, error: 'User not found' });
      }

      if (balance_usdt !== undefined && expected_balance_usdt !== undefined) {
        return res.status(409).json({
          success: false,
          error: 'Баланс пользователя уже изменился. Обновите карточку и повторите сохранение.'
        });
      }

      return res.status(400).json({ success: false, error: 'Update conflict' });
    }
    
    // Log admin action
    await pool.query(
      `INSERT INTO admin_logs (action, details, created_at) VALUES ($1, $2, NOW())`,
      ['user_update', JSON.stringify({ 
        adminId: req.adminId, 
        telegramId, 
        balance_usdt, 
        trade_mode 
      })]
    );
    
    res.json({
      success: true,
      data: result.rows[0],
      message: 'User updated successfully'
    });
  } catch (error) {
    console.error('Admin update error:', error);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

/**
 * POST /api/admin/user/:telegramId/block
 * Block or unblock user
 */
router.post('/user/:telegramId/block', adminCheck, async (req, res) => {
  try {
    const { telegramId } = req.params;
    const { blocked } = req.body; // true = block, false = unblock
    
    // Get user info with permission check
    let userResult;
    if (req.isMainAdmin) {
      userResult = await pool.query(
        'SELECT id, first_name, username, is_blocked FROM users WHERE telegram_id = $1',
        [telegramId]
      );
    } else if (req.isSubAdmin) {
      userResult = await pool.query(
        `SELECT id, first_name, username, is_blocked FROM users 
         WHERE telegram_id = $1 
           AND (sub_admin_id = $2 OR manager_id IN (SELECT id FROM managers WHERE sub_admin_id = $2))`,
        [telegramId, req.subAdminId]
      );
    } else {
      userResult = await pool.query(
        'SELECT id, first_name, username, is_blocked FROM users WHERE telegram_id = $1 AND manager_id = $2',
        [telegramId, req.managerId]
      );
    }
    
    if (userResult.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'User not found' });
    }
    
    const user = userResult.rows[0];
    const name = user.first_name || user.username || 'User';
    
    // Add column if not exists
    await pool.query(`
      ALTER TABLE users ADD COLUMN IF NOT EXISTS is_blocked BOOLEAN DEFAULT FALSE
    `);
    
    // Update block status
    await pool.query(
      'UPDATE users SET is_blocked = $1 WHERE telegram_id = $2',
      [blocked, telegramId]
    );
    
    // Send notification to user
    try {
      const { getBot } = require('../bot');
      const mainBot = getBot();
      if (mainBot) {
        if (blocked) {
          await mainBot.sendMessage(telegramId, 
            '⛔ Ваш аккаунт был заблокирован администратором.\n\n' +
            'Для получения информации обратитесь в поддержку.'
          );
        } else {
          await mainBot.sendMessage(telegramId, 
            '✅ Ваш аккаунт был разблокирован.\n\n' +
            'Добро пожаловать обратно!'
          );
        }
      }
    } catch (e) {
      console.log('Could not notify user:', e.message);
    }
    
    // Log admin action
    await pool.query(
      `INSERT INTO admin_logs (action, details, created_at) VALUES ($1, $2, NOW())`,
      [blocked ? 'user_block' : 'user_unblock', JSON.stringify({ adminId: req.adminId, telegramId, userName: name })]
    );
    
    console.log(`${blocked ? '⛔' : '✅'} Admin ${req.adminId} ${blocked ? 'blocked' : 'unblocked'} user ${telegramId} (${name})`);
    
    res.json({
      success: true,
      message: blocked ? `Пользователь ${name} заблокирован` : `Пользователь ${name} разблокирован`
    });
  } catch (error) {
    console.error('Admin block error:', error);
    res.status(500).json({ success: false, error: 'Server error: ' + error.message });
  }
});

/**
 * GET /api/admin/transactions
 * Get recent transactions
 */
router.get('/transactions', adminCheck, async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 50;
    
    let query;
    let params;
    
    if (req.isMainAdmin) {
      query = `
        SELECT t.*, u.telegram_id, u.first_name, u.username
        FROM transactions t
        JOIN users u ON t.user_id = u.id
        ORDER BY t.created_at DESC
        LIMIT $1
      `;
      params = [limit];
    } else if (req.isSubAdmin) {
      query = `
        SELECT t.*, u.telegram_id, u.first_name, u.username
        FROM transactions t
        JOIN users u ON t.user_id = u.id
        WHERE u.sub_admin_id = $1
           OR u.manager_id IN (SELECT id FROM managers WHERE sub_admin_id = $1)
        ORDER BY t.created_at DESC
        LIMIT $2
      `;
      params = [req.subAdminId, limit];
    } else {
      query = `
        SELECT t.*, u.telegram_id, u.first_name, u.username
        FROM transactions t
        JOIN users u ON t.user_id = u.id
        WHERE u.manager_id = $1
        ORDER BY t.created_at DESC
        LIMIT $2
      `;
      params = [req.managerId, limit];
    }
    
    const result = await pool.query(query, params);
    
    res.json({
      success: true,
      data: result.rows
    });
  } catch (error) {
    console.error('Admin transactions error:', error);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

/**
 * GET /api/admin/deposits
 * Get pending deposit requests
 */
router.get('/deposits', adminCheck, async (req, res) => {
  try {
    let query;
    let params = [];
    
    if (req.isMainAdmin) {
      query = `
        SELECT d.*, u.telegram_id, u.first_name, u.username
        FROM deposit_requests d
        JOIN users u ON d.user_id = u.id
        WHERE d.status = 'pending'
        ORDER BY d.created_at DESC
      `;
    } else if (req.isSubAdmin) {
      query = `
        SELECT d.*, u.telegram_id, u.first_name, u.username
        FROM deposit_requests d
        JOIN users u ON d.user_id = u.id
        WHERE d.status = 'pending' 
          AND (u.sub_admin_id = $1 OR u.manager_id IN (SELECT id FROM managers WHERE sub_admin_id = $1))
        ORDER BY d.created_at DESC
      `;
      params = [req.subAdminId];
    } else {
      query = `
        SELECT d.*, u.telegram_id, u.first_name, u.username
        FROM deposit_requests d
        JOIN users u ON d.user_id = u.id
        WHERE d.status = 'pending' AND u.manager_id = $1
        ORDER BY d.created_at DESC
      `;
      params = [req.managerId];
    }
    
    const result = await pool.query(query, params);
    
    res.json({
      success: true,
      data: result.rows
    });
  } catch (error) {
    console.error('Admin deposits error:', error);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

/**
 * POST /api/admin/deposits/:id/approve
 * Approve deposit request
 */
router.post('/deposits/:id/approve', adminCheck, async (req, res) => {
  const client = await pool.connect();
  
  try {
    const { id } = req.params;
    
    await client.query('BEGIN');
    
    // Get deposit request with role check - lock the row to prevent double approval
    let depositResult;
    if (req.isMainAdmin) {
      depositResult = await client.query(
        'SELECT d.* FROM deposit_requests d WHERE d.id = $1 AND d.status = $2 FOR UPDATE',
        [id, 'pending']
      );
    } else if (req.isSubAdmin) {
      depositResult = await client.query(
        `SELECT d.* FROM deposit_requests d 
         JOIN users u ON d.user_id = u.id
         WHERE d.id = $1 AND d.status = $2 
           AND (u.sub_admin_id = $3 OR u.manager_id IN (SELECT id FROM managers WHERE sub_admin_id = $3))
         FOR UPDATE OF d`,
        [id, 'pending', req.subAdminId]
      );
    } else {
      depositResult = await client.query(
        `SELECT d.* FROM deposit_requests d 
         JOIN users u ON d.user_id = u.id
         WHERE d.id = $1 AND d.status = $2 AND u.manager_id = $3
         FOR UPDATE OF d`,
        [id, 'pending', req.managerId]
      );
    }
    
    if (depositResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ success: false, error: 'Deposit not found or already processed' });
    }
    
    const deposit = depositResult.rows[0];
    
    // Update user balance
    await client.query(
      'UPDATE users SET balance_usdt = balance_usdt + $1, updated_at = NOW() WHERE id = $2',
      [deposit.amount, deposit.user_id]
    );
    
    // Update deposit status
    await client.query(
      'UPDATE deposit_requests SET status = $1, approved_at = NOW() WHERE id = $2',
      ['approved', id]
    );
    
    // Create transaction record
    await client.query(
      `INSERT INTO transactions (user_id, amount, currency, type, description, created_at)
       VALUES ($1, $2, 'USDT', 'deposit', 'Пополнение одобрено админом', NOW())`,
      [deposit.user_id, deposit.amount]
    );
    
    await client.query('COMMIT');
    
    res.json({
      success: true,
      message: 'Deposit approved'
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Approve deposit error:', error);
    res.status(500).json({ success: false, error: 'Server error' });
  } finally {
    client.release();
  }
});

/**
 * POST /api/admin/deposits/:id/reject
 * Reject deposit request
 */
router.post('/deposits/:id/reject', adminCheck, async (req, res) => {
  try {
    const { id } = req.params;
    
    let result;
    if (req.isMainAdmin) {
      result = await pool.query(
        'UPDATE deposit_requests SET status = $1 WHERE id = $2 AND status = $3 RETURNING *',
        ['rejected', id, 'pending']
      );
    } else if (req.isSubAdmin) {
      // Sub-admin can reject deposits from their users
      result = await pool.query(
        `UPDATE deposit_requests SET status = $1 
         WHERE id = $2 AND status = $3 
         AND user_id IN (
           SELECT id FROM users WHERE sub_admin_id = $4 
           OR manager_id IN (SELECT id FROM managers WHERE sub_admin_id = $4)
         )
         RETURNING *`,
        ['rejected', id, 'pending', req.subAdminId]
      );
    } else {
      // Manager can only reject their users' deposits
      result = await pool.query(
        `UPDATE deposit_requests SET status = $1 
         WHERE id = $2 AND status = $3 
         AND user_id IN (SELECT id FROM users WHERE manager_id = $4)
         RETURNING *`,
        ['rejected', id, 'pending', req.managerId]
      );
    }
    
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Deposit not found' });
    }
    
    res.json({
      success: true,
      message: 'Deposit rejected'
    });
  } catch (error) {
    console.error('Reject deposit error:', error);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

// ==================== SUPPORT CHAT ====================

/**
 * GET /api/admin/chat/:telegramId
 * Get chat messages with user
 */
router.get('/chat/:telegramId', adminCheck, async (req, res) => {
  try {
    const { telegramId } = req.params;
    
    // Get user with role check
    let userResult;
    if (req.isMainAdmin) {
      userResult = await pool.query(
        'SELECT id, telegram_id, first_name, username FROM users WHERE telegram_id = $1',
        [telegramId]
      );
    } else if (req.isSubAdmin) {
      userResult = await pool.query(
        `SELECT id, telegram_id, first_name, username FROM users 
         WHERE telegram_id = $1 
           AND (sub_admin_id = $2 OR manager_id IN (SELECT id FROM managers WHERE sub_admin_id = $2))`,
        [telegramId, req.subAdminId]
      );
    } else {
      userResult = await pool.query(
        'SELECT id, telegram_id, first_name, username FROM users WHERE telegram_id = $1 AND manager_id = $2',
        [telegramId, req.managerId]
      );
    }
    
    if (userResult.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'User not found' });
    }
    
    const user = userResult.rows[0];
    
    // Get messages (last 200, then reverse to show in chronological order)
    const messagesResult = await pool.query(
      `SELECT * FROM support_messages 
       WHERE user_id = $1 
       ORDER BY created_at DESC 
       LIMIT 200`,
      [user.id]
    );
    
    // Reverse to chronological order
    const messages = messagesResult.rows.reverse();
    
    // Mark admin messages as read (for user's perspective)
    await pool.query(
      `UPDATE support_messages SET is_read = TRUE 
       WHERE user_id = $1 AND sender = 'user'`,
      [user.id]
    );
    
    res.json({
      success: true,
      data: {
        user: {
          id: user.id,
          telegram_id: user.telegram_id,
          name: user.first_name || user.username || 'User'
        },
        messages: messages
      }
    });
  } catch (error) {
    console.error('Get chat error:', error);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

/**
 * POST /api/admin/chat/:telegramId
 * Send message to user (admin -> user)
 */
router.post('/chat/:telegramId', adminCheck, async (req, res) => {
  try {
    const { telegramId } = req.params;
    const { message } = req.body;
    
    if (!message || !message.trim()) {
      return res.status(400).json({ success: false, error: 'Message is required' });
    }
    
    // Get user with role check
    let userResult;
    if (req.isMainAdmin) {
      userResult = await pool.query(
        'SELECT id, telegram_id FROM users WHERE telegram_id = $1',
        [telegramId]
      );
    } else if (req.isSubAdmin) {
      userResult = await pool.query(
        `SELECT id, telegram_id FROM users 
         WHERE telegram_id = $1 
           AND (sub_admin_id = $2 OR manager_id IN (SELECT id FROM managers WHERE sub_admin_id = $2))`,
        [telegramId, req.subAdminId]
      );
    } else {
      userResult = await pool.query(
        'SELECT id, telegram_id FROM users WHERE telegram_id = $1 AND manager_id = $2',
        [telegramId, req.managerId]
      );
    }
    
    if (userResult.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'User not found' });
    }
    
    const user = userResult.rows[0];
    
    // Save message to DB
    const msgResult = await pool.query(
      `INSERT INTO support_messages (user_id, sender, message, created_at)
       VALUES ($1, 'admin', $2, NOW())
       RETURNING *`,
      [user.id, message.trim()]
    );
    
    // Send message to user via Telegram bot
    let telegramSent = false;
    let telegramError = null;
    try {
      const { getBot } = require('../bot');
      const userBot = getBot();
      
      if (userBot) {
        await userBot.sendMessage(user.telegram_id, `💬 *Ответ от поддержки:*\n\n${message.trim()}`, { 
          parse_mode: 'Markdown' 
        });
        telegramSent = true;
      }
    } catch (notifyError) {
      console.error(`Failed to send message to user ${user.telegram_id}:`, notifyError.message);
      telegramError = notifyError.message;
      // Telegram blocked by user or chat not started
    }
    
    res.json({
      success: true,
      data: msgResult.rows[0],
      telegram_sent: telegramSent,
      telegram_error: telegramError
    });
  } catch (error) {
    console.error('Send message error:', error);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

/**
 * PUT /api/admin/chat/message/:messageId
 * Edit admin's own message (admin only)
 */
router.put('/chat/message/:messageId', adminCheck, async (req, res) => {
  try {
    const { messageId } = req.params;
    const { message } = req.body;
    
    if (!message || !message.trim()) {
      return res.status(400).json({ success: false, error: 'Message is required' });
    }
    
    // Only allow editing admin messages
    const checkResult = await pool.query(
      `SELECT sm.*, u.telegram_id 
       FROM support_messages sm 
       JOIN users u ON sm.user_id = u.id 
       WHERE sm.id = $1 AND sm.sender = 'admin'`,
      [messageId]
    );
    
    if (checkResult.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Message not found or not editable' });
    }
    
    const oldMessage = checkResult.rows[0];
    
    // Update message
    const updateResult = await pool.query(
      `UPDATE support_messages 
       SET message = $1, edited_at = NOW() 
       WHERE id = $2 
       RETURNING *`,
      [message.trim(), messageId]
    );
    
    res.json({
      success: true,
      data: updateResult.rows[0]
    });
  } catch (error) {
    console.error('Edit message error:', error);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

/**
 * GET /api/admin/chats
 * Get list of all chats with unread count
 */
router.get('/chats', adminCheck, async (req, res) => {
  try {
    let query;
    let params = [];
    
    if (req.isMainAdmin) {
      query = `
        SELECT 
          u.id, u.telegram_id, u.first_name, u.username,
          COUNT(sm.id) FILTER (WHERE sm.sender = 'user' AND sm.is_read = FALSE) as unread_count,
          MAX(sm.created_at) as last_message_at,
          (SELECT message FROM support_messages WHERE user_id = u.id ORDER BY created_at DESC LIMIT 1) as last_message
        FROM users u
        LEFT JOIN support_messages sm ON u.id = sm.user_id
        GROUP BY u.id, u.telegram_id, u.first_name, u.username
        HAVING COUNT(sm.id) > 0
        ORDER BY MAX(sm.created_at) DESC NULLS LAST
      `;
    } else if (req.isSubAdmin) {
      // Sub-admin sees chats of their users and their managers' users
      query = `
        SELECT 
          u.id, u.telegram_id, u.first_name, u.username,
          COUNT(sm.id) FILTER (WHERE sm.sender = 'user' AND sm.is_read = FALSE) as unread_count,
          MAX(sm.created_at) as last_message_at,
          (SELECT message FROM support_messages WHERE user_id = u.id ORDER BY created_at DESC LIMIT 1) as last_message
        FROM users u
        LEFT JOIN support_messages sm ON u.id = sm.user_id
        WHERE u.sub_admin_id = $1
           OR u.manager_id IN (SELECT id FROM managers WHERE sub_admin_id = $1)
        GROUP BY u.id, u.telegram_id, u.first_name, u.username
        HAVING COUNT(sm.id) > 0
        ORDER BY MAX(sm.created_at) DESC NULLS LAST
      `;
      params = [req.subAdminId];
    } else {
      query = `
        SELECT 
          u.id, u.telegram_id, u.first_name, u.username,
          COUNT(sm.id) FILTER (WHERE sm.sender = 'user' AND sm.is_read = FALSE) as unread_count,
          MAX(sm.created_at) as last_message_at,
          (SELECT message FROM support_messages WHERE user_id = u.id ORDER BY created_at DESC LIMIT 1) as last_message
        FROM users u
        LEFT JOIN support_messages sm ON u.id = sm.user_id
        WHERE u.manager_id = $1
        GROUP BY u.id, u.telegram_id, u.first_name, u.username
        HAVING COUNT(sm.id) > 0
        ORDER BY MAX(sm.created_at) DESC NULLS LAST
      `;
      params = [req.managerId];
    }
    
    const result = await pool.query(query, params);
    
    res.json({
      success: true,
      data: result.rows
    });
  } catch (error) {
    console.error('Get chats error:', error);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

/**
 * GET /api/admin/invoices
 * Get pending invoices
 */
router.get('/invoices', adminCheck, async (req, res) => {
  try {
    let query;
    let params = [];
    
    if (req.isMainAdmin) {
      // Main admin sees all invoices
      query = `
        SELECT 
          ci.id, ci.invoice_id, ci.amount, ci.asset, ci.status, ci.pay_url, ci.created_at, ci.paid_at,
          u.telegram_id, u.first_name, u.username
        FROM crypto_invoices ci
        JOIN users u ON ci.user_id = u.id
        ORDER BY ci.created_at DESC
        LIMIT 50
      `;
    } else if (req.isSubAdmin) {
      // Sub-admin sees invoices of their users and their managers' users
      query = `
        SELECT 
          ci.id, ci.invoice_id, ci.amount, ci.asset, ci.status, ci.pay_url, ci.created_at, ci.paid_at,
          u.telegram_id, u.first_name, u.username
        FROM crypto_invoices ci
        JOIN users u ON ci.user_id = u.id
        WHERE u.sub_admin_id = $1
           OR u.manager_id IN (SELECT id FROM managers WHERE sub_admin_id = $1)
        ORDER BY ci.created_at DESC
        LIMIT 50
      `;
      params = [req.subAdminId];
    } else {
      // Manager sees only their users' invoices
      query = `
        SELECT 
          ci.id, ci.invoice_id, ci.amount, ci.asset, ci.status, ci.pay_url, ci.created_at, ci.paid_at,
          u.telegram_id, u.first_name, u.username
        FROM crypto_invoices ci
        JOIN users u ON ci.user_id = u.id
        WHERE u.manager_id = $1
        ORDER BY ci.created_at DESC
        LIMIT 50
      `;
      params = [req.managerId];
    }
    
    const result = await pool.query(query, params);
    
    res.json({
      success: true,
      data: result.rows
    });
  } catch (error) {
    console.error('Get invoices error:', error);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

/**
 * POST /api/admin/invoices/:invoiceId/confirm
 * Confirm invoice payment manually
 */
router.post('/invoices/:invoiceId/confirm', adminCheck, async (req, res) => {
  const client = await pool.connect();
  try {
    const { invoiceId } = req.params;
    
    await client.query('BEGIN');
    
    // Get invoice with role check - lock to prevent double credit
    let invoiceResult;
    if (req.isMainAdmin) {
      invoiceResult = await client.query(
        'SELECT ci.*, u.telegram_id, u.first_name FROM crypto_invoices ci JOIN users u ON ci.user_id = u.id WHERE ci.invoice_id = $1 FOR UPDATE OF ci',
        [invoiceId]
      );
    } else if (req.isSubAdmin) {
      // Sub-admin can confirm invoices of their users or their managers' users
      invoiceResult = await client.query(
        `SELECT ci.*, u.telegram_id, u.first_name FROM crypto_invoices ci 
         JOIN users u ON ci.user_id = u.id 
         WHERE ci.invoice_id = $1 
           AND (u.sub_admin_id = $2 OR u.manager_id IN (SELECT id FROM managers WHERE sub_admin_id = $2))
         FOR UPDATE OF ci`,
        [invoiceId, req.subAdminId]
      );
    } else {
      // Manager can only confirm invoices of their users
      invoiceResult = await client.query(
        'SELECT ci.*, u.telegram_id, u.first_name FROM crypto_invoices ci JOIN users u ON ci.user_id = u.id WHERE ci.invoice_id = $1 AND u.manager_id = $2 FOR UPDATE OF ci',
        [invoiceId, req.managerId]
      );
    }
    
    if (invoiceResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ success: false, error: 'Инвойс не найден' });
    }
    
    const invoice = invoiceResult.rows[0];
    
    if (invoice.status === 'paid') {
      await client.query('ROLLBACK');
      return res.status(400).json({ success: false, error: 'Уже оплачен' });
    }
    
    const paidAmount = parseFloat(invoice.amount);
    
    // Update invoice status
    await client.query(
      'UPDATE crypto_invoices SET status = $1, paid_at = NOW() WHERE invoice_id = $2',
      ['paid', invoiceId]
    );
    
    // Credit user balance
    await client.query(
      'UPDATE users SET balance_usdt = balance_usdt + $1, updated_at = NOW() WHERE id = $2',
      [paidAmount, invoice.user_id]
    );
    
    // Create transaction record
    await client.query(
      `INSERT INTO transactions (user_id, amount, currency, type, description, created_at)
       VALUES ($1, $2, 'USDT', 'deposit', $3, NOW())`,
      [invoice.user_id, paidAmount, `Пополнение (подтверждено админом): ${paidAmount} USDT`]
    );
    
    await client.query('COMMIT');
    
    // Notify user via main bot (outside transaction)
    try {
      const { getBot } = require('../bot');
      const bot = getBot();
      if (bot) {
        await bot.sendMessage(invoice.telegram_id, 
          `✅ Пополнение подтверждено!\n\n💰 Сумма: ${paidAmount} USDT\n\nБаланс обновлён. Приятной торговли!`
        );
      }
    } catch (botError) {
      console.error('Failed to notify user:', botError.message);
    }
    
    console.log(`✅ Admin confirmed invoice ${invoiceId} for user ${invoice.telegram_id}, credited ${paidAmount} USDT`);
    
    res.json({
      success: true,
      message: 'Оплата подтверждена'
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Confirm invoice error:', error);
    res.status(500).json({ success: false, error: 'Server error' });
  } finally {
    client.release();
  }
});

// ==================== MANAGER MANAGEMENT (Main Admin Only) ====================

/**
 * GET /api/admin/managers
 * Get all managers (main admin sees all, sub-admin sees their own)
 */
router.get('/managers', adminCheck, async (req, res) => {
  try {
    // Only main admin and sub-admin can access managers
    if (!req.isMainAdmin && !req.isSubAdmin) {
      return res.status(403).json({ success: false, error: 'Доступ запрещён' });
    }
    
    let query;
    let params = [];
    
    if (req.isMainAdmin) {
      // Main admin sees all managers with sub_admin info
      query = `
        SELECT 
          m.id, m.telegram_id, m.name, m.ref_code, m.created_at, m.sub_admin_id,
          COUNT(u.id) as users_count,
          sa.name as sub_admin_name
        FROM managers m
        LEFT JOIN users u ON u.manager_id = m.id
        LEFT JOIN sub_admins sa ON m.sub_admin_id = sa.id
        GROUP BY m.id, sa.name
        ORDER BY m.created_at DESC
      `;
    } else {
      // Sub-admin sees only their managers
      query = `
        SELECT 
          m.id, m.telegram_id, m.name, m.ref_code, m.created_at,
          COUNT(u.id) as users_count
        FROM managers m
        LEFT JOIN users u ON u.manager_id = m.id
        WHERE m.sub_admin_id = $1
        GROUP BY m.id
        ORDER BY m.created_at DESC
      `;
      params = [req.subAdminId];
    }
    
    const result = await pool.query(query, params);
    
    // Add ref_link to each manager
    const managers = result.rows.map(m => ({
      ...m,
      ref_link: m.ref_code ? `https://t.me/trustEx_ru_bot?start=ref_${m.ref_code}` : null
    }));
    
    res.json({
      success: true,
      data: managers
    });
  } catch (error) {
    console.error('Get managers error:', error);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

/**
 * GET /api/admin/managers/:managerId/users
 * Get users of a specific manager (main admin or sub-admin for their managers)
 */
router.get('/managers/:managerId/users', adminCheck, async (req, res) => {
  try {
    // Only main admin and sub-admin can access
    if (!req.isMainAdmin && !req.isSubAdmin) {
      return res.status(403).json({ success: false, error: 'Доступ запрещён' });
    }
    
    const { managerId } = req.params;
    
    // Get manager info first with permission check
    let managerResult;
    if (req.isMainAdmin) {
      managerResult = await pool.query(
        'SELECT id, telegram_id, name FROM managers WHERE id = $1',
        [managerId]
      );
    } else {
      // Sub-admin can only see their managers
      managerResult = await pool.query(
        'SELECT id, telegram_id, name FROM managers WHERE id = $1 AND sub_admin_id = $2',
        [managerId, req.subAdminId]
      );
    }
    
    if (managerResult.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Менеджер не найден' });
    }
    
    const manager = managerResult.rows[0];
    
    // Get users of this manager
    const usersResult = await pool.query(`
      SELECT 
        u.id, u.telegram_id, u.first_name, u.username, u.balance_usdt, u.balance_rub,
        COALESCE(u.trade_mode, 'loss') as trade_mode, u.created_at
      FROM users u
      WHERE u.manager_id = $1
      ORDER BY u.created_at DESC
    `, [managerId]);
    
    res.json({
      success: true,
      manager: manager,
      data: usersResult.rows
    });
  } catch (error) {
    console.error('Get manager users error:', error);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

/**
 * Generate unique ref code
 */
function generateRefCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 8; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

/**
 * POST /api/admin/managers
 * Add new manager (main admin or sub-admin adds their own)
 */
router.post('/managers', adminCheck, async (req, res) => {
  try {
    // Only main admin and sub-admin can add managers
    if (!req.isMainAdmin && !req.isSubAdmin) {
      return res.status(403).json({ success: false, error: 'Доступ запрещён' });
    }
    
    const { telegram_id, name } = req.body;
    
    if (!telegram_id) {
      return res.status(400).json({ success: false, error: 'Telegram ID обязателен' });
    }
    
    // Check if already exists
    const existing = await pool.query(
      'SELECT id, sub_admin_id FROM managers WHERE telegram_id = $1',
      [String(telegram_id)]
    );
    
    if (existing.rows.length > 0) {
      const existingManager = existing.rows[0];
      const existingSubAdminId = existingManager.sub_admin_id;
      
      // If sub-admin trying to add and manager has no owner - assign to this sub-admin
      if (req.isSubAdmin && existingSubAdminId === null) {
        const updated = await pool.query(
          'UPDATE managers SET sub_admin_id = $1, name = COALESCE($2, name) WHERE id = $3 RETURNING *',
          [req.subAdminId, name, existingManager.id]
        );
        console.log(`✅ Manager ${telegram_id} assigned to sub-admin ${req.subAdminId}`);
        return res.json({
          success: true,
          data: updated.rows[0],
          message: 'Менеджер привязан к вам'
        });
      }
      
      // If manager already belongs to this sub-admin (compare as numbers)
      if (req.isSubAdmin && parseInt(existingSubAdminId) === parseInt(req.subAdminId)) {
        return res.status(400).json({ success: false, error: 'Этот менеджер уже ваш' });
      }
      
      // If manager belongs to another sub-admin
      if (existingSubAdminId !== null) {
        return res.status(400).json({ success: false, error: 'Менеджер уже принадлежит другому суб-админу' });
      }
      
      return res.status(400).json({ success: false, error: 'Менеджер уже существует' });
    }
    
    // Generate unique ref code
    let refCode = generateRefCode();
    let attempts = 0;
    while (attempts < 10) {
      const codeExists = await pool.query('SELECT id FROM managers WHERE ref_code = $1', [refCode]);
      if (codeExists.rows.length === 0) break;
      refCode = generateRefCode();
      attempts++;
    }
    
    // Sub-admin's managers get sub_admin_id set
    const subAdminId = req.isSubAdmin ? req.subAdminId : null;
    
    const result = await pool.query(
      'INSERT INTO managers (telegram_id, name, ref_code, sub_admin_id) VALUES ($1, $2, $3, $4) RETURNING *',
      [String(telegram_id), name || `Менеджер ${telegram_id}`, refCode, subAdminId]
    );
    
    res.json({
      success: true,
      data: result.rows[0]
    });
  } catch (error) {
    console.error('Add manager error:', error);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

/**
 * DELETE /api/admin/managers/:managerId
 * Remove manager (main admin or sub-admin for their managers)
 */
router.delete('/managers/:managerId', adminCheck, async (req, res) => {
  try {
    // Only main admin and sub-admin can delete managers
    if (!req.isMainAdmin && !req.isSubAdmin) {
      return res.status(403).json({ success: false, error: 'Доступ запрещён' });
    }
    
    const { managerId } = req.params;
    
    // Check permission for sub-admin
    if (req.isSubAdmin) {
      const check = await pool.query(
        'SELECT id FROM managers WHERE id = $1 AND sub_admin_id = $2',
        [managerId, req.subAdminId]
      );
      if (check.rows.length === 0) {
        return res.status(403).json({ success: false, error: 'Нет доступа к этому менеджеру' });
      }
    }
    
    // Unlink users from this manager
    await pool.query(
      'UPDATE users SET manager_id = NULL WHERE manager_id = $1',
      [managerId]
    );
    
    await pool.query(
      'DELETE FROM managers WHERE id = $1',
      [managerId]
    );
    
    res.json({
      success: true,
      message: 'Менеджер удалён'
    });
  } catch (error) {
    console.error('Delete manager error:', error);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

/**
 * POST /api/admin/users/:telegramId/assign
 * Assign user to manager (main admin only)
 */
router.post('/user/:telegramId/assign', adminCheck, mainAdminOnly, async (req, res) => {
  try {
    const { telegramId } = req.params;
    const { managerId } = req.body;
    
    await pool.query(
      'UPDATE users SET manager_id = $1 WHERE telegram_id = $2',
      [managerId || null, telegramId]
    );
    
    res.json({
      success: true,
      message: managerId ? 'Пользователь привязан' : 'Привязка удалена'
    });
  } catch (error) {
    console.error('Assign user error:', error);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

// =============================================
// MESSAGE TEMPLATES ENDPOINTS
// =============================================

/**
 * GET /api/admin/templates
 * Get message templates (global + personal)
 * Main admin sees all global templates
 * Managers see global templates + their own personal templates
 */
router.get('/templates', adminCheck, async (req, res) => {
  try {
    const adminId = req.adminId;
    const isMainAdmin = req.isMainAdmin;
    
    // Get global templates (owner_id IS NULL) + personal templates (owner_id = adminId)
    const result = await pool.query(
      `SELECT id, title, message, owner_id, created_at,
              CASE WHEN owner_id IS NULL THEN true ELSE false END as is_global
       FROM message_templates 
       WHERE owner_id IS NULL OR owner_id = $1
       ORDER BY is_global DESC, created_at DESC`,
      [adminId]
    );
    
    res.json({
      success: true,
      data: result.rows,
      isMainAdmin
    });
  } catch (error) {
    console.error('Get templates error:', error);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

/**
 * POST /api/admin/templates
 * Create new message template
 * Main admin creates global templates (owner_id = NULL)
 * Managers create personal templates (owner_id = their telegram_id)
 */
router.post('/templates', adminCheck, async (req, res) => {
  try {
    const { title, message } = req.body;
    const adminId = req.adminId;
    const isMainAdmin = req.isMainAdmin;
    
    if (!title || !message) {
      return res.status(400).json({ success: false, error: 'Title and message required' });
    }
    
    // Main admin creates global templates, managers create personal
    const ownerId = isMainAdmin ? null : adminId;
    
    const result = await pool.query(
      'INSERT INTO message_templates (title, message, created_by, owner_id) VALUES ($1, $2, $3, $4) RETURNING *',
      [title.trim(), message.trim(), adminId, ownerId]
    );
    
    res.json({
      success: true,
      data: result.rows[0]
    });
  } catch (error) {
    console.error('Create template error:', error);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

/**
 * DELETE /api/admin/templates/:id
 * Delete message template
 * Main admin can delete any template
 * Managers can only delete their own templates
 */
router.delete('/templates/:id', adminCheck, async (req, res) => {
  try {
    const { id } = req.params;
    const adminId = req.adminId;
    const isMainAdmin = req.isMainAdmin;
    
    if (isMainAdmin) {
      // Main admin can delete any template
      await pool.query('DELETE FROM message_templates WHERE id = $1', [id]);
    } else {
      // Managers can only delete their own templates
      const result = await pool.query(
        'DELETE FROM message_templates WHERE id = $1 AND owner_id = $2',
        [id, adminId]
      );
      
      if (result.rowCount === 0) {
        return res.status(403).json({ success: false, error: 'Cannot delete this template' });
      }
    }
    
    res.json({
      success: true,
      message: 'Template deleted'
    });
  } catch (error) {
    console.error('Delete template error:', error);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

// ==================== SUB-ADMIN MANAGEMENT (Main Admin Only) ====================

/**
 * GET /api/admin/subadmins
 * Get all sub-admins (main admin only)
 */
router.get('/subadmins', adminCheck, mainAdminOnly, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        sa.id, sa.telegram_id, sa.name, sa.ref_code, sa.created_at,
        (SELECT COUNT(*) FROM managers m WHERE m.sub_admin_id = sa.id) as managers_count,
        (SELECT COUNT(*) FROM users u WHERE u.sub_admin_id = sa.id 
           OR u.manager_id IN (SELECT id FROM managers WHERE sub_admin_id = sa.id)) as users_count
      FROM sub_admins sa
      ORDER BY sa.created_at DESC
    `);
    
    // Add ref_link to each sub-admin
    const subAdmins = result.rows.map(sa => ({
      ...sa,
      ref_link: sa.ref_code ? `https://t.me/trustEx_ru_bot?start=ref_${sa.ref_code}` : null
    }));
    
    res.json({
      success: true,
      data: subAdmins
    });
  } catch (error) {
    console.error('Get sub-admins error:', error);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

/**
 * GET /api/admin/subadmins/:id/users
 * Get users belonging to a specific sub-admin (main admin only)
 */
router.get('/subadmins/:id/users', adminCheck, mainAdminOnly, async (req, res) => {
  try {
    const subAdminId = req.params.id;
    
    const result = await pool.query(`
      SELECT 
        u.id, u.telegram_id, u.first_name, u.last_name, u.username,
        u.balance_usdt, u.balance_rub, u.trade_mode, u.is_blocked, u.created_at,
        m.name as manager_name
      FROM users u
      LEFT JOIN managers m ON u.manager_id = m.id
      WHERE u.sub_admin_id = $1 
        OR u.manager_id IN (SELECT id FROM managers WHERE sub_admin_id = $1)
      ORDER BY u.created_at DESC
    `, [subAdminId]);
    
    res.json({ success: true, data: result.rows });
  } catch (error) {
    console.error('Get sub-admin users error:', error);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

/**
 * GET /api/admin/subadmins/:id/managers
 * Get managers belonging to a specific sub-admin (main admin only)
 */
router.get('/subadmins/:id/managers', adminCheck, mainAdminOnly, async (req, res) => {
  try {
    const subAdminId = req.params.id;
    
    const result = await pool.query(`
      SELECT 
        m.id, m.telegram_id, m.name, m.created_at,
        (SELECT COUNT(*) FROM users u WHERE u.manager_id = m.id) as users_count
      FROM managers m
      WHERE m.sub_admin_id = $1
      ORDER BY m.created_at DESC
    `, [subAdminId]);
    
    res.json({ success: true, data: result.rows });
  } catch (error) {
    console.error('Get sub-admin managers error:', error);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

/**
 * POST /api/admin/subadmins
 * Add new sub-admin (main admin only)
 */
router.post('/subadmins', adminCheck, mainAdminOnly, async (req, res) => {
  try {
    const { telegram_id, name } = req.body;
    
    if (!telegram_id) {
      return res.status(400).json({ success: false, error: 'Telegram ID обязателен' });
    }
    
    // Check if already exists as sub-admin
    const existingSubAdmin = await pool.query(
      'SELECT id FROM sub_admins WHERE telegram_id = $1',
      [String(telegram_id)]
    );
    
    if (existingSubAdmin.rows.length > 0) {
      return res.status(400).json({ success: false, error: 'Суб-админ уже существует' });
    }
    
    // Check if already exists as manager
    const existingManager = await pool.query(
      'SELECT id FROM managers WHERE telegram_id = $1',
      [String(telegram_id)]
    );
    
    if (existingManager.rows.length > 0) {
      return res.status(400).json({ success: false, error: 'Этот пользователь уже является менеджером' });
    }
    
    // Generate unique ref code
    let refCode = generateRefCode();
    let attempts = 0;
    while (attempts < 10) {
      // Check both managers and sub_admins tables
      const codeExistsM = await pool.query('SELECT id FROM managers WHERE ref_code = $1', [refCode]);
      const codeExistsSA = await pool.query('SELECT id FROM sub_admins WHERE ref_code = $1', [refCode]);
      if (codeExistsM.rows.length === 0 && codeExistsSA.rows.length === 0) break;
      refCode = generateRefCode();
      attempts++;
    }
    
    const result = await pool.query(
      'INSERT INTO sub_admins (telegram_id, name, ref_code) VALUES ($1, $2, $3) RETURNING *',
      [String(telegram_id), name || `Суб-админ ${telegram_id}`, refCode]
    );
    
    console.log(`✅ Sub-admin added: ${telegram_id} with ref_code: ${refCode}`);
    
    res.json({
      success: true,
      data: {
        ...result.rows[0],
        ref_link: `https://t.me/trustEx_ru_bot?start=ref_${refCode}`
      }
    });
  } catch (error) {
    console.error('Add sub-admin error:', error);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

/**
 * DELETE /api/admin/subadmins/:subAdminId
 * Remove sub-admin (main admin only)
 */
router.delete('/subadmins/:subAdminId', adminCheck, mainAdminOnly, async (req, res) => {
  try {
    const { subAdminId } = req.params;
    
    // Unlink managers from this sub-admin (they become main admin's managers)
    await pool.query(
      'UPDATE managers SET sub_admin_id = NULL WHERE sub_admin_id = $1',
      [subAdminId]
    );
    
    // Unlink users attracted directly by sub-admin
    await pool.query(
      'UPDATE users SET sub_admin_id = NULL, sub_admin_telegram_id = NULL WHERE sub_admin_id = $1',
      [subAdminId]
    );
    
    // Delete sub-admin
    await pool.query(
      'DELETE FROM sub_admins WHERE id = $1',
      [subAdminId]
    );
    
    console.log(`🗑️ Sub-admin ${subAdminId} removed`);
    
    res.json({
      success: true,
      message: 'Суб-админ удалён'
    });
  } catch (error) {
    console.error('Delete sub-admin error:', error);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

/**
 * GET /api/admin/subadmin/reflink
 * Get sub-admin's own ref link (for sub-admins)
 */
router.get('/subadmin/reflink', adminCheck, async (req, res) => {
  try {
    if (!req.isSubAdmin) {
      return res.status(403).json({ success: false, error: 'Только для суб-админов' });
    }
    
    const result = await pool.query(
      'SELECT ref_code FROM sub_admins WHERE id = $1',
      [req.subAdminId]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Суб-админ не найден' });
    }
    
    const refCode = result.rows[0].ref_code;
    
    res.json({
      success: true,
      data: {
        ref_code: refCode,
        ref_link: `https://t.me/trustEx_ru_bot?start=ref_${refCode}`
      }
    });
  } catch (error) {
    console.error('Get sub-admin reflink error:', error);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

module.exports = router;
