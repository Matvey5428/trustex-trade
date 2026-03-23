/**
 * src/utils/referralBonus.js
 * Shared logic for awarding referral bonus (20% of first deposit)
 */

const pool = require('../config/database');
const { areBotNotificationsEnabled } = require('./notifications');

const REFERRAL_BONUS_PERCENT = 0.20; // 20%

/**
 * Process referral bonus after a deposit is credited.
 * Awards 20% of the deposit to the referrer (same currency).
 * Only triggers on the user's FIRST deposit.
 * 
 * @param {string} userId - UUID of the user who deposited
 * @param {number} depositAmount - Amount credited (after commission)
 * @param {string} currency - Currency of the deposit (USDT, RUB, EUR)
 * @param {object} client - pg client (if inside a transaction) or null for standalone
 */
async function processReferralBonus(userId, depositAmount, currency, client = null) {
  const db = client || pool;

  try {
    // Get user's referral info
    const userResult = await db.query(
      'SELECT telegram_id, referred_by, referral_bonus_paid FROM users WHERE id = $1',
      [userId]
    );
    if (userResult.rows.length === 0) return;

    const user = userResult.rows[0];

    // Skip if no referrer or bonus already paid
    if (!user.referred_by || user.referral_bonus_paid) return;

    // Mark bonus as paid (do this first to prevent double-award on race condition)
    const updateResult = await db.query(
      'UPDATE users SET referral_bonus_paid = TRUE WHERE id = $1 AND referral_bonus_paid = FALSE RETURNING id',
      [userId]
    );
    // If no rows updated, another process already paid the bonus
    if (updateResult.rows.length === 0) return;

    // Check referrer exists
    const referrerResult = await db.query(
      'SELECT id, telegram_id, first_name FROM users WHERE telegram_id = $1',
      [user.referred_by]
    );
    if (referrerResult.rows.length === 0) return;

    const referrer = referrerResult.rows[0];

    // Calculate bonus
    const bonusAmount = parseFloat((depositAmount * REFERRAL_BONUS_PERCENT).toFixed(2));
    if (bonusAmount <= 0) return;

    // Determine balance field
    const BALANCE_FIELDS = { 'RUB': 'balance_rub', 'EUR': 'balance_eur', 'USDT': 'balance_usdt', 'BYN': 'balance_byn' };
    const balanceField = BALANCE_FIELDS[currency] || 'balance_usdt';

    // Credit referrer's balance
    await db.query(
      `UPDATE users SET ${balanceField} = ${balanceField} + $1, updated_at = NOW() WHERE id = $2`,
      [bonusAmount, referrer.id]
    );

    // Record in referral_rewards
    await db.query(
      `INSERT INTO referral_rewards (referrer_telegram_id, referred_telegram_id, deposit_amount, reward_amount, currency)
       VALUES ($1, $2, $3, $4, $5)`,
      [referrer.telegram_id, user.telegram_id, depositAmount, bonusAmount, currency]
    );

    // Create transaction record for referrer
    const sym = currency === 'RUB' ? '₽' : currency === 'EUR' ? '€' : currency === 'BYN' ? 'Br' : 'USDT';
    await db.query(
      `INSERT INTO transactions (user_id, amount, currency, type, description, created_at)
       VALUES ($1, $2, $3, 'deposit', $4, NOW())`,
      [referrer.id, bonusAmount, currency, `Реферальный бонус 20%: +${bonusAmount} ${sym}`]
    );

    // Notify referrer via Telegram (async, non-blocking)
    notifyReferrer(referrer.telegram_id, bonusAmount, currency, user.telegram_id).catch(() => {});

  } catch (err) {
    console.error('Referral bonus error:', err.message);
    // Non-critical — don't break the deposit flow
  }
}

/**
 * Send Telegram notification to referrer about their bonus
 */
async function notifyReferrer(referrerTelegramId, bonusAmount, currency, referredTelegramId) {
  const notifyEnabled = await areBotNotificationsEnabled(referrerTelegramId);
  if (!notifyEnabled) return;

  try {
    const { getBot } = require('../bot');
    const bot = getBot();
    if (!bot) return;

    const sym = currency === 'RUB' ? '₽' : currency === 'EUR' ? '€' : currency === 'BYN' ? 'Br' : '$';
    const message = `🎁 <b>Реферальный бонус!</b>\n\n` +
      `Ваш друг совершил первый депозит.\n` +
      `💰 Вам начислено: <b>${sym}${bonusAmount.toFixed(2)} ${currency}</b>\n\n` +
      `Приглашайте больше друзей и зарабатывайте!`;

    await bot.sendMessage(referrerTelegramId, message, { parse_mode: 'HTML' });
  } catch (e) {
    // Silent — notification is not critical
  }
}

module.exports = { processReferralBonus };
