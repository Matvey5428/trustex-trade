/**
 * bot.js
 * Telegram бот для торговой платформы Nexo Trade
 */

require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');

// ===== КОНФИГУРАЦИЯ =====
const token = process.env.TELEGRAM_BOT_TOKEN;
const apiBaseUrl = process.env.API_BASE_URL || 'http://localhost:3000/api';
const WEB_APP_URL = process.env.WEB_APP_URL || 'http://localhost:3000/trading';

const bot = new TelegramBot(token, { polling: true });
const userStates = {}; // Для отслеживания состояния пользователя

// ===== УТИЛИТЫ =====

async function apiCall(method, endpoint, data = null) {
  try {
    const url = `${apiBaseUrl}${endpoint}`;
    const config = { headers: { 'Content-Type': 'application/json' } };
    
    let response;
    if (method === 'GET') {
      response = await axios.get(url, config);
    } else if (method === 'POST') {
      response = await axios.post(url, data, config);
    }
    
    return response.data;
  } catch (error) {
    console.error(`API Error [${method} ${endpoint}]:`, error.message);
    throw error;
  }
}

// ===== КОМАНДЫ =====

/**
 * /start - Начало работы и открытие веб-приложения
 */
bot.onText(/\/start/, async (msg) => {
  const chatId = msg.chat.id;
  console.log('🔵 /start команда получена от:', chatId);
  
  try {
    // Создаем или получаем пользователя
    console.log('📝 Создание пользователя...');
    const userData = await apiCall('POST', '/user', {
      telegramId: chatId,
      firstName: msg.from.first_name,
      username: msg.from.username
    });
    
    userStates[chatId] = { userId: userData.data.id };
    console.log('✅ Пользователь создан, ID:', userData.data.id);
    
    // Кнопка для открытия веб-приложения
    const keyboard = {
      inline_keyboard: [
        [{ text: '🚀 Открыть биржу', web_app: { url: WEB_APP_URL } }]
      ]
    };
    
    const welcomeMsg = `Добро пожаловать в TrustEx!

Нажми кнопку ниже, чтобы открыть торговую биржу 👇`;
    
    console.log('💬 Отправка кнопки приложения...');
    await bot.sendMessage(chatId, welcomeMsg, {
      reply_markup: keyboard
    });
    console.log('✅ Кнопка отправлена');
  } catch (error) {
    console.error('❌ Ошибка в /start:', error.message);
    bot.sendMessage(chatId, 'Ошибка при запуске. Попробуй еще раз через /start');
  }
});

/**
 * /help - Справка
 */
bot.onText(/\/help/, (msg) => {
  const chatId = msg.chat.id;
  bot.sendMessage(chatId, `Команды:
/start - Открыть торговую биржу
/help - Справка

Все операции выполняются через приложение!`);
});

// ===== ЗАПУСК =====

console.log('🤖 Telegram бот запущен (режим Polling)');
console.log(`🌐 Web App URL: ${WEB_APP_URL}`);
console.log('⏳ Бот готов получать команды...\n');

bot.on('error', (error) => {
  console.error('❌ Ошибка бота:', error.message);
});

process.on('SIGINT', () => {
  console.log('\n🛑 Бот остановлен');
  process.exit();
});
