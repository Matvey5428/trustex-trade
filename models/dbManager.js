/**
 * models/dbManager.js
 * Менеджер для работы с базой данных (JSON файл)
 * Предоставляет методы для чтения и записи данных
 */

const fs = require('fs');
const path = require('path');
const { PATHS } = require('../utils/paths');

class DatabaseManager {
  constructor(dbPath = PATHS.DATABASE) {
    this.dbPath = dbPath;
    this.initializeDB();
  }

  /**
   * Инициализирует базу данных если её нет
   */
  initializeDB() {
    if (!fs.existsSync(this.dbPath)) {
      const defaultData = {
        users: [],
        trades: [],
        transactions: [],
        verifications: [],
      };
      this.writeDB(defaultData);
    }
  }

  /**
   * Читает всю базу данных
   * @returns {object} Данные из базы
   */
  readDB() {
    try {
      const data = fs.readFileSync(this.dbPath, 'utf8');
      return JSON.parse(data);
    } catch (error) {
      console.error('❌ Ошибка чтения БД:', error.message);
      throw new Error('Не удалось прочитать базу данных');
    }
  }

  /**
   * Записывает данные в базу
   * @param {object} data - Данные для записи
   */
  writeDB(data) {
    try {
      fs.writeFileSync(
        this.dbPath,
        JSON.stringify(data, null, 2),
        'utf8'
      );
    } catch (error) {
      console.error('❌ Ошибка записи в БД:', error.message);
      throw new Error('Не удалось записать в базу данных');
    }
  }

  // ===== ПОЛЬЗОВАТЕЛИ =====

  /**
   * Получает или создает пользователя по Telegram ID
   * @param {number} telegramId - ID пользователя в Telegram
   * @returns {object} Данные пользователя
   */
  getOrCreateUser(telegramId) {
    const db = this.readDB();
    let user = db.users.find(u => u.telegramId === telegramId);

    if (!user) {
      user = {
        id: Date.now(),
        telegramId,
        createdAt: new Date().toISOString(),
        wallets: {
          USDT: { balance: 0, currency: 'USDT' },
          RUB: { balance: 0, currency: 'RUB' },
          BTC: { balance: 0, currency: 'BTC' },
          ETH: { balance: 0, currency: 'ETH' },
          TON: { balance: 0, currency: 'TON' },
        },
        stats: {
          totalTrades: 0,
          successfulTrades: 0,
          failedTrades: 0,
          totalTradeVolume: 0,
        },
        verification: {
          status: 'pending', // pending, submitted, verified, rejected
          submittedAt: null,
        },
      };
      db.users.push(user);
      this.writeDB(db);
    }

    return user;
  }

  /**
   * Получает пользователя по ID
   * @param {number} userId - ID пользователя
   * @returns {object|null} Данные пользователя или null
   */
  getUserById(userId) {
    const db = this.readDB();
    return db.users.find(user => user.id === userId) || null;
  }

  /**
   * Получает пользователя по Telegram ID
   * @param {number} telegramId - Telegram ID
   * @returns {object|null} Данные пользователя или null
   */
  getUserByTelegramId(telegramId) {
    const db = this.readDB();
    return db.users.find(user => user.telegramId === telegramId) || null;
  }

  /**
   * Обновляет данные пользователя
   * @param {number} userId - ID пользователя
   * @param {object} updates - Объект с обновлениями
   * @returns {object} Обновленные данные пользователя
   */
  updateUser(userId, updates) {
    const db = this.readDB();
    const userIndex = db.users.findIndex(user => user.id === userId);

    if (userIndex === -1) {
      throw new Error('Пользователь не найден');
    }

    db.users[userIndex] = {
      ...db.users[userIndex],
      ...updates,
      updatedAt: new Date().toISOString(),
    };

    this.writeDB(db);
    return db.users[userIndex];
  }

  // ===== КОШЕЛЬКИ =====

  /**
   * Получает баланс в конкретной валюте
   * @param {number} userId - ID пользователя
   * @param {string} currency - Наименование валюты (USDT, RUB)
   * @returns {number} Баланс
   */
  getBalance(userId, currency) {
    const user = this.getUserById(userId);
    if (!user) throw new Error('Пользователь не найден');
    return user.wallets[currency]?.balance || 0;
  }

