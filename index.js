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
      -- Tables
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

      -- Indexes
      CREATE INDEX IF NOT EXISTS idx_support_messages_user_id ON support_messages(user_id);

      -- Platform settings
      CREATE TABLE IF NOT EXISTS platform_settings (
        key VARCHAR(50) PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TIMESTAMP DEFAULT NOW()
      );
      INSERT INTO platform_settings (key, value) VALUES ('rub_usdt_rate', '92') ON CONFLICT (key) DO NOTHING;
      INSERT INTO platform_settings (key, value) VALUES ('eur_usdt_rate', '0.92') ON CONFLICT (key) DO NOTHING;

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
      CREATE INDEX IF NOT EXISTS idx_transactions_user_id ON transactions(user_id);
      CREATE INDEX IF NOT EXISTS idx_managers_ref_code ON managers(ref_code);
      CREATE INDEX IF NOT EXISTS idx_managers_sub_admin_id ON managers(sub_admin_id);
      CREATE INDEX IF NOT EXISTS idx_sub_admins_ref_code ON sub_admins(ref_code);
    `);

    console.log('✅ Migrations applied');
  } catch (err) {
    console.error('⚠️ Database error:', err.message);
  }
}

// Start server FIRST (critical for Render health check)
const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n🚀 Server running on port ${PORT} (${NODE_ENV})\n`);
  console.log(`📍 Local: http://localhost:${PORT}`);
  console.log(`🏥 Health: http://localhost:${PORT}/health\n`);
  
  // Initialize everything else AFTER server is listening
  initDatabase();
  initBot();
  initAdminBot();
  startTradeCloser(5000);
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n⏹️ Shutting down...');
  stopBot();
  stopAdminBot();
  stopTradeCloser();
  pool.end(() => {
    console.log('✅ Database pool closed');
    process.exit(0);
  });
});