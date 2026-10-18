#!/usr/bin/env node
// Declares and reconciles this repository's Graphyard worker capacity (GY-14), and serves the
// candidate resync coverage (GY-25).
//
//   node scripts/graphyard-executor.mjs --status
//   node scripts/graphyard-executor.mjs --install [--count N]
//   node scripts/graphyard-executor.mjs --resync [GY-N ...] [--readings FILE]
//
// The repository declares how many worker profiles its Graphyard installation should run in
// graphyard.json's `capacity.workers`. A worker profile holds at most one ready item at a time,
// so a plan whose items touch disjoint plannedFiles and could run in parallel serializes on a
// single profile: every sibling dispatch waits for the one profile to free, and ready→claim
// blows past its 2-minute budget while the sibling delivers. This script makes the host's
// installation match the declaration, using only Graphyard's own commands:
//
//   1. `graphyard principal add <install>-worker-N --role worker` for each principal the live
//      roster lacks (idempotent: repeating it changes nothing and only reads the roster back);
//   2. the new credential is copied where `master environments` discovers worker credentials;
//   3. `graphyard master environments --apply` writes the launch profile .graphyard/master.json
//      holds, and the master loop adopts it on its next tick without a restart.
//
// It never removes anything: a declaration below the live profile count is reported, and removal
// stays an operator action. Run it from the coordinator checkout — the one whose `.graphyard/`
// holds `master.json`; a managed worktree is not one.
//
// The resync coverage (GY-25) answers the other recorded fault: GY-1's candidate record read
// `pr: 1` while the candidate head 024c07784321 was the head of open PR #4, and no path corrected
// it — the control plane's resync is an executor-claimed action row behind a coordinator-only
// permission gate (all executors were stopped; the loop's own attempt was refused 401), and even
// a resync that ran would copy the stored number back over its own observation. `--resync` reads
// the control plane's own records (read-only, through whatever credential the runner holds — any
// role may read) plus the repository's pull-request readings, verifies every candidate pointer
// through the read-time verification GY-24 delivered (src/model/work.ts `verifiedCandidate`), and
// re-points a stale one — automatically, exactly when the recorded pull request is not the open
// one at the candidate head. Each re-point is recorded in `.graphyard/candidate-resync.json`, so
// the resync leaves a standing correction every later read consults instead of re-deriving it.
// Pull-request readings come from `--readings FILE` (a verified reading), else `gh pr list`, else
// `git ls-remote origin 'refs/pull/*'` (credential-free: a pull ref's head names the exact commit,
// and a live `refs/pull/N/merge` says GitHub still serves the pull request open). A closed or
// merged pull request is never adopted; an ambiguity is refused, never guessed. Unlike
// `--install` it may run from any checkout of this repository, a managed worktree included: it
// mutates no installation state, and its record lives beside the code that ran.
import { spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifiedCandidate } from '../src/model/work.ts';

export const maxWorkers = 32;

/** The command line this script takes, parsed from argv. */
export function parseArguments(argv) {
  const options = { status: false, install: false, count: null };
  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index];
    const value = () => { const next = argv[++index]; if (next === undefined) throw new Error(`${argument} needs a value`); return next; };
    if (argument === '--status') options.status = true;
    else if (argument === '--install') options.install = true;
    else if (argument === '--resync') { options.resync = true; options.keys = []; options.readings = null; }
    else if (argument === '--readings') { if (!('resync' in options)) throw new Error(`Unknown argument ${argument} (--readings belongs to --resync)`); options.readings = value(); }
    else if (/^GY-\d+$/.test(argument)) { if (!('resync' in options)) throw new Error(`Unknown argument ${argument} (item keys belong to --resync)`); options.keys.push(argument); }
    else if (argument === '--count') options.count = Number(value());
    else throw new Error(`Unknown argument ${argument}`);
  }
  if (options.count !== null && (!Number.isInteger(options.count) || options.count < 1 || options.count > maxWorkers)) throw new Error(`--count takes a whole number from 1 to ${maxWorkers}`);
  const modes = (options.status ? 1 : 0) + (options.install ? 1 : 0) + (options.resync ? 1 : 0);
  if (modes !== 1) throw new Error('Use exactly one of --status, --install or --resync');
  return options;
}

