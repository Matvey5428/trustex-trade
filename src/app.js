/**
 * src/app.js
 * Express application setup
 */

const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const authRoutes = require('./routes/auth');
const transactionRoutes = require('./routes/transactions');
const exchangeRoutes = require('./routes/exchange');
const userRoutes = require('./routes/user');
const tradesRoutes = require('./routes/trades');
const { processUpdate, getWebhookPath } = require('./bot');

const app = express();

// Middlewares
app.use(cors({
  origin: process.env.CORS_ORIGIN || '*',
  credentials: true
}));

app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

// Request logging для DEBUG
app.use((req, res, next) => {
  if (req.path.startsWith('/api')) {
    console.log(`📨 ${req.method} ${req.path}`);
  }
  next();
});

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

// Telegram Bot Webhook endpoint (для production)
const webhookPath = getWebhookPath();
if (webhookPath) {
  app.post(webhookPath, (req, res) => {
    console.log('📩 Webhook update received');
    processUpdate(req.body);
    res.sendStatus(200);
  });
}
// etc...

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
