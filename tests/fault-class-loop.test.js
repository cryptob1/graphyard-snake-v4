// GY-17 — the loop's own fault-filing machinery was broken, and the fault that reports it is the fault
// it could not file. Three diagnostician fix-item filings in 48 minutes failed the same
// `master create` check with one unchanged reason, recorded by the master loop against the Graphyard
// installation that serves this repository (each row: kind `fix-item`, class `proof`, subject the
// recurring-fault item being diagnosed):
//
//   2026-10-17T18:21:10.905Z  fix-item on GY-11 — "The diagnostician's fix item for GY-11 fails the
//     checks master create applies: plannedFiles cannot be resolved: neither origin/main nor main is
//     readable in /home/vish/.local/share/graphyard/worktrees/graphyard-snake-v4-010ab422c6a0/graphyard-approval-loop-scratch-0000000-00000000"
//   2026-10-17T18:58:13.938Z  fix-item on GY-14 — the same sentence naming GY-14
//   2026-10-17T19:09:15.251Z  fix-item on GY-15 — the same sentence naming GY-15
//
// (The loop's cursor held four more rows worded exactly the same — on GY-18, GY-20, GY-11 again and
// GY-23, between 21:06Z and 21:23Z — the retries the three recorded instances promised.)
//
// The cause the three share, reproduced below against real git: the loop runs its diagnostician from
// a scratch checkout outside the coordinator checkout
// (src/daemon/run.ts openResearchScratch) — a session directory whose `checkout/` is a detached
// worktree of this repository, moved onto the release the loop runs. That release is the Graphyard
// CLI checkout's commit (src/daemon/effects-production.ts loadedRelease), a commit of another
// repository this one does not hold; the checkout of a foreign commit fails, so the loop falls back
// to the session directory itself as the diagnostician's cwd — and the directory is not a readable
// checkout at all, because the worktree registration inside it had been pruned (its `checkout/.git`
// gitfile points at `.git/worktrees/checkout`, which no longer exists). Every fix filing then dies in
// the one place every `master create` dies: the base-tree read (src/cli/planned-files-intent.ts
// baseTree) — a best-effort `git fetch --quiet origin main`, then `git ls-tree` against
// `refs/remotes/origin/main` and `refs/heads/main`, refusing with the recorded sentence when neither
// resolves. Because master create is itself the failing step, the diagnostician can never self-file
// this fault: filings keep refusing while fault rows accrue.
//
// What changed (the candidate condition, delivered with this test): the scratch session directory
// itself reads the base tree — a repository of its own whose `origin` is this repository's remote,
// its `origin/main` seeded from the coordinator checkout's remote-tracking main and re-read by every
// later `git fetch origin main`, its `main` and working tree set to the same tree so the session the
// loop launches there reads real code. The models below run that exact command sequence against a
// faithful miniature of the recorded installation: each recorded instance refuses on the base state
// with its recorded sentence, and the same filing, retried after the repair, lands end to end. The
// final test audits the live installation on the coordinator host (CI has no access to it and skips).
//
// The file runs under `node --test` (plain JavaScript, Node builtins only, real git in a temporary
// directory it creates itself) and carries its own fixtures.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';

/** The loop's scratch session directory as the recorded rows name it (src/install/worktree-root.ts sessionCheckout: `graphyard-approval-loop-scratch-<sha7>-<id8>` with the fixed all-zero binding). */
const SCRATCH_ROOT =
  '/home/vish/.local/share/graphyard/worktrees/graphyard-snake-v4-010ab422c6a0/graphyard-approval-loop-scratch-0000000-00000000';
