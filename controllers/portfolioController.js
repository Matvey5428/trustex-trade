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

/**
 * Обмен валюты RUB ↔ USDT
 */
const exchangeCurrency = (req, res) => {
  try {
    const { user_id, amount, side } = req.body;
    
    if (!user_id || !amount || !side) {
      return res.status(400).json({
        success: false,
        error: 'Не указаны обязательные параметры',
      });
    }

    const user = dbManager.getUserById(user_id);
    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'Пользователь не найден',
      });
    }

    const EXCHANGE_RATE = 95; // 1 USD = 95 RUB
    
    if (side === 'rub_to_usdt') {
      // Обмен RUB → USDT
      const rubAmount = parseFloat(amount);
      const currentRub = parseFloat(user.wallets.RUB.balance);
      
      if (rubAmount > currentRub) {
        return res.status(400).json({
          success: false,
          error: 'Недостаточно средств RUB',
        });
      }
      
      const usdtAmount = rubAmount / EXCHANGE_RATE;
      dbManager.updateBalance(user_id, 'RUB', -rubAmount);
      dbManager.updateBalance(user_id, 'USDT', usdtAmount);
      
      return res.json({
        success: true,
        message: `Обменяно ${rubAmount.toFixed(2)} RUB на ${usdtAmount.toFixed(2)} USDT`,
        data: {
          rub: currentRub - rubAmount,
          usdt: parseFloat(user.wallets.USDT.balance) + usdtAmount,
        },
      });
      
    } else if (side === 'usdt_to_rub') {
      // Обмен USDT → RUB
      const usdtAmount = parseFloat(amount);
      const currentUsdt = parseFloat(user.wallets.USDT.balance);
      
      if (usdtAmount > currentUsdt) {
        return res.status(400).json({
          success: false,
          error: 'Недостаточно средств USDT',
        });
      }
      
      const rubAmount = usdtAmount * EXCHANGE_RATE;
      dbManager.updateBalance(user_id, 'USDT', -usdtAmount);
      dbManager.updateBalance(user_id, 'RUB', rubAmount);
      
      return res.json({
        success: true,
        message: `Обменяно ${usdtAmount.toFixed(2)} USDT на ${rubAmount.toFixed(2)} RUB`,
        data: {
          rub: parseFloat(user.wallets.RUB.balance) + rubAmount,
          usdt: currentUsdt - usdtAmount,
        },
      });
      
    } else {
      return res.status(400).json({
        success: false,
        error: 'Неверный тип обмена',
      });
    }
    
  } catch (error) {
    res.status(500).json({
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
  exchangeCurrency,
};
