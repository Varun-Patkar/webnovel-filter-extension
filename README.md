# Webnovel Advanced Filter

A **client-side Chrome extension** that injects an advanced filter bar into
Webnovel's **tag**, **search**, and **ranking** pages, surfaces data the site
already loads but hides (like chapter counts), and widens the layout for
ultrawide monitors.

Unlike a scraper, it reads only the live data your own browser session loads —
nothing is crawled or stored on an external server.

## Features

- **Advanced Filters panel** injected above the first result (below the navbar):
  - Text search (title / author / description)
  - Min / max **chapters**
  - Min **rating**
  - Min **views**
  - **Tags** — click to cycle include → exclude → off
  - **Category** multi-select
  - **Read status** — unread / in progress / read (uses your logged-in data)
  - **In library** / not in library
  - **Sort** by chapters, rating, or views
- **Live counts**: how many are shown, filtered out, and loaded — with an
  **“Updating…” spinner** while background data is still loading, so you know
  when the totals are final.
- **Clear Filters** button. Filters are intentionally **forgotten on reload**.
- **Chapter badges** on every card — the number you normally have to open each
  book to see.
- **Wide mode**: a **Wide layout** switch in the toolbar popup that expands
  every Webnovel page (including book detail and chapter pages) to ~90% of
  screen width — leaving ~5% margin on each side — and packs tag-page and
  search cards into as many columns as fit, instead of the default 2-per-row.
  The setting is remembered until you switch it off.
- **On/off toggle**: click the toolbar icon for a master switch. Toggling it
  mounts or removes the filter UI on open Webnovel tabs live, no reload needed.
- **Fixes Webnovel's broken tag lazy-load**: on tag pages the site's own
  infinite scroll crashes while rendering (`swapHref is not defined`), so extra
  pages never appear. The extension quietly takes over, fetching and rendering
  the next pages itself so results keep loading.

Filters apply to everything currently **loaded**; as the page lazily loads more
results on scroll, they're picked up automatically.

## How it works

Webnovel's list endpoints are inconsistent about which fields they expose (tag
pages include chapter counts; search and ranking do not). Enrichment is
two-tier:

1. **Bulk (preferred)** — a tiny MAIN-world hook reads the site's own list
   responses (and, on tag pages, a couple of list calls the extension makes
   itself) to get chapters, rating, tags and category for ~20 books per
   request.
2. **Per-book fallback** — the `get-book-detail` endpoint is called only when
   bulk can't answer (chapters on search/ranking, or when a read-status /
   in-library / views filter is switched on). On tag pages with no such filter,
   this means **zero** per-book calls.

Everything runs in your own logged-in session; nothing is crawled or stored on
an external server, and results are cached in memory only for the session.

## Install (unpacked, from source)

```bash
git clone https://github.com/Varun-Patkar/webnovel-filter-extension.git
```

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked** and select the cloned folder.
4. Visit any supported page, e.g.
   - `https://www.webnovel.com/tags/overpowered-fanfic`
   - `https://www.webnovel.com/search?keywords=marvel`
   - `https://www.webnovel.com/ranking/fanfic/bi_annual/power_rank`

There is no build step — it's plain vanilla JS with no dependencies.

## Notes

- Read/library status requires you to be **logged in** to Webnovel.
- The extension only touches the three supported page types and never sends
  data anywhere except back to webnovel.com.

## Development

All source lives under `src/` (see [`AGENTS.md`](AGENTS.md) for the module map).
The toolbar icons are rendered from [`icons/icon-source.html`](icons/icon-source.html).
Contributions and bug reports are welcome via issues and pull requests.

## Credits

Successor to [webnovel-advanced-search](https://github.com/Varun-Patkar/webnovel-advanced-search),
which did similar filtering as a hosted site that relied on scraping. This
extension replaces that approach by running inside Webnovel itself, using only
live first-party data.

## License

Released under the [MIT License](LICENSE).
