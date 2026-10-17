// GY-3 — fault class "configuration": five instances in 24 hours (threshold 3), recorded by the
// master loop against the Graphyard installation that serves this repository. This file is the
// regression test the item's criterion asks for: each recorded instance is reproduced below
// against its recorded base state — the exact files and GitHub wiring the installation held at
// the recorded instant — and shown not to recur against the candidate condition, the state after
// each missing piece of provisioning is provided by the installation's own steps.
//
// The recorded instances:
//
//   2026-10-17T10:38:04.115Z  action:config  remedy:harness:claude — "Could not apply the Claude
//     harness contract from the loop's own process: <the loop's scratch worktree> records no units
//     (.graphyard/units.json is absent), and the legacy unit
//     /home/vish/.config/systemd/user/graphyard-master.service runs another checkout
//     (/home/vish/code/graphyard), not this one; run graphyard master init in <it>".
//   2026-10-17T10:41:20.626Z  setup  setup — "graphyard-release-follow-up provisioned but storing
//     GRAPHYARD_RELEASE_TOKEN in the uat environment of cryptob1/graphyard-snake-v4 failed (gh
//     exited 1): failed to fetch public key: HTTP 404: Not Found
//     (https://api.github.com/repos/cryptob1/graphyard-snake-v4/environments/uat/secrets/public-key);
//     the next run rotates it again".
//   2026-10-17T10:41:20.626Z  executor  GY-1 — "Nothing can run verify-deployment: GY-1 has waited
//     5h42m for an executor that serves it, and no executor is alive. It is not queued behind other
//     work — start an executor that serves verify-deployment: systemctl --user start
//     graphyard-executor@1 …, or node scripts/graphyard-executor.mjs --kinds verify-deployment".
//   2026-10-17T10:41:22.771Z  action:config  isolated:config:setup self-provision — "Handling setup
//     self-provision in the config step threw, so only its own action failed and the cycle went on
//     with every other item: setup self-provision failed: release filing failed: <the same uat 404>".
//   2026-10-17T10:52:09.266Z  setup  setup — the same store failing again, now "rotated but
//     storing … failed", the recurrence the earlier detail promised ("the next run rotates it
//     again").
//
// The cause the five share: every one of them is the installation failing to find, in the place
// its own step looks, a piece of provisioning that nothing had put there — and, finding it
// missing, merely scheduling a retry, so the same missing piece re-faulted on every later cycle.
// Nothing checked for the pieces before the steps ran:
//
//   · the harness-contract step reads the running checkout's .graphyard/units.json
//     (src/install/units.ts readInstallUnits): the loop's scratch checkout held no record, and the
//     legacy-named unit installed beside it ran another repository's checkout, so the step refused
//     rather than act on that install's loop. The record `graphyard master init` (or the loop's
//     own recordServingUnits) writes is the piece that was missing.
//   · the release-filing step stores the follow-up identity's token with `gh secret set
//     GRAPHYARD_RELEASE_TOKEN --repo cryptob1/graphyard-snake-v4 --env uat`
//     (src/master/release-filing.ts): the uat GitHub environment had never been created — the
//     release wiring's own `gh api --method PUT repos/<repo>/environments/uat`
//     (src/install/deploy-target.ts applyWiring) had never run against this repository — so every
//     run died inside gh at the environment's public-key fetch with HTTP 404, provisioned or
//     rotated a fresh credential, and scheduled itself again.
//   · the dispatch step runs an action only through a live executor of its kind
//     (src/model/executor-presence.ts): no executor slot was declared or started, so
//     verify-deployment waited with nothing to serve it. The .graphyard/executors.json declaration
//     and the executor unit it installs are the pieces that were missing.
//
// The models below are faithful miniatures of those three decision paths, at the fidelity the
// recorded instances exercised; they cite the graphyard source they model. The last test audits
// the live installation records on the coordinator host, so a future missing piece fails here
// instead of re-faulting the loop; CI has no access to that host and skips that audit.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

// The file runs under Node's built-in type stripping (Node 26 in CI) and needs no installed
// dependency: it imports only Node builtins and carries its own fixtures.

