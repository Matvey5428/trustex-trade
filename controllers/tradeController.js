/**
 * controllers/tradeController.js
 * Контроллер для управления торговыми сделками
 * Создание сделок, обновление статуса, получение истории
 */

const dbManager = require('../models/dbManager');
const binanceClient = require('../utils/binance');

/**
 * Создать новую торговую сделку
 * Пользователь инициирует обмен валют
 */
const createTrade = async (req, res) => {
  try {
    const { userId, fromCurrency, toCurrency, fromAmount } = req.body;

    // Валидация
    if (!userId || !fromCurrency || !toCurrency || !fromAmount) {
      return res.status(400).json({
        success: false,
        error: 'Не все обязательные поля заполнены',
      });
    }

    if (fromAmount <= 0) {
      return res.status(400).json({
        success: false,
        error: 'Сумма должна быть больше 0',
      });
    }

    // Проверяем баланс
    const currentBalance = dbManager.getBalance(userId, fromCurrency);
    if (currentBalance < fromAmount) {
      return res.status(400).json({
        success: false,
        error: 'Недостаточно средств',
      });
    }

    // Получаем курс обмена у Binance
    let rate;
    try {
      rate = await binanceClient.getExchangeRate(fromCurrency, toCurrency);
    } catch (error) {
      return res.status(500).json({
        success: false,
        error: 'Не удалось получить курс обмена',
      });
    }

    const toAmount = parseFloat((fromAmount * rate).toFixed(8));

    // Создаем сделку
    const trade = dbManager.createTrade({
      userId,
      fromCurrency,
      toCurrency,
      fromAmount,
      toAmount,
      rate,
    });

    res.json({
      success: true,
      data: trade,
      message: 'Сделка создана, ожидает подтверждения администратора',
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
};

/**
 * Получить историю сделок пользователя
 */
const getTrades = (req, res) => {
  try {
    const { userId } = req.params;
    const trades = dbManager.getUserTrades(parseInt(userId));

    res.json({
      success: true,
      data: trades,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
};

/**
 * Получить статистику по сделкам за период
 * periodo: day, week, month, year
 */
const getTradeStatsByPeriod = (req, res) => {
  try {
    const { userId, period } = req.params;
    const trades = dbManager.getUserTrades(parseInt(userId));

    const now = new Date();
    let startDate = new Date();

    // Устанавливаем начальную дату в зависимости от периода
    switch (period.toLowerCase()) {
      case 'day':
        startDate.setHours(0, 0, 0, 0);
        break;
      case 'week':
        startDate.setDate(now.getDate() - now.getDay());
        startDate.setHours(0, 0, 0, 0);
        break;
      case 'month':
        startDate = new Date(now.getFullYear(), now.getMonth(), 1);
        break;
      case 'year':
        startDate = new Date(now.getFullYear(), 0, 1);
        break;
      default:
        return res.status(400).json({
          success: false,
          error: 'Неверный период. Используйте: day, week, month, year',
        });
    }

    // Фильтруем сделки за период
    const filteredTrades = trades.filter(
      trade => new Date(trade.createdAt) >= startDate
    );

    const successful = filteredTrades.filter(t => t.status === 'successful');
    const failed = filteredTrades.filter(t => t.status === 'failed');

    const stats = {
      period,
      totalTrades: filteredTrades.length,
      successfulTrades: successful.length,
      failedTrades: failed.length,
      successRate: filteredTrades.length > 0
        ? ((successful.length / filteredTrades.length) * 100).toFixed(2)
        : 0,
      totalVolume: filteredTrades.reduce((sum, t) => sum + t.fromAmount, 0),
    };

    res.json({
      success: true,
      data: stats,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
};

/**
 * Подтвердить сделку (для админ панели)
 * outcome: 'successful' или 'failed'
 */
const confirmTrade = (req, res) => {
  try {
    const { tradeId, outcome } = req.body;

    if (!tradeId || !['successful', 'failed'].includes(outcome)) {
      return res.status(400).json({
        success: false,
        error: 'Неверные параметры',
      });
    }

    // Получаем сделку
    const db = dbManager.readDB();
    const trade = db.trades.find(t => t.id === tradeId && t.status === 'pending');

    if (!trade) {
      return res.status(404).json({
        success: false,
        error: 'Сделка не найдена или уже закрыта',
      });
    }

    // При успешной сделке - переводим средства
    if (outcome === 'successful') {
      try {
        dbManager.changeBalance(trade.userId, trade.fromCurrency, -trade.fromAmount);
        dbManager.changeBalance(trade.userId, trade.toCurrency, trade.toAmount);

        // Обновляем статистику пользователя
        const user = dbManager.getUserById(trade.userId);
        user.stats.successfulTrades += 1;
        user.stats.totalTrades += 1;
        user.stats.totalTradeVolume += trade.fromAmount;
      } catch (error) {
        return res.status(500).json({
          success: false,
          error: 'Ошибка при переводе средств: ' + error.message,
        });
      }
    } else {
      // Неуспешная сделка - только обновляем статистику
      const user = dbManager.getUserById(trade.userId);
      user.stats.failedTrades += 1;
      user.stats.totalTrades += 1;
    }

    // Обновляем статус сделки
    const updatedTrade = dbManager.updateTradeStatus(tradeId, outcome);

    res.json({
      success: true,
      data: updatedTrade,
      message: `Сделка завершена с статусом: ${outcome}`,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
};

module.exports = {
  createTrade,
  getTrades,
  getTradeStatsByPeriod,
  confirmTrade,
};
