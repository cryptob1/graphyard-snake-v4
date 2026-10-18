// GY-38 — fault class "capacity": three concurrency-starved instances in 24 hours (threshold 3,
// window 24 h, graphyard src/model/fault-classes.ts faultClassPolicyDefaults), recorded by the
// master loop against the Graphyard installation that serves this repository. As GY-3 did for the
// configuration class, GY-11 for deployment, GY-15 for observation, GY-17 for loop, GY-23 for
// resources and GY-29/GY-37 for the merge-stage bypass, this file is the regression test the
// item's criterion asks for: each recorded instance is reproduced below against its recorded base
// state — the exact launch fleet the installation held at the recorded instants — and shown not
// to recur against the candidate condition, the fleet that covers the demand. The last tests
// audit the live installation on the coordinator host; CI has no access to that host and skips
// those audits.
//
// The recorded instances, verbatim from the item (each the loop cycle whose silence bound the
// longest fleet-held subject first crossed; the daemon cursor holds the same rows, lastSeenAt
// running on while the subject kept standing):
//
//   2026-10-17T22:07:01.486Z  concurrency-starved on GY-23 — "Nothing has acted on GY-23 is
//     claimable but no worker profile is free; it starts when one frees for 32 minutes, past the
//     20-minute bound, while 2 subject(s) were actionable"
//   2026-10-17T22:19:12.551Z  concurrency-starved on GY-24 — the same wording, "for 34 minutes,
//     past the 20-minute bound, while 1 subject(s) were actionable"
//   2026-10-18T01:23:50.965Z  concurrency-starved on GY-34 — the same wording, "for 21 minutes,
//     past the 20-minute bound, while 3 subject(s) were actionable" — this cycle's fault step
//     crossed the threshold and filed GY-38 itself (created 01:23:53.710Z, detectedAt = the cycle
//     instant; the GY-23/GY-24 rows reached the item through the ledger backfill, event 6222).
//
//   A fourth instance followed the filing and linked instead of re-filing, exactly as the class
//   design says: 2026-10-18T01:24:56.309Z on GY-35, "for 35 minutes, past the 20-minute bound,
//   while 1 subject(s) were actionable" (cursor row linkedTo GY-38).
//
// The recorded base state, as the installation held it at every recorded instant. The daemon's own
// capacity records — the dispatch step's `capacity:<work>` action rows, reproduced below — name
// the fleet at each instant they were written, and every one of them before the remedy names
// exactly two launch profiles:
//
//   · the installation ran two worker launch profiles, cryptob1-graphyard-snake-v4-worker-1 and
//     cryptob1-graphyard-snake-v4-worker-2 — the fleet GY-14 declared (graphyard.json
//     capacity.workers 2) and reconciled onto this host.
//   · a worker profile holds at most one ready item at a time, and it is held for a whole attempt:
//     only a worker finishing frees the slot. The pipeline's concurrent claimable demand ran
//     higher than two the whole recorded evening: eight fleet-held records in fifty-two minutes
//     (GY-32 01:03:21.284Z, GY-29 01:08:45.560Z, GY-33 01:14:46.026Z, GY-34 01:18:44.046Z, GY-36
//     01:24:35.635Z, GY-35 01:26:50.344Z, GY-38 01:46:16.760Z, GY-21 01:55:18.683Z — each reading
//     "Every worker profile is held while GY-N is claimable (cryptob1-graphyard-snake-v4-worker-1,
//     cryptob1-graphyard-snake-v4-worker-2); GY-N keeps its dispatch order and starts when a slot
//     frees"), while the recorded instants name 1–3 actionable subjects beside the starved one.
//
// The mechanism, exactly as the deployed source produces it:
//
//   · the launch step's own availability test (graphyard src/daemon/cycle-dispatch.ts
//     `saturatedFleet`, GY-1890): some launch profile is healthy-or-busy and none is
//     healthy-and-free — here, both profiles held by live attempts. The step records the finding
//     (a `capacity:<work>` action row, "Every worker profile is held while GY-N is claimable (…);
//     GY-N keeps its dispatch order and starts when a slot frees"), reports the stop
//     (`cycle.fleetHeld`), and declines to launch: nothing a cycle does frees a slot.
//   · the measure's reclassification (src/daemon/metrics.ts `actionableSubjects`, GY-1890): a
//     claimable item the fleet holds is a silence subject of kind 'capacity' carrying the fixed
//     wording (`fleetHoldWording.held`), its idle clock running since the subject last moved.
//   · the attention (src/daemon/liveness.ts `loopAttention`): the longest silent subject past
//     `silenceBudgetMs` (1_200_000 ms, the 20-minute bound) raises "Nothing has acted on … for N
//     minutes, past the 20-minute bound, while M subject(s) were actionable", classified
//     'concurrency-starved' exactly when `fleetHold` reads the entry (kind 'capacity' plus the
//     fixed wording) — a wait only a worker finishing ends, so the class is capacity's, not the
//     loop's.
//   · the fault step (src/model/fault-classes.ts catalogue and policy, src/model/fault-record.ts):
//     'concurrency-starved' is a fault of class 'capacity' ("a provider account out of quota or a
//     role starved of slots"); one instance per standing subject, and a class past its threshold
//     (3) inside its window (24 h) files one structural item — GY-38 — that later instances link
//     to instead of filing again.
//
// The cause the three share: the fleet's slot capacity — two launch profiles — is smaller than the
// pipeline's concurrent claimable demand (three actionable subjects at the recorded peak, eight
// starved dispatches in fifty-two minutes). Every fleet-held item therefore waited for a worker
// to finish, past the 20-minute bound, exactly as the recorded details say.
//
// The candidate condition — the fleet covers the demand, reconciled onto the host with the
// repository's own documented procedure (README "Graphyard worker capacity": `graphyard principal
// add <install>-worker-N --role worker` for each principal the roster lacks, the credential copy
// `master environments` discovers, then `graphyard master environments --apply`, whose launch
// profile the master loop adopts on its next tick without a restart — `scripts/graphyard-
// executor.mjs --install` automates the same steps from the coordinator checkout):
//
//   · worker-3's credential landed 2026-10-18T01:58:27Z (the file's mtime; the fleet-held record
//     01:58:32.270Z on GY-22 already names three profiles), workers 4 and 5 at 02:01:57Z:
//     .graphyard/master.json has held a five-profile launch list since (mtime 02:01:58Z). The
//     dispatches that had been starved (GY-21 and GY-22 among them) started on the new profiles,
//     four attempts running at once where two had — and the daemon's later fleet-held findings
//     name the grown fleet, never the two-profile base again (the 02:07:19.022Z finding on GY-18
//     names all five: four live attempts plus a profile cooling on the role's account concurrency
//     limit of four live sessions).
//   · no concurrency-starved instance has opened since: the fleet-held finding is the mechanism
//     working — the loop declining to launch into a fleet whose every profile is held — while the
//     instance is the fault, opened only when a claimable subject's wait crosses the 20-minute
//     bound. With the fleet covering the demand a claimable item is dispatched in the same cycle
//     (~21 s), far inside the bound: no capacity silence entry, no attention line, no instance,
//     and the class cannot cross its threshold. A future peak past the fleet starves again by
//     design and files a new item, exactly as this item's own description says.
//
// The declaration the operator owns: graphyard.json still declares capacity.workers 2 while the
// installation runs five. The reconciler never removes a profile (an excess is reported, never
// acted on), so the live fleet is stable, and raising the declaration is a scope this item does
// not carry — the widening rule refused it twice here ("graphyard.json is outside what this item's
// own criteria and the repository's documentation rule imply; an operator decides scope the item
// does not already carry"). It is named in this header and in the live audit's failure message,
// never modelled as done.
//
// The models below are faithful miniatures of those decision paths, at the fidelity the recorded
// instances exercised; each cites the graphyard source it models and refuses (rather than guesses)
// on arms the instances never touched. The file runs under `node --test` (plain JavaScript, Node
// builtins only) and needs no installed dependency.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';

