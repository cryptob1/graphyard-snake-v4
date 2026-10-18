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
// The post-merge follow-up (GY-34). The review of the delivered GY-24 head found the live audit
// BLOCKING (tests/candidate-pr-resync.test.js:658): "GY-1's live record still reads candidate.pr
// = 1, and the live audit accepts that as a pass. It also verifies against fixed PR1/PR4
// fixtures, not live provider readings." The audit verified the fixture PR1/PR4 world — PR #4
// open at the candidate head — so its read-time correction always answered 4 while the record
// itself stayed 1: it passed the criterion's letter against a fixture and could not detect the
// criterion failing on the record. Three live facts bound the fix:
//
//   · No path the control plane provides writes a delivered record's pointer. The
//     coordinator-credentialed resync was run against GY-1 during this item's attempt (POST
//     /api/work/<id>/resync, the host's coordinator credential) and answered `changed: false`:
//     a resync's own observation copies the stored number back over its fresh reading (graphyard
//     src/engine.ts observeControlPlaneCandidate: `if (work.candidate.pr)
//     observation.candidate.pr = work.candidate.pr;`) and a done item's record is returned
//     unchanged (graphyard `Engine.observe`: `if (work.stage === 'done') return work;`) — and
//     every lifecycle command refuses one outright ("Delivered work is immutable; create a
//     follow-up task"), so the record correction the review named has no command to run. Verified
//     in the deployed control plane's source and in graphyard main.
//   · The world the finding judged had already moved: PR #4 — the candidate's pull request —
//     merged at 2026-10-17T10:41:04Z, and its merge commit 42af9a8f3b78 is the delivery GY-1's
//     record itself holds (live: GitHub serves no refs/pull/4/merge, and the merge commit's
//     second parent is the candidate head). The corrected-to-4 reading existed only while PR #4
//     was open; that window closed with the executors stopped and the 09:18Z resync attempt
//     still refused — the starvation GY-25 filed on. Under the verification this repository
//     delivered, a closed or merged pull request is never adopted, so a verified live read keeps
//     the stored number today.
//   · The audit therefore no longer asserts a fixture world over the record. It reads the
//     provider's pull refs live (credential-free, exactly as GY-25's delivered coverage reads
//     them), proves the stored number's own ref heads another commit (the staleness, live — not
//     the PR1 fixture), and holds the record to `livePointerStanding`: an open pull ref at the
//     candidate head that neither the record nor the repository's standing resync correction
//     names fails the audit — the recorded fault, detected the moment it stands live again — and
//     today's standing passes only because the record's own delivery accounts for the candidate's
//     merged pull request. A deterministic case (unit:post-merge-follow-up-1) pins the judgement
//     on the recorded world, today's world, and the corrections that would stand.
//
// The file runs under `node --test` (plain JavaScript, Node builtins only) and imports the
// TypeScript model directly — Node's type stripping runs .ts sources, as this suite's
// tests/fault-class-configuration.test.ts already does.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
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
import { parsePullRefs, pullRefsUrl, resyncedCandidate } from '../scripts/graphyard-executor.mjs';

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

// ---------------------------------------------------------------------------
// The post-merge follow-up (GY-34): the audit's judgement over live readings. The delivered audit
// verified the fixture PR1/PR4 world over the record, so it passed while the record stayed stale
// and could not detect the criterion failing; the judgement below, taken over the provider's live
// pull refs, can. It is the audit's own reading — the model above still governs every consumer's
// verified read — and it refuses, never guesses, wherever the refs cannot decide.
// ---------------------------------------------------------------------------

/** The verdicts a live audit passes on: a pointer that names the head's own pull request, a correction that stands, or a delivery that accounts for a merged one. */
const PASSING_VERDICTS = new Set(['stands-open', 'corrected-open', 'stands-merged', 'accounted-merged']);

