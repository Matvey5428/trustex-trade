/**
 * src/routes/transactions.js
 * Routes for deposits and withdrawals
 */

const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const { getAdminBot } = require('../admin-bot');

async function areBotNotificationsEnabled() {
  try {
    const result = await pool.query("SELECT value FROM platform_settings WHERE key = 'bot_notifications_enabled'");
    return result.rows[0]?.value !== 'false';
  } catch (e) {
    return true;
  }
}

/**
 * GET /api/transactions/rates
 * Public endpoint: get exchange rates for deposit conversion
 */
router.get('/rates', async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT key, value FROM platform_settings WHERE key IN ('rub_usdt_rate', 'eur_usdt_rate')"
    );
    const rates = {};
    result.rows.forEach(r => { rates[r.key] = parseFloat(r.value); });
    res.json({ success: true, data: rates });
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
});

/**
 * Notify manager about withdrawal request from their user
 */
async function notifyManagerAboutWithdraw(user, amount, currency, wallet) {
  const notifyEnabled = await areBotNotificationsEnabled();
  if (!notifyEnabled) return;
  const adminBot = getAdminBot();
  if (!adminBot) return;

  const MAIN_ADMIN_ID = process.env.ADMIN_IDS?.split(',')[0]?.trim();
  const currencySymbol = currency === 'RUB' ? '₽' : currency === 'EUR' ? '€' : currency === 'BTC' ? '₿' : '$';
  
  const message = `💸 <b>Заявка на вывод</b>\n\n` +
    `👤 Пользователь: ${user.first_name || ''} ${user.last_name || ''} (@${user.username || 'нет'})\n` +
    `💰 Сумма: <b>${currencySymbol}${amount}</b> ${currency}\n` +
    `📋 Реквизиты: <code>${wallet}</code>\n` +
    `📅 Статус: ожидает обработки`;

  // Always notify main admin
  if (MAIN_ADMIN_ID) {
    try {
      await adminBot.sendMessage(MAIN_ADMIN_ID, message, { parse_mode: 'HTML' });
    } catch (e) {
      console.log('Failed to notify main admin about withdraw:', e.message);
    }
  }

  // Notify manager if exists
  if (!user.manager_id) return;

  try {
    const managerResult = await pool.query(
      'SELECT telegram_id FROM managers WHERE id = $1',
      [user.manager_id]
    );
    
    if (managerResult.rows.length === 0) return;
    
    const managerTelegramId = managerResult.rows[0].telegram_id;
    if (!managerTelegramId || managerTelegramId === MAIN_ADMIN_ID) return;

    await adminBot.sendMessage(managerTelegramId, message, { parse_mode: 'HTML' });
  } catch (e) {
    console.log('Failed to notify manager about withdraw:', e.message);
  }
}

/**
 * POST /api/transactions/withdraw
 * Create withdrawal request and deduct balance
 */
