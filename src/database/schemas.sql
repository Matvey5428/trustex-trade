/**
 * src/database/schemas.sql
 * Database schema initialization
 * 
 * To run: psql -U postgres -d nexo_trade -f src/database/schemas.sql
 */

-- Create extension for UUID
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Users table
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
  status VARCHAR(20) DEFAULT 'active', -- active | blocked
  is_admin BOOLEAN DEFAULT FALSE,
  
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  
  CONSTRAINT check_balance_usdt CHECK (balance_usdt >= 0),
  CONSTRAINT check_balance_btc CHECK (balance_btc >= 0),
  CONSTRAINT check_balance_rub CHECK (balance_rub >= 0)
);

-- Create index on telegram_id for fast lookups
CREATE INDEX idx_users_telegram_id ON users(telegram_id);
CREATE INDEX idx_users_status ON users(status);

-- Orders table
CREATE TABLE IF NOT EXISTS orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  
  amount NUMERIC(18,8) NOT NULL,
  direction VARCHAR(10) NOT NULL, -- up | down
  duration INTEGER NOT NULL, -- seconds
  
  status VARCHAR(20) DEFAULT 'active', -- active | resolving | closed
  result VARCHAR(20), -- win | lose | null (when active)
  
  created_at TIMESTAMP DEFAULT NOW(),
  expires_at TIMESTAMP NOT NULL,
  closed_at TIMESTAMP,
  
  CONSTRAINT check_amount CHECK (amount > 0),
  CONSTRAINT check_duration CHECK (duration > 0)
);

CREATE INDEX idx_orders_user_id ON orders(user_id);
CREATE INDEX idx_orders_status ON orders(status);
CREATE INDEX idx_orders_expires_at ON orders(expires_at);

-- Transactions table
CREATE TABLE IF NOT EXISTS transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  order_id UUID REFERENCES orders(id) ON DELETE SET NULL,
  
  type VARCHAR(50) NOT NULL, -- order_freeze | order_win | order_lose | deposit | withdraw | admin_adjust
  amount NUMERIC(18,8) NOT NULL,
  currency VARCHAR(10) NOT NULL, -- USDT | BTC | RUB
  
  description TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  
  CONSTRAINT check_amount CHECK (amount > 0)
);

CREATE INDEX idx_transactions_user_id ON transactions(user_id);
CREATE INDEX idx_transactions_type ON transactions(type);
CREATE INDEX idx_transactions_created_at ON transactions(created_at);

-- System settings
CREATE TABLE IF NOT EXISTS system_settings (
  key VARCHAR(100) PRIMARY KEY,
  value TEXT NOT NULL,
  description TEXT,
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Insert default settings
INSERT INTO system_settings (key, value, description) VALUES
  ('order_mode', 'random', 'Mode for order resolution: all_win | all_lose | random'),
  ('win_rate', '50', 'Win rate percentage (0-100) when mode is random')
ON CONFLICT (key) DO NOTHING;

-- Deposit requests
CREATE TABLE IF NOT EXISTS deposit_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  
  amount NUMERIC(18,8) NOT NULL,
  status VARCHAR(20) DEFAULT 'pending', -- pending | approved | rejected
  
  created_at TIMESTAMP DEFAULT NOW(),
  approved_at TIMESTAMP,
  
  CONSTRAINT check_amount CHECK (amount > 0)
);

CREATE INDEX idx_deposit_requests_user_id ON deposit_requests(user_id);
CREATE INDEX idx_deposit_requests_status ON deposit_requests(status);

-- Withdraw requests
CREATE TABLE IF NOT EXISTS withdraw_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  
  amount NUMERIC(18,8) NOT NULL,
  wallet VARCHAR(255) NOT NULL,
  status VARCHAR(20) DEFAULT 'pending', -- pending | approved | rejected
  
  created_at TIMESTAMP DEFAULT NOW(),
  approved_at TIMESTAMP,
  
  CONSTRAINT check_amount CHECK (amount > 0)
);

CREATE INDEX idx_withdraw_requests_user_id ON withdraw_requests(user_id);
CREATE INDEX idx_withdraw_requests_status ON withdraw_requests(status);

-- Admin logs
CREATE TABLE IF NOT EXISTS admin_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id UUID REFERENCES users(id) ON DELETE SET NULL,
  
  action VARCHAR(100) NOT NULL,
  details JSONB,
  
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_admin_logs_admin_id ON admin_logs(admin_id);
CREATE INDEX idx_admin_logs_created_at ON admin_logs(created_at);

-- Print completion message
\echo 'Database schema created successfully!'
