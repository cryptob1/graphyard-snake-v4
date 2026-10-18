#!/usr/bin/env node
// Reaps coordination sessions whose decisions settled (GY-20), and audits the credentials the
// installation's identities read through (GY-18).
//
//   node bin/graphyard.mjs --status [--json] [--grace-ms N]
//   node bin/graphyard.mjs --reap   [--json] [--grace-ms N]
//   node bin/graphyard.mjs credentials [--refresh] [--json] [--key GY-N]
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
//
// GY-18 — the credential pass. The doctor/work principal's bearer token went stale: `status GY-N`
// reads and doctor report posts were refused 401 'A valid Graphyard bearer token is required' for
// hours while the master's own reads succeeded, because every doctor launch and work filing the
// loop makes runs as the operator credential (src/daemon/doctor.ts doctorEffects env, doctor.ts
// postRun), and nothing on the host verified that credential still authenticated. On each pass,
// against this host's own installation:
//
//   1. reads the coordinator's Graphyard config (.graphyard/master.json in the coordinator
//      checkout — a managed worktree is not one) for the control plane URL and every credential
//      file it names: the coordinator's own, the operator agent's (the doctor identity), the
//      approver's and each worker's;
//   2. probes each one with the exact work read `status GY-N` makes (GET /api/work/:key — the read
//      the recorded fault refused), plus the ambient session credential the environment names
//      (GRAPHYARD_TOKEN_FILE / GRAPHYARD_TOKEN), which is the credential a loop-launched doctor
//      session actually runs as — the one that was stale in the recorded fault while the file the
//      re-provisioned config named was already fresh;
//   3. `--refresh` then repairs each stale one before re-reading: a credential whose role has
//      another file the config names that authenticates takes that file's token (the recorded
//      remedy — the fresh token the setup wrote beside the stale file); the doctor's operator
//      credential with no alternate is minted fresh through the control plane's own rotate route
//      (POST /api/operator-agents/:id/rotate, administrator-gated), authorized by the first
//      credential of the config's that the plane still accepts; anything else is reported
//      unrefreshable with the setup step that provisions it. Tokens are never printed;
//   4. both modes exit 1 while any credential still refuses its work read, so a supervisor reading
//      the exit code sees the invariant the fault class counts, and a refresh that rewrote a file
//      reports the restart a running master loop still needs: it keeps the settings it loaded when
//      .graphyard/master.json changes credentialFile or cliPath (src/master/config.ts
//      masterBoundSettings — 'restart master run to adopt it').
//
// The pass never ends leases, never touches Herdr, and writes nothing but credential files it has
// just verified stale, with tokens it has just verified accepted.
import { spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { chmodSync, existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
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

// GY-18 — the credential pass, as the header above describes it.

/** The item a credential probe reads by default: the recorded fault's own `status GY-1`. */
export const defaultProbeKey = 'GY-1';
/** A credential is healthy when the plane accepted it for a read — the item itself need not exist. */
export const passingRead = (disposition) => disposition === 'ok' || disposition === 'authenticated';

/** The command line the credential pass takes, parsed from its own argv (after the `credentials` word). */
export function parseCredentialArguments(argv) {
  const options = { refresh: false, json: false, key: null };
  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index];
    const value = () => { const next = argv[++index]; if (next === undefined) throw new Error(`${argument} needs a value`); return next; };
    if (argument === '--refresh') options.refresh = true;
    else if (argument === '--json') options.json = true;
    else if (argument === '--key') {
      options.key = value();
      if (!/^GY-\d+$/.test(options.key)) throw new Error(`--key takes a work key like GY-1, not ${JSON.stringify(options.key)}`);
    } else throw new Error(`Unknown argument ${argument}`);
  }
  return options;
}

