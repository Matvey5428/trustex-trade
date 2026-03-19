/**
 * Migration: Add verification_data JSONB column to users table
 * Stores full_name, birth_date, address from verification form
 */
const pool = require('../../config/database');

async function up() {
  const client = await pool.connect();
  try {
    // Add verification_data column if not exists
    await client.query(`
      ALTER TABLE users ADD COLUMN IF NOT EXISTS verification_data JSONB DEFAULT NULL
    `);
    console.log('✅ Added verification_data column');
  } catch (error) {
    console.error('Migration error:', error.message);
  } finally {
    client.release();
  }
}

if (require.main === module) {
  up().then(() => process.exit(0));
}

module.exports = { up };
