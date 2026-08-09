/**
 * wide.js
 * --------
 * Site-wide "wide mode" driver. Unlike the filter UI (which only runs on
 * tag/search/ranking pages), this tiny script is injected on EVERY Webnovel
 * page at document_start. It reads the persisted `wide` flag from
 * chrome.storage.local, toggles the `html.wnf-wide` class that wide.css keys
 * off, and watches for live changes from the toolbar popup — so flipping the
 * switch reflows every open Webnovel tab instantly without a reload.
 *
 * It is intentionally self-contained (no dependency on the __WNF namespace or
 * the other content scripts) because it must load and act far earlier and on
 * many more URLs than the filter bundle.
 */
(function () {
  "use strict";

  /**
   * Add or remove the wide-mode class on <html>.
   * @param {boolean} on
   */
  function apply(on) {
    // documentElement always exists at document_start, so this is safe here.
    document.documentElement.classList.toggle("wnf-wide", !!on);
  }

  // Initial paint from stored state (default OFF so we never surprise users).
  try {
    chrome.storage.local.get({ wide: false }, (res) => apply(res.wide === true));
  } catch (e) {
    /* storage unavailable — leave default (narrow) layout untouched */
  }

  // React to popup toggles (and changes from other tabs) in real time.
  try {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === "local" && changes.wide)
        apply(changes.wide.newValue === true);
    });
  } catch (e) {
    /* no storage change events available — initial state still applies */
  }
})();
