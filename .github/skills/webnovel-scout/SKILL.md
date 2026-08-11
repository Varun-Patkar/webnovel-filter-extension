---
name: webnovel-scout
description: 'Daily Webnovel book-discovery workflow for a fanfic-heavy reader. Use to find NEW webnovel books to read that match the user profile, excluding anything already in the Amazon Kindle library, disliked, or previously recommended. Triggers: "webnovel recommendations", "find me new books", "daily scout run", "what should I read", "scout webnovel", "refresh kindle list". Calls Webnovel APIs directly via Playwright (no scrolling), filters, ranks by taste, and writes a dated markdown shortlist.'
argument-hint: 'e.g. "daily run", "sync kindle", or a franchise to focus'
---

# Webnovel Scout

Finds fresh Webnovel books matched to the reader's taste and emits a ranked,
deduplicated markdown shortlist. Solves the "scroll past 100 already-read books"
problem by paging Webnovel's JSON APIs and filtering server results locally.

## Inputs (all in this workspace)
> First-time setup: the real data files are gitignored (personal). Copy the
> committed templates before the first run:
> `profile.example.md`→`profile.md`, `config.example.json`→`config.json`, and each
> `scout/data/*.example.json`→ the same name without `.example`. Then run
> **sync kindle** to populate `kindle-library.json`.

- `scout/profile.md` — taste profile (franchises, tropes, hard excludes). Authoritative.
- `scout/config.json` — discovery knobs (tags, searches, rankings, weights, minChapters).
- `scout/data/kindle-library.json` — 503 owned books → exclusion set (title match).
- `scout/data/dislikes.json` — hard-exclude categories/tags/franchises + growable per-book dislikes.
- `scout/data/history.json` — bookIds already recommended → never repeat.
- [api-reference.md](./api-reference.md) — endpoints + fetch snippets.

## Modes
- **daily run** (default): discover → filter → enrich → rank → write shortlist → update history.
- **sync kindle**: re-extract the Amazon library on demand (see "Kindle sync").
- **onboard**: rebuild `profile.md` / `config.json` from library + a fresh interview.

## Daily run procedure

1. **Load state.** Read profile.md, config.json, dislikes.json, history.json, and
   kindle-library.json. Build in-memory sets:
   - `excludeIds` = Set(history.recommended[].bookId ∪ dislikes.bookIds)
   - `excludeTitles` = Set(kindle normTitle ∪ dislikes.titles normalized)
   - Normalize = lowercase, replace non-alphanumeric with single spaces, trim.

2. **Open Webnovel.** `mcp_playwright_browser_navigate` → `https://www.webnovel.com`.
   Confirm logged in (cookies present). All fetches run in page context so the
   user's session + `_csrfToken` are used.

3. **Discover.** For each surface in config.discovery, page the JSON APIs
   (see api-reference.md). Do this INSIDE one `mcp_playwright_browser_run_code_unsafe`
   call per surface-group to stay token-efficient (return a compact JSON array,
   not DOM):
   - Fanfic tags: `getTagBookList` for each `fanficTags[]`, both `tagOrders` (Popular+New), pages 1..pageDepth.
   - Searches: `search/result` for each `searchKeywords`, fanfic + (light) novel.
   - Rankings: `getRankList` for each `rankings[]` entry, pages 1..pageDepth.
   Merge into one candidate list keyed by bookId (dedupe within the run too).

4. **Exclude (cheap, before enrichment).** Drop any candidate where:
   - `bookId ∈ excludeIds`, OR
   - `normalize(name) ∈ excludeTitles`, OR
   - category/tags hit `dislikes.categories`/`dislikes.tags`, OR
   - the story is SET IN a `dislikes.franchisesSetIn.worlds` entry (judge from
     name/description/tags; a multiverse fic merely borrowing powers is allowed).
   BL nuance: exclude BL *romance stories*; allow pure-smut BL; yuri/GL is fine.

5. **Enrich survivors.** For candidates missing rating/voters/chapters (search &
   ranking items lack chapters; ranking lacks nothing needed but detail gives
   voters), call `get-book-detail` with a concurrency-limited loop (~4–6) + cache.
   Apply the ONLY soft floor: prefer `chapters >= config.quality.minChapters`
   (allow rare high-interest exceptions). **No rating cutoff** — low rating is
   allowed, it just ranks lower.

6. **Rank (LLM semantic).** Score each survivor against profile.md using
   `config.ranking.weights`:
   - `franchiseMatch` (biggest) → title/tags name a loved franchise.
   - `tropeMatch` → loved tropes present.
   - `rating` + `voters` → soft up-weight only.
   - Originals (non-fanfic) must clear a HIGH clickbait bar (config.originalHooks);
     otherwise drop them.
   - No per-franchise cap — surface every strong match.
   Sort descending.

7. **Emit shortlist.** Write `scout/recommendations/YYYY-MM-DD.md` (today's date).
   Format below. Include the top ~20–30. Each entry links to
   `https://www.webnovel.com/book/<bookId>`.

8. **Update history.** Append every emitted `{ bookId, name, date }` to
   `history.json.recommended` and set `updatedAt`. This guarantees the next run
   won't repeat any of them.

9. **Report.** Summarize counts (scanned → after-exclude → enriched → shortlisted)
   and link the output file. Do not paste the whole list into chat.

## Shortlist format
```markdown
# Webnovel Scout — YYYY-MM-DD
Scanned N candidates · M after exclusions · K shortlisted.

## Fanfic
1. [<Title>](https://www.webnovel.com/book/<bookId>) — *<Author>*
   `<Franchise>` · <chapters> ch · ★<score>/5 (<voters>) · <source> · MTL:<yes/no>
   Why: <one line tying to profile>
...

## Originals (clickbait bar)
1. [<Title>](https://www.webnovel.com/book/<bookId>) — *<Author>*
   `<hook>` · <chapters> ch · ★<score>/5 (<voters>)
   Why: <one line>
```

## Kindle sync (on demand)
Re-extract the Amazon "Manage Your Content and Devices" personal-documents list:
1. `mcp_playwright_browser_navigate` →
   `https://www.amazon.com/hz/mycd/digital-console/contentlist/pdocs/dateDsc/`.
2. In `mcp_playwright_browser_run_code_unsafe`, loop `?pageNumber=1..21`
   (`page.goto`, waitForSelector `tr[class*="ListItem-module_row"]`), extract per
   row: title = `[class*="digital_entity_title"]`, author = first `.information_row`,
   read = a `<span>` whose text === "READ".
3. Rewrite `scout/data/kindle-library.json` with `{ title, author, read, normTitle }`
   (normTitle = normalize(title)). Page count/last-page size may change over time —
   stop when a page yields 0 rows.

## Rules
- Never hard-cut on rating. Never cap a franchise.
- Kindle "read" flag is unreliable → use library only as an exclusion set, not a
  taste signal.
- Keep chat output compact; the shortlist file is the deliverable.
- If a tagName returns nothing, fall back to the search API for that franchise.