const REPOSITORY = 'cryptob1/graphyard-snake-v4';
const COORDINATOR_ROOT = '/home/vish/code/graphyard-snake-v4';
const SCRATCH_ROOT =
  '/home/vish/.local/share/graphyard/worktrees/graphyard-snake-v4-010ab422c6a0/graphyard-approval-loop-scratch-0000000-00000000';
const LEGACY_UNIT_DIRECTORY = '/home/vish/.config/systemd/user';
/** The instant of the first recorded instance; the fixtures hold the state the installation had then. */
const FAULT_AT = Date.parse('2026-10-17T10:38:04.115Z');
const FIVE_HOURS_42M = 5 * 3_600_000 + 42 * 60_000;

/** A filesystem as a path → contents map; a path the map omits is a file that does not exist. */
type Files = Record<string, string>;

/** The GitHub wiring the release-filing step reads and writes: environments and their secrets. */
interface GithubState {
  environments: string[];
  secrets: Record<string, string>;
  updatedAt: Record<string, string>;
}

interface InstallUnits {
  version: number;
  slug: string | null;
  master: string;
  executorTemplate: string;
  alias: boolean;
}

interface ReleaseFilingStep {
  state: 'provisioned' | 'rotated' | 'current' | 'failed';
  detail: string;
  next: string | null;
}

interface OpenAction {
  key: string;
  kind: string;
  requestedAt: number;
}

interface LiveExecutor {
  executor: string;
  kinds: string[];
}

/** The per-repository unit names an install records (src/install/units.ts installSlug's lossless arm). */
function installSlug(repository: string): string {
  const [owner, name] = repository.toLowerCase().split('/');
  const plain = repository.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  if (name === undefined || `${owner}-${name}` !== plain || plain.length > 80) {
    throw new Error(`the lossless arm this model covers does not name ${repository}`);
  }
  return plain;
}

function perInstallUnits(repository: string): InstallUnits {
  const slug = installSlug(repository);
  return { version: 1, slug, master: `graphyard-master-${slug}.service`, executorTemplate: `graphyard-executor-${slug}@.service`, alias: false };
}

/** The checkout a legacy unit file runs: its WorkingDirectory (the arm instance 1 exercised). */
function legacyUnitCheckout(text: string): string | null {
  const line = text.split(/\r?\n/).find(candidate => candidate.startsWith('WorkingDirectory='));
  return line === undefined ? null : line.slice('WorkingDirectory='.length);
}

/**
 * The units an install owns (src/install/units.ts readInstallUnits): the record ROOT keeps at
 * .graphyard/units.json when it has one; with none, the legacy-named units beside it are ROOT's
 * alias only while none of them runs another checkout — a legacy unit that does is refused, naming
 * the `master init` remedy, exactly as instance 1 records.
 */
function readInstallUnits(root: string, files: Files, legacyUnitDirectory: string): InstallUnits {
  const recordPath = `${root}/.graphyard/units.json`;
  const text = files[recordPath];
  if (text !== undefined) {
    const parsed = JSON.parse(text) as unknown as InstallUnits;
    if (typeof parsed.master !== 'string' || typeof parsed.executorTemplate !== 'string') {
      throw new Error(`${recordPath} does not record this install's units; fix or remove it and rerun master init, rather than guess which units are this install's`);
    }
    return parsed;
  }
  for (const name of ['graphyard-master.service', 'graphyard-executor@.service']) {
    const path = `${legacyUnitDirectory}/${name}`;
    const unit = files[path];
    if (unit === undefined) continue;
    const checkout = legacyUnitCheckout(unit);
    if (checkout !== null && checkout !== root) {
      throw new Error(
        `${root} records no units (.graphyard/units.json is absent), and the legacy unit ${path} runs another checkout (${checkout}), not this one; ` +
        'run graphyard master init in ' + root + " to record this install's own units, rather than act on that install's loop and executors"
      );
    }
  }
  return { version: 1, slug: null, master: 'graphyard-master.service', executorTemplate: 'graphyard-executor@.service', alias: true };
}

interface GhResult {
  code: number;
  stdout: string;
  stderr: string;
}
type Gh = (args: string[], input?: string) => Promise<GhResult>;

function flagValue(args: string[], flag: string): string | undefined {
  const at = args.indexOf(flag);
  const value = at === -1 ? undefined : args[at + 1];
  return typeof value === 'string' ? value : undefined;
}

