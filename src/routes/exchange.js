/**
 * src/routes/exchange.js
 * Currency exchange functionality
 */

const express = require('express');
const router = express.Router();
const pool = require('../config/database');

// Fallback exchange rates (used if DB rates unavailable)
const DEFAULT_RUB_TO_USDT_RATE = 0.012;
const DEFAULT_EUR_TO_USDT_RATE = 1.089;

/**
 * Get exchange rates from database, falling back to defaults
 */
async function getRates(client) {
  try {
    const queryTarget = client || pool;
    const result = await queryTarget.query(
      "SELECT key, value FROM platform_settings WHERE key IN ('rub_usdt_rate', 'eur_usdt_rate')"
    );
    const rates = {};
    result.rows.forEach(r => { rates[r.key] = parseFloat(r.value); });
    
    // rub_usdt_rate in DB = how many RUB per 1 USDT (e.g. 92)
    // We need RUB_TO_USDT = 1 / rub_usdt_rate
    const rubPerUsdt = rates.rub_usdt_rate || (1 / DEFAULT_RUB_TO_USDT_RATE);
    const eurPerUsdt = rates.eur_usdt_rate || (1 / DEFAULT_EUR_TO_USDT_RATE);
    
    return {
      RUB_TO_USDT: 1 / rubPerUsdt,
      EUR_TO_USDT: 1 / eurPerUsdt
    };
  } catch (e) {
    return {
      RUB_TO_USDT: DEFAULT_RUB_TO_USDT_RATE,
      EUR_TO_USDT: DEFAULT_EUR_TO_USDT_RATE
    };
  }
}

/**
 * POST /api/exchange
 * Exchange between RUB/EUR and USDT
 */
router.post('/', async (req, res) => {
  const client = await pool.connect();
  try {
    const { user_id, side } = req.body;
    const amount = parseFloat(req.body.amount);

    // Validate
    if (!user_id) {
      return res.status(400).json({ error: 'user_id is required' });
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({ error: 'Invalid amount' });
    }
    if (!side || !['rub_to_usdt', 'usdt_to_rub', 'eur_to_usdt', 'usdt_to_eur'].includes(side)) {
      return res.status(400).json({ error: 'Invalid side' });
    }

    await client.query('BEGIN');

    // Fetch rates from DB inside transaction for consistency
    const rates = await getRates(client);
    const RUB_TO_USDT_RATE = rates.RUB_TO_USDT;
    const EUR_TO_USDT_RATE = rates.EUR_TO_USDT;

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

    let fromField, toField, deductAmount, addAmount, exchangedAmount;

    if (side === 'rub_to_usdt') {
      if (amount > rubBalance) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'Insufficient RUB balance' });
      }
      exchangedAmount = amount * RUB_TO_USDT_RATE;
      fromField = 'balance_rub'; toField = 'balance_usdt';
      deductAmount = amount; addAmount = exchangedAmount;
    } else if (side === 'usdt_to_rub') {
      if (amount > usdtBalance) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'Insufficient USDT balance' });
      }
      exchangedAmount = amount / RUB_TO_USDT_RATE;
      fromField = 'balance_usdt'; toField = 'balance_rub';
      deductAmount = amount; addAmount = exchangedAmount;
    } else if (side === 'eur_to_usdt') {
      if (amount > eurBalance) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'Insufficient EUR balance' });
      }
      exchangedAmount = amount * EUR_TO_USDT_RATE;
      fromField = 'balance_eur'; toField = 'balance_usdt';
      deductAmount = amount; addAmount = exchangedAmount;
    } else {
      // usdt_to_eur
      if (amount > usdtBalance) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'Insufficient USDT balance' });
      }
      exchangedAmount = amount / EUR_TO_USDT_RATE;
      fromField = 'balance_usdt'; toField = 'balance_eur';
      deductAmount = amount; addAmount = exchangedAmount;
    }

    // Atomic balance update — deduct source, add target
    const updateResult = await client.query(
      `UPDATE users SET ${fromField} = ${fromField} - $1, ${toField} = ${toField} + $2, updated_at = NOW() WHERE id = $3 RETURNING balance_rub, balance_eur, balance_usdt`,
      [deductAmount, addAmount, user.id]
    );

    const newBalances = updateResult.rows[0];

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
          rub: parseFloat(newBalances.balance_rub) || 0,
          eur: parseFloat(newBalances.balance_eur) || 0,
          usdt: parseFloat(newBalances.balance_usdt) || 0
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
 * Get current exchange rate (from database)
 */
router.get('/rate', async (req, res) => {
  const rates = await getRates();
  res.json({
    success: true,
    data: {
      rub_to_usdt: rates.RUB_TO_USDT,
      usdt_to_rub: 1 / rates.RUB_TO_USDT,
      eur_to_usdt: rates.EUR_TO_USDT,
      usdt_to_eur: 1 / rates.EUR_TO_USDT
    }
  });
});

module.exports = router;
