# 🎨 FRONTEND STRUCTURE - Nexo Trade

## 📁 Файлы фронтенда

```
public/
├── index.html           # Главная страница (подготовлена)
├── deposit.html         # Пополнение баланса
├── exchange.html        # Обмен валют  
├── terminal.html        # Торговый терминал
├── trading.html         # Список пар
├── reviews.html         # Отзывы
├── withdraw.html        # Вывод средств
├── app.js              # Фронтенд скрипты (не backend)
│
└── js/                  # 🆕 Новые скрипты для авторизации
    ├── auth.js          # Система авторизации через Telegram
    └── api.js           # HTTP клиент для всех API запросов
```

---

## 🔐 **КАК РАБОТАЕТ АВТОРИЗАЦИЯ**

### 1️⃣ Инициализация (при загрузке страницы)

```javascript
// Автоматически при DOMContentLoaded в index.html:

if (!TelegramAuth.isAuthenticated()) {
  await TelegramAuth.login();  // Отправить initData на backend
} else {
  // Пользователь уже авторизован
}
```

### 2️⃣ `TelegramAuth.login()` - что происходит:

```javascript
1. TelegramAuth.getInitData()
   → window.Telegram.WebApp.initData

2. POST /api/auth/verify { initData }
   ↓
   Backend проверяет подпись initData
   ↓
   Возвращает { token, user }

3. Сохранить:
   - localStorage['nexo_auth_token'] = token
   - localStorage['nexo_user_data'] = JSON.stringify(user)
   - window.AUTH_TOKEN = token
   - window.CURRENT_USER = user
```

### 3️⃣ Все последующие API запросы

```javascript
// Автоматически добавляется заголовок:
Authorization: Bearer {token}

// Пример:
const profile = await API.get('/profile');
// Под капотом:
// GET /api/profile
// Headers: { Authorization: 'Bearer eyJhbGc...' }
```

---

## 📚 **Как использовать API**

### AUTH

```javascript
// Авторизация (автоматическая при загрузке)
await TelegramAuth.login();

// Получить текущего пользователя
const user = TelegramAuth.getCurrentUser();
// { id, telegram_id, username, balance_usdt, ... }

// Проверить авторизацию
if (TelegramAuth.isAuthenticated()) { ... }

// Выйти из системы
TelegramAuth.logout();
```

### PROFILE

```javascript
// Получить профиль
const profile = await API.profile.get();
// { id, telegram_id, username, balance_usdt, balance_btc, ... }

// Получить баланс
const balance = await API.profile.balance();
// { balance_usdt, balance_btc, balance_rub }
```

### ORDERS

```javascript
// Создать ордер
await API.orders.create(
  amount = 100,      // USDT
  direction = 'up',  // или 'down'
  duration = 300     // 5 минут
);

// Получить активные ордеры
const active = await API.orders.list();

// История ордеров (paginated)
const history = await API.orders.history(page=1, limit=20);

// Деталь ордера
const order = await API.orders.get(orderId);
```

### TRANSACTIONS

```javascript
// Все транзакции
const txs = await API.transactions.list();

// Только депозиты
const deposits = await API.transactions.byType('deposit');
// type: 'order_freeze' | 'order_win' | 'order_lose' | 'deposit' | 'withdraw'
```

### DEPOSITS

```javascript
// Создать запрос депозита
await API.deposits.request(amount = 100);

// Мои запросы
const requests = await API.deposits.listRequests();
// { id, amount, status: 'pending|approved|rejected', created_at }
```

### WITHDRAWS

```javascript
// Создать запрос вывода
await API.withdraws.request(amount = 50, wallet = '4276...0000');

// Мои запросы
const requests = await API.withdraws.listRequests();
```

---

## ⚠️ **ОБРАБОТКА ОШИБОК**

```javascript
try {
  const result = await API.get('/some-endpoint');
} catch (error) {
  if (error.status === 401) {
    // Сессия истекла - пользователь разлогирован
    console.log('Session expired');
  } else if (error.status === 403) {
    // Доступ запрещён
    console.log('Access denied');
  } else if (error.status === 429) {
    // Rate limit - слишком много запросов
    console.log('Too many requests');
  } else {
    // Другие ошибки
    console.error(error.message);
  }
}
```

**AUTO-LOGOUT на 401:**
```javascript
// Если backend вернул 401, API клиент:
// 1. Разлогирует пользователя (TelegramAuth.logout())
// 2. Перенаправляет на главную страницу
```

---

## 🧪 **ОТЛАДКА**

Откройте консоль браузера (F12 → Console) и смотрите логи:

```javascript
🚀 Initializing Nexo Trade...
🔄 Sending auth request to backend...
✅ initData found: (data)
✅ telegram_id: 12345678
✅ Logged in as: username
✅ Init complete
```

**DEBUG INFO на странице:**
```
DEBUG INFO
─────────────
Telegram ID: 123456789 ✅ реальный
User ID: 550e8400-e29b-41d4-a716-446655440000
Статус: ✅ авторизован
```

---

## 🔧 **ИЗМЕНЕНИЯ В ДРУГИХ HTML ФАЙЛАХ**

Все HTML файлы (deposit.html, exchange.html и т.д.) нужно обновить:

### 1️⃣ Добавить подключение скриптов в `<head>` или перед `</body>`:

```html
<script src="/js/auth.js"></script>
<script src="/js/api.js"></script>
```

### 2️⃣ В каждом файле при загрузке проверить авторизацию:

```javascript
document.addEventListener('DOMContentLoaded', async () => {
  try {
    // Убедиться, что пользователь авторизован
    const user = TelegramAuth.getCurrentUser();
    if (!user) {
      console.error('Not authenticated');
      window.location.href = '/';
      return;
    }
    
    // Загрузить данные страницы
    await loadPageData();
  } catch (error) {
    console.error('Init error:', error);
  }
});
```

### 3️⃣ Все API вызовы через `API.*`:

```javascript
// ❌ Старый способ:
fetch('/api/profile')

// ✅ Новый способ:
const profile = await API.profile.get();
```

---

## ✅ **CHECKLIST ДЛЯ ФРОНТЕНДА**

- ✅ `/js/auth.js` - система авторизации
- ✅ `/js/api.js` - HTTP клиент
- ✅ `index.html` - обновлен на новую авторизацию
- ⏳ `deposit.html` - обновить подключение скриптов
- ⏳ `exchange.html` - обновить подключение скриптов
- ⏳ `terminal.html` - обновить подключение скриптов
- ⏳ `trading.html` - обновить подключение скриптов
- ⏳ `reviews.html` - обновить подключение скриптов
- ⏳ `withdraw.html` - обновить подключение скриптов

---

## 🚀 **ГОТОВНОСТЬ**

✅ Фронтенд полностью готов к backend разработке!

Все скрипты настроены и готовы автоматически:
1. Проверять авторизацию
2. Отправлять initData при первом входе
3. Добавлять токен ко всем запросам
4. Обрабатывать ошибки авторизации
5. Разлогиваться при истечении сессии

**Backend может начать разработку! 🎉**
