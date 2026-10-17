#!/usr/bin/env node
// Declares and reconciles this repository's Graphyard worker capacity (GY-14).
//
//   node scripts/graphyard-executor.mjs --status
//   node scripts/graphyard-executor.mjs --install [--count N]
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
import { spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const maxWorkers = 32;

/** The command line this script takes, parsed from argv. */
export function parseArguments(argv) {
  const options = { status: false, install: false, count: null };
  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index];
    const value = () => { const next = argv[++index]; if (next === undefined) throw new Error(`${argument} needs a value`); return next; };
    if (argument === '--status') options.status = true;
    else if (argument === '--install') options.install = true;
    else if (argument === '--count') options.count = Number(value());
    else throw new Error(`Unknown argument ${argument}`);
  }
  if (options.count !== null && (!Number.isInteger(options.count) || options.count < 1 || options.count > maxWorkers)) throw new Error(`--count takes a whole number from 1 to ${maxWorkers}`);
  if (options.status === options.install) throw new Error('Use exactly one of --status or --install');
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

const readJson = file => JSON.parse(readFileSync(file, 'utf8'));

/** Runs one Graphyard CLI command, returning its trimmed stdout; throws with the output when it fails. */
function runCli(cli, args, cwd) {
  const result = spawnSync(process.execPath, [cli, ...args], { cwd, encoding: 'utf8', timeout: 900_000 });
  if (result.error) throw new Error(`could not run ${cli}: ${result.error.message}`);
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`.trim();
  if (result.status !== 0) throw new Error(`graphyard ${args.join(' ')} failed (${result.status}):\n${output.slice(-4000)}`);
  return result.stdout.trim();
}

const main = () => {
  const options = parseArguments(process.argv.slice(2));
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
