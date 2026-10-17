// The best score, remembered across visits with localStorage.
//
// The page keeps a best readout ("Best N") beside the score, and this module
// owns that number and nothing else. It is a tiny store over a Web Storage —
// localStorage on the page, a stub in the node:test suite — created once per
// page load: creation reads the remembered best and renders it into the
// readout, which is the whole "restore at page load" job, and settle(finalScore)
// is the run-end hook — it keeps the greatest of the remembered best and the
// just-finished run's final score, so the just-finished run counts the moment
// it is the new best and a worse run never lowers it, and it writes a new best
// back to storage so the next visit starts from it.
//
// Storage can misbehave in every real browser: be absent, hold a corrupt
// value, or throw (blocked cookies, private mode, quota). None of that may
// break the game, so every storage call is wrapped — a missing or unreadable
// best reads as "no best yet" (0), and a refused write keeps the best for the
// current visit only. The store takes its storage, readout and key as
// dependencies and never touches a global itself, so tests drive it by hand
// and a second instance over the same storage stub is exactly a fresh page
// load in the same browser.

export const BEST_STORAGE_KEY = 'snake.best';

/** The readout renders exactly "Best N", like the score's "Score N". */
export const formatBest = best => `Best ${best}`;

/**
 * Parse a stored best. Anything but a plain non-negative integer reads as "no
 * best yet" (0), so an absent, corrupt or negative value never reaches the
 * readout as NaN or lowers a real best.
 */
const parseBest = raw => {
  const value = Number(String(raw ?? '').trim());
  return Number.isInteger(value) && value >= 0 ? value : 0;
};

/**
 * Create the best-score store for one page load.
 *
 * options: { storage = null, readout = null, key = BEST_STORAGE_KEY } —
 * storage is any Web Storage (the page passes localStorage; tests pass a
 * stub); readout is the element the best renders into. Either may be omitted:
 * without storage the best lives only for the current visit, and without a
 * readout the store still tracks and persists the best.
 */
export function createBestStore({ storage = null, readout = null, key = BEST_STORAGE_KEY } = {}) {
  let best = 0;
  try {
    if (storage) best = parseBest(storage.getItem(key));
  } catch {
    best = 0; // storage refused to answer: this visit starts from no best
  }

  const render = () => {
    if (readout) readout.textContent = formatBest(best);
  };
  render(); // page load: the readout shows the remembered best at once

  return {
    /** The best now: the greatest score remembered or seen this visit. */
    best: () => best,

    /**
     * Record a run's end. The best becomes the greatest of the remembered best
     * and this run's final score — the just-finished run shows when it is the
     * new best, and a worse run never lowers the best — a new best is written
     * to storage for the next visit, and the readout is rendered either way.
     * Returns the best now shown.
     */
    settle(finalScore) {
      const score = Math.floor(Number(finalScore));
      if (Number.isInteger(score) && score > best) {
        best = score;
        try {
          if (storage) storage.setItem(key, String(best));
        } catch {
          // A refused write (quota, private mode) keeps the best for this
          // visit; the game never breaks over persistence.
        }
      }
      render();
      return best;
    },
  };
}
