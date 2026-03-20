/**
 * src/bot.js
 * Telegram Bot для TrustEx Mini App
 * Поддерживает polling (dev) и webhooks (production)
 */

const TelegramBot = require('node-telegram-bot-api');
const pool = require('./config/database');

// Check if bot notifications are enabled
async function areBotNotificationsEnabled() {
  try {
    const result = await pool.query("SELECT value FROM platform_settings WHERE key = 'bot_notifications_enabled'");
    return result.rows[0]?.value !== 'false';
  } catch (e) {
    return true;
  }
}

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

    // Устанавливаем кнопку меню через прямой HTTPS (надёжнее чем библиотека)
    const https = require('https');
    const menuData = JSON.stringify({
      menu_button: {
        type: 'web_app',
        text: 'TrustEx',
        web_app: { url: WEB_APP_URL }
      }
    });
    const req = https.request({
      hostname: 'api.telegram.org',
      path: `/bot${BOT_TOKEN}/setChatMenuButton`,
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, (res) => {
      let body = '';
      res.on('data', d => body += d);
      res.on('end', () => {});
    });
    req.on('error', () => {});
    req.write(menuData);
    req.end();

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

  // Обработчик команды /start с поддержкой реферальных ссылок
  bot.onText(/\/start(?:\s+(.+))?/, async (msg, match) => {
    const chatId = msg.chat.id;
    const user = msg.from;
    const firstName = user.first_name || 'Пользователь';
    const startParam = match[1]; // ref_CODE или undefined

    console.log(`📨 /start from ${user.id}${startParam ? ` ref: ${startParam}` : ''}`);

    // Check if user is blocked
    try {
      const blockedCheck = await pool.query(
        'SELECT telegram_id FROM blocked_users WHERE telegram_id = $1',
        [String(user.id)]
      );
      
      if (blockedCheck.rows.length > 0) {
        return bot.sendMessage(chatId, 
          '⛔ Ваш аккаунт заблокирован.\n\nДля получения информации обратитесь в поддержку.'
        );
      }
    } catch (e) {
      // Table might not exist yet, continue
    }

    // Handle referral link
    if (startParam && startParam.startsWith('ref_')) {
      const refCode = startParam.replace('ref_', '');
      try {
        // First try to find manager by ref_code
        const managerResult = await pool.query(
          'SELECT id, name, sub_admin_id FROM managers WHERE ref_code = $1',
          [refCode]
        );
        
        if (managerResult.rows.length > 0) {
          const manager = managerResult.rows[0];
          
          // Check if user already exists
          const existingUser = await pool.query(
            'SELECT id, manager_id FROM users WHERE telegram_id = $1',
            [user.id.toString()]
          );
          
          if (existingUser.rows.length === 0) {
            // New user - save ref to pending_refs table
            await pool.query(`
              INSERT INTO pending_refs (telegram_id, ref_code, created_at)
              VALUES ($1, $2, NOW())
              ON CONFLICT (telegram_id) DO UPDATE SET ref_code = $2, created_at = NOW()
            `, [user.id.toString(), refCode]);
            
            const welcomeMessage = `
👋 Привет, <b>${firstName}</b>!

Добро пожаловать в <b>TrustEx</b> — современную торговую платформу!

🚀 Нажми кнопку ниже, чтобы начать торговать! 👇
            `.trim();

            return bot.sendMessage(chatId, welcomeMessage, {
              parse_mode: 'HTML',
              reply_markup: {
                inline_keyboard: [
                  [{ text: '🚀 Открыть TrustEx', web_app: { url: WEB_APP_URL } }]
                ]
              }
            });
          } else if (!existingUser.rows[0].manager_id) {
            // Existing user without manager - link them
            await pool.query(
              'UPDATE users SET manager_id = $1 WHERE telegram_id = $2',
              [manager.id, user.id.toString()]
            );
          }
        } else {
          // Try to find sub-admin by ref_code
          const subAdminResult = await pool.query(
            'SELECT id, name, telegram_id FROM sub_admins WHERE ref_code = $1',
            [refCode]
          );
          
          if (subAdminResult.rows.length > 0) {
            const subAdmin = subAdminResult.rows[0];
            
            // Check if user already exists
            const existingUser = await pool.query(
              'SELECT id, sub_admin_id FROM users WHERE telegram_id = $1',
              [user.id.toString()]
            );
            
            if (existingUser.rows.length === 0) {
              // New user from sub-admin ref - save to pending_refs with 'sa_' prefix
              await pool.query(`
                INSERT INTO pending_refs (telegram_id, ref_code, created_at)
                VALUES ($1, $2, NOW())
                ON CONFLICT (telegram_id) DO UPDATE SET ref_code = $2, created_at = NOW()
              `, [user.id.toString(), `sa_${refCode}`]);
              
              const welcomeMessage = `
👋 Привет, <b>${firstName}</b>!

Добро пожаловать в <b>TrustEx</b> — современную торговую платформу!

🚀 Нажми кнопку ниже, чтобы начать торговать! 👇
              `.trim();

              return bot.sendMessage(chatId, welcomeMessage, {
                parse_mode: 'HTML',
                reply_markup: {
                  inline_keyboard: [
                    [{ text: '🚀 Открыть TrustEx', web_app: { url: WEB_APP_URL } }]
                  ]
                }
              });
            } else if (!existingUser.rows[0].sub_admin_id) {
              // Existing user without sub-admin - link them
              await pool.query(
                'UPDATE users SET sub_admin_id = $1, sub_admin_telegram_id = $2 WHERE telegram_id = $3',
                [subAdmin.id, subAdmin.telegram_id, user.id.toString()]
              );
            }
          }
        }
      } catch (e) {
        console.error('Referral processing error:', e.message);
      }
    }
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

  // Обработчик текстовых сообщений (поддержка)
  bot.on('message', async (msg) => {
    // Пропускаем команды и служебные сообщения
    if (!msg.text || msg.text.startsWith('/')) return;
    
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const message = msg.text.trim();
    
    if (!message) return;
    
    try {
      // Проверяем есть ли пользователь в базе
      const userResult = await pool.query(
        `SELECT u.id, u.telegram_id, u.first_name, u.username, 
                u.manager_id, u.sub_admin_id,
                m.telegram_id as manager_telegram_id,
                sa.telegram_id as sub_admin_telegram_id
         FROM users u
         LEFT JOIN managers m ON u.manager_id = m.id
         LEFT JOIN sub_admins sa ON u.sub_admin_id = sa.id OR m.sub_admin_id = sa.id
         WHERE u.telegram_id = $1`,
        [userId.toString()]
      );
      
      if (userResult.rows.length === 0) {
        // Пользователь не зарегистрирован
        await bot.sendMessage(chatId, '❌ Вы не зарегистрированы. Нажмите /start чтобы начать.');
        return;
      }
      
      const user = userResult.rows[0];
      
      // Сохраняем сообщение в поддержку
      await pool.query(
        `INSERT INTO support_messages (user_id, sender, message, created_at)
         VALUES ($1, 'user', $2, NOW())`,
        [user.id, message]
      );
      
      // Уведомляем админов и менеджера (если уведомления включены)
      const notifyEnabled = await areBotNotificationsEnabled();
      if (notifyEnabled) {
        const { getAdminBot } = require('./admin-bot');
        const adminBot = getAdminBot();
        
        if (adminBot) {
          const userName = user.first_name || user.username || `ID:${user.telegram_id}`;
          const shortMessage = message.length > 100 ? message.substring(0, 100) + '...' : message;
          const notifyText = `💬 *Новое сообщение в поддержку*\n\n👤 От: ${userName}\n📝 ${shortMessage}`;
          
          const recipients = new Set();
          
          // Главные админы
          const adminIds = (process.env.ADMIN_IDS || '').split(',').filter(id => id.trim());
          adminIds.forEach(id => recipients.add(id.trim()));
          
          // Суб-админ
          if (user.sub_admin_telegram_id) {
            recipients.add(user.sub_admin_telegram_id);
          }
          
          // Менеджер
          if (user.manager_telegram_id) {
            recipients.add(user.manager_telegram_id);
          }
          
          for (const recipientId of recipients) {
            try {
              await adminBot.sendMessage(recipientId, notifyText, { parse_mode: 'Markdown' });
            } catch (e) {
              console.error(`Failed to notify ${recipientId}:`, e.message);
            }
          }
        }
      }
      
      // Подтверждаем пользователю
      await bot.sendMessage(chatId, '✅ Ваше сообщение отправлено в поддержку. Мы ответим вам в ближайшее время!');
      
    } catch (error) {
      console.error('Support message error:', error.message);
      await bot.sendMessage(chatId, '❌ Ошибка отправки сообщения. Попробуйте позже.');
    }
  });

  // Обработчик callback кнопок
  bot.on('callback_query', async (query) => {
    await bot.answerCallbackQuery(query.id);
  });

  // Обработчик ошибок polling (только для dev)
  bot.on('polling_error', (error) => {
    if (error.code === 'ETELEGRAM') {
      console.warn('⚠️ Telegram API rate limit');
      return;
    }
    console.error('❌ Bot polling error:', error.message);
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
