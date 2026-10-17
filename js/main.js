// Boot: wire the pure grid engine (js/engine.js) to the page.
//
// The page owns three jobs and nothing else: it draws the run's current state
// (snake, food) on the canvas, it renders the score readout as exactly "Score N"
// after every change, and it turns inputs into engine calls through one steer
// path. The inputs are the keyboard (arrow keys and W/A/S/D, case-insensitive,
// unknown keys ignored) and a "snake-steer" document event whose detail carries
// any accepted input ("up", "ArrowLeft", "a", ...); later input modes (swipes)
// can dispatch that event instead of knowing the engine. A run ends when the
// engine says so — the snake hits a wall or bites its own body — and the page
// then shows the game-over message naming the final score plus a Play again
// control that starts a fresh run at "Score 0" without reloading the page.
//
// The wiring is dependency-injected for the node:test suites: the timer
// functions, the run factory and every DOM node are parameters, so tests drive
// ticks and events by hand with hand-rolled stubs (no installs). makeRun
// defaults to a fully deterministic engine run (food always at the first free
// cell) so the exported helper behaves reproducibly; the boot code below passes
// Math.random so real games scatter their food.

import { createRun } from './engine.js';

export const GRID = 20;
export const TICK_MS = 150;

export const SNAKE_COLOR = '#3ddc84';
export const FOOD_COLOR = '#ff5252';

const idleSnake = () => {
  const mid = Math.floor(GRID / 2);
  return [[mid, mid], [mid - 1, mid], [mid - 2, mid]];
};

export function drawBoard(canvas, snake = idleSnake(), food = null) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const cell = canvas.width / GRID;
  ctx.fillStyle = '#1a2029';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = '#222a35';
  ctx.lineWidth = 1;
  for (let i = 1; i < GRID; i++) {
    ctx.beginPath();
    ctx.moveTo(i * cell, 0);
    ctx.lineTo(i * cell, canvas.height);
    ctx.moveTo(0, i * cell);
    ctx.lineTo(canvas.width, i * cell);
    ctx.stroke();
  }
  ctx.fillStyle = SNAKE_COLOR;
  for (const [x, y] of snake) ctx.fillRect(x * cell + 1, y * cell + 1, cell - 2, cell - 2);
  if (food) {
    ctx.fillStyle = FOOD_COLOR;
    ctx.fillRect(food[0] * cell + 1, food[1] * cell + 1, cell - 2, cell - 2);
  }
}

export const drawIdleBoard = canvas => drawBoard(canvas);

// KeyboardEvent.key values that steer, mapped to their direction, lowercased.
const STEER_KEYS = {
  arrowup: 'up',
  arrowdown: 'down',
  arrowleft: 'left',
  arrowright: 'right',
  w: 'up',
  a: 'left',
  s: 'down',
  d: 'right',
};

/**
 * Steer every input mode through one path: `steer(input)` (the engine's
 * turn()). Keydown events for the arrow keys and W/A/S/D call it (unknown keys
 * are ignored, and steering keys keep their default so arrows never scroll the
 * page), and "snake-steer" document events call it with the event's detail, so
 * later input modes (swipes) can reuse the same path:
 *
 *   document.dispatchEvent(new CustomEvent('snake-steer', { detail: 'up' }));
 */
export function wireSteering(doc, steer) {
  doc.addEventListener('keydown', event => {
    const direction = STEER_KEYS[String(event.key ?? '').trim().toLowerCase()];
    if (direction === undefined) return; // unknown keys never freeze or throw
    if (typeof event.preventDefault === 'function') event.preventDefault();
    steer(direction);
  });
  doc.addEventListener('snake-steer', event => {
    steer(event.detail);
  });
}

/**
 * Wire the game loop. Start (or the game-over screen's Play again) launches a
 * run that advances one tick per interval with no key held; each tick redraws
 * the board and sets the score readout to exactly "Score N". When the engine
 * ends the run — wall or self collision — the loop stops, the game-over
 * message names the final score, and Play again (or Start) begins a fresh run
 * at "Score 0" without reloading the page.
 *
 * options: { canvas, start, score, doc, gameOver, finalScore, playAgain,
 * setInterval = setInterval, clearInterval = clearInterval,
 * makeRun = () => createRun(GRID, GRID, { rng: () => 0 }) } — the nodes and
 * the timer are injectable so tests can drive them; gameOver/finalScore/
 * playAgain/doc may be omitted when the caller only wants the loop.
 */
export function wireStart({
  canvas,
  start,
  score,
  doc = null,
  gameOver = null,
  finalScore = null,
  playAgain = null,
  setInterval: every = setInterval,
  clearInterval: stop = clearInterval,
  makeRun = () => createRun(GRID, GRID, { rng: () => 0 }),
}) {
  let timer = null;
  let run = null;

  const steer = input => (run === null ? false : run.turn(input));

  const stopTimer = () => {
    if (timer !== null) {
      stop(timer);
      timer = null;
    }
  };

  const beginRun = () => {
    stopTimer();
    run = makeRun();
    score.textContent = `Score ${run.score}`;
    start.disabled = true;
    if (gameOver) gameOver.hidden = true;
    drawBoard(canvas, run.snake, run.food);
    timer = every(step, TICK_MS);
  };

  const endRun = () => {
    stopTimer();
    start.disabled = false;
    if (finalScore) finalScore.textContent = String(run.score);
    if (gameOver) gameOver.hidden = false; // the game-over message names the final score
  };

  const step = () => {
    if (timer === null || run === null) return; // the run is over or idle: no-op
    run.tick();
    drawBoard(canvas, run.snake, run.food);
    score.textContent = `Score ${run.score}`;
    if (run.status === 'over') endRun();
  };

  start.addEventListener('click', beginRun);
  if (playAgain) playAgain.addEventListener('click', beginRun);
  if (doc) wireSteering(doc, steer);

  return {
    snake: () => (run === null ? idleSnake() : run.snake),
    running: () => timer !== null,
    run: () => run,
  };
}

if (typeof document !== 'undefined') {
  const canvas = document.getElementById('board');
  const start = document.getElementById('start');
  const score = document.getElementById('score');
  const gameOver = document.getElementById('game-over');
  const finalScore = document.getElementById('final-score');
  const playAgain = document.getElementById('play-again');
  if (canvas) drawIdleBoard(canvas);
  if (canvas && start && score) {
    wireStart({
      canvas,
      start,
      score,
      doc: document,
      gameOver,
      finalScore,
      playAgain,
      makeRun: () => createRun(GRID, GRID, { rng: Math.random }),
    });
  }
}