/** The coordinator checkout of cryptob1/graphyard-snake-v4 on the coordinator host. */
const COORDINATOR_CHECKOUT = '/home/vish/code/graphyard-snake-v4';
/** The refusal every recorded row carries (src/cli/planned-files-intent.ts baseTree). */
const REFUSAL = 'plannedFiles cannot be resolved: neither origin/main nor main is readable in ';
/** The three recorded instances, as the item's description lists them. */
const RECORDED = [
  { at: '2026-10-17T18:21:10.905Z', work: 'GY-11' },
  { at: '2026-10-17T18:58:13.938Z', work: 'GY-14' },
  { at: '2026-10-17T19:09:15.251Z', work: 'GY-15' },
];
/** Each recorded row's full text: the diagnostician's filing failure quoting the refusal at the recorded root. */
const recordedDetail = work => `The diagnostician's fix item for ${work} fails the checks master create applies: ${REFUSAL}${SCRATCH_ROOT}`;

/** Run git and fail loudly; a test's own fixture must never half-build. */
function gitOk(cwd, args) {
  const run = spawnSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (run.status !== 0) throw new Error(`git ${args.join(' ')} in ${cwd} failed (${run.status}): ${run.stderr.trim()}`);
  return run.stdout;
}
/** Run git, returning its exit behaviour: the reads the loop tolerates failure of. */
const gitTry = (cwd, args) => spawnSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });

/**
 * baseTree, the base-branch read every `master create` resolves plannedFiles against
 * (src/cli/planned-files-intent.ts): a best-effort fetch of the base branch, then `git ls-tree`
 * against the remote-tracking branch, then the local branch; unreadable both ways, it refuses with
 * the recorded sentence — plannedFiles is never recorded against a tree nobody read.
 */
function baseTree(root, baseBranch = 'main') {
  gitTry(root, ['fetch', '--quiet', 'origin', baseBranch]); // best-effort: resolve against the last fetched base
  for (const [ref, name] of [[`refs/remotes/origin/${baseBranch}`, `origin/${baseBranch}`], [`refs/heads/${baseBranch}`, baseBranch]]) {
    const listed = gitTry(root, ['ls-tree', '-r', '--name-only', '-z', ref]);
    if (listed.status === 0) return { ref: name, files: new Set(listed.stdout.split('\0').filter(Boolean)) };
  }
  throw new Error(`${REFUSAL}${root}`);
}

/**
 * openResearchScratch (src/daemon/run.ts): the scratch session directory survives restarts; the
 * detached worktree inside it is moved onto the release this loop runs, when it can be — a release
 * that is a commit of another repository (the CLI checkout's, effects-production.ts loadedRelease)
 * is not one this repository's worktree can hold, and the loop falls back to the directory itself,
 * exactly as the recorded instant held it.
 */
function openResearchScratch(source, scratch, release, log) {
  if (!release) return scratch.directory;
  try {
    if (existsSync(scratch.worktree)) gitOk(scratch.worktree, ['checkout', '--detach', '--force', '--quiet', release]);
    else gitOk(source, ['worktree', 'add', '--detach', '--quiet', scratch.worktree, release]);
    return scratch.worktree;
  } catch (error) {
    log(`[graphyard-master] the research scratch checkout holds no worktree of ${release.slice(0, 12)}: ${error.message}`);
    return scratch.directory;
  }
}

/**
 * The remedy this item delivers, as the command sequence the change ran on the coordinator host:
 * the scratch session directory becomes a repository of its own reading the base tree — `origin` is
 * this repository's remote (a local stand-in for it in the fixture), `origin/main` is seeded from
 * the coordinator checkout's remote-tracking main so the ref resolves even before the first fetch
 * succeeds, and `main` and the working tree hold the same tree for the session the loop launches
 * there. Every later `git fetch --quiet origin main` (baseTree's own first step) re-reads the remote.
 */
function repairScratchCheckout(scratch, repository, remote) {
  gitOk(scratch.directory, ['init', '-b', 'main']);
  gitOk(scratch.directory, ['remote', 'add', 'origin', remote]);
  gitOk(scratch.directory, ['fetch', '--quiet', repository, 'refs/remotes/origin/main:refs/remotes/origin/main']);
  gitOk(scratch.directory, ['update-ref', 'refs/heads/main', 'refs/remotes/origin/main']);
  gitOk(scratch.directory, ['reset', '--hard', 'main']);
}

