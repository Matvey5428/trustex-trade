/**
 * Admin Bot - User Management
 * Поддерживает polling (dev) и webhooks (production)
 */

const TelegramBot = require('node-telegram-bot-api');
const pool = require('./config/database');

const ADMIN_BOT_TOKEN = process.env.ADMIN_BOT_TOKEN;
const ADMIN_IDS = (process.env.ADMIN_IDS || '').split(',').map(id => id.trim());
const WEB_APP_URL = process.env.WEB_APP_URL || 'https://trustex-trade.onrender.com';

let bot = null;
let isProduction = false;

function isAdmin(userId) {
  return ADMIN_IDS.includes(String(userId));
}

function formatNum(n) {
  return parseFloat(n || 0).toFixed(2);
}

function initAdminBot() {
  if (!ADMIN_BOT_TOKEN) {
    console.log('⚠️ ADMIN_BOT_TOKEN not set, admin bot disabled');
    return;
  }
  
  if (!ADMIN_IDS.length || !ADMIN_IDS[0]) {
    console.log('⚠️ ADMIN_IDS not set, admin bot disabled');
    return;
  }

  isProduction = process.env.NODE_ENV === 'production' || process.env.RENDER;

  if (isProduction) {
    // Production: webhook режим
    bot = new TelegramBot(ADMIN_BOT_TOKEN, { polling: false });
    console.log('🤖 Admin bot initialized (webhook mode)');
    setupAdminWebhook();
  } else {
    // Development: polling режим
    bot = new TelegramBot(ADMIN_BOT_TOKEN, { polling: true });
    console.log('🤖 Admin bot started (polling mode)');
  }

  // Регистрируем обработчики
  registerAdminHandlers();
}

async function setupAdminWebhook() {
  if (!bot || !isProduction) return;

  const webhookPath = `/adminbot${ADMIN_BOT_TOKEN}`;
  const fullWebhookUrl = `${WEB_APP_URL}${webhookPath}`;

  try {
    await bot.deleteWebHook();
    await bot.setWebHook(fullWebhookUrl);
    console.log(`✅ Admin webhook set: ${WEB_APP_URL}/adminbot***`);
  } catch (error) {
    console.error('❌ Failed to set admin webhook:', error.message);
  }
}

function processAdminUpdate(update) {
  if (bot) {
    bot.processUpdate(update);
  }
}

function getAdminWebhookPath() {
  if (!ADMIN_BOT_TOKEN) return null;
  return `/adminbot${ADMIN_BOT_TOKEN}`;
}

