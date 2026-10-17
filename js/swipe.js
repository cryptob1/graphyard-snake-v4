// Swipe steering: the phone's touch path into the run's one steer route.
//
// The module is deliberately self-contained — it owns one script tag in index.html
// and touches no other file. It listens for touchstart/touchend on the board
// element, measures the finished gesture's dominant axis against a small threshold,
// and dispatches the same "snake-steer" document event the keyboard path obeys
// (detail 'up' | 'down' | 'left' | 'right'), so js/main.js turns the running snake
// and this file never needs to know the engine exists. A tap or a jiggle under the
// threshold steers nothing, and a diagonal counts only on its dominant axis.
//
// Swiping must never scroll the page away from the game. The board's CSS sets
// `touch-action: none`, and this module calls preventDefault() on every touchmove
// over the board, registered non-passive so the browser must honour it — the same
// promise made twice, once in style and once in code, because a steering gesture
// and a scroll start out identical and the run must keep going either way.
//
// Like js/main.js the wiring is dependency-injected for the node:test suites: the
// board, the document and the threshold are parameters, so tests replay synthetic
// touch records on hand-rolled stubs with no installs.

export const SWIPE_THRESHOLD_PX = 24;

/** The first touch of a gesture: tests' synthetic touch records carry the same
 *  identifier/clientX/clientY fields a real Touch does. */
const firstTouch = list => (list && list.length ? list[0] : null);

/** The touch a gesture started with, matched through to its end by identifier. */
const touchWith = (list, identifier) => {
  if (!list) return null;
  if (identifier !== null && identifier !== undefined) {
    const found = Array.prototype.find.call(list, entry => entry.identifier === identifier);
    if (found) return found;
  }
  return firstTouch(list);
};

/**
 * The dominant direction of a (dx, dy) swipe delta, or null under the threshold:
 * the larger axis wins (left/right take ties, |dx| >= |dy|, matching what a hand
 * swiping across a square board means), and a delta shorter than the threshold on
 * both axes is a tap or a jiggle and steers nothing.
 */
export function swipeDirection(dx, dy, threshold = SWIPE_THRESHOLD_PX) {
  const x = Math.abs(dx);
  const y = Math.abs(dy);
  if (x < threshold && y < threshold) return null;
  if (x >= y) return dx > 0 ? 'right' : 'left';
  return dy > 0 ? 'down' : 'up';
}

/** The "snake-steer" event js/main.js listens for: a real CustomEvent where the
 *  global exists (every current browser, and Node 19+ for the tests), else the
 *  plain record a hand-rolled stub document's listeners read. */
function steerEvent(direction) {
  if (typeof CustomEvent === 'function') {
    try {
      return new CustomEvent('snake-steer', { detail: direction });
    } catch {
      // fall through to the stub record
    }
  }
  return {
    type: 'snake-steer',
    detail: direction,
    defaultPrevented: false,
    preventDefault() {
      this.defaultPrevented = true;
    },
  };
}

/**
 * Wire swipe steering onto the board element.
 *
 * options: { board, doc, threshold = SWIPE_THRESHOLD_PX } — every one injectable
 * so node:test replays synthetic touch records on stubs; the boot code below
 * passes the page's real nodes. Returns the wiring (or null when board cannot
 * take listeners, so a missing board never throws at boot).
 */
export function wireSwipes({ board, doc, threshold = SWIPE_THRESHOLD_PX }) {
  if (!board || typeof board.addEventListener !== 'function' || !doc) return null;

  // The touch the current gesture started from, or null between gestures.
  let start = null;

  board.addEventListener('touchstart', event => {
    const touch = firstTouch(event.changedTouches) ?? firstTouch(event.touches);
    start = touch
      ? { x: touch.clientX, y: touch.clientY, identifier: touch.identifier ?? null }
      : null;
  });

  // Swiping never scrolls the page: preventDefault on every touchmove over the
  // board, registered non-passive so the browser must honour it. The board's
  // `touch-action: none` in css/style.css keeps the same promise in style.
  board.addEventListener(
    'touchmove',
    event => {
      if (typeof event.preventDefault === 'function') event.preventDefault();
    },
    { passive: false },
  );

  const dropGesture = () => {
    start = null;
  };

  board.addEventListener('touchend', event => {
    if (!start) return; // no gesture began: nothing to steer with
    const from = start;
    dropGesture();
    const touch = touchWith(event.changedTouches, from.identifier) ?? firstTouch(event.touches);
    if (!touch) return;
    const direction = swipeDirection(touch.clientX - from.x, touch.clientY - from.y, threshold);
    if (!direction) return; // a tap or a jiggle under the threshold steers nothing
    doc.dispatchEvent(steerEvent(direction));
  });

  // A cancelled gesture (an incoming call, a palm) steers nothing; the next
  // touchstart starts fresh.
  board.addEventListener('touchcancel', dropGesture);

  return { board, doc, threshold };
}

// Boot: wire the page's own board. js/main.js registers the document's
// "snake-steer" listener at its own boot, and module scripts evaluate in order,
// so by the time a finger can touch the board both halves of the path are live.
if (typeof document !== 'undefined' && typeof document.getElementById === 'function') {
  const board = document.getElementById('board');
  if (board) wireSwipes({ board, doc: document });
}
