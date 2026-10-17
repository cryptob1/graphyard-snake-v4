import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { wireStart, GRID, SNAKE_COLOR, FOOD_COLOR } from '../js/main.js';
import { createRun } from '../js/engine.js';

const ROOT = join(fileURLToPath(new URL('..', import.meta.url)));

const CELL = 400 / GRID; // the stub canvas is 400x400, like the page's board

/** Hand-rolled 2d-context stub that records every draw call with its color. */
function makeContext() {
  const calls = [];
  const ctx = {
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    fillRect(...args) {
      calls.push(['fillRect', this.fillStyle, ...args]);
    },
    beginPath() {
      calls.push(['beginPath']);
    },
    moveTo(...args) {
      calls.push(['moveTo', ...args]);
    },
    lineTo(...args) {
      calls.push(['lineTo', ...args]);
    },
    stroke() {
      calls.push(['stroke']);
    },
  };
  ctx.calls = calls;
  return ctx;
}

/** Hand-rolled DOM stub: an element with listeners, textContent, hidden. */
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
    const fns = this.listeners.get(event.type) ?? [];
    for (const fn of fns) fn(event);
    return fns.length > 0;
  }
  click() {
    return this.dispatchEvent({ type: 'click' });
  }
}

const keyEvent = key => ({
  type: 'keydown',
  key,
  defaultPrevented: false,
  preventDefault() {
    this.defaultPrevented = true;
  },
});

/** The document event alternate inputs reuse: detail carries the input. */
const steerEvent = detail => ({ type: 'snake-steer', detail });

/** A fully wired page on stubs; tick() drives one timer interval by hand. */
function wirePage({ makeRun } = {}) {
  const ctx = makeContext();
  const canvas = { width: 400, height: 400, getContext: () => ctx };
  const start = new StubElement('start');
  const score = new StubElement('score');
  const gameOver = new StubElement('game-over');
  const finalScore = new StubElement('final-score');
  const playAgain = new StubElement('play-again');
  const doc = new StubElement('document');
  let timerFn = null;
  let timerId = 0;
  const cleared = [];
  const wired = wireStart({
    canvas,
    start,
    score,
    doc,
    gameOver,
    finalScore,
    playAgain,
    makeRun,
    setInterval: fn => {
      timerFn = fn;
      return ++timerId;
    },
    clearInterval: id => {
      cleared.push(id);
    },
  });
  return {
    wired, canvas, ctx, start, score, gameOver, finalScore, playAgain, doc, cleared,
    tick: () => timerFn(),
  };
}

/** The cells (x, y) the stub context painted in the given color in the most
 *  recent draw (every draw repaints the whole board, so that is the board's
 *  current state). */
function paintedCells(ctx, color) {
  let start = 0;
  for (let i = 0; i < ctx.calls.length; i++) {
    if (ctx.calls[i][0] === 'fillRect' && ctx.calls[i][1] === '#1a2029') start = i + 1;
  }
  return ctx.calls
    .slice(start)
    .filter(call => call[0] === 'fillRect' && call[1] === color)
    .map(call => [Math.round((call[2] - 1) / CELL), Math.round((call[3] - 1) / CELL)]);
}

