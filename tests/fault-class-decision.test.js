// GY-21 — the "decision" fault class: 3 decision-refused instances in 24 hours on GY-1
// (threshold 3, detected 2026-10-17T21:00:35.564Z), and every one of them a request the
// control plane's own state already answered before it was put to the approver:
//
//   2026-10-17T03:31:36.744Z  decision-refused on GY-1 — rework f9162d74 (requested
//     03:00:25.578Z by graphyard-master-graphyard-snake-v4-operator, refused
//     03:01:31.216Z): the reason retired the candidate on PR #1's facts — closed unmerged
//     2026-10-10, mergeStateStatus DIRTY — read through the stale stored pointer
//     (candidate.pr = 1), while the provider's own pull-request readings held PR #4 open at
//     exactly the candidate head, green and approved. GY-24 delivered the read-time
//     verification (src/model/work.ts verifiedCandidate) and GY-35 wired the decision path's
//     composer through it (decisionReason): the verified read composes no rework reason at
//     all for an open candidate, so this arm's premise check exists and only wants reading.
//   2026-10-17T06:20:44.236Z  decision-refused on GY-1 — requirements 6ef90e68 (requested
//     05:48:00.634Z, refused 05:49:59.848Z, request reason "probe the requirements input
//     schema"): the CLI fills a requirements request's binding from the item's own current
//     state (graphyard src/master/autonomy.ts decisionInput prefills criteria, dependencies,
//     plannedFiles, exclusiveResources, producerProofs and expectedPolicyRevision from the
//     work record), so a request that names no change carries an input canonically identical
//     to the current requirements — and nothing compared the two before the request was put.
//     The loop itself makes exactly that comparison, but only to adopt a decision already
//     standing (graphyard src/daemon/cycle-delivery.ts throughputDecisionAdopts' canonicalJson
//     equality over decisionInput's filled form), never before requesting one.
//   2026-10-17T06:24:04.238Z  decision-refused on GY-1 — grant 00a1a900 (requested
//     05:49:09.817Z, refused 05:53:57.743Z): the proof-gap attention line hands the master a
//     command template whose principal is the literal placeholder PRODUCER (graphyard
//     src/master/attention.ts: `graphyard master decide ${key} grant
//     '{"principal":"PRODUCER","patterns":["<gap>"]}' REASON`), and the master filled that
//     placeholder with cryptob1-graphyard-snake-v4-master — the coordinator, a role that can
//     never hold proof authority (graphyard src/model/proof.ts ungrantableRoles;
//     src/proof-grants.ts refuses the mutation with 403 "A coordinator principal can never
//     hold proof authority"). The roster answered the request before any approver read it.
//
// The cause the three share: the request path put each decision to the approver without first
// reading the state the approver would judge from — the candidate's true pull request, the
// item's current requirements, the roster's principals and their roles — and that state alone
// already answered every one of them (an open green candidate is not retired on a stale pull
// request's facts; an identical input changes no intent; a coordinator can never hold proof
// authority). The approver's refusal was the first premise check any path ran. Each refusal
// raised the attention line the loop composes (graphyard src/cli/decision-report.ts
// terminalDecisions' refused arm), classified decision-refused into the decision class
// (src/model/fault-classes.ts), and the 24-hour window at threshold 3 filed this item
// (src/model/fault-class-recurrence.ts windowedUnlinked/recurringClasses, policy defaults
// threshold 3 / windowHours 24).
//
// What changed (the candidate condition, delivered with this test): the decision request path
// reads that same state before requesting — `premiseAnswer` below, one gate with the three
// arms. A request the state already answers is answered locally and never put to an approver;
// a request it answers nothing about is put, unchanged (the final tests pin that arm: a
// genuine rework premise, a real widening and a producer-naming grant all still reach the
// approver). No request is put, so no refusal exists to observe, no attention line is raised
// and no fault row is filed: the class counts nothing. The rework arm is GY-24/GY-35's
// delivered verified composer, read as the gate's first arm; the requirements and grant arms
// are the same principle read against the requirements record and the roster. The deployed
// request path is removed of the cause exactly when it takes this shape; this pull request
// carries it.
//
// The models reproduce each instance against the base — the request composed as the recorded
// path composed it, refused with the recorded refusal, filed with the recorded instance id
// and text — and show the candidate emitting none; the recurrence window crosses its
// threshold at the recorded detectedAt under the base and counts zero under the candidate.
// Two live audits (coordinator host only; CI skips both) pin the three decision rows on the
// control plane and the three linked instances on this item.
//
// The file runs under `node --test` (plain JavaScript, Node builtins only) and carries its
// own fixtures: the recorded world as the ledger and this item's origin hold it.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { decisionReason, readCandidateForDecision, unverifiedReworkReason } from '../src/model/work.ts';

