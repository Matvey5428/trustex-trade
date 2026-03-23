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
  let onSetupCompleteCallback = null;

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
                <span class="biometric-icon" id="biometricIcon">
                  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M12 14c1.5 0 3-1 3-3s-1.5-3-3-3-3 1-3 3 1.5 3 3 3z"/>
                    <path d="M4 8V6a2 2 0 0 1 2-2h2"/>
                    <path d="M4 16v2a2 2 0 0 0 2 2h2"/>
                    <path d="M16 4h2a2 2 0 0 1 2 2v2"/>
                    <path d="M16 20h2a2 2 0 0 0 2-2v-2"/>
                  </svg>
                </span>
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

        <!-- Support FAB (same style as main page) -->
        <button class="security-support-fab" onclick="window.location.href='support.html'">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H6l-2 2V4h16v12z"/></svg>
        </button>
      </div>
    `;
  }

  // Create CSS styles
  function createStyles() {
    const style = document.createElement('style');
    style.id = 'securityLockStyles';
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
      
      .delete-icon {
        font-size: 26px;
      }
      
      .biometric-icon {
        display: flex;
        align-items: center;
        justify-content: center;
      }
      
      .biometric-icon svg {
        width: 28px;
        height: 28px;
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
      
      .security-support-fab {
        position: absolute;
        bottom: 30px;
        right: 20px;
        width: 52px;
        height: 52px;
        border-radius: 14px;
        background: #00d4aa;
        border: none;
        box-shadow: 0 4px 16px rgba(0, 212, 170, 0.3);
        cursor: pointer;
        z-index: 1;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 22px;
        transition: all 0.2s;
      }
      
      .security-support-fab:active {
        transform: scale(0.95);
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
    if (!document.getElementById('securityLockStyles')) {
      createStyles();
    }
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
        localStorage.setItem('trustex_needs_security', 'true');
        // Clear skipped flag since user now has PIN
        localStorage.removeItem(`trustex_setup_skipped_${currentUserId}`);
        
        // Notify setup complete
        if (onSetupCompleteCallback) onSetupCompleteCallback();
        
        setTimeout(() => {
          hideLockScreen();
          // Auto-setup biometric if available
          if (biometricAvailable) {
            setTimeout(() => autoSetupBiometric(), 500);
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

  // Check biometric availability using Telegram BiometricManager
  function checkBiometricAvailability() {
    const tg = window.Telegram?.WebApp;
    console.log('[Security] Checking biometric, TG WebApp:', !!tg, 'BiometricManager:', !!tg?.BiometricManager);
    
    // Check Telegram BiometricManager first (native iOS/Android)
    if (tg?.BiometricManager) {
      console.log('[Security] BiometricManager found, initializing...');
      tg.BiometricManager.init(() => {
        console.log('[Security] BiometricManager init result:', {
          isInited: tg.BiometricManager.isInited,
          isBiometricAvailable: tg.BiometricManager.isBiometricAvailable,
          biometricType: tg.BiometricManager.biometricType,
          isAccessGranted: tg.BiometricManager.isAccessGranted
        });
        
        biometricAvailable = tg.BiometricManager.isBiometricAvailable;
        updateBiometricButton();
      });
    } else {
      console.log('[Security] No BiometricManager, checking WebAuthn...');
      // Fallback to WebAuthn for browsers
      if (window.PublicKeyCredential && typeof window.PublicKeyCredential === 'function') {
        PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable()
          .then(available => {
            console.log('[Security] WebAuthn available:', available);
            biometricAvailable = available;
            updateBiometricButton();
          })
          .catch((e) => {
            console.log('[Security] WebAuthn error:', e);
            biometricAvailable = false;
          });
      } else {
        // iOS detection - assume Face ID available
        const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
        console.log('[Security] iOS detected:', isIOS);
        if (isIOS) {
          biometricAvailable = true;
          updateBiometricButton();
        }
      }
    }
  }

  // Update biometric button visibility
  function updateBiometricButton() {
    const btn = document.getElementById('biometricBtn');
    if (!btn) {
      console.log('[Security] Biometric button not found!');
      return;
    }
    
    const icon = btn.querySelector('.biometric-icon');
    console.log('[Security] Updating biometric button, available:', biometricAvailable, 'isSetupMode:', isSetupMode);
    
    // Show biometric button when available (even in setup mode after PIN is set)
    if (biometricAvailable) {
      btn.style.visibility = 'visible';
      
      // Update icon based on biometric type (using SVG icons)
      const tg = window.Telegram?.WebApp;
      if (tg?.BiometricManager?.biometricType === 'face' || /iPad|iPhone|iPod/.test(navigator.userAgent)) {
        // Face ID icon
        if (icon) icon.innerHTML = '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M4 8V6a2 2 0 0 1 2-2h2"/><path d="M4 16v2a2 2 0 0 0 2 2h2"/><path d="M16 4h2a2 2 0 0 1 2 2v2"/><path d="M16 20h2a2 2 0 0 0 2-2v-2"/><circle cx="9" cy="10" r="1"/><circle cx="15" cy="10" r="1"/><path d="M9.5 15a3.5 3.5 0 0 0 5 0"/></svg>';
      } else {
        // Fingerprint icon
        if (icon) icon.innerHTML = '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 11c0 3.517-1.009 6.799-2.753 9.571"/><path d="M3.34 16.5A11.976 11.976 0 0 0 5 21"/><path d="M6.5 10c-1.363 0-2.5.937-2.5 2.5 0 2.455.447 4.803 1.26 6.973"/><path d="M12 4a8 8 0 0 0-8 8c0 .63.073 1.245.21 1.834"/><path d="M12 8a4 4 0 0 0-4 4"/><path d="M16 12a4 4 0 0 0-1.17-2.83"/></svg>';
      }
    } else {
      btn.style.visibility = 'hidden';
    }
  }

  // Handle biometric authentication
  async function handleBiometric() {
    console.log('[Security] handleBiometric called, available:', biometricAvailable);
    
    const tg = window.Telegram?.WebApp;
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
    
    // Use Telegram BiometricManager on iOS/Android
    if (tg?.BiometricManager) {
      console.log('[Security] Using Telegram BiometricManager');
      
      // Initialize if not yet
      if (!tg.BiometricManager.isInited) {
        console.log('[Security] BiometricManager not inited, initializing...');
        tg.BiometricManager.init(() => {
          console.log('[Security] BiometricManager now ready:', tg.BiometricManager.isBiometricAvailable);
          if (tg.BiometricManager.isBiometricAvailable) {
            proceedWithTelegramBiometric();
          }
        });
        return;
      }
      
      if (tg.BiometricManager.isBiometricAvailable) {
        proceedWithTelegramBiometric();
        return;
      }
    }
    
    // Show error if no biometric available
    if (!biometricAvailable) {
      console.log('[Security] No biometric available');
      return;
    }
    
    // Fallback to WebAuthn
    try {
      const challengeRes = await fetch(`${API_BASE}/biometric/challenge/${currentUserId}`);
      const challengeData = await challengeRes.json();
      
      if (!challengeData.success || !challengeData.data.credentialId) {
        return;
      }
      
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
      
      const verifyRes = await fetch(`${API_BASE}/biometric/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: currentUserId, credentialId: challengeData.data.credentialId })
      });
      
      const verifyData = await verifyRes.json();
      if (verifyData.success) {
        showSuccess();
        saveSession();
        setTimeout(() => hideLockScreen(), 400);
      }
    } catch (e) {
      console.log('[Security] WebAuthn failed:', e.message);
    }
  }
  
  // Proceed with Telegram biometric (request access if needed)
  function proceedWithTelegramBiometric() {
    const tg = window.Telegram.WebApp;
    console.log('[Security] proceedWithTelegramBiometric, isAccessGranted:', tg.BiometricManager.isAccessGranted);
    
    if (!tg.BiometricManager.isAccessGranted) {
      tg.BiometricManager.requestAccess({ reason: 'Для быстрого входа в приложение' }, (granted) => {
        console.log('[Security] Access granted:', granted);
        if (granted) {
          authenticateWithTelegramBiometric();
        }
      });
    } else {
      authenticateWithTelegramBiometric();
    }
  }
  
  // Authenticate using Telegram BiometricManager
  function authenticateWithTelegramBiometric() {
    const tg = window.Telegram.WebApp;
    const biometricType = tg.BiometricManager.biometricType === 'face' ? 'Face ID' : 'отпечаток пальца';
    console.log('[Security] authenticateWithTelegramBiometric, type:', biometricType);
    
    tg.BiometricManager.authenticate({ reason: `Подтвердите ${biometricType}` }, (success, token) => {
      console.log('[Security] Biometric auth result:', success, 'token:', token);
      
      if (success) {
        showSuccess();
        saveSession();
        
        // Save biometric token if not saved
        if (!tg.BiometricManager.isBiometricTokenSaved) {
          tg.BiometricManager.updateBiometricToken(currentUserId);
        }
        
        setTimeout(() => hideLockScreen(), 400);
      }
    });
  }

  // Auto setup biometric after PIN creation (no confirmation needed)
  function autoSetupBiometric() {
    if (!biometricAvailable) return;
    
    const tg = window.Telegram?.WebApp;
    
    // Use Telegram BiometricManager
    if (tg?.BiometricManager?.isBiometricAvailable) {
      if (!tg.BiometricManager.isAccessGranted) {
        tg.BiometricManager.requestAccess({ reason: 'Для быстрого входа в приложение' }, (granted) => {
          if (granted) {
            tg.BiometricManager.updateBiometricToken(currentUserId, (success) => {
              if (success) {
                fetch(`${API_BASE}/biometric/register`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    userId: currentUserId,
                    credentialId: 'telegram_biometric',
                    publicKey: 'telegram'
                  })
                });
                console.log('[Security] Biometric auto-setup complete');
              }
            });
          }
        });
      } else {
        // Already granted, just save token
        tg.BiometricManager.updateBiometricToken(currentUserId);
        fetch(`${API_BASE}/biometric/register`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            userId: currentUserId,
            credentialId: 'telegram_biometric',
            publicKey: 'telegram'
          })
        });
      }
    }
  }

  // Offer biometric setup after PIN creation
  function offerBiometricSetup() {
    if (!biometricAvailable) return;
    
    const tg = window.Telegram?.WebApp;
    let methodName = 'биометрию';
    
    if (tg?.BiometricManager?.biometricType === 'face') {
      methodName = 'Face ID';
    } else if (tg?.BiometricManager?.biometricType === 'finger') {
      methodName = 'Touch ID / отпечаток пальца';
    }
    
    if (confirm(`Настроить ${methodName} для быстрого входа?`)) {
      setupBiometric();
    }
  }

  // Setup biometric authentication
  async function setupBiometric() {
    const tg = window.Telegram?.WebApp;
    
    // Use Telegram BiometricManager
    if (tg?.BiometricManager?.isBiometricAvailable) {
      if (!tg.BiometricManager.isAccessGranted) {
        tg.BiometricManager.requestAccess({ reason: 'Для быстрого входа в приложение' }, (granted) => {
          if (granted) {
            // Save token
            tg.BiometricManager.updateBiometricToken(currentUserId, (success) => {
              if (success) {
                // Update server
                fetch(`${API_BASE}/biometric/register`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    userId: currentUserId,
                    credentialId: 'telegram_biometric',
                    publicKey: 'telegram'
                  })
                });
                
                if (window.Telegram?.WebApp?.HapticFeedback) {
                  tg.HapticFeedback.notificationOccurred('success');
                }
                alert('Биометрия успешно настроена!');
              }
            });
          }
        });
      } else {
        alert('Биометрия уже настроена!');
      }
      return;
    }
    
    // Fallback to WebAuthn
    try {
      const credential = await navigator.credentials.create({
        publicKey: {
          challenge: crypto.getRandomValues(new Uint8Array(32)),
          rp: { name: 'TrustEx', id: window.location.hostname },
          user: {
            id: Uint8Array.from(currentUserId, c => c.charCodeAt(0)),
            name: `user_${currentUserId}`,
            displayName: 'TrustEx User'
          },
          pubKeyCredParams: [
            { type: 'public-key', alg: -7 },
            { type: 'public-key', alg: -257 }
          ],
          authenticatorSelection: {
            authenticatorAttachment: 'platform',
            userVerification: 'required',
            residentKey: 'preferred'
          },
          timeout: 60000
        }
      });
      
      const credentialId = btoa(String.fromCharCode(...new Uint8Array(credential.rawId)));
      const publicKey = btoa(String.fromCharCode(...new Uint8Array(credential.response.getPublicKey())));
      
      const res = await fetch(`${API_BASE}/biometric/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: currentUserId, credentialId, publicKey })
      });
      
      const data = await res.json();
      if (data.success) {
        alert('Биометрия успешно настроена!');
      }
    } catch (e) {
      console.log('[Security] Biometric setup failed:', e.message);
    }
  }

  // Handle skip button
  function handleSkip() {
    // Remember that user skipped setup (don't ask again until they clear storage)
    localStorage.setItem(`trustex_setup_skipped_${currentUserId}`, 'true');
    hideLockScreen();
    if (onUnlockCallback) onUnlockCallback();
  }

  // Save session to localStorage (persists across page navigations)
  function saveSession() {
    const session = {
      userId: currentUserId,
      timestamp: Date.now()
    };
    localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  }

  // Check if session is valid (expires after 30 min of inactivity)
  const SESSION_TIMEOUT = 30 * 60 * 1000; // 30 minutes
  function isSessionValid() {
    try {
      const session = JSON.parse(localStorage.getItem(SESSION_KEY));
      if (!session || session.userId !== currentUserId) return false;
      // Expire after 30 min of inactivity (simulates "app closed")
      if (Date.now() - session.timestamp > SESSION_TIMEOUT) {
        localStorage.removeItem(SESSION_KEY);
        return false;
      }
      // Refresh timestamp on valid check (activity keeps session alive)
      session.timestamp = Date.now();
      localStorage.setItem(SESSION_KEY, JSON.stringify(session));
      return true;
    } catch (e) {
      return false;
    }
  }
  
  // Hide the initial loading overlay
  function hideLoadingOverlay() {
    const overlay = document.getElementById('securityLoadingOverlay');
    if (overlay) {
      overlay.style.transition = 'opacity 0.2s ease';
      overlay.style.opacity = '0';
      setTimeout(() => overlay.remove(), 200);
    }
  }

  // Show lock screen
  function showLockScreen(setupMode = false) {
    isSetupMode = setupMode;
    enteredPin = '';
    confirmPin = '';
    
    // Hide loading overlay when showing lock screen
    hideLoadingOverlay();
    
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
    
    // Re-check biometric availability when showing lock screen
    checkBiometricAvailability();
    updateBiometricButton();
    
    lockScreen.style.display = 'flex';
    lockScreen.classList.remove('hide');
    lockScreen.classList.add('show');
    
    console.log('[Security] Lock screen shown, setupMode:', setupMode);
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
      
      console.log('[Security] Checking for user:', userId);
      
      if (!document.getElementById('securityLockScreen')) {
        init();
      }
      
      try {
        const res = await fetch(`${API_BASE}/status/${userId}`);
        const data = await res.json();
        
        console.log('[Security] API response:', data);
        
        if (!data.success) {
          console.log('[Security] API error, skipping');
          hideLoadingOverlay();
          if (onUnlock) onUnlock();
          return;
        }
        
        const status = data.data;
        
        // Security not available for this user
        if (!status.security_available) {
          console.log('[Security] Not available for this user');
          localStorage.setItem('trustex_needs_security', 'false');
          hideLoadingOverlay();
          if (onUnlock) onUnlock();
          return;
        }
        
        // No PIN yet - offer to create one (new user)
        if (!status.has_pin) {
          // Check if user already skipped setup before
          const skipped = localStorage.getItem(`trustex_setup_skipped_${userId}`);
          if (skipped) {
            console.log('[Security] User skipped setup before, not asking again');
            hideLoadingOverlay();
            if (onUnlock) onUnlock();
            return;
          }
          console.log('[Security] No PIN, showing setup screen');
          showLockScreen(true); // setup mode with skip button
          return;
        }
        
        // Has PIN but disabled - skip (user explicitly disabled)
        if (!status.security_enabled) {
          console.log('[Security] Security disabled by user, skipping');
          localStorage.setItem('trustex_needs_security', 'false');
          hideLoadingOverlay();
          if (onUnlock) onUnlock();
          return;
        }
        
        // User needs security - remember for next page load
        localStorage.setItem('trustex_needs_security', 'true');
        
        // Check local session first (session lasts until app is closed)
        if (isSessionValid()) {
          console.log('[Security] Session valid, skipping');
          hideLoadingOverlay();
          if (onUnlock) onUnlock();
          return;
        }
        
        // Has PIN - show lock screen
        console.log('[Security] Showing PIN entry screen');
        showLockScreen(false);
        
        // Auto-try biometric if available (no need to check biometric_enabled)
        if (biometricAvailable) {
          setTimeout(() => handleBiometric(), 500);
        }
        
      } catch (e) {
        console.error('[Security] Error:', e);
        hideLoadingOverlay();
        if (onUnlock) onUnlock();
      }
    },
    
    /**
     * Force show setup screen
     */
    showSetup(userId, onComplete) {
      currentUserId = String(userId);
      onSetupCompleteCallback = onComplete || null;
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
    setupBiometric,
    
    /**
     * Confirm PIN for sensitive actions (withdrawal, etc.)
     * Shows PIN screen, calls onSuccess after correct PIN.
     * If security not enabled for user, calls onSuccess immediately.
     * @param {string} userId - Telegram user ID
     * @param {function} onSuccess - Called after successful PIN verification
     * @param {function} [onCancel] - Called if user cancels
     */
    async confirmAction(userId, onSuccess, onCancel) {
      currentUserId = String(userId);
      
      if (!document.getElementById('securityLockScreen')) {
        init();
      }
      
      try {
        const res = await fetch(`${API_BASE}/status/${userId}`);
        const data = await res.json();
        
        // If security not enabled, proceed immediately
        if (!data.success || !data.data.security_available || !data.data.security_enabled || !data.data.has_pin) {
          if (onSuccess) onSuccess();
          return;
        }
        
        // Show PIN screen for confirmation
        onUnlockCallback = onSuccess;
        
        const title = document.getElementById('securityTitle');
        const subtitle = document.getElementById('securitySubtitle');
        const skipBtn = document.getElementById('securitySkipBtn');
        const error = document.getElementById('securityError');
        
        isSetupMode = false;
        enteredPin = '';
        confirmPin = '';
        
        title.textContent = 'Подтвердите PIN-код';
        subtitle.textContent = 'Для подтверждения операции';
        skipBtn.style.display = 'none';
        error.textContent = '';
        updatePinDots();
        checkBiometricAvailability();
        updateBiometricButton();
        
        const lockScreen = document.getElementById('securityLockScreen');
        lockScreen.style.display = 'flex';
        lockScreen.classList.remove('hide');
        lockScreen.classList.add('show');
        
        // Auto-try biometric
        if (biometricAvailable) {
          setTimeout(() => handleBiometric(), 500);
        }
      } catch (e) {
        console.error('[Security] confirmAction error:', e);
        if (onSuccess) onSuccess();
      }
    }
  };
})();

