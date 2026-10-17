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
(`graphyard-gate`) passes only when both pass. On push to `main`, once build and
test pass, the deploy job publishes the repository root as-is (no build, no
dependencies) to GitHub Pages at <https://cryptob1.github.io/graphyard-snake-v4/>
with the official Pages actions: `actions/upload-pages-artifact` uploads the
checked-out files and `actions/deploy-pages` deploys them to the `github-pages`
environment. The job authenticates with its own `pages: write` and `id-token: write`
permissions, so it needs no repository secret and pushes no branch.

The deploy needs one repository setting: Settings → Pages → Source is
"GitHub Actions". With that source, Pages serves only what `actions/deploy-pages`
deploys, so the site keeps showing whatever was last deployed until the deploy job
first succeeds on `main`. To check a deploy, open the deploy job's run on `main` (its
`github-pages` environment links the page URL) and load
<https://cryptob1.github.io/graphyard-snake-v4/>: it should serve this repository's
`index.html` (the page titled "Snake").

`tests/delivery-workflow.test.js` checks that workflow's test command, the unchanged
`graphyard-gate` job and that publishing adds no build step;
`tests/pages-deploy-workflow.test.js` checks the deploy job: the official Pages
actions, its permissions and environment, no secret or branch push, and that it runs
only on push to `main` after build and test.

## Graphyard worker capacity

The repository declares how many worker profiles its Graphyard installation runs
in `graphyard.json`:

```json
"capacity": { "workers": 2 }
```

A worker profile holds at most one ready item at a time, so a plan whose items
touch disjoint files and could run in parallel would serialize on a single
profile: every sibling dispatch waits for the one profile to free, and ready→claim
runs far past its 2-minute budget while the sibling delivers. With two profiles,
two ready items with disjoint planned files are claimed in the same dispatch
cycle. `tests/worker-capacity.test.js` pins the declaration and the plan that
reconciles a host to it.

From the coordinator checkout — the one whose `.graphyard/` holds `master.json`,
never a managed worktree — reconcile the host to the declaration:

```sh
node scripts/graphyard-executor.mjs --status    # show the declaration and the live profiles
node scripts/graphyard-executor.mjs --install   # bring the installation up to the declared count
```

`--install` uses only Graphyard's own commands: `graphyard principal add
<install>-worker-N --role worker` for each principal the roster lacks, a copy of
the new credential where `master environments` discovers worker credentials, and
`graphyard master environments --apply` to write the launch profile into
`.graphyard/master.json`, which the master loop adopts on its next tick without a
restart. It is idempotent, `--count N` overrides the declaration for one run, and
it never removes a profile: lowering the count is reported, and the removal stays
an operator action.
