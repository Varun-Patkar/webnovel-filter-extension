/**
 * popup.js
 * ---------
 * Wires the on/off switch to chrome.storage.local. The content script reads
 * and watches this `enabled` flag, so toggling here mounts or tears down the
 * filter UI on any open Webnovel tab immediately.
 */
(function () {
  "use strict";
  const toggle = document.getElementById("toggle");
  const status = document.getElementById("status");
  const wide = document.getElementById("wide");
  const wideStatus = document.getElementById("wideStatus");

  /** Reflect the current enabled state in the UI. */
  function paint(enabled) {
    toggle.checked = enabled;
    status.textContent = enabled ? "On" : "Off";
    status.style.color = enabled ? "#8b5cf6" : "#a29fb8";
  }

  /** Reflect the current wide-layout state in the UI. */
  function paintWide(on) {
    wide.checked = on;
    wideStatus.textContent = on ? "On" : "Off";
    wideStatus.style.color = on ? "#8b5cf6" : "#a29fb8";
  }

  // Load current state (enabled defaults ON, wide defaults OFF).
  chrome.storage.local.get({ enabled: true, wide: false }, (res) => {
    paint(res.enabled !== false);
    paintWide(res.wide === true);
  });

  // Persist changes; the content scripts react via storage.onChanged.
  toggle.addEventListener("change", () => {
    const enabled = toggle.checked;
    chrome.storage.local.set({ enabled });
    paint(enabled);
  });

  wide.addEventListener("change", () => {
    const on = wide.checked;
    chrome.storage.local.set({ wide: on });
    paintWide(on);
  });
})();
