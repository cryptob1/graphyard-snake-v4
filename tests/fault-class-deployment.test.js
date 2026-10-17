// GY-11 — fault class "deployment": three instances in 24 hours (threshold 3), recorded by the
// master loop against the Graphyard installation that serves this repository. This file is the
// regression test the item's criterion asks for: each recorded instance is reproduced below
// against its recorded base state — the exact master configuration, repository wiring and GitHub
// records the installation held at the recorded instant — and shown not to recur against the
// candidate condition, the state after the deploy-verification wiring is connected by the
// installation's own steps.
//
// The recorded instances (verbatim from the item):
//
//   2026-10-17T10:41:20.626Z  throughput  throughput — "GY-87's throughput claim is unverified
//     against the deployed release: no post-deploy measurement has ever been recorded under
//     .graphyard/measurements/throughput, so the claim (Stateless executors drive routine
//     deliveries with no master session running: first-submit-to-merge p50 at most 30 minutes,
//     and no item idle but actionable for longer than 5 minutes.) is delivered but unproven; the
//     loop records one after it next verifies a deployment. No open item owns the verification
//     yet (the loop files on…" — the full attention line is asserted below, exactly.
//   2026-10-17T10:41:21.877Z  action:deployment  deployment:42af9a8f3b78747ae505483d5c198fbe372464dd
//     — "Deployment SHA is unverified: No deployment endpoint is configured and the repository
//     records no GitHub deployment to the production environment"
//   2026-10-17T18:12:43.571Z  action:deployment  deployment:5d09dbe57dc0cf5c95cd57e5cc23d1c8e45d5d04
//     — the same text again, seven hours later.
//
// The cause the three share: the loop's deployment step verifies what production serves either
// from a configured deployment endpoint (run.deploymentUrl) or from the provider's own records —
// the GitHub deployments of the configured production environment (graphyard src/daemon/
// deployment.ts observeDeployment). The environment name it reads is run.productionEnvironment,
// else GRAPHYARD_PRODUCTION_ENVIRONMENT, else 'github-pages' when the repository carries
// .github/workflows/pages-deploy.yml, else 'production' (deploymentEnvironmentName;
// flow-analytics.ts defaultProductionEnvironment). At both recorded instants none of those named
// an environment anything wrote:
//
//   · no deployment endpoint was configured (this repository's graphyard.json records
//     deploy.production null, and the master's run config held no deploymentUrl);
//   · the master's run config held no productionEnvironment — the recorded reason names
//     "the production environment", which is the default the name resolution falls back to, so
//     at the recorded instants the setting was absent and the loop read 'production';
//   · the loop's environment held no GRAPHYARD_PRODUCTION_ENVIRONMENT (a set one would have put
//     its own value in the recorded reason), and the repository carries no pages-deploy.yml (its
//     delivery workflow is graphyard-delivery.yml), so the 'github-pages' shortcut never applied;
//   · and the repository had no deploy path that records a GitHub deployment at all: its Pages
//     site was published by pushing a gh-pages branch (GY-10, merged 18:38Z — after the second
//     instant), and a branch push records no deployment. Only the official Pages actions (GY-16,
//     merged 19:33Z: actions/upload-pages-artifact + actions/deploy-pages) record each deploy of
//     main as a GitHub deployment in the 'github-pages' environment.
//
// So the 'production' listing was empty at every cycle, every observation returned the same
// unavailable reason, and the class re-faulted past its threshold. The throughput instance is the
// same missing wiring one step downstream: the loop takes its post-deploy measurement of GY-87's
// claim only after a verified deployment (src/daemon/cycle-delivery.ts: "if (measure && verified
// && verified.source !== 'unavailable' && verified.sha)"), so while no deployment was ever
// verified no measurement was ever recorded, and throughputClaimVisibility (src/throughput.ts)
// said so with the recorded line, cycle after cycle.
//
// The candidate condition, each piece an installation step provides:
//
//   · the repository publishes with the official Pages actions (merged as GY-16), which record
//     each deploy of main in the 'github-pages' environment with a success status — this
//     repository's own half, asserted below from the workflow itself;
//   · the master's run config names that environment: `graphyard master config
//     productionEnvironment=github-pages`, recorded in the coordinator checkout's
//     .graphyard/master.json (live: run.productionEnvironment = "github-pages").
//
// With both, the observation reads the github-pages listing, takes the newest successful main
// deployment as the release, and verifies every delivered merge by ancestry — the loop's own rows
// show it: cycle 17946 at 2026-10-17T20:50:57.369Z recorded "Deployed SHA d6513a73da39 from
// github-deployment; verified 9 delivered item(s), 0 not yet serving, from 2 GitHub request(s)",
// and the throughput ask in the same cycle (20:50:57.397Z) — the gate the recorded throughput
// instance stood behind now opens every cycle.
//
// The models below are faithful miniatures of those decision paths, at the fidelity the recorded
// instances exercised; they cite the graphyard source they model, and refuse (rather than guess)
// on arms the instances never touched. The last two tests audit what is checkable without that
// host: the repository's own wiring, always; the live installation records on the coordinator
// host, so a future drift of the wiring fails here instead of re-faulting the loop. CI checks out
// this repository on a GitHub runner, which has no access to that host, and skips that audit.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// The file needs no installed dependency: it imports only Node builtins and carries its own
// fixtures. It runs under the same `node --test tests/` the delivery workflow runs.

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const REPOSITORY = 'cryptob1/graphyard-snake-v4';
const COORDINATOR_ROOT = '/home/vish/code/graphyard-snake-v4';
const MASTER_CONFIG = join(COORDINATOR_ROOT, '.graphyard', 'master.json');

const INSTANCE_1_AT = '2026-10-17T10:41:21.877Z';
const INSTANCE_2_AT = '2026-10-17T10:41:20.626Z';
const INSTANCE_3_AT = '2026-10-17T18:12:43.571Z';

