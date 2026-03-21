/**
 * src/routes/exchange.js
 * Currency exchange functionality — supports all 6 currencies
 */

const express = require('express');
const router = express.Router();
const pool = require('../config/database');

// All supported currencies and their balance fields
const CURRENCIES = ['USDT', 'BTC', 'ETH', 'TON', 'RUB', 'EUR'];
const BALANCE_FIELD = {
  USDT: 'balance_usdt', BTC: 'balance_btc', ETH: 'balance_eth',
  TON: 'balance_ton', RUB: 'balance_rub', EUR: 'balance_eur'
};

// Fallback fiat rates (per 1 USDT)
const DEFAULT_RUB_PER_USDT = 1 / 0.012;   // ~83
const DEFAULT_EUR_PER_USDT = 1 / 1.089;   // ~0.918

// Server-side rate cache — prevents stale fallbacks from ruining exchange totals
let cachedCryptoRates = null;   // { BTC, ETH, TON }
let cachedCryptoTime = 0;
const CRYPTO_CACHE_TTL = 120_000; // 2 minutes — reuse recent prices

/**
 * Fetch crypto prices from Binance, with server-side caching.
 * Returns { BTC, ETH, TON } or null if unavailable + cache expired.
 */
async function fetchCryptoPrices() {
  // Return cache if fresh
  if (cachedCryptoRates && Date.now() - cachedCryptoTime < CRYPTO_CACHE_TTL) {
    return cachedCryptoRates;
  }

  try {
    const res = await fetch('https://api.binance.com/api/v3/ticker/price?symbols=["BTCUSDT","ETHUSDT","TONUSDT"]');
    const data = await res.json();
    const prices = {};
    for (const item of data) {
      if (item.symbol === 'BTCUSDT') prices.BTC = parseFloat(item.price);
      if (item.symbol === 'ETHUSDT') prices.ETH = parseFloat(item.price);
      if (item.symbol === 'TONUSDT') prices.TON = parseFloat(item.price);
    }
    if (prices.BTC && prices.ETH && prices.TON) {
      cachedCryptoRates = prices;
      cachedCryptoTime = Date.now();
      return prices;
    }
  } catch (e) {
    console.error('Binance fetch failed:', e.message);
  }

  // Return stale cache if exists (better than hardcoded fallbacks)
  if (cachedCryptoRates) return cachedCryptoRates;

  return null; // No reliable prices available
}

/**
 * Get all rates expressed in USDT (1 unit = X USDT)
 * Fetches Binance for crypto (cached), DB for fiat.
 * Returns null if crypto rates are unavailable.
 */
async function getAllRatesInUsdt(client) {
  const rates = { USDT: 1 };

  // Crypto from Binance (cached)
  const crypto = await fetchCryptoPrices();
  if (!crypto) return null; // Can't determine crypto prices
  rates.BTC = crypto.BTC;
  rates.ETH = crypto.ETH;
  rates.TON = crypto.TON;

  // Fiat from DB
  try {
    const queryTarget = client || pool;
    const result = await queryTarget.query(
      "SELECT key, value FROM platform_settings WHERE key IN ('rub_usdt_rate', 'eur_usdt_rate')"
    );
    const dbRates = {};
    result.rows.forEach(r => { dbRates[r.key] = parseFloat(r.value); });
    const rubPerUsdt = dbRates.rub_usdt_rate || DEFAULT_RUB_PER_USDT;
    const eurPerUsdt = dbRates.eur_usdt_rate || DEFAULT_EUR_PER_USDT;
    rates.RUB = 1 / rubPerUsdt;   // 1 RUB = X USDT
    rates.EUR = 1 / eurPerUsdt;   // 1 EUR = X USDT
  } catch (e) {
    rates.RUB = 0.012;
    rates.EUR = 1.089;
  }

  return rates;
}

/**
 * POST /api/exchange
 * Exchange between any two currencies
 * Body: { user_id, amount, from, to } OR legacy { user_id, amount, side }
 */