/** The worker count this repository declares: graphyard.json's capacity.workers, defaulting to 1. */
export function declaredWorkers(configText) {
  let parsed;
  try { parsed = JSON.parse(configText); } catch (error) { throw new Error(`graphyard.json is not valid JSON: ${error.message}`); }
  const declared = parsed?.capacity?.workers ?? 1;
  if (!Number.isInteger(declared) || declared < 1 || declared > maxWorkers) throw new Error(`graphyard.json capacity.workers must be a whole number from 1 to ${maxWorkers}, not ${JSON.stringify(declared)}`);
  return declared;
}

/** The install id a repository names, the way `graphyard install` derives it: owner/name → owner-name. */
export function installIdOf(repository) {
  const match = /^([\w.-]+)\/([\w.-]+)$/.exec(String(repository ?? '').trim());
  if (!match) throw new Error(`Expected a repository as OWNER/NAME, not ${JSON.stringify(repository)}`);
  return `${match[1]}-${match[2]}`.toLowerCase().replace(/[^a-z0-9._-]/g, '-');
}

/** The principal id worker number `index` of an installation claims under. */
export const workerPrincipal = (installId, index) => `${installId}-worker-${index}`;

/**
 * What the host must do to serve `declared` worker profiles, given the `profiles` already in
 * .graphyard/master.json: the principals to add to the installation roster, the credentials to
 * copy where `master environments` reads them, whether launch profiles must be regenerated, and
 * whether the live profiles already meet the declaration. The declaration is a count, so it is
 * met by as many profiles as it names; the principals it adds are the conventional
 * `<install>-worker-N` ids the roster does not yet hold. It never plans a removal.
 */
export function planCapacity({ declared, installId, profiles = [], rosterPrincipals = [], workerFolderTokens = [] }) {
  if (!Number.isInteger(declared) || declared < 1 || declared > maxWorkers) throw new Error(`declared must be a whole number from 1 to ${maxWorkers}, not ${JSON.stringify(declared)}`);
  const livePrincipals = new Set(profiles.map(profile => profile.principal));
  const missing = [];
  for (let index = 1; index <= maxWorkers && livePrincipals.size + missing.length < declared; index++) {
    const principal = workerPrincipal(installId, index);
    if (!livePrincipals.has(principal)) missing.push(principal);
  }
  const roster = new Set(rosterPrincipals), tokens = new Set(workerFolderTokens);
  return {
    declared,
    live: profiles.length,
    addPrincipals: missing.filter(principal => !roster.has(principal)),
    copyTokens: missing.filter(principal => !tokens.has(principal)),
    applyEnvironments: missing.length > 0,
    ready: missing.length === 0,
  };
}

/** The checkout this script reconciles: its own repository root, when that root is the coordinator. */
export function coordinatorRoot(scriptDirectory, exists = path => existsSync(path)) {
  const root = resolve(scriptDirectory, '..');
  if (!exists(resolve(root, '.graphyard', 'master.json'))) {
    throw new Error(`${root} is not the coordinator checkout: it holds no .graphyard/master.json. Run this from the checkout whose .graphyard/ holds master.json, not from a managed worktree.`);
  }
  return root;
}

// ---------------------------------------------------------------------------
// The candidate resync coverage (GY-25).
//
// The recorded fault: GY-1's candidate record read `pr: 1` while the candidate head 024c07784321
// headed open PR #4 (PR #1: closed unmerged 2026-10-10T20:11:38Z, head 79efbe1f, base master — a
// pull request that is not the candidate's). The stale pointer hid PR #4 from every control-plane
// reader — the provider's own reader reads only the pull request the submission pointer names
// (graphyard src/github.ts observe: `/pulls/${work.submission!.pr}`), the merge-stall invariant
// read "0 mergeable item(s)" while a green mergeable candidate sat unmerged, and no resync ever
// corrected the number: the resync runs only as an executor-claimed action row behind a
// coordinator-only permission gate (graphyard src/engine.ts resyncWork: "Coordinator permission
// required"), all executors were stopped, and even a resync that ran would copy the stored number
// back over its own observation (graphyard src/engine.ts observeControlPlaneCandidate) — while a
// delivered item's record is returned unchanged (graphyard Engine.observe). The coverage below
// re-points the pointer from outside the control plane: it reads the records any role may read,
// verifies each pointer through GY-24's read-time verification, and records the re-point where
// every later read of this repository finds it. A closed or merged pull request is never adopted;
// an ambiguity is refused, never guessed — the same rules the verification holds.
// ---------------------------------------------------------------------------

