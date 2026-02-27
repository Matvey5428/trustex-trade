/**
 * src/routes/trades.js
 * Trading functionality with win/loss mode and timer
 */

const express = require('express');
const router = express.Router();
const pool = require('../config/database');

/**
 * Parse duration string to seconds
 */
function parseDuration(duration) {
  if (!duration) return 30;
  const str = String(duration).toLowerCase();
  if (str.includes('s')) return parseInt(str) || 30;
  if (str.includes('m')) return (parseInt(str) || 1) * 60;
  return parseInt(duration) || 30;
}

/**
 * POST /api/trades/create
 * Create a new trade (deduct balance, return trade ID for timer)
 */
router.post('/create', async (req, res) => {
  try {
    const { userId, fromCurrency, toCurrency, fromAmount, direction, duration, symbol } = req.body;

    // Validate input
    if (!userId) {
      return res.status(400).json({ error: 'userId is required' });
    }
    const amount = parseFloat(fromAmount);
    if (!amount || amount <= 0) {
      return res.status(400).json({ error: 'Invalid amount' });
    }

    // Symbol can come as 'symbol' or 'toCurrency'
    const tradeSymbol = symbol || toCurrency || 'BTC';
    const durationSeconds = parseDuration(duration);

    // Get user by telegram_id
    const userResult = await pool.query(
      'SELECT * FROM users WHERE telegram_id = $1',
      [userId.toString()]
    );

    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const user = userResult.rows[0];
    const currentBalance = parseFloat(user.balance_usdt) || 0;

    // Check balance
    if (amount > currentBalance) {
      return res.status(400).json({ 
        error: 'Insufficient balance',
        available: currentBalance,
        requested: amount
      });
    }

    // Start transaction
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Deduct balance immediately (stake is locked)
      const newBalance = currentBalance - amount;
      await client.query(
        'UPDATE users SET balance_usdt = $1, updated_at = NOW() WHERE telegram_id = $2',
        [newBalance, userId.toString()]
      );

      // Create trade record with status "active"
      const tradeResult = await client.query(
        `INSERT INTO orders (user_id, amount, direction, duration, status, symbol, created_at, expires_at)
         VALUES ($1, $2, $3, $4, 'active', $5, NOW(), NOW() + INTERVAL '${durationSeconds} seconds')
         RETURNING *`,
        [user.id, amount, direction || 'up', durationSeconds, tradeSymbol]
      );

      await client.query('COMMIT');

      const trade = tradeResult.rows[0];

      res.json({
        success: true,
        message: 'Сделка открыта',
        data: {
          id: trade.id,
          amount,
          direction: direction || 'up',
          duration: durationSeconds,
          expiresAt: trade.expires_at,
          status: 'active',
          newBalance
        }
      });

    } catch (txError) {
      await client.query('ROLLBACK');
      throw txError;
    } finally {
      client.release();
    }

  } catch (error) {
    console.error('❌ Trade create error:', error.message);
    res.status(500).json({ error: 'Server error: ' + error.message });
  }
});

/**
 * POST /api/trades/close/:tradeId
 * Close a trade and calculate result
 */
router.post('/close/:tradeId', async (req, res) => {
  try {
    const { tradeId } = req.params;

    // Get trade
    const tradeResult = await pool.query(
      'SELECT o.*, u.telegram_id, u.trade_mode, u.balance_usdt FROM orders o JOIN users u ON o.user_id = u.id WHERE o.id = $1',
      [tradeId]
    );

    if (tradeResult.rows.length === 0) {
      return res.status(404).json({ error: 'Trade not found' });
    }

    const trade = tradeResult.rows[0];

    // Already closed?
    if (trade.status !== 'active') {
      return res.json({
        success: true,
        message: 'Сделка уже закрыта',
        data: {
          id: trade.id,
          status: trade.status,
          result: trade.result
        }
      });
    }

    const amount = parseFloat(trade.amount);
    const tradeMode = trade.trade_mode || 'loss';
    const currentBalance = parseFloat(trade.balance_usdt) || 0;

    // Calculate result based on mode
    let profit = 0;
    let result = 'loss';
    let finalBalance = currentBalance;

    if (tradeMode === 'win') {
      // WIN mode: +1.5% profit + return stake
      profit = amount * 0.015;
      finalBalance = currentBalance + amount + profit;
      result = 'win';
    } else {
      // LOSS mode: already lost (balance was deducted)
      profit = -amount;
      result = 'loss';
    }

    // Start transaction
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Update trade status
      await client.query(
        'UPDATE orders SET status = $1, result = $2, closed_at = NOW() WHERE id = $3',
        ['closed', result, tradeId]
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

      res.json({
        success: true,
        message: result === 'win' 
          ? `Сделка выиграна! +${profit.toFixed(2)} USDT` 
          : `Сделка проиграна. -${amount.toFixed(2)} USDT`,
        data: {
          id: trade.id,
          result,
          amount,
          profit,
          newBalance: finalBalance
        }
      });

    } catch (txError) {
      await client.query('ROLLBACK');
      throw txError;
    } finally {
      client.release();
    }

  } catch (error) {
    console.error('❌ Trade close error:', error.message);
    res.status(500).json({ error: 'Server error: ' + error.message });
  }
});

