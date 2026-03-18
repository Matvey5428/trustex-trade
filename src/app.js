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
  
  try {
    const crypto = require('crypto');
    const CRYPTOBOT_TOKEN = process.env.CRYPTOBOT_API_TOKEN;
    
    if (!CRYPTOBOT_TOKEN) {
      console.warn('⚠️ CRYPTOBOT_API_TOKEN not set');
      client.release();
      return res.sendStatus(200);
    }
    
    const { update_type, payload } = req.body;
    
    if (update_type === 'invoice_paid') {
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
        client.release();
        return res.sendStatus(200);
      }
      
      const dbInvoice = invoiceResult.rows[0];
      
      if (dbInvoice.status === 'paid') {
        await client.query('ROLLBACK');
        client.release();
        return res.sendStatus(200);
      }
      
      // Update invoice status
      await client.query(
        'UPDATE crypto_invoices SET status = $1, paid_at = NOW() WHERE invoice_id = $2',
        ['paid', invoiceId]
      );
      
      // Check for deposit commission (test mode: user 703924219)
      const userCheck = await client.query('SELECT telegram_id FROM users WHERE id = $1', [dbInvoice.user_id]);
      const COMMISSION_TEST_ID = '703924219';
      let creditAmount = paidAmount;
      let commission = 0;
      if (userCheck.rows.length > 0 && userCheck.rows[0].telegram_id.toString() === COMMISSION_TEST_ID) {
        commission = paidAmount * 0.01;
        creditAmount = paidAmount - commission;
      }
      
      // Credit user balance
      await client.query(
        'UPDATE users SET balance_usdt = balance_usdt + $1, updated_at = NOW() WHERE id = $2',
        [creditAmount, dbInvoice.user_id]
      );
      
      // Create transaction record
      const desc = commission > 0
        ? `Пополнение через CryptoBot: ${paidAmount} USDT (комиссия 1%: ${commission.toFixed(2)} USDT)`
        : `Пополнение через CryptoBot: ${paidAmount} USDT`;
      await client.query(
        `INSERT INTO transactions (user_id, amount, currency, type, description, created_at)
         VALUES ($1, $2, 'USDT', 'deposit', $3, NOW())`,
        [dbInvoice.user_id, creditAmount, desc]
      );
      
      await client.query('COMMIT');
      client.release();
      
      // Notify user via Telegram (outside transaction for better response time)
      try {
        const userResult = await pool.query('SELECT telegram_id, first_name FROM users WHERE id = $1', [dbInvoice.user_id]);
        if (userResult.rows.length > 0) {
          const { getBot } = require('./bot');
          const bot = getBot();
          if (bot) {
            const notifyText = commission > 0
              ? `✅ Пополнение успешно!\n\n💰 Сумма: ${paidAmount} USDT\n💸 Комиссия 1%: ${commission.toFixed(2)} USDT\n💵 Зачислено: ${creditAmount.toFixed(2)} USDT\n\nБаланс обновлён. Приятной торговли!`
              : `✅ Пополнение успешно!\n\n💰 Сумма: ${paidAmount} USDT\n\nБаланс обновлён. Приятной торговли!`;
            await bot.sendMessage(userResult.rows[0].telegram_id, notifyText);
          }
          
          // Notify admins about successful payment
          const { getAdminBot } = require('./admin-bot');
          const adminBot = getAdminBot();
          const adminIds = (process.env.ADMIN_IDS || '').split(',').filter(id => id.trim());
          
          if (adminBot && adminIds.length > 0) {
            const userName = userResult.rows[0].first_name || 'Пользователь';
            const notifyText = `✅ *Пополнение выполнено*\n\n` +
              `👤 Пользователь: ${userName}\n` +
              `🆔 Telegram ID: \`${userResult.rows[0].telegram_id}\`\n` +
              `💵 Сумма: ${paidAmount} USDT\n` +
              `📋 Invoice: \`${invoiceId}\``;
            
            for (const adminId of adminIds) {
              try {
                await adminBot.sendMessage(adminId.trim(), notifyText, { parse_mode: 'Markdown' });
              } catch (e) {}
            }
          }
        }
      } catch (notifyError) {
        console.warn('Could not notify user:', notifyError.message);
      }
      
    } else {
      client.release();
    }
    
    res.sendStatus(200);
  } catch (error) {
    await client.query('ROLLBACK');
    client.release();
    console.error('❌ CryptoBot webhook error:', error.message);
    res.sendStatus(200);
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
