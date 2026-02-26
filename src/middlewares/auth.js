/**
 * src/middlewares/auth.js
 * JWT authentication middleware
 */

const { extractToken, verifyToken } = require('../utils/jwt');
const { UnauthorizedError } = require('../utils/errors');

/**
 * Verify JWT token and attach user to request
 */
function authMiddleware(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    const token = extractToken(authHeader);

    if (!token) {
      throw new UnauthorizedError('No token provided');
    }

    const payload = verifyToken(token);

    // Attach user data to request
    req.user = {
      id: payload.userId,
      telegramId: payload.telegramId,
      username: payload.username,
      isAdmin: payload.isAdmin
    };

    next();
  } catch (error) {
    console.warn('⚠️ Auth middleware error:', error.message);
    next(error);
  }
}

/**
 * Ensure user is admin
 */
function adminMiddleware(req, res, next) {
  if (!req.user) {
    return next(new UnauthorizedError('Authentication required'));
  }

  if (!req.user.isAdmin) {
    return next(new ForbiddenError('Admin privileges required'));
  }

  next();
}

module.exports = {
  authMiddleware,
  adminMiddleware
};
