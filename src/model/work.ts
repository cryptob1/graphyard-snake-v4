// GY-24 — the work item's candidate pull-request pointer, verified at read time.
//
// The recorded fault (2026-10-17, the Graphyard installation serving this repository): GY-1's
// candidate pointer read `pr: 1` while the candidate head 024c07784321 was the head of open PR #4
// (PR #1: closed unmerged 2026-10-10T20:11:38Z, head 79efbe1f, base master — a pull request that is
// not the candidate; PR #4: open, head 024c07784321, branch graphyard/onboarding, base main,
// +142/-0, opened 2026-10-17T02:10:17Z). The stale pointer fed the refused rework decision
// f9162d74, whose premise ("its PR #1 was closed unmerged … and GitHub reports the head conflicting
// with the fresh main 14ddc2b25778 (mergeStateStatus DIRTY)") describes a pull request that is not
// the candidate; the approver refuted it ("The item's candidate.pr field still reads 1, which is a
// stale record pointer the control plane should correct, not a defect in the candidate"). Nothing
// corrected the pointer, because every path that could is closed:
//
//   · the provider's own reader reads the pull request the submission pointer names and nothing
//     else (graphyard src/github.ts observe: `/pulls/${work.submission!.pr}`), so it re-read the
//     closed PR #1 forever and never discovered PR #4;
//   · the resync that would re-read the item runs only as an action row an executor claims
//     (graphyard src/executor.ts `resync`), and no executor was alive ("all three executors
//     stopped" at the recorded instant) — the resync first attempted 2026-10-17T09:18:01Z was
//     refused 401, and the row starved: no resync runs without executors;
//   · and even a resync that did run could not correct the pointer: in control-plane merge-writer
//     mode its observation is read from the local repository and the stored number copied over the
//     fresh reading (graphyard src/engine.ts observeControlPlaneCandidate: `if (work.candidate.pr)
//     observation.candidate.pr = work.candidate.pr;`), and the item is past delivery
//     (`observe` returns a done item unchanged), so the stale number survives its own resync.
//
// This module is the read-time verification the criteria name as the remedy (AC-2's first arm):
// every consumer that reads a candidate pointer verifies it against the provider's pull-request
// readings — an open pull request whose head is exactly the candidate sha is the candidate's pull
// request, and a stored number naming anything else is corrected to it at read time, so no decision
// reason again cites a closed pull request for an open candidate (AC-2), and GY-1's pointer reads
// PR #4 (024c07784321 → PR 4, AC-1). The correction needs no executor and no credential beyond the
// read the consumer was already making. The shapes mirror the graphyard source this models: the
// `Candidate` of graphyard's own src/model/work.ts, and the pull-request reading its github.ts
// collects. Pure functions, no imports, so the regression tests run it under plain `node --test`.
//
// GY-35 — the wiring the post-merge review of GY-24 found missing: the verification existed, but
// nothing read through it — no decision or rework path called `readCandidateForDecision` or
// `verifiedCandidate`, so decision reasons were still composed from the unverified stored pointer
// (and `readCandidateForDecision` hard-coded `rework: null`, so even its own claim held only by
// construction). Now the decision path's own composer `decisionReason` reads through
// `readCandidateForDecision`, which builds its premise from the verified standing instead of a
// hard-coded null, and the loop model's every decision cycle composes through that composer by
// default (`runCycles` verifies unless the world explicitly models the recorded base state's
// reader). `unverifiedReworkReason` remains only as the reproduction of the recorded base state —
// no decision path composes through it.

/** The candidate pointer exactly as the work item record holds it (graphyard src/model/work.ts `Candidate`). */
export interface Candidate {
  /** The candidate head. The pointer's truth: the pull request it names must be open and headed by exactly this sha. */
  sha: string;
  baseSha: string;
  /** The pull-request number the record names. Stale exactly when no open pull request at `sha` carries it. */
  pr: number;
  branch: string;
  author: string;
}