/**
 * One work item as the control plane's `status`/`list` reports it — the pieces the resync reads:
 * its key and stage, and the candidate whose pointer is verified (`candidate.sha`, `candidate.pr`).
 * @typedef {{ key: string, stage?: string, candidate: { sha: string, pr: number, branch?: string } | null }} ResyncItem
 */

/**
 * One pull-request reading at the fidelity its source holds: src/model/work.ts's PullRequestReading
 * shape, plus the queue and gate facts (mergeStateStatus, checksGreen, approved) a verified reading
 * or the recorded evidence carries and the merge-stall invariant reads.
 * @typedef {Object} ResyncReading
 * @property {number} number
 * @property {'open' | 'closed'} state
 * @property {boolean} merged
 * @property {string} headSha
 * @property {string} [headBranch]
 * @property {string} baseBranch
 * @property {string} [openedAt]
 * @property {string | null} [closedAt]
 * @property {string} [mergeStateStatus]
 * @property {boolean} [checksGreen]
 * @property {boolean} [approved]
 */

/**
 * One resync's decision about one item's pointer: what the read found, and what it changed.
 * @typedef {Object} ResyncRow
 * @property {string} key
 * @property {string} sha the candidate head whose pull request the pointer names — the pointer's truth.
 * @property {number} storedPr the number the record stores; the record itself is never rewritten.
 * @property {number} pr the number every read names after this resync.
 * @property {boolean} corrected true when the stored number was re-pointed.
 * @property {number | null} from the stale number the resync replaced.
 * @property {ResyncReading | null} pull the open pull request at the candidate head, or null when it has none.
 * @property {string} basis the one-sentence finding the row stands on.
 * @property {string | null} refused a reading the verification refused (an ambiguity): reported, never guessed past.
 */

/**
 * The full-fidelity planner: every pointer verified through GY-24's read-time verification
 * (src/model/work.ts verifiedCandidate) against complete pull-request readings.
 * @param {ResyncItem[]} items
 * @param {ResyncReading[]} readings
 * @param {string} [baseBranch]
 * @returns {ResyncRow[]}
 */
export function planCandidateResync(items, readings, baseBranch = 'main') {
  return items.filter(item => item.candidate).map(item => {
    const candidate = item.candidate;
    try {
      const read = verifiedCandidate(candidate, readings, baseBranch);
      return { key: item.key, sha: candidate.sha, storedPr: candidate.pr, pr: read.candidate.pr, corrected: read.corrected,
        from: read.from, pull: read.pull ?? null, basis: read.basis, refused: null };
    } catch (error) {
      return { key: item.key, sha: candidate.sha, storedPr: candidate.pr, pr: candidate.pr, corrected: false, from: null, pull: null,
        basis: `candidate ${candidate.sha.slice(0, 12)} could not be verified`, refused: error instanceof Error ? error.message : String(error) };
    }
  });
}

/**
 * One pull ref as `git ls-remote origin 'refs/pull/*'` reports it: its head's exact commit, and
 * whether GitHub still serves its merge.
 * @typedef {Object} PullRef
 * @property {number} number
 * @property {string} headSha
 * @property {boolean} mergeRef
 */

/**
 * Parse `git ls-remote` output into pull refs: `<sha>\trefs/pull/N/head` lines and their `/merge` companions.
 * @param {string} output
 * @returns {PullRef[]}
 */
