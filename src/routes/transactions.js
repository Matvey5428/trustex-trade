/**
 * src/routes/transactions.js
 * Routes for deposits and withdrawals
 */

const express = require('express');
const router = express.Router();
const pool = require('../config/database');

/**
 * POST /api/transactions/withdraw
 * Create withdrawal request and deduct balance
 */
router.post('/withdraw', async (req, res) => {
  try {
    const { userId, amount, currency, wallet, full_name } = req.body;
    
    // Validate input
    if (!userId) {
      return res.status(400).json({ error: 'userId is required' });
    }
    if (!amount || amount <= 0) {
      return res.status(400).json({ error: 'Invalid amount' });
    }
    if (!currency || !['RUB', 'USDT', 'BTC'].includes(currency)) {
      return res.status(400).json({ error: 'Invalid currency' });
    }
    if (!wallet || wallet.length < 5) {
      return res.status(400).json({ error: 'Invalid wallet/card' });
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
    
    // Determine balance field
    const balanceField = currency === 'RUB' ? 'balance_rub' : 
                         currency === 'BTC' ? 'balance_btc' : 'balance_usdt';
    const currentBalance = parseFloat(user[balanceField]) || 0;

    // Check sufficient balance
    if (amount > currentBalance) {
      return res.status(400).json({ 
        error: 'Insufficient balance',
        available: currentBalance,
        requested: amount
      });
    }

    // Begin transaction
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Deduct balance
      const newBalance = currentBalance - amount;
      await client.query(
        `UPDATE users SET ${balanceField} = $1, updated_at = NOW() WHERE telegram_id = $2`,
        [newBalance, userId.toString()]
      );

      // Create withdraw request (таблица имеет только: user_id, amount, wallet, status)
      await client.query(
        `INSERT INTO withdraw_requests (user_id, amount, wallet, status, created_at)
         VALUES ($1, $2, $3, 'pending', NOW())`,
        [user.id, amount, `${currency}: ${wallet}`]
      );

      // Create transaction record
      await client.query(
        `INSERT INTO transactions (user_id, amount, currency, type, description, created_at)
         VALUES ($1, $2, $3, 'withdraw', $4, NOW())`,
        [user.id, amount, currency, `Вывод ${amount} ${currency} на ${wallet}`]
      );

      await client.query('COMMIT');

      // Return success
      res.json({
        success: true,
        message: `Заявка на вывод ${amount} ${currency} создана!`,
        data: {
          amount,
          currency,
          wallet,
          newBalance,
          status: 'pending'
        }
      });

    } catch (txError) {
      await client.query('ROLLBACK');
      throw txError;
    } finally {
      client.release();
    }

  } catch (error) {
    console.error('❌ Withdraw error:', error.message);
    res.status(500).json({ error: 'Server error: ' + error.message });
  }
});

/**
 * POST /api/transactions/deposit
 * Create deposit request (admin approves later)
 */
router.post('/deposit', async (req, res) => {
  try {
    const { userId, amount, currency } = req.body;

    if (!userId || !amount || amount <= 0 || !currency) {
      return res.status(400).json({ error: 'Invalid request data' });
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

    // Create deposit request (pending admin approval)
    await pool.query(
      `INSERT INTO deposit_requests (user_id, amount, currency, status, created_at)
       VALUES ($1, $2, $3, 'pending', NOW())`,
      [user.id, amount, currency]
    );

    res.json({
      success: true,
      message: `Заявка на пополнение ${amount} ${currency} создана`,
      data: {
        status: 'pending',
        amount,
        currency
      }
    });

  } catch (error) {
    console.error('❌ Deposit error:', error.message);
    res.status(500).json({ error: 'Server error' });
  }
});

/**
 * GET /api/transactions/history/:userId
 * Get user transaction history
 */
router.get('/history/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const limit = parseInt(req.query.limit) || 50;

    // First get user by telegram_id
    const userResult = await pool.query(
      'SELECT id FROM users WHERE telegram_id = $1',
      [userId.toString()]
    );

    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const result = await pool.query(
      `SELECT * FROM transactions 
       WHERE user_id = $1 
       ORDER BY created_at DESC 
       LIMIT $2`,
      [userResult.rows[0].id, limit]
    );

    res.json({
      success: true,
      data: result.rows
    });

  } catch (error) {
    console.error('❌ History error:', error.message);
    res.status(500).json({ error: 'Server error' });
  }
});

/**
 * POST /api/transactions/create-invoice
 * Create CryptoBot invoice for deposit
 */
router.post('/create-invoice', async (req, res) => {
  try {
    const { userId, amount } = req.body;
    const CRYPTOBOT_TOKEN = process.env.CRYPTOBOT_API_TOKEN;
    
    if (!CRYPTOBOT_TOKEN) {
      return res.status(500).json({ error: 'CryptoBot not configured' });
    }
    
    if (!userId || !amount || amount <= 0) {
      return res.status(400).json({ error: 'Invalid userId or amount' });
    }
    
    // Get user
    const userResult = await pool.query(
      'SELECT id, telegram_id, first_name FROM users WHERE telegram_id = $1',
      [userId.toString()]
    );
    
    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    const user = userResult.rows[0];
    
    // Create invoice via CryptoBot API
    const invoiceData = {
      asset: 'USDT',
      amount: amount.toString(),
      description: `Пополнение TrustEx: ${amount} USDT`,
      paid_btn_name: 'callback',
      paid_btn_url: process.env.WEB_APP_URL || 'https://trustex-trade.onrender.com',
      payload: JSON.stringify({ user_id: user.id, telegram_id: userId }),
      allow_comments: false,
      allow_anonymous: false
    };
    
    const response = await fetch('https://pay.crypt.bot/api/createInvoice', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Crypto-Pay-API-Token': CRYPTOBOT_TOKEN
      },
      body: JSON.stringify(invoiceData)
    });
    
    const result = await response.json();
    
    if (!result.ok) {
      console.error('CryptoBot error:', result);
      return res.status(400).json({ error: result.error?.name || 'Failed to create invoice' });
    }
    
    const invoice = result.result;
    
    // Save invoice to database
    await pool.query(
      `INSERT INTO crypto_invoices (user_id, invoice_id, amount, asset, status, pay_url)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [user.id, invoice.invoice_id.toString(), amount, 'USDT', 'pending', invoice.pay_url]
    );
    
    console.log(`💰 Invoice created: ${invoice.invoice_id} for user ${userId}, ${amount} USDT`);
    
    res.json({
      success: true,
      data: {
        invoice_id: invoice.invoice_id,
        amount: amount,
        asset: 'USDT',
        pay_url: invoice.pay_url,
        bot_invoice_url: invoice.bot_invoice_url
      }
    });
    
  } catch (error) {
    console.error('❌ Create invoice error:', error.message);
    res.status(500).json({ error: 'Server error: ' + error.message });
  }
});

module.exports = router;
