/**
 * controllers/profileController.js
 * Контроллер для обработки логики связанной с профилем пользователя
 * Содержит обработчики для получения и обновления профиля
 */

const dbManager = require('../models/dbManager');

/**
 * Получить профиль пользователя
 * @param {object} req - Express request объект
 * @param {object} res - Express response объект
 */
const getProfile = (req, res) => {
  try {
    const { userId } = req.params;
    const user = dbManager.getUserById(parseInt(userId));

    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'Пользователь не найден',
      });
    }

    res.json({
      success: true,
      data: user,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message || 'Ошибка при получении профиля',
    });
  }
};

/**
 * Получить статистику пользователя
 */
const getStatistics = (req, res) => {
  try {
    const { userId } = req.params;
    const user = dbManager.getUserById(parseInt(userId));

    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'Пользователь не найден',
      });
    }

    const trades = dbManager.getUserTrades(parseInt(userId));
    const successfulTrades = trades.filter(t => t.status === 'successful');
    const failedTrades = trades.filter(t => t.status === 'failed');

    const statistics = {
      accountId: user.telegramId,
      totalTrades: trades.length,
      successfulTrades: successfulTrades.length,
      failedTrades: failedTrades.length,
      totalTradeVolume: user.stats.totalTradeVolume,
      verificationStatus: user.verification.status,
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
 * Получить все кошельки пользователя
 */
const getWallets = (req, res) => {
  try {
    const { userId } = req.params;
    const wallets = dbManager.getUserWallets(parseInt(userId));

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
 * Получить баланс в конкретной валюте
 */
const getBalance = (req, res) => {
  try {
    const { userId, currency } = req.params;
    const balance = dbManager.getBalance(parseInt(userId), currency);

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
  getProfile,
  getStatistics,
  getWallets,
  getBalance,
};