/** Every identity whose absolute credential file .graphyard/master.json names (src/master/config.ts MasterConfig): the coordinator's own, the operator agent's (the doctor), the approver's and each worker's. */
export function installationIdentities(master) {
  const identities = [];
  const named = (entry) => entry && isAbsolute(String(entry.credentialFile ?? '')) ? { path: entry.credentialFile } : null;
  const coordinator = named(master);
  if (coordinator) identities.push({ role: 'coordinator', name: null, ...coordinator });
  const doctor = named(master?.operatorAgent);
  if (doctor) identities.push({ role: 'doctor', name: master.operatorAgent.id ?? null, ...doctor });
  const approver = named(master?.approver);
  if (approver) identities.push({ role: 'approver', name: master.approver.id ?? null, ...approver });
  for (const worker of Array.isArray(master?.workers) ? master.workers : []) {
    const credential = named(worker);
    if (credential) identities.push({ role: 'worker', name: worker.name ?? null, ...credential });
  }
  return identities;
}

/** The ambient session credential the environment names: the file a loop-launched session runs as (GRAPHYARD_TOKEN_FILE, never the token itself), else an inline token (GRAPHYARD_TOKEN). */
export function ambientCredential(env = process.env) {
  const file = typeof env.GRAPHYARD_TOKEN_FILE === 'string' ? env.GRAPHYARD_TOKEN_FILE.trim() : '';
  if (file && isAbsolute(file)) return { source: 'GRAPHYARD_TOKEN_FILE', path: file };
  if (typeof env.GRAPHYARD_TOKEN === 'string' && env.GRAPHYARD_TOKEN.trim()) return { source: 'GRAPHYARD_TOKEN', path: null };
  return null;
}

/** Judge one work read the way the fault class counts it: server/auth.ts's 401 is the recorded refusal; a 404 still proves the reader authenticated. */
export function classifyWorkRead(status, body, key) {
  const error = body && typeof body === 'object' && typeof body.error === 'string' ? body.error : null;
  if (status === 200) return { disposition: 'ok', item: body && typeof body === 'object' && typeof body.key === 'string' ? body.key : null, detail: body?.key === key ? `the work read returned ${key}` : 'the work read was accepted' };
  if (status === 404) return { disposition: 'authenticated', item: null, detail: 'the plane answered for an authenticated reader; it holds no such item' };
  if (status === 401) return { disposition: 'stale', item: null, detail: error ?? 'A valid Graphyard bearer token is required' };
  if (status === 403) return { disposition: 'refused', item: null, detail: error ?? 'the work read was refused (403)' };
  return { disposition: 'error', item: null, detail: error ?? `the work read failed (${status})` };
}

/** One control-plane read with a credential: GET /api/work/:key, the exact read `status GY-N` makes. */
async function planeRead(url, key, token) {
  const response = await fetch(`${url.replace(/\/$/, '')}/api/work/${encodeURIComponent(key)}`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(30_000) });
  return { status: response.status, body: await response.json().catch(() => null) };
}

/** One control-plane write with a credential, answering status and body the same way. */
async function planeSend(url, path, token, body) {
  const response = await fetch(`${url.replace(/\/$/, '')}${path}`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(30_000) });
  return { status: response.status, body: await response.json().catch(() => null) };
}

/** Probe one identity's credential with the work read. The token itself is read and sent, never printed. */
export async function probeCredential({ url, key, role, name, path, token }) {
  const identity = { role, name: name ?? null, path: path ?? null, source: path ? 'file' : 'environment' };
  let bearer = typeof token === 'string' ? token : null;
  if (path) {
    try { bearer = readFileSync(path, 'utf8').trim(); } catch { return { ...identity, disposition: 'missing', status: null, item: null, detail: 'the credential file does not exist' }; }
  }
  if (!bearer) return { ...identity, disposition: 'missing', status: null, item: null, detail: path ? 'the credential file is empty' : 'the environment names no token' };
  try {
    const { status, body } = await planeRead(url, key, bearer);
    return { ...identity, status, ...classifyWorkRead(status, body, key) };
  } catch (error) {
    return { ...identity, disposition: 'error', status: null, item: null, detail: error instanceof Error ? error.message : String(error) };
  }
}