// ---------------------------------------------------------------------------
// The recorded instants, subjects and details, verbatim from the item and the daemon cursor.
// ---------------------------------------------------------------------------

/** The three recorded instances: the cycle instant that crossed the bound, the minutes the subject had waited, and the actionable count the cycle reported. */
const RECORDED = [
  { key: 'GY-23', at: '2026-10-17T22:07:01.486Z', minutes: 32, actionable: 2 },
  { key: 'GY-24', at: '2026-10-17T22:19:12.551Z', minutes: 34, actionable: 1 },
  { key: 'GY-34', at: '2026-10-18T01:23:50.965Z', minutes: 21, actionable: 3 },
];

/** The fourth instance the loop counted after filing: it links to the standing item instead of filing again. */
const AFTER_FILING = { key: 'GY-35', at: '2026-10-18T01:24:56.309Z', minutes: 35, actionable: 1 };

/** The recorded detail each instance carried, character for character. */
const recordedText = instance =>
  `Nothing has acted on ${instance.key} is claimable but no worker profile is free; it starts when one frees for ${instance.minutes} minutes, past the 20-minute bound, while ${instance.actionable} subject(s) were actionable`;

/** The recorded base fleet: two launch profiles, healthy, each held by a live attempt — what GY-14 declared and reconciled. */
const INSTALL = 'cryptob1-graphyard-snake-v4';
const BASE_FLEET = [1, 2].map(number => ({
  name: `${INSTALL}-worker-${number}`, mode: 'launch', healthy: true, busy: true, heldByLiveAttempt: true, reason: 'working',
}));

