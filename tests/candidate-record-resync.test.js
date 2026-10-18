// GY-25 — the stale candidate record no resync ever corrected.
//
// The recorded instances, verbatim from the ledger of the Graphyard installation that serves this
// repository and from the item's own filing:
//
//   the control-plane item line reads "candidate 024c07784321 (PR #1)" — the record's candidate
//     pointer names PR #1, closed unmerged on 2026-10-10T20:11:38Z, head 79efbe1f, base master,
//     while the candidate head 024c07784321 is the head of PR #4 (open, MERGEABLE, build/test/
//     graphyard-gate green — verified with gh at ~09:50Z — review-codex approved 02:31:59Z,
//     opened 02:10:17Z, branch graphyard/onboarding, base main, +142/-0);
//   2026-10-17T09:18:01Z  the resync that would re-read the item — executor action work — first
//     attempted and refused 401 (graphyard src/engine.ts resyncWork demands the coordinator or
//     admin role: "Coordinator permission required"; the loop's own filings of this fault, scope
//     09:18Z and merge 09:27Z, were refused 401 the same way);
//   2026-10-17T21:19:20Z  doctor finding — "all three executors stopped (split checkouts, no
//     systemd user manager)": no executor serves resync, so the resync row starves;
//   2026-10-17T21:20:23Z  doctor finding — "PR #4 'Add Graphyard onboarding' OPEN, +142/-0,
//     branch graphyard/onboarding, opened 02:10:17Z";
//   2026-10-17T21:58:13Z  doctor finding — "stale candidate.pr=1 confirmed still standing on the
//     delivered record" — and this item filed on it (21:58:40Z);
//   the merge-stall invariant read "0 mergeable items" while that green mergeable candidate sat
//     unmerged: the stale pointer hid PR #4 from the control plane's own reader (graphyard
//     src/github.ts observe reads `/pulls/${work.submission!.pr}` — only the pull request the
//     stored number names), so the invariant's mergeable predicate never held for GY-1.
//
// The cause the instances share: the record's candidate pointer named a pull request that is not
// the candidate's, and every path that could correct it was closed — the control-plane resync is
// an executor-claimed action row behind a coordinator-only permission gate with no executors
// alive, and even a resync that ran would copy the stored number back over its own fresh reading
// (graphyard src/engine.ts observeControlPlaneCandidate: `if (work.candidate.pr)
// observation.candidate.pr = work.candidate.pr;`) while a delivered item's record is returned
// unchanged (graphyard Engine.observe). GY-24 delivered the read-time verification this repository
// reads pointers through (src/model/work.ts verifiedCandidate); what remained unwritten was the
// resync coverage itself.
//
// The candidate condition, delivered in scripts/graphyard-executor.mjs (the item's planned file):
// `--resync` reads the control plane's own records (read-only, through whatever credential the
// runner holds — any role may read) and the repository's pull-request readings, verifies every
// candidate pointer through GY-24's verification, and re-points a stale one automatically when its
// recorded pull request is not the open one at the candidate head, recording each re-point in
// .graphyard/candidate-resync.json so every later read of this repository names the corrected
// pointer. Pull-request readings come from `--readings FILE` (a verified reading), else `gh pr
// list`, else `git ls-remote` on the pull refs (credential-free: a pull ref's head names the
// exact commit, and a live refs/pull/N/merge says GitHub still serves the pull request open). A
// closed or merged pull request is never adopted; an ambiguity is refused, never guessed. Unlike
// `--install` it runs from any checkout of this repository, a managed worktree included: it
// mutates no installation state.
//
// The proofs below reproduce the recorded base state (the 09:50Z world: PR #4 open and green at
// the candidate head, GY-1 in the merge stage with its pointer still reading 1) and drive the
// delivered script itself end to end against fixture worlds — a stubbed control plane and
// stubbed gh, and a real git remote carrying the recorded pull refs. The last test audits the
// live control plane's own record on the coordinator host (CI has no access to it and skips).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  applyResyncRecord,
  mergeStallReading,
  originSlug,
  parseArguments,
  parsePullRefs,
  parseReadingsFile,
  planCandidateResync,
  planCandidateResyncFromRefs,
  pullRefsUrl,
  readingsFromGh,
  resyncRecordPath,
  resyncedCandidate,
} from '../scripts/graphyard-executor.mjs';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const SCRIPT = join(ROOT, 'scripts', 'graphyard-executor.mjs');

/** The candidate head the whole fault turns on: the sha of GY-1's candidate and of open PR #4. */
const CANDIDATE_SHA = '024c07784321b5843742c6479894a2aebe48af47';

