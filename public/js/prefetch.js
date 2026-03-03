/**
 * prefetch.js - Instant page navigation
 * Предзагружает страницы и кэширует данные для мгновенных переходов
 */

const Prefetch = {
  CACHE_KEY: 'nexo_prices_cache',
  CACHE_TTL: 30000, // 30 секунд

  /**
   * Предзагрузить страницу
   */
  preload(url) {
    if (!url || document.querySelector(`link[href="${url}"]`)) return;
    
    const link = document.createElement('link');
    link.rel = 'prefetch';
    link.href = url;
    link.as = 'document';
    document.head.appendChild(link);
  },

  /**
   * Предзагрузить все ссылки навигации
   */
  preloadNavLinks() {
    const navLinks = document.querySelectorAll('.bottom-nav .nav-item, .nav-item');
    const pages = new Set();
    
    navLinks.forEach(link => {
      const href = link.getAttribute('href');
      if (href && !href.startsWith('#') && !href.startsWith('javascript')) {
        pages.add(href);
      }
    });
    
    pages.forEach(page => this.preload(page));
  },

  /**
   * Кэшировать цены
   */
  cachePrices(prices) {
    const data = {
      prices,
      timestamp: Date.now()
    };
    try {
      localStorage.setItem(this.CACHE_KEY, JSON.stringify(data));
    } catch (e) { /* quota exceeded */ }
  },

  /**
   * Получить закэшированные цены
   */
  getCachedPrices() {
    try {
      const data = JSON.parse(localStorage.getItem(this.CACHE_KEY));
      if (!data) return null;
      
      // Проверить TTL
      if (Date.now() - data.timestamp > this.CACHE_TTL) {
        return null;
      }
      
      return data.prices;
    } catch (e) {
      return null;
    }
  },

  /**
   * Инициализация
   */
  init() {
    // Предзагрузить страницы навигации после небольшой задержки
    // чтобы не мешать загрузке текущей страницы
    if ('requestIdleCallback' in window) {
      requestIdleCallback(() => this.preloadNavLinks());
    } else {
      setTimeout(() => this.preloadNavLinks(), 1000);
    }
  }
};

// Автозапуск
document.addEventListener('DOMContentLoaded', () => Prefetch.init());
