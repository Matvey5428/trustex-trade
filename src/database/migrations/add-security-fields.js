/**
 * Migration: Add security fields to users table
 * Supports PIN code and biometric authentication
 */

const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes('neon.tech') 
    ? { rejectUnauthorized: false } 
    : false
});

async function migrate() {
  console.log('🚀 Running migration: add-security-fields');
  
  try {
    // Add security PIN (hashed)
    await pool.query(`
      ALTER TABLE users 
      ADD COLUMN IF NOT EXISTS security_pin VARCHAR(256) DEFAULT NULL
    `);
    console.log('✅ Added security_pin column');
    
    // Add biometric enabled flag
    await pool.query(`
      ALTER TABLE users 
      ADD COLUMN IF NOT EXISTS biometric_enabled BOOLEAN DEFAULT FALSE
    `);
    console.log('✅ Added biometric_enabled column');
    
    // Add biometric credential ID (from WebAuthn)
    await pool.query(`
      ALTER TABLE users 
      ADD COLUMN IF NOT EXISTS biometric_credential_id TEXT DEFAULT NULL
    `);
    console.log('✅ Added biometric_credential_id column');
    
    // Add biometric public key (from WebAuthn)
    await pool.query(`
      ALTER TABLE users 
      ADD COLUMN IF NOT EXISTS biometric_public_key TEXT DEFAULT NULL
    `);
    console.log('✅ Added biometric_public_key column');
    
    // Add last successful auth timestamp (to skip frequent checks)
    await pool.query(`
      ALTER TABLE users 
      ADD COLUMN IF NOT EXISTS last_security_auth TIMESTAMP DEFAULT NULL
    `);
    console.log('✅ Added last_security_auth column');
    
    // Add security enabled flag (master switch)
    await pool.query(`
      ALTER TABLE users 
      ADD COLUMN IF NOT EXISTS security_enabled BOOLEAN DEFAULT FALSE
    `);
    console.log('✅ Added security_enabled column');
    
    console.log('✅ Migration completed successfully!');
    
  } catch (error) {
    console.error('❌ Migration error:', error.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

migrate();
