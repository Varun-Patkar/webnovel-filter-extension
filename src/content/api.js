/**
 * api.js
 * -------
 * Thin wrapper around Webnovel's per-book detail endpoint. This is the single
 * universal source of the metadata we filter on (chapters, rating, views,
 * tags, category, read status, in-library) because the tag/search/ranking
 * list payloads are inconsistent about which of these they expose.
 *
 * Requests are same-origin (the content script runs on webnovel.com) so the
 * user's login cookies are sent automatically, which is what makes the
 * read-status / in-library fields personal and accurate.
 */
(function () {
  "use strict";
  const WNF = (window.__WNF = window.__WNF || {});

  /** Read the CSRF token Webnovel stores in a cookie of the same name. */
  function csrfToken() {
    const m = document.cookie.match(/_csrfToken=([^;]+)/);
    return m ? m[1] : "";
  }

  /**
   * Derive a coarse reading-status bucket from the detail payload.
   *
   * NOTE: `curReadChapter` is treated as a 1-based chapter index. If testing
   * while logged in shows different semantics, this is the single place to
   * adjust the mapping.
   *
   * @param {object} data The `data` object from get-book-detail.
   * @param {number|null} chapters Total chapter count.
   * @returns {'unread'|'progress'|'read'} bucket
   */
  function readStatusOf(data, chapters) {
    const cur = Number(data && data.curReadChapter) || 0;
    if (cur <= 0) return "unread";
    if (chapters && cur >= chapters) return "read";
    return "progress";
  }

  /**
   * Fetch and normalize metadata for a single book.
   * @param {string} bookId
   * @returns {Promise<object>} normalized metadata (see fields below)
   */
  async function fetchBookMeta(bookId) {
    const url =
      "/go/pcm/book/get-book-detail?_csrfToken=" +
      encodeURIComponent(csrfToken()) +
      "&bookId=" +
      encodeURIComponent(bookId);

    const res = await fetch(url, {
      headers: { Accept: "application/json" },
      credentials: "include",
    });
    if (!res.ok) throw new Error("HTTP " + res.status);
    const json = await res.json();
    if (!json || json.code !== 0 || !json.data || !json.data.bookInfo) {
      throw new Error("bad payload for " + bookId);
    }

    const bi = json.data.bookInfo;
    const chapters =
      bi.totalChapterNum != null
        ? Number(bi.totalChapterNum)
        : bi.chapterNum != null
        ? Number(bi.chapterNum)
        : null;

    return {
      bookId: String(bookId),
      bookName: bi.bookName || "",
      authorName: bi.authorName || "",
      categoryName: bi.categoryName || "",
      categoryId: bi.categoryId || null,
      description: bi.description || "",
      chapters,
      score: bi.totalScore != null ? Number(bi.totalScore) : null,
      voters: bi.voters != null ? Number(bi.voters) : null,
      views: bi.pvNum != null ? Number(bi.pvNum) : null,
      tags: Array.isArray(bi.tagInfos)
        ? bi.tagInfos.map((t) => (t.tagName || "").toUpperCase()).filter(Boolean)
        : [],
      publishTime: bi.publishTime || null,
      updateTime: bi.updateTime || null,
      inLibrary: !!bi.inLibrary,
      readStatus: readStatusOf(json.data, chapters),
      status: "done",
    };
  }

  WNF.api = { csrfToken, fetchBookMeta, readStatusOf, normalizeBulk };

  /**
   * Normalize a bulk list item (from getTagBookList / search / getRankList)
   * into a PARTIAL metadata record. Fields the list payloads never carry
   * (views, read status, in-library) are left null and filled later by the
   * per-book fallback only when actually needed.
   * @param {object} item raw list item
   * @returns {object} partial metadata (status: "partial")
   */
  function normalizeBulk(item) {
    const chapters =
      item.chapterNum != null
        ? Number(item.chapterNum)
        : item.totalChapterNum != null
        ? Number(item.totalChapterNum)
        : null;
    return {
      bookId: String(item.bookId),
      bookName: item.bookName || "",
      authorName: item.authorName || "",
      categoryName: item.categoryName || "",
      description: item.description || "",
      chapters,
      score: item.totalScore != null ? Number(item.totalScore) : null,
      voters: null,
      views: null,
      tags: Array.isArray(item.tagInfo)
        ? item.tagInfo
            .map((t) => (t.enTagName || t.tagName || "").toUpperCase())
            .filter(Boolean)
        : [],
      publishTime: item.publishTime || null,
      updateTime: null,
      inLibrary: null,
      readStatus: null,
      status: "partial",
    };
  }
})();
