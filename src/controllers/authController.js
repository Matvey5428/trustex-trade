/**
 * src/controllers/authController.js
 * Authentication controller
 */

const authService = require('../services/authService');

/**
 * POST /api/auth/verify
 * Verify initData and return JWT token
 */
async function verify(req, res, next) {
  try {
    const { initData, refCode } = req.body;

    if (!initData) {
      console.error('❌ No initData in request body');
      return res.status(400).json({ error: 'initData is required' });
    }

    console.log('🔄 Verifying initData...');
    console.log('📝 initData length:', initData.length);
    console.log('🔑 TELEGRAM_BOT_TOKEN configured:', !!process.env.TELEGRAM_BOT_TOKEN);
    console.log('🔗 Referral code received:', refCode || '(none)');

    // Verify initData and get/create user
    const user = await authService.verifyAndGetUser(initData, refCode);

    // Generate auth response with token
    const authResponse = authService.getAuthResponse(user);

    console.log('✅ Auth successful for user:', user.telegram_id);

    res.json(authResponse);
  } catch (error) {
    console.error('❌ Auth error:', error.message);
    next(error);
  }
}

/**
 * GET /api/auth/me
 * Get current authenticated user
 */
async function getMe(req, res, next) {
  try {
    // req.user is set by authMiddleware
    const user = req.user;

    if (!user) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    // Get fresh user data from database
    const freshUser = await authService.getUserById(user.id);

    if (!freshUser) {
      throw new Error('User not found');
    }

    res.json({
      id: freshUser.id,
      telegram_id: freshUser.telegram_id,
      username: freshUser.username,
      first_name: freshUser.first_name,
      last_name: freshUser.last_name,
      is_admin: freshUser.is_admin,
      verified: freshUser.verified,
      status: freshUser.status,
      is_blocked: freshUser.is_blocked || false,
      balance_usdt: freshUser.balance_usdt,
      balance_btc: freshUser.balance_btc,
      balance_rub: freshUser.balance_rub,
      balance_eur: freshUser.balance_eur,
      balance_eth: freshUser.balance_eth,
      balance_ton: freshUser.balance_ton,
      created_at: freshUser.created_at,
      updated_at: freshUser.updated_at
    });
  } catch (error) {
    console.error('❌ getMe error:', error.message);
    next(error);
  }
}

module.exports = {
  verify,
  getMe
};