/** The candidate fleet: five launch profiles, the live list .graphyard/master.json has held since 2026-10-18T02:01:58Z. */
const CANDIDATE_FLEET = [1, 2, 3, 4, 5].map(number => ({
  name: `${INSTALL}-worker-${number}`, mode: 'launch', healthy: true, busy: number <= 2, heldByLiveAttempt: number <= 2, reason: number <= 2 ? 'working' : 'idle',
}));

/** The recorded peak of concurrent demand: three actionable subjects at the GY-34 instant. */
const RECORDED_PEAK = 3;

/** The instant the fleet outgrew the recorded peak: master.json's write that holds the five-profile launch list. */
const FLEET_COVERED_PEAK_AT = '2026-10-18T02:01:58Z';

// ---------------------------------------------------------------------------
// The graphyard decision path, modelled. Each piece cites the source it models and keeps that
// source's own shape: the wordings are the deployed product's, so the recorded details come out
// character for character rather than being asserted into place.
// ---------------------------------------------------------------------------

/** graphyard src/daemon/metrics.ts: the 20-minute silence budget the longest silent subject is judged on. */
const silenceBudgetMs = 1_200_000;

/** graphyard src/daemon/metrics.ts fleetHoldWording (GY-1890): the fixed wording a fleet-held claimable item's silence entry carries. */
const fleetHoldWording = { held: 'is claimable but no worker profile is free; it starts when one frees' };

/** graphyard src/daemon/metrics.ts approverWaitWording: a decision subject waiting on an approver session, the other arm of the classifier. */
const approverWaitWording = { waiting: 'is requested and waiting for approver session', unjudged: 'is unjudged after' };

/** graphyard src/model/fault-classes.ts faultClassPolicyDefaults: the class policy the fault step counts instances under. */
const faultClassPolicy = { threshold: 3, windowHours: 24 };

/** graphyard src/model/fault-classes.ts faultCatalogue: the kinds these classifier arms raise, under their shipped class. */
const catalogueClass = { 'concurrency-starved': 'capacity', 'decision-unanswered': 'decision', 'loop-silence': 'loop' };

/** graphyard src/daemon/metrics.ts fleetHold: a silent subject whose wait the fleet's slot capacity owns. */
const fleetHold = entry => entry.kind === 'capacity' && entry.detail.includes(fleetHoldWording.held);

/** graphyard src/daemon/metrics.ts approverWait: a silent subject whose wait an approver session owns. */
const approverWait = entry => entry.kind === 'decision'
  && (entry.detail.includes(approverWaitWording.waiting) || entry.detail.includes(approverWaitWording.unjudged));

/**
 * graphyard src/daemon/cycle-dispatch.ts saturatedFleet (GY-1890), verbatim in shape: the launch
 * step's own availability test. A fleet with no launch profile, or none that could take work even
 * free, is not saturation — that is the escalation arm, whose remedy is a working credential, not
 * a bigger fleet.
 */
function saturatedFleet(profiles, held) {
  const launchable = profiles.filter(entry => entry.mode === 'launch');
  return launchable.length > 0 && launchable.some(entry => entry.healthy || entry.busy) && !launchable.some(entry => entry.healthy && !held(entry));
}

/**
 * The launch step's round for one cycle (graphyard src/daemon/cycle-dispatch.ts
 * dispatchStepWithin): each claimable item, in dispatch order, takes the first healthy profile
 * nothing holds — `taken` grows as the round assigns — and the first item no profile can take ends
 * the round. With the fleet saturated the step records the capacity finding and stops; short of
 * saturation it records the dispatch-failure escalation instead. `held` is the step's own
 * predicate: a profile this round already took, or one whose agent occupies a role bound with a
 * live attempt (occupiesRoleBound) — the recorded base state held both profiles that way.
 */
function launchRound(fleet, claimable) {
  const taken = new Set();
  const launches = [], capacityFindings = [];
  for (const item of claimable) {
    const held = entry => taken.has(entry.name) || entry.heldByLiveAttempt;
    const choice = fleet.find(entry => entry.healthy && !held(entry));
    if (!choice) {
      const launchable = fleet.filter(entry => entry.mode === 'launch');
      if (!saturatedFleet(fleet, held)) {
        return { launches, capacityFindings, fleetHeld: false, escalation:
          `No worker profile can take ${item.key}: ${launchable.map(entry => `${entry.name} (${entry.reason})`).join('; ')}` };
      }
      capacityFindings.push(`Every worker profile is held while ${item.key} is claimable (${launchable.map(entry => entry.name).join(', ')}); ${item.key} keeps its dispatch order and starts when a slot frees`);
      return { launches, capacityFindings, fleetHeld: true };
    }
    taken.add(choice.name);
    launches.push({ item: item.key, profile: choice.name });
  }
  return { launches, capacityFindings, fleetHeld: false };
}

