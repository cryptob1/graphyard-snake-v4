# Snake

A browser Snake game, built end to end by Graphyard agents.

It will be published at <https://cryptob1.github.io/graphyard-snake-v4/>, opening
straight from the link with no install, account or login.

**Status:** this is the page shell. Pressing **Start** resets the score to `Score 0`
and the snake moves right by itself, one cell per tick, until it reaches the wall;
then **Start** can be pressed again. Steering (arrow keys, WASD, swipes), food,
growth, scoring, game over and the remembered best score are not playable yet; they
arrive with the game engine and the later plan items.

## What's on the page

- `index.html` — the game page: the **Snake** heading, the score readout (starts at
  `Score 0`), the best readout, the canvas play area and the **Start** button.
- `css/style.css` — responsive layout; the board keeps a square aspect and sets
  `touch-action: none` so swipes on a phone never scroll the page.
- `js/main.js` — ES-module boot that draws the idle board when the page loads and
  wires **Start** to the minimal run described above.

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

`tests/page-shell.test.js` checks the page content and the Start run, serves the repository root over
plain static HTTP to confirm every referenced asset answers with the right content
type, and keeps the page plus its assets under a 60 KB budget with no external
requests.
