import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createBestStore, formatBest, BEST_STORAGE_KEY } from '../js/best-score.js';
import { wireStart, GRID } from '../js/main.js';
import { createRun } from '../js/engine.js';

const ROOT = join(fileURLToPath(new URL('..', import.meta.url)));

/**
 * Hand-rolled localStorage stub over one backing map. Several stores can share
 * it, so a second store instance sees exactly what the first one wrote — the
 * stub's stand-in for a fresh page load in the same browser.
 */
function makeStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: key => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => {
      map.set(key, String(value));
    },
    removeItem: key => {
      map.delete(key);
    },
  };
}

/** The best readout element stub: textContent is all the store ever touches. */
const makeReadout = () => ({ textContent: 'not rendered yet' });

/** Minimal element stub with listeners, for the controls wireStart wires. */
class StubElement {
  constructor(id) {
    this.id = id;
    this.listeners = new Map();
    this.textContent = '';
    this.hidden = false;
    this.disabled = false;
  }
  addEventListener(type, fn) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(fn);
  }
  dispatchEvent(event) {
    for (const fn of this.listeners.get(event.type) ?? []) fn(event);
    return true;
  }
  click() {
    return this.dispatchEvent({ type: 'click' });
  }
}

/**
 * A wired page whose best store reads and writes the given storage stub. The
 * canvas context is null, so drawing is a no-op (drawBoard tolerates it); the
 * runs come from a queue, so one page can play a good run and then a worse
 * one: by default the first run eats one staged piece of food and hits the
 * wall (final score 1), the second rides straight into the wall (final score 0).
 */
function wireBestPage({ storage, runs }) {
  const canvas = { width: 400, height: 400, getContext: () => null };
  const start = new StubElement('start');
  const score = new StubElement('score');
  const best = new StubElement('best');
  const gameOver = new StubElement('game-over');
  const finalScore = new StubElement('final-score');
  const playAgain = new StubElement('play-again');
  const bestStore = createBestStore({ storage, readout: best });
  const queue = runs ?? [
    createRun(GRID, GRID, { food: [11, 10], rng: () => 0 }), // food ahead: ends at 1
    createRun(GRID, GRID, { rng: () => 0 }), // no food on the way: ends at 0
  ];
  let timerFn = null;
  const wired = wireStart({
    canvas,
    start,
    score,
    gameOver,
    finalScore,
    playAgain,
    bestStore,
    makeRun: () => queue.shift(),
    setInterval: fn => {
      timerFn = fn;
      return 1;
    },
    clearInterval: () => {},
  });
  return {
    wired, start, score, best, gameOver, finalScore, playAgain, bestStore,
    running: () => wired.running(),
    tick: () => timerFn(),
  };
}

/** Play the current run out to its game over (it always ends: into a wall). */
function playOut(page) {
  assert.equal(page.running(), true, 'the run moves by itself');
  for (let i = 0; i < 100 && page.running(); i++) page.tick();
  assert.equal(page.running(), false, 'the run ended on its own');
}

test('unit:best-score-update when a run ends the best readout shows the greatest of the stored best and the final score, including the just-finished run when it is the new best', () => {
  assert.equal(formatBest(7), 'Best 7', 'the readout renders exactly "Best N"');

  // A remembered best of 7 restores into the readout the moment the store is
  // created — which on the page is the load of the page itself.
  const storage = makeStorage({ [BEST_STORAGE_KEY]: '7' });
  const readout = makeReadout();
  const store = createBestStore({ storage, readout });
  assert.equal(readout.textContent, 'Best 7', 'the remembered best is restored into the readout');
  assert.equal(store.best(), 7);

  // A worse run ends: the readout keeps the greater remembered best.
  assert.equal(store.settle(4), 7, 'settle returns the best now shown');
  assert.equal(readout.textContent, 'Best 7', 'a worse final score never lowers the best');
  assert.equal(storage.getItem(BEST_STORAGE_KEY), '7', 'the remembered best is left untouched');

  // An equal run ends: still the same best.
  store.settle(7);
  assert.equal(readout.textContent, 'Best 7', 'an equal final score keeps the best');

  // The just-finished run is the new best: the readout takes it at once.
  assert.equal(store.settle(9), 9);
  assert.equal(readout.textContent, 'Best 9', 'the just-finished run shows when it is the new best');
  assert.equal(storage.getItem(BEST_STORAGE_KEY), '9', 'the new best is stored');

  // A worse run again, after the new best: still never lowered.
  store.settle(2);
  assert.equal(readout.textContent, 'Best 9', 'a later worse run never lowers the new best');

  // The page wiring settles the final score through that same path: with a
  // remembered best of 9, a run that ends at 1 leaves the readout at 9.
  const page = wireBestPage({ storage: makeStorage({ [BEST_STORAGE_KEY]: '9' }) });
  page.start.click();
  playOut(page);
  assert.equal(page.finalScore.textContent, '1', 'the run ended at final score 1');
  assert.equal(page.best.textContent, 'Best 9', 'the game-over transition shows the greatest of the stored best and the final score');
});

