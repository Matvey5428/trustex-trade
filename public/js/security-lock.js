/**
 * Security Lock Screen Module
 * Handles PIN and biometric authentication for TrustEx
 */

(function() {
  'use strict';

  // Configuration
  const API_BASE = window.location.origin + '/api/security';
  const SESSION_KEY = 'trustex_security_session';
  const PIN_LENGTH = 4;

  // State
  let currentUserId = null;
  let enteredPin = '';
  let isSetupMode = false;
  let confirmPin = '';
  let biometricAvailable = false;
  let onUnlockCallback = null;

  // Create lock screen HTML
  function createLockScreenHTML() {
    return `
      <div id="securityLockScreen" class="security-lock-screen" style="display: none;">
        <div class="security-backdrop"></div>
        <div class="security-container">
          <!-- Logo -->
          <div class="security-logo">
            <div class="security-logo-icon">🔐</div>
            <div class="security-logo-text">TrustEx</div>
          </div>
          
          <!-- Title -->
          <div id="securityTitle" class="security-title">Введите PIN-код</div>
          <div id="securitySubtitle" class="security-subtitle">Для доступа к приложению</div>
          
          <!-- PIN Dots -->
          <div class="security-pin-dots" id="securityPinDots">
            <div class="pin-dot" data-index="0"></div>
            <div class="pin-dot" data-index="1"></div>
            <div class="pin-dot" data-index="2"></div>
            <div class="pin-dot" data-index="3"></div>
          </div>
          
          <!-- Error Message -->
          <div id="securityError" class="security-error"></div>
          
          <!-- Numpad -->
          <div class="security-numpad">
            <div class="numpad-row">
              <button class="numpad-btn" data-num="1">1</button>
              <button class="numpad-btn" data-num="2">2</button>
              <button class="numpad-btn" data-num="3">3</button>
            </div>
            <div class="numpad-row">
              <button class="numpad-btn" data-num="4">4</button>
              <button class="numpad-btn" data-num="5">5</button>
              <button class="numpad-btn" data-num="6">6</button>
            </div>
            <div class="numpad-row">
              <button class="numpad-btn" data-num="7">7</button>
              <button class="numpad-btn" data-num="8">8</button>
              <button class="numpad-btn" data-num="9">9</button>
            </div>
            <div class="numpad-row">
              <button class="numpad-btn numpad-biometric" id="biometricBtn" style="visibility: hidden;">
                <span class="biometric-icon">👆</span>
              </button>
              <button class="numpad-btn" data-num="0">0</button>
              <button class="numpad-btn numpad-delete" id="deleteBtn">
                <span class="delete-icon">⌫</span>
              </button>
            </div>
          </div>
          
          <!-- Skip Button (for setup) -->
          <button id="securitySkipBtn" class="security-skip-btn" style="display: none;">
            Пропустить
          </button>
        </div>
      </div>
    `;
  }

  // Create CSS styles
  function createStyles() {
    const style = document.createElement('style');
    style.textContent = `
      .security-lock-screen {
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        z-index: 99999;
        display: flex;
        align-items: center;
        justify-content: center;
      }
      
      .security-backdrop {
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: linear-gradient(135deg, #0a0e17 0%, #1a1f35 50%, #0d1117 100%);
        backdrop-filter: blur(20px);
      }
      
      .security-container {
        position: relative;
        z-index: 1;
        display: flex;
        flex-direction: column;
        align-items: center;
        padding: 40px 30px;
        width: 100%;
        max-width: 340px;
      }
      
      .security-logo {
        display: flex;
        flex-direction: column;
        align-items: center;
        margin-bottom: 30px;
      }
      
      .security-logo-icon {
        font-size: 48px;
        margin-bottom: 10px;
        animation: pulse 2s infinite;
      }
      
      @keyframes pulse {
        0%, 100% { transform: scale(1); opacity: 1; }
        50% { transform: scale(1.05); opacity: 0.9; }
      }
      
      .security-logo-text {
        font-size: 24px;
        font-weight: 700;
        color: #fff;
        letter-spacing: 2px;
      }
      
      .security-title {
        font-size: 20px;
        font-weight: 600;
        color: #fff;
        margin-bottom: 8px;
        text-align: center;
      }
      
      .security-subtitle {
        font-size: 14px;
        color: rgba(255,255,255,0.6);
        margin-bottom: 30px;
        text-align: center;
      }
      
      .security-pin-dots {
        display: flex;
        gap: 16px;
        margin-bottom: 20px;
      }
      
      .pin-dot {
        width: 16px;
        height: 16px;
        border-radius: 50%;
        background: rgba(255,255,255,0.2);
        border: 2px solid rgba(255,255,255,0.3);
        transition: all 0.2s ease;
      }
      
      .pin-dot.filled {
        background: #4db8ff;
        border-color: #4db8ff;
        box-shadow: 0 0 10px rgba(77,184,255,0.5);
        transform: scale(1.1);
      }
      
      .pin-dot.error {
        background: #ff4444;
        border-color: #ff4444;
        animation: shake 0.5s ease;
      }
      
      .pin-dot.success {
        background: #00ff88;
        border-color: #00ff88;
        box-shadow: 0 0 10px rgba(0,255,136,0.5);
      }
      
      @keyframes shake {
        0%, 100% { transform: translateX(0); }
        20%, 60% { transform: translateX(-8px); }
        40%, 80% { transform: translateX(8px); }
      }
      
      .security-error {
        min-height: 20px;
        font-size: 13px;
        color: #ff4444;
        margin-bottom: 20px;
        text-align: center;
      }
      
      .security-numpad {
        display: flex;
        flex-direction: column;
        gap: 12px;
        width: 100%;
        max-width: 280px;
      }
      
      .numpad-row {
        display: flex;
        justify-content: center;
        gap: 20px;
      }
      
      .numpad-btn {
        width: 70px;
        height: 70px;
        border-radius: 50%;
        border: none;
        background: rgba(255,255,255,0.08);
        color: #fff;
        font-size: 28px;
        font-weight: 500;
        cursor: pointer;
        transition: all 0.15s ease;
        display: flex;
        align-items: center;
        justify-content: center;
        user-select: none;
        -webkit-tap-highlight-color: transparent;
      }
      
      .numpad-btn:active {
        background: rgba(77,184,255,0.3);
        transform: scale(0.95);
      }
      
      .numpad-btn:hover {
        background: rgba(255,255,255,0.15);
      }
      
      .numpad-delete, .numpad-biometric {
        background: transparent;
        font-size: 24px;
      }
      
      .numpad-biometric {
        color: #4db8ff;
      }
      
      .delete-icon, .biometric-icon {
        font-size: 26px;
      }
      
      .security-skip-btn {
        margin-top: 30px;
        background: none;
        border: none;
        color: rgba(255,255,255,0.5);
        font-size: 14px;
        cursor: pointer;
        padding: 10px 20px;
      }
      
      .security-skip-btn:hover {
        color: rgba(255,255,255,0.8);
      }
      
      /* Animations */
      .security-lock-screen.show .security-container {
        animation: slideUp 0.3s ease;
      }
      
      @keyframes slideUp {
        from {
          opacity: 0;
          transform: translateY(30px);
        }
        to {
          opacity: 1;
          transform: translateY(0);
        }
      }
      
      .security-lock-screen.hide {
        animation: fadeOut 0.3s ease forwards;
      }
      
      @keyframes fadeOut {
        to {
          opacity: 0;
          visibility: hidden;
        }
      }
    `;
    document.head.appendChild(style);
  }

  // Initialize lock screen
  function init() {
    createStyles();
    document.body.insertAdjacentHTML('beforeend', createLockScreenHTML());
    bindEvents();
    checkBiometricAvailability();
  }

  // Bind event listeners
  function bindEvents() {
    // Numpad buttons
    document.querySelectorAll('.numpad-btn[data-num]').forEach(btn => {
      btn.addEventListener('click', () => handleNumInput(btn.dataset.num));
    });
    
    // Delete button
    document.getElementById('deleteBtn').addEventListener('click', handleDelete);
    
    // Biometric button
    document.getElementById('biometricBtn').addEventListener('click', handleBiometric);
    
    // Skip button
    document.getElementById('securitySkipBtn').addEventListener('click', handleSkip);
    
    // Keyboard support
    document.addEventListener('keydown', handleKeyboard);
  }

  // Handle numeric input
  function handleNumInput(num) {
    if (enteredPin.length >= PIN_LENGTH) return;
    
    enteredPin += num;
    updatePinDots();
    
    // Haptic feedback
    if (window.Telegram?.WebApp?.HapticFeedback) {
      window.Telegram.WebApp.HapticFeedback.selectionChanged();
    }
    
    if (enteredPin.length === PIN_LENGTH) {
      setTimeout(() => {
        if (isSetupMode) {
          handleSetupPin();
        } else {
          verifyPin();
        }
      }, 200);
    }
  }

  // Handle delete
  function handleDelete() {
    if (enteredPin.length > 0) {
      enteredPin = enteredPin.slice(0, -1);
      updatePinDots();
    }
  }

  // Handle keyboard input
  function handleKeyboard(e) {
    const lockScreen = document.getElementById('securityLockScreen');
    if (lockScreen.style.display === 'none') return;
    
    if (/^\d$/.test(e.key)) {
      handleNumInput(e.key);
    } else if (e.key === 'Backspace') {
      handleDelete();
    }
  }

  // Update PIN dots display
  function updatePinDots() {
    const dots = document.querySelectorAll('.pin-dot');
    dots.forEach((dot, i) => {
      dot.classList.remove('filled', 'error', 'success');
      if (i < enteredPin.length) {
        dot.classList.add('filled');
      }
    });
  }

  // Show error animation
  function showError(message) {
    const dots = document.querySelectorAll('.pin-dot');
    const errorEl = document.getElementById('securityError');
    
    dots.forEach(dot => {
      dot.classList.add('error');
    });
    
    errorEl.textContent = message;
    
    // Haptic feedback
    if (window.Telegram?.WebApp?.HapticFeedback) {
      window.Telegram.WebApp.HapticFeedback.notificationOccurred('error');
    }
    
    setTimeout(() => {
      enteredPin = '';
      updatePinDots();
    }, 500);
  }

  // Show success animation
  function showSuccess() {
    const dots = document.querySelectorAll('.pin-dot');
    dots.forEach(dot => {
      dot.classList.remove('filled');
      dot.classList.add('success');
    });
    
    // Haptic feedback
    if (window.Telegram?.WebApp?.HapticFeedback) {
      window.Telegram.WebApp.HapticFeedback.notificationOccurred('success');
    }
  }

  // Handle PIN setup flow
  function handleSetupPin() {
    if (!confirmPin) {
      // First entry - save and ask to confirm
      confirmPin = enteredPin;
      enteredPin = '';
      updatePinDots();
      
      document.getElementById('securityTitle').textContent = 'Подтвердите PIN-код';
      document.getElementById('securitySubtitle').textContent = 'Введите код ещё раз';
      document.getElementById('securityError').textContent = '';
    } else {
      // Second entry - verify match
      if (enteredPin === confirmPin) {
        // PINs match - save
        savePinToServer(enteredPin);
      } else {
        // PINs don't match
        showError('PIN-коды не совпадают');
        confirmPin = '';
        document.getElementById('securityTitle').textContent = 'Создайте PIN-код';
        document.getElementById('securitySubtitle').textContent = '4 цифры для защиты';
      }
    }
  }

  // Save PIN to server
  async function savePinToServer(pin) {
    try {
      const res = await fetch(`${API_BASE}/pin/setup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: currentUserId, pin })
      });
      
      const data = await res.json();
      
      if (data.success) {
        showSuccess();
        saveSession();
        
        setTimeout(() => {
          hideLockScreen();
          // Offer biometric setup
          if (biometricAvailable) {
            setTimeout(() => offerBiometricSetup(), 500);
          }
        }, 500);
      } else {
        showError(data.error || 'Ошибка сохранения');
      }
    } catch (e) {
      showError('Ошибка сети');
    }
  }

  // Verify PIN with server
  async function verifyPin() {
    try {
      const res = await fetch(`${API_BASE}/pin/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: currentUserId, pin: enteredPin })
      });
      
      const data = await res.json();
      
      if (data.success) {
        showSuccess();
        saveSession();
        setTimeout(() => hideLockScreen(), 400);
      } else {
        showError('Неверный PIN-код');
      }
    } catch (e) {
      showError('Ошибка проверки');
    }
  }

  // Check biometric availability
  function checkBiometricAvailability() {
    // Check if WebAuthn is available
    if (window.PublicKeyCredential && 
        typeof window.PublicKeyCredential === 'function') {
      
      // Check if platform authenticator (Touch ID/Face ID) is available
      PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable()
        .then(available => {
          biometricAvailable = available;
          updateBiometricButton();
        })
        .catch(() => {
          biometricAvailable = false;
        });
    }
  }

  // Update biometric button visibility
  function updateBiometricButton() {
    const btn = document.getElementById('biometricBtn');
    if (biometricAvailable && !isSetupMode) {
      btn.style.visibility = 'visible';
    } else {
      btn.style.visibility = 'hidden';
    }
  }

  // Handle biometric authentication
  async function handleBiometric() {
    if (!biometricAvailable) return;
    
    try {
      // Get challenge from server
      const challengeRes = await fetch(`${API_BASE}/biometric/challenge/${currentUserId}`);
      const challengeData = await challengeRes.json();
      
      if (!challengeData.success || !challengeData.data.credentialId) {
        // Biometric not registered - fallback to PIN
        return;
      }
      
      // Create credential request
      const credential = await navigator.credentials.get({
        publicKey: {
          challenge: Uint8Array.from(atob(challengeData.data.challenge), c => c.charCodeAt(0)),
          allowCredentials: [{
            id: Uint8Array.from(atob(challengeData.data.credentialId), c => c.charCodeAt(0)),
            type: 'public-key',
            transports: ['internal']
          }],
          userVerification: 'required',
          timeout: 60000
        }
      });
      
      // Verify with server
      const verifyRes = await fetch(`${API_BASE}/biometric/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: currentUserId,
          credentialId: challengeData.data.credentialId
        })
      });
      
      const verifyData = await verifyRes.json();
      
      if (verifyData.success) {
        showSuccess();
        saveSession();
        setTimeout(() => hideLockScreen(), 400);
      }
    } catch (e) {
      console.log('Biometric failed:', e.message);
      // User cancelled or error - they can use PIN
    }
  }

  // Offer biometric setup after PIN creation
  function offerBiometricSetup() {
    if (!biometricAvailable) return;
    
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
    const methodName = isIOS ? 'Face ID / Touch ID' : 'отпечаток пальца';
    
    if (confirm(`Настроить ${methodName} для быстрого входа?`)) {
      setupBiometric();
    }
  }

  // Setup biometric authentication
  async function setupBiometric() {
    try {
      // Create credential
      const credential = await navigator.credentials.create({
        publicKey: {
          challenge: crypto.getRandomValues(new Uint8Array(32)),
          rp: {
            name: 'TrustEx',
            id: window.location.hostname
          },
          user: {
            id: Uint8Array.from(currentUserId, c => c.charCodeAt(0)),
            name: `user_${currentUserId}`,
            displayName: 'TrustEx User'
          },
          pubKeyCredParams: [
            { type: 'public-key', alg: -7 },  // ES256
            { type: 'public-key', alg: -257 } // RS256
          ],
          authenticatorSelection: {
            authenticatorAttachment: 'platform',
            userVerification: 'required',
            residentKey: 'preferred'
          },
          timeout: 60000
        }
      });
      
      // Save to server
      const credentialId = btoa(String.fromCharCode(...new Uint8Array(credential.rawId)));
      const publicKey = btoa(String.fromCharCode(...new Uint8Array(credential.response.getPublicKey())));
      
      const res = await fetch(`${API_BASE}/biometric/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: currentUserId,
          credentialId,
          publicKey
        })
      });
      
      const data = await res.json();
      
      if (data.success) {
        alert('Биометрия успешно настроена!');
      }
    } catch (e) {
      console.log('Biometric setup failed:', e.message);
    }
  }

  // Handle skip button
  function handleSkip() {
    hideLockScreen();
    if (onUnlockCallback) onUnlockCallback();
  }

  // Save session to sessionStorage (clears on app close)
  function saveSession() {
    const session = {
      userId: currentUserId,
      timestamp: Date.now()
    };
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
  }

  // Check if session is valid
  function isSessionValid(timeoutMinutes) {
    try {
      const session = JSON.parse(sessionStorage.getItem(SESSION_KEY));
      if (!session || session.userId !== currentUserId) return false;
      
      const elapsed = (Date.now() - session.timestamp) / (1000 * 60);
      return elapsed < timeoutMinutes;
    } catch (e) {
      return false;
    }
  }

  // Show lock screen
  function showLockScreen(setupMode = false) {
    isSetupMode = setupMode;
    enteredPin = '';
    confirmPin = '';
    
    const lockScreen = document.getElementById('securityLockScreen');
    const title = document.getElementById('securityTitle');
    const subtitle = document.getElementById('securitySubtitle');
    const error = document.getElementById('securityError');
    const skipBtn = document.getElementById('securitySkipBtn');
    
    if (setupMode) {
      title.textContent = 'Создайте PIN-код';
      subtitle.textContent = '4 цифры для защиты вашего аккаунта';
      skipBtn.style.display = 'block';
    } else {
      title.textContent = 'Введите PIN-код';
      subtitle.textContent = 'Для доступа к приложению';
      skipBtn.style.display = 'none';
    }
    
    error.textContent = '';
    updatePinDots();
    updateBiometricButton();
    
    lockScreen.style.display = 'flex';
    lockScreen.classList.remove('hide');
    lockScreen.classList.add('show');
  }

  // Hide lock screen
  function hideLockScreen() {
    const lockScreen = document.getElementById('securityLockScreen');
    lockScreen.classList.remove('show');
    lockScreen.classList.add('hide');
    
    setTimeout(() => {
      lockScreen.style.display = 'none';
      if (onUnlockCallback) onUnlockCallback();
    }, 300);
  }

  // Public API
  window.SecurityLock = {
    /**
     * Initialize and check security status
     * @param {string} userId - Telegram user ID
     * @param {function} onUnlock - Callback when unlocked
     */
    async check(userId, onUnlock) {
      currentUserId = String(userId);
      onUnlockCallback = onUnlock;
      
      if (!document.getElementById('securityLockScreen')) {
        init();
      }
      
      try {
        const res = await fetch(`${API_BASE}/status/${userId}`);
        const data = await res.json();
        
        if (!data.success) {
          if (onUnlock) onUnlock();
          return;
        }
        
        const status = data.data;
        
        // Security not available for this user
        if (!status.security_available) {
          if (onUnlock) onUnlock();
          return;
        }
        
        // Security not enabled - offer setup
        if (!status.security_enabled || !status.has_pin) {
          // First time - offer to setup
          showLockScreen(true);
          return;
        }
        
        // Check if auth is required
        if (status.requires_auth) {
          // Check local session first (faster)
          if (isSessionValid(status.session_timeout_minutes)) {
            if (onUnlock) onUnlock();
            return;
          }
          
          // Show lock screen
          showLockScreen(false);
          
          // Try biometric first if available
          if (status.biometric_enabled && biometricAvailable) {
            setTimeout(() => handleBiometric(), 500);
          }
        } else {
          // Session still valid
          if (onUnlock) onUnlock();
        }
      } catch (e) {
        console.error('Security check error:', e);
        if (onUnlock) onUnlock();
      }
    },
    
    /**
     * Force show setup screen
     */
    showSetup(userId) {
      currentUserId = String(userId);
      if (!document.getElementById('securityLockScreen')) {
        init();
      }
      showLockScreen(true);
    },
    
    /**
     * Check if biometric is available
     */
    isBiometricAvailable() {
      return biometricAvailable;
    },
    
    /**
     * Setup biometric manually
     */
    setupBiometric
  };
})();
