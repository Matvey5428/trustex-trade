/**
 * balance.js - Universal Balance Display
 * Автоматически загружает и отображает баланс на всех страницах
 */

const BalanceManager = {
  RUB_RATE: 90,
  
  /**
   * Инициализация - автоматически вызывается при загрузке
   */
  async init() {
    console.log('💰 BalanceManager initializing...');
    
    try {
      // Сначала авторизуемся если нужно
      if (!TelegramAuth.isAuthenticated()) {
        console.log('🔄 Not authenticated, logging in...');
        await TelegramAuth.login();
      } else {
        // Обновить данные пользователя с сервера
        await TelegramAuth.refreshUser();
      }
      
      // Получить пользователя
      const user = window.CURRENT_USER || TelegramAuth.getCurrentUser();
      
      if (!user) {
        console.warn('⚠️ No user data available');
        return;
      }
      
      // Обновить все элементы баланса на странице
      this.updateBalanceElements(user);
      
      console.log('✅ Balance loaded:', user.balance_usdt, 'USDT');
      
    } catch (error) {
      console.error('❌ BalanceManager init failed:', error.message);
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
    const updates = {
      // Главный баланс
      'totalBalance': `$${totalUsd.toFixed(2)}`,
      'total-balance': `$${totalUsd.toFixed(2)}`,
      
      // USDT баланс
      'userUsdtBalance': `${balanceUsdt.toFixed(2)} USDT`,
      'usdt-balance': `${balanceUsdt.toFixed(2)} USDT`,
      'balanceUsdt': `${balanceUsdt.toFixed(2)}`,
      'bal-USDT': `${balanceUsdt.toFixed(2)} USDT`,
      
      // BTC баланс  
      'userBtcBalance': `${balanceBtc.toFixed(8)} BTC`,
      'btc-balance': `${balanceBtc.toFixed(8)} BTC`,
      'balanceBtc': `${balanceBtc.toFixed(8)}`,
      'bal-BTC': `${balanceBtc.toFixed(8)} BTC`,
      
      // RUB баланс
      'userRubBalance': `${balanceRub.toFixed(2)} ₽`,
      'rub-balance': `${balanceRub.toFixed(2)} ₽`,
      'balanceRub': `${balanceRub.toFixed(2)}`,
      'bal-RUB': `${balanceRub.toFixed(2)} ₽`,
      
      // TON баланс
      'bal-TON': `${balanceTon.toFixed(4)} TON`,
      
      // ETH баланс
      'bal-ETH': `${balanceEth.toFixed(6)} ETH`,
      
      // Для страниц deposit/withdraw
      'available-balance': `${balanceUsdt.toFixed(2)} USDT`,
      'availableBalance': `${balanceUsdt.toFixed(2)} USDT`,
    };
    
    for (const [id, value] of Object.entries(updates)) {
      const el = document.getElementById(id);
      if (el) {
        el.textContent = value;
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
      console.error('❌ Failed to refresh balance:', error.message);
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
