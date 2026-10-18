#!/usr/bin/env node
// Reaps coordination sessions whose decisions settled (GY-20).
//
//   node bin/graphyard.mjs --status [--json] [--grace-ms N]
//   node bin/graphyard.mjs --reap   [--json] [--grace-ms N]
//
// Three approver sessions on GY-1 stayed state=running and observed=idle for hours
// after their decisions settled as refused (approver:f9162d74 refused 2026-10-17T03:01:31Z,
// idle-live ~5h56m later; approver:6ef90e68 refused 05:49:59Z, ~3h06m; approver:00a1a900
// refused 05:53:57Z, ~3h04m; panes w2:p3H/p3J/p3K). Dispatch's session reconcile observed
// them idle every cycle and reaped nothing: it closes only worker-profile sessions whose
// profile holds no active assignment, and an approver session never belongs to one. Session
// reaping had no sanctioned command at all — the doctor's allowlist carries none, and the
// earlier session-liveness filings were lost to 401s — so this repository ships one.
//
// What this command does on each pass, against this host's own installation:
//
//   1. reads the coordinator's Graphyard config (.graphyard/master.json in the coordinator
//      checkout — a managed worktree is not one) for the control plane URL, the coordinator
//      credential file and the Herdr workspace every launch is scoped to;
//   2. reads every work item and its decision history from the control plane
//      (GET /api/work-snapshot, then GET /api/work/:id/decisions per item);
//   3. reads Herdr's agent list in the installation's workspace scope;
//   4. names each approver session the way the loop launches it — the decision id's hex
//      distinguisher on the approver prefix — and matches live agents by that exact name;
//   5. marks a matched session reapable when its decision has settled (any state but
//      `requested`: the verdict is recorded, the session's work is done) and its runtime is
//      idle or done — never while it is working, never while the decision is still awaited,
//      never a pane another workspace holds, never an agent no known decision names;
//   6. `--reap` closes every reapable pane (`herdr pane close`, then verifies the pane left
//      Herdr's inventory) and re-reads; `--status` reports only.
//
// A session still open GRACE (30 minutes by default — the lingering-sessions threshold:
// no session open 30 minutes after its decision settles) past its settle is reported as
// lingering, and both modes exit 1 while any session lingers, so a supervisor reading the
// exit code sees the invariant the fault class counts. The command never ends leases,
// never closes an implementation session under a live attempt (that is dispatch's own
// close step, keyed on the lease), and never writes anything but pane closes.
//
// Run it from the coordinator checkout — the one whose .graphyard/ holds master.json.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The lingering-sessions threshold the fault class counts: no session open this long after its decision settles. */
export const settleGraceMs = 30 * 60_000;
/** How long `--reap` waits for a closed pane to leave Herdr's inventory (the daemon's own close bound). */
export const closeWaitMs = 5_000;

/** The Herdr session-name rules the loop launches under (src/session-name.ts), as this repository runs them. */
const sessionNameLimit = 32, sessionNameDigestLength = 8, sessionNameDistinguisher = 4, sessionNameDistinguisherLimit = 8;
const slug = (value) => String(value).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
function sessionName(...parts) {
  const joined = parts.map(slug).filter(Boolean).join('-');
  const full = /^[a-z]/.test(joined) ? joined : `gy-${joined}`;
  if (full.length <= sessionNameLimit) return full;
  const digest = createHash('sha256').update(parts.join('\u0000')).digest('hex').slice(0, sessionNameDigestLength);
  return `${full.slice(0, sessionNameLimit - sessionNameDigestLength - 1).replace(/-+$/, '')}-${digest}`;
}
/** The names one approver launch of `decisionId` on `workKey` runs under, shortening exactly as the loop does. */
export function approverSessionNames(workKey, decisionId) {
  for (const prefix of ['graphyard-approver', 'gy-approver']) {
    const head = sessionName(prefix, workKey);
    const room = Math.min(sessionNameLimit - head.length - 1, sessionNameDistinguisherLimit);
    const tail = slug(decisionId).replace(/-/g, '').slice(0, Math.max(0, room));
    if (tail.length >= sessionNameDistinguisher) return `${head}-${tail}`;
  }
  return sessionName('gy-approver', workKey, decisionId);
}