/** One pull request as the provider read it — the facts the pointer's verification needs (graphyard src/github.ts collect). */
export interface PullRequestReading {
  number: number;
  state: 'open' | 'closed';
  merged: boolean;
  headSha: string;
  /** The branch the head belongs to; the record may not name it (PR #1's record does not). Used only to narrow a genuine ambiguity. */
  headBranch?: string;
  /** The base the pull request targets. A pull request against another base (PR #1 targeted master) is never the candidate's. */
  baseBranch: string;
  openedAt?: string;
  closedAt?: string | null;
}

/** The work item record as the reader holds it (the pieces the pointer's consumers read). */
export interface WorkItem {
  key: string;
  candidate: Candidate | null;
  /** The epoch's submitted pull request (graphyard `Work.submission`). A delivered epoch's record stays as history. */
  submission: { pr: number; epoch: number } | null;
  /** A delivered item's record is immutable: graphyard `Engine.observe` returns a done item unchanged. */
  stage?: string;
}

/** The provider's queue reading the recorded premise carried: GitHub's mergeStateStatus and the base tip it was taken against. */
export interface ProviderQueueReading {
  mergeStateStatus: string;
  baseTip: string;
}

/** The verified pointer, what every consumer of `candidate.pr` reads through this module. */
export interface PointerVerification {
  /** The pointer as the reader uses it: corrected when a correction was warranted, the stored one otherwise. */
  candidate: Candidate;
  /** True when the stored number was replaced at read time. */
  corrected: boolean;
  /** The stale number the read replaced, null when it replaced none. */
  from: number | null;
  /** The open pull request at the candidate head — the pointer's referent — or null when the head has none. */
  pull: PullRequestReading | null;
  /** The one-sentence finding the read stands on, citable by any decision reason. */
  basis: string;
}

/**
 * The read-time verification itself (the correction this item delivers): an open, unmerged pull
 * request whose head is exactly the candidate sha and whose base is the managed base is the
 * candidate's pull request; the pointer names it, whatever number the record stored. When the head
 * has no such pull request the stored pointer stands — never corrected onto a closed or foreign
 * pull request — and the basis says so, so a decision built on it names the head's actual standing
 * instead of citing a closed pull request as the candidate's. A head with several open pull
 * requests against the managed base is narrowed by the candidate's own branch when that names
 * exactly one, and refused otherwise: the pointer is never corrected on a guess.
 */
export function verifiedCandidate(
  candidate: Candidate,
  readings: readonly PullRequestReading[],
  baseBranch = 'main',
): PointerVerification {
  const sha12 = candidate.sha.slice(0, 12);
  const open = readings.filter(
    reading => reading.state === 'open' && !reading.merged && reading.headSha === candidate.sha && reading.baseBranch === baseBranch,
  );
  const narrowed =
    open.length > 1 && candidate.branch
      ? open.filter(reading => reading.headBranch !== undefined && reading.headBranch === candidate.branch)
      : open;
  if (open.length > 1 && narrowed.length !== 1) {
    throw new Error(
      `candidate ${sha12} heads ${open.length} open pull requests against ${baseBranch} (${open.map(reading => `#${reading.number}`).join(', ')}); the pointer is not corrected on a guess`,
    );
  }
  const pull = narrowed[0] ?? null;
  if (!pull) {
    return {
      candidate,
      corrected: false,
      from: null,
      pull: null,
      basis: `candidate ${sha12} heads no open pull request against ${baseBranch}; the stored PR #${candidate.pr} is not its open pull request, and no decision cites it as one`,
    };
  }
  const corrected = pull.number !== candidate.pr;
  return {
    candidate: corrected ? { ...candidate, pr: pull.number } : candidate,
    corrected,
    from: corrected ? candidate.pr : null,
    pull,
    basis: corrected
      ? `candidate ${sha12} is the head of open PR #${pull.number} against ${baseBranch}; the stored PR #${candidate.pr} named a pull request that is not the candidate's, corrected at read time`
      : `candidate ${sha12} is the head of open PR #${pull.number} against ${baseBranch}; the stored pointer already names it`,
  };
}

