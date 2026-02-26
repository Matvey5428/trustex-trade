# 🏗️ BACKEND ARCHITECTURE PLAN - Nexo Trade

## 📊 **ПРОЕКТ СТРУКТУРА**

```
backend/
├── src/
│   ├── config/
│   │   ├── database.js          # Подключение к PostgreSQL
│   │   └── constants.js          # Константы приложения
│   │
│   ├── middlewares/
│   │   ├── auth.js               # Проверка JWT токена
│   │   ├── errorHandler.js       # Глобальный обработчик ошибок
│   │   ├── rateLimit.js          # Rate limiting
│   │   └── validator.js          # Валидация данных
│   │
│   ├── routes/
│   │   ├── auth.js               # POST /api/auth/verify
│   │   ├── profile.js            # GET /api/profile
│   │   ├── orders.js             # /api/orders (CREATE, LIST, CLOSE)
│   │   ├── transactions.js       # GET /api/transactions
│   │   ├── deposits.js           # /api/deposits (REQUEST, LIST)
│   │   ├── withdraws.js          # /api/withdraws (REQUEST, LIST)
│   │   ├── admin.js              # /api/admin/* (админ-функции)
│   │   └── index.js              # Объединение всех маршрутов
│   │
│   ├── controllers/
│   │   ├── authController.js     # Логика авторизации
│   │   ├── profileController.js  # Профиль пользователя
│   │   ├── orderController.js    # Логика ордеров
│   │   ├── transactionController.js
│   │   ├── depositController.js
│   │   ├── withdrawController.js
│   │   └── adminController.js
│   │
│   ├── services/
│   │   ├── authService.js        # Проверка initData + подпись
│   │   ├── userService.js        # Работа с пользователями
│   │   ├── orderService.js       # Бизнес-логика ордеров
│   │   ├── balanceService.js     # Работа с балансом
│   │   ├── transactionService.js # История транзакций
│   │   ├── settingsService.js    # Системные настройки
│   │   └── adminService.js       # Админские операции
│   │
│   ├── utils/
│   │   ├── telegramAuth.js       # HMAC-SHA256 проверка initData
│   │   ├── errors.js             # Кастомные ошибки
│   │   ├── validators.js         # Валидаторы данных
│   │   └── logger.js             # Логирование
│   │
│   ├── database/
│   │   ├── migrations/           # SQL миграции
│   │   └── schemas.sql           # Создание таблиц
│   │
│   └── app.js                    # Инициализация Express
│
├── .env                          # Переменные окружения
├── .env.example
├── index.js                      # Entry point
└── package.json
```

---

## 🔐 **FLOW АВТОРИЗАЦИИ**

```
Frontend (Telegram Mini App)
    ↓
    GET initData из Telegram.WebApp.initData
    ↓
    POST /api/auth/verify { initData }
    ↓
Backend (authController.js)
    ↓
    authService.verifyInitData(initData, BOT_TOKEN)
        → Проверить HMAC-SHA256 подпись
        → Раскодировать initData
        → Извлечь telegram_id
    ↓
    Проверить в БД: EXISTS user WHERE telegram_id = ?
        ↓ Да (пользователь существует)
        → Проверить status != 'blocked'
        → Генерить JWT токен
        → Вернуть {token, user}
        ↓
        ↓ Нет (первый вход)
        → userService.createUser({telegram_id, username, ...})
        → Генерить JWT токен
        → Вернуть {token, user}
    ↓
Frontend
    ↓
    Сохранить токен в localStorage
    GET /api/profile (с Authorization: Bearer {token})
    ↓
    Показать интерфейс
```

---

## 💰 **БАЛАНСОВАЯ ЛОГИКА**

### Структура баланса:
```
users
├── balance_usdt (numeric, default 0)
├── balance_btc  (numeric, default 0)
└── balance_rub  (numeric, default 0)
```

