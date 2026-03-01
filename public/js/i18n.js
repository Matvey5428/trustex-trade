// Global i18n translation system for TrustEx
// Default language is English, can switch to Russian

const i18n = {
  en: {
    // General
    back: 'Back',
    loading: 'Loading...',
    refresh: 'Refresh',
    menu: 'Menu',
    soon: 'Soon',
    all: 'All',
    
    // Navigation
    assets: 'Assets',
    trading: 'Trading',
    terminal: 'Terminal',
    binaryOptions: 'Binary Options',
    
    // Main page
    totalBalance: 'Total Balance',
    deposit: 'Deposit',
    withdraw: 'Withdraw',
    exchange: 'Exchange',
    notifications: 'Notifications',
    language: 'Language',
    version: 'Version',
    profile: 'Profile',
    accountId: 'Account ID',
    statsLabel: 'Statistics (total / wins / losses)',
    tradingVolume: 'Trading Volume',
    verification: 'Verification',
    verified: '✅ Verified',
    notVerified: '⚠️ Not verified',
    fiatAccounts: 'Fiat Accounts',
    crypto: 'Cryptocurrencies',
    rub: 'Russian Ruble',
    reviews: 'Customer Reviews',
    reviewsSubtitle: 'What users say about the platform',
    allReviews: 'All Reviews',
    reviewsOf: 'Reviews',
    of: 'of',
    analytics: 'Trading Analytics',
    allTime: 'All',
    year: 'Year',
    month: 'Month',
    week: 'Week',
    day: 'Day',
    winRate: 'Win Rate',
    avgProfit: 'Average Profit',
    avgLoss: 'Average Loss',
    maxWin: 'Max Win',
    maxLoss: 'Max Loss',
    profitFactor: 'Profit Factor',
    pnlChart: 'P&L Chart',
    noData: 'Not enough data',
    periodStats: 'Period Statistics',
    today: 'Today',
    profit: 'Profit',
    trades: 'Trades',
    transactionHistory: 'Transaction History',
    withdrawals: 'Withdrawals',
    deposits: 'Deposits',
    historyEmpty: 'Transaction history is empty',
    
    // Deposit page
    depositTitle: 'Deposit',
    selectCurrency: 'Select currency to deposit',
    fiatCurrencies: 'Fiat Currencies',
    cryptocurrencies: 'Cryptocurrencies',
    depositAmount: 'Deposit Amount',
    enterAmount: 'Enter amount',
    minDeposit: 'Minimum deposit',
    confirmDeposit: 'Confirm Deposit',
    depositSuccess: 'Deposit successful!',
    depositPending: 'Deposit pending',
    paymentMethod: 'Payment Method',
    bankCard: 'Bank Card',
    cryptoWallet: 'Crypto Wallet',
    
    // Withdraw page
    withdrawTitle: 'Withdraw Funds',
    availableBalance: 'Available for withdrawal',
    selectWithdrawCurrency: 'Select currency',
    withdrawAmount: 'Withdrawal Amount',
    cardOrWallet: 'Card or wallet number',
    recipientName: 'Recipient name',
    withdrawFunds: 'Withdraw Funds',
    withdrawSuccess: 'Withdrawal request submitted',
    insufficientFunds: 'Insufficient funds',
    minWithdraw: 'Minimum withdrawal',
    
    // Exchange page
    exchangeTitle: 'Exchange',
    exchangeFrom: 'From',
    exchangeTo: 'To',
    rate: 'Rate',
    youWillGet: 'You will receive',
    selectAll: 'All',
    exchangeBtn: 'Exchange',
    exchangeSuccess: 'Exchange successful!',
    
    // Trading page
    tradingPairs: 'Trading Pairs',
    markets: 'Markets',
    spot: 'Spot',
    futures: 'Futures',
    favorites: 'Favorites',
    price: 'Price',
    change24h: '24h Change',
    volume: 'Volume',
    
    // Terminal page
    balance: 'Balance',
    livePrice: 'Live Price',
    up: 'UP',
    down: 'DOWN',
    tradeHistory: 'Trade History',
    noTrades: 'No trades yet',
    amount: 'Amount',
    duration: 'Duration',
    seconds: 'sec',
    minutes: 'min',
    openTrade: 'Open Trade',
    closeTrade: 'Close',
    profitLabel: 'Profit',
    lossLabel: 'Loss',
    pending: 'Pending',
    won: 'Won',
    lost: 'Lost',
    insufficientBalance: 'Insufficient balance',
    
    // Reviews page
    allReviewsTitle: 'All Reviews',
    reviewsCount: 'reviews',
    backToTop: 'Back to top',
    loadingReviews: 'Loading reviews...',
    
    // Alerts & Messages
    success: 'Success',
    error: 'Error',
    warning: 'Warning',
    info: 'Info',
    confirm: 'Confirm',
    cancel: 'Cancel',
    close: 'Close',
    
    // Time periods
    sec30: '30 sec',
    min1: '1 min',
    min2: '2 min',
    min3: '3 min',
    min5: '5 min',
    min10: '10 min',
    
    // Status
    active: 'Active',
    completed: 'Completed',
    failed: 'Failed',
    processing: 'Processing'
  },
  
  ru: {
    // General
    back: 'Назад',
    loading: 'Загрузка...',
    refresh: 'Обновить',
    menu: 'Меню',
    soon: 'Скоро',
    all: 'Все',
    
    // Navigation
    assets: 'Активы',
    trading: 'Торговля',
    terminal: 'Терминал',
    binaryOptions: 'Бинарные опционы',
    
    // Main page
    totalBalance: 'Общий баланс',
    deposit: 'Пополнить',
    withdraw: 'Вывести',
    exchange: 'Обменять',
    notifications: 'Уведомления',
    language: 'Язык',
    version: 'Версия',
    profile: 'Профиль',
    accountId: 'ID аккаунта',
    statsLabel: 'Статистика (всего / побед / проигрышей)',
    tradingVolume: 'Объем торгов',
    verification: 'Верификация',
    verified: '✅ Верифицирован',
    notVerified: '⚠️ Не верифицирован',
    fiatAccounts: 'Валютные счета',
    crypto: 'Криптовалюты',
    rub: 'Российский рубль',
    reviews: 'Отзывы клиентов',
    reviewsSubtitle: 'Что говорят пользователи о платформе',
    allReviews: 'Все отзывы',
    reviewsOf: 'Отзывы',
    of: 'из',
    analytics: 'Аналитика торговли',
    allTime: 'Все',
    year: 'Год',
    month: 'Месяц',
    week: 'Неделя',
    day: 'День',
    winRate: 'Win Rate',
    avgProfit: 'Средняя прибыль',
    avgLoss: 'Средний убыток',
    maxWin: 'Макс. выигрыш',
    maxLoss: 'Макс. проигрыш',
    profitFactor: 'Profit Factor',
    pnlChart: 'График доходности (P&L)',
    noData: 'Недостаточно данных',
    periodStats: 'Статистика по периодам',
    today: 'Сегодня',
    profit: 'Прибыль',
    trades: 'Сделок',
    transactionHistory: 'История транзакций',
    withdrawals: 'Выводы',
    deposits: 'Пополнения',
    historyEmpty: 'История транзакций пуста',
    
    // Deposit page
    depositTitle: 'Пополнение',
    selectCurrency: 'Выберите валюту для пополнения',
    fiatCurrencies: 'Валютные счета',
    cryptocurrencies: 'Криптовалюты',
    depositAmount: 'Сумма пополнения',
    enterAmount: 'Введите сумму',
    minDeposit: 'Мин. пополнение',
    confirmDeposit: 'Подтвердить пополнение',
    depositSuccess: 'Пополнение успешно!',
    depositPending: 'Ожидание подтверждения',
    paymentMethod: 'Способ оплаты',
    bankCard: 'Банковская карта',
    cryptoWallet: 'Крипто кошелек',
    
    // Withdraw page
    withdrawTitle: 'Вывод средств',
    availableBalance: 'Доступно к выводу',
    selectWithdrawCurrency: 'Выберите валюту',
    withdrawAmount: 'Сумма вывода',
    cardOrWallet: 'Номер карты или кошелька',
    recipientName: 'ФИО получателя',
    withdrawFunds: 'Вывести средства',
    withdrawSuccess: 'Заявка на вывод создана',
    insufficientFunds: 'Недостаточно средств',
    minWithdraw: 'Мин. вывод',
    
    // Exchange page
    exchangeTitle: 'Обмен',
    exchangeFrom: 'Откуда',
    exchangeTo: 'Куда',
    rate: 'Курс',
    youWillGet: 'Вы получите',
    selectAll: 'Все',
    exchangeBtn: 'Обменять',
    exchangeSuccess: 'Обмен выполнен!',
    
    // Trading page
    tradingPairs: 'Торговые пары',
    markets: 'Рынки',
    spot: 'Спот',
    futures: 'Фьючерсы',
    favorites: 'Избранное',
    price: 'Цена',
    change24h: 'Изменение 24ч',
    volume: 'Объем',
    
    // Terminal page
    balance: 'Баланс',
    livePrice: 'Live Price',
    up: 'ВВЕРХ',
    down: 'ВНИЗ',
    tradeHistory: 'История сделок',
    noTrades: 'Нет сделок',
    amount: 'Сумма',
    duration: 'Длительность',
    seconds: 'сек',
    minutes: 'мин',
    openTrade: 'Открыть сделку',
    closeTrade: 'Закрыть',
    profitLabel: 'Прибыль',
    lossLabel: 'Убыток',
    pending: 'В процессе',
    won: 'Выигрыш',
    lost: 'Проигрыш',
    insufficientBalance: 'Недостаточно средств на балансе',
    
    // Reviews page
    allReviewsTitle: 'Все отзывы',
    reviewsCount: 'отзывов',
    backToTop: 'Наверх',
    loadingReviews: 'Загрузка отзывов...',
    
    // Alerts & Messages
    success: 'Успешно',
    error: 'Ошибка',
    warning: 'Внимание',
    info: 'Информация',
    confirm: 'Подтвердить',
    cancel: 'Отмена',
    close: 'Закрыть',
    
    // Time periods
    sec30: '30 сек',
    min1: '1 мин',
    min2: '2 мин',
    min3: '3 мин',
    min5: '5 мин',
    min10: '10 мин',
    
    // Status
    active: 'Активно',
    completed: 'Завершено',
    failed: 'Ошибка',
    processing: 'В обработке'
  }
};

