/**
 * index.js - Entry point
 */

require('dotenv').config();
const app = require('./src/app');
const pool = require('./src/config/database');
const { initBot, stopBot } = require('./src/bot');
const { initAdminBot, stopAdminBot } = require('./src/admin-bot');

const PORT = process.env.PORT || 3000;
const NODE_ENV = process.env.NODE_ENV || 'development';

// Test database connection and run migrations
async function initDatabase() {
  try {
    const res = await pool.query('SELECT NOW()');
    console.log('✅ Database connected at', res.rows[0].now);
    
    // Run migration: add trade_mode column if not exists
    await pool.query(`
      ALTER TABLE users 
      ADD COLUMN IF NOT EXISTS trade_mode VARCHAR(10) DEFAULT 'loss'
    `);
    
    // Run migration: add symbol column to orders
    await pool.query(`
      ALTER TABLE orders 
      ADD COLUMN IF NOT EXISTS symbol VARCHAR(20) DEFAULT 'BTC'
    `);
    
    console.log('✅ Migrations applied');
  } catch (err) {
    console.error('⚠️ Database error:', err.message);
  }
}

initDatabase();

// Start Telegram Bots
initBot();
initAdminBot();

// Start server (regardless of DB status)
app.listen(PORT, () => {
  console.log(`\n🚀 Server running on port ${PORT} (${NODE_ENV})\n`);
  console.log(`📍 Local: http://localhost:${PORT}`);
  console.log(`🏥 Health: http://localhost:${PORT}/health\n`);
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n⏹️ Shutting down...');
  stopBot();
  stopAdminBot();
  pool.end(() => {
    console.log('✅ Database pool closed');
    process.exit(0);
  });
});