/**
 * GET /api/trades/history/:userId
 * Get user's trade history
 */
router.get('/history/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const limit = parseInt(req.query.limit) || 20;
    const symbol = req.query.symbol; // Optional filter by symbol

    // Get user by telegram_id
    const userResult = await pool.query(
      'SELECT id FROM users WHERE telegram_id = $1',
      [userId.toString()]
    );

    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Build query with optional symbol filter
    let query = `SELECT id, direction, amount, result, status, duration, symbol, created_at as "createdAt", expires_at as "expiresAt"
       FROM orders 
       WHERE user_id = $1`;
    const params = [userResult.rows[0].id];
    
    if (symbol) {
      query += ' AND symbol = $2';
      params.push(symbol);
      query += ' ORDER BY created_at DESC LIMIT $3';
      params.push(limit);
    } else {
      query += ' ORDER BY created_at DESC LIMIT $2';
      params.push(limit);
    }

    const result = await pool.query(query, params);

    // Transform for frontend
    const trades = result.rows.map(row => ({
      id: row.id,
      fromCurrency: 'USDT',
      toCurrency: row.direction === 'up' ? '↑' : '↓',
      direction: row.direction,
      fromAmount: row.amount,
      status: row.result === 'win' ? 'successful' : row.result === 'loss' ? 'failed' : row.status,
      createdAt: row.createdAt,
      expiresAt: row.expiresAt,
      duration: row.duration
    }));

    res.json({
      success: true,
      data: trades
    });

  } catch (error) {
    console.error('❌ Trades history error:', error.message);
    res.status(500).json({ error: 'Server error' });
  }
});

/**
 * POST /api/trades/set-mode
 * Set user's trade mode (admin only in future)
 */