// ---------------------------------------------------------------------------
// The recorded world (fixtures)
// ---------------------------------------------------------------------------

const WORK_KEY = 'GY-1';
/** The approver session that refused all three, and the operator identity that requested them. */
const APPROVER = 'graphyard-approver-graphyard-snake-v4';
const REQUESTER = 'graphyard-master-graphyard-snake-v4-operator';
/** When the loop's sweep filed the class, and the policy it counted under (as this item's origin records them). */
const DETECTED_AT = '2026-10-17T21:00:35.564Z';
const POLICY = { threshold: 3, windowHours: 24 };

/** The candidate head the whole class turns on: the sha of GY-1's candidate and of open PR #4. */
const CANDIDATE_SHA = '024c07784321b5843742c6479894a2aebe48af47';

/** GY-1's work record at the recorded instants: at the test gate, its candidate pointer still reading the stale PR #1. */
const GY1 = {
  key: WORK_KEY,
  stage: 'test',
  policyRevision: 1,
  candidate: {
    sha: CANDIDATE_SHA,
    baseSha: '14ddc2b25778', // decision f9162d74's situation named this base
    pr: 1,
    branch: 'graphyard/onboarding',
    author: REQUESTER,
  },
  criteria: [
    {
      id: 'AC-1',
      text: `The pull request adds only Graphyard's onboarding files (AGENTS.md, .gitignore, graphyard.json and .github/workflows), so the base branch carries the delivery workflows.`,
      proofs: ['unit:onboarding-files'],
    },
  ],
  dependencies: [],
  plannedFiles: ['AGENTS.md', '.gitignore', 'graphyard.json', '.github/workflows/'],
  producerProofs: [],
  exclusiveResources: [],
  proofGaps: ['unit:onboarding-files'],
};

/** PR #1 as the approver's refutation reads it: closed unmerged, another head, another base. */
const PR1 = { number: 1, state: 'closed', merged: false, headSha: '79efbe1f', baseBranch: 'master', closedAt: '2026-10-10T20:11:38Z' };
/** PR #4 as the provider's readings held it: open, headed by the candidate, against the managed base. */
const PR4 = { number: 4, state: 'open', merged: false, headSha: CANDIDATE_SHA, headBranch: 'graphyard/onboarding', baseBranch: 'main', openedAt: '2026-10-17T02:10:17Z' };
const READINGS = [PR1, PR4];
/** The provider's queue reading the recorded rework premise carried. */
const QUEUE = { mergeStateStatus: 'DIRTY', baseTip: '14ddc2b25778' };

/** The installation roster as the approver read it: four principals, none a producer, the producer role at limit 0 with no profiles. */
const ROSTER = [
  { id: 'cryptob1-graphyard-snake-v4-operator', role: 'admin' },
  { id: 'cryptob1-graphyard-snake-v4-master', role: 'coordinator' },
  { id: 'cryptob1-graphyard-snake-v4-worker-1', role: 'worker' },
  { id: 'cryptob1-graphyard-snake-v4-dashboard', role: 'reader' },
];

