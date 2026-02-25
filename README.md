# TrustEx Trading Platform

Telegram Mini App для торговли криптовалютами

## 🚀 Быстрый деплой на Railway.app

### 1. Подготовка

1. Создай аккаунт на [Railway.app](https://railway.app/)
2. Установи Railway CLI (опционально):
   ```bash
   npm install -g @railway/cli
   ```

### 2. Деплой через Railway Dashboard

1. Зайди на [railway.app](https://railway.app/)
2. Нажми "Start a New Project"
3. Выбери "Deploy from GitHub repo" или "Empty Project"
4. Если выбрал Empty Project:
   - Нажми "Deploy"
   - Railway автоматически обнаружит Node.js проект

### 3. Настройка Environment Variables

В Railway Dashboard → Variables добавь:

```
TELEGRAM_BOT_TOKEN=твой_токен_из_@BotFather
BOT_USERNAME=имя_твоего_бота
PORT=3000
NODE_ENV=production
```

**WEB_APP_URL** будет установлен автоматически после получения публичного URL от Railway.

### 4. Получение публичного URL

1. В Railway Dashboard → Settings → Networking
2. Нажми "Generate Domain"
3. Скопируй URL (например: `your-app.up.railway.app`)
4. Добавь переменную:
   ```
   WEB_APP_URL=https://your-app.up.railway.app/trading
   ```

### 5. Альтернатива: Деплой через CLI

```bash
# Установи Railway CLI
npm install -g @railway/cli

# Логин
railway login

# Инициализация проекта
railway init

# Деплой
railway up

# Добавь переменные окружения
railway variables set TELEGRAM_BOT_TOKEN=your_token
railway variables set BOT_USERNAME=your_bot_name
railway variables set WEB_APP_URL=https://your-app.up.railway.app/trading
```

## 📱 Локальная разработка

```bash
# Установка зависимостей
npm install

# Запуск API сервера
npm run api

# Запуск бота (в другом терминале)
npm run bot

# Или запустить все вместе
npm start
```

## 🔧 Структура проекта

```
nexo-trade/
├── index.js           # API Server (Express)
├── bot.js             # Telegram Bot
├── start.js           # Запускает API и бота вместе
├── app.js             # Express конфигурация
├── database.json      # База данных (JSON)
├── models/            # Модели данных
├── controllers/       # API контроллеры
├── routes/            # API маршруты
└── public/            # Фронтенд (HTML/CSS/JS)
    ├── index.html
    ├── trading.html
    └── app.js
```

## 🌐 Другие варианты хостинга

### Render.com
- Бесплатный тариф доступен
- Автоматический деплой из GitHub
- URL: render.com

### Fly.io
- $0-5/месяц
- Хорошая производительность
- URL: fly.io

### Heroku (платный)
- $7+/месяц
- Простой в использовании
- URL: heroku.com

## 📝 После деплоя

1. Открой бота в Telegram: `@твое_имя_бота`
2. Отправь `/start`
3. Нажми кнопку "🚀 Открыть биржу"
4. Мини-приложение откроется!

## 🔒 Безопасность

- Не коммить `.env` файл в Git
- Использовать environment variables для секретов
- Регулярно обновлять зависимости: `npm update`

## 📞 Поддержка

Если возникли проблемы:
1. Проверь логи в Railway Dashboard
2. Убедись, что все environment variables заданы
3. Проверь, что bot token правильный

---

Made with ❤️ for crypto trading
