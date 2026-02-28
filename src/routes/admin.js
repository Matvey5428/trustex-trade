/**
 * src/routes/admin.js
 * Admin API endpoints for Mini App
 */

const express = require('express');
const router = express.Router();
const pool = require('../config/database');

// Admin IDs from environment
const ADMIN_IDS = (process.env.ADMIN_IDS || '').split(',').map(id => id.trim());

/**
 * Check if user is admin
 */
function isAdmin(telegramId) {
  return ADMIN_IDS.includes(String(telegramId));
}

/**
 * Admin middleware
 */
function adminCheck(req, res, next) {
  const adminId = req.query.adminId || req.body.adminId;
  
  if (!adminId || !isAdmin(adminId)) {
    return res.status(403).json({ 
      success: false, 
      error: 'Доступ запрещён' 
    });
  }
  
  req.adminId = adminId;
  next();
}

/**
 * GET /api/admin/stats
 * Get overall statistics
 */
router.get('/stats', adminCheck, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        COUNT(*) as total_users,
        COALESCE(SUM(balance_usdt), 0) as total_balance,
        COUNT(*) FILTER (WHERE trade_mode = 'win') as win_mode_count,
        COUNT(*) FILTER (WHERE COALESCE(trade_mode, 'loss') = 'loss') as loss_mode_count
      FROM users
    `);
    
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
 * Get all users
 */
router.get('/users', adminCheck, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        id, telegram_id, username, first_name, last_name,
        balance_usdt, balance_btc, balance_rub,
        COALESCE(trade_mode, 'loss') as trade_mode,
        created_at
      FROM users 
      ORDER BY created_at DESC 
      LIMIT 100
    `);
    
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
    
    // Get user
    const userResult = await pool.query(
      'SELECT * FROM users WHERE telegram_id = $1',
      [telegramId]
    );
    
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
    
    // Get user
    const userResult = await pool.query('SELECT id FROM users WHERE telegram_id = $1', [telegramId]);
    
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
 * Update user balance and mode
 */
router.put('/user/:telegramId', adminCheck, async (req, res) => {
  try {
    const { telegramId } = req.params;
    const { balance_usdt, trade_mode } = req.body;
    
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
    
    const result = await pool.query(`
      SELECT t.*, u.telegram_id, u.first_name, u.username
      FROM transactions t
      JOIN users u ON t.user_id = u.id
      ORDER BY t.created_at DESC
      LIMIT $1
    `, [limit]);
    
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
    const result = await pool.query(`
      SELECT d.*, u.telegram_id, u.first_name, u.username
      FROM deposit_requests d
      JOIN users u ON d.user_id = u.id
      WHERE d.status = 'pending'
      ORDER BY d.created_at DESC
    `);
    
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
    
    // Get deposit request
    const depositResult = await client.query(
      'SELECT * FROM deposit_requests WHERE id = $1 AND status = $2',
      [id, 'pending']
    );
    
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
    
    const result = await pool.query(
      'UPDATE deposit_requests SET status = $1 WHERE id = $2 AND status = $3 RETURNING *',
      ['rejected', id, 'pending']
    );
    
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
    
    // Get user
    const userResult = await pool.query(
      'SELECT id, telegram_id, first_name, username FROM users WHERE telegram_id = $1',
      [telegramId]
    );
    
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
    
    // Get user
    const userResult = await pool.query(
      'SELECT id, telegram_id FROM users WHERE telegram_id = $1',
      [telegramId]
    );
    
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
    const result = await pool.query(`
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
    `);
    
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
    const result = await pool.query(`
      SELECT 
        ci.id, ci.invoice_id, ci.amount, ci.asset, ci.status, ci.pay_url, ci.created_at, ci.paid_at,
        u.telegram_id, u.first_name, u.username
      FROM crypto_invoices ci
      JOIN users u ON ci.user_id = u.id
      ORDER BY ci.created_at DESC
      LIMIT 50
    `);
    
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
    
    // Get invoice
    const invoiceResult = await pool.query(
      'SELECT ci.*, u.telegram_id, u.first_name FROM crypto_invoices ci JOIN users u ON ci.user_id = u.id WHERE ci.invoice_id = $1',
      [invoiceId]
    );
    
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

module.exports = router;