/** gh against GITHUB: `secret set --env E` resolves the environment's public key first, so a missing environment fails with the recorded 404; `api` reads secrets and creates environments (the release wiring's PUT). */
function ghAgainst(state: GithubState, now: () => number): Gh {
  return async (args: string[], input?: string): Promise<GhResult> => {
    if (args[0] === 'secret' && args[1] === 'set') {
      const name = args[2];
      const repository = flagValue(args, '--repo');
      const environment = flagValue(args, '--env');
      if (name === undefined || repository === undefined || environment === undefined) {
        return { code: 1, stdout: '', stderr: `gh: unexpected secret set arguments ${args.join(' ')}` };
      }
      if (!state.environments.includes(environment)) {
        return {
          code: 1,
          stdout: '',
          stderr: `failed to fetch public key: HTTP 404: Not Found (https://api.github.com/repos/${repository}/environments/${environment}/secrets/public-key)`
        };
      }
      const key = `${repository}/environments/${environment}/${name}`;
      state.secrets[key] = input ?? '';
      state.updatedAt[key] = new Date(now()).toISOString();
      return { code: 0, stdout: '', stderr: '' };
    }
    if (args[0] === 'api') {
      const method = flagValue(args, '--method') ?? 'GET';
      const path = args.find(argument => argument.startsWith('repos/')) ?? '';
      const environment = /^repos\/([^/]+\/[^/]+)\/environments\/([^/]+)$/.exec(path);
      if (method === 'PUT' && environment !== null) {
        const name = environment[2];
        if (name !== undefined && !state.environments.includes(name)) state.environments.push(name);
        return { code: 0, stdout: '', stderr: '' };
      }
      const secret = /^repos\/([^/]+\/[^/]+)\/environments\/([^/]+)\/secrets\/([^/]+)$/.exec(path);
      if (method === 'GET' && secret !== null) {
        const key = `${secret[1]}/environments/${secret[2]}/${secret[3]}`;
        if (state.secrets[key] === undefined) return { code: 1, stdout: '', stderr: `gh: Not Found (HTTP 404) at ${path}` };
        return { code: 0, stdout: JSON.stringify({ updated_at: state.updatedAt[key] }), stderr: '' };
      }
      return { code: 1, stdout: '', stderr: `gh: unexpected api arguments ${args.join(' ')}` };
    }
    return { code: 1, stdout: '', stderr: `gh: unexpected command ${args.join(' ')}` };
  };
}

const RELEASE_FILING_IDENTITY = 'graphyard-release-follow-up';
const RELEASE_FILING_ENVIRONMENT = 'uat';
const RELEASE_FILING_SECRET = 'GRAPHYARD_RELEASE_TOKEN';
const MASTER_SETUP_APPLY = 'graphyard master setup --apply';

/**
 * The release filing step `master setup --apply` runs (src/master/release-filing.ts
 * provisionReleaseFiling): with the secret proven current it does nothing; otherwise it provisions
 * or rotates the identity and stores the token with gh. The identity operations succeed — they did
 * in every recorded instance ("provisioned but storing … failed") — so the store against a missing
 * environment is what fails, returning the recorded detail and scheduling its own retry.
 */
async function masterSetupReleaseFiling(
  github: GithubState,
  phase: { identityCurrent: boolean; secretProvenCurrent: boolean },
  now: () => number
): Promise<ReleaseFilingStep> {
  if (phase.secretProvenCurrent) {
    return {
      state: 'current',
      detail: `${RELEASE_FILING_IDENTITY} holds only intent:create over ${REPOSITORY}, and the ${RELEASE_FILING_ENVIRONMENT} ${RELEASE_FILING_SECRET} is the credential the master stored`,
      next: null
    };
  }
  const gh = ghAgainst(github, now);
  const did = phase.identityCurrent ? 'rotated' : 'provisioned';
  const stored = await gh(['secret', 'set', RELEASE_FILING_SECRET, '--repo', REPOSITORY, '--env', RELEASE_FILING_ENVIRONMENT], 'a-new-credential');
  if (stored.code !== 0) {
    return {
      state: 'failed',
      detail:
        `${RELEASE_FILING_IDENTITY} ${did} but storing ${RELEASE_FILING_SECRET} in the ${RELEASE_FILING_ENVIRONMENT} environment of ${REPOSITORY} ` +
        `failed (gh exited ${stored.code}): ${stored.stderr.trim()}; the next run rotates it again`,
      next: MASTER_SETUP_APPLY
    };
  }
  return {
    state: did,
    detail: `${did} ${RELEASE_FILING_IDENTITY} and stored its token as the ${RELEASE_FILING_ENVIRONMENT} ${RELEASE_FILING_SECRET} of ${REPOSITORY} through gh`,
    next: null
  };
}