/**
 * The measure's reclassification (graphyard src/daemon/metrics.ts actionableSubjects, GY-1890): a
 * claimable item the fleet holds is a silence subject of kind 'capacity' carrying the fixed
 * wording, its idle clock running since the subject last moved. An item the round launched is not
 * silent: its wait is that launch, never the fleet's capacity.
 */
function silenceSubjects(round, claimable, since, now) {
  return claimable
    .filter(item => round.fleetHeld && !round.launches.some(launch => launch.item === item.key))
    .map(item => ({ key: item.key, kind: 'capacity', work: item.key, detail: `${item.key} ${fleetHoldWording.held}`,
      since, idleMs: Math.max(0, now - Date.parse(since)) }))
    .sort((a, b) => b.idleMs - a.idleMs);
}

/** graphyard src/daemon/metrics.ts silenceReport: the subjects, the longest, and whether the bound is breached. */
function silenceReport(subjects, actionable) {
  const longest = subjects[0] ?? null;
  return { actionable, longestIdleMs: longest?.idleMs ?? 0, longest, budgetMs: silenceBudgetMs, breached: !!longest && longest.idleMs > silenceBudgetMs };
}

/**
 * graphyard src/daemon/liveness.ts loopAttention, the silence branch, verbatim in shape: the
 * breached bound raises one line naming the longest subject's detail word for word, and the
 * classifier (fleetHold first, approverWait second, loop-silence last) decides its kind.
 */
function loopAttention(report) {
  if (!(report.silence.breached && report.silence.longest)) return [];
  const entry = report.silence.longest;
  const kind = fleetHold(entry) ? 'concurrency-starved' : approverWait(entry) ? 'decision-unanswered' : 'loop-silence';
  return [{ subject: entry.work ?? 'loop', kind, faultClass: catalogueClass[kind],
    text: `Nothing has acted on ${entry.detail} for ${Math.round(entry.idleMs / 60_000)} minutes, past the ${Math.round(report.silence.budgetMs / 60_000)}-minute bound, while ${report.silence.actionable} subject(s) were actionable` }];
}

/**
 * The fault step's record (graphyard src/model/fault-record.ts trackFaults/linkInstance over
 * src/model/fault-classes.ts cycleFaults and the class policy): each attention line is an instance
 * on a stable subject — one id per breach, the stamp its first sighting, lastSeenAt running on
 * while it stands — and a class past its threshold inside its window files one structural item
 * that every instance of the class, counted or later, links to. The item's key is the control
 * plane's own sequence; live, the item this filed is GY-38, so the model files under that key.
 */
function faultStep(state, attention, now) {
  const at = new Date(now).toISOString();
  for (const line of attention) {
    const standing = state.instances.find(instance => instance.kind === line.kind && instance.subject === line.subject);
    if (standing) { standing.lastSeenAt = at; continue; }
    state.instances.push({ id: `${line.kind}|${line.subject}|${at}`, kind: line.kind, faultClass: line.faultClass, subject: line.subject, text: line.text, at, lastSeenAt: at, linkedTo: null });
  }
  for (const faultClass of [...new Set(state.instances.map(instance => instance.faultClass))]) {
    const inWindow = state.instances.filter(instance => instance.faultClass === faultClass
      && Date.parse(instance.at) > now - faultClassPolicy.windowHours * 3_600_000);
    const standingItem = state.items[faultClass];
    if (!standingItem && inWindow.length >= faultClassPolicy.threshold) {
      state.items[faultClass] = { key: 'GY-38', filedAt: inWindow[inWindow.length - 1].at, origin: { faultClass: {
        class: faultClass, count: inWindow.length,
        instances: inWindow.map(({ at: instanceAt, id, kind, subject }) => ({ at: instanceAt, id, kind, subject })),
        threshold: faultClassPolicy.threshold, detectedAt: inWindow[inWindow.length - 1].at, windowHours: faultClassPolicy.windowHours } } };
    }
    const item = state.items[faultClass];
    if (item) for (const instance of inWindow) instance.linkedTo ||= item.key;
  }
  return state;
}

/** One loop cycle over a fleet and its claimable demand: the launch round, the silence it leaves, the attention that raises, the fault step's record. */
function cycle(state, { fleet, claimable, since, now, actionable }) {
  const round = launchRound(fleet, claimable);
  const attention = loopAttention({ silence: silenceReport(silenceSubjects(round, claimable, since, now), actionable) });
  return { round, attention, faults: faultStep(state, attention, now) };
}

/** The subject's idle start that rounds to the recorded minutes: the recorded `for N minutes` is Math.round(idleMs/60_000), so exactly N minutes is the faithful centre of it. */
const sinceOf = instance => new Date(Date.parse(instance.at) - instance.minutes * 60_000).toISOString();

// ---------------------------------------------------------------------------
// The recorded instances, reproduced against the base.
// ---------------------------------------------------------------------------

