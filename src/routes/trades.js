/**
 * src/routes/trades.js
 * Trading functionality with win/loss mode
 */

const express = require('express');
const router = express.Router();
const pool = require('../config/database');

// Хранилище активных сделок (в памяти, можно перенести в Redis)
const activeTrades = new Map();

/**
 * POST /api/trades/create
 * Create a new trade
 */
router.post('/create', async (req, res) => {
  try {
    const { userId, fromCurrency, toCurrency, fromAmount, direction } = req.body;

    // Validate input
    if (!userId) {
      return res.status(400).json({ error: 'userId is required' });
    }
    const amount = parseFloat(fromAmount);
    if (!amount || amount <= 0) {
      return res.status(400).json({ error: 'Invalid amount' });
    }

    // Get user by telegram_id
    const userResult = await pool.query(
      'SELECT * FROM users WHERE telegram_id = $1',
      [userId.toString()]
    );

    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const user = userResult.rows[0];
    const currentBalance = parseFloat(user.balance_usdt) || 0;

    // Check balance
    if (amount > currentBalance) {
      return res.status(400).json({ 
        error: 'Insufficient balance',
        available: currentBalance,
        requested: amount
      });
    }

    // Get user's trade mode (default: loss)
    const tradeMode = user.trade_mode || 'loss';
    
    // Start transaction
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Deduct balance immediately
      const newBalance = currentBalance - amount;
      await client.query(
        'UPDATE users SET balance_usdt = $1, updated_at = NOW() WHERE telegram_id = $2',
        [newBalance, userId.toString()]
      );

      // Calculate result based on mode
      let profit = amount; // Default to stake amount
      let status = 'pending';
      let finalBalance = newBalance;

      if (tradeMode === 'win') {
        // WIN mode: +1.5% profit
        profit = amount * 0.015;
        finalBalance = newBalance + amount + profit; // Return stake + profit
        status = 'win';
        
        // Add profit to balance
        await client.query(
          'UPDATE users SET balance_usdt = $1, updated_at = NOW() WHERE telegram_id = $2',
          [finalBalance, userId.toString()]
        );
      } else {
        // LOSS mode: lose entire stake
        profit = -amount;
        status = 'loss';
        finalBalance = newBalance;
        // Balance already deducted, nothing more to do
      }

      // Create trade record
      const tradeResult = await client.query(
        `INSERT INTO orders (user_id, amount, direction, duration, status, result, created_at, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW() + INTERVAL '30 seconds')
         RETURNING *`,
        [user.id, amount, direction || 'up', 30, 'closed', status]
      );

      // Create transaction record (amount must be positive due to constraint)
      const txAmount = Math.max(Math.abs(profit), 0.01); // Ensure at least 0.01
      console.log(`📊 Trade: mode=${tradeMode}, profit=${profit}, txAmount=${txAmount}`);
      
      await client.query(
        `INSERT INTO transactions (user_id, amount, currency, type, description, created_at)
         VALUES ($1, $2, 'USDT', 'trade', $3, NOW())`,
        [user.id, txAmount, `Торговля ${toCurrency}: ${status === 'win' ? 'Выигрыш +' : 'Проигрыш -'}${Math.abs(profit).toFixed(2)} USDT`]
      );

      await client.query('COMMIT');

      res.json({
        success: true,
        message: status === 'win' 
          ? `Сделка выиграна! +${profit.toFixed(2)} USDT` 
          : `Сделка проиграна. -${amount.toFixed(2)} USDT`,
        data: {
          id: tradeResult.rows[0]?.id,
          status,
          amount,
          profit,
          newBalance: finalBalance,
          mode: tradeMode
        }
      });

    } catch (txError) {
      await client.query('ROLLBACK');
      throw txError;
    } finally {
      client.release();
    }

  } catch (error) {
    console.error('❌ Trade error:', error.message);
    res.status(500).json({ error: 'Server error: ' + error.message });
  }
});

/**
 * GET /api/trades/:userId
 * Get user's trade history
 */
router.get('/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const limit = parseInt(req.query.limit) || 20;

    // Get user by telegram_id
    const userResult = await pool.query(
      'SELECT id FROM users WHERE telegram_id = $1',
      [userId.toString()]
    );

    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const result = await pool.query(
      `SELECT id, direction, amount, result, status, created_at as "createdAt"
       FROM orders 
       WHERE user_id = $1 
       ORDER BY created_at DESC 
       LIMIT $2`,
      [userResult.rows[0].id, limit]
    );

    // Transform for frontend
    const trades = result.rows.map(row => ({
      id: row.id,
      fromCurrency: 'USDT',
      toCurrency: row.direction === 'up' ? '↑' : '↓',
      fromAmount: row.amount,
      status: row.result === 'win' ? 'successful' : row.result === 'loss' ? 'failed' : row.status,
      createdAt: row.createdAt
    }));

    res.json({
      success: true,
      data: trades
    });

  } catch (error) {
    console.error('❌ Trades history error:', error.message);
    res.status(500).json({ error: 'Server error' });
  }
});

/**
 * POST /api/trades/set-mode
 * Set user's trade mode (admin only in future)
 */
router.post('/set-mode', async (req, res) => {
  try {
    const { userId, mode } = req.body;

    if (!userId) {
      return res.status(400).json({ error: 'userId is required' });
    }
    if (!mode || !['win', 'loss'].includes(mode)) {
      return res.status(400).json({ error: 'Invalid mode. Use "win" or "loss"' });
    }

    const result = await pool.query(
      'UPDATE users SET trade_mode = $1, updated_at = NOW() WHERE telegram_id = $2 RETURNING trade_mode',
      [mode, userId.toString()]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({
      success: true,
      message: `Trade mode set to: ${mode}`,
      data: { mode: result.rows[0].trade_mode }
    });

  } catch (error) {
    console.error('❌ Set mode error:', error.message);
    res.status(500).json({ error: 'Server error' });
  }
});

/**
 * GET /api/trades/mode/:userId
 * Get user's current trade mode
 */
router.get('/mode/:userId', async (req, res) => {
  try {
    const { userId } = req.params;

    const result = await pool.query(
      'SELECT trade_mode FROM users WHERE telegram_id = $1',
      [userId.toString()]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({
      success: true,
      data: { mode: result.rows[0].trade_mode || 'loss' }
    });

  } catch (error) {
    console.error('❌ Get mode error:', error.message);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
