/**
 * taglazy.js
 * -----------
 * Take-over lazy loader for TAG pages.
 *
 * Webnovel's own infinite scroll on tag pages fetches the next page fine but
 * then crashes while rendering it ("swapHref is not defined" — a bug in their
 * EJS template scope), so no new books appear. Because we already know the
 * exact endpoint (`seo/getTagBookList`), we fetch the next pages ourselves and
 * append natively-styled cards, which our normal scan/enrich/filter pipeline
 * then picks up.
 *
 * Only tag pages are affected by the site bug; search and ranking lazy-load
 * natively, so this module is a no-op there.
 */
(function () {
  "use strict";
  const WNF = (window.__WNF = window.__WNF || {});
  const store = WNF.store;
  const PAGE_SIZE = 20;
  const SVG_NS = "http://www.w3.org/2000/svg";
  const XLINK = "http://www.w3.org/1999/xlink";

  /** @type {object|null} loader state for the current page */
  let state = null;

  /** Build one `<svg><use #i-star></svg>` star, using the site's sprite. */
  function star(cls) {
    const s = document.createElementNS(SVG_NS, "svg");
    if (cls) s.setAttribute("class", cls);
    const u = document.createElementNS(SVG_NS, "use");
    u.setAttributeNS(XLINK, "xlink:href", "#i-star");
    u.setAttribute("href", "#i-star");
    s.appendChild(u);
    return s;
  }

  /** Render a 5-star row from a 0-5 score, matching the native markup. */
  function stars(score) {
    const wrap = document.createElement("span");
    wrap.className = "g_star";
    for (let i = 1; i <= 5; i++) {
      let cls = "";
      if (score >= i) cls = "_on";
      else if (score >= i - 0.5) cls = "_half";
      wrap.appendChild(star(cls));
    }
    return wrap;
  }

  /** Slugify a book name for the (cosmetic) /book/<slug>_<id> URL. */
  function slugify(name) {
    const s = (name || "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80);
    return s || "book";
  }

  /**
   * Build a native-looking tag card `<li>` from an API item. Uses textContent
   * for all user-supplied strings (no innerHTML) to avoid injection.
   * @param {object} item one entry from data.items[]
   */
  function buildCard(item) {
    const id = String(item.bookId);
    const url = "/book/" + slugify(item.bookName) + "_" + id;
    const cover =
      "//book-pic.webnovel.com/bookcover/" +
      id +
      "?imageMogr2/thumbnail/150x&imageId=" +
      (item.bookCoverId || item.coverUpdateTime || "");

    const li = document.createElement("li");
    li.className = "g_col _6 wnf-added";
    const box = document.createElement("div");
    box.className = "g_book_item";
    box.setAttribute("data-report-did", id);

    const aCover = document.createElement("a");
    aCover.className = "c_000";
    aCover.href = url;
    aCover.title = item.bookName || "";
    const thumb = document.createElement("i");
    thumb.className = "g_thumb g_thumb_bg pa l0 oh";
    const img = document.createElement("img");
    img.setAttribute("cross-origin", "anonymous");
    img.src = cover;
    img.width = 140;
    img.height = 186;
    img.alt = item.bookName || "";
    thumb.appendChild(img);
    const h3 = document.createElement("h3");
    h3.className = "mb8 pt4 g_h3 fs20 lh24 fw700 pl1 ells _2 lh24";
    h3.textContent = item.bookName || "";
    aCover.appendChild(thumb);
    aCover.appendChild(h3);

    const pTags = document.createElement("p");
    pTags.className = "c_s mb8 g_tags";
    (item.tagInfo || []).slice(0, 12).forEach((t) => {
      const tn = t.enTagName || t.tagName || "";
      if (!tn) return;
      const a = document.createElement("a");
      a.href = "/tags/" + tn.toLowerCase() + "-novel";
      a.title = tn + " Stories";
      a.textContent = tn;
      pTags.appendChild(a);
      pTags.appendChild(document.createTextNode(" "));
    });

    const pStar = document.createElement("p");
    pStar.className = "g_star_num mb4";
    if (item.totalScore) {
      pStar.appendChild(stars(Number(item.totalScore)));
      const small = document.createElement("small");
      small.textContent = " " + Number(item.totalScore).toFixed(2);
      pStar.appendChild(small);
    }

    const aDesc = document.createElement("a");
    aDesc.href = url;
    aDesc.className = "fs16 lh1.5 c_000 oh _txt";
    aDesc.title = item.description || "";
    aDesc.textContent = item.description || "";

    box.appendChild(aCover);
    box.appendChild(pTags);
    box.appendChild(pStar);
    box.appendChild(aDesc);
    li.appendChild(box);
    return li;
  }

  /** Collect bookIds already present in the grid, to avoid duplicates. */
  function existingIds() {
    const set = new Set();
    document
      .querySelectorAll('ul.g_row > li [data-report-did], ul.g_row > li a[href*="/book/"]')
      .forEach((el) => {
        const id =
          el.getAttribute("data-report-did") ||
          ((el.getAttribute("href") || "").match(/_(\d{6,})/) || [])[1];
        if (id) set.add(String(id));
      });
    return set;
  }

  /** Is the element within ~600px of the viewport bottom? */
  function nearViewport(el) {
    const r = el.getBoundingClientRect();
    return r.top < window.innerHeight + 600;
  }

  /** Build the getTagBookList URL for a given page index. */
  function pageUrl(pageIndex) {
    return (
      "/go/pcm/seo/getTagBookList?_csrfToken=" +
      encodeURIComponent(WNF.api.csrfToken()) +
      "&order=" +
      state.order +
      "&pageIndex=" +
      pageIndex +
      "&tagName=" +
      encodeURIComponent(state.tagName) +
      "&type=" +
      state.type
    );
  }

  /**
   * Fetch a page purely for its bulk metadata (no card rendering). Used for the
   * server-rendered first page, which the site never requests via the API.
   * @param {number} pageIndex
   */
  async function fetchPageBulk(pageIndex) {
    try {
      const res = await fetch(pageUrl(pageIndex), {
        headers: { Accept: "application/json" },
        credentials: "include",
      });
      const json = await res.json();
      if (json && json.code === 0 && json.data) {
        WNF.cards.mergeBulk(json.data.items || []);
      }
    } catch (e) {
      /* best-effort; ignore */
    }
  }

  /** Fetch + append the next page. Chains while the sentinel stays in view. */
  async function loadNext() {
    if (!state || state.loading || state.done) return;
    state.loading = true;
    let ok = false;
    try {
      const res = await fetch(pageUrl(state.pageIndex), {
        headers: { Accept: "application/json" },
        credentials: "include",
      });
      const json = await res.json();
      const items = (json && json.data && json.data.items) || [];
      const ul = document.querySelector("ul.g_row");
      if (json && json.code === 0 && ul) {
        const have = existingIds();
        const frag = document.createDocumentFragment();
        items.forEach((it) => {
          const id = String(it.bookId);
          if (have.has(id)) return;
          have.add(id);
          frag.appendChild(buildCard(it));
        });
        ul.appendChild(frag);
        state.pageIndex++;
        if (json.data.isLast || items.length < PAGE_SIZE) state.done = true;
        WNF.cards.mergeBulk(items); // feed bulk metadata (chapters/rating/tags)
        WNF.cards.scan(); // discover + enrich the new cards
        WNF.filters.apply(); // hide non-matching cards now so the visible count below is accurate
        ok = true;
      } else {
        state.done = true;
      }
    } catch (e) {
      console.warn("[WNF] tag lazy-load failed", e.message);
      // leave state.done false; the IntersectionObserver will retry on scroll
    } finally {
      state.loading = false;
    }
    // Auto-load only until the visible (unfiltered) results roughly fill the
    // screen, and cap the burst so an aggressive filter with few matches can't
    // runaway-load the whole tag. Scrolling to the sentinel starts a fresh burst.
    if (ok && !state.done && state.sentinel && nearViewport(state.sentinel)) {
      const visible = document.querySelectorAll(
        "ul.g_row > li:not(.wnf-hidden)"
      ).length;
      state.burst = (state.burst || 0) + 1;
      if (visible < 30 && state.burst < 8) requestAnimationFrame(loadNext);
    }
  }

  /** Work out tagName / type / order for the current tag page. */
  function detectParams() {
    let slug = location.pathname.replace(/^\/tags\//, "").replace(/[/?#].*$/, "");
    let type = 1;
    if (/-fanfic$/.test(slug)) {
      type = 4;
      slug = slug.replace(/-fanfic$/, "");
    } else if (/-novel$/.test(slug)) {
      type = 1;
      slug = slug.replace(/-novel$/, "");
    }
    // The report attribute carries the canonical tag key (handles multi-word).
    const pdid = document
      .querySelector("[data-report-pdid]")
      ?.getAttribute("data-report-pdid");
    const tagName = pdid || slug;
    // Active Popular/New tab -> order.
    const on = document.querySelector(".j_list_tab a._on");
    const order = on && /new/i.test(on.textContent) ? 2 : 1;
    return { tagName, type, order };
  }

  /** Start the take-over loader (tag pages only). */
  function init() {
    if (!store.page || store.page.type !== "tag" || state) return;
    const ul = document.querySelector("ul.g_row");
    if (!ul) return;

    const existing = document.querySelectorAll("ul.g_row > li").length;
    state = Object.assign(detectParams(), {
      pageIndex: Math.floor(existing / PAGE_SIZE) + 1,
      loading: false,
      done: false,
      burst: 0,
    });

    // Bottom sentinel + observer to trigger loads before the user hits the end.
    const sentinel = document.createElement("div");
    sentinel.className = "wnf-sentinel";
    sentinel.style.cssText = "width:100%;height:1px;";
    ul.parentNode.insertBefore(sentinel, ul.nextSibling);
    state.sentinel = sentinel;
    state.observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          state.burst = 0; // user reached the sentinel; allow a fresh auto-load run
          loadNext();
        }
      },
      { rootMargin: "600px" }
    );
    state.observer.observe(sentinel);

    // The first page is server-rendered (no API call), so grab its bulk
    // metadata once to enrich those cards without per-book requests.
    fetchPageBulk(1);
  }

  /** Stop the loader and remove the cards/sentinel we added. */
  function teardown() {
    if (!state) return;
    if (state.observer) state.observer.disconnect();
    if (state.sentinel) state.sentinel.remove();
    document.querySelectorAll("ul.g_row > li.wnf-added").forEach((n) => n.remove());
    state = null;
  }

  WNF.taglazy = { init, teardown };
})();
