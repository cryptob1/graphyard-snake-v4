import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { wireSwipes, swipeDirection, SWIPE_THRESHOLD_PX } from '../js/swipe.js';
import { wireStart, GRID } from '../js/main.js';
import { createRun } from '../js/engine.js';

const ROOT = join(fileURLToPath(new URL('..', import.meta.url)));

/** Hand-rolled board stub: records listeners (with their options) so synthetic
 *  touch records replay exactly what a finger did. */
class StubBoard {
  constructor() {
    this.listeners = new Map();
    this.options = new Map();
  }
  addEventListener(type, fn, options) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(fn);
    this.options.set(type, options);
  }
  dispatchEvent(event) {
    const fns = this.listeners.get(event.type) ?? [];
    for (const fn of fns) fn(event);
    return fns.length > 0;
  }
}

/** Hand-rolled document stub: the swipe module dispatches "snake-steer" events
 *  on it and the page wiring (js/main.js) listens for them there. */
class StubDoc {
  constructor() {
    this.listeners = new Map();
    this.steerEvents = [];
  }
  addEventListener(type, fn) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(fn);
  }
  dispatchEvent(event) {
    if (event.type === 'snake-steer') this.steerEvents.push(event);
    for (const fn of this.listeners.get(event.type) ?? []) fn(event);
    return true;
  }
}

/** A synthetic Touch record: the same identifier/clientX/clientY fields the
 *  module reads on a real one. */
const touch = (x, y, identifier = 0) => ({ identifier, clientX: x, clientY: y });

const touchEvent = (type, { touches = [], changed = [] } = {}) => ({
  type,
  touches,
  changedTouches: changed,
  defaultPrevented: false,
  preventDefault() {
    this.defaultPrevented = true;
  },
});

/** Replay one full finger gesture on the board: press at `from`, drag to `to`,
 *  lift. Each phase is dispatched the way a browser would. */
const swipe = (board, [x0, y0], [x1, y1]) => {
  board.dispatchEvent(touchEvent('touchstart', { changed: [touch(x0, y0)], touches: [touch(x0, y0)] }));
  board.dispatchEvent(touchEvent('touchmove', { changed: [touch(x1, y1)], touches: [touch(x1, y1)] }));
  board.dispatchEvent(touchEvent('touchend', { changed: [touch(x1, y1)], touches: [] }));
};

const wiredSwipes = () => {
  const board = new StubBoard();
  const doc = new StubDoc();
  const wiring = wireSwipes({ board, doc });
  return { board, doc, wiring };
};

test('unit:swipe-direction swiping up, down, left and right on the board dispatches the matching snake-steer event', () => {
  const { board, doc, wiring } = wiredSwipes();
  assert.ok(wiring, 'the board takes the wiring');
  assert.equal(wiring.threshold, SWIPE_THRESHOLD_PX, 'the default threshold is small but real');
  const center = [200, 200];
  const far = 120; // well past the threshold

  swipe(board, center, [center[0], center[1] - far]); // up
  swipe(board, center, [center[0], center[1] + far]); // down
  swipe(board, center, [center[0] - far, center[1]]); // left
  swipe(board, center, [center[0] + far, center[1]]); // right

  assert.deepEqual(
    doc.steerEvents.map(event => event.detail),
    ['up', 'down', 'left', 'right'],
  );
  for (const event of doc.steerEvents) assert.equal(event.type, 'snake-steer');
});

test('unit:swipe-direction the dispatched snake-steer event turns the running snake', () => {
  // The real page wiring on stubs: js/main.js steers "snake-steer" events into
  // the engine, so a swipe reaching the document turns the running snake — the
  // whole phone path, exactly as the page plays it, with no keyboard anywhere.
  const board = new StubBoard();
  const doc = new StubDoc();
  wireSwipes({ board, doc });
  const ctx = new Proxy({}, { get: () => () => {}, set: () => true });
  const canvas = { width: 400, height: 400, getContext: () => ctx };
  const listeners = {};
  const start = { disabled: false, addEventListener: (type, fn) => { listeners[type] = fn; } };
  const score = { textContent: '' };
  let tick = null;
  const wired = wireStart({
    canvas,
    start,
    score,
    doc,
    setInterval: fn => {
      tick = fn;
      return 1;
    },
    clearInterval: () => {},
    makeRun: () => createRun(GRID, GRID, { rng: () => 0 }),
  });
  listeners.click(); // Start
  assert.equal(wired.running(), true);

  // The run starts moving right by itself (the engine's default): head [10,10] → [11,10].
  tick();
  assert.deepEqual(wired.snake()[0], [11, 10]);

  // Swiping up turns the snake upward; the next tick moves the head up one cell.
  swipe(board, [200, 200], [200, 80]);
  tick();
  assert.deepEqual(wired.snake()[0], [11, 9], 'swiping up turned the snake upward');

  // Then left, then down — the UAT sequence, each a legal non-reversal turn.
  swipe(board, [200, 200], [80, 200]);
  tick();
  assert.deepEqual(wired.snake()[0], [10, 9], 'swiping left turned it leftward');

  swipe(board, [200, 200], [200, 320]);
  tick();
  assert.deepEqual(wired.snake()[0], [10, 10], 'swiping down turned it downward');

  assert.equal(wired.running(), true, 'the run kept going through every swipe');
});