export function parsePullRefs(output) {
  const refs = new Map();
  for (const line of output.split('\n')) {
    const match = /^([0-9a-f]{40})\trefs\/pull\/(\d+)\/(head|merge)$/.exec(line.trim());
    if (!match) continue;
    const number = Number(match[2]);
    const ref = refs.get(number) ?? { number, headSha: '', mergeRef: false };
    if (match[3] === 'head') ref.headSha = match[1];
    else ref.mergeRef = true;
    refs.set(number, ref);
  }
  return [...refs.values()].filter(ref => ref.headSha);
}

/**
 * The credential-free planner: what pull refs alone can verify. A pull ref's head names the exact
 * commit the pull request carries, and a live `refs/pull/N/merge` says GitHub still serves the
 * pull request open with a merge it can compute. Exactly one open pull ref at the candidate head
 * re-points the pointer when the stored number's own ref heads another commit; a pull request
 * without a merge ref — closed, merged, or unknown — is never adopted; two open pull refs at the
 * same head are refused, never guessed (refs carry no branch name to narrow by).
 * @param {ResyncItem[]} items
 * @param {PullRef[]} refs
 * @returns {ResyncRow[]}
 */
export function planCandidateResyncFromRefs(items, refs) {
  return items.filter(item => item.candidate).map(item => {
    const candidate = item.candidate;
    const sha12 = candidate.sha.slice(0, 12);
    const stored = refs.find(ref => ref.number === candidate.pr) ?? null;
    const heads = refs.filter(ref => ref.headSha === candidate.sha);
    const open = heads.filter(ref => ref.mergeRef);
    const standing = (pull, basis) => ({ key: item.key, sha: candidate.sha, storedPr: candidate.pr,
      pr: candidate.pr, corrected: false, from: null, pull, basis, refused: null });
    if (open.length > 1)
      return { key: item.key, sha: candidate.sha, storedPr: candidate.pr, pr: candidate.pr, corrected: false, from: null, pull: null,
        basis: `candidate ${sha12} could not be verified`, refused: `candidate ${sha12} heads ${open.length} open pull requests (${open.map(ref => `#${ref.number}`).join(', ')}); the pointer is not corrected on a guess` };
    const one = open[0] ?? null;
    if (!one) {
      const closed = heads.find(ref => !ref.mergeRef) ?? null;
      const basis = closed
        ? `candidate ${sha12} heads pull request #${closed.number}, which serves no merge ref (closed or merged, not open); a closed pull request is never adopted`
        : `candidate ${sha12} heads no pull request ref at all; the stored PR #${candidate.pr} is not its open pull request, and no decision cites it as one`;
      return standing(closed ? { number: closed.number, state: 'closed', merged: false, headSha: closed.headSha, baseBranch: '' } : null, basis);
    }
    const pull = { number: one.number, state: 'open', merged: false, headSha: one.headSha, baseBranch: '' };
    if (one.number === candidate.pr)
      return standing(pull, `candidate ${sha12} is the head of open pull request #${one.number}; the stored pointer already names it`);
    return { key: item.key, sha: candidate.sha, storedPr: candidate.pr, pr: one.number, corrected: true, from: candidate.pr, pull,
      basis: `candidate ${sha12} is the head of open pull request #${one.number} (its merge ref stands, so GitHub serves it open); the stored PR #${candidate.pr}${stored ? `'s ref heads ${stored.headSha.slice(0, 12)}, not the candidate` : ' names no pull ref at this repository'} — re-pointed`, refused: null };
  });
}

/**
 * `gh pr list --json` rows as the planner reads them.
 * @param {Record<string, unknown>[]} pulls
 * @returns {ResyncReading[]}
 */
export function readingsFromGh(pulls) {
  return pulls.map(pull => ({
    number: Number(pull.number),
    state: String(pull.state).toLowerCase() === 'open' ? 'open' : 'closed',
    merged: String(pull.state).toUpperCase() === 'MERGED',
    headSha: String(pull.headRefOid ?? ''),
    headBranch: pull.headRefName ? String(pull.headRefName) : undefined,
    baseBranch: String(pull.baseRefName ?? ''),
    openedAt: pull.createdAt ? String(pull.createdAt) : undefined,
    closedAt: pull.closedAt ? String(pull.closedAt) : null,
  }));
}

/**
 * A `--readings` file: an array of readings exactly as the planner takes them — the form a
 * verified reading (the operator's or the loop's, taken with gh) is handed to the coverage in.
 * @param {string} text
 * @returns {ResyncReading[]}
 */
export function parseReadingsFile(text) {
  const parsed = JSON.parse(text);
  if (!Array.isArray(parsed)) throw new Error('--readings takes a JSON array of pull-request readings');
  return parsed.map(reading => ({ ...reading, number: Number(reading.number), state: reading.state === 'open' ? 'open' : 'closed', merged: reading.merged === true }));
}

/** Where a resync records its re-points: `.graphyard/candidate-resync.json` in the running checkout. @param {string} root */
export const resyncRecordPath = root => join(root, '.graphyard', 'candidate-resync.json');

/**
 * The record as a resync leaves it: one re-point per item, replaced by the next run that
 * re-points it again. Rows that stand record nothing — a standing pointer needs no correction.
 * @param {string | null} existing
 * @param {ResyncRow[]} rows
 * @param {string} source
 * @param {string} at
 */
export function applyResyncRecord(existing, rows, source, at) {
  const record = existing ? JSON.parse(existing) : { version: 1, resyncs: {} };
  if (record.version !== 1 || typeof record.resyncs !== 'object' || record.resyncs === null) throw new Error('the existing resync record is not version 1; inspect it before recording over it');
  for (const row of rows.filter(row => row.corrected))
    record.resyncs[row.key] = { key: row.key, sha: row.sha, from: row.from, pr: row.pr, source, basis: row.basis, at };
  return record;
}

/**
 * The pointer a reader names once a resync has recorded its re-point: the record's correction
 * applied to the stored pointer, when it still matches this candidate head.
 * @param {string | null} existing
 * @param {string} key
 * @param {{ sha: string, pr: number }} candidate
 */
export function resyncedCandidate(existing, key, candidate) {
  const record = existing ? JSON.parse(existing) : null;
  const entry = record?.resyncs?.[key];
  if (!entry || entry.sha !== candidate.sha) return { pr: candidate.pr, corrected: false, from: null };
  return { pr: entry.pr, corrected: entry.pr !== candidate.pr, from: entry.pr !== candidate.pr ? candidate.pr : null };
}

/** GitHub's mergeable states, as graphyard's own merge queue reads them (src/merge-queue.ts mergeableStates). */
export const mergeableStates = ['CLEAN', 'UNSTABLE', 'HAS_HOOKS'];

/**
 * One item as the merge-stall invariant's world holds it: the pull request its (resynced) pointer
 * names, and the gates' reading of it.
 * @typedef {Object} MergeStallEntry
 * @property {string} key
 * @property {string} [stage]
 * @property {{ sha: string, pr: number }} candidate
 * @property {ResyncReading | null} pull the pull request the pointer names after the resync — the one the control plane's reader reads (graphyard src/github.ts observe reads `/pulls/${submission.pr}`).
 * @property {boolean} [gatesPassed] whether the item's gates pass through that pull request's facts. A gate still failing is a recorded refusal.
 * @property {number} [violations]
 */

/**
 * The merge-stall invariant's reading over one world (graphyard src/model/invariants.ts judge 4,
 * "no merge-stage item mergeable N min without a recorded refusal"), with the observation each
 * item carries read through the pull request its pointer names — exactly the coupling the
 * recorded fault exploited: through the stale pointer the reader read the closed PR #1, so the
 * predicate never held and the invariant read "0 mergeable item(s)" while PR #4 sat open and
 * green at the candidate head; through the re-pointed pointer it counts the item. The wording is
 * the invariant's own, so a recorded reading reproduces byte for byte.
 * @param {MergeStallEntry[]} entries
 * @param {{ boundMinutes?: number, mergeableForMinutes?: number }} [options]
 */
export function mergeStallReading(entries, { boundMinutes = 10, mergeableForMinutes = 0 } = {}) {
  const waiting = [], stalled = [];
  for (const entry of entries) {
    const pull = entry.pull;
    // The observation the pointer's pull request yields: merged is the pull request's own fact;
    // mergeable is its open head at exactly the candidate sha under a state GitHub merges at once.
    const merged = pull?.merged === true;
    const mergeable = !!pull && pull.state === 'open' && !pull.merged && pull.headSha === entry.candidate.sha
      && (pull.mergeStateStatus !== undefined ? mergeableStates.includes(pull.mergeStateStatus) : false);
    const counted = entry.stage === 'merge' && !!entry.candidate && mergeable && !merged;
    // A gate still failing is a recorded refusal, and so is a standing violation.
    const refused = entry.gatesPassed === false || (entry.violations ?? 0) > 0;
    if (!counted || refused) continue;
    waiting.push(entry);
    if (mergeableForMinutes > boundMinutes) stalled.push({ key: entry.key, minutes: mergeableForMinutes });
  }
  const text = stalled.length
    ? `${stalled.length} item(s) mergeable and unmerged with nothing refusing them, the longest ${stalled[0].key} for ${Math.round(mergeableForMinutes)} min`
    : `${waiting.length} mergeable item(s), none past the bound`;
  return { count: waiting.length, stalled, holds: stalled.length === 0, text };
}

/** The repository slug of the running checkout's origin, as `gh -R` takes it. @param {string} remoteUrl */
export function originSlug(remoteUrl) {
  const url = remoteUrl.trim().replace(/\.git$/, '');
  const ssh = /^git@github\.com:([\w.-]+\/[\w.-]+)$/.exec(url);
  if (ssh) return ssh[1];
  const https = /^https:\/\/github\.com\/([\w.-]+\/[\w.-]+)$/.exec(url);
  if (https) return https[1];
  return null;
}

/** The URL `git ls-remote` reads pull refs from: https for a GitHub remote, the remote itself for any other (a fixture). @param {string} remoteUrl */
export function pullRefsUrl(remoteUrl) {
  const slug = originSlug(remoteUrl);
  return slug ? `https://github.com/${slug}.git` : remoteUrl.trim();
}

const readJson = file => JSON.parse(readFileSync(file, 'utf8'));

/** Runs one Graphyard CLI command, returning its trimmed stdout; throws with the output when it fails. */
function runCli(cli, args, cwd) {
  const result = spawnSync(process.execPath, [cli, ...args], { cwd, encoding: 'utf8', timeout: 900_000 });
  if (result.error) throw new Error(`could not run ${cli}: ${result.error.message}`);
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`.trim();
  if (result.status !== 0) throw new Error(`graphyard ${args.join(' ')} failed (${result.status}):\n${output.slice(-4000)}`);
  return result.stdout.trim();
}

/** Runs a bare command, returning its stdout or null when it fails (a source the coverage may fall past). */
function tryCommand(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8', timeout: 120_000 });
  if (result.error || result.status !== 0) return null;
  return String(result.stdout ?? '');
}

/**
 * The resync coverage's own run (GY-25): read the control plane's records, read the repository's
 * pull-request readings, verify every candidate pointer and re-point the stale ones, recording
 * each re-point in `.graphyard/candidate-resync.json` and reporting the merge-stall invariant's
 * reading through the pointers it leaves behind. Returns the process exit code: a refusal (an
 * ambiguity the verification will not guess past) or an unreadable item fails the run; re-points
 * and standing pointers alike are its success.
 */
function runResync(options) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const master = existsSync(resolve(root, '.graphyard', 'master.json')) ? readJson(resolve(root, '.graphyard', 'master.json')) : {};
  const cli = master.cliPath || process.env.GRAPHYARD_CLI;
  if (!cli) throw new Error('No Graphyard CLI path: .graphyard/master.json names none and GRAPHYARD_CLI is unset');
  const baseBranch = master.baseBranch || 'main';
  // The control plane's own records, read with whatever credential the runner holds: any role may read them.
  const documents = [];
  for (const key of options.keys.length ? options.keys : [null]) {
    try { documents.push(JSON.parse(key ? runCli(cli, ['status', key], root) : runCli(cli, ['list'], root))); }
    catch (error) { console.error(`${key ?? 'list'}: ${error instanceof Error ? error.message : String(error)}`); return 1; }
  }
  const flat = documents.flatMap(document => (Array.isArray(document) ? document : [document])).filter(item => item?.candidate);
  // The resync's own earlier record is a reading too: a pointer this repository already
  // re-pointed is verified from where the record left it, so a repeat run over an unchanged
  // world stands instead of re-pointing, and only a genuinely newer reading moves it again.
  const recordFile = resyncRecordPath(root);
  const recordText = existsSync(recordFile) ? readFileSync(recordFile, 'utf8') : null;
  const items = flat.map(item => {
    const read = resyncedCandidate(recordText, item.key, item.candidate);
    return read.corrected ? { ...item, candidate: { ...item.candidate, pr: read.pr } } : item;
  });
  if (!items.length) { console.log('no item holds a candidate; nothing to resync'); return 0; }
  // The pull-request readings: an explicit verified reading, else gh, else the credential-free pull refs.
  const remote = tryCommand('git', ['remote', 'get-url', 'origin'], root)?.trim() ?? null;
  const slug = remote ? originSlug(remote) : null;
  let readings = null, source = null, refs = null, note = '';
  if (options.readings) {
    readings = parseReadingsFile(readFileSync(options.readings, 'utf8'));
    source = 'readings';
  } else {
    const gh = slug ? tryCommand('gh', ['pr', 'list', '-R', slug, '--state', 'all', '--limit', '200',
      '--json', 'number,state,mergedAt,closedAt,createdAt,headRefName,headRefOid,baseRefName'], root) : null;
    if (gh) { readings = readingsFromGh(JSON.parse(gh)); source = 'gh'; }
    else {
      note = 'gh answered nothing (no credential, or none it accepts); reading the pull refs credential-free';
      refs = remote ? tryCommand('git', ['ls-remote', pullRefsUrl(remote), 'refs/pull/*'], root) : null;
      if (refs === null) { console.error('no pull-request reading could be taken: pass one with --readings FILE, or run where gh or git ls-remote can read the repository'); return 1; }
      source = 'refs';
    }
  }
  const rows = source === 'refs' ? planCandidateResyncFromRefs(items, parsePullRefs(refs)) : planCandidateResync(items, readings, baseBranch);
  let failed = 0;
  for (const row of rows) {
    if (row.refused) { failed++; console.log(`${row.key}: refused — ${row.refused}`); continue; }
    console.log(row.corrected
      ? `${row.key}: candidate ${row.sha.slice(0, 12)} re-pointed PR #${row.storedPr} -> PR #${row.pr} (${source}) — ${row.basis}`
      : `${row.key}: candidate ${row.sha.slice(0, 12)} stands at PR #${row.pr} (${source}) — ${row.basis}`);
  }
  if (note) console.log(note);
  const corrected = rows.filter(row => row.corrected);
  if (corrected.length) {
    const record = applyResyncRecord(recordText, rows, source, new Date().toISOString());
    mkdirSync(dirname(recordFile), { recursive: true });
    writeFileSync(recordFile, `${JSON.stringify(record, null, 2)}\n`, { mode: 0o600 });
    console.log(`recorded ${corrected.length} re-point(s) in ${relativeRecord(root, recordFile)}; every later read of this repository names the corrected pointer`);
  }
  // The merge-stall invariant's reading through the pointers this resync leaves: computable only
  // from readings that carry the queue and gate facts (a verified reading or the recorded evidence).
  if (source === 'refs') console.log('merge-stall invariant: not read (pull refs carry no queue states or checks; run with --readings or gh for it)');
  else {
    const entries = rows.filter(row => !row.refused).map(row => ({ key: row.key, stage: flat.find(item => item?.key === row.key)?.stage,
      candidate: { sha: row.sha, pr: row.pr }, pull: row.pull, gatesPassed: row.pull ? (row.pull.checksGreen ?? true) && (row.pull.approved ?? true) : false }));
    console.log(`merge-stall invariant: ${mergeStallReading(entries).text}`);
  }
  return failed ? 1 : 0;
}