test('unit:ui-live-run Start draws snake and food, the snake advances on a timer with no key held, the score reads exactly "Score 0" from the first frame, and unknown keys neither freeze the run nor throw', () => {
  const page = wirePage();
  assert.equal(page.wired.running(), false, 'idle before Start');
  page.start.click();
  assert.equal(page.score.textContent, 'Score 0', 'score reads exactly "Score 0" on the first frame, before any tick');
  assert.equal(page.wired.running(), true, 'the run moves by itself on a timer');
  assert.deepEqual(
    paintedCells(page.ctx, SNAKE_COLOR),
    [[10, 10], [9, 10], [8, 10]],
    'the starting snake is drawn',
  );
  assert.deepEqual(paintedCells(page.ctx, FOOD_COLOR), [[0, 0]], 'food is drawn too');

  // No key held: the timer alone advances the head one cell per tick.
  page.tick();
  assert.deepEqual(page.wired.snake()[0], [11, 10], 'the head advanced one cell');
  assert.ok(paintedCells(page.ctx, SNAKE_COLOR).some(([x, y]) => x === 11 && y === 10), 'the moved snake is redrawn');
  assert.equal(page.wired.snake().length, 3, 'nothing grows without food ahead');
  assert.equal(page.score.textContent, 'Score 0', 'the score is unchanged without food');

  // Unknown keys are ignored: no throw, no freeze, the run keeps advancing.
  for (const key of ['q', 'Escape', '5', 'F1', '']) {
    const event = keyEvent(key);
    page.doc.dispatchEvent(event);
    assert.equal(event.defaultPrevented, false, `${JSON.stringify(key)} keeps its default`);
  }
  assert.equal(page.wired.running(), true, 'the run still moves after unknown keys');
  page.tick();
  assert.deepEqual(page.wired.snake()[0], [12, 10], 'the head still advances after unknown keys');
});

test('unit:ui-keyboard-steering each arrow key and each of W/A/S/D steers the running snake, and a "snake-steer" document event steers through the same path', () => {
  const cases = [
    ['ArrowUp', 'up', 0, -1],
    ['w', 'up', 0, -1],
    ['W', 'up', 0, -1],
    ['ArrowDown', 'down', 0, 1],
    ['s', 'down', 0, 1],
    ['ArrowLeft', 'left', -1, 0],
    ['a', 'left', -1, 0],
    ['ArrowRight', 'right', 1, 0],
    ['d', 'right', 1, 0],
  ];
  for (const [key, direction, dx, dy] of cases) {
    const page = wirePage();
    page.start.click();
    if (dx === -1) {
      // The run starts moving right with the neck on the left, so a left turn
      // needs a first turn up (a 180-degree reversal is rejected) to be legal.
      page.doc.dispatchEvent(keyEvent('ArrowUp'));
      page.tick();
    }
    const [x0, y0] = page.wired.snake()[0];
    const event = keyEvent(key);
    page.doc.dispatchEvent(event);
    assert.equal(event.defaultPrevented, true, `${key} is a steering key, so the page does not scroll`);
    page.tick();
    assert.deepEqual(
      page.wired.snake()[0],
      [x0 + dx, y0 + dy],
      `${key} steers the snake ${direction}`,
    );
    assert.equal(page.wired.running(), true, `${key} keeps the run moving`);
  }

  // The same path, driven by the document event later input modes reuse.
  const page = wirePage();
  page.start.click();
  page.doc.dispatchEvent(steerEvent('up'));
  page.tick();
  assert.deepEqual(page.wired.snake()[0], [10, 9], '"snake-steer" steers up through the same path');
  page.doc.dispatchEvent(steerEvent('ArrowRight'));
  page.tick();
  assert.deepEqual(page.wired.snake()[0], [11, 9], '"snake-steer" accepts key names through the same path');
  assert.equal(page.wired.running(), true, 'the run keeps moving');
});

test('unit:ui-score-growth eating food redraws the visibly longer snake and the score element reads exactly "Score 1", then "Score 2"', () => {
  // Food staged straight ahead of the starting snake; afterwards it respawns
  // deterministically at the first free cell [0, 0], which the run steers to.
  const page = wirePage({ makeRun: () => createRun(GRID, GRID, { food: [11, 10], rng: () => 0 }) });
  page.start.click();
  assert.equal(page.score.textContent, 'Score 0');
  assert.equal(paintedCells(page.ctx, SNAKE_COLOR).length, 3, 'three cells before eating');

  page.tick(); // the head enters the food cell
  assert.deepEqual(page.wired.snake()[0], [11, 10], 'the head reached the food');
  assert.equal(page.wired.snake().length, 4, 'the snake grew one cell');
  assert.equal(page.score.textContent, 'Score 1', 'the score reads exactly "Score 1"');
  assert.equal(paintedCells(page.ctx, SNAKE_COLOR).length, 4, 'the visibly longer snake is redrawn');
  assert.deepEqual(page.wired.run().food, [0, 0], 'new food spawns');

  // Steer up then left to the respawned food at [0, 0] for the second bite.
  page.doc.dispatchEvent(keyEvent('ArrowUp'));
  for (let i = 0; i < 10; i++) page.tick(); // head to [11, 0]
  page.doc.dispatchEvent(keyEvent('ArrowLeft'));
  for (let i = 0; i < 11; i++) page.tick(); // head to [0, 0]
  assert.deepEqual(page.wired.snake()[0], [0, 0], 'the head reached the second food');
  assert.equal(page.wired.snake().length, 5, 'the snake grew again');
  assert.equal(page.score.textContent, 'Score 2', 'the score reads exactly "Score 2"');
  assert.equal(paintedCells(page.ctx, SNAKE_COLOR).length, 5, 'the longer snake is redrawn');
  assert.equal(page.wired.running(), true, 'the run keeps going after eating');
});

