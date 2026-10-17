// GY-24 — the candidate pull-request pointer of the work record went stale, and every path that
// could correct it was closed. The recorded instances, verbatim from the ledger of the Graphyard
// installation that serves this repository:
//
//   2026-10-17T03:00:25.578Z  decision.requested f9162d74 on GY-1 — "Candidate 024c07784321 cannot
//     deliver: its PR #1 was closed unmerged on 2026-10-10T20:11:38Z and GitHub reports the head
//     conflicting with the fresh main 14ddc2b25778 (mergeStateStatus DIRTY), so the test gate can
//     never pass; retire this candidate and rebuild on the current base".
//   2026-10-17T03:01:31.216Z  decision.declined f9162d74 — the approver's refutation: "The rework
//     premise is wrong: the facts cited belong to PR #1 (head 79efbe1f, base master, closed
//     2026-10-10), a stale PR that is not the candidate. Candidate 024c07784321 is the head of
//     PR #4, which is OPEN against main with mergeable MERGEABLE … The item's candidate.pr field
//     still reads 1, which is a stale record pointer the control plane should correct, not a
//     defect in the candidate."
//   2026-10-17T09:18:01Z  the resync that would correct the pointer — executor action work,
//     outside the doctor allowlist — first attempted and refused 401 (the item's own filing record).
//   2026-10-17T21:19:20Z  doctor finding — "all three executors stopped (split checkouts, no
//     systemd user manager)": no executor serves resync, so no resync runs.
//   2026-10-17T21:20:23Z  doctor finding — "PR #4 'Add Graphyard onboarding' OPEN, +142/-0, branch
//     graphyard/onboarding, opened 02:10:17Z": the open pull request the candidate actually heads.
//   2026-10-17T21:58:13Z  doctor finding — "stale candidate.pr=1 confirmed still standing on the
//     delivered record (covered by GY-24)".
//
// The cause the instances share, reproduced below against the recorded base state: the record's
// candidate pointer (candidate.pr, graphyard src/model/work.ts `Candidate`) named PR #1, and every
// reader trusted the stored number —
//
//   · the provider's reader reads the pull request the submission pointer names and nothing else
//     (graphyard src/github.ts observe: `/pulls/${work.submission!.pr}`), so it re-read the closed
//     PR #1 forever and never discovered the open PR #4 at the candidate head;
//   · the rework decision's premise was composed from that reading unverified (the recorded
//     f9162d74 reason), retiring an open candidate on a closed pull request's facts;
//   · the resync that would re-read the item runs only as an action row a live executor claims
//     (graphyard src/executor.ts `resync`), and its control-plane permission gate admits only the
//     coordinator and admin roles (graphyard src/engine.ts `resyncWork`: "Coordinator permission
//     required") — with all executors stopped, the row starved: no resync runs without executors;
//   · and even a resync that ran could not correct the pointer: its control-plane observation is
//     read from the local repository with the stored number copied back over the fresh reading
//     (graphyard src/engine.ts `observeControlPlaneCandidate`: `if (work.candidate.pr)
//     observation.candidate.pr = work.candidate.pr;`), and a delivered item's record is returned
//     unchanged (graphyard `Engine.observe`: a done item is not written), so the stale number
//     survives its own resync.
//
// The candidate condition, delivered with this test in src/model/work.ts (the item's planned
// file): read-time verification of the pointer. Every consumer that reads a candidate pointer
// verifies it against the provider's pull-request readings — an open, unmerged pull request whose
// head is exactly the candidate sha and whose base is the managed base is the candidate's pull
// request, and a stored number naming anything else is corrected to it at read time, with no
// executor, no resync row and no credential beyond the read the consumer was already making. A
// closed pull request is never adopted; a head with no open pull request keeps its stored pointer
// and a basis that says so; an ambiguity the candidate's own branch cannot narrow is refused,
// never guessed. The models below are faithful miniatures of those decision paths, at the fidelity
// the recorded instances exercised; they cite the graphyard source they model and refuse (rather
// than guess) on arms the instances never touched. The last test audits the live control plane's
// own record on the coordinator host (CI has no access to it and skips).
//
// The file runs under `node --test` (plain JavaScript, Node builtins only) and imports the
// TypeScript model directly — Node's type stripping runs .ts sources, as this suite's
// tests/fault-class-configuration.test.ts already does.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  verifiedCandidate,
  readCandidateForDecision,
  unverifiedReworkReason,
  stalePullPremise,
  roleMayResync,
  resyncRefusalFor,
  controlPlaneResyncObservation,
  observationWrites,
  runCycles,
} from '../src/model/work.ts';