/**
 * What the live audit holds one record's stored pointer to, verified against the provider's live
 * pull refs alone (a head ref names the exact commit a pull request carries, and a live
 * refs/pull/N/merge says GitHub still serves it open — GY-25's credential-free reading). The
 * verdict, never a guess:
 *   'stands-open'      the stored number already names the open pull ref at the candidate head;
 *   'corrected-open'   an open pull ref heads the candidate and the repository's standing resync
 *                      correction (GY-25's .graphyard/candidate-resync.json) names it, so every
 *                      later read of this repository names it too;
 *   'stale-open'       an open pull ref heads the candidate and nothing names it: the recorded
 *                      fault standing live — the audit fails until a correction stands;
 *   'stands-merged'    the stored number names the head's own pull ref, which serves no merge ref
 *                      (closed or merged, never adopted);
 *   'accounted-merged' the head's pull ref serves no merge ref and the record's own delivery
 *                      merge commit carries the head, so the delivery accounts for the
 *                      candidate's merged pull request while the immutable record keeps its
 *                      stored number;
 *   'unaccounted'      the head's pull ref serves no merge ref and nothing accounts for it, or no
 *                      pull ref heads the candidate at all — the audit fails;
 *   'refused'          two open pull refs head the candidate: never guessed.
 * @param {{ sha: string, pr: number }} candidate the record's stored candidate pointer
 * @param {{ number: number, headSha: string, mergeRef: boolean }[]} refs the provider's live pull refs
 * @param {{ deliveryMergeCarriesHead?: boolean, resyncedPr?: number | null }} [options] what stands beside the record: whether its delivery's merge commit carries the candidate head, and the repository's standing resync correction
 */