// The base branch's own history at the fidelity containment asks of it (`git merge-base
// --is-ancestor` over the checkout's object store): each commit the loop delivered, oldest first,
// full SHAs as the ledger records them. `d6513a7…` (GY-3's merge) is the release the loop first
// verified against the candidate wiring.
const MAIN_LINE = [
  '14ddc2b257786963f3c80e3466f1e354fb9fe4b6',
  '42af9a8f3b78747ae505483d5c198fbe372464dd', // GY-1's merge — the newest delivery at instance 1
  '6d1f5c0fe285783f53a7963e72791c42f0b93927',
  '5d09dbe57dc0cf5c95cd57e5cc23d1c8e45d5d04', // GY-5's merge — the newest delivery at instance 3
  'e6454709a91e99e6e059492243dbce43ca53ec23',
  '269aab6dd0f1d00e13a8d66179c6f47540a6b146',
  'c0f7f5abf9fd7d892adc6bd8c0641b790921eea4', // GY-10's merge (the deploy-key Pages publish)
  '2ae877aaace4bbbab0b2f70af5627e2ade74659f',
  '569a5ec687d64761b0dc21cf40201a220533e605',
  '9345f880672d1405e4ab494972497338e32dc273', // GY-16's merge (the official Pages actions)
  'd6513a73da39313b3b1354063e741727cad48276', // GY-3's merge — the release first verified, 20:50:57Z
  '00a601a47583a2584f9d419946ff834360ea6266',
  '0db69cb5822487aebea4e065953cce4d70337cc2',
];
const RELEASE = MAIN_LINE[10];

/** Each delivery the loop holds, as the deployment step reads it: its key and its merge commit. */
const DELIVERIES = {
  'GY-1': MAIN_LINE[1],
  'GY-5': MAIN_LINE[3],
  'GY-6': MAIN_LINE[4],
  'GY-7': MAIN_LINE[5],
  'GY-10': MAIN_LINE[6],
  'GY-8': MAIN_LINE[7],
  'GY-9': MAIN_LINE[8],
  'GY-16': MAIN_LINE[9],
  'GY-3': MAIN_LINE[10],
};
/** The nine deliveries the loop held when its first verified observation landed (cycle 17946). */
const NINE_DELIVERED = ['GY-1', 'GY-5', 'GY-6', 'GY-7', 'GY-10', 'GY-8', 'GY-9', 'GY-16', 'GY-3'];
const delivery = key => ({ key, delivery: { mergeSha: DELIVERIES[key] } });

// ——— The deployment-observation model (graphyard src/daemon/deployment.ts) ———

/** `git merge-base --is-ancestor` at the fidelity exercised: reachability over the base branch's own history, `x === y` included. */
function ancestryOver(line) {
  const parents = new Map();
  for (let index = 1; index < line.length; index++) parents.set(line[index], [line[index - 1]]);
  return {
    async contains(ancestor, descendant) {
      if (ancestor === descendant) return true;
      const seen = new Set([descendant]), queue = [descendant];
      while (queue.length) {
        for (const parent of parents.get(queue.pop()) ?? []) {
          if (parent === ancestor) return true;
          if (!seen.has(parent)) { seen.add(parent); queue.push(parent); }
        }
      }
      return false;
    },
  };
}

/** The default the environment name falls back to (src/flow-analytics.ts productionEnvironmentFromEnv). */
function productionEnvironmentFromEnv(env = {}) {
  const raw = env.GRAPHYARD_PRODUCTION_ENVIRONMENT;
  if (raw === undefined) return 'production';
  const value = raw.trim();
  if (!value || value.length > 100) throw new Error('GRAPHYARD_PRODUCTION_ENVIRONMENT must name a deployment-provider environment (1-100 characters)');
  return value;
}

/**
 * The environment the loop verifies deployments under (src/daemon/deployment.ts
 * deploymentEnvironmentName): the master run's `productionEnvironment`, else GRAPHYARD_PRODUCTION_ENVIRONMENT,
 * else 'github-pages' when the repository carries a pages-deploy.yml workflow, else the default.
 * `files` is a path → contents map; a path it omits is a file that does not exist.
 */
function deploymentEnvironmentName(config, root, files, env = {}) {
  if (config.run.productionEnvironment) return config.run.productionEnvironment;
  if (env.GRAPHYARD_PRODUCTION_ENVIRONMENT === undefined && files[join(root, '.github', 'workflows', 'pages-deploy.yml')] !== undefined) return 'github-pages';
  return productionEnvironmentFromEnv(env);
}

/**
 * `gh api` against GitHub, at the fidelity observeDeployment exercises: the deployments listing
 * (`repos/REPO/deployments?environment=NAME&per_page=100&page=N`, and one unfiltered page for the
 * namesake scan) and the one batched GraphQL read of deployments' statuses. `github` holds the
 * records per environment, `any` the unfiltered first page, and `states` each node id's answer.
 */
function ghAgainst(github) {
  return async args => {
    if (args[0] !== 'api') throw new Error(`gh: unexpected command ${args.join(' ')}`);
    if (args[1] === 'graphql') {
      const query = args.find(argument => argument.startsWith('query=')) ?? '';
      const ids = JSON.parse(/nodes\(ids: (\[[^\]]*\])\)/.exec(query)?.[1] ?? '[]');
      return JSON.stringify({ data: { nodes: ids.map(id => github.states[id] ?? null) } });
    }
    const path = args[1] ?? '';
    if (!path.startsWith(`repos/${REPOSITORY}/deployments`)) throw new Error(`gh: unexpected api path ${path}`);
    const query = new URLSearchParams(path.split('?')[1] ?? '');
    const page = Number(query.get('page') ?? '1');
    if (page !== 1) return '[]'; // the fixtures hold a single page; the read bound is asserted below
    const listed = query.get('environment') === null ? github.any : (github.byEnvironment[query.get('environment')] ?? []);
    return JSON.stringify(listed);
  };
}

