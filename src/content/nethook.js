/**
 * nethook.js  —  runs in the MAIN world (see manifest `world: "MAIN"`)
 * ------------------------------------------------------------------
 * Patches `fetch` and `XMLHttpRequest` so we can read Webnovel's OWN list
 * responses (tag / search / ranking / stories pages) and forward the per-book
 * items to the content script (isolated world) via `window.postMessage`. This
 * lets the extension enrich cards in bulk without duplicate list calls.
 *
 * It is strictly read-only: it never blocks, delays, or modifies requests or
 * responses — it only clones them to peek at the JSON. Runs at document_start
 * so the patch is installed before the site issues any of these calls.
 */
(function () {
  "use strict";
  if (window.__wnfNetHook) return;
  window.__wnfNetHook = true;

  const MATCH =
    /\/go\/pcm\/(seo\/getTagBookList|search\/result|category\/(getRankList|categoryAjax))/;

  /** Forward a captured list payload to the content script. */
  function post(url, json) {
    try {
      window.postMessage(
        { __wnf: "booklist", url: String(url), data: json },
        location.origin
      );
    } catch (e) {
      /* structured-clone failure or similar; ignore */
    }
  }

  // --- fetch ---
  const origFetch = window.fetch;
  if (typeof origFetch === "function") {
    window.fetch = function (input, init) {
      const promise = origFetch.apply(this, arguments);
      try {
        const url =
          typeof input === "string" ? input : (input && input.url) || "";
        if (MATCH.test(url)) {
          promise.then(
            (res) => {
              try {
                res
                  .clone()
                  .json()
                  .then((j) => post(url, j))
                  .catch(() => {});
              } catch (e) {
                /* not JSON; ignore */
              }
            },
            () => {}
          );
        }
      } catch (e) {
        /* ignore */
      }
      return promise;
    };
  }

  // --- XMLHttpRequest ---
  const XHR = window.XMLHttpRequest;
  if (XHR && XHR.prototype) {
    const origOpen = XHR.prototype.open;
    const origSend = XHR.prototype.send;
    XHR.prototype.open = function (method, url) {
      this.__wnfUrl = url;
      return origOpen.apply(this, arguments);
    };
    XHR.prototype.send = function () {
      try {
        if (MATCH.test(this.__wnfUrl || "")) {
          this.addEventListener("load", function () {
            try {
              post(this.__wnfUrl, JSON.parse(this.responseText));
            } catch (e) {
              /* not JSON; ignore */
            }
          });
        }
      } catch (e) {
        /* ignore */
      }
      return origSend.apply(this, arguments);
    };
  }
})();