/** The fault catalogue's one class for the kind the recorded rows carry (src/model/fault-classes.ts: 'fix-item' is listed under 'proof'). */
const faultClassOf = kind => (kind === 'fix-item' ? 'proof' : 'unclassified');

/** readyToRetry (src/daemon/sessions.ts), verbatim: a waiting action is asked again every cycle; a failed one is retried under exponential backoff, capped at 30 cycles. */
function readyToRetry(previous, cycle, maxBackoffCycles = 30) {
  if (!previous) return true;
  if (previous.state === 'waiting') return true;
  if (previous.state !== 'failed') return false;
  return cycle - previous.cycle >= Math.min(2 ** Math.max(0, previous.attempts - 1), maxBackoffCycles);
}

/**
 * The loop's fault record for one filing, at the fidelity the recorded rows exercised
 * (src/daemon/preserve.ts record → state-cursor.ts storeAction → model/fault-record.ts
 * noteActionOutcome, linkInstance): a failed action carrying a fault kind is stored with that kind's
 * class and opens one visible fault instance per run of failures — further failures only move its
 * last-seen time — while a success ends the run; an instance of a class with a standing open item is
 * linked to it (the recorded rows are linked to GY-4, the standing proof item), and a fix that files
 * answers the subject instead.
 */
function makeLoop() {
  const state = { actions: {}, diagnoses: {}, faults: { instances: [], failing: {}, open: {} }, filed: new Map(), next: 18 };
  const standingProofItem = { key: 'GY-4', origin: { faultClass: { class: 'proof' } }, stage: 'ready' };
  const diagnosisKey = subject => `diagnosis:${subject}`;
  const linkInstance = (instance, at) => { instance.linkedTo = instance.faultClass === standingProofItem.origin.faultClass.class ? standingProofItem.key : instance.linkedTo ?? null; };
  // storeAction (src/daemon/state-cursor.ts): an action's fault kind defaults to `action:<kind>` — so a
  // success is noted against the fault record too, where it ends the failing run the failures opened.
  const daemonActionFaultKind = kind => `action:${kind}`;
  const storeAction = (key, action, faultKind = daemonActionFaultKind(action.kind)) => {
    const failed = faultKind !== null && faultKind !== undefined && (action.state === 'failed' || action.state === 'indeterminate');
    const fault = faultKind === null || faultKind === undefined ? null : { kind: faultKind, faultClass: faultClassOf(faultKind) };
    const entry = { ...action, ...(failed && fault ? { faultClass: fault.faultClass } : {}) };
    if (fault) {
      // noteActionOutcome (src/model/fault-record.ts): a failure opens one instance per run of failures —
      // further failures move its last-seen time — and a success ends the run.
      if (entry.state === 'done') delete state.faults.failing[key];
      else if (entry.state === 'failed' || entry.state === 'indeterminate') {
        const standing = state.faults.failing[key] ? state.faults.instances.find(row => row.id === state.faults.failing[key]) : undefined;
        if (standing) standing.lastSeenAt = entry.at;
        else {
          const instance = { id: `${fault.kind}|${entry.work ?? key}|${entry.at}`, ...fault, subject: entry.work ?? key, text: entry.detail, at: entry.at, lastSeenAt: entry.at, linkedTo: null };
          linkInstance(instance, entry.at);
          state.faults.instances.push(instance);
          state.faults.failing[key] = instance.id;
        }
      }
    }
    state.actions[key] = entry;
    return entry;
  };
  /** The diagnosis step's `note` (src/daemon/diagnosis.ts): the entry's outcome, recorded on the cursor. */
  const note = (entry, outcome, detail, faultKind, cycle) => {
    entry.detail = detail.slice(0, 1000);
    entry.state = outcome === 'done' ? 'answered' : outcome;
    storeAction(diagnosisKey(entry.subject), { kind: 'diagnosis', work: entry.work, principal: null, state: outcome, detail: entry.detail, attempts: (state.actions[diagnosisKey(entry.subject)]?.attempts ?? 0) + (outcome === 'failed' ? 1 : 0), cycle, at: entry.updatedAt }, faultKind);
    return entry;
  };
  /** The filing half of `advance`'s diagnosed branch (src/daemon/diagnosis.ts: filingTree → fixItem → file): the fix item as `master create` would file it. */
  const fileFixItem = (diagnostician, entry, diagnosis, cycle) => {
    let planned;
    try {
      const tree = baseTree(diagnostician.cwd, 'main');
      planned = diagnosis.fix.plannedFiles.filter(path => tree.files.has(path));
      if (planned.length !== diagnosis.fix.plannedFiles.length) throw new Error(`plannedFiles cannot be resolved: ${diagnosis.fix.plannedFiles.filter(path => !tree.files.has(path)).join(', ')} is not in the base tree ${tree.ref}`);
    } catch (error) {
      entry.updatedAt = diagnosis.fixAt;
      note(entry, 'failed', `The diagnostician's fix item for ${entry.subject} fails the checks master create applies: ${error.message}`, 'fix-item', cycle);
      return null;
    }
    const key = `GY-${state.next++}`;
    state.filed.set(key, { title: diagnosis.fix.title, plannedFiles: planned, reason: `The diagnostician found the root cause of the recurring-fault item ${entry.subject}` });
    entry.fix = key;
    entry.updatedAt = diagnosis.fixAt;
    note(entry, 'done', `Filed ${key} (priority ${diagnosis.fix.priority}) for the root cause of ${entry.subject}: ${diagnosis.cause}`, undefined, cycle);
    return key;
  };
  return { state, standingProofItem, readyToRetry, fileFixItem, note };
}