/**
 * The premise the recorded decision built on a pull request that is not the candidate's (the
 * approver's refutation, as a finding). The recorded reason cited the pull request's own state —
 * closed unmerged — because that is what the reader of the stored number reports; an open pull
 * request that heads another commit is cited by that mismatch instead. A pull request that is
 * open at exactly the candidate head holds no premise at all.
 */
export function stalePullPremise(candidate: Candidate, pull: PullRequestReading): string {
  if (pull.state === 'closed' || pull.merged)
    return `its PR #${pull.number} was closed unmerged on ${pull.closedAt ?? 'an unrecorded instant'}`;
  if (pull.headSha !== candidate.sha) return `its PR #${pull.number} heads ${pull.headSha.slice(0, 12)}, not the candidate`;
  return `its PR #${pull.number} is the candidate's open pull request`;
}

/**
 * The rework decision's reason exactly as the record holds it: composed from the stored pointer's
 * pull request and the provider's queue reading, without verifying either against the candidate
 * head. On GY-1's recorded inputs this reproduces decision f9162d74's reason verbatim — the fault
 * this item exists to end.
 */
export function stalePointerReworkReason(candidate: Candidate, stale: PullRequestReading, queue: ProviderQueueReading): string {
  return `Candidate ${candidate.sha.slice(0, 12)} cannot deliver: ${stalePullPremise(candidate, stale)} and GitHub reports the head conflicting with the fresh main ${queue.baseTip} (mergeStateStatus ${queue.mergeStateStatus}), so the test gate can never pass; retire this candidate and rebuild on the current base`;
}

/** The decision read: the pointer verified, the reason a decision may cite built from the verified read alone. */
export interface DecisionRead {
  /**
   * The rework premise built from the verified standing, or null when the verified read holds none
   * — an open candidate is never retired on a closed pull request's facts, and a candidate whose
   * own pull request merged at its head delivered, so it holds none either. When the head holds
   * no open pull request the premise cites the head's own standing, or its own former pull
   * request's facts when a closed-unmerged reading sits at exactly the head: never another pull
   * request's.
   */
  rework: string | null;
  /** The standing the decision cites instead: the verified pointer's own finding. */
  standing: string;
  candidate: Candidate;
  corrected: boolean;
}

/**
 * The decision read as this change makes it: verify the pointer first, then build the reason from
 * the verified read. Without the verification (the recorded base state) the same inputs produced
 * `stalePointerReworkReason` — see `unverifiedReworkReason`, which reproduces that path; through
 * the verification no reason is built from a pull request that is not the candidate's, so the
 * recorded premise cannot recur. A head the verified read finds open holds no premise at all; a
 * head whose own pull request was merged holds none either — a merged pull request at exactly the
 * candidate head against the managed base is a delivery, not a defect, so nothing retires it; a
 * head with no open pull request holds a genuine one built from its own standing — its own
 * former pull request's facts when a closed-unmerged reading sits at exactly that head against
 * the managed base, and otherwise the head's bare lack of an open pull request, with the stored
 * number named only as a number that named a pull request that is not the candidate's, never as
 * grounds.
 */
export function readCandidateForDecision(
  work: WorkItem,
  readings: readonly PullRequestReading[],
  baseBranch = 'main',
): DecisionRead | null {
  if (!work.candidate) return null;
  const candidate = work.candidate;
  const verification = verifiedCandidate(candidate, readings, baseBranch);
  if (verification.pull) {
    return { rework: null, standing: verification.basis, candidate: verification.candidate, corrected: verification.corrected };
  }
  const atHead = readings.filter(reading => reading.headSha === candidate.sha && reading.baseBranch === baseBranch);
  if (atHead.some(reading => reading.merged)) {
    // The candidate's own pull request, merged at exactly its head: a delivery, not a defect —
    // no premise retires a candidate that delivered (GY-34's live audit holds this standing).
    return { rework: null, standing: verification.basis, candidate: verification.candidate, corrected: verification.corrected };
  }
  const own = atHead.find(reading => reading.state === 'closed' && !reading.merged);
  const rework = own
    ? stalePullPremise(candidate, own)
    : `it heads no open pull request against ${baseBranch} (the stored PR #${candidate.pr} names a pull request that is not the candidate's)`;
  return { rework, standing: verification.basis, candidate: verification.candidate, corrected: verification.corrected };
}

