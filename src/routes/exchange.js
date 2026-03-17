/**
 * src/routes/exchange.js
 * Currency exchange functionality
 */

const express = require('express');
const router = express.Router();
const pool = require('../config/database');

// Exchange rate (can be dynamic later)
const RUB_TO_USDT_RATE = 0.012642; // 1 RUB = 0.012642 USDT
const EUR_TO_USDT_RATE = 1.089;    // 1 EUR = 1.089 USDT

/**
 * POST /api/exchange
 * Exchange between RUB/EUR and USDT
 */
router.post('/', async (req, res) => {
  const client = await pool.connect();
  try {
    const { user_id, amount, side } = req.body;

    // Validate
    if (!user_id) {
      return res.status(400).json({ error: 'user_id is required' });
    }
    if (!amount || amount <= 0) {
      return res.status(400).json({ error: 'Invalid amount' });
    }
    if (!side || !['rub_to_usdt', 'usdt_to_rub', 'eur_to_usdt', 'usdt_to_eur'].includes(side)) {
      return res.status(400).json({ error: 'Invalid side' });
    }

    await client.query('BEGIN');

    // Get user by telegram_id WITH LOCK to prevent race condition
    const userResult = await client.query('SELECT * FROM users WHERE telegram_id = $1 FOR UPDATE', [user_id.toString()]);
    if (userResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'User not found' });
    }

    const user = userResult.rows[0];
    const rubBalance = parseFloat(user.balance_rub) || 0;
    const eurBalance = parseFloat(user.balance_eur) || 0;
    const usdtBalance = parseFloat(user.balance_usdt) || 0;

    let newRubBalance = rubBalance;
    let newEurBalance = eurBalance;
    let newUsdtBalance = usdtBalance;
    let exchangedAmount;

    if (side === 'rub_to_usdt') {
      if (amount > rubBalance) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'Insufficient RUB balance' });
      }
      exchangedAmount = amount * RUB_TO_USDT_RATE;
      newRubBalance = rubBalance - amount;
      newUsdtBalance = usdtBalance + exchangedAmount;
    } else if (side === 'usdt_to_rub') {
      if (amount > usdtBalance) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'Insufficient USDT balance' });
      }
      exchangedAmount = amount / RUB_TO_USDT_RATE;
      newUsdtBalance = usdtBalance - amount;
      newRubBalance = rubBalance + exchangedAmount;
    } else if (side === 'eur_to_usdt') {
      if (amount > eurBalance) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'Insufficient EUR balance' });
      }
      exchangedAmount = amount * EUR_TO_USDT_RATE;
      newEurBalance = eurBalance - amount;
      newUsdtBalance = usdtBalance + exchangedAmount;
    } else {
      // usdt_to_eur
      if (amount > usdtBalance) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'Insufficient USDT balance' });
      }
      exchangedAmount = amount / EUR_TO_USDT_RATE;
      newUsdtBalance = usdtBalance - amount;
      newEurBalance = eurBalance + exchangedAmount;
    }

    // Update balances
    await client.query(
      `UPDATE users SET balance_rub = $1, balance_eur = $2, balance_usdt = $3, updated_at = NOW() WHERE id = $4`,
      [newRubBalance, newEurBalance, newUsdtBalance, user.id]
    );

    // Build description
    const fromLabel = side.startsWith('rub') ? 'RUB' : side.startsWith('eur') ? 'EUR' : 'USDT';
    const toLabel   = side.endsWith('rub') ? 'RUB' : side.endsWith('eur') ? 'EUR' : 'USDT';
    const description = `Обмен ${amount.toFixed(2)} ${fromLabel} → ${exchangedAmount.toFixed(2)} ${toLabel}`;

    await client.query(
      `INSERT INTO transactions (user_id, amount, currency, type, description, created_at)
       VALUES ($1, $2, $3, 'exchange', $4, NOW())`,
      [user.id, amount, fromLabel, description]
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
          eur: newEurBalance,
          usdt: newUsdtBalance
        }
      }
    });

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('❌ Exchange error:', error.message);
    res.status(500).json({ error: 'Server error: ' + error.message });
  } finally {
    client.release();
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
      usdt_to_rub: 1 / RUB_TO_USDT_RATE,
      eur_to_usdt: EUR_TO_USDT_RATE,
      usdt_to_eur: 1 / EUR_TO_USDT_RATE
    }
  });
});

module.exports = router;
