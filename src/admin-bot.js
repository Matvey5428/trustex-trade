/**
 * Admin Bot - User Management
 * Поддерживает polling (dev) и webhooks (production)
 */

const TelegramBot = require('node-telegram-bot-api');
const pool = require('./config/database');

const ADMIN_BOT_TOKEN = process.env.ADMIN_BOT_TOKEN;
const MAIN_ADMIN_ID = (process.env.ADMIN_IDS || '').split(',')[0]?.trim();
const WEB_APP_URL = process.env.WEB_APP_URL || 'https://trustex-trade.onrender.com';

let bot = null;
let isProduction = false;

// Check if user is main admin
function isMainAdmin(userId) {
  return String(userId) === MAIN_ADMIN_ID;
}

// Check if user is manager (async)
async function isManager(userId) {
  try {
    const result = await pool.query(
      'SELECT id FROM managers WHERE telegram_id = $1',
      [String(userId)]
    );
    return result.rows.length > 0;
  } catch (e) {
    return false;
  }
}

// Check if user has admin access (main admin or manager)
async function hasAdminAccess(userId) {
  if (isMainAdmin(userId)) return true;
  return await isManager(userId);
}

function formatNum(n) {
  return parseFloat(n || 0).toFixed(2);
}

function initAdminBot() {
  if (!ADMIN_BOT_TOKEN) {
    console.log('⚠️ ADMIN_BOT_TOKEN not set, admin bot disabled');
    return;
  }
  
  if (!MAIN_ADMIN_ID) {
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

  const ADMIN_APP_URL = `${WEB_APP_URL}/admin.html`;

  // Start command
  bot.onText(/\/start/, async (msg) => {
    const chatId = msg.chat.id;
    
    if (!(await hasAdminAccess(msg.from.id))) {
      return bot.sendMessage(chatId, '⛔ Доступ запрещён');
    }
    
    bot.sendMessage(chatId, 
      '👑 *Админ-панель TrustEx*\n\n' +
      'Нажмите кнопку ниже, чтобы открыть панель управления.\n\n' +
      '📝 *Текстовые команды:*\n' +
      '`/users` — Список пользователей\n' +
      '`/user [id]` — Информация о пользователе\n' +
      '`/setbalance [id] [сумма]` — Установить баланс\n' +
      '`/setmode [id] [win/loss]` — Установить режим\n' +
      '`/stats` — Общая статистика',
      { 
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [
              {
                text: '👑 Открыть админ-панель',
                web_app: { url: ADMIN_APP_URL }
              }
            ]
          ]
        }
      }
    );
  });

  // List all users
  bot.onText(/\/users/, async (msg) => {
    const chatId = msg.chat.id;
    
    if (!(await hasAdminAccess(msg.from.id))) {
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
    
    if (!(await hasAdminAccess(msg.from.id))) {
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

  // Set balance command (with amount) - main admin only
  bot.onText(/\/setbalance (\S+) (\S+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    
    if (!isMainAdmin(msg.from.id)) {
      return bot.sendMessage(chatId, '⛔ Только для главного админа');
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

  // Set balance command (without amount - show help) - main admin only
  bot.onText(/^\/setbalance (\S+)$/, async (msg, match) => {
    const chatId = msg.chat.id;
    
    if (!isMainAdmin(msg.from.id)) {
      return bot.sendMessage(chatId, '⛔ Только для главного админа');
    }
    
    const telegramId = match[1].trim();
    bot.sendMessage(chatId, 
      `💰 Введите сумму:\n\n\`/setbalance ${telegramId} [сумма]\`\n\nПример: \`/setbalance ${telegramId} 1000\``,
      { parse_mode: 'Markdown' }
    );
  });

  // Set mode command - main admin only
  bot.onText(/\/setmode (\S+) (win|loss)/, async (msg, match) => {
    const chatId = msg.chat.id;
    
    if (!isMainAdmin(msg.from.id)) {
      return bot.sendMessage(chatId, '⛔ Только для главного админа');
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
    
    if (!(await hasAdminAccess(msg.from.id))) {
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
    
    if (!(await hasAdminAccess(query.from.id))) {
      return bot.answerCallbackQuery(query.id, { text: '⛔ Доступ запрещён' });
    }
    
    // Set mode from inline button - main admin only
    if (data.startsWith('setmode_')) {
      if (!isMainAdmin(query.from.id)) {
        return bot.answerCallbackQuery(query.id, { text: '⛔ Только для главного админа' });
      }
      
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
    
    // Balance change prompt - main admin only
    if (data.startsWith('balance_')) {
      if (!isMainAdmin(query.from.id)) {
        return bot.answerCallbackQuery(query.id, { text: '⛔ Только для главного админа' });
      }
      
      const telegramId = data.split('_')[1];
      
      bot.answerCallbackQuery(query.id);
      bot.sendMessage(chatId, 
        `💰 Введите новый баланс:\n\n\`/setbalance ${telegramId} [сумма]\`\n\nПример: \`/setbalance ${telegramId} 1000\``,
        { parse_mode: 'Markdown' }
      );
    }
    
    // Confirm invoice payment manually
    if (data.startsWith('confirm_invoice_')) {
      const invoiceId = data.replace('confirm_invoice_', '');
      
      try {
        // Get invoice from database
        const invoiceResult = await pool.query(
          'SELECT * FROM crypto_invoices WHERE invoice_id = $1',
          [invoiceId]
        );
        
        if (invoiceResult.rows.length === 0) {
          bot.answerCallbackQuery(query.id, { text: '❌ Инвойс не найден' });
          return;
        }
        
        const invoice = invoiceResult.rows[0];
        
        if (invoice.status === 'paid') {
          bot.answerCallbackQuery(query.id, { text: '⚠️ Уже оплачен' });
          return;
        }
        
        const paidAmount = parseFloat(invoice.amount);
        
        // Update invoice status
        await pool.query(
          'UPDATE crypto_invoices SET status = $1, paid_at = NOW() WHERE invoice_id = $2',
          ['paid', invoiceId]
        );
        
        // Credit user balance
        await pool.query(
          'UPDATE users SET balance_usdt = balance_usdt + $1, updated_at = NOW() WHERE id = $2',
          [paidAmount, invoice.user_id]
        );
        
        // Create transaction record
        await pool.query(
          `INSERT INTO transactions (user_id, amount, currency, type, description, created_at)
           VALUES ($1, $2, 'USDT', 'deposit', $3, NOW())`,
          [invoice.user_id, paidAmount, `Пополнение (подтверждено админом): ${paidAmount} USDT`]
        );
        
        // Get user info for notification
        const userResult = await pool.query('SELECT telegram_id, first_name FROM users WHERE id = $1', [invoice.user_id]);
        
        if (userResult.rows.length > 0) {
          const user = userResult.rows[0];
          
          // Notify user
          const { getBot } = require('./bot');
          const mainBot = getBot();
          if (mainBot) {
            await mainBot.sendMessage(user.telegram_id, 
              `✅ Пополнение подтверждено!\n\n💰 Сумма: ${paidAmount} USDT\n\nБаланс обновлён. Приятной торговли!`
            );
          }
          
          // Update admin message
          const userName = user.first_name || 'Пользователь';
          bot.editMessageText(
            `✅ *Оплата подтверждена*\n\n` +
            `👤 Пользователь: ${userName}\n` +
            `🆔 Telegram ID: \`${user.telegram_id}\`\n` +
            `💵 Сумма: ${paidAmount} USDT\n` +
            `📋 Invoice: \`${invoiceId}\``,
            {
              chat_id: chatId,
              message_id: query.message.message_id,
              parse_mode: 'Markdown'
            }
          );
        }
        
        bot.answerCallbackQuery(query.id, { text: '✅ Оплата подтверждена!' });
        console.log(`✅ Admin confirmed invoice ${invoiceId}, credited ${paidAmount} USDT`);
        
      } catch (e) {
        console.error('Confirm invoice error:', e);
        bot.answerCallbackQuery(query.id, { text: '❌ Ошибка: ' + e.message });
      }
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
  getAdminWebhookPath,
  getAdminBot: () => bot
};
