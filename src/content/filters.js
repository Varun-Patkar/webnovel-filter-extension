/**
 * filters.js
 * -----------
 * Pure-ish filtering + sorting logic. Given the current filter state and the
 * per-book metadata, it decides which tracked cards are visible, hides the
 * rest, optionally reorders them, and reports counts back to the UI.
 *
 * Cards whose metadata has not loaded yet are treated as "unknown": they are
 * only hidden if a filter they cannot possibly satisfy is active, otherwise
 * they stay visible so results are not blanked out while details stream in.
 */
(function () {
  "use strict";
  const WNF = (window.__WNF = window.__WNF || {});
  const store = WNF.store;

  /**
   * Decide whether a single card passes the active filters.
   * @param {object} meta metadata (may be partial while loading)
   * @param {object} f active filters
   * @returns {boolean}
   */
  function passes(meta, f) {
    // "has" = we have usable metadata, whether full ("done") or bulk
    // ("partial"). Tag-page cards are usually partial but already carry
    // name / chapters / rating / tags / category, so filters must accept them.
    // Field-level null checks below hide a card for the specific fields a
    // partial record lacks (views / read status / in-library) until its
    // per-book detail arrives.
    const has = meta && (meta.status === "done" || meta.status === "partial");

    // Text search.
    if (f.text) {
      if (!has) return false;
      const hay = (
        meta.bookName +
        " " +
        meta.authorName +
        " " +
        meta.description
      ).toLowerCase();
      if (!hay.includes(f.text.toLowerCase())) return false;
    }

    // Numeric constraints.
    if (f.minChapters != null) {
      if (!has || meta.chapters == null || meta.chapters < f.minChapters)
        return false;
    }
    if (f.maxChapters != null) {
      if (!has || meta.chapters == null || meta.chapters > f.maxChapters)
        return false;
    }
    if (f.minRating != null) {
      if (!has || meta.score == null || meta.score < f.minRating) return false;
    }
    if (f.minViews != null) {
      if (!has || meta.views == null || meta.views < f.minViews) return false;
    }

    // Category (empty set = all).
    if (f.categories.size) {
      if (!has || !f.categories.has(meta.categoryName)) return false;
    }

    // Tag include: every selected include-tag must be present.
    if (f.includeTags.size) {
      if (!has) return false;
      const tagSet = new Set(meta.tags);
      for (const t of f.includeTags) if (!tagSet.has(t)) return false;
    }
    // Tag exclude: none of the selected exclude-tags may be present.
    if (f.excludeTags.size && has) {
      const tagSet = new Set(meta.tags);
      for (const t of f.excludeTags) if (tagSet.has(t)) return false;
    }

    // Read status (empty set = all).
    if (f.readStatus.size) {
      if (!has || !f.readStatus.has(meta.readStatus)) return false;
    }

    // In-library tri-state.
    if (f.inLibrary !== "any") {
      if (!has) return false;
      if (f.inLibrary === "yes" && !meta.inLibrary) return false;
      if (f.inLibrary === "no" && meta.inLibrary) return false;
    }

    return true;
  }

  /** Numeric field accessor for sorting. */
  function sortValue(meta, key) {
    if (!meta || (meta.status !== "done" && meta.status !== "partial"))
      return -Infinity;
    if (key === "chapters") return meta.chapters ?? -Infinity;
    if (key === "rating") return meta.score ?? -Infinity;
    if (key === "views") return meta.views ?? -Infinity;
    return 0;
  }

  /**
   * Re-order visible cards within their container according to sort settings.
   * Only reorders when a non-default sort is active to avoid fighting the
   * site's own ordering.
   * @param {object} f filters
   */
  function applySort(f) {
    if (f.sortBy === "default" || store.cards.length === 0) return;
    const dir = f.sortDir === "asc" ? 1 : -1;
    // Group cards by their parent so we sort within each list container.
    const byParent = new Map();
    store.cards.forEach((c) => {
      const p = c.el.parentElement;
      if (!p) return;
      if (!byParent.has(p)) byParent.set(p, []);
      byParent.get(p).push(c);
    });
    byParent.forEach((cards, parent) => {
      cards
        .slice()
        .sort(
          (a, b) =>
            (sortValue(store.meta.get(a.bookId), f.sortBy) -
              sortValue(store.meta.get(b.bookId), f.sortBy)) *
            dir
        )
        .forEach((c) => parent.appendChild(c.el)); // append in new order
    });
  }

  /**
   * Apply all filters + sorting to the tracked cards.
   * @returns {{showing: number, hidden: number, total: number}}
   */
  function apply() {
    const f = store.filters;
    let showing = 0;
    store.cards.forEach(({ el, bookId }) => {
      const meta = store.meta.get(bookId);
      const ok = passes(meta || { status: "loading" }, f);
      el.classList.toggle("wnf-hidden", !ok);
      if (ok) showing++;
    });
    applySort(f);
    const total = store.cards.length;
    return { showing, hidden: total - showing, total };
  }

  WNF.filters = { apply, passes };
})();