/** The three recorded instances: the loop's observation instant, the filed 500-char text, and the decision row as the ledger holds it. */
const RECORDED = [
  {
    at: '2026-10-17T03:31:36.744Z',
    text: `Decision f9162d74-9a22-44aa-927a-80ae5dd61a55 (rework) was refused by graphyard-approver-graphyard-snake-v4: The rework premise is wrong: the facts cited belong to PR #1 (head 79efbe1f, base master, closed 2026-10-10), a stale PR that is not the candidate. Candidate 024c07784321 is the head of PR #4, which is OPEN against main with mergeable MERGEABLE, and the commit's parent and merge-base with main are both the current tip 14ddc2b25778 (verified with gh pr view 4 and git merge-base). PR #4's b`,
    decision: {
      id: 'f9162d74-9a22-44aa-927a-80ae5dd61a55', action: 'rework', state: 'refused', requestedBy: REQUESTER, requestedAt: '2026-10-17T03:00:25.578Z',
      input: { previousWorkerStopped: true },
      reason: `Candidate 024c07784321 cannot deliver: its PR #1 was closed unmerged on 2026-10-10T20:11:38Z and GitHub reports the head conflicting with the fresh main 14ddc2b25778 (mergeStateStatus DIRTY), so the test gate can never pass; retire this candidate and rebuild on the current base`,
      refusal: {
        approver: APPROVER, at: '2026-10-17T03:01:31.216Z',
        reason: `The rework premise is wrong: the facts cited belong to PR #1 (head 79efbe1f, base master, closed 2026-10-10), a stale PR that is not the candidate. Candidate 024c07784321 is the head of PR #4, which is OPEN against main with mergeable MERGEABLE, and the commit's parent and merge-base with main are both the current tip 14ddc2b25778 (verified with gh pr view 4 and git merge-base). PR #4's build, test and graphyard-gate checks all pass, review-codex approved it at 02:31:59Z, and the diff adds exactly the four onboarding files AC-1 requires. The item's candidate.pr field still reads 1, which is a stale record pointer the control plane should correct, not a defect in the candidate. The actual blocker is that the merge writer has not trialled or pushed the head (merge intent d7e3d4bd9af9 was never pushed), an executor gap that a rebuild would not fix and that would discard a green, approved candidate. Resolve the escalation by getting the merge writer to trial and push 024c07784321 on 14ddc2b25778.`,
      },
    },
  },
  {
    at: '2026-10-17T06:20:44.236Z',
    text: `Decision 6ef90e68-1f02-4824-8957-4d6248e19976 (requirements) was refused by graphyard-approver-graphyard-snake-v4: The requested input is identical to GY-1's current requirements: the same AC-1 text and proof unit:onboarding-files, the same four planned files, empty dependencies, producer proofs and exclusive resources, at expectedPolicyRevision 1. It changes no intent, so it is not a widening and would run as a plain requirements intervention: policyRevision bumps to 2, the formal review resets`,
    decision: {
      id: '6ef90e68-1f02-4824-8957-4d6248e19976', action: 'requirements', state: 'refused', requestedBy: REQUESTER, requestedAt: '2026-10-17T05:48:00.634Z',
      input: {
        criteria: [
          {
            id: 'AC-1',
            text: `The pull request adds only Graphyard's onboarding files (AGENTS.md, .gitignore, graphyard.json and .github/workflows), so the base branch carries the delivery workflows.`,
            proofs: ['unit:onboarding-files'],
          },
        ],
        dependencies: [],
        plannedFiles: ['AGENTS.md', '.gitignore', 'graphyard.json', '.github/workflows/'],
        producerProofs: [],
        exclusiveResources: [],
        expectedPolicyRevision: 1,
      },
      reason: `probe the requirements input schema`,
      refusal: {
        approver: APPROVER, at: '2026-10-17T05:49:59.848Z',
        reason: `The requested input is identical to GY-1's current requirements: the same AC-1 text and proof unit:onboarding-files, the same four planned files, empty dependencies, producer proofs and exclusive resources, at expectedPolicyRevision 1. It changes no intent, so it is not a widening and would run as a plain requirements intervention: policyRevision bumps to 2, the formal review resets, observation and merge authorization are cleared, and reworkRequested is set on the submitted head. That discards review-codex's approval of 024c07784321 against 14ddc2b25778 and forces a rework round on a candidate whose build, review and gate checks are already green, while leaving the real blocker untouched: the merge writer has not trialled or pushed the head, and no principal is authorized for unit:onboarding-files. The stated reason, probing the requirements input schema, is a control-plane experiment, not a justification tied to the item's criteria or the operator's goal of landing the onboarding files. Schema probes belong on a scratch item, not on a live sensitive-risk item at the test gate.`,
      },
    },
  },
  {
    at: '2026-10-17T06:24:04.238Z',
    text: `Decision 00a1a900-4264-4390-bc73-c1c60e0b5ad9 (grant) was refused by graphyard-approver-graphyard-snake-v4: The proof gap is real (proofGaps lists unit:onboarding-files, the producer role has limit 0 with no profiles, and the installation roster holds no producer principal: operator is admin, master is coordinator, worker-1 is worker, dashboard is reader; setup-proposal ci.system is none so no ci-proofs principal exists either). But the grant names the wrong principal. cryptob1-graphyard-snake-v`,
    decision: {
      id: '00a1a900-4264-4390-bc73-c1c60e0b5ad9', action: 'grant', state: 'refused', requestedBy: REQUESTER, requestedAt: '2026-10-17T05:49:09.817Z',
      input: { patterns: ['unit:onboarding-files'], principal: 'cryptob1-graphyard-snake-v4-master' },
      reason: `The proof-gap fault on GY-1 stands since 02:11Z past the proofs bound: no principal is authorized to produce unit:onboarding-files, so AC-1 can never be evidenced and the item cannot deliver. Grant this installation executor principal the right to produce proofs matching unit:onboarding-files so the onboarding-files proof can finally be answered.`,
      refusal: {
        approver: APPROVER, at: '2026-10-17T05:53:57.743Z',
        reason: `The proof gap is real (proofGaps lists unit:onboarding-files, the producer role has limit 0 with no profiles, and the installation roster holds no producer principal: operator is admin, master is coordinator, worker-1 is worker, dashboard is reader; setup-proposal ci.system is none so no ci-proofs principal exists either). But the grant names the wrong principal. cryptob1-graphyard-snake-v4-master is the coordinator, not an executor or producer, and Graphyard refuses proof authority to coordinators by design: src/model/proof.ts lists coordinator among ungrantableRoles and src/proof-grants.ts rejects the mutation with 403 'A coordinator principal can never hold proof authority' before any pattern is considered. Approving would either fail at apply or hand the routing principal the power to evidence the gates it administers, which the master guide forbids (the master routes, never implements, reviews or proves). The reason's description of the master as 'this installation executor principal' is inaccurate. What the item needs is a producer principal: provision one (install reconcile with --producer-proof unit:onboarding-files, or register the ci-proofs producer and run the proof in the delivery workflow) and then request the grant naming that producer id. Separately, the test-gate refusal is still that the merge writer has not trialled or pushed 024c07784321 on 14ddc2b25778 (PR #4 is OPEN, MERGEABLE, build/test/graphyard-gate green, review-codex approved); the grant would not clear that.`,
      },
    },
  },
];

