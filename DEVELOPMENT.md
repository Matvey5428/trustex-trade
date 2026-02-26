# 🛠️ DEVELOPMENT GUIDE - Backend Implementation

## 📋 OVERVIEW

Этот документ содержит пошаговые инструкции по разработке backend'а для Nexo Trade.

**Стек технологий:**
- Node.js + Express
- PostgreSQL
- JWT авторизация
- async/await

---

## 🏁 **PHASE 1: SETUP & DATABASE**

### Step 1.1: Инициализация проекта

```bash
npm init -y
npm install express pg dotenv cors uuid
npm install --save-dev nodemon
```

### Step 1.2: Структура папок

```bash
mkdir -p src/{config,middlewares,routes,controllers,services,utils,database}
mkdir -p src/database/migrations
touch src/app.js index.js .env .env.example
```

### Step 1.3: `.env` файл

```env
NODE_ENV=development
PORT=3000

# Telegram Bot
TELEGRAM_BOT_TOKEN=YOUR_BOT_TOKEN_HERE

# JWT Secret
JWT_SECRET=your-super-secret-key-generate-random

# Database
DATABASE_URL=postgresql://user:password@localhost:5432/nexo_trade

# Admin
ADMIN_SECRET=admin-key-for-admin-endpoints
```

### Step 1.4: `package.json` скрипты

```json
"scripts": {
  "start": "node index.js",
  "dev": "nodemon index.js",
  "migrate": "node src/database/migrate.js"
}
```

### Step 1.5: PostgreSQL - Создание БД

```bash
# Подключиться к PostgreSQL
psql -U postgres

# Создать базу
CREATE DATABASE nexo_trade;

# Выполнить миграцию (см. src/database/schemas.sql)
psql -U postgres -d nexo_trade -f src/database/schemas.sql
```

### Step 1.6: SQL Schema (`src/database/schemas.sql`)

Выполнить в PostgreSQL все CREATE TABLE команды согласно BACKEND_PLAN.md

---

## 🔐 **PHASE 2: AUTHENTICATION**

### Step 2.1: Telegram Auth Utils (`src/utils/telegramAuth.js`)

```javascript
// Проверить подпись initData
function verifyInitData(initData, botToken) {
  // HMAC-SHA256 проверка
  // Возвращает: { valid, user }
}

// Раскодировать initData
function parseInitData(initData) {
  // Парсит URLSearchParams и возвращает объект
}
```

### Step 2.2: Auth Service (`src/services/authService.js`)

```javascript
// authService.verifyInitData(initData, botToken)
// authService.createUser({ telegram_id, username, ... })
// authService.generateJWT(user)
// authService.verifyJWT(token)
```

### Step 2.3: Auth Controller (`src/controllers/authController.js`)

```javascript
// POST /api/auth/verify
// - Получить initData
// - Проверить подпись
// - Найти или создать пользователя
// - Возвернуть { token, user }
```

### Step 2.4: Auth Routes (`src/routes/auth.js`)

```javascript
router.post('/verify', authController.verify);
```

### Step 2.5: Auth Middleware (`src/middlewares/auth.js`)

```javascript
// Middleware для проверки JWT токена
// Должен быть добавлен перед всеми protected routes
```

✅ После этого фэйза: `POST /api/auth/verify` должен работать!

---

## 💰 **PHASE 3: BALANCE & TRANSACTIONS**

### Step 3.1: Transaction Service (`src/services/transactionService.js`)

```javascript
// createTransaction({ user_id, type, amount, currency, order_id })
// getTransactions(user_id)
// getTransactionsByType(user_id, type)
```

### Step 3.2: Balance Service (`src/services/balanceService.js`)

```javascript
// checkBalance(user_id, currency, amount)
// getBalance(user_id)
// deductBalance(user_id, currency, amount) // WITH transaction
// addBalance(user_id, currency, amount)    // WITH transaction
// freezeBalance(user_id, order_id, amount) // Для ордеров
```

**ВАЖНАЯ ЛОГИКА:**
- Все изменения баланса ТОЛЬКО через transactionService
- Atomicity: транзакция в БД или ничего
- Проверка: balance >= amount перед операцией

### Step 3.3: Profile Controller (`src/controllers/profileController.js`)

```javascript
// GET /api/profile         → Профиль пользователя
// GET /api/profile/balance → Текущий баланс
```

✅ После этого фэйза: работает система балансов!

---

## 📈 **PHASE 4: ORDERS (Binary Options)**

### Step 4.1: Order Service (`src/services/orderService.js`)

```javascript
// createOrder({ user_id, amount, direction, duration })
//   - Проверить баланс
//   - Заморозить сумму
//   - Создать ордер со статусом 'active'

// getActiveOrders(user_id)       // Активные ордеры
// getOrderHistory(user_id)       // История ордеров
// getOrder(order_id)             // Детали

// resolveOrder(order_id, result) // Закрыть ордер
//   - result: 'win' | 'lose'
//   - Обновить баланс
//   - Создать транзакцию
//   - Больше не закрывать
```

### Step 4.2: Cron Job for Order Resolution

