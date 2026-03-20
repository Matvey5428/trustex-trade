/**
 * src/app.js
 * Express application setup
 */

const express = require('express');
const cors = require('cors');
const compression = require('compression');
const path = require('path');
require('dotenv').config();

const authRoutes = require('./routes/auth');
const transactionRoutes = require('./routes/transactions');
const exchangeRoutes = require('./routes/exchange');
const userRoutes = require('./routes/user');
const tradesRoutes = require('./routes/trades');
const adminRoutes = require('./routes/admin');
const reviewsRoutes = require('./routes/reviews');
const securityRoutes = require('./routes/security');
const { processUpdate, getWebhookPath } = require('./bot');
const { processAdminUpdate, getAdminWebhookPath } = require('./admin-bot');
const pool = require('./config/database');

async function areBotNotificationsEnabled() {
  try {
    const result = await pool.query("SELECT value FROM platform_settings WHERE key = 'bot_notifications_enabled'");
    return result.rows[0]?.value !== 'false';
  } catch (e) {
    return true;
  }
}

const app = express();

// Gzip compression for all responses
app.use(compression({
  level: 6,
  threshold: 1024, // Only compress responses > 1KB
  filter: (req, res) => {
    if (req.headers['x-no-compression']) return false;
    return compression.filter(req, res);
  }
}));

// Middlewares
app.use(cors({
  origin: process.env.CORS_ORIGIN || process.env.WEB_APP_URL || '*',
  credentials: true
}));

app.use(express.json());

// Static files - no cache for development, short cache for production
app.use(express.static(path.join(__dirname, '../public'), {
  etag: true,
  lastModified: true,
  setHeaders: (res, filePath) => {
    // No cache for HTML - always fresh
    if (filePath.endsWith('.html')) {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
    } else if (filePath.endsWith('.js') || filePath.endsWith('.css')) {
      res.setHeader('Cache-Control', 'public, max-age=300'); // 5 minutes
    } else if (filePath.match(/\.(png|jpg|jpeg|gif|svg|ico|woff2?|ttf|eot)$/)) {
      res.setHeader('Cache-Control', 'public, max-age=604800'); // 7 days
    }
  }
}));