// ---------------------------------------------------------------------------
// The models, mirrored from the graphyard source at the fidelity the recorded instants
// exercised (every citation below is a file of the deployed control plane this repository
// models, the same way src/model/work.ts and the earlier fault-class tests model theirs).
// ---------------------------------------------------------------------------

/** canonicalJson (graphyard src/onboarding.ts), verbatim: the stable ordering every comparison below uses. */
function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

/**
 * decisionInput's requirements arm (graphyard src/master/autonomy.ts), verbatim at the fidelity
 * exercised: the binding a requirements request carries is filled from the item's own current
 * state — criteria, dependencies, plannedFiles, exclusiveResources, producerProofs and
 * expectedPolicyRevision — with the caller's own fields spread over them. A request that names
 * no change therefore carries the current requirements wholesale: this is how the recorded
 * requirements request came to hold an input identical to what it proposed to revise.
 */
function decisionInput(action, work, input) {
  if (action === 'requirements') return { expectedPolicyRevision: work.policyRevision, criteria: work.criteria, dependencies: work.dependencies, plannedFiles: work.plannedFiles, exclusiveResources: work.exclusiveResources ?? [], producerProofs: work.producerProofs ?? [], ...input };
  return { ...input };
}

/** ungrantableRoles (graphyard src/model/proof.ts), verbatim: the roles no grant can ever give proof authority to. */
const ungrantableRoles = ['worker', 'reader', 'coordinator', 'operator-agent'];

/**
 * The proof-gap attention line (graphyard src/master/attention.ts), verbatim: the command
 * template the loop hands the master for a proof gap. Its principal is the literal placeholder
 * PRODUCER — a name no roster holds — which is what the recorded grant's master filled with the
 * coordinator.
 */
const proofGapAttention = (key, proofGaps) => `graphyard master decide ${key} grant '{"principal":"PRODUCER","patterns":["${(proofGaps ?? [])[0] ?? 'PROOF'}"]}' REASON, then graphyard master approver ${key} DECISION`;

/**
 * The pre-flight premise read this change delivers (the candidate condition): every decision
 * request's premise is read against the control plane's own state — the same state the approver
 * judges from — before the request is put. A request that state already answers is answered
 * locally and never requested; a request it answers nothing about is put, unchanged. The three
 * arms are the three recorded instances' causes:
 *   · rework — the reason is composed through the verified candidate read (GY-24/GY-35's
 *     decisionReason, imported from this repository's delivered model): a candidate that stands
 *     open at its own pull request holds no rework premise, so no rework decision is requested
 *     on another pull request's facts;
 *   · requirements — the filled input is compared, canonically, against the item's current
 *     requirements (the very equality graphyard's loop makes to adopt a standing decision,
 *     cycle-delivery.ts throughputDecisionAdopts): an input that changes no intent is never
 *     requested, because applying it would reset the review, the observation and the merge
 *     authorization for nothing;
 *   · grant — the principal named is read against the roster: a placeholder no roster holds, or
 *     a principal whose role can never hold proof authority (proof.ts ungrantableRoles;
 *     proof-grants.ts refuses the mutation with 403), is answered by the roster itself, with the
 *     action that actually creates the producer the gap needs.
 */
function premiseAnswer(work, request, world) {
  if (request.action === 'rework') {
    const reason = decisionReason(work, world.readings, world.queue);
    if (reason === null) {
      const standing = readCandidateForDecision(work, world.readings)?.standing ?? 'no candidate stands';
      return { request: false, answer: `the verified read holds no rework premise: ${standing}` };
    }
    return { request: true, reason };
  }
  if (request.action === 'requirements') {
    const input = decisionInput('requirements', work, request.input ?? {});
    const current = decisionInput('requirements', work, {});
    if (canonicalJson(input) === canonicalJson(current)) {
      return { request: false, answer: `the requested input is ${work.key}'s current requirements: it changes no intent, and a plain requirements intervention would bump the policy revision and reset the formal review, the observation and the merge authorization for nothing` };
    }
    return { request: true, input };
  }
  if (request.action === 'grant') {
    const named = world.roster.find(principal => principal.id === request.input.principal);
    if (!named) {
      return { request: false, answer: `no principal this roster holds is named '${request.input.principal}': create the producer the gap needs (install reconcile --producer-proof ${request.input.patterns[0]}, or register the ci-proofs producer), then request the grant naming it` };
    }
    if (ungrantableRoles.includes(named.role)) {
      return { request: false, answer: `a ${named.role} principal can never hold proof authority (the roster itself refuses the grant): the gap needs a producer principal, not ${named.id}` };
    }
    return { request: true };
  }
  return { request: true };
}

