import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRun } from '../js/engine.js';

/** Food is on the grid and on a cell the snake does not occupy. */
function assertFood(run) {
  assert.ok(Array.isArray(run.food), 'food is on the board');
  const [fx, fy] = run.food;
  assert.ok(
    fx >= 0 && fx < run.width && fy >= 0 && fy < run.height,
    `food [${fx},${fy}] is on the ${run.width}x${run.height} grid`,
  );
  assert.ok(!run.snake.some(([x, y]) => x === fx && y === fy), 'food is on a free cell');
}

test('unit:engine-tick a new run occupies grid cells, starts at score 0 and advances exactly one cell per tick in its current direction with no input', () => {
  const run = createRun(20, 20, { rng: () => 0 });
  assert.equal(run.status, 'running');
  assert.equal(run.score, 0, 'score starts at 0');
  assert.equal(run.direction, 'right');
  assert.equal(run.snake.length, 3, 'the starting snake occupies three cells');
  for (const [x, y] of run.snake) {
    assert.ok(x >= 0 && x < 20 && y >= 0 && y < 20, `cell [${x},${y}] is on the grid`);
  }
  assert.equal(
    new Set(run.snake.map(([x, y]) => `${x},${y}`)).size,
    run.snake.length,
    'the cells are distinct',
  );
  assertFood(run);

  const before = run.snake.map(([x, y]) => [x, y]);
  run.tick();
  assert.deepEqual(run.snake[0], [11, 10], 'the head advanced exactly one cell');
  assert.deepEqual(run.snake[1], before[0], 'the old head became the neck');
  assert.equal(run.snake.length, before.length, 'nothing grows without food');

  for (let i = 0; i < 5; i++) run.tick(); // no steering input at all
  assert.deepEqual(run.snake[0], [16, 10], 'six ticks moved the head six cells straight right');
  assert.equal(run.score, 0, 'no food was eaten, so the score is still 0');
  assert.equal(run.status, 'running');
});

test('unit:engine-steering turns up, down, left and right from both arrow-key and WASD inputs and rejects a 180-degree reversal into the snake\'s own neck', () => {
  // Every input name, checked against a snake whose neck sits where the tested
  // direction never points, so each case exercises acceptance, not rejection.
  const cases = [
    { input: 'ArrowUp', direction: 'up', move: [0, -1] },
    { input: 'w', direction: 'up', move: [0, -1] },
    { input: 'ArrowDown', direction: 'down', move: [0, 1] },
    { input: 's', direction: 'down', move: [0, 1] },
    { input: 'ArrowLeft', direction: 'left', move: [-1, 0], snake: [[10, 10], [10, 9], [10, 8]], start: 'down' },
    { input: 'a', direction: 'left', move: [-1, 0], snake: [[10, 10], [10, 9], [10, 8]], start: 'down' },
    { input: 'ArrowRight', direction: 'right', move: [1, 0] },
    { input: 'd', direction: 'right', move: [1, 0] },
    { input: 'up', direction: 'up', move: [0, -1] },
    { input: 'left', direction: 'left', move: [-1, 0], snake: [[10, 10], [10, 9], [10, 8]], start: 'down' },
    { input: 'down', direction: 'down', move: [0, 1] },
    { input: 'right', direction: 'right', move: [1, 0] },
  ];
  for (const { input, direction, move, snake, start = 'right' } of cases) {
    const run = createRun(20, 20, { rng: () => 0, snake, direction: start });
    const [hx, hy] = run.snake[0];
    assert.equal(run.turn(input), true, `${input} is accepted`);
    assert.equal(run.direction, direction, `${input} selects ${direction}`);
    run.tick();
    assert.deepEqual(run.snake[0], [hx + move[0], hy + move[1]], `${input} moves the head one cell ${direction}`);
    assert.equal(run.status, 'running');
  }

  // A run moving right rejects every name for its 180-degree reversal into the neck.
  const run = createRun(20, 20, { rng: () => 0 });
  assert.equal(run.direction, 'right');
  for (const input of ['ArrowLeft', 'a', 'left']) {
    assert.equal(run.turn(input), false, `${input} reverses into the neck and is rejected`);
    assert.equal(run.direction, 'right', 'a rejected turn leaves the direction alone');
  }
  run.tick();
  assert.deepEqual(run.snake[0], [11, 10], 'the snake keeps going right, not into its neck');

  // Two quick turns between ticks cannot reverse the snake either.
  assert.equal(run.turn('ArrowUp'), true);
  assert.equal(run.turn('ArrowLeft'), false, 'the second turn would reach the neck cell');
  run.tick();
  assert.deepEqual(run.snake[0], [11, 9], 'the head moved up instead');

  // Unknown inputs are rejected without throwing.
  for (const input of ['q', 'diagonal', '', undefined, null]) {
    assert.equal(run.turn(input), false, `${String(input)} is not a direction`);
  }
  assert.equal(run.direction, 'up');
});

