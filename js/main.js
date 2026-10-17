// Boot: draw the idle board so the play area is visible as soon as the page loads.
export const GRID = 20;

export function drawIdleBoard(canvas) {
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
  // Idle snake in the middle of the board, waiting for Start.
  const mid = Math.floor(GRID / 2);
  ctx.fillStyle = '#3ddc84';
  for (let x = mid - 2; x <= mid; x++) ctx.fillRect(x * cell + 1, mid * cell + 1, cell - 2, cell - 2);
}

if (typeof document !== 'undefined') {
  const canvas = document.getElementById('board');
  if (canvas) drawIdleBoard(canvas);
}