test('unit:swipe-direction a tap or an under-threshold jiggle dispatches nothing; a diagonal steers on its dominant axis', () => {
  const { board, doc } = wiredSwipes();

  // A tap: press and lift at the same point.
  swipe(board, [200, 200], [200, 200]);
  // A jiggle just under the threshold on both axes.
  swipe(board, [200, 200], [200 + SWIPE_THRESHOLD_PX - 1, 200 + SWIPE_THRESHOLD_PX - 1]);
  assert.equal(doc.steerEvents.length, 0, 'a tap or a jiggle steers nothing');

  // A diagonal gesture counts on its dominant axis only.
  swipe(board, [100, 100], [220, 140]); // dx=120, dy=40 → right
  swipe(board, [100, 100], [60, 240]); // dx=-40, dy=140 → down
  assert.deepEqual(
    doc.steerEvents.map(event => event.detail),
    ['right', 'down'],
  );

  // The pure rule the gestures follow: under the threshold on both axes is null.
  assert.equal(swipeDirection(0, 0), null);
  assert.equal(swipeDirection(SWIPE_THRESHOLD_PX - 1, 5), null);
  assert.equal(swipeDirection(SWIPE_THRESHOLD_PX, 0), 'right');
  assert.equal(swipeDirection(-SWIPE_THRESHOLD_PX, 0), 'left');
  assert.equal(swipeDirection(0, SWIPE_THRESHOLD_PX), 'down');
  assert.equal(swipeDirection(0, -SWIPE_THRESHOLD_PX), 'up');
  assert.equal(swipeDirection(30, 30), 'right', 'a tie counts on the horizontal axis');
  assert.equal(swipeDirection(5, 100), 'down');

  // A cancelled gesture (touchcancel) steers nothing, and the stray touchend
  // that may follow it does not either; the next swipe starts fresh.
  board.dispatchEvent(touchEvent('touchstart', { changed: [touch(200, 200)], touches: [touch(200, 200)] }));
  board.dispatchEvent(touchEvent('touchcancel', { changed: [touch(210, 210)], touches: [] }));
  board.dispatchEvent(touchEvent('touchend', { changed: [touch(200, 400)], touches: [] }));
  assert.equal(doc.steerEvents.length, 2, 'a cancelled gesture steers nothing');
  swipe(board, [200, 200], [200, 80]);
  assert.deepEqual(doc.steerEvents.map(event => event.detail).slice(-1), ['up']);
});

test('unit:swipe-no-scroll the board sets touch-action none in css/style.css', async () => {
  const css = await readFile(join(ROOT, 'css/style.css'), 'utf8');
  const boardRule = css.match(/\.board\b[^{]*\{[^}]*\}/);
  assert.ok(boardRule, 'the .board rule exists');
  assert.match(boardRule[0], /touch-action:\s*none\s*;/, 'the board rule sets touch-action: none');
});

test('unit:swipe-no-scroll the swipe handler prevents default on every touchmove over the board', () => {
  const { board } = wiredSwipes();
  for (const point of [[0, 0], [200, 200], [399, 399]]) {
    const move = touchEvent('touchmove', { touches: [touch(point[0], point[1])], changed: [touch(point[0], point[1])] });
    board.dispatchEvent(move);
    assert.equal(move.defaultPrevented, true, `touchmove at ${point} was prevented`);
  }
  // Registered non-passive, so the platform honours the preventDefault (a
  // passive listener's preventDefault is ignored by the browser).
  const options = board.options.get('touchmove');
  assert.ok(options && options.passive === false, 'the touchmove listener is registered { passive: false }');
});

test('unit:swipe-wiring index.html loads js/swipe.js beside js/main.js', async () => {
  const html = await readFile(join(ROOT, 'index.html'), 'utf8');
  assert.match(html, /<script\s+type="module"\s+src="js\/main\.js"><\/script>/);
  assert.match(html, /<script\s+type="module"\s+src="js\/swipe\.js"><\/script>/);
});