/**
 * The recorded installation as a faithful miniature, in a temporary directory the test owns: the
 * coordinator repository (a "start fresh" local main behind the remote-tracking main the merge
 * writer keeps advancing — the state the coordinator checkout held), the repository's remote (a bare
 * stand-in serving that main), the Graphyard CLI checkout in a repository of its own (whose commit
 * is the loop's release, foreign to this repository), and the loop's scratch session directory whose
 * `checkout` is a detached worktree of the base tree whose registration has been pruned — the
 * recorded instant, down to the dangling gitfile.
 */
function recordedInstallation() {
  const base = mkdtempSync(join(tmpdir(), 'gy-17-fault-class-loop-'));
  const write = (dir, path, text) => { mkdirSync(join(dir, dirname(path)), { recursive: true }); writeFileSync(join(dir, path), text); };
  const repository = join(base, 'graphyard-snake-v4');
  gitOk(base, ['init', '-b', 'main', repository]);
  gitOk(repository, ['config', 'user.email', 'loop@vishrog']);
  gitOk(repository, ['config', 'user.name', 'graphyard loop']);
  write(repository, 'README.md', '# snake\n');
  gitOk(repository, ['add', 'README.md']);
  gitOk(repository, ['commit', '-q', '-m', 'Start fresh: Snake speed test (previous run archived)']);
  const startFresh = gitOk(repository, ['rev-parse', 'HEAD']).trim();
  for (const [path, text] of [
    ['AGENTS.md', '# agents\n'], ['graphyard.json', '{}\n'], ['index.html', '<html></html>\n'], ['package.json', '{"name":"snake","type":"module"}\n'],
    ['css/style.css', 'body{}\n'], ['js/main.js', 'export {};\n'], ['tests/snake.test.mjs', "import { test } from 'node:test';\ntest('snake', () => {});\n"],
  ]) write(repository, path, text);
  gitOk(repository, ['add', '.']);
  gitOk(repository, ['commit', '-q', '-m', 'The base tree: the game, its tests and its delivery workflow']);
  const baseTip = gitOk(repository, ['rev-parse', 'HEAD']).trim();
  // The merge writer advances only the remote-tracking main (the coordinator checkout's local main stays behind it).
  gitOk(repository, ['update-ref', 'refs/remotes/origin/main', baseTip]);
  // The repository's remote: a bare stand-in serving the same main the remote-tracking ref names.
  const remote = join(base, 'origin.git');
  gitOk(base, ['init', '-q', '--bare', remote]);
  gitOk(remote, ['fetch', '-q', repository, `refs/remotes/origin/main:refs/heads/main`]);
  // The Graphyard CLI checkout: a repository of its own, whose commit is the loop's release — a commit this repository does not hold.
  const cli = join(base, 'graphyard-cli');
  gitOk(base, ['init', '-q', '-b', 'main', cli]);
  gitOk(cli, ['config', 'user.email', 'loop@vishrog']);
  gitOk(cli, ['config', 'user.name', 'graphyard loop']);
  write(cli, 'bin/graphyard.mjs', '#!/usr/bin/env node\n');
  gitOk(cli, ['add', '.']);
  gitOk(cli, ['commit', '-q', '-m', 'the CLI checkout this loop runs']);
  const release = gitOk(cli, ['rev-parse', 'HEAD']).trim();
  // The loop's scratch session directory (src/install/worktree-root.ts sessionCheckout), holding a detached worktree of the base tree.
  const directory = join(base, 'worktrees-root', 'graphyard-approval-loop-scratch-0000000-00000000');
  const worktree = join(directory, 'checkout');
  mkdirSync(directory, { recursive: true });
  gitOk(repository, ['worktree', 'add', '--detach', '-q', worktree, baseTip]);
  // The recorded instant: the repository's registration of that worktree is gone (pruned), so the worktree's `.git` gitfile dangles —
  // the state the coordinator host held, which turns every read of it into "not a valid repository".
  const gitdir = readFileSync(join(worktree, '.git'), 'utf8').trim().slice('gitdir: '.length);
  rmSync(join(repository, '.git', 'worktrees', basename(gitdir)), { recursive: true, force: true });
  return { base, repository, remote, cli, release, scratch: { directory, worktree }, startFresh, baseTip };
}

