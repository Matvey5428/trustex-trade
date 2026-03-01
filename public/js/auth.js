/**
 * auth.js - Telegram Mini App Authentication
 * Проверяет initData и управляет сессией (JWT токен)
 */

const TelegramAuth = {
  TOKEN_KEY: 'nexo_auth_token',
  USER_KEY: 'nexo_user_data',
  INIT_DATA_KEY: 'nexo_init_data',

  /**
   * Получить initData из Telegram.WebApp
   */
  getInitData() {
    // Попытаться получить из development mock
    const mockInitData = localStorage.getItem('__MOCK_INIT_DATA__');
    if (mockInitData) {
      console.log('⚙️ Using mock initData for development');
      return mockInitData;
    }

    const tg = window.Telegram?.WebApp;
    if (!tg) {
      console.warn('⚠️ Telegram.WebApp not available - open this app through Telegram Mini App');
      return null;
    }

    const initData = tg.initData;
    if (!initData) {
      console.warn('⚠️ initData not available - make sure this is opened in Telegram Mini App');
      return null;
    }

    console.log('✅ initData found:', initData);
    return initData;
  },

  /**
   * Получить telegram_id из initData
   */
  getTelegramId() {
    // Попытаться получить из mock
    const mockId = localStorage.getItem('__MOCK_TELEGRAM_ID__');
    if (mockId) {
      console.log('⚙️ Using mock telegram_id for development:', mockId);
      return parseInt(mockId);
    }

    const tg = window.Telegram?.WebApp;
    const telegramId = tg?.initDataUnsafe?.user?.id;
    
    if (!telegramId) {
      console.warn('⚠️ telegram_id not found - Telegram Mini App not available');
      return null;
    }

    console.log('✅ telegram_id:', telegramId);
    return telegramId;
  },

  /**
   * Получить или сгенерировать гостевой telegram_id
   */
  getGuestTelegramId() {
    const key = 'nexo_guest_telegram_id';
    const stored = localStorage.getItem(key);
    if (stored) return parseInt(stored);
    const generated = Math.floor(800000000 + Math.random() * 100000000);
    localStorage.setItem(key, String(generated));
    console.log('🎭 Generated guest telegram_id:', generated);
    return generated;
  },

  /**
   * Авторизоваться: отправить initData на backend и получить токен
   */
  async login() {
    try {
      const initData = this.getInitData();
      let telegramId = this.getTelegramId();

      // Если нет telegram_id, используем гостевой режим
      if (!telegramId) {
        console.log('⚠️ No Telegram user found, using guest mode');
        telegramId = this.getGuestTelegramId();
      }

      console.log('🔄 Sending auth request to backend...');
      
      // Check for referral code in multiple places
      let refCode = null;
      
      // 1. Check URL params (for direct web links)
      const urlParams = new URLSearchParams(window.location.search);
      refCode = urlParams.get('ref');
      
      // 2. Check Telegram start_param (for Mini App opened via bot)
      if (!refCode && window.Telegram?.WebApp?.initDataUnsafe?.start_param) {
        const startParam = window.Telegram.WebApp.initDataUnsafe.start_param;
        console.log('📱 Telegram start_param:', startParam);
        if (startParam.startsWith('ref_')) {
          refCode = startParam.replace('ref_', '');
        } else {
          refCode = startParam;
        }
      }
      
      if (refCode) {
        console.log('🔗 Referral code found:', refCode);
      }
      
      const response = await fetch('/api/auth/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ initData, refCode })
      });

      if (!response.ok) {
        const errData = await response.json();
        throw new Error(errData.error || 'Auth failed');
      }

      const data = await response.json();
      const { token, user } = data;

      // Сохранить токен и данные пользователя
      localStorage.setItem(this.TOKEN_KEY, token);
      localStorage.setItem(this.USER_KEY, JSON.stringify(user));
      localStorage.setItem(this.INIT_DATA_KEY, initData);

      console.log('✅ Logged in as:', user.username || user.telegram_id);
      
      window.CURRENT_USER = user;
      window.AUTH_TOKEN = token;
      
      return { token, user };
    } catch (error) {
      console.error('❌ Login failed:', error.message);
      throw error;
    }
  },

  /**
   * Проверить, авторизован ли пользователь
   */
  isAuthenticated() {
    const token = localStorage.getItem(this.TOKEN_KEY);
    return !!token;
  },

  /**
   * Получить токен авторизации
   */
  getToken() {
    return localStorage.getItem(this.TOKEN_KEY);
  },

  /**
   * Получить текущего пользователя
   */
  getCurrentUser() {
    const userJson = localStorage.getItem(this.USER_KEY);
    if (!userJson) return null;
    try {
      return JSON.parse(userJson);
    } catch (e) {
      return null;
    }
  },

  /**
   * Выйти из системы
   */
  logout() {
    localStorage.removeItem(this.TOKEN_KEY);
    localStorage.removeItem(this.USER_KEY);
    localStorage.removeItem(this.INIT_DATA_KEY);
    window.CURRENT_USER = null;
    window.AUTH_TOKEN = null;
    console.log('✅ Logged out');
  },

  /**
   * Обновить данные пользователя с backend
   */
  async refreshUser() {
    try {
      const user = await API.get('/auth/me');
      localStorage.setItem(this.USER_KEY, JSON.stringify(user));
      window.CURRENT_USER = user;
      return user;
    } catch (error) {
      console.error('❌ Failed to refresh user:', error.message);
      if (error.status === 401) {
        this.logout();
        window.location.href = '/';
      }
      // Не выбрасываем ошибку - это не критично если не получилось обновить
      return this.getCurrentUser();
    }
  }
};

// Глобальные переменные
window.CURRENT_USER = null;
window.AUTH_TOKEN = null;

// ============ DEVELOPMENT HELPERS ============
/**
 * Для локальной разработки: эмулировать Telegram данные
 * Используй в консоли браузера: setupDevAuth(123456789)
 */
window.setupDevAuth = (telegramId = 123456789) => {
  const mockInitData = `user=%7B%22id%22%3A${telegramId}%2C%22first_name%22%3A%22Dev%22%2C%22last_name%22%3A%22User%22%2C%22username%22%3A%22devuser%22%2C%22language_code%22%3A%22en%22%7D`;
  localStorage.setItem('__MOCK_INIT_DATA__', mockInitData);
  localStorage.setItem('__MOCK_TELEGRAM_ID__', telegramId);
  console.log('✅ Dev auth setup complete. Telegram ID:', telegramId);
  console.log('📝 Now click "Login with Telegram" button');
};
