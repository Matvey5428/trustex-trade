/**
 * index.js - Entry point
 */

require('dotenv').config();
const app = require('./src/app');
const pool = require('./src/config/database');
const { initBot, stopBot } = require('./src/bot');
const { initAdminBot, stopAdminBot } = require('./src/admin-bot');
const { startTradeCloser, stopTradeCloser } = require('./src/services/tradeCloser');

const PORT = process.env.PORT || 3000;
const NODE_ENV = process.env.NODE_ENV || 'development';

async function initDatabase() {
  try {
    const res = await pool.query('SELECT NOW()');
    console.log('✅ Database connected at', res.rows[0].now);

    // All migrations in a single batch — idempotent (IF NOT EXISTS / IF NOT EXISTS)
    await pool.query(`
      -- Core tables (must be created first)
      CREATE TABLE IF NOT EXISTS users (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        telegram_id BIGINT UNIQUE NOT NULL,
        username VARCHAR(255),
        first_name VARCHAR(255),
        last_name VARCHAR(255),
        photo_url TEXT,
        balance_usdt NUMERIC(18,8) DEFAULT 0,
        balance_btc NUMERIC(18,8) DEFAULT 0,
        balance_rub NUMERIC(18,8) DEFAULT 0,
        verified BOOLEAN DEFAULT FALSE,
        status VARCHAR(20) DEFAULT 'active',
        is_admin BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS orders (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        amount NUMERIC(18,8) NOT NULL,
        direction VARCHAR(10) NOT NULL,
        duration INTEGER NOT NULL,
        trade_mode VARCHAR(10) DEFAULT 'loss',
        status VARCHAR(20) DEFAULT 'active',
        result VARCHAR(20),
        created_at TIMESTAMP DEFAULT NOW(),
        expires_at TIMESTAMP NOT NULL,
        closed_at TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS transactions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        order_id UUID REFERENCES orders(id) ON DELETE SET NULL,
        type VARCHAR(50) NOT NULL,
        amount NUMERIC(18,8) NOT NULL,
        currency VARCHAR(10) NOT NULL,
        description TEXT,
        created_at TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS deposit_requests (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        amount NUMERIC(18,8) NOT NULL,
        status VARCHAR(20) DEFAULT 'pending',
        created_at TIMESTAMP DEFAULT NOW(),
        approved_at TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS withdraw_requests (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        amount NUMERIC(18,8) NOT NULL,
        wallet TEXT,
        status VARCHAR(20) DEFAULT 'pending',
        created_at TIMESTAMP DEFAULT NOW(),
        processed_at TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS platform_settings (
        key VARCHAR(100) PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TIMESTAMP DEFAULT NOW()
      );

      -- Additional tables
      CREATE TABLE IF NOT EXISTS blocked_users (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        telegram_id VARCHAR(50) UNIQUE NOT NULL,
        reason TEXT,
        created_at TIMESTAMP DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS support_messages (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        sender VARCHAR(10) NOT NULL,
        message TEXT NOT NULL,
        is_read BOOLEAN DEFAULT FALSE,
        edited_at TIMESTAMP DEFAULT NULL,
        created_at TIMESTAMP DEFAULT NOW()
      );
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
      );
      CREATE TABLE IF NOT EXISTS managers (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        telegram_id VARCHAR(50) UNIQUE NOT NULL,
        name VARCHAR(100),
        ref_code VARCHAR(20) UNIQUE,
        sub_admin_id UUID,
        created_at TIMESTAMP DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS sub_admins (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        telegram_id VARCHAR(50) UNIQUE NOT NULL,
        name VARCHAR(100),
        ref_code VARCHAR(20) UNIQUE,
        created_at TIMESTAMP DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS pending_refs (
        telegram_id VARCHAR(50) PRIMARY KEY,
        ref_code VARCHAR(20) NOT NULL,
        created_at TIMESTAMP DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS message_templates (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        title VARCHAR(100) NOT NULL,
        message TEXT NOT NULL,
        created_by VARCHAR(50),
        owner_id VARCHAR(50),
        created_at TIMESTAMP DEFAULT NOW()
      );

      -- Users columns
      ALTER TABLE users ADD COLUMN IF NOT EXISTS trade_mode VARCHAR(10) DEFAULT 'loss';
      ALTER TABLE users ADD COLUMN IF NOT EXISTS balance_eur NUMERIC DEFAULT 0;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS manager_id UUID REFERENCES managers(id) ON DELETE SET NULL;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS manager_telegram_id BIGINT DEFAULT NULL;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS sub_admin_id UUID REFERENCES sub_admins(id) ON DELETE SET NULL;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS sub_admin_telegram_id BIGINT DEFAULT NULL;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS trading_blocked BOOLEAN DEFAULT FALSE;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS needs_verification BOOLEAN DEFAULT FALSE;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS verification_pending BOOLEAN DEFAULT FALSE;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS agreement_accepted_at TIMESTAMP DEFAULT NULL;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS show_agreement_to_user BOOLEAN DEFAULT FALSE;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS min_deposit NUMERIC(18,2) DEFAULT 0;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS min_withdraw NUMERIC(18,2) DEFAULT 0;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS min_withdraw_rub NUMERIC(18,2) DEFAULT 0;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS profit_multiplier NUMERIC(5,4) DEFAULT 0.0150;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS is_blocked BOOLEAN DEFAULT FALSE;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS security_pin VARCHAR(256) DEFAULT NULL;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS security_enabled BOOLEAN DEFAULT FALSE;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS biometric_enabled BOOLEAN DEFAULT FALSE;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS biometric_credential_id TEXT DEFAULT NULL;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS biometric_public_key TEXT DEFAULT NULL;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS last_security_auth TIMESTAMP DEFAULT NULL;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS verification_data JSONB DEFAULT NULL;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS bank_verif_amount NUMERIC(18,2) DEFAULT NULL;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS verification_rejected BOOLEAN DEFAULT FALSE;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS balance_eth NUMERIC(18,8) DEFAULT 0;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS balance_ton NUMERIC(18,8) DEFAULT 0;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS notifications_enabled BOOLEAN DEFAULT TRUE;

      -- Orders columns
      ALTER TABLE orders ADD COLUMN IF NOT EXISTS symbol VARCHAR(20) DEFAULT 'BTC';
      ALTER TABLE orders ADD COLUMN IF NOT EXISTS profit NUMERIC(18,8) DEFAULT 0;
      ALTER TABLE orders ADD COLUMN IF NOT EXISTS trade_mode VARCHAR(10) DEFAULT 'loss';

      -- Other table columns
      ALTER TABLE deposit_requests ADD COLUMN IF NOT EXISTS currency VARCHAR(10) DEFAULT 'USDT';
      ALTER TABLE support_messages ADD COLUMN IF NOT EXISTS edited_at TIMESTAMP DEFAULT NULL;
      ALTER TABLE managers ADD COLUMN IF NOT EXISTS ref_code VARCHAR(20) UNIQUE;
      ALTER TABLE managers ADD COLUMN IF NOT EXISTS sub_admin_id UUID REFERENCES sub_admins(id) ON DELETE SET NULL;
      ALTER TABLE message_templates ADD COLUMN IF NOT EXISTS owner_id VARCHAR(50);

      -- Reviews table
      CREATE TABLE IF NOT EXISTS reviews (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        telegram_id BIGINT NOT NULL,
        author_name VARCHAR(255) NOT NULL,
        rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
        text TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_reviews_telegram_id ON reviews(telegram_id);

      -- Admin logs
      CREATE TABLE IF NOT EXISTS admin_logs (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        admin_id UUID REFERENCES users(id) ON DELETE SET NULL,
        action VARCHAR(100) NOT NULL,
        details JSONB,
        created_at TIMESTAMP DEFAULT NOW()
      );

      -- Indexes
      CREATE INDEX IF NOT EXISTS idx_admin_logs_admin_id ON admin_logs(admin_id);
      CREATE INDEX IF NOT EXISTS idx_admin_logs_created_at ON admin_logs(created_at);
      CREATE INDEX IF NOT EXISTS idx_support_messages_user_id ON support_messages(user_id);

      INSERT INTO platform_settings (key, value) VALUES ('rub_usdt_rate', '83.33') ON CONFLICT (key) DO NOTHING;
      INSERT INTO platform_settings (key, value) VALUES ('eur_usdt_rate', '0.92') ON CONFLICT (key) DO NOTHING;
      INSERT INTO platform_settings (key, value) VALUES ('bot_notifications_enabled', 'true') ON CONFLICT (key) DO NOTHING;

      -- Crypto invoices: store original fiat currency/amount
      ALTER TABLE crypto_invoices ADD COLUMN IF NOT EXISTS original_currency VARCHAR(10) DEFAULT NULL;
      ALTER TABLE crypto_invoices ADD COLUMN IF NOT EXISTS original_amount DECIMAL(18,8) DEFAULT NULL;

      CREATE INDEX IF NOT EXISTS idx_crypto_invoices_user_id ON crypto_invoices(user_id);
      CREATE INDEX IF NOT EXISTS idx_crypto_invoices_invoice_id ON crypto_invoices(invoice_id);
      CREATE INDEX IF NOT EXISTS idx_users_telegram_id ON users(telegram_id);
      CREATE INDEX IF NOT EXISTS idx_users_manager_id ON users(manager_id);
      CREATE INDEX IF NOT EXISTS idx_users_manager_telegram_id ON users(manager_telegram_id);
      CREATE INDEX IF NOT EXISTS idx_users_sub_admin_id ON users(sub_admin_id);
      CREATE INDEX IF NOT EXISTS idx_orders_user_id ON orders(user_id);
      CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
      CREATE INDEX IF NOT EXISTS idx_orders_user_status ON orders(user_id, status);
      CREATE INDEX IF NOT EXISTS idx_orders_status_expires ON orders(status, expires_at);
      CREATE INDEX IF NOT EXISTS idx_transactions_user_id ON transactions(user_id);
      CREATE INDEX IF NOT EXISTS idx_transactions_user_type ON transactions(user_id, type);
      CREATE INDEX IF NOT EXISTS idx_withdraw_requests_user_id ON withdraw_requests(user_id);
      CREATE INDEX IF NOT EXISTS idx_withdraw_requests_status ON withdraw_requests(status);
      CREATE INDEX IF NOT EXISTS idx_deposit_requests_status ON deposit_requests(status);
      CREATE INDEX IF NOT EXISTS idx_support_messages_user_read ON support_messages(user_id, sender, is_read);
      CREATE INDEX IF NOT EXISTS idx_managers_ref_code ON managers(ref_code);
      CREATE INDEX IF NOT EXISTS idx_managers_sub_admin_id ON managers(sub_admin_id);
      CREATE INDEX IF NOT EXISTS idx_sub_admins_ref_code ON sub_admins(ref_code);
    `);

    console.log('✅ Migrations applied');
  } catch (err) {
    console.error('⚠️ Database error:', err.message);
  }

  // Separate migration for verification_rejected (ensures it runs even if main block had issues)
  try {
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS verification_rejected BOOLEAN DEFAULT FALSE`);
  } catch (err) {
    console.error('⚠️ verification_rejected migration error:', err.message);
  }

  // Migration: soft-delete columns for user deletion feature
  try {
    await pool.query(`
      ALTER TABLE users ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN DEFAULT FALSE;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP DEFAULT NULL;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS deletion_snapshot JSONB DEFAULT NULL;
    `);
  } catch (err) {
    console.error('⚠️ is_deleted migration error:', err.message);
  }
}

// Start server FIRST (critical for Render health check)
const server = app.listen(PORT, '0.0.0.0', async () => {
  console.log(`\n🚀 Server running on port ${PORT} (${NODE_ENV})\n`);
  console.log(`📍 Local: http://localhost:${PORT}`);
  console.log(`🏥 Health: http://localhost:${PORT}/health\n`);
  
  // Initialize everything else AFTER server is listening
  await initDatabase();
  initBot();
  initAdminBot();
  startTradeCloser(5000);
});

// Graceful shutdown
function shutdown() {
  console.log('\n⏹️ Shutting down...');
  stopBot();
  stopAdminBot();
  stopTradeCloser();
  pool.end(() => {
    console.log('✅ Database pool closed');
    process.exit(0);
  });
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);