router.post('/', async (req, res) => {
  const client = await pool.connect();
  try {
    const { user_id } = req.body;
    const amount = parseFloat(req.body.amount);

    // Support legacy side param
    let from = (req.body.from || '').toUpperCase();
    let to = (req.body.to || '').toUpperCase();
    if (!from && req.body.side) {
      const sideMap = {
        rub_to_usdt: ['RUB', 'USDT'], usdt_to_rub: ['USDT', 'RUB'],
        eur_to_usdt: ['EUR', 'USDT'], usdt_to_eur: ['USDT', 'EUR']
      };
      const mapped = sideMap[req.body.side];
      if (mapped) { from = mapped[0]; to = mapped[1]; }
    }

    if (!user_id) return res.status(400).json({ error: 'user_id is required' });
    if (!Number.isFinite(amount) || amount <= 0) return res.status(400).json({ error: 'Invalid amount' });
    if (!CURRENCIES.includes(from) || !CURRENCIES.includes(to) || from === to) {
      return res.status(400).json({ error: 'Invalid currency pair' });
    }

    await client.query('BEGIN');

    const rates = await getAllRatesInUsdt(client);
    if (!rates) {
      await client.query('ROLLBACK');
      return res.status(503).json({ error: 'Не удалось получить актуальные курсы. Попробуйте через несколько секунд.' });
    }

    // Get user with lock
    const userResult = await client.query('SELECT * FROM users WHERE telegram_id = $1 FOR UPDATE', [user_id.toString()]);
    if (userResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'User not found' });
    }

    const user = userResult.rows[0];
    const fromBalance = parseFloat(user[BALANCE_FIELD[from]]) || 0;

    if (amount > fromBalance) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: `Insufficient ${from} balance` });
    }

    // Convert: from → USDT → to
    const fromInUsdt = amount * rates[from];
    const exchangedAmount = fromInUsdt / rates[to];

    const fromField = BALANCE_FIELD[from];
    const toField = BALANCE_FIELD[to];

    const updateResult = await client.query(
      `UPDATE users SET ${fromField} = ${fromField} - $1, ${toField} = ${toField} + $2, updated_at = NOW()
       WHERE id = $3
       RETURNING balance_rub, balance_eur, balance_usdt, balance_btc, balance_eth, balance_ton`,
      [amount, exchangedAmount, user.id]
    );

    const nb = updateResult.rows[0];
    const description = `Обмен ${amount.toFixed(from === 'BTC' || from === 'ETH' ? 8 : 2)} ${from} → ${exchangedAmount.toFixed(to === 'BTC' || to === 'ETH' ? 8 : to === 'TON' ? 4 : 2)} ${to}`;

    await client.query(
      `INSERT INTO transactions (user_id, amount, currency, type, description, created_at)
       VALUES ($1, $2, $3, 'exchange', $4, NOW())`,
      [user.id, amount, from, description]
    );

    await client.query('COMMIT');

    res.json({
      success: true,
      message: 'Обмен выполнен успешно!',
      data: {
        from, to,
        fromAmount: amount,
        toAmount: exchangedAmount,
        newBalances: {
          rub: parseFloat(nb.balance_rub) || 0,
          eur: parseFloat(nb.balance_eur) || 0,
          usdt: parseFloat(nb.balance_usdt) || 0,
          btc: parseFloat(nb.balance_btc) || 0,
          eth: parseFloat(nb.balance_eth) || 0,
          ton: parseFloat(nb.balance_ton) || 0
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
 * GET /api/exchange/history/:telegramId
 * Get recent exchange transactions for user
 */
router.get('/history/:telegramId', async (req, res) => {
  try {
    const { telegramId } = req.params;
    const limit = Math.min(parseInt(req.query.limit) || 10, 50);

    const userResult = await pool.query(
      'SELECT id FROM users WHERE telegram_id = $1',
      [telegramId.toString()]
    );
    if (userResult.rows.length === 0) {
      return res.json({ success: true, data: [] });
    }

    const result = await pool.query(
      `SELECT amount, currency, description, created_at
       FROM transactions
       WHERE user_id = $1 AND type = 'exchange'
       ORDER BY created_at DESC
       LIMIT $2`,
      [userResult.rows[0].id, limit]
    );

    res.json({ success: true, data: result.rows });
  } catch (error) {
    console.error('❌ Exchange history error:', error.message);
    res.status(500).json({ error: 'Server error' });
  }
});

/**
 * GET /api/exchange/rate
 * Get all exchange rates (each currency in USDT)
 */
router.get('/rate', async (req, res) => {
  const rates = await getAllRatesInUsdt();
  if (!rates) {
    return res.status(503).json({ error: 'Rates temporarily unavailable' });
  }
  res.json({
    success: true,
    data: {
      // Legacy fields for backward compat
      rub_to_usdt: rates.RUB,
      usdt_to_rub: 1 / rates.RUB,
      eur_to_usdt: rates.EUR,
      usdt_to_eur: 1 / rates.EUR,
      // All rates (1 unit = X USDT)
      rates
    }
  });
});

module.exports = router;