/**
 * The decision path's own composer (GY-35's wiring): the reason a rework decision cites, read
 * through the verified pointer and never through the stored number. The sentence keeps the
 * recorded decision's shape — premise, the provider's queue reading, the retirement it asks for —
 * but every premise comes from `readCandidateForDecision`'s verified read, so on the recorded
 * inputs it composes no reason at all (the candidate stands open at PR #4), and where a head
 * truly holds no open pull request the premise cites the head's own standing or its own former
 * pull request's facts. The recorded fault — retiring an open candidate on a closed pull request's
 * facts read through a stale pointer — is not a sentence this composer can produce: PR #1's facts
 * enter a reason only through `unverifiedReworkReason`, the reproduction of the recorded base state.
 */
export function decisionReason(
  work: WorkItem,
  readings: readonly PullRequestReading[],
  queue: ProviderQueueReading,
  baseBranch = 'main',
): string | null {
  const read = readCandidateForDecision(work, readings, baseBranch);
  if (!read || read.rework === null) return null;
  return `Candidate ${read.candidate.sha.slice(0, 12)} cannot deliver: ${read.rework} and GitHub reports the head conflicting with the fresh main ${queue.baseTip} (mergeStateStatus ${queue.mergeStateStatus}), so the test gate can never pass; retire this candidate and rebuild on the current base`;
}

/**
 * The recorded base state's own read, kept only for the regression to reproduce the fault (no
 * decision path composes through it — GY-35 wired `decisionReason` in as the composer): the reason
 * composed straight from the stored pointer, the pull request that number names, and the queue
 * reading — verified against nothing. The pull request the stored number names is looked up in the
 * same readings; a stored number naming an open pull request at the candidate head holds no
 * premise, exactly as it should.
 */
export function unverifiedReworkReason(
  work: WorkItem,
  readings: readonly PullRequestReading[],
  queue: ProviderQueueReading,
): string | null {
  if (!work.candidate) return null;
  const stored = readings.find(reading => reading.number === work.candidate!.pr);
  if (!stored) return null;
  const isCandidatePull = stored.state === 'open' && !stored.merged && stored.headSha === work.candidate.sha;
  return isCandidatePull ? null : stalePointerReworkReason(work.candidate, stored, queue);
}

/** The roles graphyard's control plane holds (graphyard src/model/work.ts `Principal['role']`). */
export type Role = 'admin' | 'operator-agent' | 'coordinator' | 'worker' | 'producer' | 'reader';

/**
 * Who may even ask the control plane for a resync (graphyard src/engine.ts `resyncWork`:
 * `demand(actor.role === 'coordinator' || actor.role === 'admin', 'Coordinator permission required')`).
 * The doctor's own attempt (an operator-agent) is refused; a worker is refused too.
 */
export function roleMayResync(role: Role): boolean {
  return role === 'coordinator' || role === 'admin';
}

/** The refusal the recorded first attempt met, as the model states it for any role the demand refuses. */
export function resyncRefusalFor(role: Role): string | null {
  return roleMayResync(role) ? null : `resync refused: Coordinator permission required — the ${role} role may not resync`;
}

/**
 * The control-plane resync's own observation, faithfully: the fresh local reading (whose `pr` is 0
 * until a submit transaction allocates a change number — graphyard src/merge-writer/local-observation.ts)
 * with the stored number copied over it (graphyard src/engine.ts `observeControlPlaneCandidate`:
 * `if (work.candidate.pr) observation.candidate.pr = work.candidate.pr;`). This is why a resync,
 * even run by a permitted role with a live executor, leaves a stale pointer stale: the fresh
 * reading never reaches the record.
 */
export function controlPlaneResyncObservation(work: WorkItem, fresh: { pr: number }): { pr: number } {
  const observation: { pr: number } = { ...fresh };
  if (work.candidate?.pr) observation.pr = work.candidate.pr;
  return observation;
}

/** Whether an observation can write a work item's record at all: a delivered item is returned unchanged (graphyard `Engine.observe`). */
export function observationWrites(work: WorkItem): boolean {
  return work.stage !== 'done';
}

