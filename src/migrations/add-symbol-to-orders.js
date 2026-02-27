/**
 * Add symbol column to orders table
 */

require('dotenv').config();
const pool = require('../config/database');

async function migrate() {
  try {
    console.log('🔄 Adding symbol column to orders table...');
    console.log('DB:', process.env.DB_CONNECTION_STRING ? 'Found' : 'Not found');
    
    await pool.query(`
      ALTER TABLE orders ADD COLUMN IF NOT EXISTS symbol VARCHAR(20) DEFAULT 'BTC'
    `);
    
    console.log('✅ Migration complete: symbol column added');
    process.exit(0);
  } catch (error) {
    console.error('❌ Migration failed:', error.message, error.stack);
    process.exit(1);
  }
}

migrate();