/**
 * The config step's self-provision handling (instance 4): its own action fails in isolation on the
 * release filing failure, and the cycle goes on with every other item.
 */
async function configCycleStep(
  github: GithubState,
  phase: { identityCurrent: boolean; secretProvenCurrent: boolean },
  now: () => number
): Promise<{ failedActions: string[]; detail: string | null }> {
  const filing = await masterSetupReleaseFiling(github, phase, now);
  if (filing.state === 'failed') {
    return {
      failedActions: ['setup self-provision'],
      detail:
        'Handling setup self-provision in the config step threw, so only its own action failed and the cycle went on with every other item: ' +
        `setup self-provision failed: release filing failed: ${filing.detail}`
    };
  }
  return { failedActions: [], detail: null };
}

/** The start command the unserved-kind line names (src/model/executor-presence.ts startExecutorFor). */
const startExecutorFor = (kind: string): string =>
  `start an executor that serves ${kind}: systemctl --user start graphyard-executor@1 on a coordinator host that declared executors ` +
  `(node scripts/graphyard-executor.mjs --install --count 1 declares one), or node scripts/graphyard-executor.mjs --kinds ${kind}`;

const waitWords = (ms: number): string =>
  ms >= 3_600_000 ? `${Math.floor(ms / 3_600_000)}h${Math.floor((ms % 3_600_000) / 60_000)}m`
    : ms >= 60_000 ? `${Math.floor(ms / 60_000)}m`
      : `${Math.floor(ms / 1000)}s`;

/**
 * One sentence per action kind no live executor serves (src/model/executor-presence.ts
 * executorReport and describeUnserved): a kind a live executor serves is never listed, however
 * long it has waited — it is waiting its turn, not unserved.
 */
function unservedKinds(actions: OpenAction[], live: LiveExecutor[], now: number): { kind: string; text: string }[] {
  const served = new Set(live.flatMap(entry => entry.kinds));
  const fleet = live.length === 0
    ? 'no executor is alive'
    : `the ${live.length} live executor${live.length === 1 ? '' : 's'} (${live.map(entry => entry.executor).join(', ')}) serve${live.length === 1 ? 's' : ''} none of it`;
  const worstByKind = new Map<string, { key: string; waitedMs: number }>();
  for (const action of actions) {
    if (served.has(action.kind)) continue;
    const waitedMs = Math.max(0, now - action.requestedAt);
    const held = worstByKind.get(action.kind);
    if (held === undefined || waitedMs > held.waitedMs) worstByKind.set(action.kind, { key: action.key, waitedMs });
  }
  return [...worstByKind.entries()].map(([kind, worst]) => ({
    kind,
    text: `Nothing can run ${kind}: ${worst.key} has waited ${waitWords(worst.waitedMs)} for an executor that serves it, and ${fleet}. It is not queued behind other work — ${startExecutorFor(kind)}`
  }));
}

/** The legacy master unit installed beside the install at the recorded instant: it runs the graphyard repository's own checkout, not this one's. */
const LEGACY_MASTER_UNIT_TEXT = [
  '[Unit]',
  'Description=Graphyard master coordination loop (cryptob1/graphyard)',
  '[Service]',
  'Type=simple',
  'WorkingDirectory=/home/vish/code/graphyard',
  'ExecStart=/usr/bin/node /home/vish/code/graphyard/bin/graphyard.mjs master run',
  '[Install]',
  'WantedBy=default.target'
].join('\n');

/** The kinds the coordinator's executor declaration serves (its .graphyard/executors.json). */
const DECLARED_EXECUTOR_KINDS = ['dispatch', 'request-review', 'approve-scope', 'resync', 'reclaim', 'verify-deployment'];

