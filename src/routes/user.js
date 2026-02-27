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

module.exports = router;