// Request logging (only in development)
if (process.env.NODE_ENV !== 'production') {
  app.use((req, res, next) => {
    if (req.path.startsWith('/api')) {
      console.log(`📨 ${req.method} ${req.path}`);
    }
    next();
  });
}

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Version check (for cache busting)
const APP_VERSION = Date.now().toString();
app.get('/version', (req, res) => {
  res.json({ version: APP_VERSION, deployed: new Date().toISOString() });
});

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/transactions', transactionRoutes);
app.use('/api/exchange', exchangeRoutes);
app.use('/api/user', userRoutes);
app.use('/api/profile', userRoutes);
app.use('/api/trades', tradesRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/reviews', reviewsRoutes);
app.use('/api/security', securityRoutes);

// Telegram Bot Webhook endpoint (для production)
const webhookPath = getWebhookPath();
if (webhookPath) {
  app.post(webhookPath, (req, res) => {
    processUpdate(req.body);
    res.sendStatus(200);
  });
}

// Admin Bot Webhook endpoint (для production)
const adminWebhookPath = getAdminWebhookPath();
if (adminWebhookPath) {
  app.post(adminWebhookPath, (req, res) => {
    processAdminUpdate(req.body);
    res.sendStatus(200);
  });
}

// CryptoBot Payment Webhook
app.post('/api/cryptobot-webhook', async (req, res) => {
  const pool = require('./config/database');
  const client = await pool.connect();
  let committed = false;
  
  try {
    const crypto = require('crypto');
    const CRYPTOBOT_TOKEN = process.env.CRYPTOBOT_API_TOKEN;
    
    if (!CRYPTOBOT_TOKEN) {
      console.warn('⚠️ CRYPTOBOT_API_TOKEN not set');
      return res.sendStatus(200);
    }
    
    // Verify CryptoBot webhook signature
    const signature = req.headers['crypto-pay-api-signature'];
    if (signature) {
      const secret = crypto.createHash('sha256').update(CRYPTOBOT_TOKEN).digest();
      const checkString = JSON.stringify(req.body);
      const hmac = crypto.createHmac('sha256', secret).update(checkString).digest('hex');
      if (hmac !== signature) {
        console.warn('⚠️ Invalid CryptoBot webhook signature');
        return res.sendStatus(200);
      }
    }
    
    const { update_type, payload } = req.body;
    
    if (update_type !== 'invoice_paid' || !payload) {
      return res.sendStatus(200);
    }

    const invoice = payload;
    const invoiceId = invoice.invoice_id.toString();
    const paidAmount = parseFloat(invoice.amount);
    
    await client.query('BEGIN');
    
    // Get invoice from database with lock to prevent double credit
    const invoiceResult = await client.query(
      'SELECT * FROM crypto_invoices WHERE invoice_id = $1 FOR UPDATE',
      [invoiceId]
    );
    
    if (invoiceResult.rows.length === 0) {
      console.warn(`Invoice ${invoiceId} not found in database`);
      await client.query('ROLLBACK');
      return res.sendStatus(200);
    }
    
    const dbInvoice = invoiceResult.rows[0];
    
    if (dbInvoice.status === 'paid') {
      await client.query('ROLLBACK');
      return res.sendStatus(200);
    }
    
    // Update invoice status
    await client.query(
      'UPDATE crypto_invoices SET status = $1, paid_at = NOW() WHERE invoice_id = $2',
      ['paid', invoiceId]
    );
    
    // Determine what balance to credit
    const origCurrency = dbInvoice.original_currency; // RUB, EUR, or null (USDT)
    const origAmount = dbInvoice.original_amount ? parseFloat(dbInvoice.original_amount) : null;
    
    // Deposit commission (1% for all users)
    let commission = 0;
    
    let balanceField, creditAmount, creditCurrency, displayAmount;
    
    if (origCurrency === 'RUB') {
      balanceField = 'balance_rub';
      creditAmount = origAmount;
      creditCurrency = 'RUB';
      displayAmount = `${origAmount} ₽`;
    } else if (origCurrency === 'EUR') {
      balanceField = 'balance_eur';
      creditAmount = origAmount;
      creditCurrency = 'EUR';
      displayAmount = `${origAmount} €`;
    } else {
      balanceField = 'balance_usdt';
      creditAmount = paidAmount;
      creditCurrency = 'USDT';
      displayAmount = `${paidAmount} USDT`;
    }
    
    // Apply 1% commission
    commission = parseFloat((creditAmount * 0.01).toFixed(2));
    creditAmount = parseFloat((creditAmount - commission).toFixed(2));
    
    // Credit user balance (atomic increment)
    await client.query(
      `UPDATE users SET ${balanceField} = ${balanceField} + $1, updated_at = NOW() WHERE id = $2`,
      [creditAmount, dbInvoice.user_id]
    );
    
    // Create transaction record
    let desc = `Пополнение через CryptoBot: ${displayAmount}`;
    if (commission > 0) {
      const sym = creditCurrency === 'RUB' ? '₽' : creditCurrency === 'EUR' ? '€' : 'USDT';
      desc += ` (комиссия 1%: ${commission.toFixed(2)} ${sym})`;
    }
    await client.query(
      `INSERT INTO transactions (user_id, amount, currency, type, description, created_at)
       VALUES ($1, $2, $3, 'deposit', $4, NOW())`,
      [dbInvoice.user_id, creditAmount, creditCurrency, desc]
    );
    
    await client.query('COMMIT');
    committed = true;
    
    // Respond to CryptoBot immediately
    res.sendStatus(200);
    
    // Notify user via Telegram (outside transaction, after response)
    try {
      const notifyEnabled = await areBotNotificationsEnabled();
      if (notifyEnabled) {
        const userResult = await pool.query('SELECT telegram_id, first_name FROM users WHERE id = $1', [dbInvoice.user_id]);
        if (userResult.rows.length > 0) {
          const { getBot } = require('./bot');
          const bot = getBot();
          if (bot) {
            let notifyText = `✅ Пополнение успешно!\n\n💰 Сумма: ${displayAmount}`;
            if (commission > 0) {
              const sym = creditCurrency === 'RUB' ? '₽' : creditCurrency === 'EUR' ? '€' : 'USDT';
              notifyText += `\n💸 Комиссия 1%: ${commission.toFixed(2)} ${sym}\n💵 Зачислено: ${creditAmount.toFixed(2)} ${sym}`;
            }
            notifyText += `\n\nБаланс обновлён. Приятной торговли!`;
            await bot.sendMessage(userResult.rows[0].telegram_id, notifyText);
          }
          
          // Notify admins about successful payment
          const { getAdminBot } = require('./admin-bot');
          const adminBot = getAdminBot();
          const adminIds = (process.env.ADMIN_IDS || '').split(',').filter(id => id.trim());
          
          if (adminBot && adminIds.length > 0) {
            const userName = userResult.rows[0].first_name || 'Пользователь';
            const adminText = `✅ *Пополнение выполнено*\n\n` +
              `👤 Пользователь: ${userName}\n` +
              `🆔 Telegram ID: \`${userResult.rows[0].telegram_id}\`\n` +
              `💵 Сумма: ${displayAmount}\n` +
              `📋 Invoice: \`${invoiceId}\``;
            
            for (const adminId of adminIds) {
              try {
                await adminBot.sendMessage(adminId.trim(), adminText, { parse_mode: 'Markdown' });
              } catch (e) {}
            }
          }
        }
      }
    } catch (notifyError) {
      console.warn('Could not notify user:', notifyError.message);
    }
    
  } catch (error) {
    if (!committed) {
      try { await client.query('ROLLBACK'); } catch (e) {}
    }
    console.error('❌ CryptoBot webhook error:', error.message);
    if (!res.headersSent) res.sendStatus(200);
  } finally {
    client.release();
  }
});

// Serve frontend SPA (catch-all для остальных маршрутов)
app.use((req, res, next) => {
  // Если это API запрос что до сюда дошёл - это 404
  if (req.path.startsWith('/api')) {
    console.error(`❌ API endpoint not found: ${req.method} ${req.path}`);
    return res.status(404).json({ 
      error: `Endpoint not found: ${req.method} ${req.path}`, 
      status: 404 
    });
  }
  // Если это не API запрос - отправляем index.html для SPA
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

// Error handler (должен быть в конце)
app.use((error, req, res, next) => {
  console.error('❌ Error:', {
    message: error.message,
    status: error.status || 500,
    path: req.path,
    method: req.method,
    ...(process.env.NODE_ENV === 'development' && { stack: error.stack })
  });
  
  const status = error.status || 500;
  const message = error.message || 'Internal server error';
  
  res.status(status).json({
    error: message,
    status,
    ...(process.env.NODE_ENV === 'development' && { stack: error.stack })
  });
});

module.exports = app;