const deploymentPageSize = 100;   // src/daemon/deployment.ts deploymentPageSize
const deploymentListingPages = 5; // src/daemon/deployment.ts deploymentListingPages
const ciReportingEnvironment = 'graphyard-reporting'; // src/install/ci-proofs.ts: CI proof reporting records deployments too; it is never a release
const inFlightStates = new Set(['pending', 'queued', 'in_progress', 'waiting']); // deploymentStates' consumers
const inFlightShadowBound = 60 * 60_000; // src/daemon/deployment.ts inFlightShadowBound

/**
 * The latest status of each listed deployment in one GraphQL read (src/daemon/deployment.ts
 * deploymentStates): a deployment whose node could not be read has no entry (`undefined`); one
 * with no status yet reads `pending`; `succeeded` says whether any of its statuses is `success`.
 */
async function deploymentStates(gh, candidates) {
  const ids = candidates.map(deployment => deployment.node_id);
  const answer = JSON.parse(await gh(['api', 'graphql', '-f', `query=query { nodes(ids: ${JSON.stringify(ids)}) { ... on Deployment { latestStatus { state } statuses(first: 100) { nodes { state } } } } }`]));
  const nodes = Array.isArray(answer?.data?.nodes) ? answer.data.nodes : [];
  return candidates.map((_deployment, index) => {
    const node = nodes[index];
    if (!node) return { state: undefined, succeeded: false };
    return {
      state: typeof node.latestStatus?.state === 'string' ? node.latestStatus.state.toLowerCase() : 'pending',
      succeeded: [node.statuses?.nodes].some(history => Array.isArray(history) && history.some(status => status?.state?.toLowerCase() === 'success')),
    };
  });
}

/** How long ago a listed deployment was created (src/daemon/deployment.ts inFlightAge); only an in-flight state reads it. */
const inFlightAge = (deployment, at) => {
  const created = typeof deployment?.created_at === 'string' ? Date.parse(deployment.created_at) : Number.NaN;
  return Number.isFinite(created) ? at - created : Number.POSITIVE_INFINITY;
};

/**
 * The deployed commit, from the provider's own deployment record (src/daemon/deployment.ts
 * observeDeployment, the arm with no configured endpoint): the configured production
 * environment's listing, page by page, newest first, until a successful deployment of the base
 * branch answers; the environment's whole identity is compared (productionEnvironmentRecord);
 * containment is asked of git, never of the forge. Unavailable observations carry the reason the
 * loop records. Arms the recorded instances never touched refuse rather than guess.
 */
async function observeDeployment({ config, root, delivered, gh, ancestry, files, env = {}, now }) {
  const at = new Date(now()).toISOString();
  const spent = { requests: 0 };
  const unavailable = reason => ({ source: 'unavailable', sha: null, at, reason, deployed: [], pending: delivered.map(item => item.key), requests: spent.requests, containment: null });
  if (!delivered.length) return { source: 'unavailable', sha: null, at, reason: 'No delivered work is awaiting deployment verification', deployed: [], pending: [], requests: 0, containment: null };
  if (config.run.deploymentUrl) throw new Error('the endpoint arm is not modelled: this installation configures no deployment endpoint (graphyard.json deploy.production is null)');
  let sha = null, source = 'unavailable', inactive = null;
  let production;
  try { production = deploymentEnvironmentName(config, root, files, env); } catch (error) { return unavailable(String(error.message ?? error)); }
  let listed = 0, exhausted = false, newerProduction = false;
  const namesake = new Set();
  for (let page = 1; page <= deploymentListingPages && !sha && !exhausted; page++) {
    let deployments;
    spent.requests++;
    try {
      deployments = JSON.parse(await gh(['api', `repos/${config.repository}/deployments?environment=${encodeURIComponent(production)}&per_page=${deploymentPageSize}&page=${page}`]));
    } catch (error) {
      if (page === 1) return unavailable(`No deployment endpoint is configured and GitHub deployments are unavailable: ${error.message ?? error}`);
      return unavailable(`No release was found in the first ${listed} GitHub deployment(s), and page ${page} of the listing could not be read: ${error.message ?? error}`);
    }
    if (!Array.isArray(deployments)) deployments = [];
    listed += deployments.length;
    exhausted = deployments.length < deploymentPageSize;
    const records = [];
    for (const deployment of deployments) {
      if (deployment?.environment === ciReportingEnvironment) continue;
      if (deployment?.environment !== production) continue; // productionEnvironmentRecord: the provider's whole identity
      const ref = typeof deployment?.ref === 'string' ? deployment.ref : null;
      if (ref && ref !== config.baseBranch) throw new Error('the SHA-ref candidate arm is not modelled; the recorded deployments deploy the base branch by name');
      records.push({ deployment, candidate: true });
    }
    if (!records.length) { newerProduction ||= deployments.length > 0; continue; }
    spent.requests++;
    const states = await deploymentStates(gh, records.map(record => record.deployment));
    for (let index = 0; index < records.length; index++) {
      const { deployment, candidate } = records[index];
      if (candidate) {
        const state = states[index]?.state;
        if (state === undefined) return unavailable(`The status of ${production} deployment ${deployment.id} could not be read, so no older release is taken to be the one production serves`);
        if (typeof deployment.sha === 'string' && (state === 'success' || (state === 'inactive' && states[index]?.succeeded && !newerProduction))) {
          if (state === 'inactive') throw new Error('the inactive-release arm is not modelled; the recorded release reached success and stayed active');
          sha = deployment.sha.toLowerCase(); source = 'github-deployment';
          break;
        }
        if (inFlightStates.has(state) && inFlightAge(deployment, now()) <= inFlightShadowBound) continue;
      }
      newerProduction = true;
    }
  }
  if (!listed) {
    spent.requests++;
    try {
      const recent = JSON.parse(await gh(['api', `repos/${config.repository}/deployments?per_page=${deploymentPageSize}&page=1`]));
      for (const deployment of Array.isArray(recent) ? recent : []) {
        if (typeof deployment?.environment === 'string' && deployment.environment !== production && deployment.environment.endsWith(` / ${production}`) && namesake.size < 5) namesake.add(deployment.environment);
      }
    } catch { /* the names are only a hint; the observation is unavailable either way */ }
    if (!namesake.size) return unavailable(`No deployment endpoint is configured and the repository records no GitHub deployment to the ${production} environment`);
  }
  if (!sha && !exhausted) return unavailable(`None of the newest ${listed} GitHub deployment(s) is a successful ${production} release of the managed base branch, and older ones are past the ${deploymentListingPages}-page read bound, so the release production serves is not known`);
  if (!sha) return unavailable(`No GitHub deployment of the managed base branch to the ${production} environment reports a successful status${namesake.size
    ? `; deployments to ${[...namesake].map(name => `'${name}'`).join(', ')} are not the '${production}' environment — name the one production serves with graphyard master config productionEnvironment='${[...namesake][0]}' (or GRAPHYARD_PRODUCTION_ENVIRONMENT)`
    : ''}`);
  const deployed = [], pending = [], settled = {};
  for (const item of delivered) {
    const mergeSha = item.delivery.mergeSha.toLowerCase();
    if (mergeSha === sha || (await ancestry.contains(mergeSha, sha)) === true) { deployed.push(item.key); settled[item.key] = sha; }
    else pending.push(item.key);
  }
  return { source, sha, at, reason: inactive, deployed, pending, requests: spent.requests, derived: delivered.length, retained: 0, containment: { release: sha, settled } };
}