function registerAdminHandlers() {
  if (!bot) return;

  // Start command
  bot.onText(/\/start/, async (msg) => {
    const chatId = msg.chat.id;
    
    if (!isAdmin(msg.from.id)) {
      return bot.sendMessage(chatId, '⛔ Доступ запрещён');
    }
    
    bot.sendMessage(chatId, 
      '👑 *Админ-панель TrustEx*\n\n' +
      '📋 /users — Список пользователей\n' +
      '🔍 /user [id] — Информация о пользователе\n' +
      '💰 /setbalance [id] [сумма] — Установить баланс\n' +
      '🎯 /setmode [id] [win/loss] — Установить режим\n' +
      '📊 /stats — Общая статистика',
      { parse_mode: 'Markdown' }
    );
  });

  // List all users
  bot.onText(/\/users/, async (msg) => {
    const chatId = msg.chat.id;
    
    if (!isAdmin(msg.from.id)) {
      return bot.sendMessage(chatId, '⛔ Доступ запрещён');
    }
    
    try {
      const result = await pool.query(`
        SELECT id, telegram_id, username, first_name, balance_usdt, COALESCE(trade_mode, 'loss') as trade_mode, created_at 
        FROM users 
        ORDER BY created_at DESC 
        LIMIT 50
      `);
      
      if (result.rows.length === 0) {
        return bot.sendMessage(chatId, '📭 Пользователей пока нет');
      }
      
      let text = '👥 *Пользователи:*\n\n';
      
      for (const user of result.rows) {
        const name = user.first_name || user.username || 'Без имени';
        const mode = user.trade_mode === 'win' ? '🟢' : '🔴';
        text += `${mode} *${name}*\n`;
        text += `   ID: \`${user.telegram_id}\`\n`;
        text += `   Баланс: ${formatNum(user.balance_usdt)} USDT\n`;
        text += `   Режим: ${user.trade_mode}\n\n`;
      }
      
      bot.sendMessage(chatId, text, { parse_mode: 'Markdown' });
      
    } catch (e) {
      console.error('Admin bot error:', e);
      bot.sendMessage(chatId, '❌ Ошибка при получении пользователей');
    }
  });

  // Get user info
  bot.onText(/\/user (.+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    
    if (!isAdmin(msg.from.id)) {
      return bot.sendMessage(chatId, '⛔ Доступ запрещён');
    }
    
    const searchId = match[1].trim();
    
    try {
      const result = await pool.query(
        'SELECT * FROM users WHERE telegram_id = $1 OR id::text = $1',
        [searchId]
      );
      
      if (result.rows.length === 0) {
        return bot.sendMessage(chatId, '❌ Пользователь не найден');
      }
      
      const user = result.rows[0];
      
      // Handle null trade_mode
      user.trade_mode = user.trade_mode || 'loss';
      
      // Get trade stats
      const statsResult = await pool.query(`
        SELECT 
          COUNT(*) as total,
          COUNT(*) FILTER (WHERE result = 'win') as wins,
          COUNT(*) FILTER (WHERE result = 'loss') as losses,
          COALESCE(SUM(CASE WHEN result = 'win' THEN profit ELSE -amount END), 0) as total_pnl
        FROM orders 
        WHERE user_id = $1 AND status = 'closed'
      `, [user.id]);
      
      const stats = statsResult.rows[0];
      
      // Get transactions
      const txResult = await pool.query(`
        SELECT 
          COUNT(*) FILTER (WHERE type = 'deposit') as deposits,
          COALESCE(SUM(amount) FILTER (WHERE type = 'deposit'), 0) as deposit_sum,
          COUNT(*) FILTER (WHERE type = 'withdrawal') as withdrawals,
          COALESCE(SUM(amount) FILTER (WHERE type = 'withdrawal'), 0) as withdrawal_sum
        FROM transactions 
        WHERE user_id = $1
      `, [user.id]);
      
      const tx = txResult.rows[0];
      
      const name = user.first_name || user.username || 'Без имени';
      const mode = user.trade_mode === 'win' ? '🟢 WIN' : '🔴 LOSS';
      
      const text = `👤 *${name}*\n\n` +
        `🆔 Telegram ID: \`${user.telegram_id}\`\n` +
        `📛 Username: @${user.username || 'нет'}\n` +
        `💰 Баланс: *${formatNum(user.balance_usdt)} USDT*\n`+
        `🎯 Режим: *${mode}*\n` +
        `📅 Регистрация: ${new Date(user.created_at).toLocaleDateString('ru')}\n\n` +
        `📊 *Трейдинг:*\n` +
        `   Сделок: ${stats.total}\n` +
        `   Побед: ${stats.wins} | Поражений: ${stats.losses}\n` +
        `   P&L: ${formatNum(stats.total_pnl)} USDT\n\n` +
        `💳 *Транзакции:*\n` +
        `   Депозитов: ${tx.deposits} (${formatNum(tx.deposit_sum)} USDT)\n` +
        `   Выводов: ${tx.withdrawals} (${formatNum(tx.withdrawal_sum)} USDT)`;
      
      const keyboard = {
        inline_keyboard: [
          [
            { text: '🟢 WIN', callback_data: `setmode_${user.telegram_id}_win` },
            { text: '🔴 LOSS', callback_data: `setmode_${user.telegram_id}_loss` }
          ],
          [
            { text: '💰 Изменить баланс', callback_data: `balance_${user.telegram_id}` }
          ]
        ]
      };
      
      bot.sendMessage(chatId, text, { parse_mode: 'Markdown', reply_markup: keyboard });
      
    } catch (e) {
      console.error('Admin bot error:', e);
      bot.sendMessage(chatId, '❌ Ошибка при получении данных');
    }
  });

  // Set balance command (with amount)
  bot.onText(/\/setbalance (\S+) (\S+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    
    if (!isAdmin(msg.from.id)) {
      return bot.sendMessage(chatId, '⛔ Доступ запрещён');
    }
    
    const searchId = match[1].trim();
    const newBalance = parseFloat(match[2]);
    
    if (isNaN(newBalance) || newBalance < 0) {
      return bot.sendMessage(chatId, '❌ Неверная сумма');
    }
    
    try {
      const result = await pool.query(
        'UPDATE users SET balance_usdt = $1 WHERE telegram_id = $2 RETURNING first_name, username',
        [newBalance, searchId]
      );
      
      if (result.rows.length === 0) {
        return bot.sendMessage(chatId, '❌ Пользователь не найден');
      }
      
      const name = result.rows[0].first_name || result.rows[0].username;
      bot.sendMessage(chatId, `✅ Баланс *${name}* установлен: *${formatNum(newBalance)} USDT*`, { parse_mode: 'Markdown' });
      
    } catch (e) {
      console.error('Admin bot error:', e);
      bot.sendMessage(chatId, '❌ Ошибка');
    }
  });

  // Set balance command (without amount - show help)
  bot.onText(/^\/setbalance (\S+)$/, async (msg, match) => {
    const chatId = msg.chat.id;
    
    if (!isAdmin(msg.from.id)) {
      return bot.sendMessage(chatId, '⛔ Доступ запрещён');
    }
    
    const telegramId = match[1].trim();
    bot.sendMessage(chatId, 
      `💰 Введите сумму:\n\n\`/setbalance ${telegramId} [сумма]\`\n\nПример: \`/setbalance ${telegramId} 1000\``,
      { parse_mode: 'Markdown' }
    );
  });

  // Set mode command
  bot.onText(/\/setmode (\S+) (win|loss)/, async (msg, match) => {
    const chatId = msg.chat.id;
    
    if (!isAdmin(msg.from.id)) {
      return bot.sendMessage(chatId, '⛔ Доступ запрещён');
    }
    
    const searchId = match[1].trim();
    const newMode = match[2];
    
    try {
      const result = await pool.query(
        'UPDATE users SET trade_mode = $1 WHERE telegram_id = $2 RETURNING first_name, username',
        [newMode, searchId]
      );
      
      if (result.rows.length === 0) {
        return bot.sendMessage(chatId, '❌ Пользователь не найден');
      }
      
      const name = result.rows[0].first_name || result.rows[0].username;
      const modeText = newMode === 'win' ? '🟢 WIN' : '🔴 LOSS';
      bot.sendMessage(chatId, `✅ Режим *${name}* установлен: *${modeText}*`, { parse_mode: 'Markdown' });
      
    } catch (e) {
      console.error('Admin bot error:', e);
      bot.sendMessage(chatId, '❌ Ошибка');
    }
  });

  // Overall stats
  bot.onText(/\/stats/, async (msg) => {
    const chatId = msg.chat.id;
    
    if (!isAdmin(msg.from.id)) {
      return bot.sendMessage(chatId, '⛔ Доступ запрещён');
    }
    
    try {
      const usersResult = await pool.query(`
        SELECT 
          COUNT(*) as total,
          COUNT(*) FILTER (WHERE trade_mode = 'win') as win_mode,
          COUNT(*) FILTER (WHERE COALESCE(trade_mode, 'loss') = 'loss') as loss_mode,
          COALESCE(SUM(balance_usdt), 0) as total_balance
        FROM users
      `);
      
      const tradesResult = await pool.query(`
        SELECT 
          COUNT(*) as total,
          COUNT(*) FILTER (WHERE result = 'win') as wins,
          COUNT(*) FILTER (WHERE result = 'loss') as losses
        FROM orders 
        WHERE status = 'closed'
      `);
      
      const txResult = await pool.query(`
        SELECT 
          COALESCE(SUM(amount) FILTER (WHERE type = 'deposit'), 0) as deposits,
          COALESCE(SUM(amount) FILTER (WHERE type = 'withdrawal'), 0) as withdrawals
        FROM transactions
      `);
      
      const users = usersResult.rows[0];
      const trades = tradesResult.rows[0];
      const tx = txResult.rows[0];
      
      const text = '📊 *Общая статистика*\n\n' +
        `👥 *Пользователи:* ${users.total}\n` +
        `   🟢 WIN режим: ${users.win_mode}\n` +
        `   🔴 LOSS режим: ${users.loss_mode}\n` +
        `   💰 Общий баланс: ${formatNum(users.total_balance)} USDT\n\n` +
        `📈 *Сделки:* ${trades.total}\n` +
        `   ✅ Выигрышей: ${trades.wins}\n` +
        `   ❌ Проигрышей: ${trades.losses}\n\n` +
        `💳 *Транзакции:*\n` +
        `   📥 Депозиты: ${formatNum(tx.deposits)} USDT\n` +
        `   📤 Выводы: ${formatNum(tx.withdrawals)} USDT`;
      
      bot.sendMessage(chatId, text, { parse_mode: 'Markdown' });
      
    } catch (e) {
      console.error('Admin bot error:', e);
      bot.sendMessage(chatId, '❌ Ошибка');
    }
  });

  // Callback handlers
  bot.on('callback_query', async (query) => {
    const chatId = query.message.chat.id;
    const data = query.data;
    
    if (!isAdmin(query.from.id)) {
      return bot.answerCallbackQuery(query.id, { text: '⛔ Доступ запрещён' });
    }
    
    // Set mode from inline button
    if (data.startsWith('setmode_')) {
      const [, telegramId, mode] = data.split('_');
      
      try {
        await pool.query(
          'UPDATE users SET trade_mode = $1 WHERE telegram_id = $2',
          [mode, telegramId]
        );
        
        const modeText = mode === 'win' ? '🟢 WIN' : '🔴 LOSS';
        bot.answerCallbackQuery(query.id, { text: `Режим установлен: ${modeText}` });
        
        // Refresh - send updated info
        const result = await pool.query('SELECT * FROM users WHERE telegram_id = $1', [telegramId]);
        if (result.rows.length > 0) {
          const user = result.rows[0];
          const name = user.first_name || user.username || 'Без имени';
          bot.sendMessage(chatId, `✅ Режим *${name}* изменён на *${modeText}*`, { parse_mode: 'Markdown' });
        }
        
      } catch (e) {
        console.error('Admin bot error:', e);
        bot.answerCallbackQuery(query.id, { text: '❌ Ошибка' });
      }
    }
    
    // Balance change prompt
    if (data.startsWith('balance_')) {
      const telegramId = data.split('_')[1];
      
      bot.answerCallbackQuery(query.id);
      bot.sendMessage(chatId, 
        `💰 Введите новый баланс:\n\n\`/setbalance ${telegramId} [сумма]\`\n\nПример: \`/setbalance ${telegramId} 1000\``,
        { parse_mode: 'Markdown' }
      );
    }
  });

  bot.on('polling_error', (error) => {
    if (!isProduction) {
      console.error('Admin bot polling error:', error.message);
    }
  });
}

function stopAdminBot() {
  if (bot) {
    if (!isProduction) {
      bot.stopPolling();
    }
    console.log('🤖 Admin bot stopped');
  }
}

module.exports = { 
  initAdminBot, 
  stopAdminBot,
  processAdminUpdate,
  getAdminWebhookPath
};