/** The diagnostician the loop wires for a subject (src/daemon/diagnosis.ts diagnosticianEffects): its cwd is the scratch the loop placed it in; no `tree` effect, so the filing reads that cwd exactly as `master create` does (diagnosis-fix.ts filingTree). */
const diagnosticianOn = cwd => ({ cwd });

/** One subject's diagnosis as the loop holds it when it files: the recurring item, its cause, and the fix item it would create (the recorded fix contents were never filed — the refusal came first — so the fixture plans files the base tree holds). */
const diagnosisOf = (work, fixAt, plannedFiles) => ({
  subject: work, kind: 'recurring', work,
  diagnosis: { faultClass: 'deployment', cause: 'the recurring faults share one missing piece of provisioning', fixAt, fix: { title: `Fix the root cause of ${work}`, type: 'bug', priority: 2, plannedFiles } },
});

test(`instance ${RECORDED[0].at} fix-item on ${RECORDED[0].work}: the scratch the diagnostician reads holds no readable refs, and the filing refuses with the recorded sentence`, () => {
  const installation = recordedInstallation();
  try {
    const logs = [];
    const cwd = openResearchScratch(installation.repository, installation.scratch, installation.release, line => logs.push(line));
    // The release is foreign to this repository, so the worktree cannot be moved onto it and the loop falls back to the session directory — the recorded root.
    assert.equal(cwd, installation.scratch.directory);
    assert.equal(logs.length, 1);
    assert.match(logs[0], new RegExp(`the research scratch checkout holds no worktree of ${installation.release.slice(0, 12)}:`));
    // The worktree's gitfile dangles exactly as the coordinator host held it.
    const read = gitTry(installation.scratch.worktree, ['rev-parse', 'HEAD']);
    assert.notEqual(read.status, 0);
    assert.match(read.stderr, /not a git repository|gitfile does not point to a valid repository/);

    const loop = makeLoop();
    const subject = diagnosisOf(RECORDED[0].work, RECORDED[0].at, ['tests/snake.test.mjs']);
    const entry = { subject: subject.subject, kind: 'recurring', work: subject.work, state: 'diagnosed', diagnosis: subject.diagnosis, fix: null, detail: '', updatedAt: subject.diagnosis.fixAt };
    loop.state.diagnoses[subject.subject] = entry;
    const filed = loop.fileFixItem(diagnosticianOn(cwd), entry, subject.diagnosis, 17980);
    // The refusal, verbatim, naming the root the loop placed the diagnostician in.
    assert.equal(filed, null);
    assert.equal(entry.state, 'failed');
    assert.equal(entry.detail, `The diagnostician's fix item for ${RECORDED[0].work} fails the checks master create applies: ${REFUSAL}${installation.scratch.directory}`);
    // The recorded row itself — the same sentence at the recorded root — is what the live cursor held.
    assert.equal(recordedDetail(RECORDED[0].work), `The diagnostician's fix item for ${RECORDED[0].work} fails the checks master create applies: ${REFUSAL}${SCRATCH_ROOT}`);
    // The failure surfaces: a visible fault row of the recorded kind and class, and a failed action the loop retries.
    const action = loop.state.actions[`diagnosis:${subject.subject}`];
    assert.equal(action.state, 'failed');
    assert.equal(action.attempts, 1);
    assert.equal(action.faultClass, 'proof');
    assert.equal(loop.state.faults.instances.length, 1);
    assert.equal(loop.state.faults.instances[0].kind, 'fix-item');
    assert.equal(loop.state.faults.instances[0].faultClass, 'proof');
    assert.equal(loop.state.faults.instances[0].subject, RECORDED[0].work);
    assert.equal(loop.state.faults.instances[0].text, entry.detail);
    assert.equal(loop.state.faults.instances[0].linkedTo, 'GY-4');

    // The candidate condition: the repair the item delivers, then the same filing retried — it lands end to end.
    repairScratchCheckout(installation.scratch, installation.repository, installation.remote);
    const repaired = baseTree(installation.scratch.directory);
    assert.equal(repaired.ref, 'origin/main');
    assert.equal(repaired.files.size, 8);
    assert.ok(repaired.files.has('tests/snake.test.mjs'));
    assert.equal(gitOk(installation.scratch.directory, ['rev-parse', 'main']).trim(), installation.baseTip);
    assert.ok(existsSync(join(installation.scratch.directory, 'tests', 'snake.test.mjs')), 'the session the loop launches there reads a real working tree');
    const landed = loop.fileFixItem(diagnosticianOn(cwd), entry, subject.diagnosis, 17982);
    assert.ok(landed, 'the fix item files');
    assert.equal(entry.fix, landed);
    assert.match(entry.detail, new RegExp(`^Filed ${landed} \\(priority 2\\) for the root cause of ${RECORDED[0].work}: `));
    assert.deepEqual(loop.state.filed.get(landed).plannedFiles, ['tests/snake.test.mjs']);
    assert.equal(loop.state.actions[`diagnosis:${subject.subject}`].state, 'done');
    assert.equal(Object.keys(loop.state.faults.failing).length, 0, 'the success ends the failing run');
    assert.equal(loop.state.faults.instances.length, 1, 'no new instance opens');
  } finally {
    rmSync(installation.base, { recursive: true, force: true });
  }
});