router.post('/withdraw', async (req, res) => {
  const client = await pool.connect();
  try {
    const { userId, currency, wallet, full_name } = req.body;
    const amount = parseFloat(req.body.amount);
    
    // Validate input
    if (!userId) {
      return res.status(400).json({ error: 'userId is required' });
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({ error: 'Invalid amount' });
    }
    if (!currency || !['RUB', 'EUR', 'USDT'].includes(currency)) {
      return res.status(400).json({ error: 'Invalid currency' });
    }
    if (!wallet || wallet.length < 5) {
      return res.status(400).json({ error: 'Invalid wallet/card' });
    }

    await client.query('BEGIN');

    // Get user by telegram_id WITH LOCK to prevent race condition
    const userResult = await client.query(
      'SELECT * FROM users WHERE telegram_id = $1 FOR UPDATE',
      [userId.toString()]
    );

    if (userResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'User not found' });
    }

    const user = userResult.rows[0];
    
    // Check minimum withdrawal amount
    const minWithdraw = parseFloat(user.min_withdraw) || 0;
    const minWithdrawRub = parseFloat(user.min_withdraw_rub) || 0;
    
    // Check min for non-RUB (USDT, EUR)
    if (currency !== 'RUB' && minWithdraw > 0 && amount < minWithdraw) {
      await client.query('ROLLBACK');
      return res.status(400).json({ 
        error: `Минимальная сумма вывода: ${minWithdraw} ${currency}`,
        min_withdraw: minWithdraw
      });
    }
    
    // Check min for RUB
    if (currency === 'RUB' && minWithdrawRub > 0 && amount < minWithdrawRub) {
      await client.query('ROLLBACK');
      return res.status(400).json({ 
        error: `Минимальная сумма вывода: ${minWithdrawRub} ₽`,
        min_withdraw_rub: minWithdrawRub
      });
    }
    
    // Check if verification is required
    if (user.needs_verification && !user.verified) {
      await client.query('ROLLBACK');
      return res.status(403).json({ 
        error: 'Для вывода средств требуется верификация',
        verification_required: true
      });
    }
    
    // Check if bank requisite verification is pending
    const bankVerifAmount = parseFloat(user.bank_verif_amount);
    if (bankVerifAmount > 0) {
      await client.query('ROLLBACK');
      return res.status(403).json({ 
        error: 'Для вывода средств необходимо подтвердить банковские реквизиты',
        bank_verif_required: true,
        bank_verif_amount: bankVerifAmount
      });
    }
    
    // Determine balance field
    const BALANCE_FIELDS = { 'RUB': 'balance_rub', 'EUR': 'balance_eur', 'USDT': 'balance_usdt' };
    const balanceField = BALANCE_FIELDS[currency];
    if (!balanceField) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Invalid currency' });
    }
    const currentBalance = parseFloat(user[balanceField]) || 0;

    // Deduct balance (atomic)
    const updateResult = await client.query(
      `UPDATE users SET ${balanceField} = ${balanceField} - $1, updated_at = NOW() WHERE id = $2 AND ${balanceField} >= $1 RETURNING ${balanceField}`,
      [amount, user.id]
    );
    if (updateResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: `Недостаточно средств. Баланс ${currency}: ${currentBalance}` });
    }
    const newBalance = parseFloat(updateResult.rows[0][balanceField]) || 0;

    // Create withdraw request
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

    // Notify manager (async, don't wait)
    notifyManagerAboutWithdraw(user, amount, currency, wallet).catch(e => {
      console.log('Could not notify manager about withdraw:', e.message);
    });

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

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('❌ Withdraw error:', error.message);
    res.status(500).json({ error: 'Server error: ' + error.message });
  } finally {
    client.release();
  }
});

/**
 * POST /api/transactions/deposit
 * Create deposit request (admin approves later)
 */
