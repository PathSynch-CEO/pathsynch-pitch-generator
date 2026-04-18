/* humblytics-connector.js — PathSynch Humblytics Module
 * Initializes Humblytics analytics with the merchant's site token.
 * Humblytics tracks its own events independently — ps-core events are NOT piped in.
 * Exits silently if token is null or missing.
 */
(function () {
  function init(psConfig) {
    var token = psConfig && psConfig.humblyticsSiteToken;
    if (!token) {
      console.log('[humblytics-connector] no token, skipping');
      return;
    }

    // Load Humblytics script
    (function (h, u, m, b, l, y, t, i, c, s) {
      h._hmbq = h._hmbq || [];
      h._hmbq.push(['setSiteToken', token]);
      s = u.createElement(m);
      s.async = 1;
      s.src = b;
      i = u.getElementsByTagName(m)[0];
      i.parentNode.insertBefore(s, i);
    })(window, document, 'script', 'https://cdn.humblytics.com/humblytics.min.js');
  }

  if (window._ps_config) {
    init(window._ps_config);
  } else {
    window.addEventListener('ps-core:ready', function (e) {
      init(e.detail);
    });
  }
})();