  /**
   * Изменяет баланс пользователя
   * @param {number} userId - ID пользователя
   * @param {string} currency - Валюта
   * @param {number} amount - Сумма (положительная или отрицательная)
   * @returns {number} Новый баланс
   */
  changeBalance(userId, currency, amount) {
    const db = this.readDB();
    const user = db.users.find(u => u.id === userId);

    if (!user) throw new Error('Пользователь не найден');
    if (!user.wallets[currency]) {
      user.wallets[currency] = { balance: 0, currency };
    }

    const newBalance = user.wallets[currency].balance + amount;

    if (newBalance < 0) {
      throw new Error(`Недостаточно средств. Баланс: ${user.wallets[currency].balance}`);
    }

    user.wallets[currency].balance = parseFloat(newBalance.toFixed(2));
    this.writeDB(db);

    return user.wallets[currency].balance;
  }

  /**
   * Алиас для changeBalance (для совместимости)
   */
  updateBalance(userId, currency, amount) {
    return this.changeBalance(userId, currency, amount);
  }

  /**
   * Получает все кошельки пользователя
   * @param {number} userId - ID пользователя
   * @returns {object} Кошельки
   */
  getUserWallets(userId) {
    const user = this.getUserById(userId);
    if (!user) throw new Error('Пользователь не найден');
    return user.wallets;
  }

  // ===== СДЕЛКИ =====

  /**
   * Создает новую торговую сделку
   * @param {object} tradeData - Данные сделки
   * @returns {object} Созданная сделка
   */
  createTrade(tradeData) {
    const db = this.readDB();
    const trade = {
      id: Date.now(),
      userId: tradeData.userId,
      fromCurrency: tradeData.fromCurrency,
      toCurrency: tradeData.toCurrency,
      fromAmount: tradeData.fromAmount,
      toAmount: tradeData.toAmount,
      rate: tradeData.rate,
      status: 'pending', // pending, successful, failed
      createdAt: new Date().toISOString(),
      closedAt: null,
    };

    db.trades.push(trade);
    this.writeDB(db);
    return trade;
  }

  /**
   * Получает все сделки пользователя
   * @param {number} userId - ID пользователя
   * @returns {array} Массив сделок
   */
  getUserTrades(userId) {
    const db = this.readDB();
    return db.trades.filter(trade => trade.userId === userId);
  }

  /**
   * Обновляет статус сделки
   * @param {number} tradeId - ID сделки
   * @param {string} status - Новый статус (successful, failed)
   * @returns {object} Обновленная сделка
   */
  updateTradeStatus(tradeId, status) {
    const db = this.readDB();
    const trade = db.trades.find(t => t.id === tradeId);

    if (!trade) throw new Error('Сделка не найдена');

    trade.status = status;
    trade.closedAt = new Date().toISOString();

    this.writeDB(db);
    return trade;
  }

  // ===== ТРАНЗАКЦИИ =====

  /**
   * Создает новую транзакцию (пополнение/вывод)
   * @param {object} txData - Данные транзакции
   * @returns {object} Созданная транзакция
   */
  createTransaction(txData) {
    const db = this.readDB();
    const transaction = {
      id: Date.now(),
      userId: txData.userId,
      type: txData.type, // 'deposit' или 'withdrawal'
      currency: txData.currency,
      amount: txData.amount,
      status: txData.status || 'pending', // pending, completed, rejected
      createdAt: new Date().toISOString(),
      completedAt: null,
    };

    db.transactions.push(transaction);
    this.writeDB(db);
    return transaction;
  }

  /**
   * Получает все транзакции пользователя
   * @param {number} userId - ID пользователя
   * @param {string} type - Тип (null = все, 'deposit', 'withdrawal')
   * @returns {array} Массив транзакций
   */
  getUserTransactions(userId, type = null) {
    const db = this.readDB();
    let transactions = db.transactions.filter(tx => tx.userId === userId);

    if (type) {
      transactions = transactions.filter(tx => tx.type === type);
    }

    return transactions.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  }

