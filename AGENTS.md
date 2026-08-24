# AGENTS.md — notes for AI assistants working on this repo

## What this is

A Manifest V3 Chrome extension (vanilla JS, **no build step**) that injects an
advanced client-side filter UI into four Webnovel page types and widens the
layout. Pure frontend; runs entirely in the content-script context.

## Architecture

Content scripts load in order (see `manifest.json`) and share a single
namespace object `window.__WNF` (MV3 content scripts share one isolated-world
global but not lexical scope, so each file hangs its module off `__WNF`).

| File | Responsibility |
|------|----------------|
| `src/lib/queue.js` | Concurrency-limited task queue (`WNF.createQueue`). |
| `src/content/store.js` | In-memory state: `meta` cache, tracked `cards`, `filters`, pub/sub. |
| `src/content/pagectx.js` | Detect tag/search/ranking/stories pages; per-type card/anchor selectors; `extractBookId`. |
| `src/content/api.js` | `get-book-detail` fetch + normalization; read-status mapping. |
| `src/content/cards.js` | Discover cards, enqueue enrichment, draw metadata badges. |
| `src/content/filters.js` | Filter predicate + sort + counts. |
| `src/content/wide.js` | Site-wide wide-mode driver: injected on **all** Webnovel pages at `document_start`; reads/watches `storage.wide` and toggles `html.wnf-wide`. |
| `src/content/taglazy.js` | Take-over lazy loader for tag pages (works around the site's broken renderer). |
| `src/content/ui/panel.js` | Builds the bar/panel, owns the apply cycle. |
| `src/content/main.js` | Orchestrator: detect → gate on `storage.enabled` → mount → scan → observe; supports live enable/disable teardown. |
| `src/styles/panel.css` | Filter UI + badge + per-page wide-mode grid styles (namespaced `.wnf-*`; loads on tag/search/ranking/stories). |
| `src/styles/wide.css` | Site-wide wide-mode overrides (capped 90vw); loads on all pages, gated by `html.wnf-wide`. |
| `src/popup/popup.{html,css,js}` | Toolbar popup: master on/off switch (`storage.enabled`) + persisted **Wide layout** switch (`storage.wide`). |
| `icons/icon-source.html` | SVG source; rendered to `icons/icon{16,48,128}.png`. |

Wide mode is a persisted, site-wide toggle. The **Wide layout** switch in the
popup writes `chrome.storage.local.wide`; `wide.js` (injected on every
`webnovel.com/*` page at `document_start`) toggles `html.wnf-wide` and lives
independently of the filter enable/disable lifecycle. `wide.css` applies the
general overrides everywhere, capped at 90vw (5vw margins): it widens Webnovel's
standard fixed-width centered wrappers `.g_wrap` + `.g_row` (home, book detail,
category, …) and the chapter reader column `#page.cha-page` + `.cha-page-in`, so
no page overflows (verified live 2026-08 on home/book-detail/chapter). The
homepage gets an `html.wnf-home` marker and caps its wide canvas at 1800px;
eight-book shelves, ranking groups, and editorial columns use scoped grids so
their fixed-width children do not cluster at the left on ultrawide displays.
Filter pages additionally get per-page grid packing from `panel.css`, still
scoped by the `wnf-page-{tag|search|ranking|stories}` class `main.js` adds to `<html>`:
tag `.j_bookList` + `ul.g_row` grid; search `.ser-wrap` + `ul.j_result_wrap`
grid; ranking `.g_wrap.df`; stories `.j_category_wrapper ul.clearfix`. The `swapHref is not defined` EJS error some users see on tag
lazy-load is Webnovel's own bug (isolated-world content scripts cannot touch
the site's template globals). We work around it in `taglazy.js`: on tag pages
we fetch the next `getTagBookList` pages ourselves (novel=type1, fanfic=type4;
order 1=Popular/2=New; tagName from `[data-report-pdid]`) and append native-
looking `li.g_col._6.wnf-added` cards, which the normal scan/enrich/filter
pipeline then processes. The site's own broken loader still fires (extra
requests + console noise) but never mutates the DOM, so no duplication.

## Verified Webnovel API facts (2026-07-15)

All under `https://www.webnovel.com/go/pcm/...`, GET, need `_csrfToken` cookie.
Response `{ code, data, msg }`, code 0 = ok. Page 1 of tag/search is
server-rendered (no API call); pages 2+ lazy-load.

- **Tag** `/seo/getTagBookList?tagName=<slug-minus-suffix>&type=4&pageIndex=N&order=1`
  → `data.items[]` has bookId, chapterNum, totalScore, tagInfo[], MTL, etc.
- **Search** `/search/result?type=novel|fanfic|comic&keywords=&pageIndex=N`
  → `data.bookInfo.bookItems[]` / `data.fanficBookInfo.fanficBookItems[]`.
  **No chapter count.**
- **Ranking** `/category/getRankList?rankId=&rankName=&timeType=&type=4&listType=3&sex=1&signStatus=1&pageIndex=N`
  → `data.bookItems[]` (rankNo, amount=power value, mtl). **No chapter count.**
- **Stories** `/category/categoryAjax?categoryId=&categoryType=&sourceType=&bookStatus=&orderBy=&pageIndex=N`
  → `data.items[]` has bookId, chapterNum, totalScore, tagInfo[], categoryName,
  and inLibrary. Page 1 is server-rendered; pages 2+ load on scroll.
- **Per-book (used for enrichment)** `/book/get-book-detail?bookId=<id>`
  → `data.bookInfo`: `totalChapterNum`, `totalScore`, `voters`, `pvNum` (views),
  `updateTime`, `actionStatus`, `inLibrary`, `tagInfos[]`, `categoryName`;
  `data.curReadChapter` (0 = unread). This is the universal source used for all
  page types because it's the only one carrying chapters everywhere.

## Enrichment strategy

Metadata comes from two tiers, coordinated in `cards.js`:

1. **Bulk (cheap, preferred)** — `nethook.js` runs in the **MAIN world**
   (manifest `world: "MAIN"`, `document_start`) and patches `fetch` + XHR to
   capture the site's own list responses (`getTagBookList` / `search/result` /
   `getRankList`), forwarding the per-book items to the content script via
   `window.postMessage`. On tag pages we also feed our own `getTagBookList`
   fetches (page 1 + `taglazy` pages) into the same `mergeBulk()` path. Bulk
   gives chapters (tag only), rating (tag/search), tags, category — enough for
   the common filters with ~1 request per 20 books.
2. **Per-book (fallback)** — `/book/get-book-detail?bookId=` is called only
   when bulk can't answer: chapters on search/ranking, rating on ranking, or
   whenever a detail-only filter is active (read status / in-library / views).
   On tag pages with no such filter this means **zero** per-book calls.

`store.bulkMode` (true on tag pages) makes bulk authoritative there;
`cards.reconcileDetail()` fetches per-book on demand when a detail-only filter
is switched on.

## Known caveats / TODO

- Wide-mode selectors target current Webnovel wrapper classes; revisit if the
  site markup changes.

## Conventions

- No markdown files other than `README.md` and this file.
- Keep each source file focused and well under ~500 lines.
- No external dependencies; no `package.json`.
