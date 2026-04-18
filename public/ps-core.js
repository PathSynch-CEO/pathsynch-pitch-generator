/* ps-core.js — PathSynch Visitor Intelligence Core
 * Merchant embed: set window._ps_merchantId before loading this script.
 * Version: 1.0.0 | schemaVersion: 1.1
 */
(function () {
  var mid = window._ps_merchantId;
  if (!mid) return;

  var BASE = 'https://pathsynch-pitch-creation.web.app';
  var API  = 'https://us-central1-pathsynch-pitch-creation.cloudfunctions.net/api/api/v1';

  // ── Helpers ──────────────────────────────────────────────────────────────
  function getCookie(n) {
    var m = document.cookie.match(new RegExp('(?:^| )' + n + '=([^;]+)'));
    return m ? m[1] : null;
  }
  function setCookie(n, v, days) {
    var e = new Date(Date.now() + days * 864e5).toUTCString();
    document.cookie = n + '=' + v + '; expires=' + e + '; path=/; SameSite=Lax';
  }
  function uuid() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      var r = Math.random() * 16 | 0;
      return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
    });
  }
  function sha256(str) {
    if (!crypto || !crypto.subtle) return Promise.resolve(uuid());
    return crypto.subtle
      .digest('SHA-256', new TextEncoder().encode(str))
      .then(function (buf) {
        return Array.from(new Uint8Array(buf)).map(function (b) {
          return b.toString(16).padStart(2, '0');
        }).join('');
      });
  }

  // ── Session / visitor IDs ────────────────────────────────────────────────
  var sid = getCookie('_ps_sid');
  if (!sid) { sid = uuid(); setCookie('_ps_sid', sid, 30); }
  var vid = '';

  sha256([navigator.language, screen.width, screen.height,
          navigator.hardwareConcurrency, navigator.platform].join('|'))
    .then(function (h) { vid = h.substring(0, 16); window._ps_vid = vid; });

  // ── Event bus ────────────────────────────────────────────────────────────
  var queue = [];
  var cfg   = null;
  var ingestUrl = API + '/visitor-signal/ingest';

  function push(evt) { queue.push(evt); }

  function flush(reason) {
    if (!queue.length) return;
    var batch = queue.splice(0);
    var body  = JSON.stringify({
      merchantId:   mid,
      sessionId:    sid,
      visitorId:    vid,
      learningMode: cfg ? cfg.visitorIntel.learningMode : true,
      events:       batch
    });
    if (reason === 'exit' && navigator.sendBeacon) {
      navigator.sendBeacon(ingestUrl, new Blob([body], { type: 'application/json' }));
    } else {
      fetch(ingestUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: body,
        keepalive: true
      }).catch(function () {});
    }
  }

  // ── Core events ──────────────────────────────────────────────────────────
  function trackPageView() {
    push({ type: 'page_view', page: location.pathname + location.search,
           timestamp: new Date().toISOString() });
  }

  var depths = { 25: 0, 50: 0, 75: 0, 100: 0 };
  function initScrollDepth() {
    window.addEventListener('scroll', function () {
      var pct = Math.round((window.scrollY + window.innerHeight) /
                           Math.max(document.body.scrollHeight, 1) * 100);
      [25, 50, 75, 100].forEach(function (m) {
        if (!depths[m] && pct >= m) {
          depths[m] = 1;
          push({ type: 'scroll_depth', depth: m, page: location.pathname,
                 timestamp: new Date().toISOString() });
        }
      });
    }, { passive: true });
  }

  function initCtaClicks() {
    document.addEventListener('click', function (e) {
      var el = e.target && e.target.closest ? e.target.closest('[data-ps-cta]') : null;
      if (el) push({ type: 'cta_click', label: el.getAttribute('data-ps-cta'),
                     page: location.pathname, timestamp: new Date().toISOString() });
    });
  }

  // ── Module loader ────────────────────────────────────────────────────────
  function loadModule(name) {
    try {
      var s = document.createElement('script');
      s.src   = BASE + '/modules/' + name + '.js';
      s.async = true;
      s.onerror = function () {
        console.warn('[ps-core] Module failed to load: ' + name);
      };
      document.head.appendChild(s);
    } catch (e) {
      console.warn('[ps-core] Module load error: ' + name, e);
    }
  }

  function activateModules(c) {
    var m = c.modules || {};
    if (m.reviewWidget)    loadModule('review-widget');
    if (m.visitorTracking) loadModule('visitor-tracking');
    if (m.humblytics)      loadModule('humblytics-connector');
    if (m.postHog)         loadModule('posthog-connector');
    if (m.qrReferral)      loadModule('qr-referral');
  }

  // ── Config fetch ─────────────────────────────────────────────────────────
  function fetchConfig() {
    fetch(BASE + '/config/' + mid + '.json')
      .then(function (r) { return r.json(); })
      .then(function (c) {
        if (c.schemaVersion !== '1.1') return; // safe mode — core bus already running
        cfg = c;
        window._ps_config = c;
        // Update ingestUrl from config if provided
        if (c.ingestEndpoint) ingestUrl = c.ingestEndpoint;
        // Stale config: background refetch
        if (Date.now() - new Date(c.generatedAt).getTime() > 864e5) {
          fetch(BASE + '/config/' + mid + '.json', { cache: 'reload' }).catch(function () {});
        }
        activateModules(c);
        window.dispatchEvent(new CustomEvent('ps-core:ready', { detail: c }));
      })
      .catch(function () {
        // Safe mode: core event bus continues, no modules
        window.dispatchEvent(new CustomEvent('ps-core:ready', { detail: null }));
      });
  }

  // ── Boot ─────────────────────────────────────────────────────────────────
  trackPageView();
  initScrollDepth();
  initCtaClicks();
  fetchConfig();

  setInterval(function () { flush('interval'); }, 5000);

  window.addEventListener('beforeunload', function () {
    push({ type: 'page_exit', page: location.pathname,
           timestamp: new Date().toISOString() });
    flush('exit');
  });
})();