  /**
   * Обновляет статус транзакции
   * @param {number} txId - ID транзакции
   * @param {string} status - Новый статус
   * @returns {object} Обновленная транзакция
   */
  updateTransactionStatus(txId, status) {
    const db = this.readDB();
    const tx = db.transactions.find(t => t.id === txId);

    if (!tx) throw new Error('Транзакция не найдена');

    tx.status = status;
    if (status === 'completed') {
      tx.completedAt = new Date().toISOString();
    }

    this.writeDB(db);
    return tx;
  }

  // ===== ВЕРИФИКАЦИЯ =====

  /**
   * Создает заявку на верификацию
   * @param {number} userId - ID пользователя
   * @returns {object} Заявка о верификации
   */
  submitVerification(userId) {
    const db = this.readDB();
    const user = db.users.find(u => u.id === userId);

    if (!user) throw new Error('Пользователь не найден');

    user.verification.status = 'submitted';
    user.verification.submittedAt = new Date().toISOString();

    const verification = {
      id: Date.now(),
      userId,
      status: 'pending',
      submittedAt: new Date().toISOString(),
      reviewedAt: null,
      adminNotes: null,
    };

    db.verifications.push(verification);
    this.writeDB(db);

    return verification;
  }

  /**
   * Получает все ожидающие верификации
   * @returns {array} Массив заявок
   */
  getPendingVerifications() {
    const db = this.readDB();
    return db.verifications.filter(v => v.status === 'pending');
  }

  /**
   * Одобряет верификацию пользователя
   * @param {number} userId - ID пользователя
   * @returns {object} Обновленный пользователь
   */
  approveVerification(userId) {
    const db = this.readDB();
    const user = db.users.find(u => u.id === userId);
    const verification = db.verifications.find(v => v.userId === userId);

    if (!user) throw new Error('Пользователь не найден');

    user.verification.status = 'verified';
    if (verification) {
      verification.status = 'approved';
      verification.reviewedAt = new Date().toISOString();
    }

    this.writeDB(db);
    return user;
  }

  // ===== АНАЛИТИКА =====

  /**
   * Получает аналитику сделок за период
   * @param {number} userId - ID пользователя
   * @param {string} period - Период (day, week, month, year)
   * @returns {object} Аналитика
   */
  getAnalyticsByPeriod(userId, period) {
    const trades = this.getUserTrades(userId);
    const now = new Date();
    let startDate = new Date();

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
        throw new Error('Неверный период');
    }

    const filteredTrades = trades.filter(
      trade => new Date(trade.createdAt) >= startDate
    );

    const successful = filteredTrades.filter(t => t.status === 'successful');
    const failed = filteredTrades.filter(t => t.status === 'failed');

