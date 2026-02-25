/**
 * controllers/transactionController.js
 * Контроллер для управления транзакциями
 * Пополнения, выводы, история транзакций
 */

const dbManager = require('../models/dbManager');

/**
 * Создать заявку на пополнение
 * Генерирует ссылку для оплаты через CryptoBot @cryptobot
 */
const createDepositRequest = (req, res) => {
  try {
    const { userId, amount, currency } = req.body;

    // Валидация
    if (!userId || !amount || !currency) {
      return res.status(400).json({
        success: false,
        error: 'Не все обязательные поля заполнены',
      });
    }

    if (amount <= 0) {
      return res.status(400).json({
        success: false,
        error: 'Сумма должна быть больше 0',
      });
    }

    const user = dbManager.getUserById(parseInt(userId));
    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'Пользователь не найден',
      });
    }

    // Создаем транзакцию со статусом pending
    const transaction = dbManager.createTransaction({
      userId,
      type: 'deposit',
      currency,
      amount,
      status: 'pending',
    });

    // В реальности здесь генерируется ссылка через CryptoBot API
    // Сейчас возвращаем заглушку
    const paymentLink = `https://t.me/cryptobot?start=invoice_${transaction.id}`;

    res.json({
      success: true,
      data: {
        transactionId: transaction.id,
        paymentLink,
        amount,
        currency,
      },
      message: 'Ссылка для оплаты сгенерирована. Отправьте пользователю эту ссылку.',
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
};

/**
 * Подтвердить пополнение (для админ панели после проверки платежа)
 */
const confirmDeposit = (req, res) => {
  try {
    const { transactionId } = req.body;

    // Получаем транзакцию
    const db = dbManager.readDB();
    const transaction = db.transactions.find(
      t => t.id === transactionId && t.type === 'deposit' && t.status === 'pending'
    );

    if (!transaction) {
      return res.status(404).json({
        success: false,
        error: 'Транзакция не найдена или уже обработана',
      });
    }

    // Зачисляем деньги на счет пользователя
    try {
      dbManager.changeBalance(transaction.userId, transaction.currency, transaction.amount);
    } catch (error) {
      return res.status(500).json({
        success: false,
        error: 'Ошибка при зачислении средств: ' + error.message,
      });
    }

    // Обновляем статус транзакции
    const updatedTx = dbManager.updateTransactionStatus(transactionId, 'completed');

    res.json({
      success: true,
      data: updatedTx,
      message: 'Пополнение подтверждено и средства зачислены',
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
};

/**
 * Создать заявку на вывод средств
 */
const createWithdrawalRequest = (req, res) => {
  try {
    const { userId, amount, currency } = req.body;

    // Валидация
    if (!userId || !amount || !currency) {
      return res.status(400).json({
        success: false,
        error: 'Не все обязательные поля заполнены',
      });
    }

    if (amount <= 0) {
      return res.status(400).json({
        success: false,
        error: 'Сумма должна быть больше 0',
      });
    }

    // Проверяем баланс
    const currentBalance = dbManager.getBalance(parseInt(userId), currency);
    if (currentBalance < amount) {
      return res.status(400).json({
        success: false,
        error: 'Недостаточно средств для вывода',
      });
    }

    // Сохраняем транзакцию
    const transaction = dbManager.createTransaction({
      userId: parseInt(userId),
      type: 'withdrawal',
      currency,
      amount,
      status: 'pending',
    });

    // Сразу вычитаем со счета (заморозим средства)
    try {
      dbManager.changeBalance(parseInt(userId), currency, -amount);
    } catch (error) {
      return res.status(500).json({
        success: false,
        error: error.message,
      });
    }

    res.json({
      success: true,
      data: transaction,
      message: 'Заявка на вывод создана. Ожидает подтверждения администратора.',
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
};

/**
 * Подтвердить вывод (для админ панели)
 */
const confirmWithdrawal = (req, res) => {
  try {
    const { transactionId } = req.body;

    // Получаем транзакцию
    const db = dbManager.readDB();
    const transaction = db.transactions.find(
      t => t.id === transactionId && t.type === 'withdrawal' && t.status === 'pending'
    );

    if (!transaction) {
      return res.status(404).json({
        success: false,
        error: 'Заявка на вывод не найдена',
      });
    }

    // Обновляем статус
    const updatedTx = dbManager.updateTransactionStatus(transactionId, 'completed');

    res.json({
      success: true,
      data: updatedTx,
      message: 'Вывод подтвержден. Средства отправлены пользователю.',
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
};

/**
 * Отклонить вывод (вернуть средства на счет)
 */
const rejectWithdrawal = (req, res) => {
  try {
    const { transactionId } = req.body;

    // Получаем транзакцию
    const db = dbManager.readDB();
    const transaction = db.transactions.find(
      t => t.id === transactionId && t.type === 'withdrawal' && t.status === 'pending'
    );

    if (!transaction) {
      return res.status(404).json({
        success: false,
        error: 'Заявка на вывод не найдена',
      });
    }

    // Возвращаем средства на счет
    try {
      dbManager.changeBalance(transaction.userId, transaction.currency, transaction.amount);
    } catch (error) {
      return res.status(500).json({
        success: false,
        error: 'Ошибка при возврате средств: ' + error.message,
      });
    }

    // Обновляем статус
    const updatedTx = dbManager.updateTransactionStatus(transactionId, 'rejected');

    res.json({
      success: true,
      data: updatedTx,
      message: 'Заявка отклонена. Средства вернулись на счет пользователя.',
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
};

/**
 * Получить историю транзакций пользователя
 * type: null (все), 'deposit', 'withdrawal'
 */
const getTransactions = (req, res) => {
  try {
    const { userId } = req.params;
    const { type } = req.query;

    const transactions = dbManager.getUserTransactions(
      parseInt(userId),
      type || null
    );

    res.json({
      success: true,
      data: transactions,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
};

module.exports = {
  createDepositRequest,
  confirmDeposit,
  createWithdrawalRequest,
  confirmWithdrawal,
  rejectWithdrawal,
  getTransactions,
};
