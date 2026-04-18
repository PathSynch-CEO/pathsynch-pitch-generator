/* review-widget.js — PathSynch Review Widget Module
 * Loaded conditionally by ps-core.js when config.modules.reviewWidget is true.
 * Fires events back to the ps-core event bus. Does NOT own session/cookie logic.
 */
(function () {
  var PROXY_URL = 'https://cdn.qrsyn.ch/widget/widget-proxy.html';

  function init(psConfig) {
    var widgetId = psConfig && psConfig.synchIntroSnippetKey;
    if (!widgetId) return;

    var iframeId = 'ps-widget-' + widgetId;
    // Avoid double-init
    if (document.getElementById(iframeId)) return;

    // Build iframe
    var iframe = document.createElement('iframe');
    iframe.id          = iframeId;
    iframe.src         = PROXY_URL + '?wid=' + widgetId;
    iframe.width       = '100%';
    iframe.height      = '600';
    iframe.frameBorder = '0';
    iframe.title       = 'Customer Reviews';
    iframe.style.cssText = 'border:none;background:transparent;display:block;width:100%;transition:height .3s ease';

    // Find mount point or append to body
    var mount = document.querySelector('[data-ps-review-widget]') || document.body;
    mount.appendChild(iframe);

    // Auto-resize
    iframe.addEventListener('load', function () {
      try {
        var ro = new ResizeObserver(function (entries) {
          iframe.style.height = entries[0].contentRect.height + 'px';
        });
        ro.observe(iframe.contentDocument.body);
      } catch (e) {}
    });

    window.addEventListener('message', function (e) {
      if (!e.data) return;
      if (e.data.type === 'PATHSYNCH_RESIZE') {
        iframe.style.height = e.data.height + 'px';
      }
      // Fire events back to ps-core bus
      if (e.data.type === 'PS_REVIEW_PROMPT_SHOWN') {
        window.dispatchEvent(new CustomEvent('ps:event', {
          detail: { type: 'review_prompt_shown', widgetId: widgetId,
                    timestamp: new Date().toISOString() }
        }));
      }
      if (e.data.type === 'PS_REVIEW_PROMPT_CLICKED') {
        window.dispatchEvent(new CustomEvent('ps:event', {
          detail: { type: 'review_prompt_clicked', widgetId: widgetId,
                    timestamp: new Date().toISOString() }
        }));
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
