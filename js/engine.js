// Pure grid Snake engine: a dependency-free ES-module state machine with no DOM.
//
// A run is created by createRun(width, height) and carries its whole state as plain
// fields so a caller (tests now, the page wiring later) can render or assert it:
//
//   const run = createRun(20, 20);
//   run.turn('ArrowUp');   // or 'up', 'w', 'a', 's', 'd', 'ArrowLeft', ...
//   run.tick();            // advance the snake one cell in the current direction
//   run.score, run.snake, run.food, run.direction, run.status
//
// Cells are [x, y] pairs with y growing downward, as on a canvas. The snake array
// lists the head first and the tail last. Each tick() advances the head exactly one
// cell in run.direction; turn() may be called any number of times between ticks, but
// a turn that would steer the head into its own neck cell (a 180-degree reversal)
// is rejected and leaves the direction unchanged, so two quick turns between ticks
// cannot reverse the snake either. Moving the head off the board or into the snake's
// own body ends the run: status becomes 'over', the state keeps the final score and
// the last position, and nothing is thrown — later ticks and turns are no-ops.
//
// Food always spawns on a free cell (never on the snake); with walls on every side
// every free cell is one the snake can steer to. Eating a piece grows the snake by
// exactly one cell and raises the score by exactly 1. The one subtlety: entering the
// tail cell is safe while the snake is not growing, because the tail vacates that
// cell in the same tick; while eating, the tail stays put and the whole body is
// fatal. A board the snake has completely filled has no free cell left, so that run
// ends too, carrying its final score.
//
// The engine is deterministic given its rng: createRun accepts { rng } (a function
// returning a float in [0, 1), Math.random by default) plus { snake, direction,
// food } overrides so tests can place pieces exactly.

export const DIRECTIONS = {
  up: [0, -1],
  down: [0, 1],
  left: [-1, 0],
  right: [1, 0],
};

// Accepted turn() inputs, mapped to their direction: the plain names, the arrow-key
// names (KeyboardEvent.key values), and the WASD keys, case-insensitive.
const INPUT_DIRECTIONS = new Map(
  Object.entries({
    up: 'up',
    down: 'down',
    left: 'left',
    right: 'right',
    arrowup: 'up',
    arrowdown: 'down',
    arrowleft: 'left',
    arrowright: 'right',
    w: 'up',
    s: 'down',
    a: 'left',
    d: 'right',
  }),
);

const sameCell = (a, b) => a[0] === b[0] && a[1] === b[1];

const inBounds = (cell, width, height) =>
  cell[0] >= 0 && cell[0] < width && cell[1] >= 0 && cell[1] < height;

/** The default starting snake: three cells on the middle row, head to the right. */
function defaultSnake(width, height) {
  const y = Math.floor(height / 2);
  const head = Math.max(2, Math.floor(width / 2));
  return [
    [head, y],
    [head - 1, y],
    [head - 2, y],
  ];
}

/** Put food on a free cell, picked with rng from the free cells in row-major order. */
function spawnFood(run, rng) {
  const free = [];
  for (let y = 0; y < run.height; y++) {
    for (let x = 0; x < run.width; x++) {
      if (!run.snake.some(cell => cell[0] === x && cell[1] === y)) free.push([x, y]);
    }
  }
  if (free.length === 0) {
    run.food = null; // the snake fills the board: no free cell remains
    return false;
  }
  const index = Math.min(free.length - 1, Math.floor(rng() * free.length));
  run.food = free[index];
  return true;
}

/** Steer the run towards `input`; false when the input is unknown, the run is over,
 *  or the turn would move the head into its own neck (a 180-degree reversal). */
function steer(run, input) {
  if (run.status !== 'running') return false;
  const direction = INPUT_DIRECTIONS.get(String(input ?? '').trim().toLowerCase());
  if (direction === undefined) return false;
  if (run.snake.length >= 2) {
    const [dx, dy] = DIRECTIONS[direction];
    const [hx, hy] = run.snake[0];
    if (sameCell([hx + dx, hy + dy], run.snake[1])) return false;
  }
  run.direction = direction;
  return true;
}

/** Advance the run by one tick: move the head, eat and grow, or end the run. */
function advance(run, rng) {
  if (run.status !== 'running') return run;
  const [dx, dy] = DIRECTIONS[run.direction];
  const [hx, hy] = run.snake[0];
  const next = [hx + dx, hy + dy];
  if (!inBounds(next, run.width, run.height)) return endRun(run);
  const eating = run.food !== null && sameCell(next, run.food);
  // The tail cell vacates this tick unless the snake grows, so it only blocks then.
  const blocking = eating ? run.snake : run.snake.slice(0, -1);
  if (blocking.some(cell => sameCell(cell, next))) return endRun(run);
  run.snake.unshift(next);
  if (eating) {
    run.score += 1;
    if (!spawnFood(run, rng)) endRun(run); // no free cell left after growing
  } else {
    run.snake.pop();
  }
  return run;
}

function endRun(run) {
  run.status = 'over';
  return run;
}

/**
 * Create a run on a width x height grid. The snake starts as three cells moving
 * right at score 0, and food spawns on a free cell immediately.
 *
 * options: { rng = Math.random, snake, direction = 'right', food } — the last
 * three override the defaults so tests can stage exact situations.
 */
export function createRun(width, height, options = {}) {
  const { rng = Math.random, direction = 'right', snake, food } = options;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 3 || height < 3) {
    throw new RangeError(
      `createRun needs integer width and height of at least 3 (got ${width}x${height})`,
    );
  }
  if (!(typeof rng === 'function')) throw new TypeError('rng must be a function');
  if (DIRECTIONS[direction] === undefined) {
    throw new RangeError(`unknown direction ${JSON.stringify(direction)}`);
  }
  const cells = snake ?? defaultSnake(width, height);
  if (!Array.isArray(cells) || cells.length === 0) {
    throw new TypeError('snake must be a non-empty array of [x, y] cells');
  }
  for (const cell of cells) {
    if (
      !Array.isArray(cell) ||
      !Number.isInteger(cell[0]) ||
      !Number.isInteger(cell[1]) ||
      !inBounds(cell, width, height)
    ) {
      throw new RangeError(`snake cell ${JSON.stringify(cell)} is outside the ${width}x${height} grid`);
    }
  }
  if (new Set(cells.map(cell => cell.join(','))).size !== cells.length) {
    throw new RangeError('snake cells must be distinct');
  }

  const run = {
    width,
    height,
    snake: cells.map(cell => [cell[0], cell[1]]),
    direction,
    food: null,
    score: 0,
    status: 'running',
    turn(input) {
      return steer(run, input);
    },
    tick() {
      return advance(run, rng);
    },
  };

  if (food !== undefined) {
    if (
      !Array.isArray(food) ||
      !Number.isInteger(food[0]) ||
      !Number.isInteger(food[1]) ||
      !inBounds(food, width, height) ||
      run.snake.some(cell => sameCell(cell, food))
    ) {
      throw new RangeError(`food ${JSON.stringify(food)} is not a free cell of the ${width}x${height} grid`);
    }
    run.food = [food[0], food[1]];
  } else {
    spawnFood(run, rng);
  }
  return run;
}
