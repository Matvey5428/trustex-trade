/**
 * keyboard-nav.js — Hide bottom nav when virtual keyboard is open
 * Uses visualViewport API (reliable on iOS/Android) + focusin/focusout fallback
 */
(function() {
  var THRESHOLD = 150; // px of viewport shrink to consider keyboard open
  var initialHeight = window.innerHeight;
  var body = document.body;

  function setNavHidden(hidden) {
    if (hidden) {
      body.classList.add('input-focused');
    } else {
      body.classList.remove('input-focused');
    }
  }

  // Primary: visualViewport resize (works on iOS Safari, Chrome, Telegram WebView)
  if (window.visualViewport) {
    var vv = window.visualViewport;
    initialHeight = vv.height;

    vv.addEventListener('resize', function() {
      var shrunk = initialHeight - vv.height;
      setNavHidden(shrunk > THRESHOLD);
    });
  }

  // Fallback: focusin / focusout on document (captures all inputs, even dynamic ones)
  document.addEventListener('focusin', function(e) {
    var tag = e.target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || e.target.isContentEditable) {
      setNavHidden(true);
    }
  });

  document.addEventListener('focusout', function() {
    // Small delay so that tapping another input doesn't flash the nav
    setTimeout(function() {
      var active = document.activeElement;
      var tag = active && active.tagName;
      if (!active || (tag !== 'INPUT' && tag !== 'TEXTAREA' && !active.isContentEditable)) {
        setNavHidden(false);
      }
    }, 120);
  });
})();