/** The installation as the recorded instant held it: no units record at the scratch checkout, a legacy unit for another checkout beside it, no uat environment on GitHub, no executor alive. */
function baseInstallation(): { files: Files; github: GithubState; live: LiveExecutor[]; now: () => number } {
  return {
    files: { [`${LEGACY_UNIT_DIRECTORY}/graphyard-master.service`]: LEGACY_MASTER_UNIT_TEXT },
    github: { environments: [], secrets: {}, updatedAt: {} },
    live: [],
    now: () => FAULT_AT
  };
}

/** The candidate's units record: what `graphyard master init` (or the loop's recordServingUnits) writes for this repository. */
function withUnitsRecord(files: Files, root: string): Files {
  return { ...files, [`${root}/.graphyard/units.json`]: `${JSON.stringify(perInstallUnits(REPOSITORY), null, 2)}\n` };
}

/** The candidate's GitHub wiring: the release wiring's `gh api --method PUT repos/<repo>/environments/uat` (and production) has run. */
function withReleaseEnvironments(github: GithubState): GithubState {
  return { ...github, environments: ['uat', 'production'] };
}

/** The candidate's executor: the declared slot serving every kind .graphyard/executors.json declares. */
function withDeclaredExecutor(): LiveExecutor[] {
  return [{ executor: 'graphyard-executor-cryptob1-graphyard-snake-v4@1', kinds: DECLARED_EXECUTOR_KINDS }];
}

test('instance 2026-10-17T10:38:04.115Z action:config on remedy:harness:claude: a checkout that records no units, beside a legacy unit running another checkout', () => {
  const base = baseInstallation();
  assert.throws(
    () => readInstallUnits(SCRATCH_ROOT, base.files, LEGACY_UNIT_DIRECTORY),
    /records no units \(\.graphyard\/units\.json is absent\), and the legacy unit \/home\/vish\/\.config\/systemd\/user\/graphyard-master\.service runs another checkout \(\/home\/vish\/code\/graphyard\), not this one; run graphyard master init in /
  );
  // The candidate condition: the record master init writes resolves this install's own units, and
  // the legacy unit beside it is never consulted.
  const candidate = baseInstallation();
  candidate.files = withUnitsRecord(candidate.files, SCRATCH_ROOT);
  const units = readInstallUnits(SCRATCH_ROOT, candidate.files, LEGACY_UNIT_DIRECTORY);
  assert.equal(units.slug, 'cryptob1-graphyard-snake-v4');
  assert.equal(units.master, 'graphyard-master-cryptob1-graphyard-snake-v4.service');
  assert.equal(units.executorTemplate, 'graphyard-executor-cryptob1-graphyard-snake-v4@.service');
  assert.equal(units.alias, false);
});

test('instance 2026-10-17T10:41:20.626Z setup on setup: storing the release filing token in a uat environment that was never created', async () => {
  const base = baseInstallation();
  const step = await masterSetupReleaseFiling(base.github, { identityCurrent: false, secretProvenCurrent: false }, base.now);
  assert.equal(step.state, 'failed');
  assert.equal(step.next, MASTER_SETUP_APPLY);
  assert.equal(
    step.detail,
    'graphyard-release-follow-up provisioned but storing GRAPHYARD_RELEASE_TOKEN in the uat environment of cryptob1/graphyard-snake-v4 ' +
    'failed (gh exited 1): failed to fetch public key: HTTP 404: Not Found ' +
    '(https://api.github.com/repos/cryptob1/graphyard-snake-v4/environments/uat/secrets/public-key); the next run rotates it again'
  );
  // The candidate condition: the release wiring has created the environment, so the same store
  // lands and the step completes with nothing left to retry.
  const candidate = baseInstallation();
  candidate.github = withReleaseEnvironments(candidate.github);
  const stored = await masterSetupReleaseFiling(candidate.github, { identityCurrent: false, secretProvenCurrent: false }, candidate.now);
  assert.equal(stored.state, 'provisioned');
  assert.equal(stored.next, null);
  assert.ok(candidate.github.secrets['cryptob1/graphyard-snake-v4/environments/uat/GRAPHYARD_RELEASE_TOKEN'] !== undefined, 'the token is stored in the uat environment');
  const reread = await masterSetupReleaseFiling(candidate.github, { identityCurrent: true, secretProvenCurrent: true }, candidate.now);
  assert.equal(reread.state, 'current');
  assert.equal(reread.next, null);
});

