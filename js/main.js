// Boot: draw the idle board so the play area is visible as soon as the page loads,
// and wire Start to a minimal run. Steering, food and game over arrive with the
// game engine; until then a run moves the snake right until it reaches the wall.
export const GRID = 20;
export const TICK_MS = 150;

const idleSnake = () => {
  const mid = Math.floor(GRID / 2);
  return [[mid, mid], [mid - 1, mid], [mid - 2, mid]];
};

export function drawBoard(canvas, snake = idleSnake()) {
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
  ctx.fillStyle = '#3ddc84';
  for (const [x, y] of snake) ctx.fillRect(x * cell + 1, y * cell + 1, cell - 2, cell - 2);
}

export const drawIdleBoard = canvas => drawBoard(canvas);

/**
 * Wire the Start control: each press resets the score to "Score 0" and starts a
 * run in which the snake advances one cell per tick until its head reaches the wall.
 * The timer functions are injectable so tests can drive ticks by hand.
 */
export function wireStart({ canvas, start, score, setInterval: every = setInterval, clearInterval: stop = clearInterval }) {
  let timer = null;
  let snake = idleSnake();
  const step = () => {
    if (timer === null) return;
    const [hx, hy] = snake[0];
    if (hx + 1 >= GRID) {
      stop(timer);
      timer = null;
      start.disabled = false;
      return;
    }
    snake = [[hx + 1, hy], ...snake.slice(0, -1)];
    drawBoard(canvas, snake);
  };
  start.addEventListener('click', () => {
    if (timer !== null) stop(timer);
    snake = idleSnake();
    score.textContent = 'Score 0';
    start.disabled = true;
    drawBoard(canvas, snake);
    timer = every(step, TICK_MS);
  });
  return { snake: () => snake, running: () => timer !== null };
}

if (typeof document !== 'undefined') {
  const canvas = document.getElementById('board');
  const start = document.getElementById('start');
  const score = document.getElementById('score');
  if (canvas) drawIdleBoard(canvas);
  if (canvas && start && score) wireStart({ canvas, start, score });
}