test(`instance ${RECORDED[1].at} fix-item on ${RECORDED[1].work}: the refusal repeats on the retry with the run standing — one visible row, never silently dropped`, () => {
  const installation = recordedInstallation();
  try {
    const cwd = openResearchScratch(installation.repository, installation.scratch, installation.release, () => {});
    const loop = makeLoop();
    const subject = diagnosisOf(RECORDED[1].work, RECORDED[1].at, ['js/main.js']);
    const entry = { subject: subject.subject, kind: 'recurring', work: subject.work, state: 'diagnosed', diagnosis: subject.diagnosis, fix: null, detail: '', updatedAt: subject.diagnosis.fixAt };
    loop.state.diagnoses[subject.subject] = entry;
    // The recorded instant, then the retry the loop's backoff admits (sessions.ts readyToRetry).
    assert.equal(loop.fileFixItem(diagnosticianOn(cwd), entry, subject.diagnosis, 17990), null);
    assert.equal(loop.readyToRetry(loop.state.actions[`diagnosis:${subject.subject}`], 17990), false);
    assert.equal(loop.readyToRetry(loop.state.actions[`diagnosis:${subject.subject}`], 17991), true);
    subject.diagnosis.fixAt = '2026-10-17T21:08:17.697Z';
    assert.equal(loop.fileFixItem(diagnosticianOn(cwd), entry, subject.diagnosis, 17991), null);
    assert.equal(entry.detail, `The diagnostician's fix item for ${RECORDED[1].work} fails the checks master create applies: ${REFUSAL}${installation.scratch.directory}`);
    // One run of failures is one fault: the second refusal moves the standing row's time, it does not open a second one.
    assert.equal(loop.state.faults.instances.length, 1);
    assert.equal(loop.state.faults.instances[0].lastSeenAt, subject.diagnosis.fixAt);
    assert.equal(loop.state.actions[`diagnosis:${subject.subject}`].attempts, 2);

    // The candidate condition: once the scratch reads main, the next retry lands and the run ends.
    repairScratchCheckout(installation.scratch, installation.repository, installation.remote);
    const landed = loop.fileFixItem(diagnosticianOn(cwd), entry, subject.diagnosis, 17993);
    assert.ok(landed);
    assert.equal(loop.state.actions[`diagnosis:${subject.subject}`].state, 'done');
    assert.equal(Object.keys(loop.state.faults.failing).length, 0);
  } finally {
    rmSync(installation.base, { recursive: true, force: true });
  }
});