/**
 * When a decision settled, or null while it still awaits its approver (`requested`). Any other
 * state is settled — the verdict is recorded (refused with `refusal.at`, approved with
 * `approvedAt`) or the request is no longer this approver's to judge (stale, withdrawn, held) —
 * and the instant is the one the record names, falling back to the request time, the only bound
 * a record without its own timestamp carries.
 */
export function settledAt(decision) {
  if (!decision || (decision.state ?? 'requested') === 'requested') return null;
  for (const at of [decision.refusal?.at, decision.approvedAt, decision.staleAt, decision.requestedAt]) {
    const parsed = Date.parse(String(at ?? ''));
    if (Number.isFinite(parsed)) return new Date(parsed).toISOString();
  }
  return null;
}

/** The workspace a Herdr entry positively names: its workspace_id, else the `W:` prefix of its pane id; null when it names none. */
export function herdrWorkspaceOf(entry) {
  if (typeof entry?.workspace_id === 'string' && entry.workspace_id) return entry.workspace_id;
  return /^([^:\s]+):[^:\s]+$/.exec(String(entry?.pane_id ?? ''))?.[1] ?? null;
}
/** Whether a Herdr entry is this installation's to act on: within its workspace, or attributed to no workspace at all. */
export function inScope(entry, scope) {
  if (!scope) return true;
  const workspace = herdrWorkspaceOf(entry);
  return workspace === null || workspace === scope;
}

/**
 * The reaping pass over one reading of the installation: every in-scope Herdr agent judged
 * against the decision it was launched to approve. `disposition` is one of:
 *   `reap`               — the decision settled and the runtime sits idle or done: close it;
 *   `hold-requested`     — the decision is still awaited: the loop's stall and relaunch machinery
 *                          owns it, and closing it would destroy an in-flight judgement;
 *   `hold-working`       — the decision settled but the runtime is still working: a later pass
 *                          closes it once it goes idle (still inside the grace);
 *   `hold-unknown-status` / `hold-no-pane` — nothing may be concluded about the runtime;
 *   `unmatched`          — the agent names no decision this control plane holds: never closed.
 * `lingering` marks a session still open at or past `graceMs` after its settle — the condition
 * the fault class counts, and the one both modes exit 1 on.
 */
export function planReap({ now, work, decisions, agents, scope, graceMs = settleGraceMs }) {
  const byName = new Map();
  for (const item of work ?? []) for (const decision of decisions?.get(item.id) ?? []) {
    byName.set(approverSessionNames(item.key, decision.id), { work: item, decision });
  }
  return (agents ?? []).filter(agent => inScope(agent, scope)).map(agent => {
    const matched = byName.get(agent.name) ?? null;
    const settled = matched ? settledAt(matched.decision) : null;
    const status = agent.agent_status ?? '';
    const settledForMs = settled !== null ? Math.max(0, now - Date.parse(settled)) : null;
    const disposition = matched === null ? 'unmatched'
      : settled === null ? 'hold-requested'
      : !agent.pane_id ? 'hold-no-pane'
      : status === 'working' ? 'hold-working'
      : status === 'idle' || status === 'done' ? 'reap'
      : 'hold-unknown-status';
    return {
      pane: agent.pane_id ?? null, name: agent.name ?? null, status: status || null,
      work: matched?.work.key ?? null, decision: matched?.decision.id ?? null,
      action: matched?.decision.action ?? null, state: matched?.decision.state ?? null,
      settledAt: settled, settledForMs,
      lingering: settledForMs !== null && settledForMs >= graceMs,
      disposition,
    };
  });
}