/** The observation's detail line (src/daemon/deployment.ts deploymentDetail). */
function deploymentDetail(observation) {
  if (observation.source === 'unavailable') return `Deployment SHA is unverified: ${observation.reason ?? 'no deployment observation is configured or available'}`;
  return `Deployed SHA ${observation.sha.slice(0, 12)} from ${observation.source}; verified ${observation.deployed.length} delivered item(s), ${observation.pending.length} not yet serving, from ${observation.requests} GitHub request(s)${observation.reason ? `; ${observation.reason}` : ''}`;
}

/** The fault kind an action records under, and the class the catalogue files it in (src/daemon/state.ts daemonActionFaultKind; src/model/fault-classes.ts, the 'deployment' row). */
const daemonActionFaultKind = kind => `action:${kind}`;
const deploymentFaultClass = { production: 'deployment', throughput: 'deployment', 'plane-unavailable': 'deployment', 'action:deployment': 'deployment', 'action:smoke': 'deployment' };
const faultClassOf = kind => deploymentFaultClass[kind] ?? 'unclassified';

/** The step's recording arm (src/daemon/cycle-delivery.ts deploymentStep): one action row keyed by the newest delivered merge. */
function deploymentAction(delivered, observation) {
  return {
    key: `deployment:${delivered.at(-1).delivery.mergeSha}`,
    kind: 'deployment',
    state: observation.source === 'unavailable' ? 'failed' : 'done',
    detail: deploymentDetail(observation),
    faultKind: daemonActionFaultKind('deployment'),
  };
}

// ——— The throughput model (graphyard src/throughput.ts, src/daemon/cycle-delivery.ts 7a''') ———

const throughputClaim = { // src/throughput.ts throughputClaim: GY-87's claim, in its own numbers
  item: 'GY-87',
  statement: 'Stateless executors drive routine deliveries with no master session running: first-submit-to-merge p50 at most 30 minutes, and no item idle but actionable for longer than 5 minutes.',
  minimumDeliveries: 10,
};
const throughputMeasurementDirectory = '.graphyard/measurements/throughput'; // src/throughput.ts
const throughputRemeasureMs = 60 * 60_000; // src/throughput.ts throughputRemeasureMs

/** The release the control plane reports serving (src/throughput.ts deployedRevision). */
function deployedRevision(status) {
  const stamped = status?.release?.revision;
  if (stamped && stamped !== 'unknown') return { revision: stamped };
  const commit = status?.build?.commit;
  if (commit && commit !== 'unknown') return { revision: commit };
  return { revision: stamped ?? null };
}

/** The newest recorded measurement (src/throughput.ts readThroughputMeasurement), over a files map. */
function readThroughputMeasurement(files) {
  const names = Object.keys(files).filter(name => name.startsWith(`${throughputMeasurementDirectory}/`)).sort();
  const newest = names.at(-1);
  return newest === undefined ? null : { report: JSON.parse(files[newest]), file: newest };
}

/**
 * The loop's own post-deploy measurement (src/throughput.ts loopThroughputMeasurement), at the
 * fidelity the recorded instance exercised: the claim must be delivered here; the plane must
 * report the release serving; that release must be the one the verified deployment observed; and
 * only then is a measurement recorded under the measurement directory. The measurement's own
 * arithmetic over the plane's ledger (measureThroughput) is not what this item exercises, so its
 * report is the fixture's `report(revision)`.
 */
