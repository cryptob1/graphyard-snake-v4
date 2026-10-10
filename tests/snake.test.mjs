import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { Script, createContext } from 'node:vm';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const match = html.match(/<script\b[^>]*>([\s\S]*?)<\/script\s*>/i);
assert.ok(match, 'game has an inline script');
const script = new Script(match[1], { filename: 'index.html inline script' });

function game() {
  const elements = new Map();
  for (const id of ['board', 'score', 'start', 'gameover', 'final-score', 'again']) {
    const listeners = new Map();
    elements.set(id, {
      textContent: '', hidden: id === 'gameover', tagName: id === 'start' || id === 'again' ? 'BUTTON' : 'DIV',
      width: 400, height: 400,
      addEventListener(type, callback) { listeners.set(type, callback); },
      click() { assert.ok(listeners.has('click'), `${id} has click handler`); listeners.get('click')(); },
      focus() {}, blur() {},
      getContext() { return { fillRect() {}, beginPath() {}, arc() {}, fill() {}, set fillStyle(_) {} }; },
    });
  }
  const documentListeners = new Map();
  const timers = new Map();
  let nextTimer = 1;
  const context = createContext({
    document: {
      getElementById(id) { return elements.get(id); },
      addEventListener(type, callback) { documentListeners.set(type, callback); },
    },
    window: {},
    Math: Object.assign(Object.create(Math), { random: () => 0 }),
    setInterval(callback) { const id = nextTimer++; timers.set(id, callback); return id; },
    clearInterval(id) { timers.delete(id); },
  });
  script.runInContext(context);
  const api = context.window.Snake;
  const el = id => elements.get(id);
  return {
    api, el, timers,
    tick() { assert.equal(timers.size, 1, 'one active game timer'); [...timers.values()][0](); },
    key(key) {
      let prevented = false;
      documentListeners.get('keydown')({ key, target: { tagName: 'BODY' }, preventDefault() { prevented = true; } });
      assert.ok(prevented, `${key} handled`);
    },
  };
}

function head(g) { const { x, y } = g.api.getState().snake[0]; return { x, y }; }

test('unit:tests/snake.test.mjs initial score, timer movement, arrow steering and ignored reversal', () => {
  const g = game();
  assert.equal(g.el('score').textContent, 'Score 0');
  g.el('start').click();
  assert.deepEqual(head(g), { x: 10, y: 10 });
  g.tick();
  assert.deepEqual(head(g), { x: 11, y: 10 }, 'snake advances without a held key');
  g.key('ArrowLeft');
  g.tick();
  assert.deepEqual(head(g), { x: 12, y: 10 }, 'direct reversal ignored');
  for (const [key, expected] of [
    ['ArrowUp', { x: 12, y: 9 }],
    ['ArrowLeft', { x: 11, y: 9 }],
    ['ArrowDown', { x: 11, y: 10 }],
    ['ArrowRight', { x: 12, y: 10 }],
  ]) {
    g.key(key);
    g.tick();
    assert.deepEqual(head(g), expected, `${key} steers`);
  }
});

test('unit:tests/snake.test.mjs eating food grows one segment and updates exact score twice', () => {
  const g = game();
  g.el('start').click();
  for (let score = 1; score <= 2; score++) {
    const before = g.api.getState().snake.length;
    const h = head(g);
    g.api.getState().food = { x: h.x + 1, y: h.y };
    g.tick();
    assert.equal(g.api.getState().snake.length, before + 1);
    assert.equal(g.el('score').textContent, `Score ${score}`);
  }
});

test('unit:tests/snake.test.mjs wall collision stops timer, reports final score, and Play again resets without reload', () => {
  const g = game();
  g.el('start').click();
  const state = g.api.getState();
  state.snake = [{ x: 19, y: 10 }, { x: 18, y: 10 }, { x: 17, y: 10 }];
  state.score = 2;
  g.tick();
  assert.equal(state.over, true);
  assert.equal(state.running, false);
  assert.equal(g.timers.size, 0);
  assert.equal(g.el('gameover').hidden, false);
  assert.match(html, /<h2[^>]*id="gameover-title"[^>]*>Game over<\/h2>/i);
  assert.equal(g.el('final-score').textContent, 'Final score: 2');
  g.el('again').click();
  assert.equal(g.el('score').textContent, 'Score 0');
  assert.equal(g.el('gameover').hidden, true);
  assert.equal(g.api.getState().running, true);
  assert.equal(g.timers.size, 1);
});

test('unit:tests/snake.test.mjs self collision stops timer and reports final score', () => {
  const g = game();
  g.el('start').click();
  const state = g.api.getState();
  state.snake = [
    { x: 10, y: 10 }, { x: 10, y: 11 }, { x: 11, y: 11 },
    { x: 11, y: 10 }, { x: 12, y: 10 },
  ];
  state.score = 1;
  g.tick();
  assert.equal(state.over, true);
  assert.equal(state.running, false);
  assert.equal(g.timers.size, 0);
  assert.equal(g.el('gameover').hidden, false);
  assert.equal(g.el('final-score').textContent, 'Final score: 1');
});

const workflow = readFileSync(new URL('../.github/workflows/graphyard-delivery.yml', import.meta.url), 'utf8');
function job(name) {
  const start = workflow.indexOf(`  ${name}:\n`);
  assert.ok(start >= 0, `${name} job exists`);
  const rest = workflow.slice(start + name.length + 4);
  const end = rest.search(/^  [a-z-]+:/m);
  return end < 0 ? rest : rest.slice(0, end);
}

test('integration:ci-build-job checks complete page and parses inline script', () => {
  const build = job('build');
  const lines = build.split('\n');
  const begin = lines.findIndex(line => line.includes('run: |'));
  assert.ok(begin >= 0, 'build has a command block');
  const command = lines.slice(begin + 1).filter(line => line.startsWith('          ')).map(line => line.slice(10)).join('\n');
  assert.match(command, /new Script\(/);
  const directory = mkdtempSync(join(tmpdir(), 'snake-build-'));
  try {
    for (const [label, page, success] of [
      ['valid', html, true],
      ['missing', null, false],
      ['truncated', html.slice(0, 150), false],
      ['bad script', html.replace('var COLS = 20;', 'var COLS = ;'), false],
    ]) {
      if (page === null) rmSync(join(directory, 'index.html'), { force: true });
      else writeFileSync(join(directory, 'index.html'), page);
      const run = spawnSync('bash', ['-e', '-c', command], { cwd: directory, encoding: 'utf8' });
      assert.equal(run.status === 0, success, `${label}: ${run.stderr}`);
    }
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('integration:ci-test-job runs the dependency-free Node test file', () => {
  assert.match(job('test'), /- run: node --test tests\/snake\.test\.mjs/);
});

test('integration:graphyard-gate-check requires both successful jobs', () => {
  assert.match(workflow, /  pull_request:\n  push:\n    branches: \["main"\]/);
  assert.match(job('graphyard-gate'), /needs: \[build, test\]/);
  assert.match(job('graphyard-gate'), /if: always\(\)/);
  assert.match(job('graphyard-gate'), /test "\$BUILD" = success && test "\$TEST" = success/);
});