for (const instance of RECORDED) {
  test(`${instance.key} at ${instance.at}: the base state's two held profiles starve it past the bound and raise the recorded instance verbatim`, () => {
    const claimable = [{ key: instance.key }];
    const { round, attention } = cycle({ instances: [], items: {} }, {
      fleet: BASE_FLEET, claimable, since: sinceOf(instance), now: Date.parse(instance.at), actionable: instance.actionable,
    });

    // The launch step's own stop: both profiles held by live attempts, so the fleet is saturated,
    // the capacity finding is recorded with the fleet's names, and nothing is launched.
    assert.equal(round.fleetHeld, true);
    assert.deepEqual(round.launches, []);
    assert.deepEqual(round.capacityFindings, [
      `Every worker profile is held while ${instance.key} is claimable (${INSTALL}-worker-1, ${INSTALL}-worker-2); ${instance.key} keeps its dispatch order and starts when a slot frees`,
    ], 'the finding the daemon cursor holds for every fleet-held item of the recorded evening');

    // The measure leaves the claimable item a capacity silence subject carrying the fixed wording,
    // and the breached bound raises the recorded attention line character for character.
    assert.equal(attention.length, 1);
    assert.equal(attention[0].kind, 'concurrency-starved');
    assert.equal(attention[0].faultClass, 'capacity');
    assert.equal(attention[0].text, recordedText(instance));

    // The fault step records it as the cursor row the item quotes: id, class, subject, text.
    const state = faultStep({ instances: [], items: {} }, attention, Date.parse(instance.at));
    assert.equal(state.instances.length, 1);
    assert.equal(state.instances[0].id, `concurrency-starved|${instance.key}|${instance.at}`);
    assert.equal(state.instances[0].faultClass, 'capacity');
    assert.equal(state.instances[0].text, recordedText(instance));
  });
}

test('the threshold files one item for the class, and the instance that followed the filing links instead', () => {
  const state = { instances: [], items: {} };
  // Two instances inside the window file nothing: the threshold is three.
  cycle(state, { fleet: BASE_FLEET, claimable: [{ key: RECORDED[0].key }], since: sinceOf(RECORDED[0]), now: Date.parse(RECORDED[0].at), actionable: RECORDED[0].actionable });
  cycle(state, { fleet: BASE_FLEET, claimable: [{ key: RECORDED[1].key }], since: sinceOf(RECORDED[1]), now: Date.parse(RECORDED[1].at), actionable: RECORDED[1].actionable });
  assert.deepEqual(state.items, {}, 'two instances in 24 hours stay under the threshold of three');

  // The third crosses it and files the structural item, with the origin the item itself carries.
  cycle(state, { fleet: BASE_FLEET, claimable: [{ key: RECORDED[2].key }], since: sinceOf(RECORDED[2]), now: Date.parse(RECORDED[2].at), actionable: RECORDED[2].actionable });
  const filed = state.items.capacity;
  assert.equal(filed.key, 'GY-38');
  assert.equal(filed.origin.faultClass.count, 3);
  assert.equal(filed.origin.faultClass.threshold, 3);
  assert.equal(filed.origin.faultClass.windowHours, 24);
  assert.equal(filed.origin.faultClass.detectedAt, RECORDED[2].at, 'the filing cycle is the detectedAt the item reports');
  assert.deepEqual(filed.origin.faultClass.instances.map(entry => entry.subject), ['GY-23', 'GY-24', 'GY-34']);
  assert.deepEqual(filed.origin.faultClass.instances.map(entry => entry.id), [
    'concurrency-starved|GY-23|2026-10-17T22:07:01.486Z',
    'concurrency-starved|GY-24|2026-10-17T22:19:12.551Z',
    'concurrency-starved|GY-34|2026-10-18T01:23:50.965Z',
  ]);

  // Every counted instance links to the item that stands for the class.
  assert.deepEqual(state.instances.map(instance => instance.linkedTo), ['GY-38', 'GY-38', 'GY-38']);

  // The fourth instance — the loop kept counting the class past its own filing — links too, and
  // files nothing new.
  cycle(state, { fleet: BASE_FLEET, claimable: [{ key: AFTER_FILING.key }], since: sinceOf(AFTER_FILING), now: Date.parse(AFTER_FILING.at), actionable: AFTER_FILING.actionable });
  assert.equal(state.instances.length, 4, 'one instance per standing subject: the fourth is its own breach');
  assert.equal(state.items.capacity.origin.faultClass.count, 3, 'the linked instance does not grow the filing count');
  assert.equal(state.instances[3].linkedTo, 'GY-38');
  assert.equal(state.instances[3].text, recordedText(AFTER_FILING));
});

// ---------------------------------------------------------------------------
// The candidate condition: the fleet covers the demand.
// ---------------------------------------------------------------------------