// Current language - default is English
let currentLang = localStorage.getItem('language') || 'en';

// Get translation
function t(key) {
  return i18n[currentLang]?.[key] || i18n['en']?.[key] || key;
}

// Apply translations to all elements with data-i18n attribute
function applyLanguage(lang) {
  if (lang) {
    currentLang = lang;
    localStorage.setItem('language', lang);
  }
  
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.getAttribute('data-i18n');
    const translation = t(key);
    if (translation) {
      el.textContent = translation;
    }
  });
  
  // Update placeholders
  document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
    const key = el.getAttribute('data-i18n-placeholder');
    const translation = t(key);
    if (translation) {
      el.placeholder = translation;
    }
  });
  
  // Update document title if data-i18n-title exists
  const titleKey = document.body.getAttribute('data-i18n-title');
  if (titleKey) {
    document.title = t(titleKey) + ' - TrustEx';
  }
}

// Initialize on DOM ready
document.addEventListener('DOMContentLoaded', () => {
  // Apply saved language
  applyLanguage(currentLang);
  
  // Show body after translations applied
  document.body.classList.add('i18n-ready');
  
  // Setup language selector if exists
  const langSelect = document.getElementById('languageSelect');
  if (langSelect) {
    langSelect.value = currentLang;
    langSelect.addEventListener('change', (e) => {
      applyLanguage(e.target.value);
    });
  }
});

// Export for use in other scripts
window.i18n = i18n;
window.t = t;
window.applyLanguage = applyLanguage;
window.currentLang = currentLang;
