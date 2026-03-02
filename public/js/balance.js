/**
 * balance.js - Universal Balance Display
 * Автоматически загружает и отображает баланс на всех страницах
 */

const BalanceManager = {
  RUB_RATE: 90,
  
  /**
   * Форматирование числа с пробелами как разделителями тысяч
   */
  formatNumber(num, decimals = 2) {
    return num.toLocaleString('ru-RU', { minimumFractionDigits: decimals, maximumFractionDigits: decimals }).replace(/,/g, '.');
  },
  
  /**
   * Инициализация - автоматически вызывается при загрузке
   */
  async init() {
    try {
      // Сначала авторизуемся если нужно
      if (!TelegramAuth.isAuthenticated()) {
        await TelegramAuth.login();
      } else {
        // Обновить данные пользователя с сервера
        await TelegramAuth.refreshUser();
      }
      
      // Получить пользователя
      const user = window.CURRENT_USER || TelegramAuth.getCurrentUser();
      if (!user) return;
      
      // Обновить все элементы баланса на странице
      this.updateBalanceElements(user);
    } catch (error) {
      // Silent fail
    }
  },
  
  /**
   * Обновить все элементы баланса на странице
   */
  updateBalanceElements(user) {
    const balanceUsdt = parseFloat(user.balance_usdt) || 0;
    const balanceBtc = parseFloat(user.balance_btc) || 0;
    const balanceRub = parseFloat(user.balance_rub) || 0;
    const balanceTon = parseFloat(user.balance_ton) || 0;
    const balanceEth = parseFloat(user.balance_eth) || 0;
    
    // Расчет общего баланса в USD
    const totalUsd = balanceUsdt + (balanceRub / this.RUB_RATE);
    
    // Обновить элементы по ID
    const fmt = this.formatNumber.bind(this);
    const updates = {
      // Главный баланс
      'totalBalance': `$${fmt(totalUsd)}`,
      'total-balance': `$${fmt(totalUsd)}`,
      
      // USDT баланс
      'userUsdtBalance': `${fmt(balanceUsdt)} USDT`,
      'usdt-balance': `${fmt(balanceUsdt)} USDT`,
      'balanceUsdt': `${fmt(balanceUsdt)}`,
      'bal-USDT': `${fmt(balanceUsdt)} USDT`,
      'usdtBalance': `${fmt(balanceUsdt)} $`,
      
      // BTC баланс  
      'userBtcBalance': `${fmt(balanceBtc, 8)} BTC`,
      'btc-balance': `${fmt(balanceBtc, 8)} BTC`,
      'balanceBtc': `${fmt(balanceBtc, 8)}`,
      'bal-BTC': `${fmt(balanceBtc, 8)} BTC`,
      'btcBalance': `${fmt(balanceBtc, 8)} $`,
      
      // RUB баланс
      'userRubBalance': `${fmt(balanceRub)} ₽`,
      'rub-balance': `${fmt(balanceRub)} ₽`,
      'balanceRub': `${fmt(balanceRub)}`,
      'bal-RUB': `${fmt(balanceRub)} ₽`,
      'rubBalance': `${fmt(balanceRub)} ₽`,
      
      // TON баланс
      'bal-TON': `${fmt(balanceTon, 4)} TON`,
      'tonBalance': `${fmt(balanceTon, 4)} $`,
      
      // ETH баланс
      'bal-ETH': `${fmt(balanceEth, 6)} ETH`,
      'ethBalance': `${fmt(balanceEth, 6)} $`,
      
      // Для страниц deposit/withdraw
      'available-balance': `${fmt(balanceUsdt)} USDT`,
      'availableBalance': `${fmt(balanceUsdt)} USDT`,
      
      // Для exchange.html
      'rubBalanceText': `${fmt(balanceRub)} ₽`,
      'usdtBalanceText': `${fmt(balanceUsdt)} $`,
      
      // Для withdraw.html
      'balanceText': `${fmt(balanceRub)} ₽ | ${fmt(balanceUsdt)} $`,
    };
    
    for (const [id, value] of Object.entries(updates)) {
      const el = document.getElementById(id);
      if (el) {
        el.textContent = value;
        // Remove skeleton loading state and add loaded animation
        el.classList.remove('skeleton');
        el.classList.add('loaded');
      }
    }
    
    // Сохранить балансы глобально для использования в других скриптах
    window.USER_BALANCES = {
      usdt: balanceUsdt,
      btc: balanceBtc,
      rub: balanceRub,
      ton: balanceTon,
      eth: balanceEth,
      totalUsd: totalUsd
    };
  },
  
  /**
   * Получить текущий баланс USDT
   */
  getUsdtBalance() {
    return window.USER_BALANCES?.usdt || 0;
  },
  
  /**
   * Получить общий баланс в USD
   */
  getTotalBalance() {
    return window.USER_BALANCES?.totalUsd || 0;
  },
  
  /**
   * Обновить баланс с сервера
   */
  async refresh() {
    try {
      const user = await TelegramAuth.refreshUser();
      if (user) {
        this.updateBalanceElements(user);
      }
      return user;
    } catch (error) {
      return null;
    }
  }
};

// Автоматическая инициализация при загрузке страницы
document.addEventListener('DOMContentLoaded', () => {
  // Небольшая задержка чтобы Telegram SDK успел загрузиться
  setTimeout(() => {
    BalanceManager.init();
  }, 100);
});