/** The record's path as the run reports it: relative to the running checkout's root. */
function relativeRecord(root, recordFile) { return recordFile.startsWith(`${root}/`) ? recordFile.slice(root.length + 1) : recordFile; }

const main = () => {
  const options = parseArguments(process.argv.slice(2));
  if (options.resync) return runResync(options);
  const root = coordinatorRoot(dirname(fileURLToPath(import.meta.url)));
  const master = readJson(resolve(root, '.graphyard', 'master.json'));
  const installId = installIdOf(master.repository);
  const declared = options.count ?? declaredWorkers(readFileSync(resolve(root, 'graphyard.json'), 'utf8'));
  const installDirectory = resolve(process.env.XDG_CONFIG_HOME || resolve(homedir(), '.config'), 'graphyard', installId);
  const workers = Array.isArray(master.workers) ? master.workers : [];
  let roster = [];
  try { roster = readJson(resolve(installDirectory, 'install.json')).principals.map(entry => entry.id); } catch { /* an unreadable record leaves the roster unknown; the plan then only asks to add */ }
  const workerFolder = resolve(installDirectory, 'workers');
  const workerFolderTokens = existsSync(workerFolder) ? readdirSync(workerFolder).filter(name => name.endsWith('.token')).map(name => name.slice(0, -'.token'.length)) : [];
  const plan = planCapacity({ declared, installId, profiles: workers, rosterPrincipals: roster, workerFolderTokens });
  if (options.status) {
    console.log([
      `repository: ${master.repository} (install ${installId})`,
      `declared workers: ${declared} (graphyard.json capacity.workers${options.count !== null ? `, overridden by --count ${options.count}` : ''})`,
      `live worker profiles: ${workers.map(profile => profile.name).join(', ') || 'none'}`,
      plan.ready
        ? `the live profiles already meet the declaration${workers.length > declared ? ` (${workers.length} profiles, declaration names ${declared}; this script never removes one)` : ''}`
        : `missing: ${[...plan.addPrincipals.map(id => `${id} (roster principal)`), ...plan.copyTokens.map(id => `${id} (credential for master environments)`), ...(plan.addPrincipals.length === 0 && plan.copyTokens.length === 0 ? ['launch profile (master environments --apply)'] : [])].join('; ')}`,
    ].join('\n'));
    return 0;
  }
  const cli = master.cliPath || process.env.GRAPHYARD_CLI;
  if (!cli) throw new Error('No Graphyard CLI path: .graphyard/master.json names none and GRAPHYARD_CLI is unset');
  for (const principal of plan.addPrincipals) {
    console.log(runCli(cli, ['principal', 'add', principal, '--role', 'worker', '--repo', master.repository], root));
  }
  for (const principal of plan.copyTokens) {
    const token = resolve(installDirectory, 'tokens', `${principal}.token`);
    if (!existsSync(token)) throw new Error(`${token} does not exist: run principal add ${principal} first`);
    mkdirSync(workerFolder, { recursive: true, mode: 0o700 });
    copyFileSync(token, resolve(workerFolder, `${principal}.token`));
    chmodSync(resolve(workerFolder, `${principal}.token`), 0o600);
    console.log(`copied ${principal}'s credential where master environments discovers worker credentials`);
  }
  if (plan.applyEnvironments) console.log(runCli(cli, ['master', 'environments', '--apply'], root));
  const live = (readJson(resolve(root, '.graphyard', 'master.json')).workers ?? []).length;
  console.log(`live worker profiles now: ${live}`);
  if (live < declared) { console.error(`Still below the declaration: ${live} of ${declared} worker profiles. Check the master environments output above.`); return 1; }
  console.log(`the installation serves the declared ${declared} worker profile(s); the master loop adopts them on its next tick without a restart`);
  return 0;
};

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  try { process.exit(main()); } catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exit(1); }
}