test('candidate condition: against the five-profile fleet every recorded scenario dispatches in the same cycle and raises nothing', () => {
  const state = { instances: [], items: {} };
  for (const instance of RECORDED) {
    const { round, attention } = cycle(state, {
      fleet: CANDIDATE_FLEET, claimable: [{ key: instance.key }], since: sinceOf(instance), now: Date.parse(instance.at), actionable: instance.actionable,
    });
    assert.equal(round.fleetHeld, false, 'a free profile is available, so the launch step never stops');
    assert.deepEqual(round.capacityFindings, [], 'no capacity finding is recorded');
    assert.equal(round.launches.length, 1, 'the claimable item starts this cycle, not when a worker finishes');
    assert.match(round.launches[0].profile, new RegExp(`^${INSTALL}-worker-[345]$`), 'it takes one of the profiles the base state lacked');
    assert.deepEqual(attention, [], 'no silence breach, so no attention line and no instance');
  }
  assert.deepEqual(state.instances, []);
  assert.deepEqual(state.items, {}, 'the class never crosses its threshold: the item the base state filed cannot be filed again');
});

test('candidate condition at the recorded peak: three claimable subjects all start in one cycle, on three distinct profiles', () => {
  // The GY-34 instant recorded three actionable subjects; against the recorded base the third
  // starved. Against the candidate fleet the same evening's demand — the three items the daemon
  // held fleet-held within eight minutes of that instant (GY-34, GY-36, GY-35) — all launch now.
  const claimable = [{ key: 'GY-34' }, { key: 'GY-36' }, { key: 'GY-35' }];
  const { round, attention, faults } = cycle({ instances: [], items: {} }, {
    fleet: CANDIDATE_FLEET, claimable, since: sinceOf(RECORDED[2]), now: Date.parse(RECORDED[2].at), actionable: RECORDED_PEAK,
  });
  assert.deepEqual(round.launches.map(launch => launch.item), ['GY-34', 'GY-36', 'GY-35']);
  assert.equal(new Set(round.launches.map(launch => launch.profile)).size, 3, 'each takes its own profile: the round assigns, never queues');
  assert.deepEqual(round.capacityFindings, []);
  assert.deepEqual(attention, []);
  assert.deepEqual(faults.instances, []);
});

test('the class keeps its shape: a peak past the fleet starves again, and a fleet that cannot take work even free is not saturation', () => {
  // Six claimable against five profiles, two of them held by live attempts: three launch on the
  // free profiles, the fourth finds none and is fleet-held, its finding names the whole fleet, and
  // its wait would cross the bound exactly as the recorded ones did. That is the honest boundary
  // of the candidate condition — a future peak past the fleet is a new item, as this item's own
  // description says — never a claim that the class cannot exist.
  const six = ['GY-A', 'GY-B', 'GY-C', 'GY-D', 'GY-E', 'GY-F'].map(key => ({ key }));
  const held = cycle({ instances: [], items: {} }, {
    fleet: CANDIDATE_FLEET, claimable: six, since: sinceOf(RECORDED[2]), now: Date.parse(RECORDED[2].at), actionable: 6,
  });
  assert.deepEqual(held.round.launches.map(launch => launch.item), ['GY-A', 'GY-B', 'GY-C']);
  assert.equal(held.round.fleetHeld, true);
  assert.equal(held.round.capacityFindings[0],
    `Every worker profile is held while GY-D is claimable (${INSTALL}-worker-1, ${INSTALL}-worker-2, ${INSTALL}-worker-3, ${INSTALL}-worker-4, ${INSTALL}-worker-5); GY-D keeps its dispatch order and starts when a slot frees`);
  assert.equal(held.attention[0].text,
    `Nothing has acted on GY-D is claimable but no worker profile is free; it starts when one frees for 21 minutes, past the 20-minute bound, while 6 subject(s) were actionable`);

  // The other arm (cycle-dispatch.ts, the branch saturatedFleet refuses): escalation is for a
  // fleet no profile of could take work even if it were free — every credential spent, every
  // profile cooling off after a failed launch (the live cursor holds exactly that shape for
  // worker-5: "No healthy agent account …: role worker is at its concurrency limit"). No profile
  // is healthy-or-busy, so the fleet is not saturated, no capacity finding is recorded, and no
  // capacity silence subject exists to classify: the wait is a working credential, not a bigger
  // fleet. (The item's own action history shows the master dispatch executor's sibling wording —
  // "no worker profile can take GY-38: … (is working); … (is unknown)" — a different producer.)
  const cooling = (name, reason) => ({ name, mode: 'launch', healthy: false, busy: false, heldByLiveAttempt: false, reason });
  const escalated = cycle({ instances: [], items: {} }, {
    fleet: [cooling(`${INSTALL}-worker-3`, 'cooling off after a failed launch'), cooling(`${INSTALL}-worker-5`, 'No healthy agent account for worker profile cryptob1-graphyard-snake-v4-worker-5: role worker is at its concurrency limit (4 of 4 live)')],
    claimable: [{ key: 'GY-38' }], since: sinceOf(RECORDED[2]), now: Date.parse(RECORDED[2].at), actionable: 1,
  });
  assert.equal(escalated.round.fleetHeld, false);
  assert.equal(escalated.round.escalation,
    `No worker profile can take GY-38: ${INSTALL}-worker-3 (cooling off after a failed launch); ${INSTALL}-worker-5 (No healthy agent account for worker profile cryptob1-graphyard-snake-v4-worker-5: role worker is at its concurrency limit (4 of 4 live))`);
  assert.deepEqual(escalated.attention, [], 'no capacity subject, so the concurrency-starved classifier has nothing to read');
});

