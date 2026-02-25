/**
 * controllers/portfolioController.js
 * Контроллер для управления портфелем пользователя
 * Получение кошельков, балансов, общей статистики
 */

const dbManager = require('../models/dbManager');

/**
 * Получить все кошельки пользователя
 */
const getWallets = (req, res) => {
  try {
    const { userId } = req.params;
    const wallets = dbManager.getUserWallets(userId);

    res.json({
      success: true,
      data: wallets,
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      error: error.message,
    });
  }
};

/**
 * Получить полный профиль пользователя
 */
const getProfile = (req, res) => {
  try {
    const { userId } = req.params;
    const user = dbManager.getUserById(userId);

    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'Пользователь не найден',
      });
    }

    // Получаем статистику сделок
    const trades = dbManager.getUserTrades(userId);
    const successfulTrades = trades.filter(t => t.status === 'successful');
    const failedTrades = trades.filter(t => t.status === 'failed');

    const profile = {
      id: user.id,
      telegramId: user.telegramId,
      createdAt: user.createdAt,
      wallets: user.wallets,
      stats: {
        totalTrades: trades.length,
        successfulTrades: successfulTrades.length,
        failedTrades: failedTrades.length,
        totalTradeVolume: user.stats.totalTradeVolume,
      },
      verification: user.verification,
    };

    res.json({
      success: true,
      data: profile,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
};

/**
 * Получить статистику пользователя
 */
const getStatistics = (req, res) => {
  try {
    const { userId } = req.params;
    const user = dbManager.getUserById(userId);

    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'Пользователь не найден',
      });
    }

    const trades = dbManager.getUserTrades(userId);
    const successfulTrades = trades.filter(t => t.status === 'successful');
    const failedTrades = trades.filter(t => t.status === 'failed');

    const statistics = {
      accountId: user.telegramId,
      totalTrades: trades.length,
      successfulTrades: successfulTrades.length,
      failedTrades: failedTrades.length,
      totalTradeVolume: user.stats.totalTradeVolume,
      verification: user.verification.status === 'verified' ? 'Верифицирован' : 'Не верифицирован',
    };

    res.json({
      success: true,
      data: statistics,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
};

/**
 * Получить баланс в конкретной валюте
 */
const getBalance = (req, res) => {
  try {
    const { userId, currency } = req.params;
    const balance = dbManager.getBalance(userId, currency);

    res.json({
      success: true,
      data: {
        currency,
        balance,
      },
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      error: error.message,
    });
  }
};

module.exports = {
  getWallets,
  getProfile,
  getStatistics,
  getBalance,
};
