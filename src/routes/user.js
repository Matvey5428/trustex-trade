/**
 * src/routes/user.js
 * User management routes
 */

const express = require('express');
const router = express.Router();
const pool = require('../config/database');

/**
 * POST /api/user
 * Get or create user by telegramId
 */
router.post('/', async (req, res) => {
  try {
    const { telegramId, firstName, lastName, username } = req.body;

    if (!telegramId) {
      return res.status(400).json({ error: 'telegramId is required' });
    }

    // Check if user is blocked
    const blockedCheck = await pool.query(
      'SELECT telegram_id FROM blocked_users WHERE telegram_id = $1',
      [String(telegramId)]
    );
    
    if (blockedCheck.rows.length > 0) {
      return res.status(403).json({ 
        error: 'Account blocked', 
        blocked: true,
        message: 'Ваш аккаунт заблокирован. Обратитесь в поддержку.'
      });
    }

    // Try to find existing user
    let result = await pool.query(
      'SELECT * FROM users WHERE telegram_id = $1',
      [telegramId]
    );

    let user = result.rows[0];

    // Create if not exists
    if (!user) {
      const insertResult = await pool.query(
        `INSERT INTO users (telegram_id, username, first_name, last_name, created_at, updated_at)
         VALUES ($1, $2, $3, $4, NOW(), NOW())
         RETURNING *`,
        [telegramId, username || null, firstName || null, lastName || null]
      );
      user = insertResult.rows[0];
      console.log(`✅ Created new user: ${telegramId}`);
    }

    res.json({
      success: true,
      data: {
        id: user.id,
        telegram_id: user.telegram_id,
        username: user.username,
        balance_usdt: user.balance_usdt,
        balance_btc: user.balance_btc,
        balance_rub: user.balance_rub
      }
    });

  } catch (error) {
    console.error('❌ User error:', error.message);
    res.status(500).json({ error: 'Server error: ' + error.message });
  }
});

/**
 * GET /api/profile/:userId
 * Get user profile by telegram_id
 */
router.get('/:userId', async (req, res) => {
  try {
    const { userId } = req.params;

    const result = await pool.query(
      'SELECT * FROM users WHERE telegram_id = $1',
      [userId.toString()]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const user = result.rows[0];

    res.json({
      success: true,
      data: {
        id: user.id,
        telegram_id: user.telegram_id,
        username: user.username,
        rub: parseFloat(user.balance_rub) || 0,
        usdt: parseFloat(user.balance_usdt) || 0,
        btc: parseFloat(user.balance_btc) || 0,
        eth: parseFloat(user.balance_eth) || 0,
        ton: parseFloat(user.balance_ton) || 0
      }
    });

  } catch (error) {
    console.error('❌ Profile error:', error.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// ==================== SUPPORT CHAT ====================

/**
 * GET /api/user/:userId/support/messages
 * Get support chat messages for user
 */
router.get('/:userId/support/messages', async (req, res) => {
  try {
    const { userId } = req.params;
    
    // Get user
    const userResult = await pool.query(
      'SELECT id FROM users WHERE telegram_id = $1',
      [userId.toString()]
    );
    
    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    const user = userResult.rows[0];
    
    // Get messages
    const messagesResult = await pool.query(
      `SELECT id, sender, message, is_read, created_at 
       FROM support_messages 
       WHERE user_id = $1 
       ORDER BY created_at ASC`,
      [user.id]
    );
    
    // Mark admin messages as read
    await pool.query(
      `UPDATE support_messages SET is_read = TRUE 
       WHERE user_id = $1 AND sender = 'admin' AND is_read = FALSE`,
      [user.id]
    );
    
    res.json({
      success: true,
      data: messagesResult.rows
    });
  } catch (error) {
    console.error('Support messages error:', error.message);
    res.status(500).json({ error: 'Server error' });
  }
});

/**
 * POST /api/user/:userId/support/send
 * Send message from user to support
 */
router.post('/:userId/support/send', async (req, res) => {
  try {
    const { userId } = req.params;
    const { message } = req.body;
    
    if (!message || !message.trim()) {
      return res.status(400).json({ error: 'Message is required' });
    }
    
    // Get user with manager info
    const userResult = await pool.query(
      `SELECT u.id, u.telegram_id, u.first_name, u.username, u.manager_id, m.telegram_id as manager_telegram_id
       FROM users u
       LEFT JOIN managers m ON u.manager_id = m.id
       WHERE u.telegram_id = $1`,
      [userId.toString()]
    );
    
    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    const user = userResult.rows[0];
    
    // Save message
    const msgResult = await pool.query(
      `INSERT INTO support_messages (user_id, sender, message, created_at)
       VALUES ($1, 'user', $2, NOW())
       RETURNING *`,
      [user.id, message.trim()]
    );
    
    // Send notifications to admins and manager
    try {
      const { getAdminBot } = require('../admin-bot');
      const adminBot = getAdminBot();
      
      if (adminBot) {
        const userName = user.first_name || user.username || `ID:${user.telegram_id}`;
        const shortMessage = message.trim().length > 100 
          ? message.trim().substring(0, 100) + '...' 
          : message.trim();
        
        const notifyText = `💬 *Новое сообщение в поддержку*\n\n👤 От: ${userName}\n📝 ${shortMessage}`;
        
        // Collect all recipients (avoid duplicates)
        const recipients = new Set();
        
        // Add main admins
        const adminIds = (process.env.ADMIN_IDS || '').split(',').filter(id => id.trim());
        adminIds.forEach(id => recipients.add(id.trim()));
        
        // Add assigned manager
        if (user.manager_telegram_id) {
          recipients.add(user.manager_telegram_id);
        }
        
        // Send to all recipients
        for (const recipientId of recipients) {
          try {
            await adminBot.sendMessage(recipientId, notifyText, { parse_mode: 'Markdown' });
          } catch (e) {
            console.error(`Failed to notify ${recipientId}:`, e.message);
          }
        }
      }
    } catch (notifyError) {
      console.error('Notification error:', notifyError.message);
      // Don't fail the request if notifications fail
    }
    
    res.json({
      success: true,
      data: msgResult.rows[0]
    });
  } catch (error) {
    console.error('Send support message error:', error.message);
    res.status(500).json({ error: 'Server error' });
  }
});

/**
 * GET /api/user/:userId/support/unread
 * Get unread messages count for user
 */
router.get('/:userId/support/unread', async (req, res) => {
  try {
    const { userId } = req.params;
    
    const result = await pool.query(
      `SELECT COUNT(*) as count 
       FROM support_messages sm
       JOIN users u ON sm.user_id = u.id
       WHERE u.telegram_id = $1 AND sm.sender = 'admin' AND sm.is_read = FALSE`,
      [userId.toString()]
    );
    
    res.json({
      success: true,
      count: parseInt(result.rows[0].count)
    });
  } catch (error) {
    console.error('Unread count error:', error.message);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