/** PR #1's head as its pull ref names it live (refs/pull/1/head): not the candidate. */
const PR1_HEAD = '79efbe1f4500f2e0269e0c1ca1bf4d4ad84ec683';

/** PR #1 as the approver's refutation of decision f9162d74 reads it: closed unmerged, another head, another base. */
const PR1 = {
  number: 1,
  state: 'closed',
  merged: false,
  headSha: PR1_HEAD,
  baseBranch: 'master',
  closedAt: '2026-10-10T20:11:38Z',
};

/** PR #4 as the ~09:50Z gh reading held it: open, unmerged, at the candidate head, against the managed base, green and approved. */
const PR4 = {
  number: 4,
  state: 'open',
  merged: false,
  headSha: CANDIDATE_SHA,
  headBranch: 'graphyard/onboarding',
  baseBranch: 'main',
  openedAt: '2026-10-17T02:10:17Z',
  // The queue and gate facts the doctor's reading carried: GitHub merges it at once (mergeable
  // true, so mergeStateStatus CLEAN), its checks were green and review-codex had approved it.
  mergeStateStatus: 'CLEAN',
  checksGreen: true,
  approved: true,
};

/**
 * GY-1 as the control plane's record held it at the filed instant: the merge stage (the merge
 * writer had held intent since 02:32:02Z and had not pushed), the candidate whose pointer still
 * reads 1, and the gates the stale pointer left failing — the test gate's recorded reason names
 * the head the merge writer never trialled because the pointer told it to read PR #1.
 */
const GY1 = {
  key: 'GY-1',
  stage: 'merge',
  candidate: { sha: CANDIDATE_SHA, baseSha: '42af9a8f3b78747ae505483d5c198fbe372464dd', pr: 1, branch: 'graphyard/onboarding', author: 'cryptob1-graphyard-snake-v4-operator' },
  submission: { pr: 1, epoch: 1 },
  gates: [
    { name: 'ready', passed: true, reasons: [] },
    { name: 'build', passed: true, reasons: [] },
    { name: 'review', passed: true, reasons: [] },
    { name: 'test', passed: false, reasons: ['merge writer has not trialled 024c07784321 on 14ddc2b25778'] },
    { name: 'merge', passed: false, reasons: ['merge writer has not pushed 024c07784321'] },
  ],
};

/** The control plane's own item line for the candidate, as the record rendered it. */
const itemLine = work => `candidate ${work.candidate.sha.slice(0, 12)} (PR #${work.candidate.pr})`;

// ---------------------------------------------------------------------------
// Fixture worlds: a checkout of this repository's own script (copied byte for byte, pinned below)
// running against a stubbed control plane, a stubbed gh, and — for the credential-free path — a
// real git remote carrying pull refs exactly as GitHub's refs/pull/* namespace does.
// ---------------------------------------------------------------------------

/**
 * One fixture checkout: `.graphyard/master.json` naming the managed base, the delivered script and
 * the model it imports copied in, a stub `graphyard` CLI on GRAPHYARD_CLI that prints `status`'s
 * document, and (for the refs path) a git repository whose origin is a real remote with pull refs.
 * `refs` is a list of `{ number, head, merge }` — the pull refs the remote serves and which fixture
 * commit each heads ('candidate' or 'other'); the fixture's own commits stand in for the recorded
 * shas, so `refs/pull/4/head` really heads the candidate.
 */