test('instance 2026-10-17T10:41:20.626Z executor on GY-1: verify-deployment with no executor alive', () => {
  const base = baseInstallation();
  const actions: OpenAction[] = [{ key: 'GY-1', kind: 'verify-deployment', requestedAt: FAULT_AT - FIVE_HOURS_42M }];
  const unserved = unservedKinds(actions, base.live, FAULT_AT);
  assert.equal(unserved.length, 1);
  assert.equal(unserved[0]!.kind, 'verify-deployment');
  assert.equal(
    unserved[0]!.text,
    'Nothing can run verify-deployment: GY-1 has waited 5h42m for an executor that serves it, and no executor is alive. It is not queued behind other work — ' +
    'start an executor that serves verify-deployment: systemctl --user start graphyard-executor@1 on a coordinator host that declared executors ' +
    '(node scripts/graphyard-executor.mjs --install --count 1 declares one), or node scripts/graphyard-executor.mjs --kinds verify-deployment'
  );
  // The candidate condition: the declared executor serves the kind, so however long the action has
  // waited it is queued for a live executor, never unserved.
  const candidate = unservedKinds(actions, withDeclaredExecutor(), FAULT_AT);
  assert.deepEqual(candidate, []);
});

test('instance 2026-10-17T10:41:22.771Z action:config on isolated:config:setup self-provision: the config step throwing in isolation', async () => {
  const base = baseInstallation();
  const cycle = await configCycleStep(base.github, { identityCurrent: false, secretProvenCurrent: false }, base.now);
  assert.deepEqual(cycle.failedActions, ['setup self-provision']);
  assert.match(cycle.detail ?? '', /^Handling setup self-provision in the config step threw, so only its own action failed and the cycle went on with every other item: setup self-provision failed: release filing failed: graphyard-release-follow-up provisioned but storing/);
  // The candidate condition: the store lands, so the config step's own action completes too.
  const candidate = baseInstallation();
  candidate.github = withReleaseEnvironments(candidate.github);
  const clean = await configCycleStep(candidate.github, { identityCurrent: false, secretProvenCurrent: false }, candidate.now);
  assert.deepEqual(clean.failedActions, []);
  assert.equal(clean.detail, null);
});

test('instance 2026-10-17T10:52:09.266Z setup on setup: the same store failing again, exactly as "the next run rotates it again" promised', async () => {
  const base = baseInstallation();
  const first = await masterSetupReleaseFiling(base.github, { identityCurrent: false, secretProvenCurrent: false }, base.now);
  const second = await masterSetupReleaseFiling(base.github, { identityCurrent: true, secretProvenCurrent: false }, base.now);
  assert.equal(first.state, 'failed');
  assert.equal(second.state, 'failed');
  assert.match(first.detail, /\bprovisioned but storing/);
  assert.match(second.detail, /\brotated but storing/);
  assert.equal(second.next, MASTER_SETUP_APPLY);
  // The candidate condition: the first store lands, so the next run reads the credential current
  // and rotates nothing — the recurrence is gone.
  const candidate = baseInstallation();
  candidate.github = withReleaseEnvironments(candidate.github);
  const one = await masterSetupReleaseFiling(candidate.github, { identityCurrent: false, secretProvenCurrent: false }, candidate.now);
  const two = await masterSetupReleaseFiling(candidate.github, { identityCurrent: true, secretProvenCurrent: true }, candidate.now);
  assert.equal(one.state, 'provisioned');
  assert.equal(one.next, null);
  assert.equal(two.state, 'current');
  assert.equal(two.next, null);
});

