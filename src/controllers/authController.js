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
    const { initData } = req.body;

    if (!initData) {
      return res.status(400).json({ error: 'initData is required' });
    }

    console.log('🔄 Verifying initData...');

    // Verify initData and get/create user
    const user = await authService.verifyAndGetUser(initData);

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

    res.json({
      id: user.id,
      telegram_id: user.telegramId,
      username: user.username,
      is_admin: user.isAdmin
    });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  verify,
  getMe
};
