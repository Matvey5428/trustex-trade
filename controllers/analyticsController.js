/**
 * analyticsController.js
 * Контроллер для работы с аналитикой и статистикой
 */

const dbManager = require('../models/dbManager');

module.exports = {
  /**
   * Получает аналитику пользователя за указанный период
   * GET /api/analytics/:userId/:period
   * @param {object} req - Express request
   * @param {object} res - Express response
   */
  getAnalytics: (req, res) => {
    try {
      const { userId, period } = req.params;

      if (!userId) {
        return res.status(400).json({ error: 'userId обязателен' });
      }

      if (!['day', 'week', 'month', 'year'].includes(period)) {
        return res.status(400).json({ error: 'Период должен быть: day, week, month или year' });
      }

      const analytics = dbManager.getAnalyticsByPeriod(parseInt(userId), period);

      return res.status(200).json({
        success: true,
        data: analytics,
      });
    } catch (error) {
      return res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  },

  /**
   * Получает P&L (Profit & Loss) пользователя за период
   * GET /api/analytics/:userId/pnl/:period
   * @param {object} req - Express request
   * @param {object} res - Express response
   */
  getPnL: (req, res) => {
    try {
      const { userId, period } = req.params;

      if (!userId) {
        return res.status(400).json({ error: 'userId обязателен' });
      }

      if (!['day', 'week', 'month', 'year'].includes(period)) {
        return res.status(400).json({ error: 'Период должен быть: day, week, month или year' });
      }

      const pnl = dbManager.calculatePnL(parseInt(userId), period);

      return res.status(200).json({
        success: true,
        data: pnl,
      });
    } catch (error) {
      return res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  },

  /**
   * Получает данные для графика доходности
   * GET /api/analytics/:userId/chart
   * @param {object} req - Express request
   * @param {object} res - Express response
   */
  getChartData: (req, res) => {
    try {
      const { userId } = req.params;

      if (!userId) {
        return res.status(400).json({ error: 'userId обязателен' });
      }

      const chartData = dbManager.getChartData(parseInt(userId));

      return res.status(200).json({
        success: true,
        data: chartData,
      });
    } catch (error) {
      return res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  },

  /**
   * Получает статистику по типам сделок (wins/losses)
   * GET /api/analytics/:userId/stats
   * @param {object} req - Express request
   * @param {object} res - Express response
   */
  getTradeStats: (req, res) => {
    try {
      const { userId } = req.params;

      if (!userId) {
        return res.status(400).json({ error: 'userId обязателен' });
      }

      const stats = dbManager.getTradeTypeStats(parseInt(userId));

      return res.status(200).json({
        success: true,
        data: stats,
      });
    } catch (error) {
      return res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  },

  /**
   * Получает полную аналитику пользователя (все метрики одновременно)
   * GET /api/analytics/:userId/full
   * @param {object} req - Express request
   * @param {object} res - Express response
   */
  getFullAnalytics: (req, res) => {
    try {
      const { userId } = req.params;

      if (!userId) {
        return res.status(400).json({ error: 'userId обязателен' });
      }

      const userId_int = parseInt(userId);

      const dayAnalytics = dbManager.getAnalyticsByPeriod(userId_int, 'day');
      const weekAnalytics = dbManager.getAnalyticsByPeriod(userId_int, 'week');
      const monthAnalytics = dbManager.getAnalyticsByPeriod(userId_int, 'month');
      const yearAnalytics = dbManager.getAnalyticsByPeriod(userId_int, 'year');

      const dayPnL = dbManager.calculatePnL(userId_int, 'day');
      const weekPnL = dbManager.calculatePnL(userId_int, 'week');
      const monthPnL = dbManager.calculatePnL(userId_int, 'month');
      const yearPnL = dbManager.calculatePnL(userId_int, 'year');

      const tradeStats = dbManager.getTradeTypeStats(userId_int);

      return res.status(200).json({
        success: true,
        data: {
          analytics: {
            day: dayAnalytics,
            week: weekAnalytics,
            month: monthAnalytics,
            year: yearAnalytics,
          },
          pnl: {
            day: dayPnL,
            week: weekPnL,
            month: monthPnL,
            year: yearPnL,
          },
          tradeStats,
        },
      });
    } catch (error) {
      return res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  },
};