/** The action row a resync runs as, and the world it waits in (graphyard src/executor.ts `resync` handler). */
export interface ResyncWorld {
  /** Live executors serving resync at the instant (the recorded instant: 0 — "all three executors stopped"). */
  executors: number;
  /**
   * This change: the reader verifies the pointer itself, with no executor and no resync at all.
   * Defaults to true — the delivered decision path verifies; a world modelling the recorded base
   * state's reader (the one that trusted the stored number) passes false explicitly.
   */
  verifyAtRead?: boolean;
  /** The role asking for the resync; the executor carries the coordinator credential. */
  role?: Role;
}

/** One loop's trace over the recorded world: what each cycle's decision read produced, and what became of the resync row. */
export interface CycleTrace {
  cycles: number;
  /** The pointer every decision after the first read cites (the record itself is immutable; the read's view is what reasons build on). */
  pointer: { pr: number; correctedAtCycle: number | null; from: number | null };
  /** The resync row: when it completed, and what completed it — an executor's claim, or the read itself. */
  resync: { completedAtCycle: number | null; by: 'executor' | 'read' | null };
  /** Each cycle's decision reason: the recorded sentence while the read is unverified; through the verified read, null while the candidate stands open, and the head's own standing when it truly holds no open pull request. */
  reasons: (string | null)[];
}

/**
 * The loop the installation ran, over the recorded world, for `cycles` cycles — the model the
 * integration proof drives. Three truths it holds, each the recorded fault or its remedy:
 *
 *   · with no live executors and no read-time verification (the recorded base state) the resync
 *     row never completes and every cycle's decision cites the closed pull request's premise —
 *     the fault, cycle after cycle, with nothing to end it;
 *   · with read-time verification the very first decision read corrects the pointer and holds no
 *     premise; the resync row is answered by the read itself (`by: 'read'`) — no executor ever
 *     needed, which is the criterion's "a resync that runs without live executors";
 *   · an executor-served resync alone (the remedy the item's filing first imagined) completes its
 *     row but cannot correct the pointer — its own observation carries the stored number back
 *     (see `controlPlaneResyncObservation`), and a delivered item's record is not written at all,
 *     so the read-time verification is the correction that actually lands.
 */
export function runCycles(
  work: WorkItem,
  readings: readonly PullRequestReading[],
  queue: ProviderQueueReading,
  world: ResyncWorld,
  cycles: number,
  baseBranch = 'main',
): CycleTrace {
  const trace: CycleTrace = {
    cycles,
    pointer: { pr: work.candidate?.pr ?? 0, correctedAtCycle: null, from: null },
    resync: { completedAtCycle: null, by: null },
    reasons: [],
  };
  for (let cycle = 0; cycle < cycles; cycle++) {
    if (world.verifyAtRead !== false) {
      // The decision cycle composes its reason through the decision path's own composer, which
      // reads through the very same verified read (the bookkeeping below needs the read itself).
      const read = readCandidateForDecision(work, readings, baseBranch);
      trace.reasons.push(decisionReason(work, readings, queue, baseBranch));
      if (read?.corrected && trace.pointer.correctedAtCycle === null) {
        trace.pointer = { pr: read.candidate.pr, correctedAtCycle: cycle, from: work.candidate?.pr ?? null };
      }
      // The resync row's premise — a candidate the record has not read at its true pull request —
      // is answered by this very read; the row completes with no executor at all.
      if (trace.resync.completedAtCycle === null) trace.resync = { completedAtCycle: cycle, by: 'read' };
    } else {
      trace.reasons.push(unverifiedReworkReason(work, readings, queue));
      // The resync row completes only when a live executor claims it (and only for a role the
      // control plane's demand admits), and its observation writes nothing for a delivered item —
      // and even where it writes, it carries the stored number back. The pointer never moves.
      if (trace.resync.completedAtCycle === null && world.executors > 0 && roleMayResync(world.role ?? 'coordinator')) {
        trace.resync = { completedAtCycle: cycle, by: 'executor' };
      }
    }
  }
  return trace;
}
