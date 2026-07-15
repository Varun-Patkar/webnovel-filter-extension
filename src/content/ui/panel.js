/**
 * ui/panel.js
 * ------------
 * Builds and wires the injected UI: a sticky accent bar shown above the first
 * result, plus a collapsible "Advanced Filters" panel. Also renders the live
 * count (showing / filtered / loaded) and owns the apply cycle so any control
 * change immediately re-filters the tracked cards.
 *
 * Dynamic option lists (categories, tags) are rebuilt from whatever metadata
 * has streamed in so far, preserving the user's current selections.
 */
(function () {
  "use strict";
  const WNF = (window.__WNF = window.__WNF || {});
  const store = WNF.store;

  /** Tiny hyperscript helper: h('div.cls', {attr}, ...children). */
  function h(tagSpec, props, ...children) {
    const [tag, ...classes] = tagSpec.split(".");
    const el = document.createElement(tag || "div");
    if (classes.length) el.className = classes.join(" ");
    if (props) {
      for (const k in props) {
        if (k === "text") el.textContent = props[k];
        else if (k.startsWith("on") && typeof props[k] === "function")
          el.addEventListener(k.slice(2).toLowerCase(), props[k]);
        else if (props[k] != null) el.setAttribute(k, props[k]);
      }
    }
    children.flat().forEach((c) => {
      if (c == null) return;
      el.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
    });
    return el;
  }

  // --- element references filled in during mount ---
  let refs = {};

  /**
   * Keep the injected bar the same width as the actual results column.
   *
   * On tag pages the bar's parent (`.j_bookList`) is full-width while the
   * native grid (`ul.g_row`) is a narrower centered column, so without this the
   * bar would be 100vw over ~1036px of books. We measure the grid and match it
   * (centered). Search/ranking inherit the content width naturally, so there we
   * just clear any inline width. Re-run on wide-toggle and window resize.
   */
  function syncWidth() {
    const root = document.querySelector(".wnf-root");
    if (!root) return;
    const page = store.page;
    if (!page || page.type !== "tag") {
      root.style.width = "";
      return;
    }
    const grid = document.querySelector("ul.g_row");
    if (!grid) return;
    root.style.width = Math.round(grid.getBoundingClientRect().width) + "px";
    root.style.marginLeft = "auto";
    root.style.marginRight = "auto";
  }

  /** Window resize handler that self-removes once the bar is gone. */
  function onResize() {
    if (!document.querySelector(".wnf-root")) {
      window.removeEventListener("resize", onResize);
      return;
    }
    syncWidth();
  }

  /** Show or hide the "updating" spinner based on outstanding detail fetches. */
  function setBusy(pending) {
    if (!refs.busy) return;
    refs.busy.style.display = pending > 0 ? "" : "none";
  }

  /** Run the filter pass and update the count readout. */
  function applyAndCount() {
    const { showing, hidden, total } = WNF.filters.apply();
    // A filter change may require per-book detail we don't have yet
    // (read status / library / views); let the enrichment layer catch up.
    if (WNF.cards && WNF.cards.reconcileDetail) WNF.cards.reconcileDetail();
    if (refs.count) {
      refs.count.innerHTML =
        '<b class="wnf-c-show">' +
        showing +
        "</b> shown · " +
        '<b class="wnf-c-hide">' +
        hidden +
        "</b> filtered · " +
        '<b class="wnf-c-total">' +
        total +
        "</b> loaded";
    }
  }

  /** Collect a sorted, de-duplicated list of a metadata field across books. */
  function collect(field) {
    const set = new Set();
    store.meta.forEach((m) => {
      if (m.status !== "done") return;
      if (field === "tags") m.tags.forEach((t) => set.add(t));
      else if (m[field]) set.add(m[field]);
    });
    return [...set].sort();
  }

  /** Build the category checkbox list. */
  function renderCategories() {
    const box = refs.categories;
    if (!box) return;
    box.innerHTML = "";
    collect("categoryName").forEach((cat) => {
      const cb = h("input", {
        type: "checkbox",
        checked: store.filters.categories.has(cat) ? "" : null,
        onChange: (e) => {
          if (e.target.checked) store.filters.categories.add(cat);
          else store.filters.categories.delete(cat);
          applyAndCount();
        },
      });
      box.appendChild(h("label.wnf-chip", null, cb, cat));
    });
    if (!box.children.length)
      box.appendChild(h("span.wnf-muted", { text: "loading…" }));
  }

  /** Build the tag include/exclude tri-state list, honoring the tag search box. */
  function renderTags() {
    const box = refs.tags;
    if (!box) return;
    const q = (refs.tagSearch.value || "").toUpperCase();
    box.innerHTML = "";
    collect("tags")
      .filter((t) => !q || t.includes(q))
      .slice(0, 400)
      .forEach((tag) => {
        const state = store.filters.includeTags.has(tag)
          ? "inc"
          : store.filters.excludeTags.has(tag)
          ? "exc"
          : "off";
        const chip = h("button.wnf-tag.wnf-tag-" + state, {
          type: "button",
          title: "Click: include → exclude → off",
          text: (state === "exc" ? "− " : state === "inc" ? "+ " : "") + tag,
          onClick: () => {
            // Cycle off -> include -> exclude -> off
            store.filters.includeTags.delete(tag);
            store.filters.excludeTags.delete(tag);
            if (state === "off") store.filters.includeTags.add(tag);
            else if (state === "inc") store.filters.excludeTags.add(tag);
            renderTags();
            applyAndCount();
          },
        });
        box.appendChild(chip);
      });
    if (!box.children.length)
      box.appendChild(h("span.wnf-muted", { text: "loading…" }));
  }

  /** A labelled numeric input that writes to a filter field. */
  function numField(label, field, placeholder) {
    const input = h("input.wnf-num", {
      type: "number",
      min: "0",
      placeholder: placeholder || "",
      onInput: (e) => {
        const v = e.target.value === "" ? null : Number(e.target.value);
        store.filters[field] = v;
        applyAndCount();
      },
    });
    refs["f_" + field] = input;
    return h("label.wnf-field", null, h("span", { text: label }), input);
  }

  /** Build the collapsible filter body. */
  function buildPanel() {
    // Read-status checkboxes
    const readBox = h("div.wnf-inline");
    [
      ["unread", "Unread"],
      ["progress", "In progress"],
      ["read", "Read"],
    ].forEach(([val, lbl]) => {
      const cb = h("input", {
        type: "checkbox",
        onChange: (e) => {
          if (e.target.checked) store.filters.readStatus.add(val);
          else store.filters.readStatus.delete(val);
          applyAndCount();
        },
      });
      readBox.appendChild(h("label.wnf-chip", null, cb, lbl));
    });

    // In-library select
    const lib = h(
      "select.wnf-select",
      {
        onChange: (e) => {
          store.filters.inLibrary = e.target.value;
          applyAndCount();
        },
      },
      h("option", { value: "any", text: "Any" }),
      h("option", { value: "yes", text: "In library" }),
      h("option", { value: "no", text: "Not in library" })
    );

    // Sort controls
    const sortBy = h(
      "select.wnf-select",
      {
        onChange: (e) => {
          store.filters.sortBy = e.target.value;
          applyAndCount();
        },
      },
      h("option", { value: "default", text: "Default order" }),
      h("option", { value: "chapters", text: "Chapters" }),
      h("option", { value: "rating", text: "Rating" }),
      h("option", { value: "views", text: "Views" })
    );
    const sortDir = h(
      "select.wnf-select",
      {
        onChange: (e) => {
          store.filters.sortDir = e.target.value;
          applyAndCount();
        },
      },
      h("option", { value: "desc", text: "High → Low" }),
      h("option", { value: "asc", text: "Low → High" })
    );

    // Text search
    const text = h("input.wnf-text", {
      type: "search",
      placeholder: "Search title, author, description…",
      onInput: (e) => {
        store.filters.text = e.target.value.trim();
        applyAndCount();
      },
    });

    // Tag search box
    refs.tagSearch = h("input.wnf-text", {
      type: "search",
      placeholder: "Filter tag list…",
      onInput: () => renderTags(),
    });

    refs.categories = h("div.wnf-chips");
    refs.tags = h("div.wnf-tags");

    return h(
      "div.wnf-panel",
      null,
      h("div.wnf-row", null, h("label.wnf-field.wnf-grow", null, h("span", { text: "Text" }), text)),
      h(
        "div.wnf-row",
        null,
        numField("Min chapters", "minChapters", "e.g. 100"),
        numField("Max chapters", "maxChapters", ""),
        numField("Min rating", "minRating", "0-5"),
        numField("Min views", "minViews", "")
      ),
      h(
        "div.wnf-row",
        null,
        h("label.wnf-field", null, h("span", { text: "Read status" }), readBox),
        h("label.wnf-field", null, h("span", { text: "Library" }), lib),
        h("label.wnf-field", null, h("span", { text: "Sort by" }), sortBy),
        h("label.wnf-field", null, h("span", { text: "Direction" }), sortDir)
      ),
      h("div.wnf-row", null, h("label.wnf-field.wnf-grow", null, h("span", { text: "Categories" }), refs.categories)),
      h(
        "div.wnf-row",
        null,
        h(
          "label.wnf-field.wnf-grow",
          null,
          h("span", { text: "Tags (click to include → exclude → off)" }),
          refs.tagSearch,
          refs.tags
        )
      )
    );
  }

  /**
   * Mount the UI above the results.
   * @param {HTMLElement} anchor element to insert the bar before
   */
  function mount(anchor) {
    if (document.querySelector(".wnf-bar")) return; // already mounted

    refs.count = h("span.wnf-count");
    refs.busy = h(
      "span.wnf-busy",
      { title: "Updating results as data loads…" },
      h("span.wnf-spinner"),
      h("span", { text: "Updating…" })
    );
    refs.busy.style.display = "none";

    const toggleBtn = h("button.wnf-btn", {
      type: "button",
      text: "⚙ Advanced Filters",
      onClick: () => {
        const open = refs.panel.classList.toggle("wnf-open");
        toggleBtn.classList.toggle("wnf-active", open);
      },
    });

    const wideBtn = h("button.wnf-btn", {
      type: "button",
      text: "⇔ Wide",
      title: "Expand content to ~90% of screen width",
      onClick: () => {
        WNF.layout.setWide(!WNF.layout.isWide());
        wideBtn.classList.toggle("wnf-active", WNF.layout.isWide());
        // Content width just changed; re-match after the layout settles.
        requestAnimationFrame(syncWidth);
      },
    });

    const clearBtn = h("button.wnf-btn", {
      type: "button",
      text: "✕ Clear",
      onClick: () => {
        store.resetFilters();
        resetControls();
        applyAndCount();
      },
    });

    const bar = h(
      "div.wnf-bar",
      null,
      h("span.wnf-brand", { text: "Webnovel Filter" }),
      toggleBtn,
      wideBtn,
      clearBtn,
      refs.count,
      refs.busy
    );

    refs.panel = buildPanel();

    const wrap = h("div.wnf-root", null, bar, refs.panel);
    anchor.parentNode.insertBefore(wrap, anchor);

    renderCategories();
    renderTags();
    applyAndCount();
    syncWidth();
    window.addEventListener("resize", onResize);
  }

  /** Reset all visible form controls to their default (used by Clear). */
  function resetControls() {
    refs.panel
      .querySelectorAll("input, select")
      .forEach((el) => {
        if (el.type === "checkbox") el.checked = false;
        else if (el.tagName === "SELECT") el.selectedIndex = 0;
        else el.value = "";
      });
    renderCategories();
    renderTags();
  }

  /** Rebuild dynamic option lists + re-apply. Called as metadata streams in. */
  function refresh() {
    renderCategories();
    renderTags();
    applyAndCount();
  }

  WNF.ui = { mount, refresh, applyAndCount, setBusy };
})();
