/**
 * cards.js
 * ---------
 * Responsible for the DOM side of things:
 *   - discovering the repeating "card" elements for the current page type
 *   - mapping each card to a bookId and tracking it in the store
 *   - enqueuing metadata fetches (throttled) for newly seen books
 *   - drawing small "chapter / rating" badges onto each card once its
 *     metadata has arrived (the data Webnovel loads but never shows)
 *
 * A MutationObserver keeps this working as the page lazily loads more cards
 * on scroll.
 */
(function () {
  "use strict";
  const WNF = (window.__WNF = window.__WNF || {});
  const store = WNF.store;

  // Limit concurrent detail requests so we stay gentle on Webnovel's servers.
  const queue = WNF.createQueue(4);

  // Count of per-book detail fetches still in flight. Drives the bar's "busy"
  // spinner so the user knows the filtered counts are still settling.
  function bumpBusy(delta) {
    store.pending = Math.max(0, store.pending + delta);
    store.emit("progress");
  }

  /** Format a large number compactly, e.g. 2913013 -> "2.9M". */
  function compact(n) {
    if (n == null) return "?";
    if (n >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, "") + "M";
    if (n >= 1e3) return (n / 1e3).toFixed(1).replace(/\.0$/, "") + "K";
    return String(n);
  }

  /**
   * Inject (or update) the little metadata badge row on a card.
   * @param {HTMLElement} el card element
   * @param {object} meta normalized metadata
   */
  function drawBadge(el, meta) {
    let badge = el.querySelector(":scope .wnf-badge");
    if (!badge) {
      badge = document.createElement("div");
      badge.className = "wnf-badge";
      el.appendChild(badge);
    }
    const parts = [];
    parts.push(
      '<span class="wnf-b wnf-b-ch" title="Chapters">📖 ' +
        (meta.chapters != null ? meta.chapters : "?") +
        "</span>"
    );
    if (meta.score != null && meta.score > 0) {
      parts.push(
        '<span class="wnf-b wnf-b-star" title="Rating">★ ' +
          meta.score.toFixed(2) +
          "</span>"
      );
    }
    if (meta.views != null && meta.views > 0) {
      parts.push(
        '<span class="wnf-b" title="Views">👁 ' + compact(meta.views) + "</span>"
      );
    }
    if (meta.readStatus && meta.readStatus !== "unread") {
      const label = meta.readStatus === "read" ? "✓ Read" : "▸ Reading";
      parts.push('<span class="wnf-b wnf-b-read">' + label + "</span>");
    }
    if (meta.inLibrary) {
      parts.push('<span class="wnf-b wnf-b-lib" title="In your library">♥</span>');
    }
    badge.innerHTML = parts.join("");
  }

  /** Draw a lightweight "loading" placeholder badge. */
  function drawLoading(el) {
    if (el.querySelector(":scope .wnf-badge")) return;
    const badge = document.createElement("div");
    badge.className = "wnf-badge wnf-badge-loading";
    badge.innerHTML = '<span class="wnf-b">📖 …</span>';
    el.appendChild(badge);
  }

  // -------------------------------------------------------------------
  // Enrichment policy
  //
  // Tier 1 (bulk): metadata captured from the site's own list responses and
  // our own tag fetches (see mergeBulk / ingestListResponse). Cheap — ~1
  // request per 20 books — and enough for chapters (tag), rating (tag/search),
  // tags and category.
  //
  // Tier 2 (per-book): /book/get-book-detail, called ONLY when bulk cannot
  // answer what the current view needs (chapters on search/ranking, rating on
  // ranking, or any read-status / in-library / views filter).
  // -------------------------------------------------------------------

  /** True when a filter/sort that only the per-book detail can satisfy is on. */
  function detailOnlyFilterActive() {
    const f = store.filters;
    return !!(
      f.readStatus.size ||
      f.inLibrary !== "any" ||
      f.minViews != null ||
      f.sortBy === "views"
    );
  }

  /**
   * Decide whether a given book still needs a per-book detail fetch.
   * @param {string} bookId
   * @returns {boolean}
   */
  function needDetail(bookId) {
    const m = store.meta.get(bookId);
    if (m && (m.status === "done" || m.status === "loading")) return false;
    if (detailOnlyFilterActive()) return true;

    // On tag pages bulk is authoritative (it carries chapters + rating), so
    // with no detail-only filter we never hit the per-book endpoint.
    if (store.bulkMode) return false;

    const f = store.filters;
    const hasChapters = m && m.chapters != null;
    if (!hasChapters) return true; // chapters are essential everywhere
    if ((f.minRating != null || f.sortBy === "rating") && !(m && m.score != null))
      return true;
    return false;
  }

  /** Start a throttled per-book detail fetch for a book (idempotent). */
  function enqueueDetail(el, bookId) {
    const prev = store.meta.get(bookId);
    if (prev && (prev.status === "loading" || prev.status === "done")) return;
    // Keep partial fields around while the detail request is in flight.
    store.meta.set(bookId, Object.assign({}, prev, { bookId, status: "loading" }));
    if (!el.querySelector(":scope .wnf-badge")) drawLoading(el);

    bumpBusy(1);
    queue
      .add(() => WNF.api.fetchBookMeta(bookId))
      .then((meta) => {
        store.meta.set(bookId, meta);
        store.cards
          .filter((c) => c.bookId === bookId)
          .forEach((c) => drawBadge(c.el, meta));
        store.emit("meta");
      })
      .catch((err) => {
        // Fall back to whatever bulk data we already had, if any.
        store.meta.set(
          bookId,
          Object.assign({}, prev, {
            bookId,
            status: prev ? "partial" : "error",
          })
        );
        if (!prev) {
          const b = el.querySelector(":scope .wnf-badge");
          if (b) b.innerHTML = '<span class="wnf-b wnf-b-err">⚠</span>';
        }
        console.warn("[WNF] detail fetch failed", bookId, err.message);
      })
      .finally(() => bumpBusy(-1));
  }

  /** Apply the enrichment policy for one card. */
  function enrich(el, bookId) {
    const cached = store.meta.get(bookId);
    if (cached && (cached.status === "done" || cached.status === "partial"))
      drawBadge(el, cached);
    else drawLoading(el);
    if (needDetail(bookId)) enqueueDetail(el, bookId);
  }

  /**
   * Merge an array of bulk list items into the metadata cache and refresh any
   * cards they belong to. Never overwrites full ("done") or in-flight
   * ("loading") records.
   * @param {Array<object>} items raw list items
   */
  function mergeBulk(items) {
    if (!Array.isArray(items) || !items.length) return;
    let changed = 0;
    items.forEach((it) => {
      if (!it || it.bookId == null) return;
      const id = String(it.bookId);
      const ex = store.meta.get(id);
      if (ex && (ex.status === "done" || ex.status === "loading")) return;
      const nb = WNF.api.normalizeBulk(it);
      if (ex && ex.status === "partial") {
        if (ex.chapters != null) nb.chapters = ex.chapters;
        if (ex.score != null) nb.score = ex.score;
        if (ex.tags && ex.tags.length > nb.tags.length) nb.tags = ex.tags;
      }
      store.meta.set(id, nb);
      changed++;
      store.cards
        .filter((c) => c.bookId === id)
        .forEach((c) => {
          drawBadge(c.el, nb);
          if (needDetail(id)) enqueueDetail(c.el, id);
        });
    });
    if (changed) store.emit("meta");
  }

  /**
   * Pull the book arrays out of a captured list response and merge them.
   * @param {string} url request URL (identifies the payload shape)
   * @param {object} json parsed response body
   */
  function ingestListResponse(url, json) {
    const d = (json && json.data) || {};
    let items = [];
    if (/getTagBookList/.test(url)) items = d.items || [];
    else if (/getRankList/.test(url)) items = d.bookItems || [];
    else if (/search\/result/.test(url)) {
      items = []
        .concat((d.bookInfo && d.bookInfo.bookItems) || [])
        .concat((d.fanficBookInfo && d.fanficBookInfo.fanficBookItems) || [])
        .concat((d.comicInfo && d.comicInfo.comicItems) || []);
    }
    mergeBulk(items);
  }

  // Re-run the per-book policy across all loaded cards (used when a filter that
  // needs detail data is switched on). Debounced so rapid UI changes coalesce.
  let reconcileTimer = null;
  function reconcileDetail() {
    if (reconcileTimer) return;
    reconcileTimer = setTimeout(() => {
      reconcileTimer = null;
      if (store.bulkMode && !detailOnlyFilterActive()) return; // nothing new needed
      store.cards.forEach(({ el, bookId }) => {
        if (needDetail(bookId)) enqueueDetail(el, bookId);
      });
    }, 250);
  }

  /**
   * Scan the DOM for card elements, register new ones, and enrich them.
   * Idempotent — safe to call repeatedly.
   * @returns {number} count of newly discovered cards
   */
  function scan() {
    const page = store.page;
    if (!page) return 0;
    const els = document.querySelectorAll(page.cardSelector);
    let added = 0;
    els.forEach((el) => {
      if (el.dataset.wnfTracked === "1") return;
      const bookId = page.extractBookId(el);
      if (!bookId) return;
      el.dataset.wnfTracked = "1";
      el.dataset.wnfBookId = bookId;
      store.cards.push({ el, bookId });
      enrich(el, bookId);
      added++;
    });
    if (added) store.emit("cards");
    return added;
  }

  WNF.cards = {
    scan,
    drawBadge,
    compact,
    mergeBulk,
    ingestListResponse,
    reconcileDetail,
  };
})();
