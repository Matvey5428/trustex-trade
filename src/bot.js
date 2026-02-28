/**
 * src/bot.js
 * Telegram Bot для TrustEx Mini App
 * Поддерживает polling (dev) и webhooks (production)
 */

const TelegramBot = require('node-telegram-bot-api');

// Получаем токен из переменных окружения
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const WEB_APP_URL = process.env.WEB_APP_URL || 'https://trustex-trade.onrender.com';
const WEBHOOK_URL = process.env.WEBHOOK_URL || WEB_APP_URL;

let bot = null;
let isProduction = false;

/**
 * Инициализация бота
 */
function initBot() {
  if (!BOT_TOKEN) {
    console.error('❌ TELEGRAM_BOT_TOKEN not configured - bot disabled');
    return null;
  }

  isProduction = process.env.NODE_ENV === 'production' || process.env.RENDER;

  try {
    if (isProduction) {
      // Production: webhook режим (без polling)
      bot = new TelegramBot(BOT_TOKEN, { polling: false });
      console.log('🤖 Telegram bot initialized (webhook mode)');
      
      // Устанавливаем webhook
      setupWebhook();
    } else {
      // Development: polling режим
      bot = new TelegramBot(BOT_TOKEN, { 
        polling: true,
        onlyFirstMatch: true
      });
      console.log('🤖 Telegram bot starting (polling mode)...');
    }

    // Регистрируем обработчики команд
    registerHandlers();

    // Успешный запуск
    bot.getMe().then((info) => {
      console.log(`✅ Bot started: @${info.username} (${info.id})`);
    }).catch((err) => {
      console.error('❌ Failed to get bot info:', err.message);
    });

    return bot;
  } catch (error) {
    console.error('❌ Failed to initialize bot:', error.message);
    return null;
  }
}

/**
 * Установка webhook для production
 */
async function setupWebhook() {
  if (!bot || !isProduction) return;

  const webhookPath = `/bot${BOT_TOKEN}`;
  const fullWebhookUrl = `${WEBHOOK_URL}${webhookPath}`;

  try {
    // Удаляем старый webhook и устанавливаем новый
    await bot.deleteWebHook();
    await bot.setWebHook(fullWebhookUrl);
    console.log(`✅ Webhook set: ${WEBHOOK_URL}/bot***`);
  } catch (error) {
    console.error('❌ Failed to set webhook:', error.message);
  }
}

/**
 * Обработка webhook update (вызывается из Express route)
 */
function processUpdate(update) {
  if (bot) {
    bot.processUpdate(update);
  }
}

/**
 * Получить путь для webhook endpoint
 */
function getWebhookPath() {
  return `/bot${BOT_TOKEN}`;
}

/**
 * Регистрация обработчиков команд
 */
