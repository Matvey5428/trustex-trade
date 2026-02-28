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
 * Check if user is manager (async)
 */
async function getManagerId(telegramId) {
  try {
    const result = await pool.query(
      'SELECT id FROM managers WHERE telegram_id = $1',
      [String(telegramId)]
    );
    return result.rows[0]?.id || null;
  } catch (e) {
    return null;
  }
}

/**
 * Admin middleware - allows main admin or managers
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
    req.managerId = null;
    return next();
  }
  
  // Check if manager
  const managerId = await getManagerId(adminId);
  if (managerId) {
    req.adminId = adminId;
    req.isMainAdmin = false;
    req.managerId = managerId;
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
  res.json({
    success: true,
    data: {
      role: req.isMainAdmin ? 'admin' : 'manager',
      managerId: req.managerId
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
          m.name as manager_name
        FROM users u
        LEFT JOIN managers m ON u.manager_id = m.id
        ORDER BY u.created_at DESC 
        LIMIT 100
      `;
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
    
    // Build query based on role
    let userResult;
    if (req.isMainAdmin) {
      userResult = await pool.query(
        'SELECT * FROM users WHERE telegram_id = $1',
        [telegramId]
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
        trades_count: parseInt(tradesResult.rows[0].count)
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
    
    // Get user with manager check
    let userResult;
    if (req.isMainAdmin) {
      userResult = await pool.query('SELECT id FROM users WHERE telegram_id = $1', [telegramId]);
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
 * PUT /api/admin/user/:telegramId
 * Update user balance and mode (admin or manager for their users)
 */