function makeFixture({ status, refs = [], githubOrigin = false }) {
  const dir = mkdtempSync(join(tmpdir(), 'gy25-resync-'));
  mkdirSync(join(dir, 'scripts'), { recursive: true });
  mkdirSync(join(dir, 'src', 'model'), { recursive: true });
  mkdirSync(join(dir, '.graphyard'), { recursive: true });
  mkdirSync(join(dir, 'bin'), { recursive: true });
  copyFileSync(SCRIPT, join(dir, 'scripts', 'graphyard-executor.mjs'));
  copyFileSync(join(ROOT, 'src', 'model', 'work.ts'), join(dir, 'src', 'model', 'work.ts'));
  writeFileSync(join(dir, '.graphyard', 'master.json'), `${JSON.stringify({ version: 1, baseBranch: 'main', cliPath: null }, null, 2)}\n`);
  // The stub control plane: `status KEY` prints the fixture document, `list` prints it as an array.
  writeFileSync(join(dir, 'bin', 'graphyard.mjs'), '#!/usr/bin/env node\n'
    + 'const status = process.env.FIXTURE_STATUS;\n'
    + 'if (!status) { console.error("no fixture status"); process.exit(1); }\n'
    + 'if (process.argv[2] === "list") console.log(JSON.stringify([JSON.parse(status)]));\n'
    + 'else console.log(status);\n');
  const git = (cwd, ...args) => execFileSync('git', ['-c', 'user.email=fixture@example.com', '-c', 'user.name=fixture', ...args], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  const remote = join(dir, 'remote.git');
  git(dir, 'init', '--quiet', '--bare', '-b', 'main', remote);
  git(dir, 'init', '--quiet', '-b', 'main', '.');
  git(dir, 'remote', 'add', 'origin', githubOrigin ? 'https://github.com/cryptob1/graphyard-snake-v4.git' : remote);
  let document = status;
  if (refs.length) {
    // Real commits, so the pull refs name exact shas the way GitHub's do; the fixture document's
    // candidate stands on the commit the refs head (PR #4 in every fixture), as the recorded one does.
    writeFileSync(join(dir, 'commit.txt'), 'fixture\n');
    git(dir, 'add', 'commit.txt');
    git(dir, 'commit', '--quiet', '-m', 'fixture candidate');
    const candidate = git(dir, 'rev-parse', 'HEAD').trim();
    writeFileSync(join(dir, 'commit.txt'), 'fixture two\n');
    git(dir, 'add', 'commit.txt');
    git(dir, 'commit', '--quiet', '-m', 'fixture other head');
    const other = git(dir, 'rev-parse', 'HEAD').trim();
    for (const ref of refs) git(dir, 'push', '--quiet', remote, `${ref.head === 'candidate' ? candidate : other}:refs/pull/${ref.number}/head`);
    for (const ref of refs.filter(ref => ref.merge)) git(dir, 'push', '--quiet', remote, `${ref.head === 'candidate' ? candidate : other}:refs/pull/${ref.number}/merge`);
    document = { ...status, candidate: { ...status.candidate, sha: candidate } };
  }
  return { dir, git, run: (args, extra = {}) => spawnSync(process.execPath, [join(dir, 'scripts', 'graphyard-executor.mjs'), ...args], {
    cwd: dir,
    encoding: 'utf8',
    env: {
      ...process.env,
      // The fixture's own control plane and nothing else: no live URL, no live credential, no CLI
      // the host holds — the run cannot reach anything but the stubs and the fixture remote.
      GRAPHYARD_URL: '',
      GRAPHYARD_TOKEN: '',
      GRAPHYARD_TOKEN_FILE: '',
      GRAPHYARD_CLI: join(dir, 'bin', 'graphyard.mjs'),
      FIXTURE_STATUS: JSON.stringify(document),
      ...extra,
    },
  }) };
}

/** The recorded base state's readings as a `--readings` file's text. */
const readingsFile = (readings = [PR1, PR4]) => `${JSON.stringify(readings, null, 2)}\n`;

test('unit:candidate-record-resync the command line gains --resync beside --status and --install, keeping their shapes', () => {
  assert.deepEqual(parseArguments(['--status']), { status: true, install: false, count: null });
  assert.deepEqual(parseArguments(['--install', '--count', '3']), { status: false, install: true, count: 3 });
  assert.deepEqual(parseArguments(['--resync']), { status: false, install: false, count: null, resync: true, keys: [], readings: null });
  assert.deepEqual(parseArguments(['--resync', 'GY-1', 'GY-2', '--readings', '/tmp/r.json']), { status: false, install: false, count: null, resync: true, keys: ['GY-1', 'GY-2'], readings: '/tmp/r.json' });
  for (const argv of [[], ['--status', '--install'], ['--status', '--resync'], ['--install', '--resync']]) assert.throws(() => parseArguments(argv), /exactly one/);
  assert.throws(() => parseArguments(['--resync', '--readings']), /--readings needs a value/);
  assert.throws(() => parseArguments(['--readings', '/tmp/r.json']), /--readings belongs to --resync/);
  assert.throws(() => parseArguments(['GY-1']), /item keys belong to --resync/);
  assert.throws(() => parseArguments(['--wipe']), /Unknown argument/);
});

test('unit:candidate-record-resync the pull-ref reader: head and merge refs, and nothing else', () => {
  const refs = parsePullRefs([
    `${PR1_HEAD}\trefs/pull/1/head`,
    `${CANDIDATE_SHA}\trefs/pull/4/head`,
    `0000000000000000000000000000000000000000\trefs/pull/4/merge`,
    `1111111111111111111111111111111111111111\trefs/heads/main`,
    'garbage',
    '',
  ].join('\n'));
  assert.deepEqual(refs, [
    { number: 1, headSha: PR1_HEAD, mergeRef: false },
    { number: 4, headSha: CANDIDATE_SHA, mergeRef: true },
  ]);
  assert.deepEqual(parsePullRefs(''), []);
  assert.equal(originSlug('git@github.com:cryptob1/graphyard-snake-v4.git'), 'cryptob1/graphyard-snake-v4');
  assert.equal(originSlug('https://github.com/cryptob1/graphyard-snake-v4.git'), 'cryptob1/graphyard-snake-v4');
  assert.equal(originSlug('https://github.com/cryptob1/graphyard-snake-v4'), 'cryptob1/graphyard-snake-v4');
  assert.equal(originSlug('/tmp/fixture/remote.git'), null, 'a fixture remote names no GitHub slug, so gh is never asked');
  assert.equal(pullRefsUrl('git@github.com:cryptob1/graphyard-snake-v4.git'), 'https://github.com/cryptob1/graphyard-snake-v4.git');
  assert.equal(pullRefsUrl('/tmp/fixture/remote.git'), '/tmp/fixture/remote.git');
});

test('unit:candidate-record-resync the record: a re-point is recorded once, replaced by a later one, and read back by head', () => {
  const rows = planCandidateResync([GY1], [PR1, PR4]);
  const at = '2026-10-17T21:58:40.294Z';
  const record = applyResyncRecord(null, rows, 'readings', at);
  assert.deepEqual(Object.keys(record.resyncs), ['GY-1']);
  assert.equal(record.resyncs['GY-1'].pr, 4);
  assert.equal(record.resyncs['GY-1'].from, 1);
  assert.equal(record.resyncs['GY-1'].source, 'readings');
  assert.equal(record.resyncs['GY-1'].at, at);
  // A standing row records nothing; a second re-point replaces the first.
  assert.deepEqual(Object.keys(applyResyncRecord(JSON.stringify(record), [{ ...rows[0], corrected: false }], 'gh', at).resyncs), ['GY-1']);
  // The reader: the record's correction applies only to the head it was taken on.
  assert.deepEqual(resyncedCandidate(JSON.stringify(record), 'GY-1', GY1.candidate), { pr: 4, corrected: true, from: 1 });
  assert.deepEqual(resyncedCandidate(JSON.stringify(record), 'GY-1', { ...GY1.candidate, sha: PR1_HEAD }), { pr: 1, corrected: false, from: null }, 'a moved head keeps its stored pointer');
  assert.deepEqual(resyncedCandidate(null, 'GY-1', GY1.candidate), { pr: 1, corrected: false, from: null });
  assert.throws(() => applyResyncRecord('{"version":2,"resyncs":{}}', rows, 'readings', at), /not version 1/);
});

test('integration:candidate-record-resync-pr4 the recorded fault and its remedy: GY-1\'s pointer re-points to the open PR whose head sha equals the candidate sha', () => {
  // The recorded base state, reproduced: the control plane's own line names the closed PR #1 for
  // the candidate, and the pull request that number names heads another commit — the premise of
  // every wrong reading that followed (the f9162d74 decision, the failing merge-writer gates).
  assert.equal(itemLine(GY1), 'candidate 024c07784321 (PR #1)');
  assert.notEqual(PR1.headSha, CANDIDATE_SHA, 'PR #1 does not head the candidate');

  // The resync coverage's plan over the recorded readings: the pointer re-points 1 -> 4, and the
  // re-pointed pointer names exactly the open pull request at the candidate head (AC-1).
  const rows = planCandidateResync([GY1], [PR1, PR4]);
  assert.equal(rows.length, 1);
  const row = rows[0];
  assert.equal(row.corrected, true);
  assert.equal(row.from, 1);
  assert.equal(row.pr, 4);
  assert.equal(row.storedPr, 1, 'the record\'s own number is reported, never rewritten by the plan');
  assert.equal(row.pull.number, 4);
  assert.equal(row.pull.state, 'open');
  assert.equal(row.pull.headSha, CANDIDATE_SHA, 'AC-1: the named PR\'s head sha equals the candidate sha');
  assert.equal(row.basis, 'candidate 024c07784321 is the head of open PR #4 against main; the stored PR #1 named a pull request that is not the candidate\'s, corrected at read time');
  assert.equal(row.refused, null);
  // After the resync, every read through the recorded correction names PR #4, and the record
  // itself keeps its stored number — the immutable history the correction rides beside.
  const record = JSON.stringify(applyResyncRecord(null, rows, 'readings', '2026-10-17T21:58:40.294Z'));
  assert.deepEqual(resyncedCandidate(record, 'GY-1', GY1.candidate), { pr: 4, corrected: true, from: 1 }, 'AC-1: after resync, GY-1\'s candidate.pr names PR #4');
  assert.equal(GY1.candidate.pr, 1, 'the control plane\'s stored record is untouched');
  // The same resync is idempotent: a pointer already naming PR #4 stands.
  const standing = planCandidateResync([{ ...GY1, candidate: { ...GY1.candidate, pr: 4 } }], [PR1, PR4]);
  assert.equal(standing[0].corrected, false);
  assert.equal(standing[0].pr, 4);
  assert.equal(standing[0].basis, 'candidate 024c07784321 is the head of open PR #4 against main; the stored pointer already names it');
  assert.deepEqual(Object.keys(applyResyncRecord(record, standing, 'readings', 'later').resyncs), ['GY-1'], 'a standing pointer records nothing new');

  // A closed pull request is never adopted: PR #4 gone from the readings, the stored pointer
  // stands with a basis that says so — no closed pull request becomes the candidate's.
  const closed = planCandidateResync([GY1], [PR1, { ...PR4, state: 'closed', closedAt: '2026-10-17T22:00:00Z' }]);
  assert.equal(closed[0].corrected, false);
  assert.equal(closed[0].pull, null);
  assert.equal(closed[0].pr, 1);
  assert.equal(closed[0].basis, 'candidate 024c07784321 heads no open pull request against main; the stored PR #1 is not its open pull request, and no decision cites it as one');

  // An ambiguity is refused, never guessed: two open pull requests at the candidate head that the
  // candidate's own branch cannot narrow (the refs reader carries no branch at all).
  const ambiguous = planCandidateResync([GY1], [{ ...PR4, headBranch: undefined }, { ...PR4, number: 5, headBranch: undefined }]);
  assert.equal(ambiguous[0].refused, 'candidate 024c07784321 heads 2 open pull requests against main (#4, #5); the pointer is not corrected on a guess');
  assert.equal(ambiguous[0].corrected, false);
  assert.equal(ambiguous[0].pr, 1, 'a refused read leaves the stored pointer alone');
});

test('integration:candidate-record-resync-pr4 the delivered script, run end to end: the resync re-points GY-1 through a verified reading and records it', () => {
  // A checkout of the delivered script itself (pinned byte for byte) against the stubbed control
  // plane holding the recorded base state, with the ~09:50Z verified reading passed as a file —
  // the exact run an operator or the loop makes with the evidence it already holds.
  const fixture = makeFixture({ status: GY1 });
  assert.equal(readFileSync(join(fixture.dir, 'scripts', 'graphyard-executor.mjs'), 'utf8'), readFileSync(SCRIPT, 'utf8'), 'the fixture runs the delivered script, not a copy that can drift');
  const readings = join(fixture.dir, 'readings.json');
  writeFileSync(readings, readingsFile());
  const first = fixture.run(['--resync', 'GY-1', '--readings', 'readings.json']);
  assert.equal(first.status, 0, `the resync run failed:\n${first.stdout}\n${first.stderr}`);
  assert.match(first.stdout, /GY-1: candidate 024c07784321 re-pointed PR #1 -> PR #4 \(readings\) — candidate 024c07784321 is the head of open PR #4 against main/);
  assert.match(first.stdout, /merge-stall invariant: 1 mergeable item\(s\), none past the bound/);
  // The re-point is recorded where every later read of this repository finds it.
  const recordFile = resyncRecordPath(fixture.dir);
  assert.ok(existsSync(recordFile), 'the resync record is written');
  const record = JSON.parse(readFileSync(recordFile, 'utf8'));
  assert.equal(record.resyncs['GY-1'].pr, 4);
  assert.equal(record.resyncs['GY-1'].from, 1);
  assert.equal(record.resyncs['GY-1'].sha, CANDIDATE_SHA);
  assert.equal(record.source ?? record.resyncs['GY-1'].source, record.resyncs['GY-1'].source);
  assert.deepEqual(resyncedCandidate(readFileSync(recordFile, 'utf8'), 'GY-1', GY1.candidate), { pr: 4, corrected: true, from: 1 }, 'AC-1 after the run: the record\'s read names PR #4');
  // A second run over the same world is a no-op: the standing pointer records nothing new.
  const second = fixture.run(['--resync', 'GY-1', '--readings', 'readings.json']);
  assert.equal(second.status, 0);
  assert.match(second.stdout, /GY-1: candidate 024c07784321 stands at PR #4/);
  assert.doesNotMatch(second.stdout, /re-pointed/);
  assert.equal(JSON.parse(readFileSync(recordFile, 'utf8')).resyncs['GY-1'].at, record.resyncs['GY-1'].at, 'the idempotent run rewrites nothing');

  // The same script through the stubbed gh: the host's own reader path re-points identically.
  const ghFixture = makeFixture({ status: GY1, githubOrigin: true });
  const gh = join(ghFixture.dir, 'bin', 'gh');
  writeFileSync(gh, '#!/usr/bin/env node\n'
    + 'console.log(JSON.stringify([\n'
    + `  { number: 1, state: "CLOSED", mergedAt: null, closedAt: "2026-10-10T20:11:38Z", createdAt: "2026-10-10T19:00:00Z", headRefName: "old-onboarding", headRefOid: "${PR1_HEAD}", baseRefName: "master" },\n`
    + `  { number: 4, state: "OPEN", mergedAt: null, closedAt: null, createdAt: "2026-10-17T02:10:17Z", headRefName: "graphyard/onboarding", headRefOid: "${CANDIDATE_SHA}", baseRefName: "main" },\n`
    + ']));\n');
  chmodSync(gh, 0o755);
  const ghRun = ghFixture.run(['--resync', 'GY-1'], { PATH: `${ghFixture.dir}/bin:${process.env.PATH}` });
  assert.equal(ghRun.status, 0, `the gh-sourced resync failed:\n${ghRun.stdout}\n${ghRun.stderr}`);
  assert.match(ghRun.stdout, /GY-1: candidate 024c07784321 re-pointed PR #1 -> PR #4 \(gh\) — candidate 024c07784321 is the head of open PR #4 against main/);
  assert.equal(readingsFromGh([{ number: 4, state: 'OPEN', headRefOid: CANDIDATE_SHA, headRefName: 'graphyard/onboarding', baseRefName: 'main' }])[0].merged, false);
  assert.equal(readingsFromGh([{ number: 4, state: 'MERGED', headRefOid: CANDIDATE_SHA, baseRefName: 'main' }])[0].merged, true, 'a MERGED state reads merged, so it is never adopted');
  rmSync(fixture.dir, { recursive: true, force: true });
  rmSync(ghFixture.dir, { recursive: true, force: true });
});

test('integration:candidate-record-resync-pr4 the credential-free path: the pull refs alone re-point the pointer, and a pull request without a merge ref is never adopted', () => {
  // The recorded host condition: gh answers nothing. The coverage falls back to git ls-remote on
  // the pull refs — a real remote serving refs/pull/1/head at PR #1's head, refs/pull/4/head at
  // the candidate and a live refs/pull/4/merge (GitHub serving the pull request open).
  const open = makeFixture({ status: GY1, refs: [{ number: 1, head: 'other' }, { number: 4, head: 'candidate', merge: true }] });
  const run = open.run(['--resync', 'GY-1']);
  assert.equal(run.status, 0, `the credential-free resync failed:\n${run.stdout}\n${run.stderr}`);
  assert.match(run.stdout, /GY-1: candidate \w{12} re-pointed PR #1 -> PR #4 \(refs\) — candidate \w{12} is the head of open pull request #4 \(its merge ref stands, so GitHub serves it open\); the stored PR #1's ref heads \w{12}, not the candidate — re-pointed/);
  assert.match(run.stdout, /merge-stall invariant: not read \(pull refs carry no queue states or checks; run with --readings or gh for it\)/);
  const record = JSON.parse(readFileSync(resyncRecordPath(open.dir), 'utf8'));
  assert.equal(record.resyncs['GY-1'].pr, 4, 'the refs-sourced re-point is recorded like any other');
  assert.equal(record.resyncs['GY-1'].source, 'refs');
  // Without the merge ref — PR #4 closed or merged since — nothing is adopted: the pointer stands.
  const closed = makeFixture({ status: GY1, refs: [{ number: 1, head: 'other' }, { number: 4, head: 'candidate' }] });
  const standing = closed.run(['--resync', 'GY-1']);
  assert.equal(standing.status, 0);
  assert.match(standing.stdout, /GY-1: candidate \w{12} stands at PR #1 \(refs\) — candidate \w{12} heads pull request #4, which serves no merge ref \(closed or merged, not open\); a closed pull request is never adopted/);
  assert.ok(!existsSync(resyncRecordPath(closed.dir)), 'a standing pointer records nothing');
  // Two open pull refs at the same head are refused, never guessed.
  const ambiguous = makeFixture({ status: GY1, refs: [{ number: 1, head: 'other' }, { number: 4, head: 'candidate', merge: true }, { number: 5, head: 'candidate', merge: true }] });
  const refused = ambiguous.run(['--resync', 'GY-1']);
  assert.equal(refused.status, 1, 'a refused reading fails the run');
  assert.match(refused.stdout, /GY-1: refused — candidate \w{12} heads 2 open pull requests \(#4, #5\); the pointer is not corrected on a guess/);
  assert.ok(!existsSync(resyncRecordPath(ambiguous.dir)));
  // The refs planner never needs a network: its readings come from the remote the checkout names.
  assert.deepEqual(planCandidateResyncFromRefs([GY1], parsePullRefs(`${PR1_HEAD}\trefs/pull/1/head\n${CANDIDATE_SHA}\trefs/pull/4/head\n${CANDIDATE_SHA}\trefs/pull/4/merge\n`))[0].pr, 4);
  rmSync(open.dir, { recursive: true, force: true });
  rmSync(closed.dir, { recursive: true, force: true });
  rmSync(ambiguous.dir, { recursive: true, force: true });
});

test('integration:merge-stall-sees-pr4 the invariant\'s reading: 0 mergeable items through the stale pointer, GY-1 counted through the re-pointed one', () => {
  // The recorded reading, reproduced byte for byte: through the stored pointer the control plane's
  // reader reads the closed PR #1, so the mergeable predicate never holds and the invariant reads
  // "0 mergeable item(s)" while PR #4 sits open and green at the candidate head (the fault).
  const stale = mergeStallReading([{
    key: GY1.key, stage: GY1.stage, candidate: GY1.candidate, pull: PR1, gatesPassed: false,
  }]);
  assert.equal(stale.count, 0);
  assert.equal(stale.text, '0 mergeable item(s), none past the bound');
  assert.equal(stale.holds, true, 'the invariant held while hiding the green mergeable candidate — the recorded fault');
  // Why it could not count: PR #1 is closed with another head, and a gate still failing is a
  // recorded refusal (the merge writer never trialled the head the pointer hid).
  assert.equal(PR1.state, 'closed');
  assert.ok(GY1.gates.some(gate => !gate.passed && gate.reasons.join(' ').includes('merge writer has not trialled 024c07784321')));

  // After the resync re-points the pointer (integration:candidate-record-resync-pr4), the reader
  // names PR #4: open, unmerged, at exactly the candidate head, CLEAN, green and approved, no gate
  // refusing — the predicate holds and the invariant counts GY-1 (AC-2).
  const resynced = planCandidateResync([GY1], [PR1, PR4])[0];
  assert.equal(resynced.pr, 4);
  const seen = mergeStallReading([{
    key: GY1.key, stage: GY1.stage, candidate: { sha: CANDIDATE_SHA, pr: resynced.pr }, pull: resynced.pull,
    gatesPassed: resynced.pull.checksGreen && resynced.pull.approved,
  }]);
  assert.equal(seen.count, 1, 'AC-2: the invariant counts GY-1 as a mergeable item');
  assert.deepEqual(seen.stalled, []);
  assert.equal(seen.text, '1 mergeable item(s), none past the bound');
  // The same reading past its bound names the stall it could not see: from PR #4's opening at
  // 02:10:17Z to the refused rework decision at 03:00:25Z is 50 minutes unmerged and unrefused.
  const stalled = mergeStallReading([{
    key: GY1.key, stage: GY1.stage, candidate: { sha: CANDIDATE_SHA, pr: 4 }, pull: PR4, gatesPassed: true,
  }], { mergeableForMinutes: 50 });
  assert.equal(stalled.holds, false, 'the invariant now fires on what the stale pointer hid');
  assert.equal(stalled.text, '1 item(s) mergeable and unmerged with nothing refusing them, the longest GY-1 for 50 min');
  // The predicate is the invariant's own (graphyard src/model/invariants.ts judge 4): only a
  // merge-stage item counts, and only through an observation whose candidate is this head.
  assert.equal(mergeStallReading([{ key: GY1.key, stage: 'done', candidate: GY1.candidate, pull: PR4, gatesPassed: true }]).count, 0, 'a delivered item is not counted');
  assert.equal(mergeStallReading([{ key: GY1.key, stage: 'merge', candidate: { sha: CANDIDATE_SHA, pr: 4 }, pull: { ...PR4, headSha: PR1_HEAD }, gatesPassed: true }]).count, 0, 'an observation at another head is not this candidate');
  assert.equal(mergeStallReading([{ key: GY1.key, stage: 'merge', candidate: { sha: CANDIDATE_SHA, pr: 4 }, pull: { ...PR4, mergeStateStatus: 'DIRTY' }, gatesPassed: true }]).count, 0, 'a head GitHub will not merge at once is not mergeable');
  assert.equal(mergeStallReading([{ key: GY1.key, stage: 'merge', candidate: { sha: CANDIDATE_SHA, pr: 4 }, pull: PR4, gatesPassed: true, violations: 1 }]).count, 0, 'a standing violation is a recorded refusal');
  // And the gates leg: through PR #4's facts no gate refuses — the failing gates were the stale
  // pointer's own reading, not the candidate's.
  assert.equal(mergeStallReading([{ key: GY1.key, stage: 'merge', candidate: { sha: CANDIDATE_SHA, pr: 4 }, pull: PR4, gatesPassed: true }], { mergeableForMinutes: 10 }).count, 1);
});

// The live control plane's own record, audited only where it is reachable: on the coordinator
// host. CI checks out this repository on a GitHub runner, which has no access to that host, so the
// audit skips there (the recorded-state reproduction above still runs).
const COORDINATOR_CHECKOUT = '/home/vish/code/graphyard-snake-v4';
const CONNECTION_FILE = join(COORDINATOR_CHECKOUT, '.graphyard', 'connection.json');
test(
  'live audit on the coordinator host: GY-1\'s record, its pull refs, and the resync coverage\'s reading of them',
  { skip: !existsSync(CONNECTION_FILE) && !process.env.GRAPHYARD_URL && `not on the coordinator host: ${CONNECTION_FILE} is absent` },
  () => {
    // The item's record through the control plane's own CLI — the same read every consumer makes.
    const connection = existsSync(CONNECTION_FILE) ? JSON.parse(readFileSync(CONNECTION_FILE, 'utf8')) : {};
    const run = spawnSync(process.execPath, [process.env.GRAPHYARD_CLI ?? connection.cliPath, 'status', 'GY-1'], {
      env: { ...process.env, GRAPHYARD_URL: process.env.GRAPHYARD_URL ?? connection.url, GRAPHYARD_TOKEN: process.env.GRAPHYARD_TOKEN ?? connection.token },
      encoding: 'utf8',
      timeout: 60_000,
    });
    assert.equal(run.status, 0, `graphyard status GY-1 failed: ${(run.stderr ?? '').slice(0, 500)}`);
    const live = JSON.parse(run.stdout);
    assert.equal(live.candidate?.sha, CANDIDATE_SHA, 'the live candidate is the recorded head 024c07784321');
    assert.equal(live.candidate.pr, 1, 'the stored pointer still reads 1 (the doctor\'s 21:58Z finding, standing)');

    // The live pull refs, read credential-free exactly as the coverage reads them: PR #4's head is
    // the candidate and PR #1's is not — the stored number names a pull request that is not the
    // candidate's, live, today.
    const refs = spawnSync('git', ['ls-remote', pullRefsUrl('git@github.com:cryptob1/graphyard-snake-v4.git'), 'refs/pull/*'], { encoding: 'utf8', timeout: 60_000 });
    assert.equal(refs.status, 0, `git ls-remote failed: ${(refs.stderr ?? '').slice(0, 300)}`);
    const pullRefs = parsePullRefs(refs.stdout);
    assert.equal(pullRefs.find(ref => ref.number === 4)?.headSha, CANDIDATE_SHA, 'PR #4\'s pull ref heads the candidate');
    assert.equal(pullRefs.find(ref => ref.number === 1)?.headSha, PR1_HEAD, 'PR #1\'s pull ref heads 79efbe1f, not the candidate');

    // Through the recorded base state (the 09:50Z world this item was filed on), the coverage
    // re-points the live record's own candidate: AC-1 on the live record.
    const rows = planCandidateResync([{ key: 'GY-1', stage: live.stage, candidate: live.candidate }], [PR1, PR4]);
    assert.equal(rows[0].corrected, true);
    assert.equal(rows[0].from, 1);
    assert.equal(rows[0].pr, 4);

    // Today PR #4 serves no merge ref: it merged at 2026-10-17T10:41:04Z (its merge commit
    // 42af9a8f3b78 is the delivery GY-1's record holds), so the credential-free reading stands —
    // a closed or merged pull request is never adopted, and the re-point's moment, proven above
    // against the recorded base state, is not relitigated on stale evidence.
    assert.equal(pullRefs.find(ref => ref.number === 4)?.mergeRef, false, 'PR #4 no longer serves a merge ref');
    assert.equal(live.delivery?.mergeSha, '42af9a8f3b78747ae505483d5c198fbe372464dd');
    const standing = planCandidateResyncFromRefs([{ key: 'GY-1', stage: live.stage, candidate: live.candidate }], pullRefs);
    assert.equal(standing[0].corrected, false);
    assert.match(standing[0].basis, /heads pull request #4, which serves no merge ref \(closed or merged, not open\); a closed pull request is never adopted/);
    // And the invariant over the live record counts nothing for it: the item is delivered — the
    // stall it could not see at the recorded instant belongs to that instant, not to today.
    assert.equal(mergeStallReading([{ key: 'GY-1', stage: live.stage, candidate: live.candidate, pull: null }]).count, 0);
  }
);