async function loopThroughputMeasurement({ work, observedSha, status, files, now, report }) {
  const claimKey = throughputClaim.item;
  const claim = work.find(item => item.key === claimKey);
  if (!claim || claim.stage !== 'done' || !claim.delivery) return { outcome: 'skipped', revision: null, detail: `${claimKey} is not delivered here, so there is no throughput claim to measure` };
  const served = deployedRevision(await status());
  if (!served.revision || served.revision === 'unknown') return { outcome: 'skipped', revision: null, detail: `The control plane reports no build revision, so ${claimKey}'s throughput cannot be measured against the release serving` };
  const revision = served.revision;
  const previous = readThroughputMeasurement(files);
  const measured = previous?.report.deployed?.revision === revision;
  if (revision.toLowerCase() !== observedSha.toLowerCase()) return { outcome: 'waiting', revision, detail: `The control plane serves ${revision.slice(0, 12)}${measured ? ' (already measured)' : ', not yet measured'} while the verified deployment is ${observedSha.slice(0, 12)}; ${observedSha.slice(0, 12)} is measured once it serves` };
  const measurement = report(revision);
  const file = `${throughputMeasurementDirectory}/${new Date(now()).toISOString()}.json`;
  files[file] = JSON.stringify(measurement);
  return { outcome: 'recorded', settled: measurement.verdict === 'verified', revision, file, verdict: measurement.verdict, detail: `Recorded ${claimKey}'s throughput measurement for ${revision.slice(0, 12)} in ${file}` };
}

/**
 * Whether GY-87's claim is verified against the release serving now (src/throughput.ts
 * throughputClaimVisibility), at the fidelity the recorded instance exercised: no measurement
 * ever recorded, or the newest measurement's own verdict. The attention line is asserted exactly.
 */
function throughputClaimVisibility(measurement, deployed, deliveries) {
  const admitted = measurement?.report.population?.admitted ?? 0;
  const progress = `No open item owns the verification yet (the loop files one on its next unverified measurement of a release whose owner has not closed on an answered needs-decision, and within one cycle while a needs-decision stands): ${admitted} admitted of ${throughputClaim.minimumDeliveries}${measurement ? ` in the newest recorded measurement (${measurement.report.measuredAt}, of ${measurement.report.deployed?.revision?.slice(0, 12) ?? 'an unnamed release'})` : ', nothing measured yet'}`;
  const attention = reason => ({
    subject: 'throughput', kind: 'throughput',
    text: `${throughputClaim.item}'s throughput claim is unverified against the deployed release: ${reason}. ${progress}; the loop re-measures the serving release at most every ${Math.round(throughputRemeasureMs / 60_000)} min while it stays unverified`,
  });
  if (!deliveries) return { verdict: 'unverified', reason: 'no delivery to verify', attention: null };
  if (!measurement) return {
    verdict: 'unverified',
    reason: `no post-deploy measurement has ever been recorded under ${throughputMeasurementDirectory}, so the claim (${throughputClaim.statement}) is delivered but unproven; the loop records one after it next verifies a deployment`,
    attention: attention(`no post-deploy measurement has ever been recorded under ${throughputMeasurementDirectory}, so the claim (${throughputClaim.statement}) is delivered but unproven; the loop records one after it next verifies a deployment`),
  };
  if (measurement.report.deployed?.revision !== deployed.revision) {
    const reason = `the last measurement was taken against ${measurement.report.deployed?.revision ?? 'an unnamed release'} at ${measurement.report.measuredAt}; the release now serving is ${deployed.revision?.slice(0, 12)}`;
    return { verdict: 'unverified', reason, attention: attention(reason) };
  }
  if (measurement.report.verdict !== 'verified') return { verdict: 'unverified', reason: measurement.report.reason, attention: attention(measurement.report.reason) };
  return { verdict: 'verified', reason: measurement.report.reason, attention: null };
}

/**
 * The cycle's throughput arm (src/daemon/cycle-delivery.ts 7a'''): the ask follows a verified
 * deployment — `if (measure && verified && verified.source !== 'unavailable' && verified.sha)`.
 * On the recorded base the observation was unavailable, so the ask never ran and no measurement
 * was ever recorded: that is the recorded throughput instance, reproduced.
 */
async function throughputAsk(stateDeployment, work, deps) {
  const verified = stateDeployment && stateDeployment.source !== 'unavailable' && stateDeployment.sha ? stateDeployment : null;
  if (!verified) return [];
  const outcome = await loopThroughputMeasurement({ ...deps, work, observedSha: verified.sha });
  const unverified = outcome.settled === false || outcome.verdict === 'unverified';
  const state = !outcome ? 'failed' : outcome.outcome === 'waiting' || unverified ? 'waiting' : 'done';
  return [{ key: `throughput:${verified.sha}`, kind: 'deployment', state, detail: outcome.detail, faultKind: daemonActionFaultKind('deployment') }];
}

// ——— The fixtures ———

/**
 * The installation as the recorded instants held it: no deployment endpoint (graphyard.json
 * deploy.production null, no run.deploymentUrl), no productionEnvironment in the master's run
 * config, no GRAPHYARD_PRODUCTION_ENVIRONMENT in the loop's environment, no pages-deploy.yml in
 * the repository (its delivery workflow is graphyard-delivery.yml), and a GitHub that records no
 * deployment of this repository at all.
 */
function baseInstallation(at = INSTANCE_1_AT) {
  return {
    config: { repository: REPOSITORY, baseBranch: 'main', run: {} },
    root: COORDINATOR_ROOT,
    files: {},
    env: {},
    github: { byEnvironment: {}, any: [], states: {} },
    ancestry: ancestryOver(MAIN_LINE),
    now: () => Date.parse(at),
    gh: null, // bound below, once github is fixed up
  };
}

/** The candidate's master config: `graphyard master config productionEnvironment=github-pages`, as the coordinator's .graphyard/master.json now records it. */
function withProductionEnvironment(installation, name = 'github-pages') {
  return { ...installation, config: { ...installation.config, run: { ...installation.config.run, productionEnvironment: name } } };
}

/**
 * The candidate's GitHub: the official Pages actions (GY-16) record each deploy of main in the
 * 'github-pages' environment — newest first, success. The record's id and created_at are never
 * asserted (only an unreadable status or an in-flight state reads them; this one is a success).
 */
