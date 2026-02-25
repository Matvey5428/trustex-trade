/**
 * app.js - Главное приложение
 */

// Используем текущий домен для API (работает и на localhost и на production)
const API_BASE = window.location.origin + '/api';

// Инициализация по Telegram WebApp
const tg = window.Telegram?.WebApp;

if (tg) {
  try {
    tg.ready();
    tg.expand();
  } catch (e) {
    console.warn('Telegram WebApp initialization error:', e);
  }
}

// ===== ОСНОВНЫЕ ПЕРЕМЕННЫЕ =====
let userId = null;
let currentUser = null;

// ===== ИНИЦИАЛИЗАЦИЯ =====
async function init() {
  try {
    console.log('🚀 Запуск приложения...');
    console.log('📱 Telegram WebApp:', !!tg);
    
    const initData = tg?.initData;
    if (!initData) {
      console.log('⚠️ Нет Telegram initData, показываю экран входа');
      showLoginScreen();
      return;
    }
    
    await createOrGetUser();
    showMainApp();
  } catch (error) {
    console.error('❌ Ошибка инициализации приложения:', error);
    showLoginScreen();
  }
}

async function createOrGetUser() {
  try {
    const response = await fetch(`${API_BASE}/user`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        telegramId: tg.initDataUnsafe?.user?.id || Date.now(),
        firstName: tg.initDataUnsafe?.user?.first_name || 'User'
      })
    });
    
    const data = await response.json();
    if (data.success) {
      userId = data.data.id;
      currentUser = data.data;
      loadProfile();
    }
  } catch (error) {
    console.error('Error creating user:', error);
  }
}

// ===== UI ФУНКЦИИ =====

function showLoginScreen() {
  document.body.innerHTML = `
    <div style="background: #060b1a; color: #fff; min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 20px;">
      <div style="text-align: center;">
        <h1 style="font-size: 48px; margin: 0;">💼</h1>
        <h2>Nexo Trade</h2>
        <p>Открой через Telegram бота</p>
      </div>
    </div>
  `;
}

function showMainApp() {
  document.body.innerHTML = `
    <div style="background: #060b1a; color: #fff; min-height: 100vh; font-family: Arial, sans-serif;">
      <div id="app-content" style="max-width: 500px; margin: 0 auto; padding: 20px 15px 100px;">
        <!-- Контент будет загружен здесь -->
      </div>
      
      <!-- Bottom Navigation -->
      <div style="position: fixed; bottom: 0; left: 0; right: 0; background: #162447; border-top: 1px solid rgba(255,255,255,0.1); display: flex; justify-content: space-around; padding: 10px; z-index: 100;">
        <button onclick="showDashboard()" style="background: none; border: none; color: #9fb3ff; cursor: pointer; flex: 1; padding: 10px; font-size: 13px;">📊 Главная</button>
        <button onclick="showDeposit()" style="background: none; border: none; color: #9fb3ff; cursor: pointer; flex: 1; padding: 10px; font-size: 13px;">💰 Депозит</button>
        <button onclick="showWithdraw()" style="background: none; border: none; color: #9fb3ff; cursor: pointer; flex: 1; padding: 10px; font-size: 13px;">💸 Вывод</button>
        <button onclick="showAnalytics()" style="background: none; border: none; color: #9fb3ff; cursor: pointer; flex: 1; padding: 10px; font-size: 13px;">📈 Аналитика</button>
      </div>
    </div>
  `;
  
  showDashboard();
}

async function loadProfile() {
  try {
    const response = await fetch(`${API_BASE}/profile/${userId}`);
    const data = await response.json();
    if (data.success) {
      currentUser = data.data;
    }
  } catch (error) {
    console.error('Error loading profile:', error);
  }
}

// ===== ЭКРАНЫ =====

async function showDashboard() {
  if (!userId) return;
  
  const profileRes = await fetch(`${API_BASE}/profile/${userId}`);
  const profile = await profileRes.json();
  
  const statsRes = await fetch(`${API_BASE}/statistics/${userId}`);
  const stats = await statsRes.json();
  
  const p = profile.data;
  const s = stats.data;
  
  let html = `
    <div style="background: #162447; border-radius: 15px; padding: 20px; margin-bottom: 15px;">
      <h5 style="margin-bottom: 10px;">Ваш баланс</h5>
      <div style="font-size: 32px; font-weight: bold; color: #4db8ff; margin: 20px 0;">
        ${parseFloat(p.wallets.USDT.balance).toFixed(2)} USDT
      </div>
    </div>
    
    <div style="background: #162447; border-radius: 15px; padding: 20px; margin-bottom: 15px;">
      <h5 style="margin-bottom: 15px;">Статистика</h5>
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px;">
        <div style="background: #2b3e75; padding: 15px; border-radius: 10px;">
          <div style="color: #9fb3ff; font-size: 12px;">Сделок</div>
          <div style="font-size: 20px; font-weight: bold;">${s.totalTrades}</div>
        </div>
        <div style="background: #2b3e75; padding: 15px; border-radius: 10px;">
          <div style="color: #9fb3ff; font-size: 12px;">Успешных</div>
          <div style="font-size: 20px; font-weight: bold; color: #00ff88;">${s.successfulTrades}</div>
        </div>
      </div>
    </div>
  `;
  
  document.getElementById('app-content').innerHTML = html;
}

