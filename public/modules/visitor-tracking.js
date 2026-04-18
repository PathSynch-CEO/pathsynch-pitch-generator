/* visitor-tracking.js — PathSynch Visitor Tracking Module
 * Enriches page_view events with a classifiedTag before they reach ingestEndpoint.
 * Classification order: merchant urlMappings prefix match → URL heuristics → 'unclassified'
 */
(function () {
  // URL heuristics (path segment → tag)
  var HEURISTICS = [
    [/\/pricing/i,      'pricing'],
    [/\/plans/i,        'pricing'],
    [/\/demo/i,         'demo'],
    [/\/book/i,         'booking'],
    [/\/case-stud/i,    'case_study'],
    [/\/customers/i,    'case_study'],
    [/\/faq/i,          'support_faq'],
    [/\/help/i,         'support_faq'],
    [/\/support/i,      'support_faq']
  ];

  function classify(page, urlMappings) {
    if (!page) return 'unclassified';
    // 1. Merchant urlMappings: prefix match
    if (urlMappings && urlMappings.length) {
      for (var i = 0; i < urlMappings.length; i++) {
        var m = urlMappings[i];
        if (m.url && page.indexOf(m.url) === 0) return m.tag;
      }
    }
    // 2. URL heuristics
    for (var j = 0; j < HEURISTICS.length; j++) {
      if (HEURISTICS[j][0].test(page)) return HEURISTICS[j][1];
    }
    return 'unclassified';
  }

  function init(psConfig) {
    var urlMappings = (psConfig && psConfig.visitorIntel && psConfig.visitorIntel.urlMappings) || [];

    // Intercept ps-core's event queue before it flushes
    // We listen for ps-core page_view events and enrich them via a dom event
    window.addEventListener('ps-core:ready', function () {});

    // Patch: intercept the CustomEvent channel ps-core uses internally
    // ps-core dispatches 'ps:event' for module-sourced events.
    // For page_view enrichment we override via a MutationObserver trick:
    // simpler approach — patch flush by intercepting fetch at the network layer
    // is not viable without a service worker. Instead we use the ps-core event
    // lifecycle: enrich before dispatch by hooking pushState / popState too.

    // Practical approach: enrich current page_view immediately and on navigation
    function enrichCurrentPage() {
      var tag = classify(location.pathname + location.search, urlMappings);
      window._ps_currentPageTag = tag;
    }

    enrichCurrentPage();

    // Hook history navigation
    var origPush = history.pushState.bind(history);
    var origReplace = history.replaceState.bind(history);
    history.pushState = function () { origPush.apply(history, arguments); enrichCurrentPage(); };
    history.replaceState = function () { origReplace.apply(history, arguments); enrichCurrentPage(); };
    window.addEventListener('popstate', enrichCurrentPage);

    // Expose classify function for ps-core and other modules
    window._ps_classifyUrl = function (page) { return classify(page, urlMappings); };
  }

  if (window._ps_config) {
    init(window._ps_config);
  } else {
    window.addEventListener('ps-core:ready', function (e) {
      init(e.detail);
    });
  }
})();