router.post('/set-mode', async (req, res) => {
  try {
    const { userId, mode } = req.body;

    if (!userId) {
      return res.status(400).json({ error: 'userId is required' });
    }
    if (!mode || !['win', 'loss'].includes(mode)) {
      return res.status(400).json({ error: 'Invalid mode. Use "win" or "loss"' });
    }

    const result = await pool.query(
      'UPDATE users SET trade_mode = $1, updated_at = NOW() WHERE telegram_id = $2 RETURNING trade_mode',
      [mode, userId.toString()]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({
      success: true,
      message: `Trade mode set to: ${mode}`,
      data: { mode: result.rows[0].trade_mode }
    });

  } catch (error) {
    console.error('❌ Set mode error:', error.message);
    res.status(500).json({ error: 'Server error' });
  }
});

/**
 * GET /api/trades/mode/:userId
 * Get user's current trade mode
 */
router.get('/mode/:userId', async (req, res) => {
  try {
    const { userId } = req.params;

    const result = await pool.query(
      'SELECT trade_mode FROM users WHERE telegram_id = $1',
      [userId.toString()]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({
      success: true,
      data: { mode: result.rows[0].trade_mode || 'loss' }
    });

  } catch (error) {
    console.error('❌ Get mode error:', error.message);
    res.status(500).json({ error: 'Server error' });
  }
});

/**
 * GET /api/trades/stats/:userId
 * Get user's trade statistics (total, wins, losses)
 */
router.get('/stats/:userId', async (req, res) => {
  try {
    const { userId } = req.params;

    // Get user by telegram_id
    const userResult = await pool.query(
      'SELECT id FROM users WHERE telegram_id = $1',
      [userId.toString()]
    );

    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const internalUserId = userResult.rows[0].id;

    // Get counts for completed trades
    const statsResult = await pool.query(
      `SELECT 
        COUNT(*) FILTER (WHERE status = 'closed') as total,
        COUNT(*) FILTER (WHERE result = 'win') as wins,
        COUNT(*) FILTER (WHERE result = 'loss') as losses
       FROM orders 
       WHERE user_id = $1`,
      [internalUserId]
    );

    const stats = statsResult.rows[0];

    res.json({
      success: true,
      data: {
        total: parseInt(stats.total) || 0,
        wins: parseInt(stats.wins) || 0,
        losses: parseInt(stats.losses) || 0
      }
    });

  } catch (error) {
    console.error('❌ Get stats error:', error.message);
    res.status(500).json({ error: 'Server error' });
  }
});

/**
 * GET /api/trades/analytics/:userId
 * Get detailed trade analytics by period
 * Query params: period = all | year | month | week | day
 */
router.get('/analytics/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const period = req.query.period || 'all';

    // Get user by telegram_id
    const userResult = await pool.query(
      'SELECT id FROM users WHERE telegram_id = $1',
      [userId.toString()]
    );

    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const internalUserId = userResult.rows[0].id;

    // Build date filter
    let dateFilter = '';
    if (period === 'day') {
      dateFilter = "AND created_at >= NOW() - INTERVAL '1 day'";
    } else if (period === 'week') {
      dateFilter = "AND created_at >= NOW() - INTERVAL '7 days'";
    } else if (period === 'month') {
      dateFilter = "AND created_at >= NOW() - INTERVAL '30 days'";
    } else if (period === 'year') {
      dateFilter = "AND created_at >= NOW() - INTERVAL '365 days'";
    }
    // 'all' - no date filter

    // Get analytics
    const analyticsResult = await pool.query(
      `SELECT 
        COUNT(*) FILTER (WHERE status = 'closed') as total_trades,
        COUNT(*) FILTER (WHERE result = 'win') as wins,
        COUNT(*) FILTER (WHERE result = 'loss') as losses,
        COALESCE(SUM(CASE WHEN result = 'win' THEN amount * 0.015 ELSE 0 END), 0) as total_profit,
        COALESCE(SUM(CASE WHEN result = 'loss' THEN amount ELSE 0 END), 0) as total_loss,
        COALESCE(AVG(CASE WHEN result = 'win' THEN amount * 0.015 END), 0) as avg_profit,
        COALESCE(AVG(CASE WHEN result = 'loss' THEN amount END), 0) as avg_loss,
        COALESCE(MAX(CASE WHEN result = 'win' THEN amount * 0.015 END), 0) as max_win,
        COALESCE(MAX(CASE WHEN result = 'loss' THEN amount END), 0) as max_loss
       FROM orders 
       WHERE user_id = $1 ${dateFilter}`,
      [internalUserId]
    );

    const a = analyticsResult.rows[0];
    const totalTrades = parseInt(a.total_trades) || 0;
    const wins = parseInt(a.wins) || 0;
    const losses = parseInt(a.losses) || 0;
    const winRate = totalTrades > 0 ? (wins / totalTrades * 100) : 0;
    const totalProfit = parseFloat(a.total_profit) || 0;
    const totalLoss = parseFloat(a.total_loss) || 0;
    const avgProfit = parseFloat(a.avg_profit) || 0;
    const avgLoss = parseFloat(a.avg_loss) || 0;
    const maxWin = parseFloat(a.max_win) || 0;
    const maxLoss = parseFloat(a.max_loss) || 0;
    const profitFactor = totalLoss > 0 ? totalProfit / totalLoss : totalProfit;

    res.json({
      success: true,
      data: {
        period,
        totalTrades,
        wins,
        losses,
        winRate: winRate.toFixed(2),
        totalProfit: totalProfit.toFixed(2),
        totalLoss: totalLoss.toFixed(2),
        avgProfit: avgProfit.toFixed(2),
        avgLoss: avgLoss.toFixed(2),
        maxWin: maxWin.toFixed(2),
        maxLoss: maxLoss.toFixed(2),
        profitFactor: profitFactor.toFixed(2)
      }
    });

  } catch (error) {
    console.error('❌ Get analytics error:', error.message);
    res.status(500).json({ error: 'Server error' });
  }
});

/**
 * GET /api/trades/pnl-history/:userId
 * Get daily P&L history for chart (last 30 days)
 */
router.get('/pnl-history/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const days = parseInt(req.query.days) || 30;

    // Get user by telegram_id
    const userResult = await pool.query(
      'SELECT id FROM users WHERE telegram_id = $1',
      [userId.toString()]
    );

    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const internalUserId = userResult.rows[0].id;

    // Get daily P&L for last N days
    const pnlResult = await pool.query(
      `SELECT 
        DATE(created_at) as date,
        COALESCE(SUM(CASE WHEN result = 'win' THEN amount * 0.015 ELSE 0 END), 0) as profit,
        COALESCE(SUM(CASE WHEN result = 'loss' THEN amount ELSE 0 END), 0) as loss
       FROM orders 
       WHERE user_id = $1 
         AND status = 'closed'
         AND created_at >= NOW() - INTERVAL '${days} days'
       GROUP BY DATE(created_at)
       ORDER BY DATE(created_at) ASC`,
      [internalUserId]
    );

    // Build cumulative P&L data
    let cumulative = 0;
    const history = pnlResult.rows.map(row => {
      const dailyPnl = parseFloat(row.profit) - parseFloat(row.loss);
      cumulative += dailyPnl;
      return {
        date: row.date,
        dailyPnl: dailyPnl.toFixed(2),
        cumulative: cumulative.toFixed(2)
      };
    });

    res.json({
      success: true,
      data: {
        history,
        totalPnl: cumulative.toFixed(2)
      }
    });

  } catch (error) {
    console.error('❌ Get P&L history error:', error.message);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