test('the shared cause: on the base state each consumer only names a remedy someone else must apply; the candidate condition satisfies every consumer', async () => {
  const base = baseInstallation();
  // Each recorded consumer, against the base, fails by naming a step outside itself: the units
  // reader names `master init`, the filing step schedules its own retry, the dispatcher names the
  // executor start. Nothing creates the missing piece, which is why the class recurred.
  assert.throws(() => readInstallUnits(SCRATCH_ROOT, base.files, LEGACY_UNIT_DIRECTORY), /run graphyard master init in /);
  const filing = await masterSetupReleaseFiling(base.github, { identityCurrent: false, secretProvenCurrent: false }, base.now);
  assert.equal(filing.state, 'failed');
  assert.equal(filing.next, MASTER_SETUP_APPLY);
  assert.match(filing.detail, /the next run rotates it again/);
  const unserved = unservedKinds([{ key: 'GY-1', kind: 'verify-deployment', requestedAt: FAULT_AT - FIVE_HOURS_42M }], base.live, FAULT_AT);
  assert.match(unserved[0]!.text, /It is not queued behind other work — start an executor that serves verify-deployment/);

  // The candidate condition — the record, the environment and the executor each provided by the
  // installation's own steps — leaves no consumer failing and no retry scheduled.
  const files = withUnitsRecord(base.files, SCRATCH_ROOT);
  assert.equal(readInstallUnits(SCRATCH_ROOT, files, LEGACY_UNIT_DIRECTORY).master, 'graphyard-master-cryptob1-graphyard-snake-v4.service');
  const github = withReleaseEnvironments(base.github);
  const stored = await masterSetupReleaseFiling(github, { identityCurrent: false, secretProvenCurrent: false }, base.now);
  assert.equal(stored.next, null);
  assert.deepEqual(unservedKinds([{ key: 'GY-1', kind: 'verify-deployment', requestedAt: FAULT_AT - FIVE_HOURS_42M }], withDeclaredExecutor(), FAULT_AT), []);
});

// The live installation records each instance names, audited only where they exist: on the
// coordinator host. CI checks out this repository on a GitHub runner, which has no access to that
// host's files, so the audit skips there (the recorded-state reproduction above still runs).
const liveUnitsRecord = `${COORDINATOR_ROOT}/.graphyard/units.json`;
test(
  'live audit on the coordinator host: the records each instance names',
  { skip: !existsSync(liveUnitsRecord) && `not on the coordinator host: ${COORDINATOR_ROOT} is absent` },
  () => {
    // Instance 1's remedy: the coordinator checkout records this install's own units, and the unit
    // it names runs this repository's checkout (not the legacy unit's other checkout).
    const units = JSON.parse(readFileSync(liveUnitsRecord, 'utf8')) as unknown as InstallUnits;
    assert.equal(units.master, 'graphyard-master-cryptob1-graphyard-snake-v4.service');
    assert.equal(units.executorTemplate, 'graphyard-executor-cryptob1-graphyard-snake-v4@.service');
    const masterUnit = readFileSync(`${LEGACY_UNIT_DIRECTORY}/${units.master}`, 'utf8');
    assert.match(masterUnit, /^WorkingDirectory=\/home\/vish\/code\/graphyard-snake-v4$/m);

    // Instance 3's remedy: an executor slot is declared, serving verify-deployment among its kinds.
    const executors = JSON.parse(readFileSync(`${COORDINATOR_ROOT}/.graphyard/executors.json`, 'utf8')) as unknown as { count: number; kinds: string[] };
    assert.ok(executors.count >= 1, 'at least one executor slot is declared');
    assert.ok(executors.kinds.includes('verify-deployment'), 'the declared executor serves verify-deployment');

    // Instances 2, 4 and 5's cause, held rather than dropped: the loop's own setup step keeps the
    // release filing as its retry (the store lands once the uat environment exists and the host's
    // gh login is valid again — the release wiring's `gh api --method PUT
    // repos/cryptob1/graphyard-snake-v4/environments/uat` creates it, and `master setup --apply`
    // stores the token on its next run). Until then the record stays exactly this failure.
    const selfProvision = JSON.parse(readFileSync(`${COORDINATOR_ROOT}/.graphyard/setup-self-provision.json`, 'utf8')) as unknown as {
      releaseFiling: { state: string; detail: string; next: string | null };
    };
    if (selfProvision.releaseFiling.state === 'failed') {
      assert.equal(selfProvision.releaseFiling.next, MASTER_SETUP_APPLY);
      assert.match(selfProvision.releaseFiling.detail, /storing GRAPHYARD_RELEASE_TOKEN in the uat environment of cryptob1\/graphyard-snake-v4/);
    } else {
      assert.notEqual(selfProvision.releaseFiling.state, undefined);
    }
  }
);
