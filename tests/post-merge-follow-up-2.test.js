// GY-35 — the post-merge review of GY-24 (merge e03e6ba2b6d1dda2e1ba86a3048f91ae06f7c4a9) found
// the verification delivered but unwired:
//
//   "src/model/work.ts:199 — AC-2 unmet. Nothing reads through readCandidateForDecision or
//    verifiedCandidate. Neither this repository nor the control plane's decision or rework path
//    calls it, so decision reasons are still composed from the unverified stored pointer, and the
//    'no decision again cites a closed PR for an open candidate' outcome is not delivered. Either
//    wire the verification into the consumer that builds decision reasons, or deliver the live
//    correction plus a live guard that fails if a decision reason cites a closed PR for an open
//    candidate."
//
//   "Nit: src/model/work.ts:206 — readCandidateForDecision always returns rework: null, even for a
//    candidate that genuinely has no open PR. A real rework premise would be dropped silently
//    rather than built from the verified standing."
//
// This change takes the review's first arm, in the item's planned file src/model/work.ts: the
// decision path's own composer (`decisionReason`) reads through `readCandidateForDecision` — which
// now builds its premise from the verified standing instead of a hard-coded null — and the loop
// model's decision cycles compose through that composer by default (`runCycles` verifies unless a
// world explicitly models the recorded base state's reader). The proofs below hold that wiring to
// the recorded instances:
//
//   · on the recorded inputs the composer builds no reason at all — the candidate stands open at
//     PR #4 — exactly where the unverified reproduction still builds decision f9162d74's reason
//     verbatim, so a regression back to the stored pointer fails the first assertion below;
//   · a candidate that genuinely cannot deliver gets a premise built from its own standing — its
//     own former pull request's facts when a closed reading sits at exactly its head, and the
//     head's bare lack of an open pull request otherwise — never another pull request's facts, so
//     the nit's silently-dropped premise is dropped no longer;
//   · the loop's every decision cycle composes through the verified composer without being told
//     to, and the correction still needs no executor and no permission;
//   · and the guard the review named holds over every world the recorded readings span: no
//     decision reason cites a closed pull request's facts for a candidate that stands open.
//
// The file runs under `node --test` (plain JavaScript, Node builtins only) and imports the
// TypeScript model directly — Node's type stripping runs .ts sources, as this suite's
// tests/candidate-pr-resync.test.js already does.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  decisionReason,
  readCandidateForDecision,
  runCycles,
  unverifiedReworkReason,
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

/** PR #1 as the approver's refutation reads it: closed unmerged, a head that is not the candidate, a base that is not the managed one. */
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

/** Decision f9162d74's reason, verbatim from the ledger (event seq 505): the fault this wiring ends. */
const DECISION_F9162D74 =
  'Candidate 024c07784321 cannot deliver: its PR #1 was closed unmerged on 2026-10-10T20:11:38Z and GitHub reports the head conflicting with the fresh main 14ddc2b25778 (mergeStateStatus DIRTY), so the test gate can never pass; retire this candidate and rebuild on the current base';

