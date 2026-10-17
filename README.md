# Snake

A browser Snake game, built end to end by Graphyard agents.

It will be published at <https://cryptob1.github.io/graphyard-snake-v4/>, opening
straight from the link with no install, account or login.

**Status:** the game is playable with a keyboard. Pressing **Start** (or **Play again**)
launches a run at `Score 0`: the snake moves by itself, one cell per tick, and you
steer it with the **arrow keys** or **W/A/S/D**. Eating food grows the snake and
raises the score by one. Hitting a wall or biting its own tail ends the run with
a game-over message naming the final score and a **Play again** button that
starts a fresh run without reloading the page. Swipes on a phone and the
remembered best score are not playable yet; they arrive with the later plan
items.

## What's on the page

- `index.html` — the game page: the **Snake** heading, the score readout (starts at
  `Score 0`), the best readout, the canvas play area, the **Start** button, and
  the hidden game-over overlay (final score plus **Play again**) that appears
  when a run ends.
- `css/style.css` — responsive layout; the board keeps a square aspect and sets
  `touch-action: none` so swipes on a phone never scroll the page.
- `js/engine.js` — the pure grid state machine (movement, steering, food,
  collisions, score) with no DOM.
- `js/main.js` — ES-module boot that wires the engine to the page: it draws the
  board, runs the tick timer, renders the score after every tick, steers with
  the keyboard and with `snake-steer` document events (so later input modes can
  reuse the same path), and drives game over and **Play again**.

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
Play again) on hand-rolled DOM and canvas stubs, and `tests/page-shell.test.js`
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
<https://cryptob1.github.io/graphyard-snake-v4/>.
`tests/delivery-workflow.test.js` checks that workflow: the test command, the
unchanged `graphyard-gate` job, and the Pages publish on push to `main`.