/** The approver as the record holds it: each recorded request's verdict, verbatim from the ledger. */
function recordedApprover(work, request) {
  const entry = RECORDED.find(candidate => candidate.decision.action === request.action
    && canonicalJson(candidate.decision.input) === canonicalJson(request.input ?? {}));
  if (!entry) throw new Error(`the record holds no verdict for a ${request.action} request with this input`);
  return entry.decision;
}

/** The world the paths run against: the readings, the queue, the roster, and the approver the record holds. */
const WORLD = { readings: READINGS, queue: QUEUE, roster: ROSTER, approver: recordedApprover };

/**
 * The attention line a refusal raises (graphyard src/cli/decision-report.ts terminalDecisions'
 * refused arm), verbatim — the line the loop's fault observation then classifies.
 */
const refusalAttention = (key, decision) => ({
  subject: key,
  text: `Decision ${decision.id} (${decision.action}) was refused by ${decision.refusal.approver}: ${decision.refusal.reason}. Answer the refusal: an identical request is refused, so a new one must cite ${decision.id} with what the refused request lacked, or the item needs something else`,
});

/** attentionKind's decision-refused signature and the class it names (graphyard src/model/fault-classes.ts). */
const attentionKind = attention => (/^Decision \S+ \(\S+\) was refused/.test(attention.text) ? 'decision-refused' : 'unclassified');
const faultClassOf = attention => (attentionKind(attention) === 'decision-refused' ? 'decision' : 'unclassified');

/**
 * The fault row the loop records for one attention line (graphyard src/model/fault-record.ts
 * trackFaults), at the fidelity exercised: the id, the class, and the text sliced to 500.
 */
function trackFault(attention, at) {
  const kind = attentionKind(attention);
  return { id: `${kind}|${attention.subject}|${at}`, kind, faultClass: faultClassOf(attention), subject: attention.subject, text: attention.text.slice(0, 500), at, linkedTo: null };
}

/** The windowed recurrence (graphyard src/model/fault-class-recurrence.ts windowedUnlinked/recurringClasses), at the fidelity exercised. */
function windowedUnlinked(instances, now) {
  const from = now - POLICY.windowHours * 3_600_000;
  return instances.filter(entry => entry.faultClass === 'decision' && Date.parse(entry.at) >= from && Date.parse(entry.at) <= now && !entry.linkedTo);
}
function recurringClasses(instances, now) {
  const recent = windowedUnlinked(instances, now);
  if (!recent.length) return { count: 0, recent: [], file: false };
  return { count: recent.length, recent, file: recent.length >= POLICY.threshold };
}
/** The origin a filed class records (graphyard src/model/fault-class-recurrence.ts faultClassItem), at the fidelity exercised. */
function faultClassOrigin(recurrence, detectedAt) {
  return { class: 'decision', threshold: POLICY.threshold, windowHours: POLICY.windowHours, count: recurrence.count, detectedAt, instances: recurrence.recent.map(({ id, kind, subject, at }) => ({ id, kind, subject, at })) };
}

/**
 * The three requests as the recorded paths composed them (the base's compositions, each from
 * the world above): the rework reason from the stored pointer's pull request and the queue
 * reading, verified against nothing; the requirements input filled wholesale from the item's
 * current state; the grant principal from filling the attention template's placeholder with the
 * coordinator the master routes through (the record holds the input).
 */
const baseRequests = () => [
  { action: 'rework', input: RECORDED[0].decision.input, reason: unverifiedReworkReason(GY1, READINGS, QUEUE) },
  { action: 'requirements', input: decisionInput('requirements', GY1, {}), reason: RECORDED[1].decision.reason },
  { action: 'grant', input: RECORDED[2].decision.input, reason: RECORDED[2].decision.reason },
];

/**
 * The request path as deployed (the base): every composed request is put to the approver at
 * once — no premise is read first, so the approver's judgement is the first premise check any
 * path ran. What the loop then observed: the refusal, and the attention line it raised.
 */
function basePath(work, requests, world) {
  return requests.map(request => {
    const decision = world.approver(work, request);
    return { request, decision, attention: decision.refusal ? refusalAttention(work.key, decision) : null };
  });
}

