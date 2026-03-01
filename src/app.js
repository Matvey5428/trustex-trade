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
  origin: process.env.CORS_ORIGIN || '*',
  credentials: true
}));

app.use(express.json());

// Static files with aggressive caching
app.use(express.static(path.join(__dirname, '../public'), {
  maxAge: '1d',
  etag: true,
  lastModified: true,
  setHeaders: (res, filePath) => {
    // Cache JS/CSS files longer
    if (filePath.endsWith('.js') || filePath.endsWith('.css')) {
      res.setHeader('Cache-Control', 'public, max-age=604800'); // 7 days
    }
    // HTML files - shorter cache
    if (filePath.endsWith('.html')) {
      res.setHeader('Cache-Control', 'public, max-age=3600'); // 1 hour
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

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/transactions', transactionRoutes);
app.use('/api/exchange', exchangeRoutes);
app.use('/api/user', userRoutes);
app.use('/api/profile', userRoutes);
app.use('/api/trades', tradesRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/reviews', reviewsRoutes);

// Telegram Bot Webhook endpoint (для production)
const webhookPath = getWebhookPath();
if (webhookPath) {
  app.post(webhookPath, (req, res) => {
    console.log('📩 Webhook update received');
    processUpdate(req.body);
    res.sendStatus(200);
  });
}

// Admin Bot Webhook endpoint (для production)
const adminWebhookPath = getAdminWebhookPath();
if (adminWebhookPath) {
  app.post(adminWebhookPath, (req, res) => {
    console.log('📩 Admin webhook update received');
    processAdminUpdate(req.body);
    res.sendStatus(200);
  });
}

// CryptoBot Payment Webhook
app.post('/api/cryptobot-webhook', async (req, res) => {
  console.log('📩 CryptoBot webhook received:', JSON.stringify(req.body).substring(0, 200));
  
  try {
    const pool = require('./config/database');
    const crypto = require('crypto');
    const CRYPTOBOT_TOKEN = process.env.CRYPTOBOT_API_TOKEN;
    
    if (!CRYPTOBOT_TOKEN) {
      console.warn('⚠️ CRYPTOBOT_API_TOKEN not set');
      return res.sendStatus(200);
    }
    
    const { update_type, payload } = req.body;
    
    console.log(`📩 CryptoBot update_type: ${update_type}`);
    
    if (update_type === 'invoice_paid') {
      const invoice = payload;
      const invoiceId = invoice.invoice_id.toString();
      const paidAmount = parseFloat(invoice.amount);
      
      console.log(`💰 CryptoBot payment received: Invoice ${invoiceId}, ${paidAmount} ${invoice.asset}`);
      
      // Get invoice from database
      const invoiceResult = await pool.query(
        'SELECT * FROM crypto_invoices WHERE invoice_id = $1',
        [invoiceId]
      );
      
      if (invoiceResult.rows.length === 0) {
        console.warn(`Invoice ${invoiceId} not found in database`);
        return res.sendStatus(200);
      }
      
      const dbInvoice = invoiceResult.rows[0];
      
      if (dbInvoice.status === 'paid') {
        console.log(`Invoice ${invoiceId} already processed`);
        return res.sendStatus(200);
      }
      
      // Update invoice status
      await pool.query(
        'UPDATE crypto_invoices SET status = $1, paid_at = NOW() WHERE invoice_id = $2',
        ['paid', invoiceId]
      );
      
      // Credit user balance
      await pool.query(
        'UPDATE users SET balance_usdt = balance_usdt + $1, updated_at = NOW() WHERE id = $2',
        [paidAmount, dbInvoice.user_id]
      );
      
      // Create transaction record
      await pool.query(
        `INSERT INTO transactions (user_id, amount, currency, type, description, created_at)
         VALUES ($1, $2, 'USDT', 'deposit', $3, NOW())`,
        [dbInvoice.user_id, paidAmount, `Пополнение через CryptoBot: ${paidAmount} USDT`]
      );
      
      // Notify user via Telegram
      try {
        const userResult = await pool.query('SELECT telegram_id, first_name FROM users WHERE id = $1', [dbInvoice.user_id]);
        if (userResult.rows.length > 0) {
          const { getBot } = require('./bot');
          const bot = getBot();
          if (bot) {
            await bot.sendMessage(userResult.rows[0].telegram_id, 
              `✅ Пополнение успешно!\n\n💰 Сумма: ${paidAmount} USDT\n\nБаланс обновлён. Приятной торговли!`
            );
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
      
      console.log(`✅ Balance credited: ${paidAmount} USDT to user ${dbInvoice.user_id}`);
    }
    
    res.sendStatus(200);
  } catch (error) {
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