    return {
      period,
      startDate: startDate.toISOString(),
      endDate: now.toISOString(),
      totalTrades: filteredTrades.length,
      successfulTrades: successful.length,
      failedTrades: failed.length,
      successRate: filteredTrades.length > 0
        ? ((successful.length / filteredTrades.length) * 100).toFixed(2)
        : 0,
      totalVolume: filteredTrades.reduce((sum, t) => sum + t.fromAmount, 0),
      avgTradeSize: filteredTrades.length > 0
        ? (filteredTrades.reduce((sum, t) => sum + t.fromAmount, 0) / filteredTrades.length).toFixed(2)
        : 0,
    };
  }

  /**
   * Рассчитывает P&L (Profit & Loss) пользователя за период
   * @param {number} userId - ID пользователя
   * @param {string} period - Период (day, week, month, year)
   * @returns {object} P&L данные
   */
  calculatePnL(userId, period) {
    const trades = this.getUserTrades(userId);
    const user = this.getUserById(userId);
    const now = new Date();
    let startDate = new Date();

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
        throw new Error('Неверный период');
    }

    const filteredTrades = trades.filter(
      trade => new Date(trade.createdAt) >= startDate && trade.status === 'successful'
    );

    // Рассчитываем доход (для успешных сделок профит = разница между курсом)
    let totalProfit = 0;
    let totalLoss = 0;

    filteredTrades.forEach(trade => {
      const expectedAmount = trade.fromAmount * trade.rate;
      const actualGain = trade.toAmount - expectedAmount;

      if (actualGain > 0) {
        totalProfit += actualGain;
      } else {
        totalLoss += Math.abs(actualGain);
      }
    });

    const netPnL = totalProfit - totalLoss;
    const roi = filteredTrades.length > 0
      ? ((netPnL / (filteredTrades.reduce((sum, t) => sum + t.fromAmount, 0))) * 100).toFixed(2)
      : 0;

    return {
      period,
      startDate: startDate.toISOString(),
      endDate: now.toISOString(),
      totalProfit: parseFloat(totalProfit.toFixed(2)),
      totalLoss: parseFloat(totalLoss.toFixed(2)),
      netPnL: parseFloat(netPnL.toFixed(2)),
      roi: parseFloat(roi),
      capital: user.stats.totalTradeVolume,
      tradesCount: filteredTrades.length,
    };
  }

  /**
   * Получает данные для графика доходности (за каждый день зпо 2026 года)
   * @param {number} userId - ID пользователя
   * @returns {array} Массив данных для графика
   */
  getChartData(userId) {
    const trades = this.getUserTrades(userId);
    const chartData = [];
    const now = new Date();
    const currentYear = now.getFullYear();

    // Создаем массив для каждого дня года
    for (let month = 0; month < 12; month++) {
      const daysInMonth = new Date(currentYear, month + 1, 0).getDate();

      for (let day = 1; day <= daysInMonth; day++) {
        const dayDate = new Date(currentYear, month, day);
        dayDate.setHours(0, 0, 0, 0);
        const nextDay = new Date(dayDate);
        nextDay.setDate(nextDay.getDate() + 1);

        // Фильтруем сделки за этот день
        const dayTrades = trades.filter(
          trade => new Date(trade.createdAt) >= dayDate && new Date(trade.createdAt) < nextDay
        );

        let dayPnL = 0;
        dayTrades.forEach(trade => {
          if (trade.status === 'successful') {
            dayPnL += (trade.toAmount - (trade.fromAmount * trade.rate));
          } else if (trade.status === 'failed') {
            dayPnL -= (trade.fromAmount * trade.rate * 0.1); // 10% потери на неудачу
          }
        });

        chartData.push({
          date: dayDate.toISOString().split('T')[0],
          pnl: parseFloat(dayPnL.toFixed(2)),
          trades: dayTrades.length,
          dayOfWeek: dayDate.toLocaleDateString('ru-RU', { weekday: 'short' }),
        });
      }
    }

    return chartData;
  }

  /**
   * Получает статистику по видам сделок (winrate, рассчитывается по типу исхода - выигрыш/проигрыш/казино)
   * @param {number} userId - ID пользователя
   * @returns {object} Статистика
   */
  getTradeTypeStats(userId) {
    const trades = this.getUserTrades(userId);
    const user = this.getUserById(userId);

    const successful = trades.filter(t => t.status === 'successful');
    const failed = trades.filter(t => t.status === 'failed');

    return {
      wins: {
        count: successful.length,
        percentage: trades.length > 0 ? ((successful.length / trades.length) * 100).toFixed(2) : 0,
        totalVolume: successful.reduce((sum, t) => sum + t.toAmount, 0),
      },
      losses: {
        count: failed.length,
        percentage: trades.length > 0 ? ((failed.length / trades.length) * 100).toFixed(2) : 0,
        totalVolume: failed.reduce((sum, t) => sum + t.fromAmount, 0),
      },
      statistics: {
        totalTrades: trades.length,
        winRate: trades.length > 0 ? ((successful.length / trades.length) * 100).toFixed(2) : 0,
        lossRate: trades.length > 0 ? ((failed.length / trades.length) * 100).toFixed(2) : 0,
        avgProfit: successful.length > 0 
          ? (successful.reduce((sum, t) => sum + t.toAmount, 0) / successful.length).toFixed(2) 
          : 0,
        avgLoss: failed.length > 0 
          ? (failed.reduce((sum, t) => sum + t.fromAmount, 0) / failed.length).toFixed(2) 
          : 0,
      },
    };
  }
}

// Создаем и экспортируем единый экземпляр
const dbManager = new DatabaseManager();

module.exports = dbManager;
