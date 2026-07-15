/**
 * layout.js
 * ----------
 * Optional "wide mode" that addresses the wasted horizontal space on
 * ultrawide monitors. It adds a class to <html> which the stylesheet uses to
 * expand the main content to ~90vw and pack tag-page cards into an auto-fit
 * grid (as many per row as fit) instead of the default 2-per-row.
 *
 * Kept as a simple toggle so the user can switch it off instantly if a future
 * Webnovel layout change makes it misbehave.
 */
(function () {
  "use strict";
  const WNF = (window.__WNF = window.__WNF || {});

  let enabled = false;

  /**
   * Enable or disable wide mode.
   * @param {boolean} on
   */
  function setWide(on) {
    enabled = !!on;
    document.documentElement.classList.toggle("wnf-wide", enabled);
  }

  /** @returns {boolean} current wide-mode state */
  function isWide() {
    return enabled;
  }

  WNF.layout = { setWide, isWide };
})();