async function showDeposit() {
  let html = `
    <div style="background: #162447; border-radius: 15px; padding: 20px;">
      <h5 style="margin-bottom: 15px;">Пополнить счет</h5>
      <input type="number" id="depositAmount" placeholder="Сумма USDT" 
             style="width: 100%; padding: 12px; background: #2b3e75; border: 1px solid #4db8ff; 
                    border-radius: 10px; color: #fff; margin-bottom: 15px; font-size: 16px;">
      <button onclick="submitDeposit()" 
              style="width: 100%; padding: 12px; background: #2ea354; border: none; 
                     border-radius: 10px; color: white; font-weight: bold; cursor: pointer;">
        💰 Создать заявку
      </button>
    </div>
  `;
  
  document.getElementById('app-content').innerHTML = html;
}

async function submitDeposit() {
  const amount = parseFloat(document.getElementById('depositAmount').value);
  if (!amount || amount <= 0) {
    alert('Укажи сумму');
    return;
  }
  
  try {
    const response = await fetch(`${API_BASE}/transactions/deposit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId,
        amount,
        currency: 'USDT'
      })
    });
    
    const data = await response.json();
    if (data.success) {
      alert(`✅ Заявка создана на ${amount} USDT`);
      document.getElementById('depositAmount').value = '';
    } else {
      alert('❌ ' + data.error);
    }
  } catch (error) {
    alert('Ошибка: ' + error.message);
  }
}

async function showWithdraw() {
  let html = `
    <div style="background: #162447; border-radius: 15px; padding: 20px;">
      <h5 style="margin-bottom: 15px;">Вывести денежные средства</h5>
      <input type="number" id="withdrawAmount" placeholder="Сумма USDT" 
             style="width: 100%; padding: 12px; background: #2b3e75; border: 1px solid #4db8ff; 
                    border-radius: 10px; color: #fff; margin-bottom: 15px; font-size: 16px;">
      <button onclick="submitWithdraw()" 
              style="width: 100%; padding: 12px; background: #d93044; border: none; 
                     border-radius: 10px; color: white; font-weight: bold; cursor: pointer;">
        💸 Запросить вывод
      </button>
    </div>
  `;
  
  document.getElementById('app-content').innerHTML = html;
}

async function submitWithdraw() {
  const amount = parseFloat(document.getElementById('withdrawAmount').value);
  if (!amount || amount <= 0) {
    alert('Укажи сумму');
    return;
  }
  
  try {
    const response = await fetch(`${API_BASE}/transactions/withdraw`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId,
        amount,
        currency: 'USDT'
      })
    });
    
    const data = await response.json();
    if (data.success) {
      alert(`✅ Запрос на вывод ${amount} USDT создан`);
      document.getElementById('withdrawAmount').value = '';
    } else {
      alert('❌ ' + data.error);
    }
  } catch (error) {
    alert('Ошибка: ' + error.message);
  }
}

async function showAnalytics() {
  const dayRes = await fetch(`${API_BASE}/analytics/${userId}/day`);
  const day = await dayRes.json();
  
  const d = day.data || {};
  
  let html = `
    <div style="background: #162447; border-radius: 15px; padding: 20px;">
      <h5 style="margin-bottom: 15px;">📊 Аналитика за день</h5>
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px;">
        <div style="background: #2b3e75; padding: 15px; border-radius: 10px;">
          <div style="color: #9fb3ff; font-size: 12px;">Объем</div>
          <div style="font-size: 18px; font-weight: bold;">${(d.totalVolume || 0).toFixed(2)} $</div>
        </div>
        <div style="background: #2b3e75; padding: 15px; border-radius: 10px;">
          <div style="color: #9fb3ff; font-size: 12px;">Win Rate</div>
          <div style="font-size: 18px; font-weight: bold;">${d.winRate || 0}%</div>
        </div>
      </div>
    </div>
  `;
  
  document.getElementById('app-content').innerHTML = html;
}

// Инициализация при загрузке
window.addEventListener('load', init);

// Глобальный обработчик ошибок
window.addEventListener('error', (event) => {
  console.error('❌ Глобальная ошибка:', event.error);
  // Не даём ошибкам ломать приложение
  event.preventDefault();
});

// Обработчик unhandled promise rejections
window.addEventListener('unhandledrejection', (event) => {
  console.error('❌ Unhandled Promise Rejection:', event.reason);
  event.preventDefault();
});
