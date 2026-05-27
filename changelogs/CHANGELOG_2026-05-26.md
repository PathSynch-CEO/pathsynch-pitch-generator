# Changelog — May 26, 2026

## Bug Fixes

**L2 iframe popup blank body (3 cascading fixes)**

Root cause chain: S4 (May 25) changed iframe from `display:none/block` to `visibility:hidden/visible`
in the `onload` handler, but left the iframe's initial HTML attribute as `style="display: none;"`.
`visibility` has no effect on `display:none` elements — the popup header rendered but the iframe body
stayed invisible. PDF export was unaffected because it uses a separate `tempIframe` with `document.write()`.

Fixes applied in `synchintro-app/js/pitchViewer.js` (commit `f0a939a`):

1. **iframe initial attribute**: `style="display: none;"` → `style="visibility: hidden;"` (line 84)
2. **view() reset**: `iframe.style.display = 'none'` → `iframe.style.visibility = 'hidden'` (line 118)
3. **onload handler**: `iframe.style.display = 'block'` → `iframe.style.visibility = 'visible'`
4. **HTML fallback chain**: `pitch.html || pitch.htmlContent || pitch.content` — matches PDF export
   path; guards against L2 storing HTML under a different field key
5. **onload/srcdoc order fix** (May 25, separate commit): `onload` handler assigned before
   `iframe.srcdoc` is set — eliminates race where browser fires load before handler is attached

**Diagnostic log added** (temporary): `console.log('[PitchViewer] srcdoc length:', ...)` — remove
once confirmed stable in production.