function livePointerStanding(candidate, refs, options = {}) {
  const { deliveryMergeCarriesHead = false, resyncedPr = null } = options;
  const sha12 = candidate.sha.slice(0, 12);
  const stored = refs.find(entry => entry.number === candidate.pr) ?? null;
  const storedNames = stored
    ? stored.headSha === candidate.sha
      ? `the stored PR #${candidate.pr} names it`
      : `the stored PR #${candidate.pr}'s ref heads ${stored.headSha.slice(0, 12)}, not the candidate`
    : `the stored PR #${candidate.pr} names no pull ref at this repository`;
  const heads = refs.filter(entry => entry.headSha === candidate.sha);
  const open = heads.filter(entry => entry.mergeRef);
  if (open.length > 1)
    return { verdict: 'refused', pull: null,
      basis: `candidate ${sha12} heads ${open.length} open pull requests (${open.map(entry => `#${entry.number}`).join(', ')}); the pointer is not judged on a guess` };
  const openOne = open[0] ?? null;
  if (openOne) {
    if (openOne.number === candidate.pr)
      return { verdict: 'stands-open', pull: openOne.number,
        basis: `candidate ${sha12} is the head of open pull request #${openOne.number}; the stored pointer already names it` };
    if (resyncedPr === openOne.number)
      return { verdict: 'corrected-open', pull: openOne.number,
        basis: `candidate ${sha12} is the head of open pull request #${openOne.number}; the repository's resync record re-pointed the stored PR #${candidate.pr} to it, so every later read of this repository names it (${storedNames})` };
    return { verdict: 'stale-open', pull: openOne.number,
      basis: `candidate ${sha12} is the head of open pull request #${openOne.number} while ${storedNames}: the record is stale and uncorrected — correct it through a path the control plane provides before this audit can pass` };
  }
  const closed = heads.find(entry => !entry.mergeRef) ?? null;
  if (!closed)
    return { verdict: 'unaccounted', pull: null,
      basis: `candidate ${sha12} heads no pull ref at all, and ${storedNames}: nothing live accounts for the head this record names` };
  if (closed.number === candidate.pr)
    return { verdict: 'stands-merged', pull: closed.number,
      basis: `candidate ${sha12} is the head of pull request #${closed.number}, which serves no merge ref (closed or merged); the stored pointer already names it` };
  if (deliveryMergeCarriesHead)
    return { verdict: 'accounted-merged', pull: closed.number,
      basis: `candidate ${sha12} is the head of pull request #${closed.number}, which serves no merge ref (merged, not open), and the record's own delivery merge commit carries that head, so the delivery accounts for the candidate's pull request; ${storedNames}, and the immutable record keeps its stored number — never read as the candidate's pull request` };
  return { verdict: 'unaccounted', pull: closed.number,
    basis: `candidate ${sha12} is the head of pull request #${closed.number}, which serves no merge ref, and the record's delivery does not account for the head; ${storedNames}` };
}

/** One pull ref as the live audit reads it, for the worlds the proof case pins: recorded states, never provider readings. */
const ref = (number, headSha, mergeRef) => ({ number, headSha, mergeRef });

test('unit:post-merge-follow-up-1 the audit holds the record to live readings: the recorded fault fails it, a standing correction or the delivered merge passes it, and today\'s standing is accounted, not assumed', () => {
  // The recorded 09:50Z world as the provider served it: PR #4's merge ref stands (open) at the
  // candidate head, PR #1's ref heads another commit, and the record still reads 1. The delivered
  // audit passed exactly here — its fixture-verified read corrected the pointer at read time —
  // while the record itself stayed stale: the finding, reproduced. The judgement fails that world
  // until a correction stands.
  const recorded = livePointerStanding(GY1.candidate, [ref(1, PR1.headSha, false), ref(4, CANDIDATE_SHA, true)]);
  assert.equal(recorded.verdict, 'stale-open', 'an open pull request at the head that neither the record nor a standing correction names fails the audit');
  assert.equal(recorded.pull, 4);
  assert.match(recorded.basis, /stale and uncorrected/);
  assert.equal(verifiedCandidate(GY1.candidate, [PR1, PR4]).candidate.pr, 4, 'what the delivered audit asserted instead: a read-time correction no write to the record ever made');
  // The correction standing through the repository's resync record (GY-25's coverage) passes it,
  // and so does a record that already names the open pull request itself.
  assert.equal(livePointerStanding(GY1.candidate, [ref(1, PR1.headSha, false), ref(4, CANDIDATE_SHA, true)], { resyncedPr: 4 }).verdict, 'corrected-open');
  assert.equal(livePointerStanding({ ...GY1.candidate, pr: 4 }, [ref(4, CANDIDATE_SHA, true)]).verdict, 'stands-open');
  // Today's world: PR #4 serves no merge ref (merged), and the record's own delivery merge commit
  // carries the candidate head — the delivery accounts for the candidate's pull request, so the
  // immutable record's stored number stands accounted, never as the candidate's pull request.
  const today = livePointerStanding(GY1.candidate, [ref(1, PR1.headSha, false), ref(4, CANDIDATE_SHA, false)], { deliveryMergeCarriesHead: true });
  assert.equal(today.verdict, 'accounted-merged');
  assert.equal(today.pull, 4, 'the candidate\'s pull request, read from the refs, is PR #4');
  assert.match(today.basis, /delivery accounts for the candidate's pull request/);
  // The same readings without the delivery accounting for the head fail the audit, and so does a
  // head no pull ref names at all: an unaccounted record is never passed.
  assert.equal(livePointerStanding(GY1.candidate, [ref(1, PR1.headSha, false), ref(4, CANDIDATE_SHA, false)]).verdict, 'unaccounted');
  assert.equal(livePointerStanding(GY1.candidate, [ref(1, PR1.headSha, false)]).verdict, 'unaccounted');
  // A stored number that names the head's own merged pull ref stands, and two open pull refs at
  // the head are refused, never guessed.
  assert.equal(livePointerStanding({ ...GY1.candidate, pr: 4 }, [ref(4, CANDIDATE_SHA, false)], { deliveryMergeCarriesHead: true }).verdict, 'stands-merged');
  assert.equal(livePointerStanding(GY1.candidate, [ref(4, CANDIDATE_SHA, true), ref(5, CANDIDATE_SHA, true)]).verdict, 'refused');
});

// The live control plane's own record, audited only where it is reachable: on the coordinator
// host. CI checks out this repository on a GitHub runner, which has no access to that host, so the
// audit skips there (the recorded-state reproduction above still runs).
const COORDINATOR_CHECKOUT = '/home/vish/code/graphyard-snake-v4';
const CONNECTION_FILE = join(COORDINATOR_CHECKOUT, '.graphyard', 'connection.json');
/** The repository's standing resync correction (GY-25's coverage record), where the coordinator host keeps it. */
const RESYNC_RECORD = join(COORDINATOR_CHECKOUT, '.graphyard', 'candidate-resync.json');
/** The managed repository's origin, whose pull refs the audit reads credential-free. */
const PULL_REFS_REMOTE = 'git@github.com:cryptob1/graphyard-snake-v4.git';
/** This checkout's root: where the audit reads the delivery's merge commit from the object store. */
const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
test(
  'live audit on the coordinator host: GY-1\'s record held to the provider\'s live pull-request readings, its stored number proven stale live and its standing accounted by its own delivery',
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
    // The live record still names the recorded candidate head — the pointer this audit judges.
    assert.equal(live.candidate?.sha, CANDIDATE_SHA, 'the live candidate is the recorded head 024c07784321');

    // The provider's live pull-request readings, credential-free — no PR1/PR4 fixture world: a
    // head ref names the exact commit its pull request carries, a live merge ref says GitHub
    // still serves it open (the reading GY-25's delivered coverage takes).
    const refsRun = spawnSync('git', ['ls-remote', pullRefsUrl(PULL_REFS_REMOTE), 'refs/pull/*'], { encoding: 'utf8', timeout: 60_000 });
    assert.equal(refsRun.status, 0, `git ls-remote failed: ${(refsRun.stderr ?? '').slice(0, 300)}`);
    const refs = parsePullRefs(refsRun.stdout);

    // The record's own delivery: its merge commit, read from this repository's object store, and
    // whether it carries the candidate head — the accounting a merged candidate pull request
    // stands on. (The coordinator-credentialed resync was run against GY-1 during this item's
    // attempt and answered changed: false — no control-plane path writes a delivered record, so
    // the record's own delivery is the account its stored number is held to.)
    const mergeSha = live.delivery?.mergeSha ?? null;
    assert.equal(mergeSha, '42af9a8f3b78747ae505483d5c198fbe372464dd', 'the delivered record holds its merge commit');
    const commit = spawnSync('git', ['cat-file', '-p', mergeSha], { cwd: ROOT, encoding: 'utf8', timeout: 30_000 });
    assert.equal(commit.status, 0, `git cat-file -p ${mergeSha} failed: ${(commit.stderr ?? '').slice(0, 300)}`);
    const carriesHead = [...commit.stdout.matchAll(/^parent ([0-9a-f]{40})$/gm)].map(match => match[1]).includes(CANDIDATE_SHA);

    // The repository's standing resync correction, where GY-25's coverage leaves it (absent while
    // no re-point stands: a merged pull request is never adopted).
    const resyncText = existsSync(RESYNC_RECORD) ? readFileSync(RESYNC_RECORD, 'utf8') : null;
    const resynced = resyncedCandidate(resyncText, 'GY-1', live.candidate);

    // The judgement over the live readings — and each fact it stands on, asserted live. The
    // stored number's staleness is proven from the refs themselves, never assumed from a fixture.
    const standing = livePointerStanding(live.candidate, refs, { deliveryMergeCarriesHead: carriesHead, resyncedPr: resynced.corrected ? resynced.pr : null });
    const stored = refs.find(entry => entry.number === live.candidate.pr) ?? null;
    assert.ok(stored, `the stored number's own pull ref is live: PR #${live.candidate.pr}`);
    assert.notEqual(stored.headSha, CANDIDATE_SHA, 'live, the staleness the finding named: the stored number\'s pull ref heads another commit, not the candidate');
    const heads = refs.filter(entry => entry.headSha === CANDIDATE_SHA);
    assert.equal(heads.length, 1, 'exactly one pull ref heads the candidate');
    assert.equal(heads[0].number, 4, 'the candidate\'s pull request, read live, is PR #4');
    assert.equal(heads[0].mergeRef, false, 'PR #4 serves no merge ref: merged, not open');
    assert.equal(carriesHead, true, `the delivery's merge commit ${mergeSha.slice(0, 12)} carries the candidate head: the record's own delivery accounts for PR #4`);
    assert.equal(standing.verdict, 'accounted-merged', 'the stored number stands accounted by the delivery, never as the candidate\'s pull request');
    assert.equal(standing.pull, 4);
    assert.ok(PASSING_VERDICTS.has(standing.verdict), `the audit passes only a standing it has accounted for, not one it assumed: ${standing.verdict}`);
    // The audit the finding attacked cannot pass that way again: the moment an open pull ref
    // heads the candidate that neither the record nor a standing correction names, the judgement
    // fails — pinned deterministically in unit:post-merge-follow-up-1 above.
    //
    // And no decision reason built on a verified read of the live record cites the closed pull
    // request's premise: through the live readings PR #1 is closed (its ref heads another commit)
    // and PR #4 merged, so the verified standing says the candidate heads no open pull request —
    // the stale number appears only as the number the record stores, never as the candidate's
    // pull request and never as a ground to retire it.
    const liveReadings = [
      { number: stored.number, state: 'closed', merged: false, headSha: stored.headSha, baseBranch: 'master' },
      { number: heads[0].number, state: 'closed', merged: true, headSha: heads[0].headSha, headBranch: live.candidate.branch, baseBranch: 'main' },
    ];
    const decision = readCandidateForDecision({ key: 'GY-1', candidate: live.candidate, submission: live.submission }, liveReadings);
    assert.equal(decision?.rework, null);
    assert.match(decision?.standing ?? '', /heads no open pull request against main/);
    assert.doesNotMatch(decision?.standing ?? '', /PR #1 (was closed unmerged|heads)/, 'the recorded premise is never built from a verified read');
  }
);