function withPagesDeployments(installation) {
  const record = {
    id: 51, sha: RELEASE, ref: 'main', environment: 'github-pages',
    created_at: '2026-10-17T20:46:09.000Z', node_id: 'DEP_pages_release',
  };
  const github = {
    byEnvironment: { 'github-pages': [record] },
    any: [record],
    states: { DEP_pages_release: { latestStatus: { state: 'success' }, statuses: { nodes: [{ state: 'success' }] } } },
  };
  return { ...installation, github, gh: ghAgainst(github) };
}

const bound = installation => ({ ...installation, gh: ghAgainst(installation.github) });

/** The control plane's status as `loopThroughputMeasurement` reads it: the release it reports serving. */
const planeServing = revision => async () => ({ release: { revision, version: null } });

/** The measurement's report fixture (measureThroughput's arithmetic over the plane's ledger is not what this item exercises). */
const reportFixture = verdict => revision => ({
  verdict,
  reason: verdict === 'verified'
    ? `${throughputClaim.minimumDeliveries} session-free deliveries in the window met both budgets against ${revision.slice(0, 12)}`
    : `submit-to-merge p50 missed its budget over the session-free deliveries measured against ${revision.slice(0, 12)}`,
  measuredAt: '2026-10-17T21:00:00.000Z',
  deployed: { revision, containsClaim: true },
  population: { admitted: throughputClaim.minimumDeliveries },
});

// The exact texts the loop recorded, asserted verbatim below.
const RECORDED_UNAVAILABLE_DETAIL =
  'Deployment SHA is unverified: No deployment endpoint is configured and the repository records no GitHub deployment to the production environment';
const RECORDED_THROUGHPUT_ATTENTION =
  "GY-87's throughput claim is unverified against the deployed release: no post-deploy measurement has ever been recorded under .graphyard/measurements/throughput, so the claim (Stateless executors drive routine deliveries with no master session running: first-submit-to-merge p50 at most 30 minutes, and no item idle but actionable for longer than 5 minutes.) is delivered but unproven; the loop records one after it next verifies a deployment. " +
  'No open item owns the verification yet (the loop files one on its next unverified measurement of a release whose owner has not closed on an answered needs-decision, and within one cycle while a needs-decision stands): 0 admitted of 10, nothing measured yet; the loop re-measures the serving release at most every 60 min while it stays unverified';
const RECORDED_VERIFIED_DETAIL = 'Deployed SHA d6513a73da39 from github-deployment; verified 9 delivered item(s), 0 not yet serving, from 2 GitHub request(s)';

test(`instance ${INSTANCE_1_AT} action:deployment on deployment:42af9a8f…: the loop verifying a release no deploy path had recorded`, async () => {
  // The base: GY-1's merge (42af9a8f…) had just become the newest delivery (10:41:01Z); the
  // repository had no deploy job at all, so GitHub recorded no deployment of it.
  const base = bound(baseInstallation(INSTANCE_1_AT));
  const delivered = [delivery('GY-1')];
  const observation = await observeDeployment({ ...base, delivered });
  assert.equal(observation.source, 'unavailable');
  assert.equal(observation.reason, 'No deployment endpoint is configured and the repository records no GitHub deployment to the production environment');
  assert.deepEqual(observation.pending, ['GY-1']);
  const action = deploymentAction(delivered, observation);
  assert.equal(action.key, `deployment:${DELIVERIES['GY-1']}`); // the recorded subject
  assert.equal(action.state, 'failed');
  assert.equal(action.detail, RECORDED_UNAVAILABLE_DETAIL); // the recorded detail, verbatim
  assert.equal(faultClassOf(action.faultKind), 'deployment');

  // The candidate condition — the Pages deployments the official actions record (GY-16) and the
  // master config naming the environment they land in — verifies the release and records it done.
  const candidate = withPagesDeployments(withProductionEnvironment(baseInstallation(INSTANCE_1_AT)));
  const verified = await observeDeployment({ ...candidate, delivered });
  assert.equal(verified.source, 'github-deployment');
  assert.equal(verified.sha, RELEASE);
  assert.deepEqual(verified.deployed, ['GY-1']);
  assert.deepEqual(verified.pending, []);
  const done = deploymentAction(delivered, verified);
  assert.equal(done.state, 'done');
  assert.equal(done.detail, 'Deployed SHA d6513a73da39 from github-deployment; verified 1 delivered item(s), 0 not yet serving, from 2 GitHub request(s)');
});

test(`instance ${INSTANCE_3_AT} action:deployment on deployment:5d09dbe5…: the same reason again that evening — nothing between the two instants connected the repository's deploy to the loop's verification`, async () => {
  // The base: GY-5's merge (5d09dbe…) had just become the newest delivery (18:12:32Z); main still
  // had no deploy job (GY-10's Pages publish merged at 18:38Z, after this instant).
  const base = bound(baseInstallation(INSTANCE_3_AT));
  const delivered = [delivery('GY-1'), delivery('GY-5')];
  const observation = await observeDeployment({ ...base, delivered });
  assert.equal(observation.reason, 'No deployment endpoint is configured and the repository records no GitHub deployment to the production environment');
  const action = deploymentAction(delivered, observation);
  assert.equal(action.key, `deployment:${DELIVERIES['GY-5']}`); // the recorded subject: the newest delivered merge
  assert.equal(action.state, 'failed');
  assert.equal(action.detail, RECORDED_UNAVAILABLE_DETAIL);

  // GY-10's deploy-key publish alone could not clear it: pushing a gh-pages branch records no
  // GitHub deployment, so the listing stayed empty —
  const branchPublishOnly = bound(baseInstallation(INSTANCE_3_AT));
  assert.equal((await observeDeployment({ ...branchPublishOnly, delivered })).reason,
    'No deployment endpoint is configured and the repository records no GitHub deployment to the production environment');
  // — and naming the environment without the official Pages actions is equally insufficient:
  const namedOnly = bound(withProductionEnvironment(baseInstallation(INSTANCE_3_AT)));
  assert.equal((await observeDeployment({ ...namedOnly, delivered })).reason,
    'No deployment endpoint is configured and the repository records no GitHub deployment to the github-pages environment');

  // Both pieces together — the candidate — verified every delivery the loop held at its first
  // live verification (cycle 17946, 2026-10-17T20:50:57Z), recorded here verbatim:
  const candidate = withPagesDeployments(withProductionEnvironment(baseInstallation('2026-10-17T20:50:57.369Z')));
  const nine = NINE_DELIVERED.map(delivery);
  const verified = await observeDeployment({ ...candidate, delivered: nine });
  const done = deploymentAction(nine, verified);
  assert.equal(done.key, `deployment:${RELEASE}`); // GY-3's merge was the newest delivery
  assert.equal(done.state, 'done');
  assert.equal(done.detail, RECORDED_VERIFIED_DETAIL);
});

