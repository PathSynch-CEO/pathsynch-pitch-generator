/* qr-referral.js — PathSynch QR & Referral Attribution Module
 * Fires qr_entry or referral_link_entry events to the ps-core bus.
 * Stores attribution in sessionStorage for cross-page continuity.
 */
(function () {
  var SS_QR  = '_ps_qr_scan_id';
  var SS_REF = '_ps_ref_code';

  function getParam(name) {
    try {
      return new URLSearchParams(location.search).get(name);
    } catch (e) {
      var match = location.search.match(new RegExp('[?&]' + name + '=([^&]+)'));
      return match ? decodeURIComponent(match[1]) : null;
    }
  }

  function fireEvent(type, payload) {
    // Dispatch on the ps-core custom event channel
    window.dispatchEvent(new CustomEvent('ps:event', {
      detail: Object.assign({ type: type, timestamp: new Date().toISOString() }, payload)
    }));
  }

  function init() {
    var qrScanId   = getParam('ps_qr');
    var referralCode = getParam('ps_ref');

    if (qrScanId) {
      sessionStorage.setItem(SS_QR, qrScanId);
      fireEvent('qr_entry', { qrScanId: qrScanId, page: location.pathname });
    } else {
      // Restore from sessionStorage for cross-page continuity
      var storedQr = sessionStorage.getItem(SS_QR);
      if (storedQr) {
        fireEvent('qr_entry', { qrScanId: storedQr, page: location.pathname, restored: true });
      }
    }

    if (referralCode) {
      sessionStorage.setItem(SS_REF, referralCode);
      fireEvent('referral_link_entry', { referralCode: referralCode, page: location.pathname });
    } else {
      var storedRef = sessionStorage.getItem(SS_REF);
      if (storedRef) {
        fireEvent('referral_link_entry', { referralCode: storedRef, page: location.pathname, restored: true });
      }
    }
  }

  // Run immediately — attribution must be captured on first load
  try {
    init();
  } catch (e) {
    // Silent fail — never break the page
  }
})();
