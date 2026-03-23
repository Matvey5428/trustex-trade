/**
 * balance.js - Universal Balance Display
 * Загружает актуальные курсы с сервера и отображает баланс на всех страницах.
 * Единый источник правды для конвертации валют.
 */

const BalanceManager = {
  // Серверные курсы (загружаются при init, обновляются при каждом refresh)
  _rates: null,
  // Кэш-ключ
  _RATES_KEY: 'nexo_exchange_rates',

  formatNumber(num, decimals = 2) {
    return num.toLocaleString('ru-RU', { minimumFractionDigits: decimals, maximumFractionDigits: decimals }).replace(/,/g, '.');
  },

  /** Загрузить курсы с сервера или из кэша */
  async loadRates() {
    // Если загружены менее 60 сек назад — не дёргать снова
    if (this._rates && this._rates.ts && Date.now() - this._rates.ts < 60_000) return this._rates;
    // Попробуем кэш
    try {
      const cached = JSON.parse(localStorage.getItem(this._RATES_KEY) || 'null');
      if (cached && cached.ts && Date.now() - cached.ts < 5 * 60 * 1000) {
        this._rates = cached;
        return cached;
      }
    } catch(e) {}
    // Запрос к серверу
    try {
      const res = await fetch('/api/exchange/rate');
      if (res.ok) {
        const payload = await res.json();
        if (payload.data) {
          this._rates = {
            rub_to_usdt: payload.data.rub_to_usdt,
            usdt_to_rub: payload.data.usdt_to_rub,
            eur_to_usdt: payload.data.eur_to_usdt,
            usdt_to_eur: payload.data.usdt_to_eur,
            byn_to_usdt: payload.data.byn_to_usdt,
            usdt_to_byn: payload.data.usdt_to_byn,
            BTC: payload.data.rates?.BTC || 0,
            ETH: payload.data.rates?.ETH || 0,
            TON: payload.data.rates?.TON || 0,
            ts: Date.now()
          };
          localStorage.setItem(this._RATES_KEY, JSON.stringify(this._rates));
          return this._rates;
        }
      }
    } catch(e) {}
    // Fallback: кэш без ограничения по времени
    try {
      const cached = JSON.parse(localStorage.getItem(this._RATES_KEY) || 'null');
      if (cached) { this._rates = cached; return cached; }
    } catch(e) {}
    // Жёсткий fallback
    this._rates = { rub_to_usdt: 0.012, usdt_to_rub: 83.33, eur_to_usdt: 1.089, usdt_to_eur: 0.9183, byn_to_usdt: 0.3058, usdt_to_byn: 3.27, BTC: 84000, ETH: 3200, TON: 3.5, ts: 0 };
    return this._rates;
  },

  /** Получить курсы — если ещё не загружены async, попробовать синхронно из кэша */
  _ensureRates() {
    if (this._rates) return this._rates;
    try {
      const cached = JSON.parse(localStorage.getItem(this._RATES_KEY) || 'null');
      if (cached && cached.rub_to_usdt) {
        // Добавить BYN поля если отсутствуют (старый кэш)
        if (!cached.byn_to_usdt) { cached.byn_to_usdt = 0.3058; cached.usdt_to_byn = 3.27; }
        this._rates = cached; return cached;
      }
    } catch(e) {}
    // Жёсткий fallback
    return { rub_to_usdt: 0.012, usdt_to_rub: 83.33, eur_to_usdt: 1.089, usdt_to_eur: 0.9183, byn_to_usdt: 0.3058, usdt_to_byn: 3.27, BTC: 84000, ETH: 3200, TON: 3.5, ts: 0 };
  },

  /** Конвертировать RUB в USDT (≈ USD) */
  rubToUsd(rubAmount) {
    const r = this._ensureRates();
    return rubAmount * (r.rub_to_usdt || 0.012);
  },
  /** Конвертировать EUR в USDT (≈ USD) */
  eurToUsd(eurAmount) {
    const r = this._ensureRates();
    return eurAmount * (r.eur_to_usdt || 1.089);
  },
  /** Конвертировать BYN в USDT (≈ USD) */
  bynToUsd(bynAmount) {
    const r = this._ensureRates();
    return bynAmount * (r.byn_to_usdt || 0.3058);
  },
  /** Получить крипто-цену в USDT */
  cryptoPrice(currency) {
    const r = this._ensureRates();
    return r[currency] || 0;
  },

  async init() {
    try {
      // Загрузить курсы первым делом
      await this.loadRates();

      if (!TelegramAuth.isAuthenticated()) {
        await TelegramAuth.login();
      } else {
        await TelegramAuth.refreshUser();
      }
      const user = window.CURRENT_USER || TelegramAuth.getCurrentUser();
      if (!user) return;
      this.updateBalanceElements(user);
    } catch (error) {
      // Silent fail
    }
  },

  updateBalanceElements(user) {
    const b = (f) => parseFloat(user['balance_' + f] ?? user[f]) || 0;
    const balanceUsdt = b('usdt');
    const balanceBtc = b('btc');
    const balanceRub = b('rub');
    const balanceEur = b('eur');
    const balanceByn = b('byn');
    const balanceTon = b('ton');
    const balanceEth = b('eth');

    // Конвертация в USD через серверные курсы (только USDT+RUB+EUR+BYN — без BTC/ETH/TON)
    const rubInUsd = this.rubToUsd(balanceRub);
    const eurInUsd = this.eurToUsd(balanceEur);
    const bynInUsd = this.bynToUsd(balanceByn);
    const totalUsd = balanceUsdt + rubInUsd + eurInUsd + bynInUsd;

    const fmt = this.formatNumber.bind(this);
    // НЕ пишем в totalBalance / total-balance — каждая страница считает общий
    // баланс самостоятельно (index.html учитывает BTC/ETH/TON по рыночным ценам,
    // wallet.html тоже). balance.js обновляет только отдельные валютные элементы.
    const updates = {
      'userUsdtBalance': `${fmt(balanceUsdt)} USDT`,
      'usdt-balance': `${fmt(balanceUsdt)} USDT`,
      'balanceUsdt': `${fmt(balanceUsdt)}`,
      'bal-USDT': `${fmt(balanceUsdt)} USDT`,
      'usdtBalance': `${fmt(balanceUsdt)} $`,
      'userBtcBalance': `${fmt(balanceBtc, 8)} BTC`,
      'btc-balance': `${fmt(balanceBtc, 8)} BTC`,
      'balanceBtc': `${fmt(balanceBtc, 8)}`,
      'bal-BTC': `${fmt(balanceBtc, 8)} BTC`,
      'btcBalance': `${fmt(balanceBtc, 8)} $`,
      'userRubBalance': `${fmt(balanceRub)} ₽`,
      'rub-balance': `${fmt(balanceRub)} ₽`,
      'balanceRub': `${fmt(balanceRub)}`,
      'bal-RUB': `${fmt(balanceRub)} ₽`,
      'rubBalance': `${fmt(balanceRub)} ₽`,
      'bal-EUR': `${fmt(balanceEur)} €`,
      'eurBalance': `${fmt(balanceEur)} €`,
      'balanceEur': `${fmt(balanceEur)}`,
      'bal-BYN': `${fmt(balanceByn)} Br`,
      'bynBalance': `${fmt(balanceByn)} Br`,
      'balanceByn': `${fmt(balanceByn)}`,
      'userBynBalance': `${fmt(balanceByn)} Br`,
      'bal-TON': `${fmt(balanceTon, 4)} TON`,
      'tonBalance': `${fmt(balanceTon, 4)} $`,
      'bal-ETH': `${fmt(balanceEth, 6)} ETH`,
      'ethBalance': `${fmt(balanceEth, 6)} $`,
      'available-balance': `${fmt(balanceUsdt)} USDT`,
      'availableBalance': `${fmt(balanceUsdt)} USDT`,
      'rubBalanceText': `${fmt(balanceRub)} ₽`,
      'usdtBalanceText': `${fmt(balanceUsdt)} $`,
    };

    for (const [id, value] of Object.entries(updates)) {
      const el = document.getElementById(id);
      if (el) {
        el.textContent = value;
        el.classList.remove('skeleton');
        el.classList.add('loaded');
      }
    }

    window.USER_BALANCES = {
      usdt: balanceUsdt,
      btc: balanceBtc,
      rub: balanceRub,
      eur: balanceEur,
      byn: balanceByn,
      ton: balanceTon,
      eth: balanceEth,
      totalUsd: totalUsd,
      min_deposit: parseFloat(user.min_deposit) || 0,
      min_withdraw: parseFloat(user.min_withdraw) || 0,
      min_withdraw_rub: parseFloat(user.min_withdraw_rub) || 0,
      min_withdraw_byn: parseFloat(user.min_withdraw_byn) || 0
    };
  },

  getUsdtBalance() {
    return window.USER_BALANCES?.usdt || 0;
  },
  getTotalBalance() {
    return window.USER_BALANCES?.totalUsd || 0;
  },
  /** Получить актуальные курсы (для использования из других страниц) */
  getRates() {
    return this._ensureRates();
  },

  async refresh() {
    try {
      // Обновить курсы при каждом refresh
      await this.loadRates();
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
document.addEventListener('DOMContentLoaded', async () => {
  // Загрузить курсы первым делом (из кэша — мгновенно)
  await BalanceManager.loadRates();

  // index.html и wallet.html управляют своим балансом сами —
  // balance.js на этих страницах нужен только ради rubToUsd/eurToUsd
  const p = window.location.pathname;
  if (p === '/' || p === '/index.html' || p === '/wallet.html') return;

  // На остальных страницах — показать кэш мгновенно и обновить с сервера
  const cachedUser = TelegramAuth.getCurrentUser();
  if (cachedUser) {
    BalanceManager.updateBalanceElements(cachedUser);
  }
  BalanceManager.init();
});
