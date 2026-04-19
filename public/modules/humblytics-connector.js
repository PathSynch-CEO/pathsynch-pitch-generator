/* humblytics-connector.js — PathSynch Humblytics Module
 * Initializes Humblytics analytics with the merchant's site token.
 * Humblytics tracks its own events independently — ps-core events are NOT piped in.
 * Exits silently if token is null, missing, or not exactly 7 alphanumeric characters.
 */
(function () {
  function init(psConfig) {
    var token = psConfig && psConfig.humblyticsSiteToken;

    // Validate token: must be present and exactly 7 alphanumeric characters
    if (!token || !/^[a-zA-Z0-9]{7}$/.test(token)) {
      return; // silent exit
    }

    // Dynamically load Humblytics with token in query string
    var s = document.createElement('script');
    s.async = true;
    s.src = 'https://app.humblytics.com/hmbl.min.js?id=' + token;
    var first = document.getElementsByTagName('script')[0];
    first.parentNode.insertBefore(s, first);
  }

  if (window._ps_config) {
    init(window._ps_config);
  } else {
    window.addEventListener('ps-core:ready', function (e) {
      init(e.detail);
    });
  }
})();
