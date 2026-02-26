/**
 * index.js - Entry point
 */

require('dotenv').config();
const app = require('./src/app');
const pool = require('./src/config/database');

const PORT = process.env.PORT || 3000;
const NODE_ENV = process.env.NODE_ENV || 'development';

// Test database connection (don't block server startup)
pool.query('SELECT NOW()', (err, res) => {
  if (err) {
    console.error('⚠️ Database connection error:', err.message);
    console.error('💡 Make sure DATABASE_URL or DB_CONNECTION_STRING is set in environment variables');
  } else {
    console.log('✅ Database connected at', res.rows[0].now);
  }
});

// Start server (regardless of DB status)
app.listen(PORT, () => {
  console.log(`\n🚀 Server running on port ${PORT} (${NODE_ENV})\n`);
  console.log(`📍 Local: http://localhost:${PORT}`);
  console.log(`🏥 Health: http://localhost:${PORT}/health\n`);
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n⏹️ Shutting down...');
  pool.end(() => {
    console.log('✅ Database pool closed');
    process.exit(0);
  });
});