// ---------------------------------------------------------------------------
// The audit's own verdict: it fails the recorded base state instead of accepting it, and demands
// the candidate condition itself — the fleet that covers the recorded peak.
// ---------------------------------------------------------------------------

/**
 * Whether a launch fleet carries the candidate condition the class's remedy names: at least as
 * many worker launch profiles as the recorded peak of concurrent claimable demand. The recorded
 * base state (two profiles) is a failure whose own text names the remedy, so the audit's failure
 * message is the demand, not a mystery.
 */
function auditVerdict(workers) {
  const launch = workers.filter(worker => worker.mode === 'launch');
  const failures = [];
  if (launch.length < RECORDED_PEAK) {
    failures.push(`the installation runs ${launch.length} worker launch profile(s) (${launch.map(worker => worker.name).join(', ') || 'none'}), fewer than the recorded peak of ${RECORDED_PEAK} concurrent claimable subjects — the recorded base state, which this audit does not accept as a pass; the remedy is the README "Graphyard worker capacity" procedure (graphyard principal add ${INSTALL}-worker-N --role worker for each principal the roster lacks, the credential copy master environments discovers, then graphyard master environments --apply — scripts/graphyard-executor.mjs --install automates it from the coordinator checkout), which reconciles the host to a fleet that covers the demand`);
  }
  return { pass: failures.length === 0, failures, launch: launch.length };
}

test('unit: the audit fails the two-profile base state, passes the peak-covering fleet', () => {
  const base = auditVerdict(BASE_FLEET);
  assert.equal(base.pass, false, 'the recorded base state is no longer a pass');
  assert.equal(base.failures.length, 1);
  assert.match(base.failures[0], /^the installation runs 2 worker launch profile/);
  assert.match(base.failures[0], /master environments --apply/);

  assert.deepEqual(auditVerdict(CANDIDATE_FLEET), { pass: true, failures: [], launch: 5 });
  assert.deepEqual(auditVerdict(CANDIDATE_FLEET.slice(0, RECORDED_PEAK)), { pass: true, failures: [], launch: RECORDED_PEAK },
    'a fleet at exactly the recorded peak covers it: the third claimable subject starts in the same cycle');
});

// ---------------------------------------------------------------------------
// The live installation, audited only where it exists: on the coordinator host. CI checks out
// this repository on a GitHub runner, which has no access to that host's files or its control
// plane, so the audits skip there (the recorded-state reproductions above still run).
// ---------------------------------------------------------------------------

const COORDINATOR_ROOT = '/home/vish/code/graphyard-snake-v4';
const MASTER_CONFIG = join(COORDINATOR_ROOT, '.graphyard', 'master.json');

test(
  'live audit on the coordinator host: the fleet covers the recorded peak, and every profile it names is real',
  { skip: !existsSync(MASTER_CONFIG) && `not on the coordinator host: ${MASTER_CONFIG} is absent` },
  () => {
    const master = JSON.parse(readFileSync(MASTER_CONFIG, 'utf8'));
    const workers = master.workers ?? [];
    const verdict = auditVerdict(workers);
    assert.ok(verdict.pass, `the capacity class's remedy has not held: ${verdict.failures.join('; ')}`);
    // The launch list is not a declaration only: each profile's credential exists where master
    // environments wrote it, so the fleet the audit counts can actually take work.
    for (const worker of workers.filter(worker => worker.mode === 'launch')) {
      assert.ok(worker.credentialFile && existsSync(worker.credentialFile), `${worker.name} has no credential at ${worker.credentialFile}`);
    }
    // The declaration divergence is the operator's scope decision, named here rather than modelled
    // as done: the repository still declares capacity.workers 2 (the widening rule refused this
    // item graphyard.json twice), and the reconciler never removes a profile, so the host's live
    // count may exceed it by design. This audit demands the live fleet, never the declaration.
    assert.ok(verdict.launch >= RECORDED_PEAK, `the live fleet (${verdict.launch}) covers the recorded peak (${RECORDED_PEAK})`);
  }
);

