/**
 * routes/api.js
 * Все API маршруты приложения
 * Маршруты организованы по функциональности
 */

const express = require('express');
const profileController = require('../controllers/profileController');
const tradeController = require('../controllers/tradeController');
const transactionController = require('../controllers/transactionController');
const verificationController = require('../controllers/verificationController');
const analyticsController = require('../controllers/analyticsController');

const router = express.Router();

// ===== ВЕРИФИКАЦИЯ И ПРОФИЛЬ =====

/**
 * @route   POST /api/user
 * @desc    Получить или создать пользователя по Telegram ID
 * @access  Public
 */
router.post('/user', verificationController.getOrCreateUser);

/**
 * @route   GET /api/profile/:userId
 * @desc    Получить полный профиль пользователя
 * @access  Public
 */
router.get('/profile/:userId', profileController.getProfile);

/**
 * @route   GET /api/statistics/:userId
 * @desc    Получить статистику пользователя
 * @access  Public
 */
router.get('/statistics/:userId', profileController.getStatistics);

// ===== ПОРТФЕЛЬ И КОШЕЛЬКИ =====

/**
 * @route   GET /api/portfolio/wallets/:userId
 * @desc    Получить все кошельки пользователя
 * @access  Public
 */
router.get('/portfolio/wallets/:userId', profileController.getWallets);

/**
 * @route   GET /api/portfolio/balance/:userId/:currency
 * @desc    Получить баланс в конкретной валюте
 * @access  Public
 */
router.get('/portfolio/balance/:userId/:currency', profileController.getBalance);

// ===== ТОРГОВЛЯ =====

/**
 * @route   POST /api/trades/create
 * @desc    Создать новую торговую сделку
 * @access  Public
 */
router.post('/trades/create', tradeController.createTrade);

/**
 * @route   POST /api/trades/confirm
 * @desc    Подтвердить сделку (админ)
 * @access  Admin
 */
router.post('/trades/confirm', tradeController.confirmTrade);

/**
 * @route   GET /api/trades/:userId/stats/:period
 * @desc    Получить статистику по сделкам за период (day, week, month, year)
 * @access  Public
 */
router.get('/trades/:userId/stats/:period', tradeController.getTradeStatsByPeriod);

/**
 * @route   GET /api/trades/:userId
 * @desc    Получить историю сделок пользователя
 * @access  Public
 */
router.get('/trades/:userId', tradeController.getTrades);

// ===== ТРАНЗАКЦИИ =====

/**
 * @route   POST /api/transactions/deposit/confirm
 * @desc    Подтвердить пополнение (админ)
 * @access  Admin
 */
router.post('/transactions/deposit/confirm', transactionController.confirmDeposit);

/**
 * @route   POST /api/transactions/deposit
 * @desc    Создать заявку на пополнение
 * @access  Public
 */
router.post('/transactions/deposit', transactionController.createDepositRequest);

/**
 * @route   POST /api/transactions/withdraw/reject
 * @desc    Отклонить вывод (админ)
 * @access  Admin
 */
router.post('/transactions/withdraw/reject', transactionController.rejectWithdrawal);

/**
 * @route   POST /api/transactions/withdraw/confirm
 * @desc    Подтвердить вывод (админ)
 * @access  Admin
 */
router.post('/transactions/withdraw/confirm', transactionController.confirmWithdrawal);

/**
 * @route   POST /api/transactions/withdraw
 * @desc    Создать заявку на вывод
 * @access  Public
 */
router.post('/transactions/withdraw', transactionController.createWithdrawalRequest);

/**
 * @route   GET /api/transactions/:userId
 * @desc    Получить историю транзакций (query: ?type=deposit|withdrawal)
 * @access  Public
 */
router.get('/transactions/:userId', transactionController.getTransactions);

// ===== ВЕРИФИКАЦИЯ =====

/**
 * @route   POST /api/verification/submit
 * @desc    Создать заявку на верификацию
 * @access  Public
 */
router.post('/verification/submit', verificationController.submitVerification);

/**
 * @route   GET /api/verification/pending/all
 * @desc    Получить все ожидающие верификации (админ)
 * @access  Admin
 */
router.get('/verification/pending/all', verificationController.getPendingVerifications);

/**
 * @route   GET /api/verification/:userId
 * @desc    Получить статус верификации пользователя
 * @access  Public
 */
router.get('/verification/:userId', verificationController.getVerificationStatus);

/**
 * @route   POST /api/verification/approve
 * @desc    Одобрить верификацию (админ)
 * @access  Admin
 */
router.post('/verification/approve', verificationController.approveVerification);

// ===== АНАЛИТИКА И СТАТИСТИКА =====

/**
 * @route   GET /api/analytics/:userId/full
 * @desc    Получить полную аналитику пользователя
 * @access  Public
 */
router.get('/analytics/:userId/full', analyticsController.getFullAnalytics);

/**
 * @route   GET /api/analytics/:userId/stats
 * @desc    Получить статистику по типам сделок
 * @access  Public
 */
router.get('/analytics/:userId/stats', analyticsController.getTradeStats);

/**
 * @route   GET /api/analytics/:userId/chart
 * @desc    Получить данные для графика доходности
 * @access  Public
 */
router.get('/analytics/:userId/chart', analyticsController.getChartData);

/**
 * @route   GET /api/analytics/:userId/pnl/:period
 * @desc    Получить P&L за период (day, week, month, year)
 * @access  Public
 */
router.get('/analytics/:userId/pnl/:period', analyticsController.getPnL);

/**
 * @route   GET /api/analytics/:userId/:period
 * @desc    Получить аналитику за период (day, week, month, year)
 * @access  Public
 */
router.get('/analytics/:userId/:period', analyticsController.getAnalytics);

module.exports = router;