```javascript
// Каждые 10 секунд:
// SELECT * FROM orders WHERE status = 'active' AND expires_at <= NOW()
// UPDATE status = 'resolving'
// Затем админ или автомат вызывает resolveOrder()
```

### Step 4.3: Order Controller (`src/controllers/orderController.js`)

```javascript
// POST   /api/orders           → Создать
// GET    /api/orders           → Активные
// GET    /api/orders/history   → История
// GET    /api/orders/:id       → Детали
```

### Step 4.4: Order Routes (`src/routes/orders.js`)

```javascript
router.post('/', authMiddleware, orderController.create);
router.get('/', authMiddleware, orderController.list);
router.get('/history', authMiddleware, orderController.history);
router.get('/:id', authMiddleware, orderController.getOne);
```

✅ После этого фэйза: работают ордеры!

**Тестировать:**
```bash
POST /api/orders
{
  "amount": 100,
  "direction": "up",
  "duration": 300
}
```

---

## 🏦 **PHASE 5: DEPOSITS & WITHDRAWS**

### Step 5.1: Deposit Service (`src/services/depositService.js`)

```javascript
// createDepositRequest(user_id, amount)
// getDepositRequests(user_id)
// approveDeposit(deposit_id, amount) // Добавить баланс
// rejectDeposit(deposit_id)
```

### Step 5.2: Withdraw Service (`src/services/withdrawService.js`)

```javascript
// createWithdrawRequest(user_id, amount, wallet)
// getWithdrawRequests(user_id)
// approveWithdraw(withdraw_id) // Убрать баланс
// rejectWithdraw(withdraw_id)
```

### Step 5.3: Controllers & Routes

```javascript
// POST   /api/deposits/request     → Запрос
// GET    /api/deposits/requests    → Список
// POST   /api/withdraws/request    → Запрос
// GET    /api/withdraws/requests   → Список
```

✅ После этого фэйза: работают депозиты и выводы!

---

## 👩‍💼 **PHASE 6: ADMIN FUNCTIONS**

### Step 6.1: Admin Service (`src/services/adminService.js`)

```javascript
// updateSetting(key, value)
// getSetting(key)
// blockUser(user_id)
// unblockUser(user_id)
// logAdminAction(admin_id, action, details)
```

### Step 6.2: Admin Controller (`src/controllers/adminController.js`)

```javascript
// GET    /api/admin/system-settings
// POST   /api/admin/system-settings
// POST   /api/admin/users/:id/block
// POST   /api/admin/orders/:id/resolve
// POST   /api/admin/deposits/:id/approve
// POST   /api/admin/withdraws/:id/approve
```

### Step 6.3: Admin Routes & Middleware

```javascript
// Все маршруты защищены: только если user.is_admin = true
router.use(authMiddleware);
router.use(adminMiddleware); // Проверить is_admin
```

✅ После этого фэйза: админка работает!

---

## 🛡️ **ADDITIONAL**

### Error Handler Middleware

```javascript
app.use((error, req, res, next) => {
  console.error('Error:', error);
  
  if (error.name === 'ValidationError') {
    return res.status(400).json({ error: error.message });
  }
  if (error.name === 'UnauthorizedError') {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  
  res.status(500).json({ error: 'Internal server error' });
});
```

### Rate Limiting Middleware

```javascript
const rateLimit = require('express-rate-limit');

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 минут
  max: 100 // максимум 100 запросов
});

app.use('/api/', limiter);
```

### Logger Utility

```javascript
// src/utils/logger.js
function log(level, message, data) {
  console.log(`[${new Date().toISOString()}] ${level}: ${message}`, data);
}
```

---

## ✅ **TESTING CHECKLIST**

### Phase 2: Auth
- [ ] POST /api/auth/verify с настоящим initData
- [ ] Новый пользователь автоматически создаётся
- [ ] JWT токен возвращается
- [ ] 401 если инициатор заблокирован

### Phase 3: Balance
- [ ] GET /api/profile возвращает баланс
- [ ] Баланс не может быть отрицательным
- [ ] Все изменения видны в transactions

### Phase 4: Orders
- [ ] POST /api/orders создаёт ордер
- [ ] Баланс замораживается
- [ ] Ордер переходит в 'resolving' по времени
- [ ] Admin может закрыть с win/lose
- [ ] Баланс обновляется правильно

### Phase 5: Deposits/Withdraws
- [ ] Запросы создаются
- [ ] Admin может одобрить
- [ ] Баланс обновляется

### Phase 6: Admin
- [ ] Admin может менять mode
- [ ] Admin может блокировать пользователей
- [ ] Логирование работает

---

## 📊 **DEPLOYMENT**

### Render.com

1. Коммитить изменения в GitHub
2. Создать новый Web Service на Render
3. Выбрать GitHub репо
4. Выставить environment variables из .env
5. Запустить миграцию БД
6. Деплой!

```bash
# Это выполнится автоматически:
npm install
npm start
```

---

## 🎉 **READY TO BUILD!**

✅ План подготовлен
✅ Фронтенд готов
✅ Документация полная

**Начинайте с Phase 1 и идёте по порядку!**

Удачи в разработке! 🚀