/** The candidate head the whole fault turns on: the sha of GY-1's delivered candidate and of open PR #4. */
const CANDIDATE_SHA = '024c07784321b5843742c6479894a2aebe48af47';

/** GY-1's work record as the control plane holds it (read live 2026-10-17T22:26Z): the delivered item, its pointer still reading 1. */
const GY1 = {
  key: 'GY-1',
  stage: 'done',
  candidate: {
    sha: CANDIDATE_SHA,
    baseSha: '42af9a8f3b78747ae505483d5c198fbe372464dd',
    pr: 1,
    branch: 'graphyard/onboarding',
    author: 'cryptob1-graphyard-snake-v4-operator',
  },
  submission: { pr: 1, epoch: 1 },
};

/** PR #1 as the approver's refutation reads it: closed unmerged, a head that is not the candidate, a base that is not the managed one. Its branch the record does not name — it never enters the verification. */
const PR1 = {
  number: 1,
  state: 'closed',
  merged: false,
  headSha: '79efbe1f',
  baseBranch: 'master',
  closedAt: '2026-10-10T20:11:38Z',
};

/** PR #4 as the doctor's reading holds it: open, headed by the candidate, against the managed base. */
const PR4 = {
  number: 4,
  state: 'open',
  merged: false,
  headSha: CANDIDATE_SHA,
  headBranch: 'graphyard/onboarding',
  baseBranch: 'main',
  openedAt: '2026-10-17T02:10:17Z',
};

/** The provider's queue reading the recorded premise carried (decision f9162d74's situation: baseSha 14ddc2b25778). */
const QUEUE = { mergeStateStatus: 'DIRTY', baseTip: '14ddc2b25778' };

/** Decision f9162d74's reason, verbatim from the ledger (event seq 505): the fault this item ends. */
const DECISION_F9162D74 =
  'Candidate 024c07784321 cannot deliver: its PR #1 was closed unmerged on 2026-10-10T20:11:38Z and GitHub reports the head conflicting with the fresh main 14ddc2b25778 (mergeStateStatus DIRTY), so the test gate can never pass; retire this candidate and rebuild on the current base';

test('unit:candidate-pr-resync the recorded instance: the stored PR #1 is corrected at read time to the open PR whose head is the candidate sha (024c07784321 -> PR 4)', () => {
  // The recorded base state: the stored pointer 1, PR #1 closed with another head against another
  // base, PR #4 open at the candidate head against the managed base.
  const read = verifiedCandidate(GY1.candidate, [PR1, PR4]);
  assert.equal(read.corrected, true);
  assert.equal(read.from, 1, 'the stale number the read replaced');
  assert.equal(read.candidate.pr, 4, 'AC-1: the pointer equals the open PR whose head is the candidate sha');
  assert.equal(read.candidate.sha, CANDIDATE_SHA, 'the head is never rewritten, only the number naming its pull request');
  assert.equal(read.pull?.number, 4, 'the pointer\'s referent is the open pull request at the head');
  assert.equal(read.basis, 'candidate 024c07784321 is the head of open PR #4 against main; the stored PR #1 named a pull request that is not the candidate\'s, corrected at read time');
  // The correction is a pure read: the record itself is untouched, and the same read is idempotent.
  assert.equal(GY1.candidate.pr, 1, 'the immutable record still holds its stored number');
  assert.deepEqual(verifiedCandidate(read.candidate, [PR1, PR4]), {
    ...read,
    corrected: false,
    from: null,
    basis: 'candidate 024c07784321 is the head of open PR #4 against main; the stored pointer already names it',
  }, 'a second read of the corrected pointer stands');
});

test('unit:candidate-pr-resync a pointer that already names the open pull request at the head stands uncorrected', () => {
  const standing = { ...GY1.candidate, pr: 4 };
  const read = verifiedCandidate(standing, [PR1, PR4]);
  assert.equal(read.corrected, false);
  assert.equal(read.from, null);
  assert.equal(read.candidate.pr, 4);
  assert.equal(read.pull?.number, 4);
  assert.equal(read.basis, 'candidate 024c07784321 is the head of open PR #4 against main; the stored pointer already names it');
});

