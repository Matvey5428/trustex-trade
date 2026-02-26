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
    const tg = window.Telegram?.WebApp;
    if (!tg) {
      console.warn('⚠️ Telegram.WebApp not available');
      return null;
    }

    const initData = tg.initData;
    if (!initData) {
      console.warn('⚠️ initData not available');
      return null;
    }

    console.log('✅ initData found:', initData);
    return initData;
  },

  /**
   * Получить telegram_id из initData
   */
  getTelegramId() {
    const tg = window.Telegram?.WebApp;
    const telegramId = tg?.initDataUnsafe?.user?.id;
    
    if (!telegramId) {
      console.warn('⚠️ telegram_id not found in initData');
      return null;
    }

    console.log('✅ telegram_id:', telegramId);
    return telegramId;
  },

  /**
   * Авторизоваться: отправить initData на backend и получить токен
   */
  async login() {
    try {
      const initData = this.getInitData();
      const telegramId = this.getTelegramId();

      if (!initData || !telegramId) {
        throw new Error('Telegram initData not available');
      }

      console.log('🔄 Sending auth request to backend...');
      
      const response = await fetch('/api/auth/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ initData })
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
      const user = await API.get('/profile');
      localStorage.setItem(this.USER_KEY, JSON.stringify(user));
      window.CURRENT_USER = user;
      return user;
    } catch (error) {
      console.error('❌ Failed to refresh user:', error.message);
      if (error.status === 401) {
        this.logout();
        window.location.href = '/';
      }
      throw error;
    }
  }
};

// Глобальные переменные
window.CURRENT_USER = null;
window.AUTH_TOKEN = null;
