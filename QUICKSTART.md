# 🚀 Nexo Trade Backend - Phase 1 & 2 Complete

## ✅ Что готово

### Phase 1: Setup & Database ✅
- ✅ Express сервер с CORS
- ✅ PostgreSQL подключение
- ✅ SQL Schema (все таблицы)
- ✅ Environment variables (.env)

### Phase 2: Telegram Authentication ✅
- ✅ Проверка initData подписи (HMAC-SHA256)
- ✅ Создание/получение пользователя по telegram_id
- ✅ JWT токены
- ✅ Auth middleware для защиты routes
- ✅ API endpoint: `POST /api/auth/verify`

---

## 🔧 **Установка и настройка**

### 1️⃣ Уже установлено:
```bash
npm install
```

### 2️⃣ PostgreSQL - Создание базы данных

Если у тебя уже установлен PostgreSQL:

```bash
# Подключиться
psql -U postgres

# В psql консоли:
CREATE DATABASE nexo_trade;

# Выйти с \q

# Создать schema
psql -U postgres -d nexo_trade -f src/database/schemas.sql
```

**Или если используешь Docker:**
```bash
docker run --name nexo-postgres \
  -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=nexo_trade \
  -p 5432:5432 \
  -d postgres:15
```

### 3️⃣ Environment Variables

Обновить `.env`:
```env
TELEGRAM_BOT_TOKEN=YOUR_REAL_BOT_TOKEN_HERE
JWT_SECRET=your-jwt-secret-key
DB_CONNECTION_STRING=postgresql://postgres:postgres@localhost:5432/nexo_trade
```

---

## 🏃 **Запуск**

### Development mode (с auto-reload):
```bash
npm run dev
```

### Production mode:
```bash
npm start
```

Сервер будет доступен на: `http://localhost:3000`

---

## 🧪 **Тестирование авторизации**

### Способ 1: Через настоящий Telegram Mini App

1. Открыть бота в Telegram
2. Он автоматически вызовет `POST /api/auth/verify`
3. Backend вернёт токен

### Способ 2: Через curl/Postman

Понадобиться реальный `initData` из Telegram Mini App.

**Где получить initData:**

В фронтенде (index.html):
```javascript
console.log(window.Telegram.WebApp.initData);
```

Скопировать это значение и отправить:

```bash
curl -X POST http://localhost:3000/api/auth/verify \
  -H "Content-Type: application/json" \
  -d '{
    "initData": "query_id=AAH...user=%7B%22id%22%3A12345..."
  }'
```

**Ответ будет:**
```json
{
  "token": "eyJhbGc...",
  "user": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "telegram_id": 123456789,
    "username": "username",
    "balance_usdt": 0,
    "status": "active"
  }
}
```

### Способ 3: Использовать токен для защиты routes

```bash
# Запрос с авторизацией
curl -X GET http://localhost:3000/api/auth/me \
  -H "Authorization: Bearer eyJhbGc..."
```

---

## 📂 **Структура backend**

```
src/
├── config/
│   └── database.js           # PostgreSQL pool
├── middlewares/
│   └── auth.js               # JWT & admin middleware
├── routes/
│   └── auth.js               # Auth endpoints
├── controllers/
│   └── authController.js     # Request handlers
├── services/
│   └── authService.js        # Business logic
├── utils/
│   ├── telegramAuth.js       # InitData verification
│   ├── jwt.js                # Token gen/verify
│   └── errors.js             # Custom errors
├── database/
│   └── schemas.sql           # Database schema
└── app.js                    # Express setup
```

---

## 📊 **Database Schema**

### Таблица users
```sql
id (UUID) - primary key
telegram_id (BIGINT) - unique, from Telegram
username, first_name, last_name
balance_usdt, balance_btc, balance_rub
verified (boolean)
status (active | blocked)
is_admin (boolean)
created_at, updated_at
```

### Таблица orders, transactions, deposit_requests и др.
Смотри `src/database/schemas.sql`

---

## 🔐 **Как работает авторизация**

```
1. Frontend отправляет: POST /api/auth/verify { initData }
   ↓
2. Backend проверяет подпись initData через HMAC-SHA256
   ↓
3. Если подпись валидна и дата свежая (< 5 мин):
   ↓
4. Проверить в БД: существует ли пользователь?
   ├─ Да → вернуть существующего
   └─ Нет → создать нового
   ↓
5. Создать JWT токен с payload: { userId, telegramId, username, isAdmin }
   ↓
6. Вернуть: { token, user }
   ↓
7. Frontend сохраняет токен в localStorage
   ↓
8. Все следующие запросы: Authorization: Bearer {token}
```

---

## ⚙️ **Конфигурация**

### JWT Secret

Сгенерировать новый (для продакшена):
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Результат поместить в `.env`:
```env
JWT_SECRET=<результат>
```

### Telegram Bot Token

Получить у @BotFather в Telegram:
```env
TELEGRAM_BOT_TOKEN=123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11
```

---

## 🚨 **Ошибки и их решение**

### "Database connection error"
```
❌ Error: connect ECONNREFUSED 127.0.0.1:5432

Решение: Убедись что PostgreSQL запущен
```

### "JWT_SECRET not configured"
```
Решение: Добавить в .env JWT_SECRET
```

### "TELEGRAM_BOT_TOKEN not configured"
```
Решение: Добавить в .env TELEGRAM_BOT_TOKEN
```

### "Invalid signature"
```
Может быть если:
1. initData истёк (>5 минут)
2. Не совпадает TELEGRAM_BOT_TOKEN
3. initData повреждён/изменён
```

---

## 📋 **Следующие фазы**

- ⏳ Phase 3: Balance & Transactions
- ⏳ Phase 4: Orders (Binary Options)
- ⏳ Phase 5: Deposits & Withdraws
- ⏳ Phase 6: Admin Functions

---

## 🎉 **Готово к дальнейшей разработке!**

Авторизация полностью рабочая и готова к использованию в других endpoint'ах.

**Следующий шаг:** Phase 3 - Балансовая система и транзакции.