test('unit:best-score-persistence the best is written to localStorage on run end and re-read at page load, so a fresh page shows the same best and a later worse run never lowers it', () => {
  // Run end writes the new best: an empty browser has no best yet.
  const storage = makeStorage();
  assert.equal(storage.getItem(BEST_STORAGE_KEY), null, 'nothing remembered yet');
  const first = createBestStore({ storage, readout: makeReadout() });
  assert.equal(first.best(), 0, 'no remembered best reads as 0');
  first.settle(5);
  assert.equal(storage.getItem(BEST_STORAGE_KEY), '5', 'the best is written to localStorage on run end');

  // A fresh page load in the same browser: a second store over the same
  // storage reads the same best back into its own readout.
  const revisitReadout = makeReadout();
  const revisit = createBestStore({ storage, readout: revisitReadout });
  assert.equal(revisitReadout.textContent, 'Best 5', 'a fresh page shows the same best score');
  assert.equal(revisit.best(), 5);

  // A later worse run on that fresh page never lowers the remembered best.
  assert.equal(revisit.settle(2), 5);
  assert.equal(revisitReadout.textContent, 'Best 5', 'the worse run does not lower the best');
  assert.equal(storage.getItem(BEST_STORAGE_KEY), '5', 'the worse run does not rewrite storage');

  // A corrupt remembered value is "no best yet": 0, never NaN, never a throw.
  for (const corrupt of ['', '  ', 'abc', '-4', '2.5', 'Infinity']) {
    const broken = makeStorage({ [BEST_STORAGE_KEY]: corrupt });
    const readout = makeReadout();
    const store = createBestStore({ storage: broken, readout });
    assert.equal(readout.textContent, `Best 0`, `a corrupt best (${JSON.stringify(corrupt)}) reads as no best yet`);
    store.settle(3);
    assert.equal(broken.getItem(BEST_STORAGE_KEY), '3', `a corrupt best (${JSON.stringify(corrupt)}) is replaced by the first real best`);
  }

  // Storage that throws (blocked cookies, quota) never breaks the game: the
  // best still tracks for the current visit.
  const throwing = {
    getItem: () => {
      throw new Error('SecurityError');
    },
    setItem: () => {
      throw new Error('QuotaExceededError');
    },
  };
  const deniedReadout = makeReadout();
  const denied = createBestStore({ storage: throwing, readout: deniedReadout });
  assert.equal(deniedReadout.textContent, 'Best 0', 'a refusing storage reads as no best yet');
  denied.settle(4);
  assert.equal(deniedReadout.textContent, 'Best 4', 'the best still tracks when writes are refused');

  // No storage at all (and even no readout): the store still works.
  const bare = createBestStore({});
  assert.equal(bare.settle(2), 2, 'without storage the best lives for the visit');
  assert.equal(createBestStore({ storage: makeStorage({ [BEST_STORAGE_KEY]: '6' }) }).best(), 6, 'a readout-less store still reads the best');

  // The page writes the best through its game-over transition too.
  const pageStorage = makeStorage();
  const page = wireBestPage({ storage: pageStorage });
  page.start.click();
  playOut(page);
  assert.equal(page.finalScore.textContent, '1');
  assert.equal(pageStorage.getItem(BEST_STORAGE_KEY), '1', 'the wiring writes the new best at run end');
});

test('unit:best-score-revisit through the page wiring, a run that sets the best survives a fresh page load and a later worse run', () => {
  const storage = makeStorage();
  const page = wireBestPage({ storage });
  page.start.click();
  playOut(page);
  assert.equal(page.score.textContent, 'Score 1', 'the first run ate one piece and ended');
  assert.equal(page.finalScore.textContent, '1', 'the first run ended at final score 1');
  assert.equal(page.best.textContent, 'Best 1', 'the just-finished run is the new best');

  // Play again: the later run is worse (it never eats), and the best holds.
  page.playAgain.click();
  assert.equal(page.score.textContent, 'Score 0', 'the fresh run starts at exactly "Score 0"');
  playOut(page);
  assert.equal(page.finalScore.textContent, '0', 'the later run ended at final score 0');
  assert.equal(page.best.textContent, 'Best 1', 'the later worse run never lowers the best');
  assert.equal(storage.getItem(BEST_STORAGE_KEY), '1', 'the remembered best in storage is untouched by the worse run');

  // Leaving and reopening the page in the same browser: a fresh store over the
  // same storage restores the same best into a fresh readout.
  const reopened = makeReadout();
  createBestStore({ storage, readout: reopened });
  assert.equal(reopened.textContent, 'Best 1', 'a fresh page load still shows that same best score');
});

test('unit:best-score-page-shell the shipped page keeps the best readout the store renders into', async () => {
  const html = await readFile(join(ROOT, 'index.html'), 'utf8');
  const best = html.match(/<[a-z]+\b[^>]*\bid="best"[^>]*>([^<]*)</i);
  assert.ok(best, 'the best readout is on the page');
  assert.equal(best[1], 'Best 0', 'the best readout starts at "Best 0" for a first visit');
});
