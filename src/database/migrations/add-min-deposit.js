/**
 * Migration: Add min_deposit field to users table
 * Allows admins/managers to set minimum deposit amount per user
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
  console.log('🚀 Running migration: add-min-deposit');
  
  try {
    // Add min_deposit column (default 0 = no minimum)
    await pool.query(`
      ALTER TABLE users 
      ADD COLUMN IF NOT EXISTS min_deposit NUMERIC(18,2) DEFAULT 0
    `);
    
    console.log('✅ Added min_deposit column to users table');
    
  } catch (error) {
    console.error('❌ Migration error:', error.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

migrate();
