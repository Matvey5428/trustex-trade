/**
 * src/routes/exchange.js
 * Currency exchange functionality
 */

const express = require('express');
const router = express.Router();
const pool = require('../config/database');

// Exchange rate (can be dynamic later)
const RUB_TO_USDT_RATE = 0.012642; // 1 RUB = 0.012642 USDT

/**
 * POST /api/exchange
 * Exchange between RUB and USDT
 */
router.post('/', async (req, res) => {
  try {
    const { user_id, amount, side } = req.body;

    // Validate
    if (!user_id) {
      return res.status(400).json({ error: 'user_id is required' });
    }
    if (!amount || amount <= 0) {
      return res.status(400).json({ error: 'Invalid amount' });
    }
    if (!side || !['rub_to_usdt', 'usdt_to_rub'].includes(side)) {
      return res.status(400).json({ error: 'Invalid side (rub_to_usdt or usdt_to_rub)' });
    }

    // Get user
    const userResult = await pool.query('SELECT * FROM users WHERE id = $1', [user_id]);
    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const user = userResult.rows[0];
    const rubBalance = parseFloat(user.balance_rub) || 0;
    const usdtBalance = parseFloat(user.balance_usdt) || 0;

    let newRubBalance, newUsdtBalance, exchangedAmount;

    if (side === 'rub_to_usdt') {
      // RUB -> USDT
      if (amount > rubBalance) {
        return res.status(400).json({ error: 'Insufficient RUB balance' });
      }
      exchangedAmount = amount * RUB_TO_USDT_RATE;
      newRubBalance = rubBalance - amount;
      newUsdtBalance = usdtBalance + exchangedAmount;
    } else {
      // USDT -> RUB
      if (amount > usdtBalance) {
        return res.status(400).json({ error: 'Insufficient USDT balance' });
      }
      exchangedAmount = amount / RUB_TO_USDT_RATE;
      newUsdtBalance = usdtBalance - amount;
      newRubBalance = rubBalance + exchangedAmount;
    }

    // Begin transaction
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Update balances
      await client.query(
        `UPDATE users SET balance_rub = $1, balance_usdt = $2, updated_at = NOW() WHERE id = $3`,
        [newRubBalance, newUsdtBalance, user_id]
      );

      // Create transaction record
      const description = side === 'rub_to_usdt' 
        ? `Обмен ${amount.toFixed(2)} RUB → ${exchangedAmount.toFixed(2)} USDT`
        : `Обмен ${amount.toFixed(2)} USDT → ${exchangedAmount.toFixed(2)} RUB`;

      await client.query(
        `INSERT INTO transactions (user_id, amount, currency, type, description, created_at)
         VALUES ($1, $2, $3, 'exchange', $4, NOW())`,
        [user_id, amount, side === 'rub_to_usdt' ? 'RUB' : 'USDT', description]
      );

      await client.query('COMMIT');

      res.json({
        success: true,
        message: 'Обмен выполнен успешно!',
        data: {
          side,
          fromAmount: amount,
          toAmount: exchangedAmount,
          newBalances: {
            rub: newRubBalance,
            usdt: newUsdtBalance
          }
        }
      });

    } catch (txError) {
      await client.query('ROLLBACK');
      throw txError;
    } finally {
      client.release();
    }

  } catch (error) {
    console.error('❌ Exchange error:', error.message);
    res.status(500).json({ error: 'Server error: ' + error.message });
  }
});

/**
 * GET /api/exchange/rate
 * Get current exchange rate
 */
router.get('/rate', (req, res) => {
  res.json({
    success: true,
    data: {
      rub_to_usdt: RUB_TO_USDT_RATE,
      usdt_to_rub: 1 / RUB_TO_USDT_RATE
    }
  });
});

module.exports = router;
