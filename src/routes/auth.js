/**
 * src/routes/auth.js
 * Authentication routes
 */

const express = require('express');
const authController = require('../controllers/authController');
const { authMiddleware } = require('../middlewares/auth');

const router = express.Router();

/**
 * POST /api/auth/verify
 * Verify Telegram initData and get JWT token
 */
router.post('/verify', authController.verify);

/**
 * GET /api/auth/me
 * Get current authenticated user
 * Protected route - requires JWT token
 */
router.get('/me', authMiddleware, authController.getMe);

module.exports = router;
