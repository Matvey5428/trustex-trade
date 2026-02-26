/**
 * api.js - Универсальный HTTP клиент для всех API запросов
 * Автоматически добавляет токен авторизации
 */

const API = {
  BASE_URL: '/api',

  /**
   * Внутренний метод для всех запросов
   */
  async request(endpoint, options = {}) {
    const url = `${this.BASE_URL}${endpoint}`;
    const token = TelegramAuth.getToken();

    const headers = {
      'Content-Type': 'application/json',
      ...options.headers
    };

    // Добавить токен авторизации если он есть
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    try {
      const response = await fetch(url, {
        ...options,
        headers
      });

      // Если 401 - пользователь не авторизован или сессия истекла
      if (response.status === 401) {
        console.warn('⚠️ Unauthorized (401) - session expired');
        TelegramAuth.logout();
        window.location.href = '/';
        throw new Error('Session expired');
      }

      // Если 403 - доступ запрещён
      if (response.status === 403) {
        console.error('❌ Forbidden (403) - access denied');
        throw new Error('Access denied');
      }

      // Если 429 - rate limit
      if (response.status === 429) {
        console.error('❌ Too many requests (429)');
        throw new Error('Too many requests. Please try again later.');
      }

      const data = await response.json();

      if (!response.ok) {
        const error = new Error(data.error || `Request failed with status ${response.status}`);
        error.status = response.status;
        error.data = data;
        throw error;
      }

      return data;
    } catch (error) {
      console.error(`❌ API ${options.method || 'GET'} ${endpoint}:`, error.message);
      throw error;
    }
  },

  /**
   * GET запрос
   */
  get(endpoint) {
    return this.request(endpoint, { method: 'GET' });
  },

  /**
   * POST запрос
   */
  post(endpoint, body) {
    return this.request(endpoint, {
      method: 'POST',
      body: JSON.stringify(body)
    });
  },

  /**
   * PUT запрос
   */
  put(endpoint, body) {
    return this.request(endpoint, {
      method: 'PUT',
      body: JSON.stringify(body)
    });
  },

  /**
   * DELETE запрос
   */
  delete(endpoint) {
    return this.request(endpoint, { method: 'DELETE' });
  },

  // ========== AUTH ==========

  /**
   * Авторизация через Telegram
   */
  auth: {
    verify: () => API.post('/auth/verify', { initData: TelegramAuth.getInitData() })
  },

  // ========== PROFILE ==========

  /**
   * Получить профиль текущего пользователя
   */
  profile: {
    get: () => API.get('/profile'),
    balance: () => API.get('/profile/balance')
  },

  // ========== ORDERS ==========

  /**
   * Работа с ордерами (бинарные опционы)
   */
  orders: {
    create: (amount, direction, duration) => 
      API.post('/orders', { amount, direction, duration }),
    
    list: () => API.get('/orders'),
    
    history: (page = 1, limit = 20) => 
      API.get(`/orders/history?page=${page}&limit=${limit}`),
    
    get: (id) => API.get(`/orders/${id}`),
    
    close: (id) => API.post(`/orders/${id}/close`, {})
  },

  // ========== TRANSACTIONS ==========

  /**
   * История транзакций
   */
  transactions: {
    list: () => API.get('/transactions'),
    
    byType: (type) => API.get(`/transactions?type=${type}`)
  },

  // ========== DEPOSITS ==========

  /**
   * Запросы на депозит
   */
  deposits: {
    request: (amount) => 
      API.post('/deposits/request', { amount }),
    
    listRequests: () => 
      API.get('/deposits/requests')
  },

  // ========== WITHDRAWS ==========

  /**
   * Запросы на вывод
   */
  withdraws: {
    request: (amount, wallet) => 
      API.post('/withdraws/request', { amount, wallet }),
    
    listRequests: () => 
      API.get('/withdraws/requests')
  },

  // ========== ADMIN ==========

  /**
   * Админ-функции
   */
  admin: {
    getSettings: () => 
      API.get('/admin/system-settings'),
    
    updateSetting: (key, value) => 
      API.post('/admin/system-settings', { key, value }),
    
    blockUser: (userId) => 
      API.post(`/admin/users/${userId}/block`, {}),
    
    approveDeposit: (depositId) => 
      API.post(`/admin/deposits/${depositId}/approve`, {}),
    
    rejectDeposit: (depositId) => 
      API.post(`/admin/deposits/${depositId}/reject`, {}),
    
    approveWithdraw: (withdrawId) => 
      API.post(`/admin/withdraws/${withdrawId}/approve`, {}),
    
    rejectWithdraw: (withdrawId) => 
      API.post(`/admin/withdraws/${withdrawId}/reject`, {}),
    
    resolveOrder: (orderId, result) => 
      API.post(`/admin/orders/${orderId}/resolve`, { result })
  }
};