### Все изменения ТОЛЬКО через транзакции:
```
transactions
├── user_id (FK → users.id)
├── type: 'order_freeze' | 'order_win' | 'order_lose' | 
          'deposit' | 'withdraw' | 'admin_adjust'
├── amount (positive)
├── currency ('USDT' | 'BTC' | 'RUB')
└── created_at
```

### Правила:
1. **Баланс не может уходить в минус** ✗
2. **Проверка перед each operation**: `SELECT balance WHERE user_id = ?`
3. **Atomicity**: все операции в одной транзакции БД

---

## 📈 **ЛОГИКА ОРДЕРОВ (Binary Options)**

### Этап 1: Создание ордера
```
POST /api/orders
{
  "amount": 100,          // USDT
  "direction": "up",      // или "down"
  "duration": 300         // секунды (5min)
}
```

Действия:
1. Проверить баланс USDT >= amount
2. CREATE order: status = 'active', expires_at = NOW() + duration
3. FREEZE баланс:
   - transactions.insert(type='order_freeze', amount)
   - users.update(balance_usdt -= amount)

---

### Этап 2: Ожидание истечения времени
```
Cron Job (каждые 10 сек):
  SELECT * FROM orders WHERE status = 'active' AND expires_at <= NOW()
  ↓
  UPDATE orders SET status = 'resolving'
```

---

### Этап 3: Определение результата и закрытие

```
POST /api/admin/orders/:id/resolve или AUTO
1. GET system_settings WHERE key = 'order_mode'
   Возможные mode:
   - 'all_win'   → всегда выигрыш
   - 'all_lose'  → всегда проигрыш
   - 'random'    → зависит от win_rate

2. Если mode = 'random':
   - GET system_settings WHERE key = 'win_rate' (0-100)
   - result = random(0-100) < win_rate ? 'win' : 'lose'
   - else:
   - result = mode === 'all_win' ? 'win' : 'lose'

3. Обработка результата:
   IF result = 'win':
     - Вернуть заморозку: +amount
     - Начислить прибыль: +amount (x2)
     - transactions.insert(type='order_win', amount * 2)
   
   IF result = 'lose':
     - Заморозка уже списана
     - Ничего не начисляем
     - transactions.insert(type='order_lose', amount)

4. UPDATE orders SET status = 'closed', result = :result

5. Повторное закрытие НЕВОЗМОЖНО (проверка в коде)
```

---

## 📋 **API ENDPOINTS**

### AUTH
```
POST /api/auth/verify
  Body: { initData }
  Response: { token, user: { id, telegram_id, balance_usdt, ... } }
```

### PROFILE
```
GET /api/profile                    # Данные пользователя
GET /api/profile/balance            # Текущий баланс
```

### ORDERS
```
POST   /api/orders                  # Создать ордер
GET    /api/orders                  # Активные ордеры
GET    /api/orders/history          # История ордеров (paginated)
GET    /api/orders/:id              # Детали ордера
```

### TRANSACTIONS
```
GET    /api/transactions            # Все транзакции
GET    /api/transactions?type=deposit
```

### DEPOSITS
```
POST   /api/deposits/request        # Создать запрос депозита
GET    /api/deposits/requests       # Мои запросы
```

### WITHDRAWS
```
POST   /api/withdraws/request       # Создать запрос вывода
GET    /api/withdraws/requests      # Мои запросы
```

### ADMIN
```
GET    /api/admin/system-settings   # Получить все настройки
POST   /api/admin/system-settings   # Обновить настройку
POST   /api/admin/users/:id/block   # Заблокировать пользователя
POST   /api/admin/orders/:id/resolve  # Закрыть ордер с результатом
POST   /api/admin/deposits/:id/approve
POST   /api/admin/withdraws/:id/approve
```

---

## 🗄️ **SQL SCHEMA**

