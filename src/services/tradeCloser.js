/**
 * src/services/tradeCloser.js
 * Background service to automatically close expired trades
 */

const pool = require('../config/database');

let intervalId = null;
let isRunning = false;

/**
 * Close a single expired trade
 */
async function closeTrade(trade) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Lock trade and user rows to prevent race condition
    // Settlement must follow current user mode at close time
    const tradeCheck = await client.query(
      'SELECT o.*, u.balance_usdt, u.profit_multiplier, u.trade_mode as effective_trade_mode FROM orders o JOIN users u ON o.user_id = u.id WHERE o.id = $1 FOR UPDATE OF o, u',
      [trade.id]
    );
    
    if (tradeCheck.rows.length === 0) {
      await client.query('ROLLBACK');
      return;
    }

    const lockedTrade = tradeCheck.rows[0];
    
    // Already closed by another process?
    if (lockedTrade.status !== 'active') {
      await client.query('ROLLBACK');
      return;
    }

    const amount = parseFloat(lockedTrade.amount);
    const tradeMode = lockedTrade.effective_trade_mode || 'loss';
    const currentBalance = parseFloat(lockedTrade.balance_usdt) || 0;
    const profitMultiplier = parseFloat(lockedTrade.profit_multiplier) || 0.015;

    // Check for invalid amounts that would cause overflow
    const MAX_SAFE_AMOUNT = 1000000000; // 1 billion max
    if (amount > MAX_SAFE_AMOUNT || isNaN(amount)) {
      console.error(`⚠️ Invalid trade amount ${amount}, closing as loss without balance changes`);
      await client.query(
        'UPDATE orders SET status = $1, result = $2, profit = $3, closed_at = NOW() WHERE id = $4',
        ['closed', 'invalid', 0, trade.id]
      );
      await client.query('COMMIT');
      return;
    }

    // Calculate result based on mode
    let profit = 0;
    let result = 'loss';
    let finalBalance = currentBalance;

    if (tradeMode === 'win') {
      // WIN mode: profit based on user's multiplier + return stake
      profit = amount * profitMultiplier;
      result = 'win';
      const payout = amount + profit;

      // IMPORTANT: atomic increment prevents lost updates from concurrent writes
      const updateResult = await client.query(
        'UPDATE users SET balance_usdt = balance_usdt + $1, updated_at = NOW() WHERE id = $2 RETURNING balance_usdt',
        [payout, lockedTrade.user_id]
      );
      if (updateResult.rows.length > 0) {
        finalBalance = parseFloat(updateResult.rows[0].balance_usdt) || currentBalance;
      }
    } else {
      // LOSS mode: already lost (balance was deducted)
      profit = -amount;
      result = 'loss';
    }

    // Update trade status
    await client.query(
      'UPDATE orders SET status = $1, result = $2, profit = $3, closed_at = NOW() WHERE id = $4',
      ['closed', result, profit, trade.id]
    );

    // Create transaction record
    const txAmount = Math.max(Math.abs(profit), 0.01);
    await client.query(
      `INSERT INTO transactions (user_id, amount, currency, type, description, created_at)
       VALUES ($1, $2, 'USDT', 'trade', $3, NOW())`,
      [lockedTrade.user_id, txAmount, `Торговля: ${result === 'win' ? 'Прибыль +' : 'Убыток -'}${Math.abs(profit).toFixed(2)} USDT`]
    );

    await client.query('COMMIT');

  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    console.error(`❌ Error closing trade ${trade.id}:`, error.message);
  } finally {
    client.release();
  }
}

/**
 * Check and close all expired trades
 */
async function closeExpiredTrades() {
  if (isRunning) return;
  isRunning = true;
  try {
    // Find all active trades that have expired
    const result = await pool.query(`
      SELECT id, user_id, amount, direction, symbol 
      FROM orders 
      WHERE status = 'active' AND expires_at <= NOW()
    `);

    const expiredTrades = result.rows;
    
    if (expiredTrades.length > 0) {
      for (const trade of expiredTrades) {
        await closeTrade(trade);
      }
    }
  } catch (error) {
    console.error('❌ Trade closer error:', error.message);
  } finally {
    isRunning = false;
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
