/**
 * queue.js
 * ---------
 * A tiny concurrency-limited task queue used to throttle the number of
 * simultaneous network requests the extension makes to Webnovel's per-book
 * detail API. This keeps us gentle on their servers (only a handful of
 * in-flight requests at any time) while still enriching every loaded card.
 *
 * Exposes `WNF.createQueue(concurrency)` on the shared `window.__WNF`
 * namespace that all content-script files use to communicate (MV3 content
 * scripts share one isolated-world global scope but not lexical scope, so we
 * hang shared modules off a single namespace object).
 */
(function () {
  "use strict";
  const WNF = (window.__WNF = window.__WNF || {});

  /**
   * Create a queue that never runs more than `concurrency` tasks at once.
   * @param {number} concurrency Maximum number of concurrently running tasks.
   * @returns {{add: (fn: () => (any|Promise<any>)) => Promise<any>, size: () => number, active: () => number}}
   */
  WNF.createQueue = function createQueue(concurrency) {
    const limit = Math.max(1, concurrency | 0);
    /** @type {Array<{fn: Function, resolve: Function, reject: Function}>} */
    const pending = [];
    let running = 0;

    // Pull the next task off the queue if we have spare capacity.
    function pump() {
      if (running >= limit || pending.length === 0) return;
      running++;
      const { fn, resolve, reject } = pending.shift();
      Promise.resolve()
        .then(fn)
        .then(resolve, reject)
        .finally(() => {
          running--;
          pump();
        });
    }

    return {
      /**
       * Schedule a task. Returns a promise that settles with the task result.
       * @param {() => (any|Promise<any>)} fn
       */
      add(fn) {
        return new Promise((resolve, reject) => {
          pending.push({ fn, resolve, reject });
          pump();
        });
      },
      /** Number of tasks still waiting to start. */
      size() {
        return pending.length;
      },
      /** Number of tasks currently running. */
      active() {
        return running;
      },
    };
  };
})();