function registerHandlers() {
  if (!bot) return;

  // Обработчик команды /start
  bot.onText(/\/start/, async (msg) => {
    const chatId = msg.chat.id;
    const user = msg.from;
    const firstName = user.first_name || 'Пользователь';

    console.log(`📨 /start from ${user.id} (@${user.username || 'no_username'})`);

    const welcomeMessage = `
👋 Привет, <b>${firstName}</b>!

Добро пожаловать в <b>TrustEx</b> — современную торговую платформу!

🚀 <b>Что ты можешь делать:</b>
• Торговать криптовалютой
• Пополнять и выводить средства
• Отслеживать статистику

Нажми кнопку ниже, чтобы открыть приложение! 👇
    `.trim();

    await bot.sendMessage(chatId, welcomeMessage, {
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [
          [
            {
              text: '🚀 Открыть TrustEx',
              web_app: { url: WEB_APP_URL }
            }
          ],
          [
            {
              text: '📊 Статистика',
              callback_data: 'stats'
            },
            {
              text: '❓ Помощь',
              callback_data: 'help'
            }
          ]
        ]
      }
    });
  });

  // Обработчик команды /help
  bot.onText(/\/help/, async (msg) => {
    const chatId = msg.chat.id;

    const helpMessage = `
❓ <b>Помощь по TrustEx</b>

<b>Команды:</b>
/start - Начать работу с ботом
/help - Показать эту справку
/webapp - Открыть приложение

<b>Как начать?</b>
1. Нажмите на кнопку "Открыть TrustEx"
2. Авторизуйтесь через Telegram
3. Пополните баланс
4. Начните торговать!

<b>Поддержка:</b>
Если есть вопросы, напишите нам!
    `.trim();

    await bot.sendMessage(chatId, helpMessage, {
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [
          [
            {
              text: '🚀 Открыть TrustEx',
              web_app: { url: WEB_APP_URL }
            }
          ]
        ]
      }
    });
  });

  // Обработчик команды /webapp
  bot.onText(/\/webapp/, async (msg) => {
    const chatId = msg.chat.id;

    await bot.sendMessage(chatId, '🚀 Нажми кнопку ниже, чтобы открыть приложение:', {
      reply_markup: {
        inline_keyboard: [
          [
            {
              text: '📱 Открыть TrustEx',
              web_app: { url: WEB_APP_URL }
            }
          ]
        ]
      }
    });
  });

  // Обработчик callback кнопок
  bot.on('callback_query', async (query) => {
    const chatId = query.message.chat.id;
    const data = query.data;

    console.log(`🔘 Callback: ${data} from ${query.from.id}`);

    if (data === 'stats') {
      await bot.answerCallbackQuery(query.id);
      await bot.sendMessage(chatId, `
📊 <b>Статистика</b>

Для просмотра полной статистики откройте приложение TrustEx.

В приложении вы увидите:
• Ваши балансы
• Историю торгов
• Аналитику прибыли/убытков
      `.trim(), {
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [
            [
              {
                text: '📱 Открыть TrustEx',
                web_app: { url: WEB_APP_URL }
                }
            ]
          ]
        }
      });
    }

    if (data === 'help') {
      await bot.answerCallbackQuery(query.id);
      // Эмулируем /help
      bot.emit('text', { 
        chat: query.message.chat, 
        from: query.from, 
        text: '/help' 
      });
    }
  });

  // Обработчик ошибок polling (только для dev)
  bot.on('polling_error', (error) => {
    if (error.code === 'ETELEGRAM') {
      console.warn('⚠️ Telegram API rate limit');
      return;
    }
    console.error('❌ Bot polling error:', error.message);
  });

  // Обработчик текстовых сообщений для техподдержки
  bot.on('message', async (msg) => {
    // Игнорируем команды
    if (!msg.text || msg.text.startsWith('/')) return;
    
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const text = msg.text;

    console.log(`💬 Support message from ${userId}: ${text.substring(0, 50)}...`);

    try {
      const pool = require('./config/database');
      
      // Проверяем, существует ли пользователь
      const userResult = await pool.query(
        'SELECT id FROM users WHERE telegram_id = $1',
        [userId.toString()]
      );

      if (userResult.rows.length === 0) {
        // Пользователь не зарегистрирован
        await bot.sendMessage(chatId, '⚠️ Сначала откройте приложение TrustEx для регистрации.', {
          reply_markup: {
            inline_keyboard: [[{ text: '🚀 Открыть TrustEx', web_app: { url: WEB_APP_URL } }]]
          }
        });
        return;
      }

      const dbUserId = userResult.rows[0].id;

      // Сохраняем сообщение в базу
      await pool.query(
        'INSERT INTO support_messages (user_id, sender, message) VALUES ($1, $2, $3)',
        [dbUserId, 'user', text]
      );

      // Подтверждение пользователю
      await bot.sendMessage(chatId, '✅ Сообщение отправлено в техподдержку. Мы ответим вам в ближайшее время!');

      // Уведомление админам
      const adminIds = (process.env.ADMIN_IDS || '').split(',').filter(id => id.trim());
      const adminBot = require('./admin-bot').getAdminBot();
      
      if (adminBot && adminIds.length > 0) {
        const notifyText = `💬 <b>Новое сообщение в техподдержку</b>\n\nОт: ${msg.from.first_name || 'Пользователь'} (ID: ${userId})\n\n<i>${text.substring(0, 200)}${text.length > 200 ? '...' : ''}</i>`;
        
        for (const adminId of adminIds) {
          try {
            await adminBot.sendMessage(adminId.trim(), notifyText, { parse_mode: 'HTML' });
          } catch (e) {
            console.warn(`Could not notify admin ${adminId}:`, e.message);
          }
        }
      }

      console.log(`✅ Support message saved from user ${userId}`);
    } catch (error) {
      console.error('❌ Error saving support message:', error.message);
      await bot.sendMessage(chatId, '❌ Произошла ошибка. Попробуйте позже.');
    }
  });
}

/**
 * Остановка бота
 */
function stopBot() {
  if (bot) {
    if (!isProduction) {
      bot.stopPolling();
    }
    console.log('🛑 Bot stopped');
  }
}

module.exports = {
  initBot,
  stopBot,
  getBot: () => bot,
  processUpdate,
  getWebhookPath
};
