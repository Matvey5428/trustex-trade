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

    // Get user by ID
    const userResult = await pool.query(
      'SELECT * FROM users WHERE id = $1',
      [userId]
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
        `UPDATE users SET ${balanceField} = $1, updated_at = NOW() WHERE id = $2`,
        [newBalance, userId]
      );

      // Create withdraw request
      await client.query(
        `INSERT INTO withdraw_requests (user_id, amount, currency, wallet_address, full_name, status, created_at)
         VALUES ($1, $2, $3, $4, $5, 'pending', NOW())`,
        [userId, amount, currency, wallet, full_name || '']
      );

      // Create transaction record
      await client.query(
        `INSERT INTO transactions (user_id, amount, currency, type, description, created_at)
         VALUES ($1, $2, $3, 'withdraw', $4, NOW())`,
        [userId, -amount, currency, `Вывод на ${wallet}`]
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

    // Create deposit request (pending admin approval)
    await pool.query(
      `INSERT INTO deposit_requests (user_id, amount, currency, status, created_at)
       VALUES ($1, $2, $3, 'pending', NOW())`,
      [userId, amount, currency]
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

    const result = await pool.query(
      `SELECT * FROM transactions 
       WHERE user_id = $1 
       ORDER BY created_at DESC 
       LIMIT $2`,
      [userId, limit]
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

module.exports = router;