test('unit:engine-food-score food spawns on a free cell the snake can reach; eating grows the snake by one cell and raises the score by exactly 1 per piece', () => {
  const run = createRun(20, 20, { rng: () => 0, food: [13, 10] });
  assert.deepEqual(run.food, [13, 10]);
  assertFood(run);
  run.tick();
  run.tick();
  assert.deepEqual(run.snake[0], [12, 10], 'two ticks, two cells');
  run.tick();
  assert.deepEqual(run.snake[0], [13, 10], 'the head reached the food cell');
  assert.equal(run.snake.length, 4, 'the snake grew by exactly one cell');
  assert.equal(run.score, 1, 'the score rose by exactly 1');
  assertFood(run, 'the next piece spawned on a free cell again');

  // Steer to three pieces wherever they spawn: every spawn is free and reachable,
  // and each piece adds exactly one cell and one point to the run.
  let draws = 0;
  const hunt = createRun(20, 20, { rng: () => ((draws += 1) * 0.61803398875) % 1 });
  assertFood(hunt);
  const vectors = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
  let steps = 0;
  while (hunt.score < 3) {
    assert.ok(steps++ < 500, 'the snake reaches its food on an open board');
    const [hx, hy] = hunt.snake[0];
    const safe = Object.entries(vectors)
      .filter(([, [dx, dy]]) => {
        const nx = hx + dx;
        const ny = hy + dy;
        if (nx < 0 || nx >= hunt.width || ny < 0 || ny >= hunt.height) return false;
        return !hunt.snake.slice(0, -1).some(([x, y]) => x === nx && y === ny);
      })
      .map(([name]) => name);
    assert.ok(safe.length > 0, 'a reachable next cell always exists on this board');
    const [fx, fy] = hunt.food;
    const wanted = [];
    if (fx !== hx) wanted.push(fx > hx ? 'right' : 'left');
    if (fy !== hy) wanted.push(fy > hy ? 'down' : 'up');
    const choice = wanted.find(name => safe.includes(name)) ?? safe[0];
    assert.equal(hunt.turn(choice), true, 'a step that is safe is never the neck reversal');
    hunt.tick();
    assert.equal(hunt.status, 'running', 'the hunt never crashes');
    assert.equal(hunt.snake.length, 3 + hunt.score, 'exactly one cell longer per piece eaten');
    assertFood(hunt);
  }
  assert.equal(hunt.score, 3, 'three pieces eaten');
  assert.equal(hunt.snake.length, 6, 'three cells longer than the three-cell start');
});