test(`instance ${RECORDED[2].at} fix-item on ${RECORDED[2].work}: the third subject refuses the same way, and after the repair its fix lands beside the others`, () => {
  const installation = recordedInstallation();
  try {
    const cwd = openResearchScratch(installation.repository, installation.scratch, installation.release, () => {});
    const loop = makeLoop();
    const subjects = [
      diagnosisOf(RECORDED[0].work, RECORDED[0].at, ['tests/snake.test.mjs']),
      diagnosisOf(RECORDED[1].work, RECORDED[1].at, ['js/main.js']),
      diagnosisOf(RECORDED[2].work, RECORDED[2].at, ['css/style.css']),
    ];
    const entries = subjects.map(subject => {
      const entry = { subject: subject.subject, kind: 'recurring', work: subject.work, state: 'diagnosed', diagnosis: subject.diagnosis, fix: null, detail: '', updatedAt: subject.diagnosis.fixAt };
      loop.state.diagnoses[subject.subject] = entry;
      return entry;
    });
    for (const [index, entry] of entries.entries()) {
      assert.equal(loop.fileFixItem(diagnosticianOn(cwd), entry, subjects[index].diagnosis, 17980 + index), null);
      // Each recorded row, worded exactly as the live cursor held it.
      assert.equal(loop.state.faults.instances[index].text, `The diagnostician's fix item for ${subjects[index].work} fails the checks master create applies: ${REFUSAL}${installation.scratch.directory}`);
      assert.equal(recordedDetail(subjects[index].work).endsWith(`${REFUSAL}${SCRATCH_ROOT}`), true);
    }
    assert.equal(loop.state.faults.instances.length, 3, 'three subjects, three visible rows');
    for (const row of loop.state.faults.instances) assert.equal(row.linkedTo, 'GY-4', 'each row links to the standing open fault-class item');
    // Nothing in the filing path repairs the scratch it reads — the refusal is identical on every subject and every cycle, which is why the class recurred for 48 minutes.
    assert.throws(() => baseTree(installation.scratch.directory), error => error.message.startsWith(REFUSAL) && error.message.endsWith(installation.scratch.directory));

    // The candidate condition repairs the scratch once and every pending filing lands.
    repairScratchCheckout(installation.scratch, installation.repository, installation.remote);
    const landed = entries.map((entry, index) => loop.fileFixItem(diagnosticianOn(cwd), entry, subjects[index].diagnosis, 17990));
    assert.deepEqual(landed.map(key => typeof key), ['string', 'string', 'string']);
    assert.deepEqual(landed.map(key => loop.state.filed.get(key).plannedFiles), [['tests/snake.test.mjs'], ['js/main.js'], ['css/style.css']]);
    assert.deepEqual(Object.keys(loop.state.faults.failing), []);
  } finally {
    rmSync(installation.base, { recursive: true, force: true });
  }
});

