import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const BUDGET_BYTES = 60 * 1024;

const readPage = () => readFile(join(ROOT, 'index.html'), 'utf8');

/** Local asset references (href/src) in the page, in document order. */
function referencedAssets(html) {
  return [...html.matchAll(/\b(?:href|src)\s*=\s*["']([^"']+)["']/gi)].map(m => m[1]);
}

/** Minimal plain static file server over the repository root, like GitHub Pages. */
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
};
function startStaticServer() {
  const server = createServer(async (req, res) => {
    let path = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    if (path.endsWith('/')) path += 'index.html';
    const file = normalize(join(ROOT, path));
    if (!file.startsWith(ROOT + sep)) { res.writeHead(403).end(); return; }
    try {
      const body = await readFile(file);
      res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' });
      res.end(body);
    } catch {
      res.writeHead(404).end();
    }
  });
  return new Promise(ok => server.listen(0, '127.0.0.1', () => ok(server)));
}

test('unit:page-content index.html names the game Snake in a visible heading', async () => {
  const html = await readPage();
  assert.match(html, /<h1[^>]*>\s*Snake\s*<\/h1>/i);
  assert.match(html, /<title>[^<]*Snake[^<]*<\/title>/i);
});

test('unit:page-content index.html has a canvas play area, a start control, score and best readouts', async () => {
  const html = await readPage();
  assert.match(html, /<canvas\b[^>]*\bid="board"/i);
  assert.match(html, /<button\b[^>]*\bid="start"[^>]*>\s*Start\s*<\/button>/i);
  const score = html.match(/<[a-z]+\b[^>]*\bid="score"[^>]*>([^<]*)</i);
  assert.ok(score, 'score readout present');
  assert.equal(score[1], 'Score 0');
  assert.match(html, /<[a-z]+\b[^>]*\bid="best"[^>]*>[^<]*Best[^<]*</i);
});

test('unit:page-content index.html carries the phone viewport meta', async () => {
  const html = await readPage();
  assert.match(html, /<meta\s+name="viewport"\s+content="[^"]*width=device-width[^"]*initial-scale=1[^"]*"/i);
});

test('unit:page-content js/main.js draws the idle board on a stub canvas', async () => {
  const { drawIdleBoard, GRID } = await import('../js/main.js');
  const calls = [];
  const ctx = new Proxy({}, {
    get: (target, key) => key in target ? target[key] : (...args) => calls.push([key, ...args]),
    set: (target, key, value) => { target[key] = value; return true; },
  });
  drawIdleBoard({ width: 400, height: 400, getContext: () => ctx });
  assert.deepEqual(calls[0], ['fillRect', 0, 0, 400, 400]);
  assert.ok(calls.filter(c => c[0] === 'fillRect').length > 1, 'idle snake drawn');
  assert.equal(GRID, 20);
});

test('integration:static-serve the page and every referenced asset are served with 200 and the right content type', async () => {
  const server = await startStaticServer();
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const page = await fetch(`${base}/`);
    assert.equal(page.status, 200);
    assert.match(page.headers.get('content-type'), /^text\/html/);
    const assets = referencedAssets(await page.text());
    assert.ok(assets.includes('css/style.css'), 'page references css/style.css');
    assert.ok(assets.includes('js/main.js'), 'page references js/main.js');
    for (const asset of assets) {
      const res = await fetch(new URL(asset, `${base}/`));
      assert.equal(res.status, 200, `${asset} status`);
      const type = res.headers.get('content-type');
      if (asset.endsWith('.css')) assert.match(type, /^text\/css/, `${asset} content type`);
      if (asset.endsWith('.js')) assert.match(type, /^(text|application)\/javascript/, `${asset} content type`);
      await res.arrayBuffer();
    }
  } finally {
    await new Promise(ok => server.close(ok));
  }
});

test('integration:asset-budget page plus assets stay under 60 KB with no external requests', async () => {
  const html = await readPage();
  const assets = referencedAssets(html);
  const external = /^(?:[a-z][a-z0-9+.-]*:)?\/\//i;
  for (const asset of assets) assert.doesNotMatch(asset, external, `${asset} is local`);
  let total = Buffer.byteLength(html);
  for (const asset of assets) {
    const text = await readFile(join(ROOT, asset), 'utf8');
    total += (await stat(join(ROOT, asset))).size;
    assert.doesNotMatch(text, /@import|url\(\s*["']?(?:[a-z]+:)?\/\//i, `${asset} pulls no remote CSS`);
    assert.doesNotMatch(text, /\bimport\s*(?:[^'"]*from\s*)?["'](?:[a-z]+:)?\/\//i, `${asset} imports no remote module`);
    assert.doesNotMatch(text, /\bfetch\s*\(|XMLHttpRequest|new\s+WebSocket/, `${asset} makes no network calls`);
  }
  assert.ok(total < BUDGET_BYTES, `total ${total} bytes under ${BUDGET_BYTES}`);
});