test('unit:candidate-pr-resync a closed pull request is never adopted: with no open pull request at the head the stored pointer stands, and the basis cites the head\'s actual standing', () => {
  // PR #4 gone from the readings (closed since, say) and only the closed PR #1 left: the
  // verification corrects nothing — the stored number is stale, but no closed pull request
  // becomes the candidate's, and the basis says exactly what stands.
  const read = verifiedCandidate(GY1.candidate, [PR1, { ...PR4, state: 'closed', closedAt: '2026-10-17T22:00:00Z' }]);
  assert.equal(read.corrected, false);
  assert.equal(read.pull, null);
  assert.equal(read.candidate.pr, 1, 'the stored pointer stands rather than naming a closed pull request');
  assert.equal(read.basis, 'candidate 024c07784321 heads no open pull request against main; the stored PR #1 is not its open pull request, and no decision cites it as one');
  // A record whose candidate is gone holds no pointer to verify at all.
  assert.equal(readCandidateForDecision({ ...GY1, candidate: null }, [PR1, PR4]), null);
});

test('unit:candidate-pr-resync a pull request against another base is never the candidate\'s: PR #1 targeted master', () => {
  // The approver's own finding: PR #1's base was master. An open pull request at the candidate
  // head but against another base is not the candidate's pull request either.
  const foreignBase = { ...PR4, number: 7, baseBranch: 'master' };
  const read = verifiedCandidate(GY1.candidate, [PR1, foreignBase]);
  assert.equal(read.corrected, false);
  assert.equal(read.pull, null, 'an open head against a foreign base does not become the candidate\'s pull request');
  assert.match(read.basis, /heads no open pull request against main/);
});