test(`instance ${INSTANCE_2_AT} throughput on throughput: the measurement that never ran, because no deployment was ever verified`, async () => {
  // The base: the observation never verifies, so the ask the recorded line says the loop is
  // waiting to make ("the loop records one after it next verifies a deployment") never happens —
  // cycle after cycle, no throughput row and no measurement file.
  const base = bound(baseInstallation(INSTANCE_2_AT));
  const work = [delivery('GY-1')]; // what stood delivered at the recorded instant
  const files = {};
  const rows = [];
  for (let cycle = 0; cycle < 3; cycle++) {
    const observation = await observeDeployment({ ...base, delivered: work });
    rows.push(...await throughputAsk(observation, work, { status: planeServing(RELEASE), files, now: base.now, report: reportFixture('verified') }));
  }
  assert.deepEqual(rows, []);
  assert.equal(readThroughputMeasurement(files), null);
  // and the visibility said exactly what the loop recorded at the instant, verbatim:
  const visibility = throughputClaimVisibility(readThroughputMeasurement(files), { revision: null }, work.length);
  assert.equal(visibility.verdict, 'unverified');
  assert.equal(visibility.attention.subject, 'throughput');
  assert.equal(visibility.attention.kind, 'throughput');
  assert.equal(visibility.attention.text, RECORDED_THROUGHPUT_ATTENTION);
  assert.equal(faultClassOf(visibility.attention.kind), 'deployment'); // why the loop filed it with the deployment faults

  // The candidate, this installation's ledger (which does not carry GY-87): the gate now opens
  // with every verified deployment, the loop asks, and its answer is the row it recorded in the
  // same cycle as its first verified deployment (2026-10-17T20:50:57.397Z), verbatim:
  const candidate = withPagesDeployments(withProductionEnvironment(baseInstallation('2026-10-17T20:50:57.397Z')));
  const nine = NINE_DELIVERED.map(delivery);
  const verified = await observeDeployment({ ...candidate, delivered: nine });
  const asked = await throughputAsk(verified, nine, { status: planeServing(null), files: {}, now: candidate.now, report: reportFixture('verified') });
  assert.equal(asked.length, 1);
  assert.equal(asked[0].key, `throughput:${RELEASE}`);
  assert.equal(asked[0].state, 'done');
  assert.equal(asked[0].detail, "GY-87 is not delivered here, so there is no throughput claim to measure");

  // The candidate, the shape the claim's machinery assumes (a ledger that delivers GY-87 and a
  // plane serving the verified release): the measurement records, and the recorded reason cannot
  // arise again — there is a measurement to name instead.
  // GY-87's own merge commit lives in the graphyard repository, not this one; the model never
  // reads it (the measurement's containment is measureThroughput's step, fixture-reported).
  const CLAIM_MERGE = 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0';
  const claimLedger = [...nine, { key: 'GY-87', stage: 'done', delivery: { mergeSha: CLAIM_MERGE } }];
  const recorded = {};
  const askedA = await throughputAsk(verified, claimLedger, { status: planeServing(RELEASE), files: recorded, now: candidate.now, report: reportFixture('verified') });
  assert.equal(askedA[0].state, 'done');
  assert.match(askedA[0].detail, /^Recorded GY-87's throughput measurement for d6513a73da39 in \.graphyard\/measurements\/throughput\//);
  const verifiedVisibility = throughputClaimVisibility(readThroughputMeasurement(recorded), { revision: RELEASE }, claimLedger.length);
  assert.equal(verifiedVisibility.verdict, 'verified');
  assert.equal(verifiedVisibility.attention, null); // a verified measurement retires the attention outright
  const missed = {};
  await throughputAsk(verified, claimLedger, { status: planeServing(RELEASE), files: missed, now: candidate.now, report: reportFixture('unverified') });
  const missedVisibility = throughputClaimVisibility(readThroughputMeasurement(missed), { revision: RELEASE }, claimLedger.length);
  assert.equal(missedVisibility.verdict, 'unverified');
  assert.notEqual(missedVisibility.attention, null);
  assert.doesNotMatch(missedVisibility.attention.text, /no post-deploy measurement has ever been recorded/);
  assert.match(missedVisibility.attention.text, /met both budgets|missed its budget/); // the newest measurement's own figures, never the recorded line
});

test('the shared cause: on the base every consumer stands on the same unverified deployment; the candidate wiring settles all three', async () => {
  // On the base, each consumer names what it cannot do itself: the deployment step records the
  // unavailable observation (instances 1 and 3), and the throughput ask never runs because no
  // deployment is verified (instance 2) — one missing piece of wiring, three recorded instances,
  // which is why the loop filed them as one class.
  const base = bound(baseInstallation(INSTANCE_3_AT));
  const delivered = [delivery('GY-1'), delivery('GY-5')];
  const observation = await observeDeployment({ ...base, delivered });
  assert.equal(deploymentAction(delivered, observation).state, 'failed');
  assert.deepEqual(await throughputAsk(observation, delivered, { status: planeServing(RELEASE), files: {}, now: base.now, report: reportFixture('verified') }), []);
  const visibility = throughputClaimVisibility(null, { revision: null }, delivered.length);
  assert.match(visibility.attention.text, /the loop records one after it next verifies a deployment/);
  assert.equal(faultClassOf('action:deployment'), faultClassOf('throughput'));

  // On the candidate, every consumer settles: the deployment action is done with nothing pending,
  // the throughput ask runs and settles its row, and — given a ledger that delivers the claim and
  // a plane serving the release — a measurement records under the measurement directory.
  const candidate = withPagesDeployments(withProductionEnvironment(baseInstallation('2026-10-17T20:50:57.397Z')));
  const nine = NINE_DELIVERED.map(delivery);
  const verified = await observeDeployment({ ...candidate, delivered: nine });
  const action = deploymentAction(nine, verified);
  assert.equal(action.state, 'done');
  assert.deepEqual(verified.pending, []);
  const files = {};
  const rows = await throughputAsk(verified, [...nine, { key: 'GY-87', stage: 'done', delivery: { mergeSha: 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0' } }], { status: planeServing(RELEASE), files, now: candidate.now, report: reportFixture('verified') });
  assert.equal(rows.length, 1);
  assert.notEqual(rows[0].state, 'failed');
  assert.notEqual(readThroughputMeasurement(files), null);
});

test("the repository's own half of the wiring: the delivery workflow records the deployments the loop verifies, and no endpoint replaces them", async () => {
  const yaml = await readFile(join(ROOT, '.github', 'workflows', 'graphyard-delivery.yml'), 'utf8');
  // The official Pages actions record each deploy of main in the 'github-pages' environment
  // (tests/pages-deploy-workflow.test.js holds the deploy job's fuller contract).
  assert.match(yaml, /- id: deployment\n\s+uses: actions\/deploy-pages@v\d+\n/);
  assert.match(yaml, /environment:\n\s+name: github-pages\n/);
  assert.match(yaml, /if: github\.event_name == 'push' && github\.ref == 'refs\/heads\/main'/);
  // This repository configures no deployment endpoint, so the verification reads those GitHub records:
  const config = JSON.parse(await readFile(join(ROOT, 'graphyard.json'), 'utf8'));
  assert.equal(config.delivery.deploy.production, null);
  assert.equal(config.delivery.deploy.adapter, 'command');
  // And it carries no pages-deploy.yml, so without the master's own setting the environment name
  // falls back to 'production' — the master config naming 'github-pages' is load-bearing:
  assert.equal(existsSync(join(ROOT, '.github', 'workflows', 'pages-deploy.yml')), false);
  assert.equal(deploymentEnvironmentName({ repository: REPOSITORY, baseBranch: 'main', run: {} }, ROOT, {}, {}), 'production');
  assert.equal(deploymentEnvironmentName({ repository: REPOSITORY, baseBranch: 'main', run: { productionEnvironment: 'github-pages' } }, ROOT, {}, {}), 'github-pages');
});

// The live installation records, audited only where they exist: on the coordinator host. CI
// checks out this repository on a GitHub runner, which has no access to that host's files, so the
// audit skips there (the recorded-state reproductions above still run).
test(
  'live audit on the coordinator host: the wiring the candidate names, and the rows the loop now records',
  { skip: !existsSync(MASTER_CONFIG) && `not on the coordinator host: ${COORDINATOR_ROOT} is absent` },
  () => {
    // The installation's half of the wiring: the master's run config names the environment the
    // Pages deploy records, and no deployment endpoint replaces the GitHub record it reads.
    const master = JSON.parse(readFileSync(MASTER_CONFIG, 'utf8'));
    assert.equal(master.repository, REPOSITORY);
    assert.equal(master.run.productionEnvironment, 'github-pages');
    assert.ok(!master.run.deploymentUrl);

    // The loop's daemon cursor lives beside the master credential (src/daemon/state-cursor.ts
    // daemonStatePath): the observation it now holds verifies the release from the GitHub
    // deployment record — instances 1 and 3's remedy, live.
    const cursor = join(dirname(master.credentialFile), `${basename(master.credentialFile).replace(/\.token$/, '')}.daemon.json`);
    const daemon = JSON.parse(readFileSync(cursor, 'utf8'));
    assert.equal(daemon.deployment.source, 'github-deployment');
    assert.ok(/^[0-9a-f]{40}$/.test(daemon.deployment.sha), 'the observation names the release it verified');

    // The first verified observation the loop recorded, when its wiring completed (cycle 17946):
    // asserted while the cursor still retains its row.
    const first = daemon.actions[`deployment:${RELEASE}`];
    if (first !== undefined) {
      assert.equal(first.state, 'done');
      assert.equal(first.detail, RECORDED_VERIFIED_DETAIL);
    }

    // Instance 2's gate, open: the throughput ask now follows every verified deployment, and
    // every recorded ask is settled — this ledger carries no GY-87, so each ask answers "GY-87 is
    // not delivered here, so there is no throughput claim to measure" (held, not dropped: the
    // claim's measurement machinery has nothing to measure until the claim's own item is
    // delivered here; the recorded instance's condition — the loop never asking — is gone).
    const asks = Object.entries(daemon.actions).filter(([key]) => key.startsWith('throughput:'));
    assert.ok(asks.length >= 1, 'the loop has asked its post-deploy throughput question at least once');
    for (const [key, row] of asks) assert.notEqual(row.state, 'failed', `${key} is settled`);
  }
);