router.put('/user/:telegramId', adminCheck, async (req, res) => {
  try {
    const { telegramId } = req.params;
    const { balance_usdt, trade_mode } = req.body;
    
    // If manager, check that user belongs to them
    if (!req.isMainAdmin) {
      const userCheck = await pool.query(
        'SELECT id FROM users WHERE telegram_id = $1 AND manager_id = $2',
        [telegramId, req.managerId]
      );
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
    
    // Build update query
    const updates = [];
    const values = [];
    let paramIndex = 1;
    
    if (balance_usdt !== undefined) {
      updates.push(`balance_usdt = $${paramIndex++}`);
      values.push(balance_usdt);
    }
    
    if (trade_mode) {
      updates.push(`trade_mode = $${paramIndex++}`);
      values.push(trade_mode);
    }
    
    if (updates.length === 0) {
      return res.status(400).json({ success: false, error: 'No updates provided' });
    }
    
    updates.push(`updated_at = NOW()`);
    values.push(telegramId);
    
    const result = await pool.query(
      `UPDATE users SET ${updates.join(', ')} WHERE telegram_id = $${paramIndex} RETURNING *`,
      values
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'User not found' });
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
    
    // Get deposit request with manager check
    let depositResult;
    if (req.isMainAdmin) {
      depositResult = await client.query(
        'SELECT d.* FROM deposit_requests d WHERE d.id = $1 AND d.status = $2',
        [id, 'pending']
      );
    } else {
      depositResult = await client.query(
        `SELECT d.* FROM deposit_requests d 
         JOIN users u ON d.user_id = u.id
         WHERE d.id = $1 AND d.status = $2 AND u.manager_id = $3`,
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
    
    // Get user with manager check
    let userResult;
    if (req.isMainAdmin) {
      userResult = await pool.query(
        'SELECT id, telegram_id, first_name, username FROM users WHERE telegram_id = $1',
        [telegramId]
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
    
    // Get messages
    const messagesResult = await pool.query(
      `SELECT * FROM support_messages 
       WHERE user_id = $1 
       ORDER BY created_at ASC 
       LIMIT 100`,
      [user.id]
    );
    
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
        messages: messagesResult.rows
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
    
    // Get user with manager check
    let userResult;
    if (req.isMainAdmin) {
      userResult = await pool.query(
        'SELECT id, telegram_id FROM users WHERE telegram_id = $1',
        [telegramId]
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
    try {
      const { getBot } = require('../bot');
      const bot = getBot();
      if (bot) {
        await bot.sendMessage(telegramId, message.trim());
      }
    } catch (botError) {
      console.error('Failed to send Telegram message:', botError.message);
    }
    
    res.json({
      success: true,
      data: msgResult.rows[0]
    });
  } catch (error) {
    console.error('Send message error:', error);
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
  try {
    const { invoiceId } = req.params;
    
    // Get invoice with manager check
    let invoiceResult;
    if (req.isMainAdmin) {
      invoiceResult = await pool.query(
        'SELECT ci.*, u.telegram_id, u.first_name FROM crypto_invoices ci JOIN users u ON ci.user_id = u.id WHERE ci.invoice_id = $1',
        [invoiceId]
      );
    } else {
      // Manager can only confirm invoices of their users
      invoiceResult = await pool.query(
        'SELECT ci.*, u.telegram_id, u.first_name FROM crypto_invoices ci JOIN users u ON ci.user_id = u.id WHERE ci.invoice_id = $1 AND u.manager_id = $2',
        [invoiceId, req.managerId]
      );
    }
    
    if (invoiceResult.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Инвойс не найден' });
    }
    
    const invoice = invoiceResult.rows[0];
    
    if (invoice.status === 'paid') {
      return res.status(400).json({ success: false, error: 'Уже оплачен' });
    }
    
    const paidAmount = parseFloat(invoice.amount);
    
    // Update invoice status
    await pool.query(
      'UPDATE crypto_invoices SET status = $1, paid_at = NOW() WHERE invoice_id = $2',
      ['paid', invoiceId]
    );
    
    // Credit user balance
    await pool.query(
      'UPDATE users SET balance_usdt = balance_usdt + $1, updated_at = NOW() WHERE id = $2',
      [paidAmount, invoice.user_id]
    );
    
    // Create transaction record
    await pool.query(
      `INSERT INTO transactions (user_id, amount, currency, type, description, created_at)
       VALUES ($1, $2, 'USDT', 'deposit', $3, NOW())`,
      [invoice.user_id, paidAmount, `Пополнение (подтверждено админом): ${paidAmount} USDT`]
    );
    
    // Notify user via main bot
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
    console.error('Confirm invoice error:', error);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

// ==================== MANAGER MANAGEMENT (Main Admin Only) ====================

/**
 * GET /api/admin/managers
 * Get all managers (main admin only)
 */
router.get('/managers', adminCheck, mainAdminOnly, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        m.id, m.telegram_id, m.name, m.ref_code, m.created_at,
        COUNT(u.id) as users_count
      FROM managers m
      LEFT JOIN users u ON u.manager_id = m.id
      GROUP BY m.id
      ORDER BY m.created_at DESC
    `);
    
    // Add ref_link to each manager
    const managers = result.rows.map(m => ({
      ...m,
      ref_link: m.ref_code ? `t.me/trustEx_ru_bot?start=ref_${m.ref_code}` : null
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
 * Add new manager (main admin only)
 */
router.post('/managers', adminCheck, mainAdminOnly, async (req, res) => {
  try {
    const { telegram_id, name } = req.body;
    
    if (!telegram_id) {
      return res.status(400).json({ success: false, error: 'Telegram ID обязателен' });
    }
    
    // Check if already exists
    const existing = await pool.query(
      'SELECT id FROM managers WHERE telegram_id = $1',
      [String(telegram_id)]
    );
    
    if (existing.rows.length > 0) {
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
    
    const result = await pool.query(
      'INSERT INTO managers (telegram_id, name, ref_code) VALUES ($1, $2, $3) RETURNING *',
      [String(telegram_id), name || `Менеджер ${telegram_id}`, refCode]
    );
    
    console.log(`✅ Manager added: ${telegram_id} with ref_code: ${refCode}`);
    
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
 * Remove manager (main admin only)
 */
router.delete('/managers/:managerId', adminCheck, mainAdminOnly, async (req, res) => {
  try {
    const { managerId } = req.params;
    
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

module.exports = router;
