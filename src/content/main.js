/**
 * main.js
 * --------
 * Entry point / orchestrator. Detects the page, honors the on/off toggle
 * (stored in chrome.storage.local by the popup), mounts the filter UI above
 * the results, and continuously discovers cards (including lazily-loaded
 * ones) while keeping the UI in sync.
 *
 * The whole feature can be enabled/disabled live without a reload: it listens
 * for storage changes and tears everything down / rebuilds accordingly.
 */
(function () {
  "use strict";
  const WNF = window.__WNF || {};
  const store = WNF.store;

  const page = WNF.detectPage();
  if (!page) return; // unsupported URL
  store.page = page;

  // --- lifecycle state we need to be able to tear down ---
  let active = false;
  let observer = null;
  let poll = null;
  let refreshTimer = null;
  let unsubscribe = null;

  /** Handle bulk list payloads forwarded by the MAIN-world network hook. */
  function bulkMessageHandler(e) {
    if (e.source !== window) return;
    const d = e.data;
    if (!d || d.__wnf !== "booklist") return;
    if (active && WNF.cards) WNF.cards.ingestListResponse(d.url, d.data);
  }

  // Debounce UI refreshes so a burst of metadata arrivals coalesces.
  function scheduleRefresh() {
    if (refreshTimer) return;
    refreshTimer = setTimeout(() => {
      refreshTimer = null;
      if (active) WNF.ui.refresh();
    }, 150);
  }

  /**
   * Build the UI, scan existing cards, and start observing for new ones.
   * @param {number} attempt retry counter while waiting for the results anchor
   */
  function enable(attempt) {
    if (active) return;
    const anchor = document.querySelector(page.anchorSelector);
    if (!anchor) {
      if ((attempt || 0) < 40)
        return void setTimeout(() => enable((attempt || 0) + 1), 250);
      return; // give up after ~10s
    }
    active = true;

    // Tag <html> with the page type so wide-mode CSS can scope precisely.
    document.documentElement.classList.add("wnf-page-" + page.type);

    // Tag pages carry chapters + rating in their list payload, so bulk data is
    // authoritative there and per-book calls become the exception.
    store.bulkMode = page.type === "tag";

    // Receive bulk list data captured by the MAIN-world network hook.
    window.addEventListener("message", bulkMessageHandler);

    unsubscribe = store.subscribe((reason) => {
      if (reason === "cards" || reason === "meta") scheduleRefresh();
      if (reason === "progress") WNF.ui.setBusy(store.pending);
    });

    WNF.ui.mount(anchor);
    WNF.cards.scan();
    if (WNF.taglazy) WNF.taglazy.init();
    let scanTimer = null;
    observer = new MutationObserver(() => {
      if (scanTimer) return;
      scanTimer = setTimeout(() => {
        scanTimer = null;
        WNF.cards.scan();
      }, 120);
    });
    observer.observe(document.body, { childList: true, subtree: true });

    // Safety re-scan a few times for anything the observer missed early on.
    let n = 0;
    poll = setInterval(() => {
      WNF.cards.scan();
      if (++n >= 10 && poll) {
        clearInterval(poll);
        poll = null;
      }
    }, 1000);
  }

  /** Remove all injected UI / badges / classes and stop all timers. */
  function disable() {
    if (!active) return;
    active = false;
    if (observer) observer.disconnect(), (observer = null);
    if (poll) clearInterval(poll), (poll = null);
    if (refreshTimer) clearTimeout(refreshTimer), (refreshTimer = null);
    if (unsubscribe) unsubscribe(), (unsubscribe = null);
    if (WNF.taglazy) WNF.taglazy.teardown();
    window.removeEventListener("message", bulkMessageHandler);

    document.querySelectorAll(".wnf-root").forEach((n) => n.remove());
    document.querySelectorAll(".wnf-badge").forEach((n) => n.remove());
    document.querySelectorAll("[data-wnf-tracked]").forEach((n) => {
      n.removeAttribute("data-wnf-tracked");
      n.removeAttribute("data-wnf-book-id");
    });
    document
      .querySelectorAll(".wnf-hidden")
      .forEach((n) => n.classList.remove("wnf-hidden"));
    document.documentElement.classList.remove(
      "wnf-wide",
      "wnf-page-" + page.type
    );

    // Reset in-memory state so a later re-enable starts clean.
    store.cards.length = 0;
    store.meta.clear();
    store.filters = store.defaultFilters();
    if (WNF.layout) WNF.layout.setWide(false);
  }

  /**
   * Read the enabled flag and react. Defaults to ON when unset or when the
   * storage API is unavailable.
   */
  function applyEnabledState() {
    try {
      chrome.storage.local.get({ enabled: true }, (res) => {
        if (res.enabled === false) disable();
        else enable(0);
      });
    } catch (e) {
      enable(0); // storage unavailable -> just run
    }
  }

  // React to the popup toggling the flag.
  try {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === "local" && changes.enabled) {
        if (changes.enabled.newValue === false) disable();
        else enable(0);
      }
    });
  } catch (e) {
    /* storage API not present; ignore */
  }

  applyEnabledState();
})();
