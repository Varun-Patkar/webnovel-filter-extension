/**
 * pagectx.js
 * -----------
 * Detects which supported Webnovel page type we are on and
 * exposes the CSS selectors needed to (a) find the repeating "card" elements
 * that represent books and (b) find a stable anchor to inject the filter bar
 * above the first result.
 *
 * Supported pages:
 *   - Tag pages:     /tags/<slug>            (cards: ul.g_row > li.g_col)
 *   - Search pages:  /search?keywords=...    (cards: the visible result <ul> > li)
 *   - Ranking pages: /ranking/<type>/...     (cards: .j_rank_wrapper section.g_hr)
 *   - Stories pages: /stories/<category>     (cards: .j_category_wrapper ul > li)
 */
(function () {
  "use strict";
  const WNF = (window.__WNF = window.__WNF || {});

  /**
   * Extract the numeric Webnovel bookId from a card element.
   * Tries explicit data attributes first, then falls back to parsing the
   * trailing id out of a /book/<slug>_<id> href.
   * @param {HTMLElement} el
   * @returns {string|null}
   */
  function extractBookId(el) {
    // 1) Explicit data attributes used across the various card layouts.
    const attrHost =
      el.querySelector(
        "[data-bookid],[data-bid],[data-report-did],[data-report-bid]"
      ) || el;
    const attrId =
      attrHost.getAttribute &&
      (attrHost.getAttribute("data-bookid") ||
        attrHost.getAttribute("data-bid") ||
        attrHost.getAttribute("data-report-bid") ||
        attrHost.getAttribute("data-report-did"));
    if (attrId && /^\d{6,}$/.test(attrId)) return attrId;

    // 2) Fall back to the book link: /book/<slug>_<digits>
    const link = el.querySelector('a[href*="/book/"]');
    if (link) {
      const m = link.getAttribute("href").match(/_(\d{6,})(?:[/?#]|$)/);
      if (m) return m[1];
    }
    return null;
  }

  /**
   * Determine the current page context from the URL.
   * @returns {object|null} page config, or null if unsupported.
   */
  function detectPage() {
    const path = location.pathname;

    if (path.startsWith("/tags/")) {
      return {
        type: "tag",
        // Each book is a grid cell in the main results row.
        cardSelector: "ul.g_row > li.g_col",
        // Inject the bar just before the results grid.
        anchorSelector: "ul.g_row",
        extractBookId,
      };
    }

    if (path.startsWith("/search")) {
      return {
        type: "search",
        // Search renders results as <li> rows inside a result <ul>.
        cardSelector: "ul.j_result_wrap > li, .j_result_wrap ul > li",
        anchorSelector: ".j_result_wrap, ul.j_result_wrap",
        extractBookId,
      };
    }

    if (path.startsWith("/ranking/")) {
      return {
        type: "ranking",
        cardSelector: ".j_rank_wrapper section.g_hr",
        anchorSelector: ".j_rank_wrapper",
        extractBookId,
      };
    }

    if (path === "/stories" || path.startsWith("/stories/")) {
      return {
        type: "stories",
        cardSelector: ".j_category_wrapper ul.clearfix > li",
        anchorSelector: ".j_category_wrapper ul.clearfix",
        extractBookId,
      };
    }

    return null;
  }

  WNF.detectPage = detectPage;
  WNF.extractBookId = extractBookId;
})();
