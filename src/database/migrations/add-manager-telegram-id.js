/**
 * Migration: Add manager_telegram_id field to users table
 * Links users to their assigned manager
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
  console.log('🚀 Running migration: add-manager-telegram-id');
  
  try {
    // Add manager_telegram_id column (links user to their manager)
    await pool.query(`
      ALTER TABLE users 
      ADD COLUMN IF NOT EXISTS manager_telegram_id BIGINT DEFAULT NULL
    `);
    
    console.log('✅ Added manager_telegram_id column to users table');
    
    // Create index for faster lookups
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_users_manager_telegram_id ON users(manager_telegram_id)
    `);
    
    console.log('✅ Created index on manager_telegram_id');
    
  } catch (error) {
    console.error('❌ Migration error:', error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

migrate();