/**
 * The request path as this change delivers it (the candidate): every request's premise is read
 * against the control plane's own state first. A request that state already answers is answered
 * locally — never put, never refused, no attention line — and only a request it answers nothing
 * about reaches the approver.
 */
function candidatePath(work, requests, world) {
  return requests.map(request => {
    const verdict = premiseAnswer(work, request, world);
    if (!verdict.request) return { request, answered: verdict.answer, decision: null, attention: null };
    const decision = world.approver(work, request);
    return { request, decision, attention: decision.refusal ? refusalAttention(work.key, decision) : null };
  });
}

// ---------------------------------------------------------------------------
// The reproduction against the base, instance by instance
// ---------------------------------------------------------------------------

test('rework f9162d74: the base composes the recorded reason from the stored pointer, puts it, and files the recorded instance verbatim', () => {
  const [request] = baseRequests();
  assert.equal(request.action, 'rework');
  // The composition itself: the reason the recorded path composed is the unverified composer's
  // sentence, built from PR #1's facts and the queue reading, verified against nothing.
  assert.equal(unverifiedReworkReason(GY1, READINGS, QUEUE), RECORDED[0].decision.reason);
  // Put straight to the approver: the refusal is the recorded one, word for word.
  const [observed] = basePath(GY1, [request], WORLD);
  assert.equal(observed.decision.state, 'refused');
  assert.equal(observed.decision.refusal.approver, APPROVER);
  assert.equal(observed.decision.refusal.reason, RECORDED[0].decision.refusal.reason);
  // The attention line the loop raised, and the fault row it filed at the recorded instant.
  const row = trackFault(observed.attention, RECORDED[0].at);
  assert.deepEqual(row, {
    id: `decision-refused|${WORK_KEY}|${RECORDED[0].at}`, kind: 'decision-refused', faultClass: 'decision', subject: WORK_KEY,
    text: RECORDED[0].text, at: RECORDED[0].at, linkedTo: null,
  });
});

test('requirements 6ef90e68: the base puts an input decisionInput filled wholesale from the current requirements, and files the recorded instance verbatim', () => {
  const [, request] = baseRequests();
  assert.equal(request.action, 'requirements');
  // The composition itself: a request naming no change carries the current requirements
  // wholesale — canonically identical to the recorded input, because the CLI prefilled it.
  assert.equal(canonicalJson(decisionInput('requirements', GY1, {})), canonicalJson(RECORDED[1].decision.input));
  // Nothing compared the two before the request was put.
  const [observed] = basePath(GY1, [request], WORLD);
  assert.equal(observed.decision.state, 'refused');
  assert.equal(observed.decision.refusal.reason, RECORDED[1].decision.refusal.reason);
  const row = trackFault(observed.attention, RECORDED[1].at);
  assert.deepEqual(row, {
    id: `decision-refused|${WORK_KEY}|${RECORDED[1].at}`, kind: 'decision-refused', faultClass: 'decision', subject: WORK_KEY,
    text: RECORDED[1].text, at: RECORDED[1].at, linkedTo: null,
  });
});

test('grant 00a1a900: the base fills the attention template\'s PRODUCER placeholder with a principal the roster itself refuses, and files the recorded instance verbatim', () => {
  // The template the loop hands: its principal is the literal placeholder, naming no principal.
  assert.equal(proofGapAttention(WORK_KEY, GY1.proofGaps), `graphyard master decide ${WORK_KEY} grant '{"principal":"PRODUCER","patterns":["unit:onboarding-files"]}' REASON, then graphyard master approver ${WORK_KEY} DECISION`);
  const [, , request] = baseRequests();
  assert.equal(request.action, 'grant');
  // The master's fill: the coordinator — a role the roster itself refuses proof authority to.
  const named = ROSTER.find(principal => principal.id === request.input.principal);
  assert.equal(named.role, 'coordinator');
  assert.ok(ungrantableRoles.includes(named.role), 'the coordinator role can never hold proof authority');
  // Put straight to the approver: the refusal is the recorded one, word for word.
  const [observed] = basePath(GY1, [request], WORLD);
  assert.equal(observed.decision.state, 'refused');
  assert.equal(observed.decision.refusal.reason, RECORDED[2].decision.refusal.reason);
  const row = trackFault(observed.attention, RECORDED[2].at);
  assert.deepEqual(row, {
    id: `decision-refused|${WORK_KEY}|${RECORDED[2].at}`, kind: 'decision-refused', faultClass: 'decision', subject: WORK_KEY,
    text: RECORDED[2].text, at: RECORDED[2].at, linkedTo: null,
  });
});

test('the shared cause is one missing read: the same world that refused all three requests pre-flight answers all three', () => {
  const requests = baseRequests();
  assert.equal(requests.length, 3);
  for (const request of requests) {
    const verdict = premiseAnswer(GY1, request, WORLD);
    assert.equal(verdict.request, false, `the ${request.action} request is answered by the state before any approver reads it`);
    assert.ok(verdict.answer.length > 0);
  }
});