test('unit:engine-wall-crash moving the head into a wall ends the run as game over carrying the final score, with no exception thrown', () => {
  const crashes = [
    { snake: [[4, 2], [3, 2], [2, 2]], direction: 'right', wall: 'right' },
    { snake: [[0, 2], [1, 2], [2, 2]], direction: 'left', wall: 'left' },
    { snake: [[2, 0], [3, 0], [4, 0]], direction: 'up', wall: 'top' },
    { snake: [[2, 4], [3, 4], [4, 4]], direction: 'down', wall: 'bottom' },
  ];
  for (const { snake, direction, wall } of crashes) {
    const run = createRun(5, 5, { snake, direction, rng: () => 0 });
    const head = [...run.snake[0]];
    let ended;
    assert.doesNotThrow(() => {
      ended = run.tick();
    }, `steering into the ${wall} wall never throws`);
    assert.equal(run.status, 'over', `the ${wall} wall ends the run`);
    assert.equal(run.score, 0, 'the final score is carried');
    assert.deepEqual(run.snake[0], head, 'the head stays on its last on-board cell');
    assert.equal(ended, run, 'tick returns the run');
    assert.doesNotThrow(() => run.tick(), 'ticking a finished run never throws');
    assert.equal(run.status, 'over', 'a finished run stays over');
    assert.equal(run.turn('up'), false, 'steering a finished run changes nothing');
  }

  // A run that scored before the crash carries that score into game over.
  const run = createRun(5, 5, {
    snake: [[1, 2], [0, 2]],
    direction: 'right',
    food: [3, 2],
    rng: () => 0,
  });
  run.tick(); // head [2,2]
  run.tick(); // head [3,2]: eats, score 1
  assert.equal(run.score, 1);
  run.tick(); // head [4,2]
  assert.equal(run.status, 'running');
  assert.doesNotThrow(() => run.tick()); // the head would leave the board
  assert.equal(run.status, 'over', 'leaving the board ends the run');
  assert.equal(run.score, 1, 'game over carries the final score');
});

test('unit:engine-self-collision moving the head into the snake\'s own body ends the run as game over carrying the final score, with no exception thrown', () => {
  // A bent snake: turning down steers the head into its own body.
  const snake = [[3, 2], [2, 2], [2, 3], [3, 3], [4, 3], [4, 2]];
  const run = createRun(8, 8, { snake, direction: 'right', rng: () => 0 });
  assert.equal(run.turn('down'), true, 'the turn itself is legal: the cell below is not the neck');
  let ended;
  assert.doesNotThrow(() => {
    ended = run.tick();
  }, 'entering the body never throws');
  assert.equal(run.status, 'over', 'the head entered the snake\'s own body');
  assert.equal(run.score, 0);
  assert.deepEqual(run.snake, snake, 'the snake freezes on its last position');
  assert.equal(ended, run, 'tick returns the run');
  assert.doesNotThrow(() => run.tick(), 'ticking a finished run never throws');
  assert.equal(run.status, 'over', 'a finished run stays over');
  assert.equal(run.turn('left'), false, 'steering a finished run changes nothing');

  // The tail cell vacates in the same tick while the snake is not growing, so
  // entering it is safe; the run continues.
  const ring = createRun(8, 8, {
    snake: [[2, 2], [3, 2], [4, 2], [4, 3], [3, 3], [2, 3]],
    direction: 'right',
    rng: () => 0,
  });
  assert.equal(ring.turn('down'), true, 'the tail cell is not the neck');
  assert.doesNotThrow(() => ring.tick());
  assert.equal(ring.status, 'running', 'the vacating tail cell does not end the run');
  assert.equal(ring.snake.length, 6, 'the length is unchanged');

  // A run that ate first carries its earned score into the game over.
  const scored = createRun(8, 8, {
    snake: [[1, 1], [0, 1], [0, 0], [1, 0], [2, 0], [3, 0], [3, 1], [3, 2], [2, 2], [1, 2]],
    direction: 'right',
    food: [2, 1],
    rng: () => 0,
  });
  scored.tick(); // head [2,1]: eats, score 1, snake grows to 11 cells
  assert.equal(scored.score, 1);
  assert.doesNotThrow(() => scored.tick()); // head [3,1]: the snake's own body
  assert.equal(scored.status, 'over', 'the head entered the body');
  assert.equal(scored.score, 1, 'game over carries the final score');
});
