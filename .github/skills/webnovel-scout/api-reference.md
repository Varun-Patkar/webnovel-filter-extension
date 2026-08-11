# Webnovel data API reference (for the Scout)

All endpoints are under `https://www.webnovel.com/go/pcm/...`, GET, and require
the `_csrfToken` cookie value (Webnovel stores it in a cookie of the same name).
Response shape: `{ code, data, msg }`, `code === 0` means OK.

**How the Scout calls these:** navigate a Playwright page to `https://www.webnovel.com`
first (so the browser has the login cookies + csrf for the origin), then run
`fetch()` from inside the page context via `mcp_playwright_browser_run_code_unsafe`
or `mcp_playwright_browser_evaluate`. Same-origin fetch sends cookies
automatically, which is what makes read-status / in-library fields personal.
Never scrape the DOM or scroll — page the JSON directly.

Get the token inside the page with:
```js
const csrf = (document.cookie.match(/_csrfToken=([^;]+)/) || [])[1] || "";
```

## 1. Tag lists (fanfic) — primary source
```
/go/pcm/seo/getTagBookList?_csrfToken=<csrf>&order=1&pageIndex=N&tagName=<slug>&type=4
```
- **`_csrfToken` is REQUIRED** — without it the endpoint returns HTTP 400 `{}`.
- **`tagName` is the lowercase URL slug**, not the display name: `marvel`,
  `naruto`, `douluo-dalu`, `dc`, `dragon-ball`, `harry-potter` (the `/tags/<slug>`
  path minus the `-fanfic`/`-novel` suffix). `Marvel` (capitalized) returns 400.
- `type`: 4 = fanfic, 1 = novel.
- `order`: 1 = Popular, 2 = New. Scan BOTH.
- `pageIndex`: 1-based. Page size ~20. `data.isLast` and `data.total` present.
- `data.items[]`: `bookId, bookName, categoryName, authorName, totalScore` (x/5),
  `tagInfo[]`, `description`, `chapterNum`, `publishTime`, `MTL` (bool),
  `firstChapterId`. **Tag lists carry chapter count** — good, less enrichment.
- `tagName` is the human name (e.g. `Marvel`, `Naruto`). If a tag returns nothing,
  try the site's tag slug from a `/tags/<slug>` page's `[data-report-pdid]`.

## 2. Search — franchise keyword source
```
/go/pcm/search/result?_csrfToken=<csrf>&pageIndex=N&type=novel|fanfic|comic&keywords=<kw>
```
- `_csrfToken` required (same as tag lists).
- Fanfic results: `data.fanficBookInfo.fanficBookItems[]`.
- Novel results:  `data.bookInfo.bookItems[]`.
- Each item: `bookId, bookName, categoryName, categoryId, authorName, totalScore,
  translateMode, tagInfo[], description, novelType`.
- **No chapter count** — enrich via get-book-detail to apply the min-chapters floor.
- `total` + `isLast` live on the `*BookInfo` node.

## 3. Rankings
```
/go/pcm/category/getRankList?_csrfToken=<csrf>&pageIndex=N&rankId=<id>&rankName=<name>&listType=3&type=4&timeType=<t>&sex=1&signStatus=1
```
- `_csrfToken` required.
- `type`: 4 fanfic / 1 novel. `rankId`/`rankName` pairs e.g. `power_rank`/`Power`,
  `collection_rank`/`Collection`. `timeType` selects the window.
- `data.bookItems[]`: `rankNo, bookId, bookName, categoryName, authorName,
  tagInfo[], description, amount` (power value — NOT chapters), `mtl` (bool),
  `publishTime, firstChapterId`. `data.last`, `data.pageIndex`.
- **No chapter count** — enrich as needed.

## 4. Per-book detail — enrichment (rating, voters, chapters, tags)
```
/go/pcm/book/get-book-detail?_csrfToken=<csrf>&bookId=<id>
```
- `data.bookInfo`: `totalChapterNum` / `chapterNum`, `totalScore` (x/5),
  `voters` (rating count), `pvNum` (views), `updateTime`, `actionStatus`,
  `ageGroup`, `translateMode`, `categoryName`, `tagInfos[]`, `inLibrary` (bool).
- `data.curReadChapter` (0 = unread) — personal, when logged in.
- Heavier payload. Use a concurrency-limited loop (~4–6 parallel) + in-memory
  cache. Only enrich candidates that survived exclusion filtering.

## Field normalization
- Rating: `totalScore` is out of 5.
- Tags: `tagInfo[].enTagName || tagInfo[].tagName` (list) / `tagInfos[].tagName`
  (detail). Upper-case for comparison.
- bookId: always coerce to string.

## Reference fetch loop (page a tag, both orders)
```js
async () => {
  const csrf = (document.cookie.match(/_csrfToken=([^;]+)/) || [])[1] || "";
  const base = "/go/pcm/seo/getTagBookList";
  const out = [];
  for (const order of [1, 2]) {
    for (let p = 1; p <= 5; p++) {
      const u = `${base}?_csrfToken=${encodeURIComponent(csrf)}&order=${order}&pageIndex=${p}&tagName=marvel&type=4`;
      const j = await (await fetch(u, { credentials: "include" })).json();
      const items = (j && j.data && j.data.items) || [];
      out.push(...items.map(i => ({
        bookId: String(i.bookId), name: i.bookName, author: i.authorName,
        cat: i.categoryName, score: i.totalScore, chapters: i.chapterNum,
        mtl: !!i.MTL, tags: (i.tagInfo||[]).map(t => (t.enTagName||t.tagName||"")),
        order
      })));
      if (j && j.data && j.data.isLast) break;
    }
  }
  return JSON.stringify(out);
}
```
