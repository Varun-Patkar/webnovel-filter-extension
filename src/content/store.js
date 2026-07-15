/**
 * store.js
 * ---------
 * Central in-memory state for the content script: per-book metadata cache,
 * the list of currently tracked DOM cards, the active filter settings, and a
 * simple pub/sub so the UI and filtering logic can react to changes.
 *
 * Nothing here is persisted. Per the product requirement, filters and caches
 * are forgotten on page reload.
 */
(function () {
  "use strict";
  const WNF = (window.__WNF = window.__WNF || {});

  /**
   * Default filter state. `null`/empty means "no constraint".
   * @returns {object} A fresh default filter object.
   */
  function defaultFilters() {
    return {
      text: "", // free text over title / author / description
      minChapters: null, // number | null
      maxChapters: null, // number | null
      minRating: null, // number | null (0-5)
      minViews: null, // number | null
      includeTags: new Set(), // tag names that MUST all be present
      excludeTags: new Set(), // tag names that must NOT be present
      categories: new Set(), // selected category names (empty = all)
      readStatus: new Set(), // subset of 'unread' | 'progress' | 'read' (empty = all)
      inLibrary: "any", // 'any' | 'yes' | 'no'
      sortBy: "default", // 'default' | 'chapters' | 'rating' | 'views'
      sortDir: "desc", // 'asc' | 'desc'
    };
  }

  const store = {
    /** @type {Map<string, object>} bookId -> normalized metadata */
    meta: new Map(),
    /** @type {Array<{el: HTMLElement, bookId: string}>} tracked cards in DOM order */
    cards: [],
    /** @type {object} active filter settings */
    filters: defaultFilters(),
    /** @type {object|null} detected page context (type + selectors) */
    page: null,
    /** @type {boolean} when true (tag pages) bulk metadata is authoritative */
    bulkMode: false,
    /** @type {number} outstanding per-book detail fetches (drives the busy spinner) */
    pending: 0,
    /** @type {Set<Function>} change listeners */
    _listeners: new Set(),

    /** Reset filters back to their defaults (Clear Filters button). */
    resetFilters() {
      this.filters = defaultFilters();
      this.emit("filters");
    },

    /**
     * Subscribe to store changes.
     * @param {(reason: string) => void} fn
     * @returns {() => void} unsubscribe
     */
    subscribe(fn) {
      this._listeners.add(fn);
      return () => this._listeners.delete(fn);
    },

    /**
     * Notify listeners that something changed.
     * @param {string} reason A short tag describing what changed.
     */
    emit(reason) {
      this._listeners.forEach((fn) => {
        try {
          fn(reason);
        } catch (e) {
          console.error("[WNF] listener error", e);
        }
      });
    },
  };

  store.defaultFilters = defaultFilters;
  WNF.store = store;
})();