test('unit:post-merge-follow-up-2 the decision path composes through the verification: on the recorded inputs it builds no reason at all, where the unverified reproduction still builds f9162d74 verbatim', () => {
  // The finding's own words: "Nothing reads through readCandidateForDecision or verifiedCandidate
  // … so decision reasons are still composed from the unverified stored pointer." The composer a
  // decision path now calls reads through the verification, and on the recorded inputs — the
  // stored pointer 1, PR #1 closed with another head against another base, PR #4 open at the
  // candidate head against the managed base — it composes no reason at all: the candidate stands
  // open, so there is nothing to retire it for.
  assert.equal(decisionReason(GY1, [PR1, PR4], QUEUE), null, 'an open candidate is never retired, so no reason is composed');
  // A record already naming the open pull request composes none either: the correction changes
  // the number the read uses, never the standing it finds.
  assert.equal(decisionReason({ ...GY1, candidate: { ...GY1.candidate, pr: 4 } }, [PR1, PR4], QUEUE), null);
  // The read that stands behind both: the pointer verified, PR #4 found at the head, no premise.
  const read = readCandidateForDecision(GY1, [PR1, PR4]);
  assert.equal(read?.rework, null);
  assert.equal(read?.corrected, true);
  assert.equal(read?.candidate.pr, 4);
  assert.match(read?.standing ?? '', /head of open PR #4/);
  // The discrimination this proof turns on: the very same inputs through the unverified
  // reproduction still compose the recorded decision's reason, byte for byte. Should the composer
  // ever regress to composing from the stored pointer, the null above fails on the spot.
  assert.equal(unverifiedReworkReason(GY1, [PR1, PR4], QUEUE), DECISION_F9162D74);
});

test('unit:post-merge-follow-up-2 a genuine premise is built from the verified standing, never dropped and never another pull request\'s facts', () => {
  // The review's nit, fixed: a candidate that genuinely has no open pull request gets a premise
  // built from the verified standing instead of a silently-dropped null. First arm — the
  // candidate's own pull request closed since: a closed reading at exactly the candidate head
  // against the managed base is the one closed pull request whose facts are genuinely the
  // candidate's, and those are the facts the premise cites.
  const ownClosed = { ...PR4, state: 'closed', closedAt: '2026-10-17T22:00:00Z' };
  assert.equal(
    readCandidateForDecision(GY1, [PR1, ownClosed])?.rework,
    'its PR #4 was closed unmerged on 2026-10-17T22:00:00Z',
    'the nit\'s dropped premise, built at last — from the head\'s own pull request',
  );
  assert.equal(
    decisionReason(GY1, [PR1, ownClosed], QUEUE),
    'Candidate 024c07784321 cannot deliver: its PR #4 was closed unmerged on 2026-10-17T22:00:00Z and GitHub reports the head conflicting with the fresh main 14ddc2b25778 (mergeStateStatus DIRTY), so the test gate can never pass; retire this candidate and rebuild on the current base',
  );
  // Second arm — no pull request at the head at all (only the closed PR #1, which heads another
  // commit, is in the readings): the premise cites the head's bare standing, with the stored
  // number named only as a number that named a pull request that is not the candidate's — never
  // as grounds to retire it.
  const noPull = decisionReason(GY1, [PR1], QUEUE);
  assert.match(noPull ?? '', /it heads no open pull request against main/);
  assert.match(noPull ?? '', /the stored PR #1 names a pull request that is not the candidate's/);
  assert.doesNotMatch(noPull ?? '', /PR #1 was closed unmerged/, 'the closed PR #1\'s facts are never the grounds');
  // Third arm — the candidate's own pull request merged at exactly its head (the live world
  // GY-34's audit holds): a delivery, not a defect, so it holds no premise at all — nothing
  // retires a candidate that delivered, whatever number its record still stores.
  const delivered = decisionReason(GY1, [PR1, { ...PR4, state: 'closed', merged: true }], QUEUE);
  assert.equal(delivered, null, 'a merged pull request at the head is a delivery, not a rework premise');
  assert.equal(readCandidateForDecision(GY1, [PR1, { ...PR4, state: 'closed', merged: true }])?.rework, null);
  // An open pull request at the head against a foreign base (PR #1 targeted master; a sibling
  // open against master here) is not the candidate's either: the premise stays the head's own
  // standing against the managed base.
  const foreignBase = decisionReason(GY1, [PR1, { ...PR4, baseBranch: 'master' }], QUEUE);
  assert.match(foreignBase ?? '', /it heads no open pull request against main/);
  assert.doesNotMatch(foreignBase ?? '', /its PR #\d+ (was closed unmerged|heads)/);
});

test('unit:post-merge-follow-up-2 the loop\'s decision cycles compose through the verified composer by default, and the correction still needs no executor and no permission', () => {
  // The wiring, not a flag the caller must remember: a world that names only its executors gets
  // the delivered reader — every decision cycle composes through the verified composer, the very
  // first read corrects the pointer, and the resync row's premise is answered by the read itself.
  const trace = runCycles(GY1, [PR1, PR4], QUEUE, { executors: 0 }, 6);
  assert.deepEqual(trace.pointer, { pr: 4, correctedAtCycle: 0, from: 1 }, 'the first read corrects 024c07784321 -> PR 4');
  assert.deepEqual(trace.resync, { completedAtCycle: 0, by: 'read' }, 'no executor ever needed');
  assert.equal(trace.reasons.length, 6);
  for (const reason of trace.reasons) assert.equal(reason, null, 'no cycle composes a reason for the open candidate');
  // A world whose candidate genuinely cannot deliver composes the verified premise every cycle —
  // the head's own standing, never the recorded sentence the stored pointer produced.
  const stranded = runCycles(GY1, [PR1], QUEUE, { executors: 0 }, 3);
  for (const reason of stranded.reasons) {
    assert.match(reason ?? '', /it heads no open pull request against main/);
    assert.notEqual(reason, DECISION_F9162D74);
  }
  assert.equal(stranded.pointer.pr, 1, 'nothing to correct onto: the stored number stands, and no reason cites its pull request');
  // The recorded base state stays reproducible only where a world explicitly models that reader —
  // the reproduction the regression keeps, no longer a path any decision takes by default.
  const recorded = runCycles(GY1, [PR1, PR4], QUEUE, { executors: 0, verifyAtRead: false }, 6);
  for (const reason of recorded.reasons) assert.equal(reason, DECISION_F9162D74);
  assert.equal(recorded.pointer.pr, 1);
});

test('unit:post-merge-follow-up-2 the guard the review named: over every world the recorded readings span, no decision reason cites a closed pull request for an open candidate', () => {
  // The outcome the criterion states — "no decision reason again cites a closed pull request for
  // an open candidate" — held as a guard over the worlds the recorded readings span: every stored
  // number the record has held (1 stale, 4 corrected), against every reading of PR #4's standing.
  for (const storedPr of [1, 4]) {
    const work = { ...GY1, candidate: { ...GY1.candidate, pr: storedPr } };
    for (const pull of [PR4, { ...PR4, state: 'closed', closedAt: '2026-10-17T22:00:00Z' }, { ...PR4, state: 'closed', merged: true }]) {
      const reason = decisionReason(work, [PR1, pull], QUEUE);
      if (pull.state === 'open') {
        // The candidate stands open: no reason at all, whatever number the record stores.
        assert.equal(reason, null, `stored PR #${storedPr}, PR #4 open: no reason is composed`);
      } else if (pull.merged) {
        // The candidate's own pull request merged at its head: delivered — no reason either.
        assert.equal(reason, null, `stored PR #${storedPr}, PR #4 merged: a delivery is never a rework premise`);
      } else {
        // The candidate's own pull request closed unmerged: a reason may exist, citing PR #4's own facts.
        assert.match(reason ?? '', /its PR #4 was closed unmerged/);
      }
      // And never, in any world, the closed PR #1's facts as the candidate's grounds.
      assert.doesNotMatch(reason ?? '', /PR #1 was closed unmerged/, 'the closed PR #1 is never cited');
      assert.doesNotMatch(reason ?? '', /PR #1 heads/, 'the closed PR #1 is never cited');
    }
  }
});
