# 🚀 Развертывание на Render

## Проблема: Database connection error

На Render нет подключения к PostgreSQL по умолчанию. Нужно либо создать БД, либо подключить внешний сервис.

## Вариант 1: Использовать Neon (Рекомендуется - Бесплатно)

Neon предоставляет бесплатный PostgreSQL в облаке.

### Шаг 1: Создать БД на Neon
1. Перейди на https://neon.tech/
2. Зарегистрируйся (можешь через GitHub)
3. Создай новый проект
4. Скопируй Connection String (выглядит так):
```
postgresql://user:password@ep-xxxx.neon.tech/dbname?sslmode=require
```

### Шаг 2: Добавить Environment Variable на Render
1. Открой Render Dashboard: https://dashboard.render.com/
2. Выбери свой сервис (nexo-trade)
3. Перейди в **Settings** → **Environment**
4. Добавь переменную:
   - **Key:** `DATABASE_URL`
   - **Value:** Вставь Connection String с Neon
5. Сохрани (automatic redeploy)

### Шаг 3: Создать схему БД на Neon
Запусти SQL из `src/database/schemas.sql`:

```bash
# На своем компьютере, если у тебя psql установлен:
psql "postgresql://user:password@neon.tech/dbname" < src/database/schemas.sql
```

Или используй Neon Web Console в браузере.

---

## Вариант 2: Использовать PostgreSQL на Render (Платно)

PostgreSQL на Render стоит от $15/месяц.

1. В Render Dashboard → **New** → **PostgreSQL**
2. Настрой:
   - Name: `nexo-trade-db`
   - Region: Выбери ближайший к тебе
   - PostgreSQL Version: 15
3. После создания скопируй Connection String
4. Добавь его как `DATABASE_URL` в Environment

---

## Вариант 3: Использовать Vercel Postgres (Альтернатива)

Vercel Postgres интегрируется просто:

1. https://vercel.com/storage/postgres
2. Создай БД
3. Добавь Connection String на Render

---

## Проверка подключения

После добавления `DATABASE_URL`:

1. Нажми **Manual Deploy** (или Redeploy) в Render
2. Проверь логи:
   ```
   ✅ Database connected at [timestamp]
   ```
   вместо
   ```
   ⚠️ Database connection error: connect ECONNREFUSED
   ```

---

## Текущий статус

✅ Сервер запускается  
⚠️ БД недоступна (нужно настроить)

Как только настроишь БД и добавишь `DATABASE_URL` → все работает!

---

## Environment Variables для Render

**Минимум для работы:**
```
DATABASE_URL=postgresql://user:pass@host/dbname
NODE_ENV=production
TELEGRAM_BOT_TOKEN=твой_боттокен
JWT_SECRET=random-secure-secret
```

**Дополнительно:**
```
PORT=10000  # Render даст тебе этот номер
CORS_ORIGIN=*
```

---

## Команды для локального тестирования

Перед деплоем проверь локально:

```bash
# Установи зависимости
npm install

# Создай .env с правильной БД
echo "DATABASE_URL=postgresql://... > .env"

# Запусти миграцию (если нужна)
npm run migrate

# Запусти сервер
npm start
```