test('unit:ui-game-over-replay a wall crash stops the loop, shows a game-over message naming the final score, and Play again starts a fresh run at exactly "Score 0" without reloading the page', async () => {
  const html = await readFile(join(ROOT, 'index.html'), 'utf8');
  assert.match(html, /<div\b[^>]*\bid="game-over"[^>]*\bhidden/i, 'the game-over overlay starts hidden');
  assert.match(html, /<span\b[^>]*id="final-score"/i, 'the message names the final score');
  assert.match(html, /<button\b[^>]*\bid="play-again"[^>]*>\s*Play again\s*<\/button>/i, 'one obvious Play again control');

  const page = wirePage({ makeRun: () => createRun(GRID, GRID, { food: [11, 10], rng: () => 0 }) });
  page.start.click();
  page.tick(); // eat the staged food: Score 1
  assert.equal(page.score.textContent, 'Score 1');
  for (let i = 0; i < 12; i++) page.tick(); // ride into the wall
  assert.equal(page.wired.running(), false, 'the wall ends the run');
  assert.equal(page.gameOver.hidden, false, 'the game-over message is shown');
  assert.equal(page.finalScore.textContent, '1', 'the message names the final score');
  assert.equal(page.score.textContent, 'Score 1', 'the score readout keeps the final score');
  assert.equal(page.start.disabled, false, 'Start is available again');
  assert.equal(page.cleared.length, 1, 'the timer stopped exactly once');

  page.playAgain.click();
  assert.equal(page.gameOver.hidden, true, 'the game-over message is hidden again');
  assert.equal(page.score.textContent, 'Score 0', 'the fresh run reads exactly "Score 0"');
  assert.equal(page.wired.running(), true, 'the fresh run moves by itself');
  assert.deepEqual(page.wired.snake()[0], [10, 10], 'the fresh snake starts from the beginning');
  page.tick();
  assert.deepEqual(page.wired.snake()[0], [11, 10], 'the fresh run advances without any reload');

  // The page never reloads: the wiring never touches the location.
  const main = await readFile(join(ROOT, 'js/main.js'), 'utf8');
  assert.doesNotMatch(main, /location\s*\.\s*(reload|href|assign|replace)|window\.location/, 'Play again never reloads the page');
});

test('unit:ui-game-over-replay the snake biting its own tail ends the run with the same game-over message', () => {
  // A coiled snake whose next step is its own body.
  const page = wirePage({
    makeRun: () => createRun(GRID, GRID, {
      snake: [[5, 5], [6, 5], [6, 6], [5, 6], [4, 6]],
      direction: 'right',
      food: [0, 0],
      rng: () => 0,
    }),
  });
  page.start.click();
  assert.equal(page.wired.running(), true);
  page.tick(); // the head moves right into its own neck cell
  assert.equal(page.wired.running(), false, 'the self-bite ends the run');
  assert.equal(page.wired.run().status, 'over');
  assert.equal(page.gameOver.hidden, false, 'the same game-over message is shown');
  assert.equal(page.finalScore.textContent, '0', 'the message names this run\'s final score');

  page.playAgain.click();
  assert.equal(page.score.textContent, 'Score 0');
  assert.equal(page.wired.running(), true, 'Play again restarts after a self-bite too');
});