test('unit:candidate-pr-resync several open pull requests at the head narrow by the candidate\'s branch, and an ambiguity that survives is refused, never guessed', () => {
  // Two open pull requests at the candidate head against main; the candidate's own branch names one.
  const other = { ...PR4, number: 5, headBranch: 'graphyard/onboarding-reland' };
  const narrowed = verifiedCandidate(GY1.candidate, [PR4, other]);
  assert.equal(narrowed.corrected, true);
  assert.equal(narrowed.candidate.pr, 4, 'the branch the candidate record names picks its own pull request');
  // A sibling whose branch the record does not name loses the same way: the one branch the record
  // itself names decides, so its missing rival never refuses a read with exactly one candidate.
  assert.equal(verifiedCandidate(GY1.candidate, [PR4, { ...other, headBranch: undefined }]).pull?.number, 4);
  // Two open pull requests whose branches the record cannot match at all: refused, and the stored
  // pointer is left alone — never guessed, even though one of them carries the stored number.
  assert.throws(
    () => verifiedCandidate(GY1.candidate, [{ ...PR4, headBranch: undefined }, { ...other, headBranch: undefined }]),
    /heads 2 open pull requests against main \(#4, #5\); the pointer is not corrected on a guess/,
  );
  // Two open pull requests both claiming the candidate's own branch cannot be told apart either.
  assert.throws(
    () => verifiedCandidate(GY1.candidate, [PR4, { ...other, headBranch: PR4.headBranch }]),
    /the pointer is not corrected on a guess/,
  );
  // PR #1's reading carries no branch (the record does not name it); a closed pull request never
  // narrows anything, so its missing branch cannot refuse a read that has exactly one candidate.
  assert.equal(verifiedCandidate(GY1.candidate, [PR1, PR4]).pull?.number, 4);
});

test('unit:candidate-pr-resync the rework premise the unverified read produced, verbatim, and the reason a verified read builds instead', () => {
  // The recorded base state's read: the premise composed from the stored pointer's pull request
  // and the queue reading, verified against nothing — decision f9162d74's reason, byte for byte.
  assert.equal(unverifiedReworkReason(GY1, [PR1, PR4], QUEUE), DECISION_F9162D74);
  // Its parts: the pull request the stored number names is not the candidate's — cited by its
  // closed state (the recorded wording), or by heading another commit when it is open.
  assert.equal(stalePullPremise(GY1.candidate, PR1), 'its PR #1 was closed unmerged on 2026-10-10T20:11:38Z');
  assert.equal(
    stalePullPremise(GY1.candidate, { ...PR4, number: 1, headSha: '79efbe1f0000000000000000000000000000000' }),
    'its PR #1 heads 79efbe1f0000, not the candidate',
  );
  // A stored number that names the open pull request at the head holds no premise, even unverified.
  assert.equal(unverifiedReworkReason({ ...GY1, candidate: { ...GY1.candidate, pr: 4 } }, [PR1, PR4], QUEUE), null);
  // The read this change delivers: the same inputs, the pointer verified first — no premise at
  // all, and a standing that names PR #4, so no decision reason again cites a closed pull request
  // for an open candidate.
  const read = readCandidateForDecision(GY1, [PR1, PR4]);
  assert.equal(read?.rework, null);
  assert.equal(read?.corrected, true);
  assert.equal(read?.candidate.pr, 4);
  assert.equal(read?.standing, 'candidate 024c07784321 is the head of open PR #4 against main; the stored PR #1 named a pull request that is not the candidate\'s, corrected at read time');
});

test('integration:resync-without-executors the recorded world: zero live executors and an unverified read — every cycle cites the closed PR\'s premise and the resync row never completes', () => {
  // The recorded instant: all three executors stopped, the reader trusting the stored pointer.
  // The loop the installation ran, six cycles of it, nothing else moving.
  const trace = runCycles(GY1, [PR1, PR4], QUEUE, { executors: 0, verifyAtRead: false, role: 'coordinator' }, 6);
  assert.equal(trace.cycles, 6);
  assert.equal(trace.pointer.pr, 1, 'the pointer never moves on its own');
  assert.equal(trace.pointer.correctedAtCycle, null);
  assert.equal(trace.resync.completedAtCycle, null, 'a resync row no executor claims never completes');
  assert.equal(trace.resync.by, null);
  assert.equal(trace.reasons.length, 6);
  for (const reason of trace.reasons) assert.equal(reason, DECISION_F9162D74, 'every cycle re-cites the closed pull request\'s premise');
});

test('integration:resync-without-executors the same world with read-time verification: the first read corrects the pointer to PR #4, holds no premise, and answers the resync row with no executor at all', () => {
  // The candidate condition, zero executors still: the correction runs inside the reader.
  const trace = runCycles(GY1, [PR1, PR4], QUEUE, { executors: 0, verifyAtRead: true }, 6);
  assert.deepEqual(trace.pointer, { pr: 4, correctedAtCycle: 0, from: 1 }, 'AC-1 as the loop reads it: 024c07784321 -> PR 4, on the first read');
  assert.deepEqual(trace.resync, { completedAtCycle: 0, by: 'read' }, 'the resync\'s premise is answered by the read itself — no live executor needed');
  assert.equal(trace.reasons.length, 6);
  for (const reason of trace.reasons) assert.equal(reason, null, 'no cycle builds a reason from a pull request that is not the candidate\'s');
  // Even the roles that cannot ask for a resync read correctly: the verification needs no
  // permission at all, where the resync needed the coordinator's.
  for (const role of ['operator-agent', 'worker', 'producer', 'reader']) {
    const byRole = runCycles(GY1, [PR1, PR4], QUEUE, { executors: 0, verifyAtRead: true, role }, 1);
    assert.deepEqual(byRole.pointer, { pr: 4, correctedAtCycle: 0, from: 1 });
    assert.deepEqual(byRole.resync, { completedAtCycle: 0, by: 'read' });
  }
});

test('integration:resync-without-executors an executor-served resync alone cannot correct the pointer: its observation carries the stored number back, and a delivered item\'s record is not written', () => {
  // The remedy the item's filing first imagined: start an executor, let it claim the resync row.
  const trace = runCycles(GY1, [PR1, PR4], QUEUE, { executors: 1, verifyAtRead: false, role: 'coordinator' }, 6);
  assert.deepEqual(trace.resync, { completedAtCycle: 0, by: 'executor' }, 'a live executor does complete the row');
  assert.equal(trace.pointer.pr, 1, 'and the pointer still never moves');
  assert.equal(trace.pointer.correctedAtCycle, null);
  for (const reason of trace.reasons) assert.equal(reason, DECISION_F9162D74, 'the premise outlives the resync that was supposed to end it');
  // Why, faithfully: the control-plane resync's own observation is the stored number copied over
  // the fresh reading (graphyard src/engine.ts observeControlPlaneCandidate), and a delivered
  // item's record is returned unchanged (graphyard Engine.observe) — the stale number survives.
  assert.deepEqual(controlPlaneResyncObservation(GY1, { pr: 0 }), { pr: 1 });
  assert.equal(observationWrites(GY1), false, 'GY-1 is done: no observation writes its record');
  // An undelivered item would take the observation — and still keep its stored number.
  const live = { ...GY1, stage: 'build' };
  assert.equal(observationWrites(live), true);
  assert.deepEqual(controlPlaneResyncObservation(live, { pr: 0 }), { pr: 1 });
});

test('integration:resync-without-executors the resync\'s permission gate: who may ask, the refusal the recorded attempt met, and the world it leaves behind', () => {
  // The control plane's own demand (graphyard src/engine.ts resyncWork): only the coordinator and
  // admin roles. The doctor's attempt at 09:18:01Z was refused; a worker's would be too.
  assert.equal(roleMayResync('coordinator'), true);
  assert.equal(roleMayResync('admin'), true);
  for (const role of ['operator-agent', 'worker', 'producer', 'reader']) assert.equal(roleMayResync(role), false);
  assert.equal(resyncRefusalFor('operator-agent'), 'resync refused: Coordinator permission required — the operator-agent role may not resync');
  assert.equal(resyncRefusalFor('worker'), 'resync refused: Coordinator permission required — the worker role may not resync');
  assert.equal(resyncRefusalFor('coordinator'), null);
  // A refused role with a live executor still starves the row: permission and executor are two
  // separate doors, and the recorded fault stood behind both.
  const refused = runCycles(GY1, [PR1, PR4], QUEUE, { executors: 1, verifyAtRead: false, role: 'operator-agent' }, 6);
  assert.equal(refused.resync.completedAtCycle, null);
  assert.equal(refused.pointer.pr, 1);
  // With no resync at all, the read-time verification is the one correction that needs neither.
  const verified = runCycles(GY1, [PR1, PR4], QUEUE, { executors: 0, verifyAtRead: true, role: 'operator-agent' }, 1);
  assert.equal(verified.pointer.pr, 4);
});

// The live control plane's own record, audited only where it is reachable: on the coordinator
// host. CI checks out this repository on a GitHub runner, which has no access to that host, so the
// audit skips there (the recorded-state reproduction above still runs).
const COORDINATOR_CHECKOUT = '/home/vish/code/graphyard-snake-v4';
const CONNECTION_FILE = join(COORDINATOR_CHECKOUT, '.graphyard', 'connection.json');
test(
  'live audit on the coordinator host: GY-1\'s record reads PR #4 through the verification',
  { skip: !existsSync(CONNECTION_FILE) && `not on the coordinator host: ${CONNECTION_FILE} is absent` },
  () => {
    // Read the item's record through the control plane's own CLI with the connection's own
    // credential — the same read every consumer makes, printed never.
    const connection = JSON.parse(readFileSync(CONNECTION_FILE, 'utf8'));
    const run = spawnSync(process.execPath, [connection.cliPath, 'status', 'GY-1'], {
      env: { ...process.env, GRAPHYARD_URL: connection.url, GRAPHYARD_TOKEN: connection.token },
      encoding: 'utf8',
      timeout: 60_000,
    });
    assert.equal(run.status, 0, `graphyard status GY-1 failed: ${(run.stderr ?? '').slice(0, 500)}`);
    const live = JSON.parse(run.stdout);
    // The live record still names the recorded candidate head — the pointer this verification reads.
    assert.equal(live.candidate?.sha, CANDIDATE_SHA, 'the live candidate is the recorded head 024c07784321');
    // Through the verification, that record reads PR #4 — corrected at read time from the stale 1
    // (the doctor's 21:58Z finding: "stale candidate.pr=1 confirmed still standing"), or standing
    // already if the control plane has since corrected its own record: either way, PR #4.
    const read = verifiedCandidate(live.candidate, [PR1, PR4]);
    assert.equal(read.pull?.number, 4, 'the open pull request at the live record\'s candidate head is PR #4');
    assert.equal(read.candidate.pr, 4, 'AC-1 on the live record: the pointer reads the open PR whose head is the candidate sha');
    if (live.candidate.pr === 1) {
      assert.equal(read.corrected, true);
      assert.equal(read.from, 1);
    } else {
      assert.equal(live.candidate.pr, 4, 'a record no longer stale names the open pull request itself');
      assert.equal(read.corrected, false);
    }
    assert.match(read.basis, /open PR #4/);
    // And no decision reason built on that read cites the closed pull request's premise: the
    // standing names the open PR #4 (the stale number appears, if at all, only as the number the
    // read corrected — never as the candidate's pull request, and never as a ground to retire it).
    const decision = readCandidateForDecision({ key: 'GY-1', candidate: live.candidate, submission: live.submission }, [PR1, PR4]);
    assert.equal(decision?.rework, null);
    assert.match(decision?.standing ?? '', /head of open PR #4/);
    assert.doesNotMatch(decision?.standing ?? '', /PR #1 (was closed unmerged|heads)/, 'the recorded premise is never built from a verified read');
  }
);
