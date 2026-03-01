/**
 * src/services/tradeCloser.js
 * Background service to automatically close expired trades
 */

const pool = require('../config/database');

let intervalId = null;

/**
 * Close a single expired trade
 */
async function closeTrade(trade) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Get fresh user data
    const userResult = await client.query(
      'SELECT trade_mode, balance_usdt, profit_multiplier FROM users WHERE id = $1',
      [trade.user_id]
    );
    
    if (userResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return;
    }

    const user = userResult.rows[0];
    const amount = parseFloat(trade.amount);
    const tradeMode = user.trade_mode || 'loss';
    const currentBalance = parseFloat(user.balance_usdt) || 0;
    const profitMultiplier = parseFloat(user.profit_multiplier) || 0.015;

    // Calculate result based on mode
    let profit = 0;
    let result = 'loss';
    let finalBalance = currentBalance;

    if (tradeMode === 'win') {
      // WIN mode: profit based on user's multiplier + return stake
      profit = amount * profitMultiplier;
      finalBalance = currentBalance + amount + profit;
      result = 'win';
    } else {
      // LOSS mode: already lost (balance was deducted)
      profit = -amount;
      result = 'loss';
    }

    // Update trade status
    await client.query(
      'UPDATE orders SET status = $1, result = $2, closed_at = NOW() WHERE id = $3',
      ['closed', result, trade.id]
    );

    // If win - add money back
    if (result === 'win') {
      await client.query(
        'UPDATE users SET balance_usdt = $1, updated_at = NOW() WHERE id = $2',
        [finalBalance, trade.user_id]
      );
    }

    // Create transaction record
    const txAmount = Math.max(Math.abs(profit), 0.01);
    await client.query(
      `INSERT INTO transactions (user_id, amount, currency, type, description, created_at)
       VALUES ($1, $2, 'USDT', 'trade', $3, NOW())`,
      [trade.user_id, txAmount, `Торговля: ${result === 'win' ? 'Выигрыш +' : 'Проигрыш -'}${Math.abs(profit).toFixed(2)} USDT`]
    );

    await client.query('COMMIT');
    console.log(`✅ Auto-closed trade ${trade.id}: ${result} (${profit.toFixed(2)} USDT)`);

  } catch (error) {
    await client.query('ROLLBACK');
    console.error(`❌ Error closing trade ${trade.id}:`, error.message);
  } finally {
    client.release();
  }
}

/**
 * Check and close all expired trades
 */
async function closeExpiredTrades() {
  try {
    // Find all active trades that have expired
    const result = await pool.query(`
      SELECT id, user_id, amount, direction, symbol 
      FROM orders 
      WHERE status = 'active' AND expires_at <= NOW()
    `);

    const expiredTrades = result.rows;
    
    if (expiredTrades.length > 0) {
      console.log(`🔄 Found ${expiredTrades.length} expired trades to close`);
      
      for (const trade of expiredTrades) {
        await closeTrade(trade);
      }
    }
  } catch (error) {
    console.error('❌ Trade closer error:', error.message);
  }
}

/**
 * Start the background trade closer service
 */
function startTradeCloser(intervalMs = 5000) {
  if (intervalId) {
    console.log('⚠️ Trade closer already running');
    return;
  }
  
  console.log(`🔄 Starting trade closer service (interval: ${intervalMs}ms)`);
  
  // Run immediately on start
  closeExpiredTrades();
  
  // Then run periodically
  intervalId = setInterval(closeExpiredTrades, intervalMs);
}

/**
 * Stop the background trade closer service
 */
function stopTradeCloser() {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
    console.log('⏹️ Trade closer service stopped');
  }
}

module.exports = {
  startTradeCloser,
  stopTradeCloser,
  closeExpiredTrades
};
