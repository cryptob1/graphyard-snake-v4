import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const WORKFLOW = join(ROOT, '.github', 'workflows', 'graphyard-delivery.yml');

/** The text of the top-level job `id` under `jobs:` (two-space indent), comments dropped. */
async function job(id) {
  const yaml = await readFile(WORKFLOW, 'utf8');
  const body = yaml.slice(yaml.indexOf('\njobs:\n') + '\njobs:\n'.length);
  let current = null;
  let out = '';
  for (const line of body.split('\n')) {
    const header = /^  ([A-Za-z0-9_-]+):\s*$/.exec(line);
    if (header) { current = header[1]; continue; }
    if (/^\S/.test(line)) break;
    if (/^\s*#/.test(line)) continue;
    if (current === id) out += line + '\n';
  }
  return out;
}

/** The `uses:` actions of a job, in order. */
const uses = text => [...text.matchAll(/^\s+(?:- )?uses:\s*(\S+)/gm)].map(m => m[1]);

test('unit:pages-deploy-workflow deploys with the official Pages actions', async () => {
  const deploy = await job('deploy');
  assert.ok(deploy, 'the workflow has a deploy job');
  assert.deepEqual(
    uses(deploy).map(u => u.split('@')[0]),
    ['actions/checkout', 'actions/upload-pages-artifact', 'actions/deploy-pages'],
  );
  // The repository root is uploaded as-is and deployed by the step whose output names the URL.
  assert.match(deploy, /- uses: actions\/upload-pages-artifact@v\d+\n        with:\n          path: \.\n/);
  assert.match(deploy, /- id: deployment\n        uses: actions\/deploy-pages@v\d+\n/);
});

test('unit:pages-deploy-workflow grants pages and id-token write and targets the github-pages environment', async () => {
  const deploy = await job('deploy');
  assert.match(deploy, /^    permissions:\n(?:      [a-z-]+: (?:read|write)\n)+/m);
  assert.match(deploy, /^      pages: write$/m);
  assert.match(deploy, /^      id-token: write$/m);
  assert.doesNotMatch(deploy, /contents: write/);
  assert.match(deploy, /^    environment:\n      name: github-pages\n      url: \$\{\{ steps\.deployment\.outputs\.page_url \}\}\n/m);
});

test('unit:pages-deploy-workflow references no repository secret and pushes no branch', async () => {
  const yaml = await readFile(WORKFLOW, 'utf8');
  assert.doesNotMatch(yaml, /secrets\./);
  assert.doesNotMatch(yaml, /DEPLOY_KEY|ssh-key|gh-pages/);
  const deploy = await job('deploy');
  assert.doesNotMatch(deploy, /git push|git commit|run:/);
});

test('unit:pages-deploy-workflow still runs only on push to main after build and test pass', async () => {
  const deploy = await job('deploy');
  assert.match(deploy, /^    needs: \[build, test\]$/m);
  assert.match(deploy, /^    if: github\.event_name == 'push' && github\.ref == 'refs\/heads\/main'$/m);
});