router.post('/deposit', async (req, res) => {
  try {
    const { userId, currency } = req.body;
    const amount = parseFloat(req.body.amount);

    if (!userId || !Number.isFinite(amount) || amount <= 0 || !currency) {
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
    const limit = Math.min(parseInt(req.query.limit) || 50, 200);

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
       WHERE user_id = $1 AND type IN ('deposit', 'withdraw')
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
    const { userId, sendToBot, currency } = req.body;
    const amount = parseFloat(req.body.amount);
    const CRYPTOBOT_TOKEN = process.env.CRYPTOBOT_API_TOKEN;
    
    if (!CRYPTOBOT_TOKEN) {
      return res.status(500).json({ error: 'CryptoBot not configured' });
    }
    
    if (!userId || !Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({ error: 'Invalid userId or amount' });
    }
    
    const depositCurrency = (currency || 'USDT').toUpperCase();
    
    // Get user
    const userResult = await pool.query(
      'SELECT id, telegram_id, first_name, min_deposit, manager_telegram_id FROM users WHERE telegram_id = $1',
      [userId.toString()]
    );
    
    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    const user = userResult.rows[0];
    
    // Convert fiat to USDT if needed
    let usdtAmount = amount;
    let originalCurrency = null;
    let originalAmount = null;
    
    if (depositCurrency === 'RUB' || depositCurrency === 'EUR') {
      const rateKey = depositCurrency === 'RUB' ? 'rub_usdt_rate' : 'eur_usdt_rate';
      const rateResult = await pool.query(
        'SELECT value FROM platform_settings WHERE key = $1', [rateKey]
      );
      if (rateResult.rows.length === 0) {
        return res.status(500).json({ error: 'Exchange rate not configured' });
      }
      const rate = parseFloat(rateResult.rows[0].value);
      if (depositCurrency === 'RUB') {
        // rate = how many RUB per 1 USDT
        usdtAmount = parseFloat((amount / rate).toFixed(2));
      } else {
        // rate = how many EUR per 1 USDT
        usdtAmount = parseFloat((amount / rate).toFixed(2));
      }
      originalCurrency = depositCurrency;
      originalAmount = amount;
      
      if (usdtAmount < 1) {
        return res.status(400).json({ error: `Слишком маленькая сумма. Минимум: ${depositCurrency === 'RUB' ? Math.ceil(rate) + ' ₽' : rate.toFixed(2) + ' €'}` });
      }
    } else {
      // USDT direct — check min deposit
      const minDeposit = parseFloat(user.min_deposit) || 0;
      if (minDeposit > 0 && amount < minDeposit) {
        return res.status(400).json({ 
          error: `Минимальная сумма пополнения: ${minDeposit} USDT`,
          min_deposit: minDeposit
        });
      }
    }
    
    // Display info for description
    const displayAmount = originalCurrency 
      ? `${originalAmount} ${originalCurrency} (≈${usdtAmount} USDT)`
      : `${usdtAmount} USDT`;
    
    // Create invoice via CryptoBot API
    const invoiceData = {
      asset: 'USDT',
      amount: usdtAmount.toString(),
      description: `Пополнение TrustEx: ${displayAmount}`,
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
    
    // Save invoice to database (with original currency/amount if fiat)
    await pool.query(
      `INSERT INTO crypto_invoices (user_id, invoice_id, amount, asset, status, pay_url, original_currency, original_amount)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [user.id, invoice.invoice_id.toString(), usdtAmount, 'USDT', 'pending', invoice.pay_url, originalCurrency, originalAmount]
    );
    
    console.log(`💰 Invoice created: ${invoice.invoice_id} for user ${userId}, ${displayAmount}`);
    
    // Notify admins and manager about new deposit request
    try {
      const notifyEnabled = await areBotNotificationsEnabled();
      if (notifyEnabled) {
        const { getAdminBot } = require('../admin-bot');
        const adminBot = getAdminBot();
        
        if (adminBot) {
          const userName = user.first_name || 'Пользователь';
          const notifyText = `💰 *Новая заявка на пополнение*\n\n` +
            `👤 Пользователь: ${userName}\n` +
            `🆔 Telegram ID: \`${userId}\`\n` +
            `💵 Сумма: ${displayAmount}\n` +
            `📋 Invoice: \`${invoice.invoice_id}\`\n` +
            `⏳ Статус: Ожидает оплаты`;
          
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
              await adminBot.sendMessage(recipientId, notifyText, {
                parse_mode: 'Markdown',
                reply_markup: {
                  inline_keyboard: [[
                    { text: '✅ Подтвердить оплату', callback_data: `confirm_invoice_${invoice.invoice_id}` }
                  ]]
                }
              });
            } catch (e) {
              console.warn(`Could not notify ${recipientId}:`, e.message);
            }
          }
        }
      }
    } catch (notifyError) {
      console.warn('Could not notify admins/manager:', notifyError.message);
    }
    
    // Send payment link to bot if requested
    if (sendToBot) {
      try {
        const notifyEnabled2 = await areBotNotificationsEnabled();
        if (notifyEnabled2) {
          const { getBot } = require('../bot');
          const bot = getBot();
          if (bot) {
            await bot.sendMessage(userId, 
              `💳 *Ссылка для пополнения TrustEx*\n\n` +
              `💰 Сумма: ${displayAmount}\n\n` +
              `Нажмите на ссылку ниже для оплаты:\n${invoice.pay_url}`,
              { parse_mode: 'Markdown' }
            );
          }
        }
      } catch (botError) {
        console.warn('Could not send payment link to bot:', botError.message);
      }
    }
    
    res.json({
      success: true,
      data: {
        invoice_id: invoice.invoice_id,
        amount: usdtAmount,
        asset: 'USDT',
        pay_url: invoice.pay_url,
        bot_invoice_url: invoice.bot_invoice_url,
        original_currency: originalCurrency,
        original_amount: originalAmount
      }
    });
    
  } catch (error) {
    console.error('❌ Create invoice error:', error.message);
    res.status(500).json({ error: 'Server error: ' + error.message });
  }
});

module.exports = router;
