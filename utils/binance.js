/**
 * utils/binance.js
 * Интеграция с Binance API для получения курсов обмена
 * Использует публичный API без аутентификации
 */

const https = require('https');

class BinanceClient {
  constructor() {
    this.baseUrl = 'api.binance.com';
    this.cache = new Map();
    this.cacheExpire = 60 * 1000; // 1 минута
  }

  /**
   * Делает HTTPS запрос к Binance API
   * @param {string} path - Путь API
   * @returns {Promise<object>} Результат запроса
   */
  makeRequest(path) {
    return new Promise((resolve, reject) => {
      const options = {
        hostname: this.baseUrl,
        path,
        method: 'GET',
      };

      const req = https.request(options, (res) => {
        let data = '';

        res.on('data', (chunk) => {
          data += chunk;
        });

        res.on('end', () => {
          try {
            resolve(JSON.parse(data));
          } catch (error) {
            reject(new Error('Ошибка парсинга ответа от Binance'));
          }
        });
      });

      req.on('error', (error) => {
        reject(error);
      });

      req.end();
    });
  }

  /**
   * Получает курс пары с кешированием
   * @param {string} symbol - Пара (например BTCUSDT)
   * @returns {Promise<number>} Текущий курс
   */
  async getPrice(symbol) {
    const upperSymbol = symbol.toUpperCase();
    const cached = this.cache.get(upperSymbol);

    // Проверяем кеш
    if (cached && Date.now() - cached.time < this.cacheExpire) {
      return cached.price;
    }

    try {
      const data = await this.makeRequest(`/api/v3/ticker/price?symbol=${upperSymbol}`);
      const price = parseFloat(data.price);

      // Сохраняем в кеш
      this.cache.set(upperSymbol, {
        price,
        time: Date.now(),
      });

      return price;
    } catch (error) {
      console.error(`❌ Ошибка получения цены ${upperSymbol}:`, error.message);
      throw error;
    }
  }

  /**
   * Получает актуальные цены для нескольких пар
   * @param {string[]} symbols - Массив пар
   * @returns {Promise<object>} Объект с ценами
   */
  async getPrices(symbols) {
    const prices = {};

    for (const symbol of symbols) {
      try {
        prices[symbol] = await this.getPrice(symbol);
      } catch (error) {
        prices[symbol] = null;
      }
    }

    return prices;
  }

  /**
   * Получает курс обмена между двумя валютами
   * @param {string} fromCurrency - Откуда (BTC, ETH, USDT и т.д.)
   * @param {string} toCurrency - Куда
   * @returns {Promise<number>} Курс обмена
   */
  async getExchangeRate(fromCurrency, toCurrency) {
    if (fromCurrency === toCurrency) {
      return 1;
    }

    // Если это фиатные валюты (RUB, USD и т.д.) - используем фиксированные курсы
    if (this.isFiatCurrency(fromCurrency) || this.isFiatCurrency(toCurrency)) {
      return this.getFiatRate(fromCurrency, toCurrency);
    }

    // Для криптовалют получаем от Binance
    const symbol = `${fromCurrency}${toCurrency}`;
    try {
      return await this.getPrice(symbol);
    } catch (error) {
      console.warn(`Пара ${symbol} не найдена на Binance, используем альтернативный путь`);
      return await this.getIndirectRate(fromCurrency, toCurrency);
    }
  }

  /**
   * Получает косвенный курс (через USDT)
   * @param {string} fromCurrency - Из какой валюты
   * @param {string} toCurrency - В какую валюту
   * @returns {Promise<number>} Курс обмена
   */
  async getIndirectRate(fromCurrency, toCurrency) {
    const fromToUsdt = await this.getPrice(`${fromCurrency}USDT`);
    const usdtToTo = await this.getPrice(`${toCurrency}USDT`);

    if (usdtToTo === 0) {
      throw new Error('Не удалось рассчитать курс');
    }

    return fromToUsdt / usdtToTo;
  }

  /**
   * Проверяет, является ли валюта фиатной
   * @param {string} currency - Код валюты
   * @returns {boolean}
   */
  isFiatCurrency(currency) {
    const fiatCurrencies = ['USD', 'EUR', 'RUB', 'GBP', 'JPY', 'CNY'];
    return fiatCurrencies.includes(currency.toUpperCase());
  }

  /**
   * Получает фиксированный курс для фиатных валют
   * (В реальности здесь должна быть интеграция с другим API)
   * @param {string} from - Из какой валюты
   * @param {string} to - В какую валюту
   * @returns {number} Курс
   */
  getFiatRate(from, to) {
    // Фиксированные курсы для демонстрации
    const rates = {
      'USDRUB': 90,
      'RUBUSD': 1 / 90,
      'USDEUR': 0.92,
      'EURUSD': 1 / 0.92,
    };

    const key = `${from}${to}`.toUpperCase();
    return rates[key] || 1;
  }

  /**
   * Очищает кеш
   */
  clearCache() {
    this.cache.clear();
  }
}

// Создаем и экспортируем единый экземпляр
const binanceClient = new BinanceClient();

module.exports = binanceClient;
