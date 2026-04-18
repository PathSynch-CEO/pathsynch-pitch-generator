/* posthog-connector.js — PathSynch PostHog Module
 * Initializes PostHog with the merchant's project key.
 * Listens for visitor_identified events from the ps-core bus.
 * Exits silently if key is null or missing.
 */
(function () {
  function init(psConfig) {
    var key = psConfig && psConfig.postHogProjectKey;
    if (!key) return; // silent exit

    // Initialize PostHog
    !function (t, e) {
      var o, n, p, r;
      e.__SV || (window.posthog = e, e._i = [], e.init = function (i, s, a) {
        function g(t, e) {
          var o = e.split('.');
          2 == o.length && (t = t[o[0]], e = o[1]);
          t[e] = function () { t.push([e].concat(Array.prototype.slice.call(arguments, 0))); };
        }
        (p = t.createElement('script')).type = 'text/javascript';
        p.async = !0;
        p.src = s.api_host + '/static/array.js';
        (r = t.getElementsByTagName('script')[0]).parentNode.insertBefore(p, r);
        var u = e;
        a !== void 0 ? u = e[a] = [] : a = 'posthog';
        u.people = u.people || [];
        u.toString = function (t) { var e = 'posthog'; return a !== 'posthog' && (e += '.' + a), t || (e += ' (stub)'), e; };
        u.people.toString = function () { return u.toString(1) + '.people (stub)'; };
        var s_arr = 'capture identify alias people.set people.set_once set_config register register_once unregister opt_out_capturing has_opted_out_capturing opt_in_capturing reset isFeatureEnabled onFeatureFlags getFeatureFlag getFeatureFlagPayload reloadFeatureFlags group updateEarlyAccessFeatureEnrollment getEarlyAccessFeatures getActiveMatchingSurveys getSurveys onSessionId'.split(' ');
        for (var i = 0; i < s_arr.length; i++) g(u, s_arr[i]);
        e._i.push([i, s, a]);
      }, e.__SV = 1);
    }(document, window.posthog || []);

    posthog.init(key, { api_host: 'https://app.posthog.com' });

    // Listen for visitor_identified events from ps-core bus
    window.addEventListener('ps:visitor_identified', function (e) {
      var detail = e.detail || {};
      if (!detail.email) return;
      posthog.identify(detail.email);
      if (detail.companyName) {
        posthog.people.set({ company: detail.companyName });
      }
    });
  }

  if (window._ps_config) {
    init(window._ps_config);
  } else {
    window.addEventListener('ps-core:ready', function (e) {
      init(e.detail);
    });
  }
})();
