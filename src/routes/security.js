/**
 * src/routes/security.js
 * Security routes for PIN and biometric authentication
 */

const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const crypto = require('crypto');

// Test users who have access to security features
const TEST_SECURITY_USERS = ['703924219'];

// Session timeout in minutes (skip auth if recent)
const SESSION_TIMEOUT_MINUTES = 15;

/**
 * Hash PIN with salt
 */
function hashPin(pin, salt = null) {
  if (!salt) {
    salt = crypto.randomBytes(16).toString('hex');
  }
  const hash = crypto.pbkdf2Sync(pin, salt, 10000, 64, 'sha512').toString('hex');
  return { hash, salt, combined: `${salt}:${hash}` };
}

/**
 * Verify PIN against stored hash
 */
function verifyPin(pin, storedCombined) {
  const [salt, storedHash] = storedCombined.split(':');
  const { hash } = hashPin(pin, salt);
  return hash === storedHash;
}

/**
 * Check if user has security features enabled (test users only for now)
 */
function isSecurityUser(telegramId) {
  return TEST_SECURITY_USERS.includes(String(telegramId));
}

/**
 * GET /api/security/status/:userId
 * Get security status for user
 */
router.get('/status/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    
    // Check if user is in test group
    if (!isSecurityUser(userId)) {
      return res.json({
        success: true,
        data: {
          security_available: false,
          security_enabled: false,
          has_pin: false,
          biometric_enabled: false,
          requires_auth: false
        }
      });
    }
    
    const result = await pool.query(
      `SELECT security_enabled, security_pin, biometric_enabled, 
              biometric_credential_id, last_security_auth
       FROM users WHERE telegram_id = $1`,
      [userId]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'User not found' });
    }
    
    const user = result.rows[0];
    const hasPin = !!user.security_pin;
    const hasBiometric = user.biometric_enabled && !!user.biometric_credential_id;
    
    // Check if auth is required (session expired or never authed)
    let requiresAuth = false;
    if (user.security_enabled && hasPin) {
      if (!user.last_security_auth) {
        requiresAuth = true;
      } else {
        const lastAuth = new Date(user.last_security_auth);
        const now = new Date();
        const diffMinutes = (now - lastAuth) / (1000 * 60);
        requiresAuth = diffMinutes > SESSION_TIMEOUT_MINUTES;
      }
    }
    
    res.json({
      success: true,
      data: {
        security_available: true,
        security_enabled: user.security_enabled || false,
        has_pin: hasPin,
        biometric_enabled: hasBiometric,
        requires_auth: requiresAuth,
        session_timeout_minutes: SESSION_TIMEOUT_MINUTES
      }
    });
  } catch (error) {
    console.error('Security status error:', error);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

/**
 * POST /api/security/pin/setup
 * Setup or change PIN code
 */
router.post('/pin/setup', async (req, res) => {
  try {
    const { userId, pin, currentPin } = req.body;
    
    if (!userId || !pin) {
      return res.status(400).json({ success: false, error: 'userId and pin required' });
    }
    
    if (!isSecurityUser(userId)) {
      return res.status(403).json({ success: false, error: 'Security not available' });
    }
    
    // Validate PIN format (4-6 digits)
    if (!/^\d{4,6}$/.test(pin)) {
      return res.status(400).json({ success: false, error: 'PIN must be 4-6 digits' });
    }
    
    // Get current user
    const userResult = await pool.query(
      'SELECT id, security_pin FROM users WHERE telegram_id = $1',
      [userId]
    );
    
    if (userResult.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'User not found' });
    }
    
    const user = userResult.rows[0];
    
    // If PIN already exists, verify current PIN
    if (user.security_pin && currentPin) {
      if (!verifyPin(currentPin, user.security_pin)) {
        return res.status(403).json({ success: false, error: 'Current PIN is incorrect' });
      }
    }
    
    // Hash and save new PIN
    const { combined } = hashPin(pin);
    
    await pool.query(
      `UPDATE users 
       SET security_pin = $1, 
           security_enabled = TRUE,
           last_security_auth = NOW(),
           updated_at = NOW()
       WHERE telegram_id = $2`,
      [combined, userId]
    );
    
    res.json({
      success: true,
      message: user.security_pin ? 'PIN changed successfully' : 'PIN setup complete'
    });
  } catch (error) {
    console.error('PIN setup error:', error);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

/**
 * POST /api/security/pin/verify
 * Verify PIN code for authentication
 */
router.post('/pin/verify', async (req, res) => {
  try {
    const { userId, pin } = req.body;
    
    if (!userId || !pin) {
      return res.status(400).json({ success: false, error: 'userId and pin required' });
    }
    
    const result = await pool.query(
      'SELECT id, security_pin FROM users WHERE telegram_id = $1',
      [userId]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'User not found' });
    }
    
    const user = result.rows[0];
    
    if (!user.security_pin) {
      return res.status(400).json({ success: false, error: 'PIN not setup' });
    }
    
    // Verify PIN
    const isValid = verifyPin(pin, user.security_pin);
    
    if (!isValid) {
      return res.status(403).json({ success: false, error: 'Incorrect PIN' });
    }
    
    // Update last auth time
    await pool.query(
      'UPDATE users SET last_security_auth = NOW() WHERE telegram_id = $1',
      [userId]
    );
    
    res.json({
      success: true,
      message: 'Authentication successful'
    });
  } catch (error) {
    console.error('PIN verify error:', error);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

/**
 * POST /api/security/biometric/register
 * Register biometric credential (WebAuthn)
 */
router.post('/biometric/register', async (req, res) => {
  try {
    const { userId, credentialId, publicKey } = req.body;
    
    if (!userId || !credentialId || !publicKey) {
      return res.status(400).json({ success: false, error: 'Missing required fields' });
    }
    
    if (!isSecurityUser(userId)) {
      return res.status(403).json({ success: false, error: 'Security not available' });
    }
    
    // Check user has PIN first
    const userResult = await pool.query(
      'SELECT security_pin FROM users WHERE telegram_id = $1',
      [userId]
    );
    
    if (userResult.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'User not found' });
    }
    
    if (!userResult.rows[0].security_pin) {
      return res.status(400).json({ success: false, error: 'Setup PIN first' });
    }
    
    // Save biometric credentials
    await pool.query(
      `UPDATE users 
       SET biometric_enabled = TRUE,
           biometric_credential_id = $1,
           biometric_public_key = $2,
           updated_at = NOW()
       WHERE telegram_id = $3`,
      [credentialId, publicKey, userId]
    );
    
    res.json({
      success: true,
      message: 'Biometric registered successfully'
    });
  } catch (error) {
    console.error('Biometric register error:', error);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

/**
 * POST /api/security/biometric/verify
 * Verify biometric authentication
 */
router.post('/biometric/verify', async (req, res) => {
  try {
    const { userId, credentialId, authenticatorData, signature, clientDataJSON } = req.body;
    
    if (!userId) {
      return res.status(400).json({ success: false, error: 'userId required' });
    }
    
    const result = await pool.query(
      `SELECT biometric_enabled, biometric_credential_id, biometric_public_key 
       FROM users WHERE telegram_id = $1`,
      [userId]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'User not found' });
    }
    
    const user = result.rows[0];
    
    if (!user.biometric_enabled || !user.biometric_credential_id) {
      return res.status(400).json({ success: false, error: 'Biometric not setup' });
    }
    
    // For now, simple credential ID match
    // In production, you'd verify the signature with the public key
    if (credentialId !== user.biometric_credential_id) {
      return res.status(403).json({ success: false, error: 'Invalid credential' });
    }
    
    // Update last auth time
    await pool.query(
      'UPDATE users SET last_security_auth = NOW() WHERE telegram_id = $1',
      [userId]
    );
    
    res.json({
      success: true,
      message: 'Biometric authentication successful'
    });
  } catch (error) {
    console.error('Biometric verify error:', error);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

/**
 * GET /api/security/biometric/challenge/:userId
 * Get challenge for biometric authentication
 */
router.get('/biometric/challenge/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    
    const result = await pool.query(
      'SELECT biometric_credential_id FROM users WHERE telegram_id = $1',
      [userId]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'User not found' });
    }
    
    // Generate random challenge
    const challenge = crypto.randomBytes(32).toString('base64url');
    
    res.json({
      success: true,
      data: {
        challenge,
        credentialId: result.rows[0].biometric_credential_id
      }
    });
  } catch (error) {
    console.error('Biometric challenge error:', error);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

/**
 * POST /api/security/disable
 * Disable security (user already authenticated)
 */
router.post('/disable', async (req, res) => {
  try {
    const { userId } = req.body;
    
    if (!userId) {
      return res.status(400).json({ success: false, error: 'userId required' });
    }
    
    // Disable security completely
    await pool.query(
      `UPDATE users 
       SET security_enabled = FALSE,
           security_pin = NULL,
           biometric_enabled = FALSE,
           biometric_credential_id = NULL,
           biometric_public_key = NULL,
           last_security_auth = NULL,
           updated_at = NOW()
       WHERE telegram_id = $1`,
      [userId]
    );
    
    res.json({
      success: true,
      message: 'Security disabled'
    });
  } catch (error) {
    console.error('Security disable error:', error);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

/**
 * POST /api/security/biometric/disable
 * Disable only biometric (keep PIN)
 */
router.post('/biometric/disable', async (req, res) => {
  try {
    const { userId } = req.body;
    
    if (!userId) {
      return res.status(400).json({ success: false, error: 'userId required' });
    }
    
    // Disable biometric only
    await pool.query(
      `UPDATE users 
       SET biometric_enabled = FALSE,
           biometric_credential_id = NULL,
           biometric_public_key = NULL,
           updated_at = NOW()
       WHERE telegram_id = $1`,
      [userId]
    );
    
    res.json({
      success: true,
      message: 'Biometric disabled'
    });
  } catch (error) {
    console.error('Biometric disable error:', error);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

module.exports = router;
