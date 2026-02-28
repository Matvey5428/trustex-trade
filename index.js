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
    
    // Run migration: create support_messages table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS support_messages (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        sender VARCHAR(10) NOT NULL, -- 'user' or 'admin'
        message TEXT NOT NULL,
        is_read BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);
    
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_support_messages_user_id ON support_messages(user_id)
    `);
    
    // Run migration: create crypto_invoices table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS crypto_invoices (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        invoice_id VARCHAR(100) UNIQUE NOT NULL,
        amount DECIMAL(18,8) NOT NULL,
        asset VARCHAR(10) NOT NULL DEFAULT 'USDT',
        status VARCHAR(20) DEFAULT 'pending',
        pay_url TEXT,
        created_at TIMESTAMP DEFAULT NOW(),
        paid_at TIMESTAMP
      )
    `);
    
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_crypto_invoices_user_id ON crypto_invoices(user_id)
    `);
    
    // Run migration: create managers table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS managers (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        telegram_id VARCHAR(50) UNIQUE NOT NULL,
        name VARCHAR(100),
        ref_code VARCHAR(20) UNIQUE,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);
    
    // Add ref_code column if not exists
    await pool.query(`
      ALTER TABLE managers ADD COLUMN IF NOT EXISTS ref_code VARCHAR(20) UNIQUE
    `);
    
    // Run migration: add manager_id to users
    await pool.query(`
      ALTER TABLE users 
      ADD COLUMN IF NOT EXISTS manager_id UUID REFERENCES managers(id) ON DELETE SET NULL
    `);
    
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_users_manager_id ON users(manager_id)
    `);
    
    // Run migration: create pending_refs table for storing ref until user registers
    await pool.query(`
      CREATE TABLE IF NOT EXISTS pending_refs (
        telegram_id VARCHAR(50) PRIMARY KEY,
        ref_code VARCHAR(20) NOT NULL,
        created_at TIMESTAMP DEFAULT NOW()
      )
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