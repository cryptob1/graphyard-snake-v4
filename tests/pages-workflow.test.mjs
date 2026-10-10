// Checks the GitHub Pages deployment workflow that serves index.html from the repository root.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const workflowPath = join(root, '.github/workflows/pages-deploy.yml');
const workflow = readFileSync(workflowPath, 'utf8');
// Strip comments so assertions only see the workflow's real keys.
const lines = workflow.split('\n').map(line => line.replace(/\s+#.*$/, '').replace(/^\s*#.*$/, ''));

/** The lines nested under a top-level key (e.g. `on:`), comments removed. */
function block(key) {
  const start = lines.findIndex(line => line === `${key}:`);
  assert.notEqual(start, -1, `top-level ${key}: is declared`);
  const body = [];
  for (const line of lines.slice(start + 1)) {
    if (/^\S/.test(line)) break;
    if (line.trim()) body.push(line.trim());
  }
  return body;
}

test('integration:pages-workflow triggers on push to main', () => {
  const on = block('on');
  const push = on.indexOf('push:');
  assert.notEqual(push, -1, 'on.push is declared');
  assert.match(on[push + 1], /^branches:\s*\[\s*["']?main["']?\s*\]$/, 'on.push.branches is [main]');
});

test('integration:pages-workflow declares pages:write and id-token:write', () => {
  const permissions = block('permissions');
  assert.ok(permissions.includes('pages: write'), 'permissions.pages is write');
  assert.ok(permissions.includes('id-token: write'), 'permissions.id-token is write');
});

test('integration:pages-workflow uploads the repository root and deploys it with deploy-pages', () => {
  const jobs = block('jobs').join('\n');
  assert.match(jobs, /uses: actions\/checkout@v\d+/);
  assert.match(jobs, /uses: actions\/configure-pages@v\d+/);
  const upload = jobs.match(/uses: actions\/upload-pages-artifact@v\d+\nwith:\npath: (\S+)/);
  assert.ok(upload, 'upload-pages-artifact is used with an explicit path');
  assert.ok(['.', './'].includes(upload[1]), `the uploaded path is the repository root, got ${upload[1]}`);
  assert.match(jobs, /uses: actions\/deploy-pages@v\d+/);
  assert.ok(jobs.indexOf('upload-pages-artifact') < jobs.indexOf('deploy-pages'), 'upload runs before deploy');
  assert.match(jobs, /name: github-pages/, 'the job deploys to the github-pages environment');
});

test('integration:pages-workflow serves index.html from the uploaded root', () => {
  assert.ok(existsSync(join(root, 'index.html')), 'index.html exists at the repository root');
  const html = readFileSync(join(root, 'index.html'), 'utf8');
  assert.match(html, /Snake/, 'the served page names Snake');
  assert.match(html, /<canvas\b/i, 'the served page has a play area');
});