// ---------------------------------------------------------------------------
// The candidate: no request is put, so nothing recurs
// ---------------------------------------------------------------------------

test('rework f9162d74: the candidate composes no reason through the verified read — no request, no refusal, no fault row', () => {
  const [request] = baseRequests();
  const [observed] = candidatePath(GY1, [request], WORLD);
  assert.equal(observed.decision, null, 'no approver is consulted');
  assert.equal(observed.attention, null, 'no attention line is raised');
  assert.match(observed.answered, /open PR #4/, 'the answer cites the verified standing, not the stale pointer');
});

test('requirements 6ef90e68: the candidate reads the current requirements first and never puts the no-op — no request, no refusal, no fault row', () => {
  const [, request] = baseRequests();
  const [observed] = candidatePath(GY1, [request], WORLD);
  assert.equal(observed.decision, null, 'no approver is consulted');
  assert.equal(observed.attention, null, 'no attention line is raised');
  assert.match(observed.answered, /changes no intent/);
});

test('grant 00a1a900: the candidate reads the roster first and never puts the ungrantable principal — no request, no refusal, no fault row', () => {
  const [, , request] = baseRequests();
  const [observed] = candidatePath(GY1, [request], WORLD);
  assert.equal(observed.decision, null, 'no approver is consulted');
  assert.equal(observed.attention, null, 'no attention line is raised');
  assert.match(observed.answered, /can never hold proof authority/);
});

test('the grant arm answers the attention template\'s unfilled placeholder too: PRODUCER names no principal any roster holds', () => {
  const verdict = premiseAnswer(GY1, { action: 'grant', input: { principal: 'PRODUCER', patterns: GY1.proofGaps } }, WORLD);
  assert.equal(verdict.request, false);
  assert.match(verdict.answer, /no principal this roster holds/);
});

test('the gate puts what the state does not answer: a genuine rework premise, a real widening and a producer-naming grant still reach the approver', () => {
  // A head with no open pull request holds a genuine rework premise — its own standing, never
  // another pull request's facts: the verified composer writes it, and the gate puts it.
  const stranded = { ...GY1, candidate: { ...GY1.candidate, sha: 'aaaabbbbccccdddddddddddddddddddddddd' } };
  const rework = premiseAnswer(stranded, { action: 'rework', input: { previousWorkerStopped: true } }, WORLD);
  assert.equal(rework.request, true);
  assert.match(rework.reason, /heads no open pull request against main/);
  // A requirements input that genuinely widens plannedFiles is not the current requirements: put.
  const widened = premiseAnswer(GY1, { action: 'requirements', input: { plannedFiles: [...GY1.plannedFiles, 'tests/widened.test.js'] } }, WORLD);
  assert.equal(widened.request, true);
  // A grant naming a principal the roster holds as a producer: put.
  const producerWorld = { ...WORLD, roster: [...ROSTER, { id: 'cryptob1-graphyard-snake-v4-producer-1', role: 'producer' }] };
  const grant = premiseAnswer(GY1, { action: 'grant', input: { principal: 'cryptob1-graphyard-snake-v4-producer-1', patterns: GY1.proofGaps } }, producerWorld);
  assert.equal(grant.request, true);
});

// ---------------------------------------------------------------------------
// The recurrence: the base files this item at the recorded instant; the candidate files nothing
// ---------------------------------------------------------------------------

test('the base crosses the threshold at the recorded detectedAt with exactly this item\'s three instances', () => {
  assert.equal(RECORDED.length, POLICY.threshold);
  // Every observation instant sits inside the 24-hour window the sweep counted.
  for (const instance of RECORDED) {
    assert.ok(Date.parse(instance.at) >= Date.parse(DETECTED_AT) - POLICY.windowHours * 3_600_000, `${instance.at} is inside the window`);
    assert.ok(Date.parse(instance.at) <= Date.parse(DETECTED_AT), `${instance.at} is not after the detection`);
  }
  const rows = basePath(GY1, baseRequests(), WORLD).map((observed, index) => trackFault(observed.attention, RECORDED[index].at));
  const recurrence = recurringClasses(rows, Date.parse(DETECTED_AT));
  assert.equal(recurrence.count, 3);
  assert.equal(recurrence.file, true);
  // The origin the filing records is this item's recorded origin, field for field.
  assert.deepEqual(faultClassOrigin(recurrence, DETECTED_AT), {
    class: 'decision', threshold: 3, windowHours: 24, count: 3, detectedAt: DETECTED_AT,
    instances: RECORDED.map(instance => ({ id: `decision-refused|${WORK_KEY}|${instance.at}`, kind: 'decision-refused', subject: WORK_KEY, at: instance.at })),
  });
});

test('the candidate counts none: no request was put, so no refusal was observed and the window files nothing', () => {
  const rows = candidatePath(GY1, baseRequests(), WORLD).flatMap(observed => (observed.attention ? [trackFault(observed.attention, RECORDED[0].at)] : []));
  assert.deepEqual(rows, [], 'no attention line exists to file');
  const recurrence = recurringClasses(rows, Date.parse(DETECTED_AT));
  assert.equal(recurrence.count, 0);
  assert.equal(recurrence.file, false);
});

// ---------------------------------------------------------------------------
// Live audits (coordinator host only; CI has no access to the control plane and skips both)
// ---------------------------------------------------------------------------

/** The coordinator checkout whose .graphyard/master.json names the plane and the coordinator credential (bin/graphyard.mjs's own read). */
const COORDINATOR = '/home/vish/code/graphyard-snake-v4';
const coordinatorCredential = () => {
  try {
    const master = JSON.parse(readFileSync(join(COORDINATOR, '.graphyard', 'master.json'), 'utf8'));
    if (typeof master.url !== 'string' || typeof master.credentialFile !== 'string') return null;
    const token = readFileSync(master.credentialFile, 'utf8').trim();
    return token ? { url: master.url, token } : null;
  } catch { return null; }
};
const plane = (path, config) => fetch(`${config.url.replace(/\/$/, '')}${path}`, { headers: { Authorization: `Bearer ${config.token}` }, signal: AbortSignal.timeout(20_000) }).then(response => (response.ok ? response.json() : null), () => null);

const credential = process.env.CI ? null : coordinatorCredential();
test('live audit: the control plane holds the three refused decision rows exactly as the reproduction reads them', { skip: credential ? false : 'no coordinator credential on this host (CI, or not the coordinator host)' }, async () => {
  const snapshot = await plane('/api/work-snapshot?view=coordination', credential);
  const gy1 = (snapshot?.work ?? []).find(item => item.key === WORK_KEY);
  assert.ok(gy1, `${WORK_KEY} on the work snapshot`);
  const history = await plane(`/api/work/${gy1.id}/decisions`, credential);
  const rows = new Map((history?.decisions ?? []).map(row => [row.id, row]));
  for (const instance of RECORDED) {
    const row = rows.get(instance.decision.id);
    assert.ok(row, `${instance.decision.id} on ${WORK_KEY}'s decision ledger`);
    assert.equal(row.action, instance.decision.action);
    assert.equal(row.state, 'refused');
    assert.equal(row.requestedAt, instance.decision.requestedAt);
    assert.equal(row.reason, instance.decision.reason);
    assert.equal(canonicalJson(row.input), canonicalJson(instance.decision.input));
    assert.equal(row.refusal?.approver, instance.decision.refusal.approver);
    assert.equal(row.refusal?.at, instance.decision.refusal.at);
    assert.equal(row.refusal?.reason, instance.decision.refusal.reason);
  }
});

const cli = process.env.GRAPHYARD_CLI ?? '/var/tmp/claude-1000/gy-main-cli/bin/graphyard.mjs';
/** This item's own record, read with whatever credential this runner holds (the worker's, or the coordinator's). */
const readItem = () => {
  const config = coordinatorCredential();
  const token = process.env.GRAPHYARD_TOKEN ?? config?.token;
  const url = process.env.GRAPHYARD_URL ?? config?.url;
  if (!existsSync(cli) || !token || !url) return null;
  const run = spawnSync(process.execPath, [cli, 'status', 'GY-21'], { encoding: 'utf8', timeout: 30_000, env: { ...process.env, GRAPHYARD_TOKEN: token, GRAPHYARD_URL: url } });
  if (run.status !== 0) return null;
  try { return JSON.parse(run.stdout); } catch { return null; }
};
const item = process.env.CI ? null : readItem();
test('live audit: this item\'s origin links exactly the three recorded instances, with the texts the reproduction pinned', { skip: item ? false : 'no control plane reachable from this runner (CI, or no credential)' }, () => {
  const origin = item.origin?.faultClass;
  assert.equal(origin?.class, 'decision');
  assert.equal(origin?.count, 3);
  assert.equal(origin?.threshold, POLICY.threshold);
  assert.equal(origin?.windowHours, POLICY.windowHours);
  assert.equal(origin?.detectedAt, DETECTED_AT);
  assert.deepEqual(origin.instances, RECORDED.map(instance => ({ id: `decision-refused|${WORK_KEY}|${instance.at}`, kind: 'decision-refused', subject: WORK_KEY, at: instance.at })));
  for (const instance of RECORDED) {
    assert.ok(item.description.includes(instance.text), `the filed description embeds the ${instance.decision.action} instance's recorded text`);
  }
});