test(
  'live audit on the coordinator host: the daemon\'s own capacity records show the recorded base state and the remedy landing, and the base state never returns',
  { skip: !existsSync(MASTER_CONFIG) && `not on the coordinator host: ${MASTER_CONFIG} is absent` },
  () => {
    const master = JSON.parse(readFileSync(MASTER_CONFIG, 'utf8'));
    const cursor = join(dirname(master.credentialFile), `${basename(master.credentialFile).replace(/\.token$/, '')}.daemon.json`);
    if (!existsSync(cursor)) return; // the cursor is recreated on restart; nothing retained to audit yet
    const daemon = JSON.parse(readFileSync(cursor, 'utf8'));
    const records = Object.values(daemon.actions ?? {})
      .filter(action => action.kind === 'capacity')
      .sort((a, b) => Date.parse(a.at) - Date.parse(b.at));

    // The recorded base state, in the daemon's own words: fleet-held findings naming exactly the
    // two profiles GY-14 declared — and every such finding predates the remedy, so the base state
    // is gone, not standing beside the grown fleet.
    assert.ok(records.length >= 1, 'the cursor holds the dispatch step\'s capacity findings');
    const names = record => (record.detail.match(/\(([a-z0-9-]+(?:, [a-z0-9-]+)*)\)/)?.[1] ?? '').split(', ').filter(Boolean);
    const base = records.filter(record => names(record).join(',') === `${INSTALL}-worker-1,${INSTALL}-worker-2`);
    assert.ok(base.length >= 1, `at least one finding names the recorded two-profile base state; got: ${records.map(record => record.detail).join(' | ')}`);
    assert.ok(base.every(record => Date.parse(record.at) < Date.parse(FLEET_COVERED_PEAK_AT)), 'every two-profile finding predates the remedy');

    // The remedy landing, in the same records: findings naming a fleet of three or more — the
    // 01:58:32.270Z finding on GY-22 names three (worker-3's credential landed 01:58:27Z), and
    // later ones name more as the list grew to five. A finding is the loop declining to launch
    // into a fleet whose every profile is held — the mechanism, not the fault; the instance audit
    // below watches the fault. What this audit refuses is the base state returning: no finding
    // written after the five-profile list landed names a fleet smaller than the recorded peak.
    const grown = records.filter(record => names(record).length >= RECORDED_PEAK);
    assert.ok(grown.length >= 1, 'at least one finding names the grown fleet');
    for (const record of records.filter(record => Date.parse(record.at) > Date.parse(FLEET_COVERED_PEAK_AT))) {
      assert.ok(names(record).length >= RECORDED_PEAK,
        `the ${record.at} finding names a fleet smaller than the recorded peak — the base state is back: ${record.detail}; the remedy is the README "Graphyard worker capacity" procedure`);
    }
  }
);

test(
  'live audit on the coordinator host: every concurrency-starved instance links to the standing item, and none opened after the remedy',
  { skip: !existsSync(MASTER_CONFIG) && `not on the coordinator host: ${MASTER_CONFIG} is absent` },
  () => {
    const master = JSON.parse(readFileSync(MASTER_CONFIG, 'utf8'));
    const cursor = join(dirname(master.credentialFile), `${basename(master.credentialFile).replace(/\.token$/, '')}.daemon.json`);
    if (!existsSync(cursor)) return; // the cursor is recreated on restart; nothing retained to audit yet
    const daemon = JSON.parse(readFileSync(cursor, 'utf8'));
    const instances = (daemon.faults?.instances ?? []).filter(instance => instance.kind === 'concurrency-starved');

    // The recorded instances themselves, in the cursor the loop keeps: three before the filing and
    // the linked fourth after it.
    assert.ok(instances.length >= RECORDED.length, 'the cursor holds the recorded instances of the class');
    for (const instance of instances) {
      assert.ok(instance.linkedTo, `the ${instance.at} instance on ${instance.subject} links to the item that stands for the class`);
      assert.equal(instance.faultClass, 'capacity');
    }
    const after = instances.filter(instance => Date.parse(instance.at) > Date.parse(RECORDED[2].at));
    assert.ok(after.length >= 1, 'the loop kept counting the class past the filing, linking instead of re-filing');

    // The candidate condition, on the live record: no instance of the class has opened since the
    // fleet covered the peak. One that did means the demand outgrew the fleet again — a new item
    // by the class's own design, visible here rather than silently passed.
    const sinceRemedy = instances.filter(instance => Date.parse(instance.at) > Date.parse(FLEET_COVERED_PEAK_AT));
    assert.ok(sinceRemedy.length === 0,
      `instances opened after ${FLEET_COVERED_PEAK_AT}: ${sinceRemedy.map(instance => `${instance.subject} at ${instance.at}`).join(', ')} — the demand outgrew the live fleet, which files a new item; the graphyard.json declaration (still 2) is the operator's scope decision`);
  }
);