test('the shared cause: the loop never creates the readable tree its own filing step reads — the repair does, and the very next cycle files what the broken cycles could not', () => {
  const installation = recordedInstallation();
  try {
    // On the base state every consumer refuses by naming a step outside itself: the filing step refuses
    // naming the unreadable root, and no cycle's failure leaves the tree any more readable — the same
    // refusal, unchanged, from the first recorded instant to the last, on every subject, is why the
    // class recurred while fault rows accrued silently behind it.
    const refusals = new Set();
    for (const attempt of [RECORDED[0], RECORDED[1], RECORDED[2]]) {
      try { baseTree(installation.scratch.directory); } catch (error) { refusals.add(error.message); }
      try { baseTree(installation.scratch.worktree); } catch (error) { refusals.add(error.message); }
    }
    assert.deepEqual([...refusals], [`${REFUSAL}${installation.scratch.directory}`, `${REFUSAL}${installation.scratch.worktree}`]);

    // The candidate condition — the scratch reads the base tree the way `master create` reads the
    // coordinator checkout: the same fetch, then the same ls-tree, resolving the same files.
    repairScratchCheckout(installation.scratch, installation.repository, installation.remote);
    const atScratch = baseTree(installation.scratch.directory);
    gitOk(installation.repository, ['fetch', '-q', installation.remote, 'refs/heads/main:refs/remotes/origin/main']);
    const atCoordinator = baseTree(installation.repository);
    assert.deepEqual([...atScratch.files].sort(), [...atCoordinator.files].sort());
    assert.equal(atScratch.ref, atCoordinator.ref);
  } finally {
    rmSync(installation.base, { recursive: true, force: true });
  }
});

// The live installation the recorded rows name, audited only where it exists: on the coordinator
// host. CI checks out this repository on a GitHub runner, which has no access to that host's files,
// so the audit skips there (the recorded-state reproduction above still runs).
test(
  'live audit on the coordinator host: the loop scratch worktree reads the base tree',
  { skip: !existsSync(SCRATCH_ROOT) && `not on the coordinator host: ${SCRATCH_ROOT} is absent` },
  () => {
    // The repair this item delivered: origin/main and main both resolve at the recorded root, and the
    // tree they name is this repository's base tree — a commit the coordinator checkout holds, at or
    // behind the tip its remote-tracking main names (the merge writer advances that tip whenever it
    // lands a merge; the scratch's own fetch re-reads it at every filing, so it never runs ahead).
    const origin = gitOk(SCRATCH_ROOT, ['rev-parse', 'refs/remotes/origin/main']).trim();
    const local = gitOk(SCRATCH_ROOT, ['rev-parse', 'refs/heads/main']).trim();
    assert.equal(origin, local);
    const coordinator = gitOk(COORDINATOR_CHECKOUT, ['rev-parse', 'refs/remotes/origin/main']).trim();
    gitOk(COORDINATOR_CHECKOUT, ['merge-base', '--is-ancestor', origin, coordinator]);
    const files = baseTree(SCRATCH_ROOT).files;
    assert.ok(files.size > 1, `the base tree resolves with its files (${files.size})`);
    assert.ok([...files].some(path => path.startsWith('tests/')), 'the tree lists the tests directory plannedFiles resolve against');
  }
);