/** The install id a repository names, the way `graphyard install` derives it: owner/name → owner-name. */
export function installIdOf(repository) {
  const match = /^([\w.-]+)\/([\w.-]+)$/.exec(String(repository ?? '').trim());
  if (!match) throw new Error(`Expected a repository as OWNER/NAME, not ${JSON.stringify(repository)}`);
  return `${match[1]}-${match[2]}`.toLowerCase().replace(/[^a-z0-9._-]/g, '-');
}

/**
 * The checkout this command reconciles: its own repository root when that root is the coordinator,
 * else the working directory when it is one (a scratch mirror of the coordinator config reads the
 * same plane). A managed worktree is neither and is refused by name.
 */
export function coordinatorRoot(scriptDirectory, exists = path => existsSync(path), cwd = process.cwd()) {
  for (const root of [resolve(scriptDirectory, '..'), resolve(cwd)]) {
    if (exists(resolve(root, '.graphyard', 'master.json'))) return root;
  }
  throw new Error(`neither ${resolve(scriptDirectory, '..')} nor ${resolve(cwd)} is the coordinator checkout: neither holds .graphyard/master.json. Run this from the checkout whose .graphyard/ holds master.json, not from a managed worktree.`);
}

/** The command line this script takes, parsed from argv. */
export function parseArguments(argv) {
  const options = { status: false, reap: false, json: false, graceMs: null };
  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index];
    const value = () => { const next = argv[++index]; if (next === undefined) throw new Error(`${argument} needs a value`); return next; };
    if (argument === '--status') options.status = true;
    else if (argument === '--reap') options.reap = true;
    else if (argument === '--json') options.json = true;
    else if (argument === '--grace-ms') {
      options.graceMs = Number(value());
      if (!Number.isInteger(options.graceMs) || options.graceMs < 0) throw new Error(`--grace-ms takes a whole number of milliseconds from 0 up, not ${JSON.stringify(options.graceMs)}`);
    } else throw new Error(`Unknown argument ${argument}`);
  }
  if (options.status === options.reap) throw new Error('Use exactly one of --status or --reap');
  return options;
}

/** An age in ms as the compact `1h02m03s` the report reads. */
export const age = (ms) => `${Math.floor(ms / 3_600_000)}h${String(Math.floor((ms % 3_600_000) / 60_000)).padStart(2, '0')}m${String(Math.floor((ms % 60_000) / 1000)).padStart(2, '0')}s`;

