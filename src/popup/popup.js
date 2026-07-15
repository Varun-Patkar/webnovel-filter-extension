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

  /** Reflect the current state in the UI. */
  function paint(enabled) {
    toggle.checked = enabled;
    status.textContent = enabled ? "On" : "Off";
    status.style.color = enabled ? "#8b5cf6" : "#a29fb8";
  }

  // Load current state (default ON).
  chrome.storage.local.get({ enabled: true }, (res) => paint(res.enabled !== false));

  // Persist changes; the content script reacts via storage.onChanged.
  toggle.addEventListener("change", () => {
    const enabled = toggle.checked;
    chrome.storage.local.set({ enabled });
    paint(enabled);
  });
})();