/** A fresh credential token: the shape the plane's own setup and rotate schemas take (a string of at least 32 characters). */
export const mintToken = () => randomBytes(32).toString('base64url');

/** Write one credential file the way the installation's own setup does: atomically, owner-only. */
export function writeCredential(path, token) {
  const scratch = `${path}.refresh-${process.pid}`;
  writeFileSync(scratch, `${token}\n`, { mode: 0o600 });
  renameSync(scratch, path);
  chmodSync(path, 0o600);
}

/**
 * The refresh one stale credential gets, decided before anything is written:
 *   `copy`   — another file the config names for the same role authenticates: its token is the fresh
 *              credential, and the stale file is rewritten with it. That is the recorded fault's own
 *              remedy — the re-provisioned setup had written the fresh token beside the stale file,
 *              and the loop's loaded settings still named the old path. The ambient session
 *              credential is the doctor's by construction (the loop launches doctor sessions with the
 *              operator credential's file), so it copies from the doctor's passing file, else the
 *              coordinator's;
 *   `rotate` — the doctor's own file with no authenticating alternate: the control plane's rotate
 *              route mints a fresh credential (POST /api/operator-agents/:id/rotate);
 *   `none`   — no route this command holds can mint it: the installation's setup provisions it.
 */
export function planCredentialRefresh(finding, findings, master) {
  if (passingRead(finding.disposition)) return { action: 'none', reason: 'the credential authenticates' };
  const donor = (role) => findings.find(other => other.role === role && other.path && other.path !== finding.path && passingRead(other.disposition)) ?? null;
  if (finding.role === 'ambient') {
    const from = donor('doctor') ?? donor('coordinator');
    if (from) return { action: 'copy', from: from.path, reason: `the ${from.role} credential the config names authenticates; its token refreshes the ambient session credential's file, and the master run restart adopts the changed settings` };
    return { action: 'none', reason: 'no credential the config names can refresh the ambient session credential; refresh it in the file the launching session names and restart the master run to adopt the changed settings' };
  }
  const sameRole = donor(finding.role);
  if (sameRole) return { action: 'copy', from: sameRole.path, reason: `the ${finding.role} credential the config names at another path authenticates; its token refreshes this file` };
  if (finding.role === 'doctor' && typeof master?.operatorAgent?.id === 'string' && master.operatorAgent.id) {
    return { action: 'rotate', id: master.operatorAgent.id, reason: 'no alternate file authenticates; the control plane\'s rotate route mints a fresh credential for the doctor principal' };
  }
  return { action: 'none', reason: 'no control-plane route this command holds mints this credential; the installation\'s setup provisions it' };
}

/** What a refresh pass did to one credential, and what it could not do. */
export async function refreshOne({ url, key, finding, findings, master }) {
  const plan = planCredentialRefresh(finding, findings, master);
  if (plan.action === 'copy') {
    writeCredential(finding.path, readFileSync(plan.from, 'utf8').trim());
    const again = await probeCredential({ url, key, role: finding.role, name: finding.name, path: finding.path });
    Object.assign(finding, again);
    return { outcome: 'refreshed', role: finding.role, path: finding.path, from: plan.from, disposition: again.disposition, reason: plan.reason };
  }
  if (plan.action === 'rotate') {
    for (const other of findings.filter(candidate => candidate !== finding && candidate.path && candidate.path !== finding.path && passingRead(candidate.disposition))) {
      const minted = mintToken();
      const { status, body } = await planeSend(url, `/api/operator-agents/${encodeURIComponent(plan.id)}/rotate`, readFileSync(other.path, 'utf8').trim(), { token: minted, transitionSeconds: 0, reason: 'GY-18 credential pass: the doctor credential no longer authenticates' })
        .catch(error => ({ status: 0, body: { error: error instanceof Error ? error.message : String(error) } }));
      if (status === 200) {
        writeCredential(finding.path, minted);
        const again = await probeCredential({ url, key, role: finding.role, name: finding.name, path: finding.path });
        Object.assign(finding, again);
        return { outcome: 'refreshed', role: finding.role, path: finding.path, with: `${other.role}${other.name ? ` (${other.name})` : ''}`, disposition: again.disposition, reason: plan.reason };
      }
      if (status !== 403) return { outcome: 'refused', role: finding.role, path: finding.path, reason: `the rotate route answered ${status}: ${body?.error ?? 'no detail'}` };
      // 403: this credential may not rotate the principal; the next authorized one tries.
    }
    return { outcome: 'refused', role: finding.role, path: finding.path, reason: 'no credential the config names may rotate the doctor principal (the route is administrator-gated)' };
  }
  return { outcome: 'unrefreshable', role: finding.role, path: finding.path ?? null, reason: plan.reason };
}