### users
```sql
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  telegram_id BIGINT UNIQUE NOT NULL,
  username VARCHAR(255),
  balance_usdt NUMERIC(18,8) DEFAULT 0,
  balance_btc NUMERIC(18,8) DEFAULT 0,
  balance_rub NUMERIC(18,8) DEFAULT 0,
  verified BOOLEAN DEFAULT FALSE,
  status VARCHAR(20) DEFAULT 'active',  -- active | blocked
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
```

### orders
```sql
CREATE TABLE orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount NUMERIC(18,8) NOT NULL,
  direction VARCHAR(10) NOT NULL,  -- up | down
  duration INTEGER NOT NULL,        -- seconds
  status VARCHAR(20) DEFAULT 'active',  -- active | resolving | closed
  result VARCHAR(20),               -- win | lose | null (при active)
  created_at TIMESTAMP DEFAULT NOW(),
  expires_at TIMESTAMP NOT NULL,
  closed_at TIMESTAMP,
  
  INDEX idx_user_status (user_id, status),
  INDEX idx_expires_at (expires_at)
);
```

### transactions
```sql
CREATE TABLE transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  order_id UUID REFERENCES orders(id),
  type VARCHAR(50) NOT NULL,  -- order_freeze, order_win, order_lose, deposit, withdraw
  amount NUMERIC(18,8) NOT NULL,
  currency VARCHAR(10) NOT NULL,  -- USDT, BTC, RUB
  created_at TIMESTAMP DEFAULT NOW(),
  
  INDEX idx_user_created (user_id, created_at)
);
```

### system_settings
```sql
CREATE TABLE system_settings (
  key VARCHAR(100) PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Инициализация настроек
INSERT INTO system_settings VALUES
  ('order_mode', 'random'),
  ('win_rate', '50');
```

### deposit_requests, withdraw_requests
```sql
CREATE TABLE deposit_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id),
  amount NUMERIC(18,8) NOT NULL,
  status VARCHAR(20) DEFAULT 'pending',  -- pending | approved | rejected
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE withdraw_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id),
  amount NUMERIC(18,8) NOT NULL,
  wallet VARCHAR(255),
  status VARCHAR(20) DEFAULT 'pending',
  created_at TIMESTAMP DEFAULT NOW()
);
```

---

## 🛡️ **БЕЗОПАСНОСТЬ**

1. **Telegram initData проверка**
   - Подпись HMAC-SHA256 с BOT_TOKEN
   - Проверка timestamp (не старше 5 мин)

2. **JWT токены**
   - Подписаны с SECRET_KEY
   - TTL: 7 дней
   - Содержат: user_id, telegram_id

3. **Rate limiting**
   - 100 req/min per IP
   - 1000 req/hour per user

4. **Валидация данных**
   - Все amount > 0
   - Все user_id из JWT (не из body)

---

## 🚀 **ПОРЯДОК РАЗРАБОТКИ**

1. ✅ **Фронтенд готов**: auth.js, api.js
2. **Phase 1**: Подготовка окружения, БД, структура
3. **Phase 2**: Авторизация
4. **Phase 3**: Балансовая система
5. **Phase 4**: Ордеры + закрытие
6. **Phase 5**: Депозиты/выводы  
7. **Phase 6**: Админ-функции
8. **Testing & Deploy**

---

## 📝 **FRONTEND ГОТОВ**

✅ `/js/auth.js` - система авторизации
✅ `/js/api.js` - HTTP клиент с автоматическим токеном
✅ `/index.html` - инициализация через TelegramAuth.login()

**Фронтенд отправляет:**
- `POST /api/auth/verify` с initData
- Все запросы с `Authorization: Bearer {token}`
- Обрабатывает 401 (разлогирование при истечении)

**Фронтенд готов получать:**
- `{ token, user }` от `/api/auth/verify`
- Профиль от `/api/profile`
- Ордеры от `/api/orders`
- И всё остальное...

---

Готово к разработке backend! 🚀
