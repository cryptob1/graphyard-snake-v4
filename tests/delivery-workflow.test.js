import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const WORKFLOW = join(ROOT, '.github', 'workflows', 'graphyard-delivery.yml');

const readWorkflow = () => readFile(WORKFLOW, 'utf8');

/** The text of each top-level job under `jobs:`, keyed by job id (two-space indent). */
function jobs(yaml) {
  const body = yaml.slice(yaml.indexOf('\njobs:\n') + '\njobs:\n'.length);
  const out = {};
  let current = null;
  for (const line of body.split('\n')) {
    const header = /^  ([A-Za-z0-9_-]+):\s*$/.exec(line);
    if (header) { current = header[1]; out[current] = ''; continue; }
    if (/^\S/.test(line)) break;
    if (/^\s*#/.test(line)) continue;
    if (current) out[current] += line + '\n';
  }
  return out;
}

/** The `run:` commands of a job, in order. */
const runs = job => [...job.matchAll(/^\s+(?:- )?run:\s*(.+)$/gm)].map(m => m[1].trim());

/** The `uses:` actions of a job, in order. */
const uses = job => [...job.matchAll(/^\s+(?:- )?uses:\s*(\S+)/gm)].map(m => m[1]);

test('integration:ci-test-command the test job runs node --test tests/', async () => {
  const { test: testJob } = jobs(await readWorkflow());
  assert.ok(testJob, 'the workflow has a test job');
  assert.deepEqual(runs(testJob), ['node --test tests/']);
  assert.ok(uses(testJob).includes('actions/checkout@v4'));
  const node = /node-version:\s*"?(\d+)/.exec(testJob);
  assert.ok(node && Number(node[1]) >= 26, 'pins a Node that accepts a directory for --test');
});

test('integration:ci-test-command node --test tests/ finds every test file', async () => {
  const files = (await readdir(join(ROOT, 'tests'))).filter(f => f.endsWith('.test.js'));
  assert.ok(files.includes('page-shell.test.js'));
  assert.ok(files.includes('delivery-workflow.test.js'));
});

test('integration:ci-test-command graphyard-gate passes only when build and test passed', async () => {
  const yaml = await readWorkflow();
  const gate = jobs(yaml)['graphyard-gate'];
  assert.equal(gate, [
    '    needs: [build, test]',
    '    if: always()',
    '    runs-on: ubuntu-latest',
    '    steps:',
    '      - run: test "$BUILD" = success && test "$TEST" = success',
    '        env:',
    '          BUILD: ${{ needs.build.result }}',
    '          TEST: ${{ needs.test.result }}',
    '',
  ].join('\n'));
  assert.match(yaml, /^on:\n  pull_request:\n  push:\n    branches: \["main"\]\n/m);
});

test('integration:pages-publish-step on push to main the repository root is published to Pages with the deploy key', async () => {
  const deploy = jobs(await readWorkflow()).deploy;
  assert.ok(deploy, 'the workflow has a deploy job');
  assert.match(deploy, /^    needs: \[build, test\]$/m);
  assert.match(deploy, /^    if: github\.event_name == 'push' && github\.ref == 'refs\/heads\/main'$/m);
  // The publish authenticates with the provisioned deploy key, not the workflow token:
  // the job token stays read-only and no Pages/OIDC token is requested.
  assert.match(deploy, /^    permissions:\n      contents: read\n    concurrency:/m);
  assert.doesNotMatch(deploy, /pages: write|id-token: write|GITHUB_TOKEN|github\.token/);
  assert.deepEqual(uses(deploy), ['actions/checkout@v4']);
  assert.match(deploy, /- uses: actions\/checkout@v4\n        with:\n          ssh-key: \$\{\{ secrets\.DEPLOY_KEY \}\}\n/);
  // A missing deploy key fails the job with a clear error instead of falling back to the token.
  assert.match(deploy, /- run: test -n "\$DEPLOY_KEY" \|\| \{ echo "::error::[^"]*"; exit 1; \}\n        env:\n          DEPLOY_KEY: \$\{\{ secrets\.DEPLOY_KEY \}\}\n/);
  // The whole checked-out root (plus .nojekyll) becomes gh-pages, pushed over the SSH remote.
  assert.match(deploy, /touch \.nojekyll\n\s+git add -f \.nojekyll\n/);
  assert.match(deploy, /commit=\$\(git commit-tree "\$\(git write-tree\)" -m "[^"]*"\)\n/);
  assert.match(deploy, /git push --force origin "\$commit:refs\/heads\/gh-pages"\n/);
});

test('integration:pages-publish-step publishing adds no build step and no dependencies', async () => {
  const yaml = await readWorkflow();
  const deploy = jobs(yaml).deploy;
  assert.doesNotMatch(deploy.slice(deploy.indexOf('    steps:')), /setup-node|npm|npx|yarn|pnpm|build/i, 'the deploy job only commits and pushes the checked-out files');
  assert.doesNotMatch(yaml, /npm (ci|install)|yarn|pnpm/);
  const pkg = JSON.parse(await readFile(join(ROOT, 'package.json'), 'utf8'));
  assert.equal(pkg.dependencies, undefined);
  assert.equal(pkg.devDependencies, undefined);
});