/** One Herdr call, run with the installation's own config home when it exists. */
function herdrJson(binary, args, configHome, timeoutMs = 30_000) {
  const env = configHome && existsSync(configHome) ? { ...process.env, XDG_CONFIG_HOME: configHome } : { ...process.env };
  const result = spawnSync(binary, args, { encoding: 'utf8', timeout: timeoutMs, env });
  if (result.error) throw new Error(`could not run ${binary}: ${result.error.message}`);
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`.trim();
  if (result.status !== 0) throw new Error(`herdr ${args.join(' ')} failed (${result.status}):\n${output.slice(-2000)}`);
  const parsed = JSON.parse(result.stdout);
  if (parsed.error) throw new Error(`Herdr refused the operation: ${parsed.error.message ?? parsed.error}`);
  return parsed.result ?? parsed;
}

/** One control-plane read with the coordinator credential, which is never printed. */
async function planeGet(url, path, token) {
  const response = await fetch(`${url.replace(/\/$/, '')}${path}`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`GET ${path} failed (${response.status})`);
  return response.json();
}

/** Closes one pane and waits for it to leave Herdr's inventory, the way the daemon's own close does. */
export function closePane(binary, pane, configHome) {
  herdrJson(binary, ['pane', 'close', pane], configHome);
  const deadline = Date.now() + closeWaitMs;
  for (;;) {
    const inventory = herdrJson(binary, ['pane', 'list'], configHome);
    if (!Array.isArray(inventory?.panes)) throw new Error('Herdr did not return a pane inventory after close');
    if (!inventory.panes.some(candidate => candidate.pane_id === pane)) return true;
    if (Date.now() >= deadline) throw new Error(`Herdr still reports pane ${pane} after close`);
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100);
  }
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const root = coordinatorRoot(dirname(fileURLToPath(import.meta.url)));
  const master = JSON.parse(readFileSync(resolve(root, '.graphyard', 'master.json'), 'utf8'));
  const url = master.url, scope = master.herdrWorkspace ?? null;
  const credential = master.credentialFile;
  if (typeof url !== 'string' || !/^https?:\/\//.test(url)) throw new Error('.graphyard/master.json names no control plane URL');
  if (!isAbsolute(String(credential ?? ''))) throw new Error('.graphyard/master.json names no absolute coordinator credential file');
  const token = readFileSync(credential, 'utf8').trim();
  const graceMs = options.graceMs ?? settleGraceMs;

  const snapshot = await planeGet(url, '/api/work-snapshot?view=coordination', token);
  const work = Array.isArray(snapshot?.work) ? snapshot.work.filter(item => typeof item?.id === 'string' && typeof item?.key === 'string') : [];
  const decisions = new Map();
  for (const item of work) {
    decisions.set(item.id, await planeGet(url, `/api/work/${item.id}/decisions`, token).then(document => Array.isArray(document?.decisions) ? document.decisions : []).catch(() => []));
  }
  const binary = process.env.HERDR_BIN_PATH || 'herdr';
  const configHome = resolve(process.env.XDG_CONFIG_HOME || resolve(homedir(), '.config'), 'graphyard', installIdOf(master.repository), 'herdr');
  const listAgents = () => herdrJson(binary, ['agent', 'list'], configHome).agents ?? [];
  const read = (agents) => planReap({ now: Date.now(), work, decisions, agents, scope, graceMs });
  const agents = listAgents();
  const closed = [];
  if (options.reap) for (const entry of read(agents).filter(entry => entry.disposition === 'reap')) {
    closePane(binary, entry.pane, configHome);
    closed.push(entry);
  }
  const after = read(options.reap ? listAgents() : agents);
  const lingering = after.filter(entry => entry.lingering);
  const report = {
    repository: master.repository, scope, items: work.length, decisions: [...decisions.values()].reduce((total, rows) => total + rows.length, 0),
    agents: agents.length, graceMs, mode: options.reap ? 'reap' : 'status',
    closed: closed.map(entry => ({ pane: entry.pane, name: entry.name, work: entry.work, decision: entry.decision, settledFor: age(entry.settledForMs) })),
    sessions: after.map(entry => ({ ...entry, settledFor: entry.settledForMs === null ? null : age(entry.settledForMs) })),
    lingering: lingering.length,
  };
  if (options.json) console.log(JSON.stringify(report, null, 2));
  else {
    console.log(`repository: ${master.repository} (workspace scope ${scope ?? 'unscoped'})`);
    console.log(`read ${work.length} items, ${report.decisions} decisions, ${agents.length} live agents; grace ${graceMs}ms`);
    for (const entry of report.sessions) {
      console.log(`  ${entry.disposition.padEnd(19)} ${entry.name ?? '(unnamed)'}  pane ${entry.pane ?? 'none'}  ${entry.work ?? 'no item'} ${entry.action ?? ''} ${entry.state ?? ''}${entry.settledAt ? ` settled ${entry.settledFor} ago (${entry.status})` : ''}${entry.lingering ? '  LINGERING' : ''}`);
    }
    for (const done of report.closed) console.log(`  closed ${done.pane} (${done.name}, ${done.work} ${done.decision} settled ${done.settledFor} ago)`);
    console.log(lingering.length ? `${lingering.length} session(s) still open ${age(graceMs)} or more after their decisions settled` : `no session open ${age(graceMs)} or more after its decision settled`);
  }
  return lingering.length ? 1 : 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then(code => process.exit(code)).catch(error => { console.error(error instanceof Error ? error.message : String(error)); process.exit(1); });
}