/** The credential pass itself: probe every identity and the ambient session credential, optionally refresh, and report. */
export async function credentialMain(arguments_, env = process.env, log = console.log) {
  const options = parseCredentialArguments(arguments_);
  const key = options.key ?? defaultProbeKey;
  const root = coordinatorRoot(dirname(fileURLToPath(import.meta.url)));
  const master = JSON.parse(readFileSync(resolve(root, '.graphyard', 'master.json'), 'utf8'));
  const url = master.url;
  if (typeof url !== 'string' || !/^https?:\/\//.test(url)) throw new Error('.graphyard/master.json names no control plane URL');
  const identities = installationIdentities(master);
  if (!identities.length) throw new Error('.graphyard/master.json names no absolute credential file');
  const ambient = ambientCredential(env);
  const findings = [];
  for (const identity of identities) findings.push(await probeCredential({ url, key, ...identity }));
  if (ambient) findings.push(await probeCredential({ url, key, role: 'ambient', name: ambient.source, path: ambient.path, token: ambient.path ? undefined : env.GRAPHYARD_TOKEN.trim() }));
  const repairs = [];
  if (options.refresh) for (const finding of findings) {
    if (passingRead(finding.disposition)) continue;
    repairs.push(await refreshOne({ url, key, finding, findings, master }));
  }
  const refreshed = repairs.filter(repair => repair.outcome === 'refreshed');
  const unrefreshable = repairs.filter(repair => repair.outcome !== 'refreshed').map(({ outcome, ...repair }) => ({ ...repair, refused: outcome === 'refused' }));
  const unhealthy = findings.filter(finding => !passingRead(finding.disposition));
  const report = {
    repository: master.repository, mode: options.refresh ? 'credentials-refresh' : 'credentials', key,
    identities: findings.length, findings, refreshed, unrefreshable, stale: unhealthy.length,
    adoption: repairs.length ? 'a running master loop keeps the settings it loaded when .graphyard/master.json changes credentialFile or cliPath, which it is bound to; restart the master run to adopt them' : null,
  };
  if (options.json) log(JSON.stringify(report, null, 2));
  else {
    log(`repository: ${master.repository} (work read ${key})`);
    for (const finding of findings) {
      log(`  ${finding.disposition.padEnd(14)} ${(finding.role + (finding.name ? ` (${finding.name})` : '')).padEnd(34)} ${finding.path ?? 'environment'}  ${finding.detail}`);
    }
    for (const repair of refreshed) log(`  refreshed ${repair.role} ${repair.path}${repair.from ? ` from ${repair.from}` : repair.with ? ` through the rotate route with the ${repair.with} credential` : ''}`);
    for (const repair of unrefreshable) log(`  ${repair.refused ? 'refused' : 'unrefreshable'} ${repair.role} ${repair.path ?? ''} — ${repair.reason}`);
    log(unhealthy.length
      ? `${unhealthy.length} credential(s) still refuse their work read; ${report.adoption}`
      : `every identity's work read was accepted; no credential is stale`);
  }
  return unhealthy.length ? 1 : 0;
}

async function main() {
  if (process.argv[2] === 'credentials') return credentialMain(process.argv.slice(3));
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
