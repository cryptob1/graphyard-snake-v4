# Snake

A browser Snake game, built end to end by Graphyard agents.

It will be published at <https://cryptob1.github.io/graphyard-snake-v4/>, opening
straight from the link with no install, account or login.

**Status:** the game is playable with a keyboard and, on a phone, with swipes.
Pressing **Start** (or **Play again**) launches a run at `Score 0`: the snake
moves by itself, one cell per tick, and you steer it with the **arrow keys** or
**W/A/S/D**, or by **swiping** up, down, left or right across the board on a
touchscreen — swiping never scrolls the page away from the game. Eating food
grows the snake and raises the score by one. Hitting a wall or biting its own
tail ends the run with a game-over message naming the final score and a **Play
again** button that starts a fresh run without reloading the page. The **best**
score is kept across runs and visits: when a run ends the best readout shows the
greatest score reached so far (this run included when it is the new best), it is
stored in the browser's `localStorage`, and reopening the game later in the same
browser still shows it — a later worse run never lowers it.

## What's on the page

- `index.html` — the game page: the **Snake** heading, the score readout (starts at
  `Score 0`), the best readout (restored from the remembered best when the page
  opens), the canvas play area, the **Start** button, and the
  hidden game-over overlay (final score plus **Play again**) that appears
  when a run ends.
- `css/style.css` — responsive layout; the board keeps a square aspect and sets
  `touch-action: none` so swipes on a phone never scroll the page, and a
  phone-width media query keeps the whole game on one screen.
- `js/engine.js` — the pure grid state machine (movement, steering, food,
  collisions, score) with no DOM.
- `js/main.js` — ES-module boot that wires the engine to the page: it draws the
  board, runs the tick timer, renders the score after every tick, steers with
  the keyboard and with `snake-steer` document events (so later input modes can
  reuse the same path), and drives game over, **Play again** and the best score.
- `js/best-score.js` — the best-score store over `localStorage`: it reads the
  remembered best at page load and renders it into the best readout, and on run
  end it keeps and stores the greatest of the remembered best and the final
  score, so a worse run never lowers it.
- `js/swipe.js` — the phone's steering path: it listens for touch gestures on
  the board, reads the finished swipe's dominant direction (a small threshold
  filters taps and jiggles), dispatches the same `snake-steer` document event
  the keyboard path uses, and calls `preventDefault()` on every `touchmove`
  over the board (registered non-passive) so a steering swipe never scrolls the
  page away from the game.

Plain HTML, CSS and JavaScript: no build step and no runtime dependencies.

## Run it locally

Serve the repository root with any static file server, for example:

```sh
python3 -m http.server 8000   # then open http://localhost:8000/
```

## Tests

Tests use Node's built-in test runner (Node 18 or newer) with hand-rolled stubs, so
nothing needs installing:

```sh
npm test        # same as: node --test
```

`tests/game-engine.test.js` covers the pure engine, `tests/ui-wiring.test.js`
the page wiring (live run, keyboard steering, score and growth, game over and
Play again) on hand-rolled DOM and canvas stubs, `tests/best-score.test.js` the
remembered best score (the readout at run end, persistence across a simulated
fresh page load) on a localStorage stub, `tests/swipe.test.js` swipe steering
(the dispatching `snake-steer` event per direction, the running snake turning on
it, taps and diagonals, the prevented `touchmove` that keeps the page from
scrolling) on synthetic touch records, and `tests/page-shell.test.js`
checks the page content, serves the repository root over
plain static HTTP to confirm every referenced asset answers with the right content
type, and keeps the page plus its assets under a 60 KB budget with no external
requests.

## CI and deploy

`.github/workflows/graphyard-delivery.yml` runs on every pull request and push to
`main` (Node 26): the build job checks that `index.html` exists and every JavaScript
file parses, and the test job runs `node --test tests/`. Graphyard's merge gate
(`graphyard-gate`) passes only when both pass. On push to `main`, the deploy job
publishes the repository root as-is (no build, no dependencies) to GitHub Pages at
<https://cryptob1.github.io/graphyard-snake-v4/>: it commits the checked-out files
(plus `.nojekyll`) as the single commit of the `gh-pages` branch and pushes it over
SSH with the repository's provisioned deploy key, never the workflow token.

The deploy needs two repository settings:

- the `DEPLOY_KEY` Actions secret holds the private half of a deploy key registered
  on this repository with write access (the job fails with an error when it is unset);
- Settings → Pages → Source is "Deploy from a branch", branch `gh-pages`, folder `/`.

`tests/delivery-workflow.test.js` checks that workflow: the test command, the
unchanged `graphyard-gate` job, and the deploy-key Pages publish on push to `main`.
