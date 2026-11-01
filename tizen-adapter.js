/**
 * Tizen TV Adapter for Sport TV Module (Samsung Smart TV / Tizen 6.0+)
 * Handles Cloudflare Turnstile bypass, native environment flags,
 * no-referrer fetch/XHR patching, Samsung remote Back button (10009),
 * TV input device key registration, and spatial navigation.
 */
'use strict';

(function initTizenAdapter() {
  // ── 1. Bypass Cloudflare Turnstile Gate ──────────────────────────────
  var BYPASS_TOKEN = 'native-app-bypass-' + Date.now();

  try { sessionStorage.setItem('cf_clearance_token', BYPASS_TOKEN); } catch(e){}
  try { sessionStorage.setItem('cf_turnstile_verified', 'true'); } catch(e){}
  try { localStorage.setItem('cf_clearance_token', BYPASS_TOKEN); } catch(e){}
  try { localStorage.setItem('cf_turnstile_verified', 'true'); } catch(e){}
  window.__cf_clearance_token = BYPASS_TOKEN;

  function markVerified() {
    if (document.documentElement) {
      document.documentElement.classList.add('cf-verified');
    }
    if (document.body) {
      document.body.classList.remove('turnstile-locked');
    }
    var gate = document.getElementById('turnstile-gate');
    if (gate) {
      gate.style.setProperty('display', 'none', 'important');
    }
  }

  markVerified();
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', markVerified);
  }

  // Pre-resolve global turnstile promise
  if (window.__turnstileResolve) {
    try { window.__turnstileResolve(BYPASS_TOKEN); } catch(e){}
  } else {
    var _origResolve = null;
    try {
      Object.defineProperty(window, '__turnstileResolve', {
        get: function() { return _origResolve; },
        set: function(fn) {
          _origResolve = fn;
          if (typeof fn === 'function') {
            try { fn(BYPASS_TOKEN); } catch(e){}
          }
        },
        configurable: true
      });
    } catch(e){}
  }

  window.onTurnstileSuccess = function(token) {
    try { sessionStorage.setItem('cf_turnstile_verified', 'true'); } catch(e){}
    try { localStorage.setItem('cf_turnstile_verified', 'true'); } catch(e){}
    markVerified();
  };

  // ── 2. Native App & TV Flags ─────────────────────────────────────────
  window.__NATIVE_APP__ = true;
  window.__NATIVE_PLATFORM__ = 'tizen';
  window.__NATIVE_ANDROID__ = false;
  window.isTvPlatform = true;

  // ── 2b. Auto-load Samsung AVPlay Native Layer ─────────────────────────
  (function loadAVPlayScript() {
    if (typeof window !== 'undefined' && typeof window.TizenAVPlay === 'undefined') {
      if (document.querySelector('script[src*="tizen-avplay.js"]')) {
        return;
      }
      var scriptSrc = 'tizen-avplay.js';
      var el = document.createElement('script');
      el.src = scriptSrc;
      el.async = false;
      (document.head || document.documentElement).appendChild(el);
    }
  })();

  window.__tizenPlayStream = function(url, options) {
    if (typeof window.TizenAVPlay !== 'undefined' && window.TizenAVPlay.isAvailable()) {
      window.TizenAVPlay.play(url, options);
      return true;
    }
    return false;
  };

  // ── 3. TizenBrew Local Proxy Integration & Network Enforcement ─────────
  var PROXY_PORT = 3007;
  var PROXY_HOST = 'http://127.0.0.1:' + PROXY_PORT;
  window.__TB_PROXY_PORT__ = PROXY_PORT;
  window.__TB_PROXY_HOST__ = PROXY_HOST;
  window.__TB_PROXY_ACTIVE__ = false;

  function pingProxy() {
    try {
      var xhr = new XMLHttpRequest();
      xhr.open('GET', PROXY_HOST + '/ping', true);
      xhr.timeout = 2000;
      xhr.onload = function() {
        if (xhr.status === 200) {
          if (!window.__TB_PROXY_ACTIVE__) {
            console.log('[TizenAdapter] Local streaming proxy detected on ' + PROXY_HOST);
          }
          window.__TB_PROXY_ACTIVE__ = true;
        }
      };
      xhr.onerror = function() {
        window.__TB_PROXY_ACTIVE__ = false;
      };
      xhr.ontimeout = function() {
        window.__TB_PROXY_ACTIVE__ = false;
      };
      xhr.send();
    } catch (e) {}
  }
  pingProxy();
  setInterval(pingProxy, 5000);

  function wrapWithProxy(u) {
    if (!u || typeof u !== 'string') return u;
    if (u.indexOf(PROXY_HOST) === 0) return u;
    if (/^https?:\/\//i.test(u)) {
      return PROXY_HOST + '/proxy?url=' + encodeURIComponent(u);
    }
    return u;
  }
  window.__wrapWithProxy = wrapWithProxy;

  // Global Shaka Player proxy interceptor
  function hookShakaProxy() {
    if (typeof window !== 'undefined' && window.shaka && window.shaka.Player && !window.shaka.Player._tbProxyHooked) {
      window.shaka.Player._tbProxyHooked = true;
      var origLoad = window.shaka.Player.prototype.load;
      window.shaka.Player.prototype.load = function(assetUri, startTime, mimeType) {
        var u = assetUri;
        if (typeof u === 'string' && window.__TB_PROXY_ACTIVE__ && /^https?:\/\//i.test(u)) {
          u = wrapWithProxy(u);
        }
        return origLoad.call(this, u, startTime, mimeType);
      };

      var origAttach = window.shaka.Player.prototype.attach;
      window.shaka.Player.prototype.attach = function(mediaEl, opt_init) {
        var res = origAttach.call(this, mediaEl, opt_init);
        try {
          var netEngine = this.getNetworkingEngine && this.getNetworkingEngine();
          if (netEngine && !this._tbProxyFilterRegistered) {
            this._tbProxyFilterRegistered = true;
            netEngine.registerRequestFilter(function(type, request) {
              if (window.__TB_PROXY_ACTIVE__ && request && request.uris && request.uris.length) {
                for (var i = 0; i < request.uris.length; i++) {
                  var curUri = request.uris[i];
                  if (typeof curUri === 'string' && /^https?:\/\//i.test(curUri)) {
                    if (curUri.indexOf(PROXY_HOST) !== 0) {
                      request.uris[i] = wrapWithProxy(curUri);
                    }
                  }
                }
              }
            });
          }
        } catch (e) {}
        return res;
      };
    }
  }
  hookShakaProxy();
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', hookShakaProxy);
  }
  window.addEventListener('load', hookShakaProxy);
  setInterval(hookShakaProxy, 1000);

  if (typeof window.fetch === 'function' && !window.fetch._nativeAppPatched) {
    var _origFetch = window.fetch;
    window.fetch = function(input, init) {
      var urlStr = typeof input === 'string' ? input : (input && input.url ? input.url : '');
      var isYasuoyone = typeof urlStr === 'string' && (
        urlStr.includes('.yasuoyone.org') || urlStr.includes('//yasuoyone.org')
      );
      init = Object.assign({}, init || {});
      if (!isYasuoyone) {
        init.referrerPolicy = 'no-referrer';
        init.referrer = '';
      } else {
        init.referrerPolicy = 'origin';
        init.referrer = 'https://yasuoyone.org/';
      }

      if (window.__TB_PROXY_ACTIVE__ && typeof urlStr === 'string' && /^https?:\/\//i.test(urlStr)) {
        if (urlStr.indexOf(PROXY_HOST) !== 0 && !urlStr.includes(location.hostname)) {
          var proxied = wrapWithProxy(urlStr);
          if (typeof input === 'string') {
            input = proxied;
          } else if (input && typeof Request !== 'undefined' && input instanceof Request) {
            input = new Request(proxied, init);
          }
        }
      }
      return _origFetch.call(this, input, init);
    };
    window.fetch._nativeAppPatched = true;
  }

  if (typeof XMLHttpRequest !== 'undefined' && !XMLHttpRequest.prototype._nativeAppPatched) {
    var _origOpen = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function(method, url) {
      var isYasuoyone = typeof url === 'string' && (
        url.includes('.yasuoyone.org') || url.includes('//yasuoyone.org')
      );
      if (!isYasuoyone) {
        try { this.referrerPolicy = 'no-referrer'; } catch (e) {}
      }
      if (window.__TB_PROXY_ACTIVE__ && typeof url === 'string' && /^https?:\/\//i.test(url)) {
        if (url.indexOf(PROXY_HOST) !== 0 && !url.includes(location.hostname)) {
          url = wrapWithProxy(url);
        }
      }
      return _origOpen.apply(this, arguments);
    };
    XMLHttpRequest.prototype._nativeAppPatched = true;
  }

  // ── 4. Tizen TV Input Device Key Registration ────────────────────────
  function registerTizenKeys() {
    if (typeof tizen !== 'undefined' && tizen.tvinputdevice && typeof tizen.tvinputdevice.registerKey === 'function') {
      var tvKeys = [
        'MediaPlay', 'MediaPause', 'MediaPlayPause', 'MediaStop',
        'MediaFastForward', 'MediaRewind',
        '0', '1', '2', '3', '4', '5', '6', '7', '8', '9'
      ];
      tvKeys.forEach(function(k) {
        try {
          tizen.tvinputdevice.registerKey(k);
        } catch (e) {}
      });
    }
  }
  registerTizenKeys();
  window.addEventListener('load', registerTizenKeys);

  // ── 5. Inject High-Visibility Focus CSS for TV Remotes ────────────────
  function injectFocusStyles() {
    var styleId = 'tizen-tv-focus-style';
    if (document.getElementById(styleId)) return;
    var style = document.createElement('style');
    style.id = styleId;
    style.textContent = [
      ':focus, :focus-visible, .tv-focused {',
      '  outline: none !important;',
      '  border-color: #ffc629 !important;',
      '  box-shadow: 0 0 25px rgba(255, 198, 41, 0.8), 0 0 0 3px #ffc629 !important;',
      '  transform: scale(1.04) !important;',
      '  transition: transform 0.15s ease, box-shadow 0.15s ease !important;',
      '  z-index: 100 !important;',
      '}',
      '.channel-card:focus {',
      '  border-color: #ffc629 !important;',
      '  box-shadow: 0 0 30px rgba(255, 198, 41, 0.85), 0 0 0 3px #ffc629 !important;',
      '  transform: scale(1.06) !important;',
      '}',
      'body { user-select: none; -webkit-user-select: none; }'
    ].join('\n');
    (document.head || document.documentElement).appendChild(style);
  }

  if (document.head || document.documentElement) {
    injectFocusStyles();
  } else {
    document.addEventListener('DOMContentLoaded', injectFocusStyles);
  }

  // ── 6. Samsung TV Back / Return Key Handler (10009) ───────────────────
  function handleSamsungBackKey(e) {
    // 1. Check dedicated fullscreen video overlay
    var playerOverlay = document.getElementById('player-overlay');
    var isOverlayActive = playerOverlay && (
      playerOverlay.classList.contains('active') ||
      playerOverlay.style.display === 'flex' ||
      playerOverlay.style.display === 'block'
    );

    var isAvPlayActive = window.TizenAVPlay && typeof window.TizenAVPlay.isPlaying === 'function' && window.TizenAVPlay.isPlaying();

    if (isOverlayActive || isAvPlayActive) {
      if (e && e.preventDefault) e.preventDefault();
      if (e && e.stopPropagation) e.stopPropagation();
      if (window.TizenAVPlay && typeof window.TizenAVPlay.stop === 'function') {
        try { window.TizenAVPlay.stop(); } catch(err) {}
      }
      if (typeof window.closePlayer === 'function') {
        window.closePlayer();
      } else if (playerOverlay) {
        playerOverlay.classList.remove('active');
        playerOverlay.style.display = 'none';
      }
      return true; // handled, don't bubble
    }

    // 2. On channel list: allow Back key to propagate to TizenBrew host container
    // DO NOT preventDefault or stopPropagation so TizenBrew can exit the app cleanly!
    return false;
  }

  // Intercept keydown for Samsung TV Back key (10009), Escape (27), Android Back (4), XF86Back
  window.addEventListener('keydown', function(e) {
    var code = e.keyCode || e.which;
    if (code === 10009 || code === 27 || code === 4 || e.key === 'Escape' || e.key === 'XF86Back') {
      if (handleSamsungBackKey(e)) {
        e.stopPropagation();
      }
    }
  }, true);

  // Intercept Tizen hardware key event
  window.addEventListener('tizenhwkey', function(e) {
    if (e.keyName === 'back') {
      handleSamsungBackKey(e);
    }
  });

  // ── 7. Spatial D-Pad Navigation Engine Fallback ────────────────────────
  function getFocusableElements() {
    var playerOverlay = document.getElementById('player-overlay');
    var isOverlayActive = playerOverlay && playerOverlay.classList.contains('active');
    var container = isOverlayActive ? playerOverlay : document.getElementById('channels-grid') || document.body;
    var selector = 'button:not([disabled]), [tabindex="0"], a[href], input:not([disabled]), .channel-card, .close-player';
    var nodes = Array.from(container.querySelectorAll(selector));
    return nodes.filter(function(el) {
      if (el.disabled || el.tabIndex === -1) return false;
      var style = window.getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
      var rect = el.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    });
  }

  function runSpatialNavigation(direction) {
    var focusables = getFocusableElements();
    if (!focusables.length) return;

    var cur = document.activeElement;
    if (!cur || !focusables.includes(cur)) {
      focusables[0].focus();
      return;
    }

    var cRect = cur.getBoundingClientRect();
    var cCenter = { x: cRect.left + cRect.width / 2, y: cRect.top + cRect.height / 2 };

    var bestEl = null;
    var bestDist = Infinity;

    focusables.forEach(function(target) {
      if (target === cur) return;
      var tRect = target.getBoundingClientRect();
      var tCenter = { x: tRect.left + tRect.width / 2, y: tRect.top + tRect.height / 2 };
      var dx = tCenter.x - cCenter.x;
      var dy = tCenter.y - cCenter.y;

      var isValidDir = false;
      var score = Infinity;

      if (direction === 'ArrowRight' && dx > 8) {
        isValidDir = true;
        score = dx + Math.abs(dy) * 2.2;
      } else if (direction === 'ArrowLeft' && dx < -8) {
        isValidDir = true;
        score = Math.abs(dx) + Math.abs(dy) * 2.2;
      } else if (direction === 'ArrowDown' && dy > 8) {
        isValidDir = true;
        score = dy + Math.abs(dx) * 1.8;
      } else if (direction === 'ArrowUp' && dy < -8) {
        isValidDir = true;
        score = Math.abs(dy) + Math.abs(dx) * 1.8;
      }

      if (isValidDir && score < bestDist) {
        bestDist = score;
        bestEl = target;
      }
    });

    if (bestEl) {
      bestEl.focus();
      if (typeof bestEl.scrollIntoView === 'function') {
        bestEl.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
      }
    }
  }

  window.addEventListener('keydown', function(e) {
    if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) return;

    // Do not steer if typing in search input
    var tag = document.activeElement ? document.activeElement.tagName.toLowerCase() : '';
    if ((tag === 'input' && document.activeElement.type === 'text') || tag === 'textarea') return;

    // If overlay is active and player manages its own arrow keys, let it handle
    var playerOverlay = document.getElementById('player-overlay');
    if (playerOverlay && playerOverlay.classList.contains('active')) {
      // player controls handled in player event listener
      return;
    }

    e.preventDefault();
    runSpatialNavigation(e.key);
  });

  // Handle TV Enter / OK button on focusable channel cards
  window.addEventListener('keydown', function(e) {
    var code = e.keyCode || e.which;
    if (code === 13 || code === 23 || code === 66 || code === 160 || e.key === 'Enter') {
      var act = document.activeElement;
      if (act && act !== document.body) {
        var isClickable = act.tagName === 'BUTTON' || act.tagName === 'A' ||
                          act.hasAttribute('onclick') || act.classList.contains('channel-card');
        if (isClickable && typeof act.click === 'function') {
          act.click();
        }
      }
    }
  });

  // Initial focus on TV startup so user sees cursor immediately on first channel
  window.addEventListener('DOMContentLoaded', function() {
    setTimeout(function() {
      if (!document.activeElement || document.activeElement === document.body) {
        var firstCard = document.querySelector('.channel-card');
        if (firstCard) {
          firstCard.focus();
        } else {
          var focusables = getFocusableElements();
          if (focusables.length) focusables[0].focus();
        }
      }
    }, 200);
  });

  console.log('Sport TV Tizen Adapter initialized.');
})();
